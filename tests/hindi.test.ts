import { describe, expect, it } from "vitest";
import { devanagariShare, devanagariToPhonemes, hindiNormalize, hindiNumber, hindiPhonemize, splitScripts } from "../src/engine/hindi";
import { normalize, splitSentences, toChunks } from "../src/engine/text";
import { buildPlan, voiceForText } from "../src/engine/plan";

const base = { speed: 1, pauseScale: 1, voice: "af_heart", cast: {} as Record<string, string> };

describe("Hindi numbers", () => {
  it("reads irregular numbers correctly", () => {
    expect(hindiNumber(0)).toBe("शून्य");
    expect(hindiNumber(21)).toBe("इक्कीस");
    expect(hindiNumber(99)).toBe("निन्यानवे");
    expect(hindiNumber(100)).toBe("एक सौ");
    expect(hindiNumber(2026)).toBe("दो हज़ार छब्बीस");
    expect(hindiNumber(100000)).toBe("एक लाख");
    expect(hindiNumber(12345678)).toBe("एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर");
  });
  it("normalises digits, money and percentages", () => {
    expect(hindiNormalize("मेरे पास ५ किताबें हैं")).toBe("मेरे पास पाँच किताबें हैं");
    expect(hindiNormalize("कीमत ₹250 है")).toContain("दो सौ पचास रुपये");
    expect(hindiNormalize("50% छूट")).toBe("पचास प्रतिशत छूट");
    expect(hindiNormalize("3.5 घंटे")).toBe("तीन दशमलव पाँच घंटे");
  });
});

describe("Devanagari → phonemes", () => {
  const cases: Array<[string, string]> = [
    ["बहुत", "bəhʊt"], // word-final schwa dropped
    ["नमस्ते", "nəməsteː"], // schwa kept before a conjunct, no stress marks
    ["सुंदर", "sʊndəɾ"], // anusvara before a consonant is a nasal consonant
    ["बंदर", "bəndəɾ"],
    ["गंगा", "ɡəŋɡaː"],
    ["हूँ", "hũː"], // nasalised long vowel keeps its length
    ["रहा", "ɾəhaː"],
    ["कृपया", "kɾɪpjaː"], // medial schwa dropped
    ["मदद", "mədəd"],
    ["है", "hɛː"],
    ["में", "mẽː"],
    ["ज्ञान", "ɡjaːn"],
    ["क्षमा", "kʃəmaː"],
  ];
  for (const [word, ph] of cases) it(`${word} → ${ph}`, () => expect(devanagariToPhonemes(word).normalize("NFD")).toBe(ph.normalize("NFD")));

  it("only emits symbols the Kokoro model knows", () => {
    const vocab = new Set(Array.from(' !"(),.:;?AIOQSTWYabcdefhijklmnopqrstuvwxyzæçðøŋœɐɑɒɔɕɖəɚɛɜɟɡɣɤɥɨɪɯɰɲɳɴɸɹɻɽɾʁʂʃʈʊʋʌʎʒʔʝʣʤʥʦʧʨʰʲˈˌː̃βθχᵊᵝᵻ—“”…→↓↗↘ꭧ'.normalize("NFD")));
    const text = "भारत एक विशाल देश है। यहाँ अनेक भाषाएँ बोली जाती हैं, और हर भाषा की अपनी मिठास है! क्या आप ज़रूर आएँगे? ऑफ़िस में डॉक्टर साहब श्रीमान् पढ़ाई ढोल फ़िल्म";
    for (const ch of devanagariToPhonemes(text).normalize("NFD")) expect(vocab.has(ch) || ch === "x", `symbol ${ch} (U+${ch.codePointAt(0)!.toString(16)})`).toBe(true);
  });
});

describe("script handling", () => {
  it("measures and splits scripts", () => {
    expect(devanagariShare("नमस्ते")).toBe(1);
    expect(devanagariShare("hello")).toBe(0);
    expect(splitScripts("आज meeting है").map((r) => r.script)).toEqual(["hindi", "other", "hindi"]);
  });
  it("phonemizes mixed text with the supplied English phonemizer", async () => {
    const out = await hindiPhonemize("कल meeting है।", async (run) => `<${run.trim()}>`);
    expect(out).toContain("<meeting>");
    expect(out.endsWith(".")).toBe(true);
  });
  it("splits Hindi sentences on the danda", () => {
    expect(splitSentences("मैं घर जा रहा हूँ। तुम कहाँ हो? ठीक है॥")).toEqual(["मैं घर जा रहा हूँ।", "तुम कहाँ हो?", "ठीक है॥"]);
  });
  it("uses Hindi numbers in Hindi lines and English numbers elsewhere", () => {
    expect(normalize("मेरे 3 भाई हैं\nI have 3 brothers")).toBe("मेरे तीन भाई हैं\nI have three brothers");
    const long = "आज सुबह से ही आसमान में काले बादल छाए हुए हैं और ठंडी हवा चल रही है। शाम तक तेज़ बारिश होने की पूरी संभावना है इसलिए छाता ज़रूर साथ रखें।";
    expect(toChunks(long).length).toBe(2);
  });
  it("chooses a Hindi voice for Devanagari and an English voice for English", () => {
    expect(voiceForText("af_heart", "नमस्ते दोस्तों")).toBe("hf_alpha");
    expect(voiceForText("bm_george", "नमस्ते दोस्तों")).toBe("hm_omega");
    expect(voiceForText("hf_beta", "Good morning everyone")).toBe("hf_beta");
    expect(voiceForText("hm_omega", "Good morning everyone")).toBe("hm_omega");
    expect(voiceForText("hf_beta", "नमस्ते")).toBe("hf_beta");
  });
  it("builds a plan with the right voice per line in a mixed dialogue", () => {
    const { items } = buildPlan("Asha: नमस्ते, कैसे हो?\nJon: I am fine, thanks.", { ...base, mode: "dialogue" });
    expect(items[0]!.voice.startsWith("h")).toBe(true);
    expect(items[items.length - 1]!.voice.startsWith("h")).toBe(false);
  });
});
