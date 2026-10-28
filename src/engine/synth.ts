/**
 * One job → finished audio, independent of where the model runs.
 *
 * The browser worker, the Android bridge and the Node server all call `synthesize` with their own
 * model runner, so a voice recipe (blend + pitch) and a delivery (whisper, shout…) sound the same
 * everywhere.
 */
import { colour, pitchShift, polish, SAMPLE_RATE } from "./audio";
import { hindiPhonemize } from "./hindi";
import { englishPhonemes, MAX_TOKENS, tokenize, type Phonemizer } from "./phonemes";
import { mixLang, parseMix, styleRow, type VoiceTables } from "./voicebank";
import type { Job } from "./protocol";

/** Runs Kokoro: token ids (with pads), one 256-float style row and a speed → raw 24 kHz audio. */
export type ModelRunner = (ids: number[], style: Float32Array, speed: number) => Promise<Float32Array>;

export interface SynthDeps {
  phonemize: Phonemizer;
  tables: VoiceTables;
  run: ModelRunner;
}

/** Text → phonemes for the voice's language. */
export async function phonemesFor(text: string, voice: string, phonemize: Phonemizer): Promise<string> {
  const lang = mixLang(parseMix(voice));
  if (lang === "h") return hindiPhonemize(text, async (run) => (await phonemize(run, "en-us")).join(" "));
  return englishPhonemes(text, lang, phonemize);
}

/** Apply a job's delivery to a polished clip: pitch first, then colour (gain, softness, edge). */
export function shape(pcm: Float32Array, job: Pick<Job, "pitch" | "gain" | "soft" | "edge">, sampleRate = SAMPLE_RATE): Float32Array {
  let out = pcm;
  if (job.pitch) out = pitchShift(out, job.pitch, sampleRate);
  if ((job.gain ?? 1) !== 1 || job.soft || job.edge) out = colour(out, { gain: job.gain, soft: job.soft, edge: job.edge }, sampleRate);
  return out;
}

/** Synthesize one job and return polished, delivery-shaped audio. */
export async function synthesize(job: Job, deps: SynthDeps): Promise<Float32Array> {
  const phonemes = await phonemesFor(job.text, job.voice, deps.phonemize);
  let ids = tokenize(phonemes);
  if (ids.length > MAX_TOKENS + 2) ids = [...ids.slice(0, MAX_TOKENS + 1), 0];
  const table = await deps.tables.table(job.voice);
  const raw = await deps.run(ids, styleRow(table, ids.length), job.speed);
  return shape(polish(raw, SAMPLE_RATE), job);
}

/** Where the stock voice tables live (the same files kokoro-js uses, so its browser cache is shared). */
export const VOICES_URL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices";
