import { autoAssignVoices, parseScript, segmentText, type Segment } from "./dialogue";
import { splitLong, toChunks } from "./text";
import { devanagariShare } from "./hindi";
import { hindiVoiceFor, isHindiVoice } from "./voices";
import { NEUTRAL } from "./delivery";
import { PRESETS, resolveVoice, type CustomVoice } from "./voicebank";

export interface PlanItem {
  text: string;
  /** Silence after this item, in milliseconds. */
  pauseMs: number;
  /** Voice for the engine: a stock id or a mix expression ("af_heart*0.6+am_puck*0.4"). */
  voice: string;
  speed: number;
  /** Pitch shift in semitones (voice recipe + delivery). */
  pitch?: number;
  /** Delivery colour applied after synthesis. */
  gain?: number;
  soft?: number;
  edge?: number;
  /** Delivery marks that shaped this item, e.g. ["whisper"]. */
  tags?: string[];
  speaker?: string;
  /** Which speaker turn (or 0 for plain narration) the item belongs to. */
  turn: number;
}

export interface PlanOptions {
  mode: "speak" | "dialogue";
  speed: number;
  /** Multiplier for pauses: below 1 is brisker, above 1 is more relaxed. */
  pauseScale: number;
  voice: string;
  cast: Record<string, string>;
  /** The person's own voices (Voice Lab). Presets are always available. */
  customs?: readonly CustomVoice[];
}

/** Small, repeatable variation so long narration does not feel metronomic. Range 0.93 to 1.07. */
export function jitter(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x);
  return 0.93 + frac * 0.14;
}

const FIRST_MAX = 110;

/** Make the first item short so audio starts sooner; later items keep their natural phrase length. */
export function quickStart(items: PlanItem[], pauseScale: number, max = FIRST_MAX): PlanItem[] {
  const first = items[0];
  if (!first || first.text.length <= max) return items;
  const pieces = splitLong(first.text, Math.round(max * 0.9));
  if (pieces.length < 2) return items;
  const head: PlanItem[] = pieces.map((text, k) => ({
    ...first,
    text,
    pauseMs: k === pieces.length - 1 ? first.pauseMs : Math.round(180 * pauseScale),
  }));
  return [...head, ...items.slice(1)];
}

/**
 * Pick a voice that can read the text. Devanagari needs a Hindi voice. A Hindi voice keeps its own
 * timbre for English lines too (spoken with Indian English pronunciation), so an Indian voice never
 * switches to a US voice mid-script.
 */
export function voiceForText(voice: string, text: string): string {
  const share = devanagariShare(text);
  const isMix = voice.includes("+") || voice.includes("*");
  const hindi = isMix ? voice.startsWith("h") : isHindiVoice(voice);
  const male = isMix ? voice[1] === "m" : undefined;
  if (share >= 0.3 && !hindi) return isMix ? (male ? "hm_omega" : "hf_alpha") : hindiVoiceFor(voice);
  return voice;
}

/** Look up a voice by id, mix expression, or by a preset's or custom voice's display name ("Teen girl"). */
export function lookupVoiceRef(ref: string, customs: readonly CustomVoice[]): string {
  const t = ref.trim();
  const byName = [...customs, ...PRESETS].find((v) => v.name.toLowerCase() === t.toLowerCase() || v.id === t);
  return byName ? byName.id : t;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** `before` is the item spoken just before this run; a pause at the very start is added to its silence. */
function itemsFor(
  segs: readonly Segment[],
  ref: string,
  o: PlanOptions,
  extra: { pitch?: number; speed?: number },
  meta: { speaker?: string; turn: number },
  before?: PlanItem,
): PlanItem[] {
  const v = resolveVoice(ref, o.customs ?? []);
  const out: PlanItem[] = [];
  for (const seg of segs) {
    if (!seg.text) {
      const prev = out[out.length - 1] ?? before;
      if (prev && seg.pauseAfterMs) prev.pauseMs += seg.pauseAfterMs;
      continue;
    }
    const d = seg.delivery ?? NEUTRAL;
    const chunks = seg.sound ? [{ text: seg.text, pauseMs: 160 }] : toChunks(seg.text);
    chunks.forEach((c, i) => {
      const last = i === chunks.length - 1;
      out.push({
        text: c.text,
        pauseMs: Math.round(c.pauseMs * d.pause) + (last ? seg.pauseAfterMs ?? 0 : 0),
        voice: voiceForText(v.mix, c.text),
        speed: r2(Math.min(1.6, Math.max(0.55, o.speed * v.speed * (extra.speed ?? 1) * d.speed))),
        pitch: r2(v.pitch + (extra.pitch ?? 0) + d.pitch),
        gain: r2(d.gain),
        soft: r2(d.soft),
        edge: r2(d.edge),
        tags: d.tags.length ? [...d.tags] : undefined,
        speaker: meta.speaker,
        turn: meta.turn,
      });
    });
  }
  return out.map((it) => compact(it));
}

/** Drop neutral fields so plans (and their hashes) for plain text stay exactly as before. */
function compact(it: PlanItem): PlanItem {
  const o: PlanItem = { ...it };
  if (!o.pitch) delete o.pitch;
  if (o.gain === 1 || o.gain === undefined) delete o.gain;
  if (!o.soft) delete o.soft;
  if (!o.edge) delete o.edge;
  if (!o.tags) delete o.tags;
  if (o.speaker === undefined) delete o.speaker;
  return o;
}

export function buildPlan(input: string, o: PlanOptions): { items: PlanItem[]; cast: Record<string, string> } {
  let items: PlanItem[] = [];
  let cast = o.cast;
  const customs = o.customs ?? [];
  if (o.mode === "speak") {
    const paragraphs = input.replace(/\r\n?/g, "\n").split(/\n{2,}/);
    paragraphs.forEach((para, pi) => {
      // Markdown links read as their label; segmentText keeps *emphasis* words in narration.
      const segs = segmentText(para.replace(/\[([^\]\n]+)\]\((?:[^()\s]+)\)/g, "$1"), NEUTRAL, true);
      const its = itemsFor(segs, o.voice, o, {}, { turn: 0 }, items[items.length - 1]);
      const lastItem = its[its.length - 1];
      if (lastItem && pi < paragraphs.length - 1) lastItem.pauseMs = Math.max(lastItem.pauseMs, 720);
      items.push(...its);
    });
  } else {
    const parsed = parseScript(input);
    const fromScript: Record<string, string> = {};
    for (const [name, d] of Object.entries(parsed.cast)) fromScript[name] = lookupVoiceRef(d.voice, customs);
    cast = autoAssignVoices(parsed.speakers, { ...o.cast, ...fromScript });
    parsed.lines.forEach((line, turn) => {
      const directive = parsed.cast[line.speaker];
      if (line.pauseBeforeMs && items.length) items[items.length - 1]!.pauseMs += line.pauseBeforeMs;
      const its = itemsFor(line.segments, cast[line.speaker] ?? o.voice, o, { pitch: directive?.pitch, speed: directive?.speed }, { speaker: line.speaker, turn }, items[items.length - 1]);
      const last = its[its.length - 1];
      // A beat of silence when the speaker changes keeps exchanges from feeling clipped.
      if (last && turn < parsed.lines.length - 1) last.pauseMs = Math.max(last.pauseMs, 520);
      items.push(...its);
    });
  }
  items = items.map((it, i) => ({ ...it, pauseMs: Math.round(it.pauseMs * o.pauseScale * (it.pauseMs >= 300 ? jitter(i) : 1)) }));
  return { items: quickStart(items, o.pauseScale), cast };
}
