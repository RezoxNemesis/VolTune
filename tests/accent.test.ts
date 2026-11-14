import { describe, expect, it } from "vitest";
import { indianEnglish } from "../src/engine/accent";
import { VOCAB } from "../src/engine/phonemes";

describe("Indian English phonemes", () => {
  it("uses a tapped r between vowels and keeps th (clearer than t/d)", () => {
    expect(indianEnglish("θɪŋk")).toBe("θɪŋk");
    expect(indianEnglish("ðɪs")).toBe("ðɪs");
    expect(indianEnglish("vɛɹi")).toBe("ʋɛɾi");
    expect(indianEnglish("kæɹi")).toBe("kɛɾi");
  });

  it("uses pure vowels for ei and ou and a plain schwa for u", () => {
    expect(indianEnglish("seɪ")).toBe("seː");
    expect(indianEnglish("ɡoʊ")).toBe("ɡoː");
    expect(indianEnglish("kʌp")).toBe("kəp");
  });

  it("drops secondary stress and only emits symbols the model knows", () => {
    const out = indianEnglish("ˌɪntɚˈnæʃənəl ðɪs wɜːld θɪŋk");
    expect(out).not.toContain("ˌ");
    for (const ch of out) expect(VOCAB[ch] !== undefined || ch === " ", `symbol ${ch}`).toBe(true);
  });
});

describe("Indian-accented English voices", () => {
  it("marks a US voice with accent India and leaves US voices alone", async () => {
    const { buildPlan } = await import("../src/engine/plan");
    const opts = (cast: Record<string, string>) => ({ mode: "dialogue" as const, speed: 1, pauseScale: 1, voice: "af_heart", cast, customs: [] });
    const indian = buildPlan("Asha: Hello there.", opts({ Asha: "Indian Bella" }) as any);
    expect(indian.items.some((it: any) => it.accent === "india")).toBe(true);
    const us = buildPlan("Asha: Hello there.", opts({ Asha: "af_bella" }) as any);
    expect(us.items.some((it: any) => it.accent === "india")).toBe(false);
  });
});
