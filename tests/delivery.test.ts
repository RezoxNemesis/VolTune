import { describe, expect, it } from "vitest";
import { applyToText, readDirection } from "../src/engine/delivery";
import { parseScript, segmentText } from "../src/engine/dialogue";
import { buildPlan } from "../src/engine/plan";
import { hashPlan } from "../src/engine/store";
import { tokenize, kokoroNormalize, splitPunctuation } from "../src/engine/phonemes";
import { pitchShift, colour, mouthEnvelope, rms, timeStretch } from "../src/engine/audio";
import {
  PRESETS,
  blendTables,
  decodeVoiceCode,
  encodeVoiceCode,
  findVoice,
  isKnownVoiceRef,
  makeRecipe,
  mixToString,
  parseMix,
  resolveVoice,
  styleRow,
  VoiceTables,
  STYLE_DIM,
  STYLE_ROWS,
} from "../src/engine/voicebank";

const base = { mode: "dialogue" as const, speed: 1, pauseScale: 1, voice: "af_heart", cast: {} };

describe("directions", () => {
  it("reads moods, sounds and pauses", () => {
    expect(readDirection("whispering")[0]).toMatchObject({ kind: "style" });
    expect(readDirection("laughs")[0]).toMatchObject({ kind: "sound" });
    expect(readDirection("pause 2s")[0]).toEqual({ kind: "pause", ms: 2000 });
    expect(readDirection("long pause")[0]).toMatchObject({ kind: "pause" });
    expect(readDirection("looks away")[0]).toMatchObject({ kind: "action" });
  });
  it("scales intensity", () => {
    const mild = readDirection("a bit angry")[0] as { delivery: { gain: number } };
    const strong = readDirection("very angry")[0] as { delivery: { gain: number } };
    expect(strong.delivery.gain).toBeGreaterThan(mild.delivery.gain);
  });
  it("keeps questions questions when shouting", () => {
    const shout = (readDirection("shouting")[0] as { delivery: Parameters<typeof applyToText>[1] }).delivery;
    expect(applyToText("Where are you?", shout)).toMatch(/\?!?$/);
  });
  it("does not read markdown bold as a mood", () => {
    const segs = segmentText("This is **bold** text.");
    expect(segs.map((s) => s.text).join(" ")).toContain("bold");
  });
});

describe("script parsing", () => {
  it("understands label moods, inline sounds and pauses", () => {
    const { lines } = parseScript("Maya (whispering): Come here. (laughs) Now! [pause 1s]\nJon: Okay.");
    expect(lines[0]!.segments[0]!.delivery.tags).toContain("whisper");
    expect(lines[0]!.segments.some((s) => s.sound)).toBe(true);
    expect(lines[0]!.segments.at(-1)!.pauseAfterMs).toBeGreaterThanOrEqual(1000);
    expect(lines[1]!.speaker).toBe("Jon");
  });
  it("reads screenplay layout and in-script casting, matching names case-insensitively", () => {
    const p = parseScript("@Kabir = Teen boy, pitch +1\n\nKABIR\n(nervous)\nHello?\n\nTARA\nHi.");
    expect(p.speakers).toEqual(["Kabir", "TARA"]);
    expect(p.cast.Kabir).toMatchObject({ voice: "Teen boy", pitch: 1 });
    expect(p.lines[0]!.segments[0]!.delivery.tags).toContain("nervous");
  });
  it("performs sounds written on the label", () => {
    const { lines } = parseScript("Tara (laughs): Only by my backpack.");
    expect(lines[0]!.segments[0]!.sound).toBe(true);
    expect(lines[0]!.text).toBe("Only by my backpack.");
  });
  it("skips comments and adds scene-break silence", () => {
    const p = parseScript("# draft\nA: One.\n---\nB: Two.");
    expect(p.lines.map((l) => l.text)).toEqual(["One.", "Two."]);
    expect(p.lines[1]!.pauseBeforeMs).toBeGreaterThan(1000);
  });
});

describe("plans with voices and delivery", () => {
  it("uses in-script voices and delivery", () => {
    const { items, cast } = buildPlan("@Mira = Teen girl\nMira (shouting): Run!", base);
    expect(cast.Mira).toBe("pre_teen_girl");
    expect(items[0]!.voice).toContain("af_bella");
    expect(items[0]!.pitch).toBeGreaterThan(1);
    expect(items[0]!.gain).toBeGreaterThan(1);
  });
  it("keeps plain plans in their original shape", () => {
    const { items } = buildPlan("Hello there.", { ...base, mode: "speak" });
    expect(Object.keys(items[0]!).sort()).toEqual(["pauseMs", "speed", "text", "turn", "voice"]);
  });
  it("hashes delivery so a whisper is not served from a normal clip", async () => {
    const a = await hashPlan([{ text: "Hi.", voice: "af_heart", speed: 1, pauseMs: 0 }]);
    const b = await hashPlan([{ text: "Hi.", voice: "af_heart", speed: 1, pauseMs: 0, soft: 0.8 }]);
    expect(a).not.toBe(b);
  });
});

