/**
 * VolTune's speech engine on Node: the same planner, voices and delivery as the app, with Kokoro
 * running in onnxruntime-node. Used by both the CLI and the MCP connector.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, createWriteStream, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as ort from "onnxruntime-node";
import { phonemize } from "phonemizer";
import { buildPlan, type PlanItem, type PlanOptions } from "../../src/engine/plan";
import { synthesize, VOICES_URL, type ModelRunner } from "../../src/engine/synth";
import { VoiceTables, type CustomVoice } from "../../src/engine/voicebank";
import { encodeWav, mouthEnvelope, SAMPLE_RATE, stitch } from "../../src/engine/audio";
import { DEFAULT_VOICE } from "../../src/engine/voices";

const require = createRequire(import.meta.url);

const MODEL_URLS = {
  fp32: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
  int8: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
} as const;

export const dataDir = (): string => process.env.VOLTUNE_DATA ?? path.join(homedir(), ".voltune");

async function download(url: string, to: string, log: (s: string) => void): Promise<void> {
  log(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  mkdirSync(path.dirname(to), { recursive: true });
  const tmp = `${to}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  renameSync(tmp, to);
}

/** Path to the Kokoro ONNX model: $VOLTUNE_MODEL, or downloaded once into the data folder. */
export async function modelPath(log: (s: string) => void = () => {}): Promise<string> {
  if (process.env.VOLTUNE_MODEL) return process.env.VOLTUNE_MODEL;
  const precision = process.env.VOLTUNE_PRECISION === "int8" ? "int8" : "fp32";
  const file = path.join(dataDir(), "models", path.basename(MODEL_URLS[precision]));
  if (!existsSync(file)) await download(MODEL_URLS[precision], file, log);
  return file;
}

function localVoicesDir(): string | null {
  try {
    const dir = path.join(path.dirname(require.resolve("kokoro-js")), "..", "voices");
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

async function loadVoice(id: string): Promise<Float32Array> {
  const local = localVoicesDir();
  if (local && existsSync(path.join(local, `${id}.bin`))) {
    const b = await readFile(path.join(local, `${id}.bin`));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  const res = await fetch(`${VOICES_URL}/${id}.bin`);
  if (!res.ok) throw new Error(`Unknown or unreachable voice: ${id}`);
  return new Float32Array(await res.arrayBuffer());
}

export interface Rendered {
  pcm: Float32Array;
  sampleRate: number;
  /** Where each line sits in the audio, for subtitles and animation. */
  timeline: Array<{ index: number; speaker?: string; text: string; voice: string; tags?: string[]; start: number; end: number }>;
  cast: Record<string, string>;
  plan: PlanItem[];
}

export class Engine {
  private session: ort.InferenceSession | null = null;
  private loading: Promise<ort.InferenceSession> | null = null;
  readonly tables = new VoiceTables(loadVoice);
  constructor(private log: (s: string) => void = () => {}) {}

  private async ensure(): Promise<ort.InferenceSession> {
    if (this.session) return this.session;
    this.loading ??= (async () => {
      const file = await modelPath(this.log);
      const threads = Number(process.env.VOLTUNE_THREADS);
      this.session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...(threads > 0 ? { intraOpNumThreads: threads } : {}) });
      return this.session;
    })();
    return this.loading;
  }

  private runner: ModelRunner = async (ids, style, speed) => {
    const s = await this.ensure();
    const out = await s.run({
      tokens: new ort.Tensor("int64", BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, style.length]),
      speed: new ort.Tensor("float32", new Float32Array([speed]), [1]),
    });
    return new Float32Array((out.audio ?? Object.values(out)[0]!).data as Float32Array);
  };

  /** Render a script (dialogue) or plain text (speak) to one stitched clip plus its timeline. */
  async render(
    input: string,
    o: Partial<PlanOptions> & { customs?: readonly CustomVoice[] } = {},
    onProgress?: (done: number, total: number) => void,
  ): Promise<Rendered> {
    const opts: PlanOptions = {
      mode: o.mode ?? "dialogue",
      speed: o.speed ?? 1,
      pauseScale: o.pauseScale ?? 1,
      voice: o.voice ?? DEFAULT_VOICE,
      cast: o.cast ?? {},
      customs: o.customs ?? [],
    };
    const { items, cast } = buildPlan(input, opts);
    if (!items.length) throw new Error("Nothing to say: the text is empty after removing directions.");
    const parts: Array<{ pcm: Float32Array; start: number }> = [];
    const timeline: Rendered["timeline"] = [];
    let t = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const pcm = await synthesize({ index: i, ...it }, { phonemize, tables: this.tables, run: this.runner });
      const dur = pcm.length / SAMPLE_RATE;
      timeline.push({ index: i, speaker: it.speaker, text: it.text, voice: it.voice, tags: it.tags, start: r3(t), end: r3(t + dur) });
      parts.push({ pcm, start: t });
      t += dur + it.pauseMs / 1000;
      onProgress?.(i + 1, items.length);
    }
    return { pcm: stitch(parts, SAMPLE_RATE), sampleRate: SAMPLE_RATE, timeline, cast, plan: items };
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function wavBytes(r: Rendered): Uint8Array {
  return new Uint8Array(encodeWav(r.pcm, r.sampleRate));
}

/** Per-speaker mouth-openness tracks (0…1 per frame) for lip-sync. */
export function lipSync(r: Rendered, fps = 30): { fps: number; frames: number; tracks: Record<string, number[]> } {
  const frames = Math.ceil((r.pcm.length / r.sampleRate) * fps);
  const env = mouthEnvelope(r.pcm, fps, r.sampleRate);
  const tracks: Record<string, number[]> = {};
  for (const line of r.timeline) {
    const who = line.speaker ?? "Narrator";
    const tr = (tracks[who] ??= new Array<number>(frames).fill(0));
    for (let f = Math.floor(line.start * fps); f < Math.min(frames, Math.ceil(line.end * fps)); f++) tr[f] = env[f] ?? 0;
  }
  return { fps, frames, tracks };
}
