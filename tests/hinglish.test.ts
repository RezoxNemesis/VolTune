import { transliterateHinglish } from "../src/engine/hinglish";
import { describe, expect, it } from "vitest";
import { hinglishToDevanagari } from "../src/engine/hinglish";
import { voiceForText } from "../src/engine/plan";
import { phonemesFor } from "../src/engine/synth";

describe("Hinglish", () => {
  it("writes romanised Hindi words in Devanagari and leaves English alone", () => {
    expect(hinglishToDevanagari("Mera naam Rahul hai")).toBe("मेरा नाम Rahul है");
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
    expect(ph).toContain("pɾɪjaː"); // a name inside a Hindi line is spelled the Hindi way
  });
});

describe("Hinglish dialogue words", () => {
  it("reads family words, pasand, seeti and the verb bacha the Hindi way, and leaves English lines alone", () => {
    expect(transliterateHinglish("Papa...")).toBe("पापा...");
    expect(transliterateHinglish("Aapko laal rang pasand hai na?")).toBe("आपको लाल रंग पसंद है ना?");
    expect(transliterateHinglish("Main tujhe bacha nahi paaya.")).toBe("मैं तुझे बचा नहीं पाया.");
    expect(transliterateHinglish("Ek chhota bacha khel raha tha.")).toBe("एक छोटा बच्चा खेल रहा था.");
    expect(transliterateHinglish("Jab bhi train ki seeti bajegi na")).toBe("जब भी train की सीटी बजेगी ना");
    expect(transliterateHinglish("My papa is here.")).toBe("My papa is here.");
    expect(transliterateHinglish("Hi, how are you?")).toBe("Hi, how are you?");
    expect(transliterateHinglish("ab sirf yaadon mein sunai deti hai")).toBe("अब सिर्फ़ यादों में सुनाई देती है");
  });
});
