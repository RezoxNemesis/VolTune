import { describe, expect, it } from "vitest";
import { indianEnglish } from "../src/engine/accent";
import { VOCAB } from "../src/engine/phonemes";

describe("Indian English phonemes", () => {
  it("uses dental t and d for th, and a tapped r between vowels", () => {
    expect(indianEnglish("θɪŋk")).toBe("tɪŋk");
    expect(indianEnglish("ðɪs")).toBe("dɪs");
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
