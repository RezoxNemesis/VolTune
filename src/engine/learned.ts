/**
 * Learned voices and acted emotions.
 *
 * A Kokoro voice is a style table: 510 rows × 256 numbers. The first 128 numbers of a row set the timbre (how the
 * voice sounds); the last 128 drive the prosody predictor (how it speaks: word lengths, pauses, melody, effort).
 *
 * Learned voices keep that split. Their timbre is a blend of stock voices; their delivery is a blend of stock
 * voices plus an offset learned from real performances (tools/voicefit): word timings, pitch and energy of
 * recorded narrators were forced into the model and the 128 delivery numbers were fitted to them. The tables are
 * built on the device from the stock tables, so a learned voice behaves exactly like a stock one: use its id
 * anywhere, blend it, put it in a VT1 code.
 *
 * Emotions work the same way: each mood is a learned direction in the delivery half, shared by every voice, so the
 * model itself performs the line sad, angry or excited (its own timing, melody and effort) instead of the audio
 * being pitch-shifted afterwards.
 */
import { EMOTION_DATA, LEARNED_DATA } from "./learned_data";

export const STYLE_ROWS = 510;
export const STYLE_DIM = 256;
export const HALF = 128;

/** How a voice phrases text: pause lengths (ms) and where it breaks. */
export interface Phrasing {
  /** Pause after a comma or clause. */
  comma: number;
  /** Pause after a sentence. */
  end: number;
  /** Pause at a line break inside a paragraph (poetry). Defaults to `comma`. */
  line?: number;
  /** Say every comma-separated phrase on its own, with a real pause (poetry narrators do). */
  breakCommas?: boolean;
  /** Treat single line breaks as phrase breaks. */
  lines?: boolean;
}

/** VolTune's default phrasing, for stock voices. */
export const DEFAULT_PHRASING: Phrasing = Object.freeze({ comma: 190, end: 380 });

export interface LearnedVoice {
  id: string;
  name: string;
  gender: "Female" | "Male";
  tone: string;
  /** Stock voices for the timbre half, e.g. "hm_omega*0.6+bm_fable*0.4". */
  timbre: string;
  /** Stock voices for the delivery half before the learned offset. */
  delivery: string;
  /** 128 float16 numbers, base64: the learned delivery offset. */
  offset: string;
  phrasing: Phrasing;
  /** What the delivery was learned from, in words. */
  learnedFrom: string;
  /** Singing range in MIDI notes (the model's pitch breaks above about 360 Hz). */
  sing?: [number, number];
}

export const MOODS = ["happy", "excited", "sad", "crying", "angry", "scared", "loving", "surprised", "serious", "tired", "pleading"] as const;
export type Mood = (typeof MOODS)[number];
export const isMood = (s: unknown): s is Mood => typeof s === "string" && (MOODS as readonly string[]).includes(s);

export const LEARNED: readonly LearnedVoice[] = LEARNED_DATA;
const BY_ID = new Map(LEARNED.map((v) => [v.id, v]));

export function learnedVoice(id: string): LearnedVoice | undefined {
  return BY_ID.get(id);
}

export function isLearnedVoice(id: string): boolean {
  return BY_ID.has(id);
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** base64 of little-endian float16 values → Float32Array. */
export function decodeHalfs(b64: string): Float32Array {
  const bin = atob(b64);
  const out = new Float32Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = halfToFloat(bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8));
  return out;
}

const offsets = new Map<string, Float32Array>();
function cached(key: string, b64: string): Float32Array {
  let o = offsets.get(key);
  if (!o) {
    o = decodeHalfs(b64);
    if (o.length !== HALF) throw new Error(`Learned data "${key}" has ${o.length} numbers, expected ${HALF}.`);
    offsets.set(key, o);
  }
  return o;
}

/** The learned offset of a voice's delivery half. */
export function voiceOffset(v: LearnedVoice): Float32Array {
  return cached(`v:${v.id}`, v.offset);
}

