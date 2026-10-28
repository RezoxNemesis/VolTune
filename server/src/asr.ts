/**
 * Speech recognition for checking what a clip actually says (Whisper tiny.en via sherpa-onnx).
 * Optional: if the package or model is unavailable, analysis still runs without transcripts.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { dataDir } from "./engine";

const require = createRequire(import.meta.url);
const MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2";

interface Recognizer {
  createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void };
  decode(s: unknown): void;
  getResult(s: unknown): { text: string };
}

let rec: Recognizer | null | undefined;

async function modelDir(log: (s: string) => void): Promise<string> {
  if (process.env.VOLTUNE_ASR_DIR) return process.env.VOLTUNE_ASR_DIR;
  const root = path.join(dataDir(), "asr");
  const dir = path.join(root, "sherpa-onnx-whisper-tiny.en");
  if (existsSync(path.join(dir, "tiny.en-tokens.txt"))) return dir;
  mkdirSync(root, { recursive: true });
  log("Downloading the speech-recognition model (once, ~118 MB)…");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`ASR model download failed (${res.status})`);
  const tarball = path.join(root, "model.tar.bz2");
  const { writeFileSync, unlinkSync } = await import("node:fs");
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["xjf", tarball, "-C", root]);
  unlinkSync(tarball);
  return dir;
}

/** Load once; returns null (with a reason logged) when recognition is unavailable. */
export async function recognizer(log: (s: string) => void = () => {}): Promise<Recognizer | null> {
  if (rec !== undefined) return rec;
  try {
    const sherpa = require("sherpa-onnx-node");
    const d = await modelDir(log);
    rec = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        whisper: { encoder: path.join(d, "tiny.en-encoder.int8.onnx"), decoder: path.join(d, "tiny.en-decoder.int8.onnx"), language: "en", task: "transcribe" },
        tokens: path.join(d, "tiny.en-tokens.txt"),
        numThreads: 2,
        provider: "cpu",
        debug: 0,
      },
    }) as Recognizer;
  } catch (e) {
    log(`Transcripts unavailable: ${e instanceof Error ? e.message : String(e)}`);
    rec = null;
  }
  return rec;
}

export function transcribe(r: Recognizer, pcm: Float32Array, sampleRate: number): string {
  // Whisper needs a little context; pad very short clips with silence.
  const pad = Math.round(sampleRate * 0.3);
  const x = new Float32Array(pcm.length + pad * 2);
  x.set(pcm, pad);
  const s = r.createStream();
  s.acceptWaveform({ samples: x, sampleRate });
  r.decode(s);
  return r.getResult(s).text.trim();
}

// Numbers are skipped on both sides: "eleven forty-six" and "11:46" are the same speech written two ways.
const NUMBER_WORDS = new Set("zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion point".split(" "));
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w) && !NUMBER_WORDS.has(w));

/** Word error rate of `heard` against `expected` (0 = perfect). */
export function wordErrorRate(expected: string, heard: string): number {
  const a = norm(expected);
  const b = norm(heard);
  if (!a.length) return b.length ? 1 : 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]! / a.length;
}
