import { describe, expect, it } from "vitest";
import {
  HALF,
  LEARNED,
  MOODS,
  STYLE_DIM,
  STYLE_ROWS,
  applyMood,
  buildLearnedTable,
  decodeHalfs,
  learnedVoice,
  moodOffset,
  parseStockMix,
  phrasePause,
  phrasingFor,
  voiceOffset,
} from "../src/engine/learned";
import { BASE_VOICES, VoiceTables, isBaseVoice, mixLang, parseMix, resolveVoice } from "../src/engine/voicebank";
import { VOICES } from "../src/engine/voices";
import { combine, readDirection, type Delivery } from "../src/engine/delivery";
import { splitPhrases, toChunks } from "../src/engine/text";
import { buildPlan } from "../src/engine/plan";

/** float32 → float16 bits (round to nearest), for building test data. */
function toHalf(x: number): number {
  const f = new Float32Array([x]);
  const u = new Uint32Array(f.buffer)[0]!;
  const sign = (u >>> 16) & 0x8000;
  let e = ((u >>> 23) & 0xff) - 127 + 15;
  let m = u & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  m = m + 0x1000;
  if (m & 0x800000) {
    m = 0;
    e++;
  }
  return sign | (e << 10) | (m >> 13);
}
const encode = (xs: number[]) => btoa(String.fromCharCode(...xs.flatMap((x) => [toHalf(x) & 0xff, toHalf(x) >> 8])));

/** A fake stock table: every number of voice `id` is a value that tells the voice and the half apart. */
const fakeTables = new Map<string, number>();
const loader = async (id: string) => {
  if (!fakeTables.has(id)) fakeTables.set(id, fakeTables.size + 1);
  const t = new Float32Array(STYLE_ROWS * STYLE_DIM);
  const k = fakeTables.get(id)!;
  for (let r = 0; r < STYLE_ROWS; r++) for (let j = 0; j < STYLE_DIM; j++) t[r * STYLE_DIM + j] = j < HALF ? k : 100 * k;
  return t;
};

describe("learned voice data", () => {
  it("decodes float16 offsets", () => {
    const xs = [0, 1, -1, 0.5, -0.125, 0.3333, 2.75, -3.5];
    const out = decodeHalfs(encode(xs));
    xs.forEach((x, i) => expect(out[i]).toBeCloseTo(x, 3));
  });

  it("ships learned voices with 128-number offsets and every mood", () => {
    expect(LEARNED.length).toBeGreaterThanOrEqual(8);
    for (const v of LEARNED) {
      expect(voiceOffset(v)).toHaveLength(HALF);
      expect(v.id).toMatch(/^h[fm]_[a-z]+$/);
      for (const [id] of [...parseStockMix(v.timbre), ...parseStockMix(v.delivery)]) expect(isBaseVoice(id), `${v.id} uses ${id}`).toBe(true);
      expect(Math.max(...voiceOffset(v).map(Math.abs))).toBeLessThan(5);
    }
    for (const m of MOODS) {
      expect(moodOffset(m)).toHaveLength(HALF);
      expect(Math.max(...moodOffset(m).map(Math.abs))).toBeGreaterThan(0);
    }
  });

  it("learned voices are ordinary voice ids: listed, blendable, Hindi", () => {
    for (const v of LEARNED) {
      expect(BASE_VOICES).toContain(v.id);
      expect(VOICES.find((x) => x.id === v.id)?.learned).toBe(true);
      expect(mixLang(parseMix(v.id))).toBe("h");
      expect(resolveVoice(v.id).gender).toBe(v.gender);
    }
    const a = LEARNED[0]!.id;
    expect(parseMix(`${a}*0.7+hf_alpha*0.3`)).toEqual([[a, 0.7], ["hf_alpha", 0.3]]);
  });
});

describe("learned voice tables", () => {
  it("takes the timbre half from the timbre blend and the delivery half from the delivery blend plus the offset", async () => {
    const v = LEARNED[0]!;
    const t = await buildLearnedTable(v, loader);
    const timbre = parseStockMix(v.timbre);
    const delivery = parseStockMix(v.delivery);
    const k = (id: string) => fakeTables.get(id)!;
    const expTimbre = timbre.reduce((n, [id, w]) => n + w * k(id), 0);
    const expDelivery = delivery.reduce((n, [id, w]) => n + w * 100 * k(id), 0);
    const off = voiceOffset(v);
    for (const r of [0, 100, 509]) {
      expect(t[r * STYLE_DIM + 5]).toBeCloseTo(expTimbre, 3);
      expect(t[r * STYLE_DIM + HALF + 7]).toBeCloseTo(expDelivery + off[7]!, 3);
    }
  });

  it("VoiceTables builds learned voices on demand and applies moods to the delivery half only", async () => {
    const tables = new VoiceTables(loader);
    const id = LEARNED[0]!.id;
    const plain = await tables.table(id);
    const sad = await tables.table(id, "sad", 1);
    const half = await tables.table(id, "sad", 0.5);
    const d = moodOffset("sad");
    expect(sad[3]).toBe(plain[3]);
    expect(sad[HALF + 3]).toBeCloseTo(plain[HALF + 3]! + d[3]!, 5);
    expect(half[HALF + 3]).toBeCloseTo(plain[HALF + 3]! + d[3]! / 2, 5);
    expect(await tables.table(id, "not-a-mood")).toBe(plain);
    expect(applyMood(plain, "happy", 0)[HALF]).toBeCloseTo(plain[HALF]!, 6);
  });
});

