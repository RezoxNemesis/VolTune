/// <reference lib="webworker" />
import { KokoroTTS, env } from "kokoro-js";
import { Tensor, env as hfEnv } from "@huggingface/transformers";
import { phonemize } from "phonemizer";
import { synthesize, VOICES_URL, type ModelRunner } from "./synth";
import { VoiceTables } from "./voicebank";
import type { Device, FromWorker, ToWorker } from "./protocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Serve the ONNX Runtime WebAssembly from our own origin (see vite.config.ts).
env.wasmPaths = `${self.location.origin}/ort/`;
// Use several threads when the page is cross-origin isolated (see public/_headers and MainActivity).
if (self.crossOriginIsolated && hfEnv.backends.onnx.wasm) {
  hfEnv.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency ?? 4) - 1));
}

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let run: ModelRunner | null = null;
let loading: Promise<void> | null = null;
const cancelled = new Set<number>();

const waiting = new Map<number, { resolve: (w: Float32Array) => void; reject: (e: Error) => void }>();
let nextReq = 1;

/** Stock voice tables, cached with the Cache API under the same name kokoro-js uses. */
async function loadVoice(id: string): Promise<Float32Array> {
  const url = `${VOICES_URL}/${id}.bin`;
  let cache: Cache | null = null;
  try {
    cache = await caches.open("kokoro-voices");
    const hit = await cache.match(url);
    if (hit) return new Float32Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load voice ${id} (${res.status})`);
  const buf = await res.arrayBuffer();
  try {
    await cache?.put(url, new Response(buf.slice(0), { headers: res.headers }));
  } catch {
    /* storage full or unavailable: still usable this session */
  }
  return new Float32Array(buf);
}

const tables = new VoiceTables(loadVoice);

/** On Android the numeric step runs natively: hand ids + style to the main thread, which calls the plugin. */
const nativeRunner: ModelRunner = (ids, style, speed) => {
  const reqId = nextReq++;
  const result = new Promise<Float32Array>((resolve, reject) => waiting.set(reqId, { resolve, reject }));
  post({ type: "infer", reqId, ids: BigInt64Array.from(ids, (n) => BigInt(n)), style, speed });
  return result;
};

function webRunner(tts: KokoroTTS): ModelRunner {
  return async (ids, style, speed) => {
    const out = (await tts.model({
      input_ids: new Tensor("int64", BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
      style: new Tensor("float32", style, [1, style.length]),
      speed: new Tensor("float32", new Float32Array([speed]), [1]),
    })) as { waveform: { data: Float32Array } };
    return new Float32Array(out.waveform.data);
  };
}

async function load(device: Device): Promise<void> {
  if (device === "native") {
    run = nativeRunner;
    post({ type: "ready", device: "native" });
    return;
  }
  const progress_callback = (p: { status?: string; loaded?: number; total?: number; file?: string }) => {
    if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
      post({ type: "progress", loaded: p.loaded, total: p.total, file: p.file ?? "" });
    }
  };
  const attempts: Array<{ device: "webgpu" | "wasm"; dtype: "fp32" | "q8" }> =
    device === "webgpu"
      ? [
          { device: "webgpu", dtype: "fp32" },
          { device: "wasm", dtype: "q8" },
        ]
      : [{ device: "wasm", dtype: "q8" }];
  let lastError: unknown;
  for (const a of attempts) {
    try {
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: a.dtype, device: a.device, progress_callback });
      run = webRunner(tts);
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
    } else if (msg.type === "inferResult") {
      const w = waiting.get(msg.reqId);
      waiting.delete(msg.reqId);
      if (msg.pcm) w?.resolve(msg.pcm);
      else w?.reject(new Error(msg.error ?? "Native inference failed"));
    } else if (msg.type === "cancel") {
      cancelled.add(msg.id);
    } else if (msg.type === "generate") {
      if (!run) {
        await loading;
        if (!run) throw new Error("The speech engine is not loaded yet.");
      }
      const runner = run;
      for (const job of msg.jobs) {
        if (cancelled.has(msg.id)) {
          cancelled.delete(msg.id);
          post({ type: "cancelled", id: msg.id });
          return;
        }
        const pcm = await synthesize(job, { phonemize, tables, run: runner });
        post({ type: "chunk", id: msg.id, index: job.index, pcm, sampleRate: 24_000 }, [pcm.buffer]);
      }
      if (cancelled.delete(msg.id)) post({ type: "cancelled", id: msg.id });
      else post({ type: "done", id: msg.id });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: "error", id: msg.type === "generate" ? msg.id : undefined, message, stage: msg.type === "init" ? "init" : "generate" });
  }
};
