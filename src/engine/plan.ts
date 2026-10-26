import { autoAssignVoices, parseScript } from "./dialogue";
import { splitLong, toChunks } from "./text";

export interface PlanItem {
  text: string;
  /** Silence after this item, in milliseconds. */
  pauseMs: number;
  voice: string;
  speed: number;
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

export function buildPlan(input: string, o: PlanOptions): { items: PlanItem[]; cast: Record<string, string> } {
  let items: PlanItem[] = [];
  let cast = o.cast;
  if (o.mode === "speak") {
    items = toChunks(input).map((c) => ({ text: c.text, pauseMs: c.pauseMs, voice: o.voice, speed: o.speed, turn: 0 }));
  } else {
    const { lines, speakers } = parseScript(input);
    cast = autoAssignVoices(speakers, o.cast);
    lines.forEach((line, turn) => {
      const chunks = toChunks(line.text);
      chunks.forEach((c, i) => {
        const last = i === chunks.length - 1;
        items.push({
          text: c.text,
          // A beat of silence when the speaker changes keeps exchanges from feeling clipped.
          pauseMs: last && turn < lines.length - 1 ? Math.max(c.pauseMs, 520) : c.pauseMs,
          voice: cast[line.speaker] ?? o.voice,
          speed: o.speed,
          speaker: line.speaker,
          turn,
        });
      });
    });
  }
  items = items.map((it, i) => ({ ...it, pauseMs: Math.round(it.pauseMs * o.pauseScale * (it.pauseMs >= 300 ? jitter(i) : 1)) }));
  return { items: quickStart(items, o.pauseScale), cast };
}
