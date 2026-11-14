import { describe, expect, it } from "vitest";
import { acting, exposeAlignment, packSpeaker, prepareText, puncNorm, seedFor, StudioTokenizer, trimSilence, unpackSpeaker } from "../src/engine/studio";
import { referenceLine, STUDIO_MOODS } from "../src/engine/studio_refs";

describe("studio text", () => {
  it("cleans punctuation the way Chatterbox does", () => {
    expect(puncNorm("kaash main tumhe bacha paata...")).toBe("Kaash main tumhe bacha paata,");
    expect(puncNorm("wait: what")).toBe("Wait, what.");
    expect(puncNorm("“Hi”  there — friend")).toBe('"Hi" there - friend.');
    expect(prepareText("Main yahin hoon", "hi")).toBe("[hi]main[SPACE]yahin[SPACE]hoon.");
    // Devanagari nukta letters are decomposed (NFKD), as the model was trained
    expect(prepareText("ज़रा", "hi")).toBe("[hi]ज़रा.");
  });

  it("tokenizes with added tokens and BPE merges", () => {
    const tok = new StudioTokenizer({
      model: { vocab: { "[UNK]": 1, "[SPACE]": 2, t: 3, h: 4, e: 5, th: 6, the: 7, ".": 8, a: 9 }, merges: ["t h", "th e"], unk_token: "[UNK]" },
      added_tokens: [{ id: 2, content: "[SPACE]" }, { id: 722, content: "[hi]" }, { id: 708, content: "[en]" }],
    });
    // template: EXAGGERATION, BOS, text…, EOT, START_SPEECH ×2
    expect(tok.encode("[en]the[SPACE]a.")).toEqual([6563, 255, 708, 7, 2, 9, 8, 0, 6561, 6561]);
    expect(tok.encode("[en]tz")).toEqual([6563, 255, 708, 3, 1, 0, 6561, 6561]);
  });
});

describe("studio speakers", () => {
  it("round-trips through bytes", () => {
    const s = {
      condEmb: Float32Array.from({ length: 2 * 1024 }, (_, i) => i / 7),
      condLen: 2,
      promptToken: BigInt64Array.from([5n, 9n, 6000n]),
      xvec: Float32Array.from({ length: 192 }, (_, i) => -i),
      promptFeat: Float32Array.from({ length: 3 * 80 }, (_, i) => i * 0.5),
      featLen: 3,
    };
    const back = unpackSpeaker(packSpeaker(s));
    expect(back.condLen).toBe(2);
    expect(back.featLen).toBe(3);
    expect([...back.promptToken]).toEqual([5n, 9n, 6000n]);
    expect(back.condEmb[1500]).toBeCloseTo(1500 / 7);
    expect(back.xvec[191]).toBe(-191);
    expect(back.promptFeat[239]).toBe(119.5);
    expect(() => unpackSpeaker(new Uint8Array(32))).toThrow();
  });

  it("has a reference line for every mood, agreeing with the speaker", () => {
    for (const m of STUDIO_MOODS) {
      expect(referenceLine("h", m, true).length).toBeGreaterThan(40);
      expect(referenceLine("a", m, false)).not.toMatch(/[{}|]/);
    }
    expect(referenceLine("h", undefined, true)).toContain("uthi");
    expect(referenceLine("h", undefined, false)).toContain("utha");
    expect(referenceLine("h", "unknown-mood", false)).toBe(referenceLine("h", "neutral", false));
  });
});

describe("studio acting", () => {
  it("acts stronger moods harder and slow moods slower", () => {
    expect(acting(undefined)).toEqual({ exaggeration: 0.5, cfg: 0.5 });
    expect(acting("crying")).toEqual({ exaggeration: 0.8, cfg: 0.3 });
    expect(acting("angry", 1.5).exaggeration).toBeGreaterThan(acting("angry", 1).exaggeration);
    expect(acting("happy", 0.5).exaggeration).toBeCloseTo(0.6);
  });

  it("gives stable seeds", () => {
    expect(seedFor("a", "b")).toBe(seedFor("a", "b"));
    expect(seedFor("a", "b")).not.toBe(seedFor("a", "c"));
  });

  it("trims silence around a line", () => {
    const pcm = new Float32Array(24000 * 2);
    for (let i = 24000 * 0.8; i < 24000 * 1.2; i++) pcm[i] = Math.sin(i / 5) * 0.5;
    const t = trimSilence(pcm);
    expect(t.length / 24000).toBeGreaterThan(0.4);
    expect(t.length / 24000).toBeLessThan(0.6);
  });
});

describe("studio model graph", () => {
  it("adds the alignment outputs to the graph and keeps everything else", () => {
    // ModelProto { ir_version: 8 (field 1), graph (field 7) { name: "g" (field 2) } }
    const model = Uint8Array.from([0x08, 0x08, 0x3a, 0x03, 0x12, 0x01, 0x67]);
    const out = exposeAlignment(model);
    expect(out.slice(0, 2)).toEqual(Uint8Array.from([0x08, 0x08]));
    const text = new TextDecoder().decode(out);
    for (const l of [9, 12, 13]) expect(text).toContain(`/model/layers.${l}/attn/qkv_proj/MatMul/output_0`);
    expect(() => exposeAlignment(Uint8Array.from([0x08, 0x08]))).toThrow();
  });
});
