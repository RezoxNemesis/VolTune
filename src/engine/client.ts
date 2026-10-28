import type { Device, FromWorker, Job, ToWorker } from "./protocol";
import { SAMPLE_RATE, toInt16 } from "./audio";
import { nextStartSample, type ClipMeta, type ClipStore } from "./store";
import { Capacitor } from "@capacitor/core";
import { NATIVE_MODEL_FILE, NATIVE_MODEL_URL, NativeTts, decodePcm16 } from "../native/plugins";

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
  pitch?: number;
  gain?: number;
  soft?: number;
  edge?: number;
}

export interface GenerateOptions {
  store: ClipStore;
  jobId: string;
  /** Resume from this segment; earlier clips are already in the store. */
  startIndex?: number;
  /** Clips already stored for this job, used to place new ones on the timeline. */
  existing?: readonly ClipMeta[];
}

export interface GenerateHandlers {
  onClip(meta: ClipMeta, done: number, total: number): void;
  onDone(): void;
  onCancel(): void;
  onError(message: string): void;
}

export async function detectDevice(allowNative = true): Promise<Device> {
  if (allowNative && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NativeTts")) return "native";
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

  private send(msg: ToWorker, transfer: Transferable[] = []) {
    this.ensureWorker().postMessage(msg, transfer);
  }

  private nativeOk = true;
  private retried = false;
  private jobs: Job[] = [];

  /** Download (first run) and warm the model. Safe to call repeatedly. */
  load(): Promise<Device> {
    if (this.ready) return this.ready;
    const p = (async () => {
      let device = await detectDevice(this.nativeOk);
      if (device === "native") {
        try {
          await this.initNative();
        } catch {
          this.nativeOk = false;
          device = await detectDevice(false);
        }
      }
      return new Promise<Device>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
        this.send({ type: "init", device });
      });
    })();
    this.ready = p;
    p.catch(() => {
      if (this.ready === p) this.ready = null;
    });
    return p;
  }

  /** Download the full-precision model to app storage and load it into native ONNX Runtime. */
  private async initNative(): Promise<void> {
    const handle = await NativeTts.addListener("downloadProgress", (p) => this.onProgress({ loaded: p.loaded, total: p.total, file: "native-model" }));
    try {
      const threads = Math.max(2, Math.min(4, navigator.hardwareConcurrency || 4));
      await NativeTts.init({ modelUrl: NATIVE_MODEL_URL, fileName: NATIVE_MODEL_FILE, threads });
    } finally {
      await handle.remove();
    }
  }

  private async runNative(msg: Extract<FromWorker, { type: "infer" }>) {
    try {
      const r = await NativeTts.infer({ ids: Array.from(msg.ids, Number), style: Array.from(msg.style), speed: msg.speed });
      const pcm = decodePcm16(r.pcm);
      this.send({ type: "inferResult", reqId: msg.reqId, pcm }, [pcm.buffer]);
    } catch (e) {
      this.send({ type: "inferResult", reqId: msg.reqId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** The native engine misbehaved: continue the same job on the browser engine instead. */
  private async retryOnWeb(): Promise<boolean> {
    const a = this.active;
    const o = this.opts;
    if (!a || !o || this.retried || this.device !== "native") return false;
    this.retried = true;
    this.nativeOk = false;
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.device = null;
    try {
      await this.load();
    } catch {
      return false;
    }
    const remaining = this.jobs.filter((j) => j.index >= this.cursor);
    if (this.active !== a) return true;
    this.send({ type: "generate", id: a.id, jobs: remaining });
    return true;
  }

  private plan: Segment[] = [];
  private total = 0;
  private received = 0;
  private cursor = 0;
  private startSample = 0;
  private opts: GenerateOptions | null = null;
  private pending = new Map<number, Float32Array>();
  private chain: Promise<void> = Promise.resolve();

  /** Synthesize segments in order, storing each clip and reporting its place on the timeline. */
  async generate(segments: Segment[], opts: GenerateOptions, handlers: GenerateHandlers): Promise<void> {
    if (this.active) this.cancel();
    await this.load();
    const id = this.nextId++;
    this.active = { id, handlers };
    this.opts = opts;
    this.plan = segments;
    this.total = segments.length;
    const first = opts.startIndex ?? 0;
    this.cursor = first;
    this.received = first;
    this.startSample = nextStartSample(opts.existing ?? []);
    this.pending.clear();
    this.chain = Promise.resolve();
    const jobs: Job[] = [];
    for (let index = first; index < segments.length; index++) {
      const s = segments[index]!;
      jobs.push({ index, text: s.text, voice: s.voice, speed: s.speed, pitch: s.pitch, gain: s.gain, soft: s.soft, edge: s.edge });
    }
    if (jobs.length === 0) {
      this.active = null;
      handlers.onDone();
      return;
    }
    this.jobs = jobs;
    this.retried = false;
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
      case "infer":
        void this.runNative(msg);
        break;
      case "ready":
        this.device = msg.device;
        this.resolveReady?.(msg.device);
        break;
      case "chunk": {
        const a = this.active;
        if (!a || msg.id !== a.id) return;
        // The worker already polished and shaped the clip (see synth.ts).
        this.pending.set(msg.index, msg.pcm);
        this.chain = this.chain.then(() => this.flush(a.id)).catch((e) => this.fail(e instanceof Error ? e.message : "Storage failed", "storage"));
        break;
      }
      case "done": {
        const a = this.active;
        if (a && a.id === msg.id) {
          this.chain = this.chain.then(() => {
            if (this.active === a) {
              this.active = null;
              a.handlers.onDone();
            }
          });
        }
        break;
      }
      case "cancelled": {
        const a = this.active;
        if (a && a.id === msg.id) {
          this.chain = this.chain.then(() => {
            if (this.active === a) {
              this.active = null;
              a.handlers.onCancel();
            }
          });
        }
        break;
      }
      case "error":
        if (msg.stage === "generate" && this.device === "native") {
          void this.retryOnWeb().then((ok) => {
            if (!ok) this.fail(msg.message, msg.stage);
          });
        } else this.fail(msg.message, msg.stage);
        break;
    }
  }

  /** Write finished clips to storage in order, then announce them. */
  private async flush(id: number): Promise<void> {
    const a = this.active;
    const o = this.opts;
    if (!a || a.id !== id || !o) return;
    while (this.pending.has(this.cursor)) {
      const pcm = this.pending.get(this.cursor)!;
      this.pending.delete(this.cursor);
      const seg = this.plan[this.cursor]!;
      const meta: ClipMeta = {
        index: this.cursor,
        startSample: this.startSample,
        samples: pcm.length,
        pauseSamples: Math.round((seg.pauseMs / 1000) * SAMPLE_RATE),
      };
      await o.store.put(o.jobId, meta, toInt16(pcm));
      if (this.active !== a) return;
      this.startSample += meta.samples + meta.pauseSamples;
      this.cursor++;
      this.received++;
      a.handlers.onClip(meta, this.received, this.total);
    }
  }

  private fail(message: string, stage: "init" | "generate" | "storage") {
    if (stage === "init") {
      this.rejectReady?.(new Error(friendlyError(message, stage)));
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
    }
    const a = this.active;
    this.active = null;
    if (stage === "storage") this.send({ type: "cancel", id: a?.id ?? 0 });
    a?.handlers.onError(friendlyError(message, stage));
  }

  get busy(): boolean {
    return this.active !== null;
  }
}

export function friendlyError(message: string, stage: "init" | "generate" | "storage"): string {
  if (stage === "storage") return "Couldn’t save the audio on this device. Free some space and try again.";
  if (/fetch|network|failed to load|load failed|NetworkError/i.test(message)) {
    return "The voice model could not be downloaded. Check your connection and try again.";
  }
  if (/memory|alloc/i.test(message)) return "Your device ran out of memory. Try shorter text, or close other tabs.";
  return stage === "init" ? "The voice engine failed to start. Reload the page and try again." : "Speech generation stopped unexpectedly. Try again.";
}
