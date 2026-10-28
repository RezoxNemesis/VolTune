/** Custom voices kept on the server (a JSON file in the data folder). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./engine";
import {
  BASE_VOICES,
  PRESETS,
  decodeVoiceCode,
  describeRecipe,
  encodeVoiceCode,
  isBaseVoice,
  makeRecipe,
  parseMix,
  slug,
  type CustomVoice,
} from "../../src/engine/voicebank";
import { VOICES } from "../../src/engine/voices";

const file = () => path.join(dataDir(), "voices.json");

export function loadCustoms(): CustomVoice[] {
  try {
    if (!existsSync(file())) return [];
    const list = JSON.parse(readFileSync(file(), "utf8")) as CustomVoice[];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.id === "string" && v.recipe?.mix) : [];
  } catch {
    return [];
  }
}

function save(list: CustomVoice[]) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(list, null, 2));
}

export interface NewVoice {
  name: string;
  /** Blend expression, e.g. "af_heart*0.6+am_puck*0.4", or a single stock id. */
  mix: string;
  pitch?: number;
  speed?: number;
  gender?: "Female" | "Male";
  accent?: "US" | "UK" | "India";
  tone?: string;
}

export function createVoice(v: NewVoice): CustomVoice {
  const mix = parseMix(v.mix);
  if (!mix.length) throw new Error(`No usable stock voices in "${v.mix}". Stock voices: ${BASE_VOICES.join(", ")}`);
  const first = mix[0]![0];
  const list = loadCustoms();
  const id = `my_${slug(v.name)}`;
  const voice: CustomVoice = {
    id,
    name: v.name.trim().slice(0, 40) || "Custom voice",
    gender: v.gender ?? (first[1] === "m" ? "Male" : "Female"),
    accent: v.accent ?? (first[0] === "b" ? "UK" : first[0] === "h" ? "India" : "US"),
    tone: v.tone?.slice(0, 60) ?? "Custom",
    recipe: makeRecipe({ mix, pitch: v.pitch, speed: v.speed }),
  };
  save([...list.filter((x) => x.id !== id), voice]);
  return voice;
}

export function importVoice(code: string): CustomVoice {
  const v = decodeVoiceCode(code);
  const id = `my_${slug(v.name)}`;
  const voice = { ...v, id };
  save([...loadCustoms().filter((x) => x.id !== id), voice]);
  return voice;
}

export function deleteVoice(ref: string): boolean {
  const list = loadCustoms();
  const keep = list.filter((v) => v.id !== ref && v.name.toLowerCase() !== ref.toLowerCase());
  save(keep);
  return keep.length !== list.length;
}

export function findAny(ref: string): CustomVoice | undefined {
  const t = ref.trim().toLowerCase();
  return [...loadCustoms(), ...PRESETS].find((v) => v.id.toLowerCase() === t || v.name.toLowerCase() === t);
}

export function voiceCode(ref: string): string {
  const v = findAny(ref);
  if (v) return encodeVoiceCode(v);
  if (isBaseVoice(ref)) {
    const s = VOICES.find((x) => x.id === ref)!;
    return encodeVoiceCode({ name: s.name, gender: s.gender as CustomVoice["gender"], accent: s.accent as CustomVoice["accent"], tone: s.tone, recipe: makeRecipe({ mix: [[ref, 1]] }) });
  }
  throw new Error(`No voice called "${ref}".`);
}

export function catalogue() {
  return {
    stock: VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent, tone: v.tone })),
    presets: PRESETS.map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent, tone: v.tone, recipe: describeRecipe(v.recipe) })),
    custom: loadCustoms().map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent, tone: v.tone, recipe: describeRecipe(v.recipe), code: encodeVoiceCode(v) })),
  };
}
