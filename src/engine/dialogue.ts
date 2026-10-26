import { VOICES } from "./voices";

export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface ParsedScript {
  lines: DialogueLine[];
  /** Speakers in order of first appearance. */
  speakers: string[];
}

const SPEAKER_RE = /^\s*(?:\[([^\]\n]{1,32})\]\s*:?|([A-Za-z][\w'’. -]{0,31}?)\s*(?::(?=\s|$)|-->))\s*(.*)$/;
const NARRATOR = "Narrator";

/**
 * Parse a script written as `Name: line` or `[Name] line`. Lines without a speaker
 * continue the previous speaker, or belong to the Narrator when none has spoken yet.
 * Stage directions in (parentheses) or *asterisks* are removed from the spoken text.
 */
export function parseScript(input: string): ParsedScript {
  const lines: DialogueLine[] = [];
  const order: string[] = [];
  let current: DialogueLine | null = null;

  const open = (speaker: string, text: string) => {
    if (!order.includes(speaker)) order.push(speaker);
    current = { speaker, text };
    lines.push(current);
  };

  for (const raw of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = SPEAKER_RE.exec(line);
    const label = (m?.[1] ?? m?.[2] ?? "").trim().replace(/\s+/g, " ");
    if (m && looksLikeName(label)) {
      open(canonical(label, order), m[3] ?? "");
    } else if (current) {
      (current as DialogueLine).text += ` ${line}`;
    } else {
      open(NARRATOR, line);
    }
  }

  const cleaned = lines
    .map((l) => ({ speaker: l.speaker, text: stripDirections(l.text) }))
    .filter((l) => /[\p{L}\p{N}]/u.test(l.text));
  const speakers = order.filter((s) => cleaned.some((l) => l.speaker === s));
  return { lines: cleaned, speakers };
}

function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 32) return false;
  if (/^(?:https?|ftp)$/i.test(t)) return false;
  return /^[\p{Lu}\d]/u.test(t) && t.split(/\s+/).length <= 3;
}

/** Match speakers case-insensitively so "ANNA" and "Anna" are the same person. */
function canonical(name: string, known: string[]): string {
  return known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
}

export function stripDirections(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\*[^*\n]+\*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Assign voices alternating gender so neighbouring speakers are easy to tell apart. */
export function autoAssignVoices(speakers: string[], existing: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set(Object.values(existing));
  const order = [...VOICES].sort((a, b) => rank(a.id) - rank(b.id));
  const female = order.filter((v) => v.gender === "Female");
  const male = order.filter((v) => v.gender === "Male");
  let f = 0;
  let m = 0;
  speakers.forEach((s, i) => {
    const kept = existing[s];
    if (kept) {
      out[s] = kept;
      return;
    }
    const pool = i % 2 === 0 ? [...female, ...male] : [...male, ...female];
    const pick = pool.find((v) => !used.has(v.id)) ?? pool[(i % 2 === 0 ? f++ : m++) % pool.length]!;
    used.add(pick.id);
    out[s] = pick.id;
  });
  return out;
}

const PREFERRED = ["af_heart", "am_michael", "bf_emma", "bm_george", "af_bella", "am_fenrir", "af_nicole", "am_puck"];
function rank(id: string): number {
  const i = PREFERRED.indexOf(id);
  return i === -1 ? 100 : i;
}