describe("phrasing", () => {
  const poet = { comma: 780, end: 1250, line: 900, breakCommas: true, lines: true };

  it("maps punctuation to the voice's own pauses", () => {
    expect(phrasePause("हसना,", 190, poet)).toBe(780);
    expect(phrasePause("ये छोड़ दिया मैंने।", 380, poet)).toBe(1250);
    expect(phrasePause("कहाँ जाऊँ मैं...", 520, poet)).toBe(Math.round(1250 * 1.25));
    expect(phrasePause("एक line बिना विराम", 300, poet)).toBe(900);
    expect(phrasePause("आख़िरी बात।", 720, poet)).toBe(Math.round(1250 * 1.4));
  });

  it("blends phrasing by weight and keeps stock voices on the defaults", () => {
    expect(phrasingFor([["af_heart", 1]])).toBeUndefined();
    const v = LEARNED.find((x) => x.phrasing.breakCommas)!;
    const p = phrasingFor([[v.id, 0.5], ["hf_alpha", 0.5]])!;
    expect(p.comma).toBe(Math.round((v.phrasing.comma + 190) / 2));
    expect(p.breakCommas).toBe(true);
  });

  it("splits phrases at commas and lines only when asked", () => {
    expect(splitPhrases("हसना, रूठना, मनाना, सब छोड़ दिया।")).toEqual(["हसना,", "रूठना,", "मनाना,", "सब छोड़ दिया।"]);
    expect(toChunks("हसना, रूठना, मनाना।").map((c) => c.text)).toEqual(["हसना, रूठना, मनाना।"]);
    expect(toChunks("हसना, रूठना, मनाना।", undefined, { commas: true }).map((c) => c.text)).toEqual(["हसना,", "रूठना,", "मनाना।"]);
    expect(toChunks("पहली पंक्ति\nदूसरी पंक्ति", undefined, { lines: true }).map((c) => c.text)).toEqual(["पहली पंक्ति", "दूसरी पंक्ति"]);
  });

  it("a poetry voice breaks at commas with long pauses; a stock voice does not", () => {
    const poet = LEARNED.find((x) => x.phrasing.breakCommas)!;
    const opts = { mode: "speak" as const, speed: 1, pauseScale: 1, cast: {} };
    const a = buildPlan("हसना, रूठना, मनाना, ये सब छोड़ दिया मैंने।", { ...opts, voice: poet.id }).items;
    const b = buildPlan("हसना, रूठना, मनाना, ये सब छोड़ दिया मैंने।", { ...opts, voice: "hm_omega" }).items;
    expect(a.length).toBe(4);
    expect(b.length).toBe(1);
    expect(a[0]!.pauseMs).toBeGreaterThan(500);
  });
});

describe("acted moods", () => {
  const style = (raw: string): Delivery => {
    const d = readDirection(raw).find((x) => x.kind === "style");
    if (!d || d.kind !== "style") throw new Error(`no style for ${raw}`);
    return d.delivery;
  };

  it("emotion marks turn on the learned mood", () => {
    expect(style("sad").mood).toBe("sad");
    expect(style("crying").mood).toBe("crying");
    expect(style("angrily").mood).toBe("angry");
    expect(style("lovingly").mood).toBe("loving");
    expect(style("very excited").moodAmount).toBeCloseTo(1.5);
    expect(style("a bit happy").moodAmount).toBeCloseTo(0.5);
  });

  it("understands Hindi and Hinglish directions", () => {
    expect(style("udaas").mood).toBe("sad");
    expect(style("rote hue").mood).toBe("crying");
    expect(style("gusse mein").mood).toBe("angry");
    expect(style("प्यार से").mood).toBe("loving");
    expect(style("डरते हुए").mood).toBe("scared");
    expect(style("khush").mood).toBe("happy");
  });

  it("one mood per line: the strongest wins, other marks still shape the line", () => {
    const d = combine([style("a bit happy"), style("crying"), style("whispering")]);
    expect(d.mood).toBe("crying");
    expect(d.soft).toBeGreaterThan(0.5);
  });

  it("plans carry the mood to the engine", () => {
    const { items } = buildPlan("Papa (rote hue): Beta, tu kahan chali gayi thi?", { mode: "dialogue", speed: 1, pauseScale: 1, voice: "hm_omega", cast: {} });
    expect(items[0]!.mood).toBe("crying");
    expect(items[0]!.moodAmount).toBe(1);
  });
});
