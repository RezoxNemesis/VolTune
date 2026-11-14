/**
 * VolTune Studio on Node: downloads Chatterbox Multilingual (ONNX, ~1.5 GB once, pinned revision) into the
 * data folder, runs it with onnxruntime-node, and keeps one small speaker file per voice and mood.
 * The engine logic itself is shared with the apps (src/engine/studio.ts).
 */
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as ort from "onnxruntime-node";
import {
  exposeAlignment,
  makeSpeaker,
  packSpeaker,
  STUDIO_FILES,
  STUDIO_REPO,
  STUDIO_REVISION,
  StudioTokenizer,
  TEXT_POS,
  unpackSpeaker,
  type OrtSession,
  type Speaker,
  type StudioModels,
  type TensorMaker,
} from "../../src/engine/studio";

export const studioDir = (data: string): string => path.join(data, "models", "chatterbox");

async function fetchTo(url: string, to: string, log: (s: string) => void): Promise<void> {
  log(`Downloading ${path.basename(to)} …`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  mkdirSync(path.dirname(to), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${to}.part`));
  renameSync(`${to}.part`, to);
}

/** Make sure every model file is on disk (and the aligned language-model graph next to its weights). */
export async function ensureStudioFiles(data: string, log: (s: string) => void): Promise<string> {
  const dir = studioDir(data);
  const files = [...STUDIO_FILES, "onnx/language_model_q4.onnx"];
  for (const f of files) {
    const to = path.join(dir, f);
    if (!existsSync(to)) await fetchTo(`https://huggingface.co/${STUDIO_REPO}/resolve/${STUDIO_REVISION}/${f}`, to, log);
  }
  const aligned = path.join(dir, "onnx", "language_model_q4_align.onnx");
  if (!existsSync(aligned)) await writeFile(aligned, exposeAlignment(new Uint8Array(await readFile(path.join(dir, "onnx", "language_model_q4.onnx")))));
  return dir;
}

const tensor: TensorMaker = (type, data, dims) => new ort.Tensor(type, data, dims as number[]);

export async function loadStudio(data: string, log: (s: string) => void): Promise<StudioModels> {
  const dir = await ensureStudioFiles(data, log);
  // Every core: onnxruntime's own default can settle on fewer, which doubles the time here.
  const threads = Number(process.env.VOLTUNE_THREADS) || availableParallelism();
  const opts: ort.InferenceSession.SessionOptions = { graphOptimizationLevel: "all", intraOpNumThreads: threads };
  // The decoder is a very large graph: onnxruntime 1.31's sequential memory planner takes minutes on it,
  // the parallel executor's planner a few seconds.
  const open = (f: string, o: ort.InferenceSession.SessionOptions = opts) => ort.InferenceSession.create(path.join(dir, "onnx", f), o) as Promise<unknown> as Promise<OrtSession>;
  log("Loading the studio voice model …");
  const [embed, lm, decoder] = await Promise.all([open("embed_tokens.onnx"), open("language_model_q4_align.onnx"), open("conditional_decoder.onnx", { ...opts, executionMode: "parallel", interOpNumThreads: 1 })]);
  let enc: Promise<OrtSession> | null = null;
  // Only the rows the positions use are read from the 68 MB embedding file.
  const fd = openSync(path.join(dir, "onnx", "embed_tokens.onnx_data"), "r");
  const buf = new Uint8Array(TEXT_POS.rows * TEXT_POS.dim * 4);
  readSync(fd, buf, 0, buf.length, TEXT_POS.offset);
  closeSync(fd);
  return {
    tensor,
    embed,
    lm,
    decoder,
    encoder: () => (enc ??= open("speech_encoder.onnx")),
    tokenizer: new StudioTokenizer(await readFile(path.join(dir, "tokenizer.json"), "utf8")),
    textPos: new Float32Array(buf.buffer),
  };
}

/** Speakers are cached on disk: making one needs the 590 MB encoder and a Kokoro reference clip. */
export class SpeakerCache {
  private mem = new Map<string, Promise<Speaker>>();
  constructor(private data: string) {}
  get(key: string, make: () => Promise<Speaker>): Promise<Speaker> {
    let p = this.mem.get(key);
    if (!p) {
      p = (async () => {
        const file = path.join(this.data, "studio", "speakers", `${key}.bin`);
        if (existsSync(file)) return unpackSpeaker(new Uint8Array(await readFile(file)));
        const s = await make();
        mkdirSync(path.dirname(file), { recursive: true });
        await writeFile(file, packSpeaker(s));
        return s;
      })();
      this.mem.set(key, p);
    }
    return p;
  }
}

export { makeSpeaker };
