import { describe, expect, it } from "vitest";
import { hinglishToDevanagari } from "../src/engine/hinglish";
import { voiceForText } from "../src/engine/plan";
import { phonemesFor } from "../src/engine/synth";

describe("Hinglish", () => {
  it("writes romanised Hindi words in Devanagari and leaves English alone", () => {
    expect(hinglishToDevanagari("Mera naam Rahul hai")).toBe("मेरा naam Rahul है");
    expect(hinglishToDevanagari("Kya aap theek ho?")).toBe("क्या आप ठीक हो?");
  });
  it("never converts English words that are also Hindi words", () => {
    expect(hinglishToDevanagari("I want to go to the park, do it now")).toBe("I want to go to the park, do it now");
  });
  it("keeps a Hindi voice for Hinglish lines", () => {
    expect(voiceForText("hf_alpha", "Mera naam Priya hai, and I love dosto")).toBe("hf_alpha");
  });
  it("speaks Hinglish with Hindi phonemes for the Hindi words and English for the rest", async () => {
    const ph = await phonemesFor("Mera naam Priya hai", "hf_alpha", async (run) => [run.trim()]);
    expect(ph).toContain("meːɾaː"); // मेरा
    expect(ph).toContain("hɛː");  // है
    expect(ph).toContain("Priya");  // English word passes through to the English phonemizer
  });
});
