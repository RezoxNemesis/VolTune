/**
 * Voice identities beyond the stock Kokoro voices.
 *
 * Kokoro voices are style embeddings (510 × 256 floats), so a weighted average of two or three
 * of them is itself a valid, stable voice. A custom voice is just a small recipe — which stock
 * voices to mix, in what proportion, plus pitch and pace — so it is tiny to store, can be shared
 * as a short code, and renders identically in the browser, the Android app and the server.
 */

import { VOICES, getVoice } from "./voices";

/** Every stock voice shipped with Kokoro-82M v1.0 that VolTune can read (English and Hindi). */
export const BASE_VOICES: readonly string[] = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
];
const BASE = new Set(BASE_VOICES);

export const STYLE_ROWS = 510;
export const STYLE_DIM = 256;

export type Mix = Array<[string, number]>;

export interface Recipe {
  /** Stock voices and their weights (normalised to sum to 1). */
  mix: Mix;
  /** Pitch shift in semitones, -6 … +6. */
  pitch: number;
  /** Pace multiplier applied on top of the global pace, 0.7 … 1.4. */
  speed: number;
}

export interface CustomVoice {
  id: string;
  name: string;
  gender: "Female" | "Male";
  accent: "US" | "UK" | "India";
  tone: string;
  recipe: Recipe;
  /** Built-in character presets cannot be edited or deleted. */
  preset?: boolean;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function isBaseVoice(id: string): boolean {
  return BASE.has(id);
}

/** Normalise weights, drop unknown voices and zero weights, merge duplicates. Throws when nothing usable is left. */
export function normalizeMix(mix: Mix): Mix {
  const acc = new Map<string, number>();
  for (const [id, w] of mix) {
    if (!BASE.has(id) || !(w > 0) || !isFinite(w)) continue;
    acc.set(id, (acc.get(id) ?? 0) + w);
  }
  const total = [...acc.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("A voice needs at least one known stock voice with a positive weight.");
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, w]) => [id, Math.round((w / total) * 1000) / 1000]);
}

/** "af_heart*0.6+am_puck*0.4" ⇄ mix. A bare id means weight 1. */
export function parseMix(expr: string): Mix {
  const parts = expr.split("+").map((s) => s.trim()).filter(Boolean);
  const mix: Mix = parts.map((p) => {
    const m = /^([a-z]{2}_[a-z]+)\s*(?:[*x:@]\s*([\d.]+%?))?$/i.exec(p);
    if (!m) throw new Error(`Not a voice: "${p}"`);
    let w = m[2] === undefined ? 1 : parseFloat(m[2]);
    if (m[2]?.endsWith("%")) w /= 100;
    return [m[1]!.toLowerCase(), w];
  });
  return normalizeMix(mix);
}

export function mixToString(mix: Mix): string {
  if (mix.length === 1) return mix[0]![0];
  return mix.map(([id, w]) => `${id}*${+w.toFixed(3)}`).join("+");
}

/** Phonemizer accent for a mix: the dominant voice decides (a = US, b = UK, h = Hindi). */
export function mixLang(mix: Mix): "a" | "b" | "h" {
  const c = mix[0]?.[0]?.[0];
  return c === "b" ? "b" : c === "h" ? "h" : "a";
}

export function makeRecipe(r: Partial<Recipe> & { mix: Mix }): Recipe {
  return {
    mix: normalizeMix(r.mix),
    pitch: Math.round(clamp(Number(r.pitch ?? 0) || 0, -6, 6) * 10) / 10,
    speed: Math.round(clamp(Number(r.speed ?? 1) || 1, 0.7, 1.4) * 100) / 100,
  };
}

/* ---------- character presets (good starting points for animation and audio drama) ---------- */

const P = (id: string, name: string, gender: CustomVoice["gender"], accent: CustomVoice["accent"], tone: string, mix: string, pitch = 0, speed = 1): CustomVoice => ({
  id, name, gender, accent, tone, preset: true, recipe: makeRecipe({ mix: parseMix(mix), pitch, speed }),
});

