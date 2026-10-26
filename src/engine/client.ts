import type { Device, FromWorker, Job, ToWorker } from "./protocol";
import { polish, SAMPLE_RATE } from "./audio";

export interface Progress {
  loaded: number;
  total: number;
  file: string;
}

export interface Segment {
  text: string;
  pauseMs: number;
  voice: string;
  speed: number;
}

export interface Clip {
  /** Seconds from the start of the timeline. */
  start: number;
  pcm: Float32Array;
  segment: Segment;
}

export interface GenerateHandlers {
  onClip(clip: Clip, done: number, total: number): void;
  onDone(): void;
  onCancel(): void;
  onError(message: string): void;
}

export async function detectDevice(): Promise<Device> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    /* fall through */
  }
  return "wasm";
}

export function isSupported(): boolean {
  return typeof WebAssembly === "object" && typeof Worker === "function" && !!(window.AudioContext ?? (window as never as { webkitAudioContext?: unknown }).webkitAudioContext);
}

/** Owns the speech worker and turns segments into timeline-aligned clips. */
export class SpeechEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private ready: Promise<Device> | null = null;
  private resolveReady?: (d: Device) => void;
  private rejectReady?: (e: Error) => void;
  private active: { id: number; handlers: GenerateHandlers } | null = null;
  device: Device | null = null;
  onProgress: (p: Progress) => void = () => {};

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    w.onerror = (ev) => this.fail(ev.message || "The speech worker stopped unexpectedly.", "init");
    this.worker = w;
    return w;
  }

  private send(msg: ToWorker) {
    this.ensureWorker().postMessage(msg);
  }

  /** Download (first run) and warm the model. Safe to call repeatedly. */
  load(): Promise<Device> {
    if (this.ready) return this.ready;
    this.ready = new Promise<Device>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});
    detectDevice().then((device) => this.send({ type: "init", device }));
    return this.ready;
  }

  private timeline = 0;
  private clips = new Map<number, Segment & { index: number }>();
  private total = 0;
  private received = 0;
  private cursor = 0;
  private pending = new Map<number, Float32Array>();

  /** Synthesize segments in order; clips arrive with their start time already computed. */
  async generate(segments: Segment[], handlers: GenerateHandlers): Promise<void> {
    if (this.active) this.cancel();
    await this.load();
    const id = this.nextId++;
    this.active = { id, handlers };
    this.timeline = 0;
    this.cursor = 0;
    this.received = 0;
    this.total = segments.length;
    this.clips.clear();
    this.pending.clear();
    const jobs: Job[] = segments.map((s, index) => {
      this.clips.set(index, { ...s, index });
      return { index, text: s.text, voice: s.voice, speed: s.speed };
    });
    this.send({ type: "generate", id, jobs });
  }

  cancel() {
    if (!this.active) return;
    this.send({ type: "cancel", id: this.active.id });
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case "progress":
        this.onProgress({ loaded: msg.loaded, total: msg.total, file: msg.file });
        break;
      case "ready":
        this.device = msg.device;
        this.resolveReady?.(msg.device);
        break;
      case "chunk": {
        if (!this.active || msg.id !== this.active.id) return;
        // Chunks are produced in order, but guard against reordering anyway.
        this.pending.set(msg.index, polish(msg.pcm, msg.sampleRate || SAMPLE_RATE));
        while (this.pending.has(this.cursor)) {
          const pcm = this.pending.get(this.cursor)!;
          this.pending.delete(this.cursor);
          const segment = this.clips.get(this.cursor)!;
          const clip: Clip = { start: this.timeline, pcm, segment };
          this.timeline += pcm.length / SAMPLE_RATE + segment.pauseMs / 1000;
          this.cursor++;
          this.received++;
          this.active.handlers.onClip(clip, this.received, this.total);
        }
        break;
      }
      case "done": {
        const a = this.active;
        if (a && a.id === msg.id) {
          this.active = null;
          a.handlers.onDone();
        }
        break;
      }
      case "cancelled": {
        const a = this.active;
        if (a && a.id === msg.id) {
          this.active = null;
          a.handlers.onCancel();
        }
        break;
      }
      case "error":
        this.fail(msg.message, msg.stage);
        break;
    }
  }

  private fail(message: string, stage: "init" | "generate") {
    if (stage === "init") {
      this.rejectReady?.(new Error(friendlyError(message, stage)));
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
    }
    const a = this.active;
    this.active = null;
    a?.handlers.onError(friendlyError(message, stage));
  }

  get busy(): boolean {
    return this.active !== null;
  }
}

export function friendlyError(message: string, stage: "init" | "generate"): string {
  if (/fetch|network|failed to load|load failed|NetworkError/i.test(message)) {
    return "The voice model could not be downloaded. Check your connection and try again.";
  }
  if (/memory|alloc/i.test(message)) return "Your device ran out of memory. Try shorter text, or close other tabs.";
  return stage === "init" ? "The voice engine failed to start. Reload the page and try again." : "Speech generation stopped unexpectedly. Try again.";
}
