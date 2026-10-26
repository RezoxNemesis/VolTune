/**
 * Text preparation. The goal is speech that breathes: clean input, sentence-sized
 * chunks the model handles well, and a pause after each chunk that matches its punctuation.
 */

export const MAX_CHARS = 20_000;
/** Kokoro handles ~510 tokens per pass; staying near 220 characters keeps prosody natural and latency low. */
export const MAX_CHUNK_CHARS = 220;

export interface Chunk {
  text: string;
  /** Silence to insert after this chunk, in milliseconds. */
  pauseMs: number;
}

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bDr\.(?=\s)/g, "Doctor"],
  [/\bMr\.(?=\s)/g, "Mister"],
  [/\bMrs\.(?=\s)/g, "Missus"],
  [/\bMs\.(?=\s)/g, "Miss"],
  [/\bProf\.(?=\s)/g, "Professor"],
  [/\bSt\.(?=\s[A-Z])/g, "Saint"],
  [/\bvs\.(?=\s)/g, "versus"],
  [/\be\.g\.(?=[\s,])/g, "for example"],
  [/\bi\.e\.(?=[\s,])/g, "that is"],
  [/\betc\.(?=\s+[a-z])/g, "etcetera"],
  [/&/g, " and "],
  [/%/g, " percent"],
];

/** Tokens that end with a period but do not end a sentence. */
const NON_TERMINAL = /\b(?:Doctor|Mister|Missus|Miss|Professor|Saint|Mr|Mrs|Ms|Dr|Prof|St|vs|No|Jr|Sr)\.$/;

/** Strip markup and normalise characters so the phonemizer only sees speakable text. */
export function normalize(input: string): string {
  let t = input.normalize("NFC");
  t = t
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " link ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?;:]|$)/g, "$1$2")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  t = t
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\1{3,}/g, "$1$1$1");
  return t.trim();
}

/** Pause (ms) following a chunk, based on how it ends. */
export function pauseAfter(text: string, paragraphEnd: boolean): number {
  const trimmed = text.trimEnd();
  let ms: number;
  if (/\.\.\.["')\]]?$/.test(trimmed)) ms = 520;
  else if (/\?["')\]]?$/.test(trimmed)) ms = 440;
  else if (/!["')\]]?$/.test(trimmed)) ms = 400;
  else if (/[.]["')\]]?$/.test(trimmed)) ms = 380;
  else if (/[:;—–-]["')\]]?$/.test(trimmed)) ms = 260;
  else if (/,["')\]]?$/.test(trimmed)) ms = 190;
  else ms = 300;
  return paragraphEnd ? Math.max(ms, 720) : ms;
}

/** Split into sentences without breaking on abbreviations, initials, decimals or domains. */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i]!;
    if (c !== "." && c !== "!" && c !== "?") continue;
    let j = i;
    while (j + 1 < paragraph.length && /[.!?]/.test(paragraph[j + 1]!)) j++;
    let k = j;
    while (k + 1 < paragraph.length && /["')\]]/.test(paragraph[k + 1]!)) k++;
    const atEnd = k + 1 >= paragraph.length;
    // "3.5", "example.com": a terminator glued to the next character is not a sentence end.
    if (!atEnd && !/\s/.test(paragraph[k + 1]!)) {
      i = k;
      continue;
    }
    const candidate = paragraph.slice(start, k + 1).trimEnd();
    if (!atEnd && c === "." && j === i && (NON_TERMINAL.test(candidate) || /(?:^|\s)[A-Z]\.$/.test(candidate))) {
      i = k;
      continue;
    }
    if (candidate.trim()) out.push(candidate.trim());
    start = k + 1;
    i = k;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Break an over-long sentence at clause boundaries, then at word boundaries as a last resort. */
export function splitLong(sentence: string, max = MAX_CHUNK_CHARS): string[] {
  if (sentence.length <= max) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
    if (cut < max * 0.35) cut = window.lastIndexOf(" ");
    const hasBreak = cut >= 1;
    if (!hasBreak) cut = max;
    // Clause breaks keep their punctuation; a hard cut falls exactly on the limit.
    const end = !hasBreak ? max : rest[cut] === " " ? cut : cut + 1;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

/** Merge very short neighbouring sentences so the voice keeps a conversational rhythm. */
function mergeShort(sentences: string[], max: number): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.length < 28 && /[.!?]["')\]]?$/.test(prev) === false) {
      out[out.length - 1] = `${prev} ${s}`;
    } else if (prev !== undefined && prev.length + s.length < 70 && prev.length < 40 && s.length < 40 && /[.]$/.test(prev)) {
      out[out.length - 1] = `${prev} ${s}`;
    } else out.push(s);
  }
  return out.flatMap((s) => splitLong(s, max));
}

/** Turn arbitrary text into speakable chunks with pause lengths. */
export function toChunks(input: string, max = MAX_CHUNK_CHARS): Chunk[] {
  const text = normalize(input);
  if (!text) return [];
  const chunks: Chunk[] = [];
  const paragraphs = text.split(/\n{2,}/);
  paragraphs.forEach((para, pi) => {
    const flat = para.replace(/\n/g, " ").trim();
    if (!flat) return;
    const pieces = mergeShort(splitSentences(flat), max).filter((p) => /[\p{L}\p{N}]/u.test(p));
    pieces.forEach((piece, i) => {
      const last = i === pieces.length - 1;
      const paragraphEnd = last && pi < paragraphs.length - 1;
      chunks.push({ text: piece, pauseMs: pauseAfter(piece, paragraphEnd) });
    });
  });
  return chunks;
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}

/** Rough spoken duration in seconds (~155 wpm at speed 1). */
export function estimateSeconds(text: string, speed = 1): number {
  return (countWords(text) / 155) * 60 / Math.max(0.5, speed);
}