describe("voice bank", () => {
  it("parses and normalises blends", () => {
    const m = parseMix("af_heart*3 + am_puck*1");
    expect(m).toEqual([["af_heart", 0.75], ["am_puck", 0.25]]);
    expect(mixToString(m)).toBe("af_heart*0.75+am_puck*0.25");
    expect(() => parseMix("nobody*1")).toThrow();
  });
  it("finds presets by id or name", () => {
    expect(findVoice("Teen boy")?.id).toBe("pre_teen_boy");
    expect(resolveVoice("pre_villain").pitch).toBeLessThan(0);
    expect(isKnownVoiceRef("Villain")).toBe(true);
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
  });
  it("round-trips share codes", () => {
    const v = { name: "Rusty", gender: "Male" as const, accent: "US" as const, tone: "gravelly", recipe: makeRecipe({ mix: parseMix("am_fenrir*0.7+bm_george*0.3"), pitch: -1.5, speed: 0.95 }) };
    const back = decodeVoiceCode(encodeVoiceCode(v));
    expect(back).toMatchObject({ name: "Rusty", gender: "Male", recipe: v.recipe });
    expect(() => decodeVoiceCode("nope")).toThrow();
  });
  it("blends style tables and picks the row by length", async () => {
    const t = (k: number) => new Float32Array(STYLE_ROWS * STYLE_DIM).fill(k);
    const tables = new VoiceTables(async (id) => t(id === "af_heart" ? 1 : 3));
    const blend = await tables.table("af_heart*0.5+am_puck*0.5");
    expect(blend[0]).toBeCloseTo(2);
    expect(blendTables([{ data: t(2), weight: 1 }])[5]).toBe(2);
    const ramp = new Float32Array(STYLE_ROWS * STYLE_DIM).map((_, i) => Math.floor(i / STYLE_DIM));
    expect(styleRow(ramp, 12)[0]).toBe(10);
    expect(styleRow(ramp, 9999)[0]).toBe(STYLE_ROWS - 1);
  });
});

describe("phonemes", () => {
  it("pads tokens and skips unknown symbols", () => {
    expect(tokenize("hə§")).toEqual([0, 50, 83, 0]);
  });
  it("normalises money, times and titles", () => {
    expect(kokoroNormalize("Dr. Rao paid $5.50 at 3:05")).toBe("Doctor Rao paid 5 dollars and 50 cents at 3 oh 5");
  });
  it("keeps punctuation runs", () => {
    expect(splitPunctuation("Hi, you!").filter((p) => p.match).map((p) => p.text)).toEqual([", ", "!"]);
  });
});

describe("voice shaping", () => {
  const sr = 24000;
  const sine = (f: number, n = sr) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / sr));
  const freq = (s: Float32Array) => {
    let z = 0;
    for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 && s[i]! >= 0) z++;
    return (z * sr) / s.length;
  };
  it("shifts pitch and keeps the length", () => {
    const y = pitchShift(sine(150), 4);
    expect(y.length).toBe(sr);
    expect(freq(y.subarray(2000, sr - 2000))).toBeGreaterThan(185);
    expect(freq(y.subarray(2000, sr - 2000))).toBeLessThan(194);
  });
  it("stretches time without changing pitch", () => {
    const y = timeStretch(sine(200), 1.5);
    expect(y.length).toBeGreaterThan(sr * 1.45);
    expect(freq(y.subarray(2000, y.length - 2000))).toBeCloseTo(200, -1);
  });
  it("whispers quieter and shouts louder without clipping", () => {
    const x = sine(180);
    expect(rms(colour(x, { gain: 0.55, soft: 0.85 }))).toBeLessThan(rms(x));
    const loud = colour(x, { gain: 1.6, edge: 0.6 });
    expect(rms(loud)).toBeGreaterThan(rms(x));
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(0.971);
  });
  it("produces a mouth envelope per frame", () => {
    const x = new Float32Array(sr).fill(0);
    x.set(sine(200, sr / 2), sr / 2);
    const env = mouthEnvelope(x, 30);
    expect(env.length).toBe(30);
    expect(env[2]).toBe(0);
    expect(env[25]).toBeGreaterThan(0.5);
  });
});
