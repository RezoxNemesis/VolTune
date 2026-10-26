import { describe, expect, it } from "vitest";
import { buildPlan, jitter, quickStart, type PlanItem } from "../src/engine/plan";

const base = { speed: 1, pauseScale: 1, voice: "af_heart", cast: {} as Record<string, string> };

describe("jitter", () => {
  it("is deterministic and stays within 7%", () => {
    for (let i = 0; i < 500; i++) {
      expect(jitter(i)).toBe(jitter(i));
      expect(jitter(i)).toBeGreaterThanOrEqual(0.93);
      expect(jitter(i)).toBeLessThanOrEqual(1.07);
    }
  });
  it("actually varies", () => {
    expect(new Set(Array.from({ length: 50 }, (_, i) => jitter(i).toFixed(3))).size).toBeGreaterThan(20);
  });
});

describe("buildPlan (speak)", () => {
  it("builds one voice, one speed", () => {
    const { items } = buildPlan("One sentence here. Another follows it right away.", { ...base, mode: "speak" });
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.voice))).toEqual(new Set(["af_heart"]));
  });
  it("scales pauses", () => {
    const text = "First sentence is here. Second sentence is here too. Third one closes it out.";
    const sum = (s: number) => buildPlan(text, { ...base, mode: "speak", pauseScale: s }).items.reduce((a, b) => a + b.pauseMs, 0);
    expect(sum(1.5)).toBeGreaterThan(sum(1));
    expect(sum(0.7)).toBeLessThan(sum(1));
  });
  it("is repeatable so renders can resume", () => {
    const t = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota.";
    expect(buildPlan(t, { ...base, mode: "speak" }).items).toEqual(buildPlan(t, { ...base, mode: "speak" }).items);
  });
});

describe("quickStart", () => {
  const mk = (text: string): PlanItem[] => [{ text, pauseMs: 400, voice: "v", speed: 1, turn: 0 }, { text: "Next.", pauseMs: 300, voice: "v", speed: 1, turn: 0 }];
  it("leaves a short first item alone", () => {
    expect(quickStart(mk("Short."), 1)).toHaveLength(2);
  });
  it("splits a long first item so audio starts sooner", () => {
    const long = "This opening sentence is deliberately long, with several clauses, so that the first audio takes a while, unless it is split into smaller parts.";
    const out = quickStart(mk(long), 1);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]!.text.length).toBeLessThanOrEqual(100);
    expect(out[out.length - 2]!.pauseMs).toBe(400);
  });
});

describe("buildPlan (dialogue)", () => {
  it("assigns voices per speaker and pauses between turns", () => {
    const { items, cast } = buildPlan("Maya: Hi there.\nJon: Hello, Maya.", { ...base, mode: "dialogue" });
    expect(Object.keys(cast).sort()).toEqual(["Jon", "Maya"]);
    expect(items[0]!.voice).toBe(cast.Maya);
    expect(items[1]!.voice).toBe(cast.Jon);
    expect(items[0]!.pauseMs).toBeGreaterThanOrEqual(480);
    expect(items[0]!.speaker).toBe("Maya");
  });
  it("keeps chosen voices", () => {
    const { items } = buildPlan("A: Hello.\nB: Hi.", { ...base, mode: "dialogue", cast: { B: "bm_fable" } });
    expect(items[1]!.voice).toBe("bm_fable");
  });
});

import { dueClips } from "../src/engine/player";
import type { ClipMeta } from "../src/engine/store";

describe("dueClips (no sentence plays twice)", () => {
  const R = 24_000;
  const metas: ClipMeta[] = [0, 1, 2, 3].map((i) => ({ index: i, startSample: i * 3 * R, samples: 2 * R, pauseSamples: R }));
  it("returns clips in the window", () => {
    expect(dueClips(metas, new Set(), 0, 5).map((m) => m.index)).toEqual([0, 1]);
  });
  it("never returns a clip that was already scheduled, even after it finished", () => {
    const scheduled = new Set([0, 1]);
    // Playback is now inside clip 2; clips 0 and 1 have ended and must not come back.
    expect(dueClips(metas, scheduled, 6.5, 20).map((m) => m.index)).toEqual([2, 3]);
    expect(dueClips(metas, new Set([0, 1, 2, 3]), 0, 20)).toEqual([]);
  });
  it("skips clips that are already behind the playhead", () => {
    expect(dueClips(metas, new Set(), 7, 30).map((m) => m.index)).toEqual([2, 3]);
  });
});
