import { SAMPLE_RATE, stitch } from "./audio";
import type { Clip } from "./client";

type State = "idle" | "playing" | "paused" | "ended";

/**
 * Gapless timeline player. Clips can keep arriving while earlier ones play, and the
 * listener can pause, seek and replay the whole piece afterwards.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private clips: Clip[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private buffers = new WeakMap<Clip, AudioBuffer>();
  private anchorCtx = 0; // ctx time when `anchorPos` was playing
  private anchorPos = 0; // timeline seconds
  private pausedAt = 0;
  private _state: State = "idle";
  private generating = false;
  onState: (s: State) => void = () => {};

  get state(): State {
    return this._state;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /** End of the audio received so far, in seconds. */
  get duration(): number {
    const last = this.clips[this.clips.length - 1];
    return last ? last.start + last.pcm.length / SAMPLE_RATE : 0;
  }

  get position(): number {
    if (this._state === "paused" || this._state === "idle") return this.pausedAt;
    if (!this.ctx) return 0;
    const p = this.anchorPos + (this.ctx.currentTime - this.anchorCtx);
    return Math.min(p, this.duration);
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

  /** Begin a new piece. Call `add` as clips arrive and `finish` once generation ends. */
  async begin(): Promise<void> {
    this.stopSources();
    await this.unlock();
    this.clips = [];
    this.pausedAt = 0;
    this.generating = true;
    this.set("idle");
  }

  add(clip: Clip) {
    this.clips.push(clip);
    const ctx = this.ctx;
    if (!ctx) return;
    if (this._state === "idle" && this.clips.length === 1) {
      this.playFrom(0);
      return;
    }
    if (this._state === "playing") {
      // Recover from an underrun: if this clip should already have started, re-anchor.
      const at = this.anchorCtx + (clip.start - this.anchorPos);
      if (at < ctx.currentTime) {
        this.anchorPos = clip.start;
        this.anchorCtx = ctx.currentTime + 0.04;
      }
      this.schedule(clip);
    } else if (this._state === "ended") {
      // Playback already caught up while generation continued: resume with the new clip.
      this.playFrom(clip.start);
    }
  }

  finish() {
    this.generating = false;
    if (this._state === "playing" && this.position >= this.duration - 0.01) this.end();
  }

  cancelGeneration() {
    this.generating = false;
  }

  toggle() {
    if (this._state === "playing") this.pause();
    else if (this._state === "paused") this.playFrom(this.pausedAt);
    else if (this._state === "ended" || (this._state === "idle" && this.clips.length)) this.playFrom(0);
  }

  pause() {
    if (this._state !== "playing") return;
    this.pausedAt = this.position;
    this.stopSources();
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
    this.stopSources();
    this.generating = false;
    this.pausedAt = 0;
    this.set("idle");
  }

  /** The full piece as one mono buffer, for export. */
  render(): Float32Array {
    return stitch(this.clips.map((c) => ({ start: c.start, pcm: c.pcm })));
  }

  get hasAudio(): boolean {
    return this.clips.length > 0;
  }

  private playFrom(pos: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopSources();
    this.anchorPos = pos;
    this.anchorCtx = ctx.currentTime + 0.05;
    for (const c of this.clips) this.schedule(c);
    this.set("playing");
    if (!this.generating) this.armEnd();
  }

  private schedule(clip: Clip) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const dur = clip.pcm.length / SAMPLE_RATE;
    if (clip.start + dur <= this.anchorPos) return;
    let buf = this.buffers.get(clip);
    if (!buf) {
      buf = ctx.createBuffer(1, clip.pcm.length, SAMPLE_RATE);
      buf.copyToChannel(clip.pcm as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(clip, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    const offset = Math.max(0, this.anchorPos - clip.start);
    const when = this.anchorCtx + Math.max(0, clip.start - this.anchorPos);
    src.start(when, offset);
    src.onended = () => {
      this.sources.delete(src);
      if (this._state === "playing" && this.sources.size === 0 && !this.generating) this.end();
    };
    this.sources.add(src);
  }

  private armEnd() {
    if (this.sources.size === 0) this.end();
  }

  private end() {
    this.pausedAt = 0;
    this.stopSources();
    this.set("ended");
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources.clear();
  }

  private set(s: State) {
    if (this._state === s) return;
    this._state = s;
    this.onState(s);
  }
}
