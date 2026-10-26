export interface Voice {
  id: string;
  name: string;
  accent: "US" | "UK";
  gender: "Female" | "Male";
  /** One-line character description shown in the picker. */
  tone: string;
}

/** Curated Kokoro-82M voices. Lower-graded voices from the upstream set are left out on purpose. */
export const VOICES: readonly Voice[] = [
  { id: "af_heart", name: "Heart", accent: "US", gender: "Female", tone: "Warm, expressive" },
  { id: "af_bella", name: "Bella", accent: "US", gender: "Female", tone: "Bright, lively" },
  { id: "af_nicole", name: "Nicole", accent: "US", gender: "Female", tone: "Soft, intimate" },
  { id: "af_sarah", name: "Sarah", accent: "US", gender: "Female", tone: "Clear, friendly" },
  { id: "af_aoede", name: "Aoede", accent: "US", gender: "Female", tone: "Smooth, melodic" },
  { id: "af_kore", name: "Kore", accent: "US", gender: "Female", tone: "Calm, steady" },
  { id: "bf_emma", name: "Emma", accent: "UK", gender: "Female", tone: "Poised, articulate" },
  { id: "bf_isabella", name: "Isabella", accent: "UK", gender: "Female", tone: "Gentle, refined" },
  { id: "am_michael", name: "Michael", accent: "US", gender: "Male", tone: "Grounded, natural" },
  { id: "am_fenrir", name: "Fenrir", accent: "US", gender: "Male", tone: "Deep, resonant" },
  { id: "am_puck", name: "Puck", accent: "US", gender: "Male", tone: "Playful, energetic" },
  { id: "bm_george", name: "George", accent: "UK", gender: "Male", tone: "Measured, authoritative" },
  { id: "bm_fable", name: "Fable", accent: "UK", gender: "Male", tone: "Storyteller" },
] as const;

export const DEFAULT_VOICE = "af_heart";

export function getVoice(id: string): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0]!;
}

export function isVoiceId(id: string): boolean {
  return VOICES.some((v) => v.id === id);
}
