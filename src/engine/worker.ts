/// <reference lib="webworker" />
import { KokoroTTS, env } from "kokoro-js";
import { AutoTokenizer, Tensor, env as hfEnv } from "@huggingface/transformers";
import { phonemize } from "phonemizer";
import { hindiPhonemize } from "./hindi";
import { isHindiVoice } from "./voices";
import type { Device, FromWorker, ToWorker } from "./protocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// Serve the ONNX Runtime WebAssembly from our own origin (see vite.config.ts).
env.wasmPaths = `${self.location.origin}/ort/`;
// Use several threads when the page is cross-origin isolated (see public/_headers and MainActivity).
if (self.crossOriginIsolated && hfEnv.backends.onnx.wasm) {
  hfEnv.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency ?? 4) - 1));
}

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;
const cancelled = new Set<number>();

const waiting = new Map<number, { resolve: (w: Float32Array) => void; reject: (e: Error) => void }>();
let nextReq = 1;

/**
 * Stand-in for the ONNX model when inference runs natively on Android: kokoro-js still prepares the
 * phonemes and tokens, and this hands the numeric step to the main thread, which calls the plugin.
 */
function nativeModel() {
  return async (inputs: { input_ids: { data: BigInt64Array }; style: { data: Float32Array }; speed: { data: Float32Array } }) => {
    const reqId = nextReq++;
    const result = new Promise<Float32Array>((resolve, reject) => waiting.set(reqId, { resolve, reject }));
    post({ type: "infer", reqId, ids: new BigInt64Array(inputs.input_ids.data), style: new Float32Array(inputs.style.data), speed: inputs.speed.data[0] ?? 1 });
    const wave = await result;
    return { waveform: new Tensor("float32", wave, [1, wave.length]) };
  };
}

async function loadNative(): Promise<void> {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  tts = new KokoroTTS(nativeModel() as never, tokenizer as never);
  post({ type: "ready", device: "native" });
}

async function load(device: Device): Promise<void> {
  if (device === "native") return loadNative();
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
    } else if (msg.type === "inferResult") {
      const w = waiting.get(msg.reqId);
      waiting.delete(msg.reqId);
      if (msg.pcm) w?.resolve(msg.pcm);
      else w?.reject(new Error(msg.error ?? "Native inference failed"));
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
        let audio;
        if (isHindiVoice(job.voice)) {
          // kokoro-js only phonemizes English, so Hindi is converted here and fed in as token ids.
          const phonemes = await hindiPhonemize(job.text, async (run) => (await phonemize(run, "en-us")).join(" "));
          const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
          audio = await tts.generate_from_ids(input_ids, { voice: job.voice as never, speed: job.speed });
        } else {
          audio = await tts.generate(job.text, { voice: job.voice as never, speed: job.speed });
        }
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
