import { VOICES } from "./voices";
import { applyToText, combine, NEUTRAL, readDirection, type Delivery } from "./delivery";

/** A run of words said one way, or a vocal sound such as a laugh. */
export interface Segment {
  text: string;
  delivery: Delivery;
  sound?: boolean;
  /** Extra silence requested after this segment (from [pause] marks), in ms. */
  pauseAfterMs?: number;
}

export interface DialogueLine {
  speaker: string;
  /** The spoken words, without directions (for display and search). */
  text: string;
  segments: Segment[];
  /** Silence requested before this line (scene breaks, [pause] lines), in ms. */
  pauseBeforeMs?: number;
}

export interface CastDirective {
  /** Voice reference: stock id, preset/custom id or name, or a mix like "af_heart*0.6+am_puck*0.4". */
  voice: string;
  pitch?: number;
  speed?: number;
}

export interface ParsedScript {
  lines: DialogueLine[];
  /** Speakers in order of first appearance. */
  speakers: string[];
  /** Voices chosen inside the script with `@Name = voice` lines. */
  cast: Record<string, CastDirective>;
}

export const NARRATOR = "Narrator";
const SCENE_BREAK_MS = 1600;

// `[Name] text`, `[Name, mood] text`, `[Name|mood] text`
const BRACKET_RE = /^\s*\[([^\]\n,|(]{1,32})(?:\s*[,|]\s*([^\]\n]{1,60})|\s*\(([^)\n]{1,60})\))?\]\s*:?\s*(.*)$/;
// `Name: text`, `Name (mood): text`, `Name [mood]: text`, `Name --> text`
const LABEL_RE = /^\s*([\p{L}][\p{L}\p{N}'’. -]{0,31}?)\s*(?:\(([^)\n]{1,60})\)|\[([^\]\n]{1,60})\])?\s*(?::(?=\s|$)|-->|—(?=\s))\s*(.*)$/u;
// Screenplay character cue on its own line: `MIRA`, `MIRA (V.O.)`, `DR. KANE (whispering)`
const CUE_RE = /^\s*([\p{Lu}][\p{Lu}\p{N}'’. -]{0,31}?)\s*(?:\(([^)\n]{1,40})\))?\s*$/u;
// `@Mira = af_bella*0.6+af_heart*0.4, pitch +1, speed 1.05` or `@cast Mira: Teen girl`
const CAST_RE = /^\s*@\s*(?:cast\s+)?([^=:\n]{1,32}?)\s*[=:]\s*(.+?)\s*$/i;
const DIRECTION_RE = /\(([^()\n]{1,80})\)|\[([^[\]\n]{1,80})\]|(?<![\p{L}\p{N}*])\*([^*\n]{1,60})\*(?![\p{L}\p{N}*])/gu;
const SCREENPLAY_TAGS = /^(?:v\.?o\.?|o\.?s\.?|o\.?c\.?|cont'?d|continuing|off|on phone|over phone|into phone|on screen|filtered)$/i;
const NOT_NAMES = new Set(["note", "notes", "warning", "tip", "tips", "example", "examples", "step", "summary", "update", "edit", "ps", "p.s", "nb", "http", "https", "ftp", "scene", "int", "ext", "chapter", "part", "title", "fade in", "fade out", "cut to"]);

/**
 * Parse a script. Understands `Name: line`, `[Name] line`, moods on the label (`Mira (whispering): …`,
 * `[Jon, angry] …`), screenplay layout (an all-caps name on its own line, then the dialogue),
 * inline directions (`(laughs)`, `[pause 2s]`, `*sighs*`), scene breaks (`---`), comments
 * (`# …`, `// …`) and voice choices (`@Mira = af_bella, pitch +1`). Lines without a speaker
 * continue the previous speaker, or belong to the Narrator when none has spoken yet.
 */
export function parseScript(input: string): ParsedScript {
  const rawLines = input.replace(/\r\n?/g, "\n").split("\n");
  const lowerLabels = countLowercaseLabels(rawLines);
  const lines: DialogueLine[] = [];
  const order: string[] = [];
  const cast: Record<string, CastDirective> = {};
  type Open = { speaker: string; base: Delivery; raw: string; pauseBefore: number };
  // Held in a box so TypeScript does not narrow it across the helper closures that reset it.
  const st: { current: Open | null } = { current: null };
  let cueSpeaker: { name: string; mood: Delivery } | null = null;
  let pendingPause = 0;
  let pendingMood: Delivery | null = null;

  const close = () => {
    if (!st.current) return;
    const segs = segmentText(st.current.raw, st.current.base, false);
    const text = segs.filter((s) => !s.sound).map((s) => s.text).join(" ").replace(/\s{2,}/g, " ").trim();
    if (segs.some((s) => /[\p{L}\p{N}]/u.test(s.text))) {
      if (!order.includes(st.current.speaker)) order.push(st.current.speaker);
      lines.push({ speaker: st.current.speaker, text, segments: segs, ...(st.current.pauseBefore ? { pauseBeforeMs: st.current.pauseBefore } : {}) });
    } else if (st.current.pauseBefore || segs.some((s) => s.pauseAfterMs)) {
      pendingPause += st.current.pauseBefore + segs.reduce((n, s) => n + (s.pauseAfterMs ?? 0), 0);
    }
    st.current = null;
  };
  const open = (speaker: string, mood: Delivery, text: string) => {
    close();
    st.current = { speaker: canonical(speaker, order), base: mood, raw: text, pauseBefore: pendingPause };
    pendingPause = 0;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line) {
      // A blank line ends a screenplay speech.
      if (cueSpeaker && st.current) close();
      cueSpeaker = null;
      continue;
    }
    if (/^(?:#|\/\/)/.test(line)) continue;
    if (/^(?:-{3,}|\*{3,}|={3,}|_{3,})$/.test(line) || /^\[(?:scene|scene break|new scene)\]$/i.test(line)) {
      close();
      cueSpeaker = null;
      pendingPause += SCENE_BREAK_MS;
      continue;
    }
    const castM = CAST_RE.exec(line);
    if (castM) {
      const name = canonical(castM[1]!.trim(), order);
      cast[name] = parseCastValue(castM[2]!);
      // Register the spelling now so "KABIR" cues later match "@Kabir = …" (speakers without lines are dropped at the end).
      if (!order.includes(name)) order.push(name);
      continue;
    }
    // A line that is only a direction: "(beat)", "[pause 2s]", "(whispering)", "*laughs*".
    const only = /^(?:\(([^()\n]+)\)|\[([^[\]\n]+)\]|\*([^*\n]+)\*)$/.exec(line);
    if (only) {
      const dirs = readDirection(only[1] ?? only[2] ?? only[3] ?? "");
      if (dirs.length && !(dirs.length === 1 && dirs[0]!.kind === "action" && /^[\p{Lu}]/u.test(only[2] ?? "") && only[2] !== undefined && looksLikeName(only[2]))) {
        for (const d of dirs) {
          if (d.kind === "pause") {
            if (st.current) st.current.raw += ` [pause ${d.ms}ms]`;
            else pendingPause += d.ms;
          } else if (d.kind === "style") {
            if (st.current && cueSpeaker) {
              close();
              pendingMood = d.delivery;
            } else if (st.current) st.current.raw += ` (${only[1] ?? only[2] ?? only[3]})`;
            else pendingMood = d.delivery;
          } else if (d.kind === "sound") {
            const who = st.current?.speaker ?? cueSpeaker?.name;
            if (st.current) st.current.raw += ` (${only[1] ?? only[2] ?? only[3]})`;
            else if (who) open(who, cueSpeaker?.mood ?? NEUTRAL, `(${only[1] ?? only[2] ?? only[3]})`);
          }
        }
        continue;
      }
    }
    const br = BRACKET_RE.exec(line);
    if (br && looksLikeName(br[1]!.trim())) {
      cueSpeaker = null;
      const mood = moodOf(br[2] ?? br[3]);
      open(br[1]!.trim().replace(/\s+/g, " "), takeMood(mood), labelPrefix(br[2] ?? br[3]) + (br[4] ?? ""));
      continue;
    }
    const lb = LABEL_RE.exec(line);
    if (lb) {
      const name = lb[1]!.trim().replace(/\s+/g, " ");
      if (looksLikeName(name) || lowerLabels.has(name.toLowerCase())) {
        cueSpeaker = null;
        open(name, takeMood(moodOf(lb[2] ?? lb[3])), labelPrefix(lb[2] ?? lb[3]) + (lb[4] ?? ""));
        continue;
      }
    }
    const cue = CUE_RE.exec(line);
    const next = rawLines[i + 1]?.trim() ?? "";
    if (cue && isCueName(cue[1]!) && next && !CUE_RE.test(next)) {
      close();
      cueSpeaker = { name: cue[1]!.trim().replace(/\s+/g, " "), mood: moodOf(cue[2]) };
      pendingMood = null;
      continue;
    }
    if (cueSpeaker && !st.current) {
      open(cueSpeaker.name, takeMood(cueSpeaker.mood), line);
    } else if (st.current) {
      st.current.raw += ` ${line}`;
    } else {
      open(NARRATOR, takeMood(NEUTRAL), line);
    }
  }
  close();
  if (pendingPause && lines.length) {
    const last = lines[lines.length - 1]!;
    const seg = last.segments[last.segments.length - 1]!;
    seg.pauseAfterMs = (seg.pauseAfterMs ?? 0) + pendingPause;
  }
  const speakers = order.filter((s) => lines.some((l) => l.speaker === s));
  return { lines, speakers, cast };

  function takeMood(m: Delivery): Delivery {
    const out = pendingMood ? combine([m, pendingMood]) : m;
    pendingMood = null;
    return out;
  }
}

/** Turn a mood label like "whispering" or "nervous, quietly" into a delivery (screenplay tags are ignored). */
/** Sounds and pauses written on a label ("Tara (laughs): …") are performed at the start of the line. */
function labelPrefix(label: string | undefined): string {
  if (!label) return "";
  return label
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter((p) => p && readDirection(p).some((d) => d.kind === "sound" || d.kind === "pause"))
    .map((p) => `(${p}) `)
    .join("");
}

function moodOf(label: string | undefined): Delivery {
  if (!label) return NEUTRAL;
  const parts = label.split(/[,;/]/).map((s) => s.trim()).filter((s) => s && !SCREENPLAY_TAGS.test(s));
  const ds: Delivery[] = [];
  for (const p of parts) for (const d of readDirection(p)) if (d.kind === "style") ds.push(d.delivery);
  return ds.length ? combine(ds) : NEUTRAL;
}

/**
 * Split words around inline directions. `base` is the line's delivery; a style direction changes the
 * delivery of the words that follow it, a sound is spoken where it appears, a pause adds silence.
 * With `keepUnknown`, parentheses that are not directions stay in the text (prose asides).
 */
export function segmentText(raw: string, base: Delivery = NEUTRAL, keepUnknown = false): Segment[] {
  const segs: Segment[] = [];
  let mood = base;
  let buf = "";
  let last = 0;
  const flush = () => {
    const t = buf.replace(/\s{2,}/g, " ").trim();
    buf = "";
    if (!/[\p{L}\p{N}]/u.test(t)) return;
    segs.push({ text: applyToText(t, mood), delivery: mood });
  };
  for (const m of raw.matchAll(DIRECTION_RE)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? "";
    const dirs = readDirection(inner);
    const before = raw.slice(last, m.index);
    last = m.index! + m[0].length;
    if (dirs.length === 1 && dirs[0]!.kind === "action") {
      buf += before + (keepUnknown && m[1] !== undefined ? m[0] : " ");
      continue;
    }
    buf += before;
    for (const d of dirs) {
      if (d.kind === "pause") {
        flush();
        const target = segs[segs.length - 1];
        if (target) target.pauseAfterMs = (target.pauseAfterMs ?? 0) + d.ms;
        else segs.push({ text: "", delivery: mood, pauseAfterMs: d.ms });
      } else if (d.kind === "style") {
        flush();
        mood = d.delivery.tags.some((t) => base.tags.includes(t)) ? base : combine([base, d.delivery]);
      } else if (d.kind === "reset") {
        flush();
        mood = base;
      } else if (d.kind === "sound") {
        flush();
        segs.push({ text: d.say, delivery: combine([mood, d.delivery]), sound: true });
      }
    }
  }
  buf += raw.slice(last);
  flush();
  return segs;
}

/** The value of an `@Name = …` line: a voice reference plus optional pitch and speed. */
export function parseCastValue(v: string): CastDirective {
  const parts = v.split(/\s*,\s*/);
  const out: CastDirective = { voice: parts[0]!.trim() };
  for (const p of parts.slice(1)) {
    const m = /^(pitch|speed|pace)\s*[:=]?\s*([+-]?[\d.]+)\s*(st|x|×)?$/i.exec(p.trim());
    if (!m) continue;
    const n = parseFloat(m[2]!);
    if (/pitch/i.test(m[1]!)) out.pitch = Math.max(-6, Math.min(6, n));
    else out.speed = Math.max(0.7, Math.min(1.4, n));
  }
  return out;
}

function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 32) return false;
  if (NOT_NAMES.has(t.toLowerCase())) return false;
  return /^[\p{Lu}\d]/u.test(t) && t.split(/\s+/).length <= 3;
}

function isCueName(s: string): boolean {
  const t = s.trim();
  if (!looksLikeName(t) || t.length < 2) return false;
  // Screenplay cues are written in capitals; "Hello" alone on a line is dialogue, not a name.
  return t === t.toUpperCase() && /\p{Lu}{2}/u.test(t);
}

/** Lower-case labels ("mom: …") count as speakers only when they are used at least twice. */
function countLowercaseLabels(lines: string[]): Set<string> {
  const n = new Map<string, number>();
  for (const l of lines) {
    const m = /^\s*([\p{Ll}][\p{L}'’ -]{0,20}?)\s*:\s+\S/u.exec(l);
    if (!m) continue;
    const k = m[1]!.trim().toLowerCase();
    if (NOT_NAMES.has(k) || k.split(/\s+/).length > 2) continue;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c >= 2).map(([k]) => k));
}

/** Match speakers case-insensitively so "ANNA" and "Anna" are the same person. */
function canonical(name: string, known: string[]): string {
  return known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
}

export function stripDirections(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\*[^*\n]+\*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Assign voices alternating gender so neighbouring speakers are easy to tell apart. */
export function autoAssignVoices(speakers: string[], existing: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set(Object.values(existing));
  const order = [...VOICES].filter((v) => v.lang === "en").sort((a, b) => rank(a.id) - rank(b.id));
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