/** The delivery-half direction of a mood. */
export function moodOffset(m: Mood): Float32Array {
  return cached(`m:${m}`, EMOTION_DATA[m]);
}

/** "a*0.6+b*0.4" (stock ids only) → [[id, weight]], weights normalised. */
export function parseStockMix(expr: string): Array<[string, number]> {
  const parts = expr.split("+").map((p) => {
    const [id, w] = p.trim().split("*");
    return [id!.trim(), w === undefined ? 1 : Number(w)] as [string, number];
  });
  const total = parts.reduce((n, [, w]) => n + w, 0);
  return parts.map(([id, w]) => [id, w / total]);
}

/** Build a learned voice's table from stock tables. */
export async function buildLearnedTable(v: LearnedVoice, stock: (id: string) => Promise<Float32Array>): Promise<Float32Array> {
  const timbre = parseStockMix(v.timbre);
  const delivery = parseStockMix(v.delivery);
  const tabs = new Map<string, Float32Array>();
  await Promise.all([...new Set([...timbre, ...delivery].map(([id]) => id))].map(async (id) => tabs.set(id, await stock(id))));
  const n = STYLE_ROWS * STYLE_DIM;
  const out = new Float32Array(n);
  const off = voiceOffset(v);
  for (let r = 0; r < STYLE_ROWS; r++) {
    const base = r * STYLE_DIM;
    for (const [id, w] of timbre) {
      const t = tabs.get(id)!;
      for (let j = 0; j < HALF; j++) out[base + j]! += t[base + j]! * w;
    }
    for (const [id, w] of delivery) {
      const t = tabs.get(id)!;
      for (let j = HALF; j < STYLE_DIM; j++) out[base + j]! += t[base + j]! * w;
    }
    for (let j = 0; j < HALF; j++) out[base + HALF + j]! += off[j]!;
  }
  return out;
}

/** A copy of a table with a mood applied to every row's delivery half. */
export function applyMood(table: Float32Array, mood: Mood, amount = 1): Float32Array {
  const out = table.slice();
  const d = moodOffset(mood);
  const k = Math.max(0, Math.min(2, amount));
  for (let r = 0; r < out.length / STYLE_DIM; r++) {
    const base = r * STYLE_DIM + HALF;
    for (let j = 0; j < HALF; j++) out[base + j]! += d[j]! * k;
  }
  return out;
}

/** Phrasing for a blend: learned voices bring their own; stock voices bring VolTune's default. */
export function phrasingFor(mix: ReadonlyArray<readonly [string, number]>): Phrasing | undefined {
  if (!mix.some(([id]) => BY_ID.has(id))) return undefined;
  let comma = 0, end = 0, line = 0;
  for (const [id, w] of mix) {
    const p = BY_ID.get(id)?.phrasing ?? DEFAULT_PHRASING;
    comma += p.comma * w;
    end += p.end * w;
    line += (p.line ?? p.comma) * w;
  }
  const lead = BY_ID.get(mix[0]![0])?.phrasing;
  return { comma: Math.round(comma), end: Math.round(end), line: Math.round(line), breakCommas: lead?.breakCommas, lines: lead?.lines };
}

/** Pause after a chunk for a voice's phrasing; `base` is VolTune's default pause for that chunk. */
export function phrasePause(text: string, base: number, p: Phrasing): number {
  const t = text.trimEnd();
  if (base >= 720) return Math.max(base, Math.round(p.end * 1.4));
  if (/(\.\.\.|…)["')\]]?$/.test(t)) return Math.round(p.end * 1.25);
  if (/[?!]["')\]]?$/.test(t)) return Math.round(p.end * 1.05);
  if (/[.।॥]["')\]]?$/.test(t)) return p.end;
  if (/[,;:—–-]["')\]]?$/.test(t)) return p.comma;
  return p.line ?? p.comma;
}