export const PRESETS: readonly CustomVoice[] = [
  P("pre_teen_boy", "Teen boy", "Male", "US", "Character · young, bright", "am_puck*0.55+am_michael*0.45", 3, 1.04),
  P("pre_teen_girl", "Teen girl", "Female", "US", "Character · youthful, lively", "af_bella*0.5+af_heart*0.5", 1.8, 1.03),
  P("pre_child", "Child", "Female", "US", "Character · small, curious", "af_heart*0.7+af_nicole*0.3", 3.2, 1.05),
  P("pre_hero", "Hero", "Male", "US", "Character · confident, warm", "am_michael*0.6+am_fenrir*0.4", 0, 1),
  P("pre_heroine", "Heroine", "Female", "UK", "Character · poised, bold", "bf_emma*0.6+af_kore*0.4", 0, 1),
  P("pre_villain", "Villain", "Male", "US", "Character · low, menacing", "am_fenrir*0.75+bm_george*0.25", -2.6, 0.92),
  P("pre_elder", "Elder", "Male", "UK", "Character · aged, gentle", "bm_george*0.6+bm_fable*0.4", -1.4, 0.88),
  P("pre_grandma", "Grandma", "Female", "UK", "Character · soft, kindly", "bf_isabella*0.6+af_nicole*0.4", -0.8, 0.9),
  P("pre_narrator", "Deep narrator", "Male", "UK", "Narration · rich, unhurried", "bm_fable*0.55+am_fenrir*0.45", -1, 0.95),
  P("pre_storyteller", "Storyteller", "Female", "US", "Narration · warm, intimate", "af_heart*0.6+af_aoede*0.4", -0.4, 0.96),
  P("pre_indian_woman", "Indian woman", "Female", "India", "Indian English · warm, clear", "hf_alpha*0.6+hf_beta*0.4", 0, 0.98),
  P("pre_indian_man", "Indian man", "Male", "India", "Indian English · steady, friendly", "hm_omega*0.6+hm_psi*0.4", 0, 0.98),
  P("pre_indian_villain", "Indian villain", "Male", "India", "Hindi & Indian English · low, cold, measured", "hm_omega*0.7+hm_psi*0.3", -2.5, 0.93),
];

/** A preset or custom voice by id, or by its display name ("Teen girl", "rusty"). */
export function findVoice(id: string, customs: readonly CustomVoice[] = []): CustomVoice | undefined {
  const byId = customs.find((v) => v.id === id) ?? PRESETS.find((v) => v.id === id);
  if (byId) return byId;
  const t = id.trim().toLowerCase();
  return customs.find((v) => v.name.toLowerCase() === t) ?? PRESETS.find((v) => v.name.toLowerCase() === t);
}

export interface ResolvedVoice {
  /** Canonical mix expression sent to the speech engine. */
  mix: string;
  lang: "a" | "b" | "h";
  pitch: number;
  speed: number;
  gender: "Female" | "Male";
}

/** Any voice reference — stock id, preset/custom id, or a mix expression — to what the engine needs. */
export function resolveVoice(ref: string, customs: readonly CustomVoice[] = []): ResolvedVoice {
  const custom = findVoice(ref, customs);
  if (custom) {
    const mix = custom.recipe.mix;
    return { mix: mixToString(mix), lang: mixLang(mix), pitch: custom.recipe.pitch, speed: custom.recipe.speed, gender: custom.gender };
  }
  let mix: Mix;
  try {
    mix = parseMix(ref);
  } catch {
    mix = [[VOICES[0]!.id, 1]];
  }
  const g = mix[0]![0][1] === "m" ? "Male" : "Female";
  return { mix: mixToString(mix), lang: mixLang(mix), pitch: 0, speed: 1, gender: g };
}

export function isKnownVoiceRef(ref: string, customs: readonly CustomVoice[] = []): boolean {
  if (findVoice(ref, customs)) return true;
  try {
    parseMix(ref);
    return true;
  } catch {
    return false;
  }
}

/* ---------- style vectors ---------- */

