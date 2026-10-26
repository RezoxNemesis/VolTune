export interface Voice {
  id: string;
  name: string;
  accent: "US" | "UK" | "India";
  lang: "en" | "hi";
  gender: "Female" | "Male";
  /** One-line character description shown in the picker. */
  tone: string;
}

/** Curated Kokoro-82M voices. Lower-graded voices from the upstream set are left out on purpose. */
export const VOICES: readonly Voice[] = [
  { id: "af_heart", name: "Heart", accent: "US", lang: "en", gender: "Female", tone: "Warm, expressive" },
  { id: "af_bella", name: "Bella", accent: "US", lang: "en", gender: "Female", tone: "Bright, lively" },
  { id: "af_nicole", name: "Nicole", accent: "US", lang: "en", gender: "Female", tone: "Soft, intimate" },
  { id: "af_sarah", name: "Sarah", accent: "US", lang: "en", gender: "Female", tone: "Clear, friendly" },
  { id: "af_aoede", name: "Aoede", accent: "US", lang: "en", gender: "Female", tone: "Smooth, melodic" },
  { id: "af_kore", name: "Kore", accent: "US", lang: "en", gender: "Female", tone: "Calm, steady" },
  { id: "bf_emma", name: "Emma", accent: "UK", lang: "en", gender: "Female", tone: "Poised, articulate" },
  { id: "bf_isabella", name: "Isabella", accent: "UK", lang: "en", gender: "Female", tone: "Gentle, refined" },
  { id: "am_michael", name: "Michael", accent: "US", lang: "en", gender: "Male", tone: "Grounded, natural" },
  { id: "am_fenrir", name: "Fenrir", accent: "US", lang: "en", gender: "Male", tone: "Deep, resonant" },
  { id: "am_puck", name: "Puck", accent: "US", lang: "en", gender: "Male", tone: "Playful, energetic" },
  { id: "bm_george", name: "George", accent: "UK", lang: "en", gender: "Male", tone: "Measured, authoritative" },
  { id: "bm_fable", name: "Fable", accent: "UK", lang: "en", gender: "Male", tone: "Storyteller" },
  { id: "hf_alpha", name: "Alpha", accent: "India", lang: "hi", gender: "Female", tone: "हिन्दी · Clear, warm" },
  { id: "hf_beta", name: "Beta", accent: "India", lang: "hi", gender: "Female", tone: "हिन्दी · Soft, gentle" },
  { id: "hm_omega", name: "Omega", accent: "India", lang: "hi", gender: "Male", tone: "हिन्दी · Steady, deep" },
  { id: "hm_psi", name: "Psi", accent: "India", lang: "hi", gender: "Male", tone: "हिन्दी · Calm, friendly" },
] as const;

export const DEFAULT_VOICE = "af_heart";

export function getVoice(id: string): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0]!;
}

export function isVoiceId(id: string): boolean {
  return VOICES.some((v) => v.id === id);
}

export function isHindiVoice(id: string): boolean {
  return getVoice(id).lang === "hi";
}

/** The Hindi voice that best matches an English voice's gender (used when the text is in Devanagari). */
export function hindiVoiceFor(id: string): string {
  const v = VOICES.find((x) => x.id === id);
  if (v?.lang === "hi") return id;
  return v?.gender === "Male" ? "hm_omega" : "hf_alpha";
}

/** The English voice to use when text is Latin script but a Hindi voice is selected. */
export function englishVoiceFor(id: string): string {
  return getVoice(id).gender === "Male" ? "am_michael" : "af_heart";
}
