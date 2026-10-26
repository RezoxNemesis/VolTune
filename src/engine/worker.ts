/// <reference lib="webworker" />
import { KokoroTTS, env } from "kokoro-js";
import type { Device, FromWorker, ToWorker } from "./protocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Serve the ONNX Runtime WebAssembly from our own origin (see vite.config.ts).
env.wasmPaths = `${self.location.origin}/ort/`;

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;
const cancelled = new Set<number>();

async function load(device: Device): Promise<void> {
  const progress_callback = (p: { status?: string; loaded?: number; total?: number; file?: string }) => {
    if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
      post({ type: "progress", loaded: p.loaded, total: p.total, file: p.file ?? "" });
    }
  };
  const attempts: Array<{ device: Device; dtype: "fp32" | "q8" }> =
    device === "webgpu"
      ? [
          { device: "webgpu", dtype: "fp32" },
          { device: "wasm", dtype: "q8" },
        ]
      : [{ device: "wasm", dtype: "q8" }];
  let lastError: unknown;
  for (const a of attempts) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: a.dtype, device: a.device, progress_callback });
      post({ type: "ready", device: a.device });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      loading ??= load(msg.device).catch((e) => {
        loading = null;
        throw e;
      });
      await loading;
    } else if (msg.type === "cancel") {
      cancelled.add(msg.id);
    } else if (msg.type === "generate") {
      if (!tts) {
        await loading;
        if (!tts) throw new Error("The speech engine is not loaded yet.");
      }
      for (const job of msg.jobs) {
        if (cancelled.has(msg.id)) {
          cancelled.delete(msg.id);
          post({ type: "cancelled", id: msg.id });
          return;
        }
        const audio = await tts.generate(job.text, { voice: job.voice as never, speed: job.speed });
        const pcm = new Float32Array(audio.audio);
        post({ type: "chunk", id: msg.id, index: job.index, pcm, sampleRate: audio.sampling_rate }, [pcm.buffer]);
      }
      if (cancelled.delete(msg.id)) post({ type: "cancelled", id: msg.id });
      else post({ type: "done", id: msg.id });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: "error", id: msg.type === "generate" ? msg.id : undefined, message, stage: msg.type === "init" ? "init" : "generate" });
  }
};
