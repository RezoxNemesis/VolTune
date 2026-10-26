import { SAMPLE_RATE } from "./audio";
import { metasDuration, secs, type ClipMeta } from "./store";

type State = "idle" | "playing" | "paused" | "ended";

/** Supplies decoded audio for a clip. Clips are fetched on demand so memory stays flat for long pieces. */
export type ClipLoader = (index: number) => Promise<Float32Array>;

const LOOKAHEAD_S = 25;
const PUMP_MS = 250;

/**
 * Gapless timeline player with a sliding scheduling window. Clips can keep arriving while earlier
 * ones play; only the next ~25 seconds are ever decoded, so a one-hour narration plays the same
 * way a ten-second one does.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private metas: ClipMeta[] = [];
  private loader: ClipLoader = async () => new Float32Array(0);
  private sources = new Map<number, AudioBufferSourceNode>();
  private pending = new Set<number>();
  private cache = new Map<number, AudioBuffer>();
  private anchorCtx = 0;
  private anchorPos = 0;
  private pausedAt = 0;
  private _state: State = "idle";
  private generating = false;
  private epoch = 0;
  private timer = 0;
  onState: (s: State) => void = () => {};

  get state(): State {
    return this._state;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  get duration(): number {
    return metasDuration(this.metas);
  }

  get hasAudio(): boolean {
    return this.metas.length > 0;
  }

  get position(): number {
    if (this._state === "paused" || this._state === "idle") return this.pausedAt;
    if (!this.ctx) return 0;
    return Math.min(this.anchorPos + (this.ctx.currentTime - this.anchorCtx), this.duration);
  }

  /** Must be called from a user gesture the first time. */
  async unlock(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ sampleRate: SAMPLE_RATE, latencyHint: "playback" });
      this.master = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  /**
   * Begin a piece. `existing` lets a resumed render start with the clips already stored, so they
   * can be played right away while the rest is generated.
   */
  async begin(loader: ClipLoader, existing: readonly ClipMeta[] = []): Promise<void> {
    this.halt();
    await this.unlock();
    this.loader = loader;
    this.metas = [...existing];
    this.cache.clear();
    this.pausedAt = 0;
    this.generating = true;
    this.set("idle");
    if (this.metas.length > 0) this.playFrom(0);
  }

  add(meta: ClipMeta) {
    this.metas.push(meta);
    if (this._state === "idle" && this.metas.length === 1) this.playFrom(0);
    else if (this._state === "ended") this.playFrom(secs(meta.startSample));
    else if (this._state === "playing") this.pump();
  }

  finish() {
    this.generating = false;
  }

  cancelGeneration() {
    this.generating = false;
  }

  toggle() {
    if (this._state === "playing") this.pause();
    else if (this._state === "paused") this.playFrom(this.pausedAt);
    else if (this.metas.length > 0) this.playFrom(this._state === "ended" ? 0 : this.pausedAt);
  }

  pause() {
    if (this._state !== "playing") return;
    this.pausedAt = this.position;
    this.halt();
    this.set("paused");
  }

  seek(seconds: number) {
    const t = Math.max(0, Math.min(seconds, Math.max(0, this.duration - 0.01)));
    if (this._state === "playing") this.playFrom(t);
    else {
      this.pausedAt = t;
      if (this._state === "ended") this.set("paused");
    }
  }

  stop() {
    this.halt();
    this.generating = false;
    this.pausedAt = 0;
    this.metas = [];
    this.cache.clear();
    this.set("idle");
  }

  private playFrom(pos: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.cancelSources();
    this.anchorPos = pos;
    this.anchorCtx = ctx.currentTime + 0.06;
    this.set("playing");
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.pump(), PUMP_MS);
    this.pump();
  }

  /** Decode and schedule every clip that falls inside the lookahead window. */
  private pump() {
    const ctx = this.ctx;
    if (!ctx || this._state !== "playing") return;
    const pos = this.position;
    const horizon = pos + LOOKAHEAD_S;
    for (const m of this.metas) {
      const start = secs(m.startSample);
      const end = start + secs(m.samples);
      if (end <= this.anchorPos || start > horizon) continue;
      if (this.sources.has(m.index) || this.pending.has(m.index)) continue;
      void this.schedule(m);
    }
    if (!this.generating && this.metas.length > 0 && pos >= this.duration - 0.02 && this.sources.size === 0 && this.pending.size === 0) this.end();
  }

  private async schedule(m: ClipMeta) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const epoch = this.epoch;
    this.pending.add(m.index);
    let buf = this.cache.get(m.index);
    try {
      if (!buf) {
        const pcm = await this.loader(m.index);
        buf = ctx.createBuffer(1, Math.max(1, pcm.length), SAMPLE_RATE);
        buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
        this.cache.set(m.index, buf);
        // Keep only a handful of decoded clips around.
        while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value as number);
      }
    } catch {
      this.pending.delete(m.index);
      return;
    }
    this.pending.delete(m.index);
    if (epoch !== this.epoch || this._state !== "playing") return;

    const start = secs(m.startSample);
    let when = this.anchorCtx + (start - this.anchorPos);
    if (when < ctx.currentTime) {
      // Playback caught up with generation (or decoding was slow): treat it as a stall and re-anchor.
      const lateBy = ctx.currentTime + 0.03 - when;
      if (start >= this.anchorPos) this.anchorCtx += lateBy;
      when = this.anchorCtx + (start - this.anchorPos);
    }
    const offset = Math.max(0, this.anchorPos - start);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start(Math.max(when, ctx.currentTime), offset);
    src.onended = () => {
      if (this.sources.get(m.index) === src) this.sources.delete(m.index);
      src.disconnect();
      this.pump();
    };
    this.sources.set(m.index, src);
  }

  private end() {
    this.halt();
    this.pausedAt = 0;
    this.set("ended");
  }

  private cancelSources() {
    this.epoch++;
    for (const s of this.sources.values()) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources.clear();
    this.pending.clear();
  }

  private halt() {
    window.clearInterval(this.timer);
    this.cancelSources();
  }

  private set(s: State) {
    if (this._state === s) return;
    this._state = s;
    this.onState(s);
  }
}