/** Weighted sum of stock voice tables. Each table is STYLE_ROWS × STYLE_DIM floats. */
export function blendTables(tables: ReadonlyArray<{ data: Float32Array; weight: number }>): Float32Array {
  const n = tables[0]?.data.length ?? STYLE_ROWS * STYLE_DIM;
  const out = new Float32Array(n);
  for (const { data, weight } of tables) for (let i = 0; i < n; i++) out[i]! += data[i]! * weight;
  return out;
}

/** The style row Kokoro expects for an utterance of `tokenCount` ids (including the two pads). */
export function styleRow(table: Float32Array, tokenCount: number): Float32Array {
  const row = Math.min(Math.max(tokenCount - 2, 0), STYLE_ROWS - 1);
  return table.slice(row * STYLE_DIM, row * STYLE_DIM + STYLE_DIM);
}

/** Loads and caches stock tables and blends; the loader differs per platform (fetch, fs, …). */
export class VoiceTables {
  private base = new Map<string, Promise<Float32Array>>();
  private blends = new Map<string, Promise<Float32Array>>();
  constructor(private loader: (id: string) => Promise<Float32Array>) {}

  stock(id: string): Promise<Float32Array> {
    let p = this.base.get(id);
    if (!p) {
      p = this.loader(id);
      this.base.set(id, p);
      p.catch(() => this.base.delete(id));
    }
    return p;
  }

  table(mixExpr: string): Promise<Float32Array> {
    let p = this.blends.get(mixExpr);
    if (!p) {
      const mix = parseMix(mixExpr);
      p = mix.length === 1 ? this.stock(mix[0]![0]) : Promise.all(mix.map(async ([id, w]) => ({ data: await this.stock(id), weight: w }))).then(blendTables);
      this.blends.set(mixExpr, p);
      p.catch(() => this.blends.delete(mixExpr));
      if (this.blends.size > 64) this.blends.delete(this.blends.keys().next().value!);
    }
    return p;
  }
}

/* ---------- shareable voice codes ---------- */

const CODE_PREFIX = "VT1.";

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A short text code that carries a whole custom voice, e.g. to paste a voice Claude made into the app. */
export function encodeVoiceCode(v: Pick<CustomVoice, "name" | "gender" | "accent" | "tone" | "recipe">): string {
  return CODE_PREFIX + b64urlEncode(JSON.stringify({ n: v.name, g: v.gender[0], a: v.accent, t: v.tone, m: v.recipe.mix, p: v.recipe.pitch, s: v.recipe.speed }));
}

export function decodeVoiceCode(code: string, id?: string): CustomVoice {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error("That is not a VolTune voice code.");
  let o: { n?: unknown; g?: unknown; a?: unknown; t?: unknown; m?: unknown; p?: unknown; s?: unknown };
  try {
    o = JSON.parse(b64urlDecode(c.slice(CODE_PREFIX.length)));
  } catch {
    throw new Error("That voice code is damaged.");
  }
  if (!Array.isArray(o.m)) throw new Error("That voice code has no voices in it.");
  const recipe = makeRecipe({ mix: (o.m as unknown[]).map((x) => (Array.isArray(x) ? [String(x[0]), Number(x[1])] : ["", 0])) as Mix, pitch: Number(o.p), speed: Number(o.s) });
  const name = String(o.n ?? "Custom voice").slice(0, 40).trim() || "Custom voice";
  const accent = o.a === "UK" || o.a === "India" ? o.a : "US";
  return {
    id: id ?? `my_${slug(name)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    gender: o.g === "M" ? "Male" : "Female",
    accent,
    tone: String(o.t ?? "Custom").slice(0, 60),
    recipe,
  };
}

export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "voice";
}

/** Short human description of a recipe, e.g. "60% Heart + 40% Puck · +1.5 st". */
export function describeRecipe(r: Recipe): string {
  const parts = r.mix.map(([id, w]) => `${Math.round(w * 100)}% ${VOICES.some((v) => v.id === id) ? getVoice(id).name : id}`);
  const extra = [r.pitch ? `${r.pitch > 0 ? "+" : ""}${r.pitch} st` : "", r.speed !== 1 ? `${r.speed.toFixed(2)}×` : ""].filter(Boolean);
  return [parts.join(" + "), ...extra].join(" · ");
}
