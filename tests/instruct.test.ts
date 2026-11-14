import { describe, expect, it } from "vitest";
import { editDistance, findStyles, readDirection } from "../src/engine/delivery";
import { readInstruction, rewriteInstructions } from "../src/engine/instruct";
import { buildPlan } from "../src/engine/plan";

const base = { mode: "dialogue" as const, speed: 1, pauseScale: 1, voice: "af_heart", cast: {} };
const speak = { ...base, mode: "speak" as const, voice: "hm_papa" };

describe("plain-language instructions", () => {
  it("understands the user's own wording, spelling slips included", () => {
    expect(readInstruction(`tumhe is dialouge ko emtional hoke bolna hai "Kaash mai, tumhe bacha paa ta"`)).toEqual({ mark: "emotional", spoken: "Kaash mai, tumhe bacha paa ta" });
    // The instruction quoted instead of the words, with a stray closing quote.
    expect(readInstruction(`" tumhe is dialouge ko emtional hoke bolna hai " Kaash mai, tumhe bacha paa ta"`)).toEqual({ mark: "emotional", spoken: "Kaash mai, tumhe bacha paa ta" });
    expect(readInstruction(`tumhe is dialogue ko emotional hoke bolna hai: Kaash main tumhe bacha paata`)?.spoken).toBe("Kaash main tumhe bacha paata");
  });

  it("reads Hinglish, Hindi and English directions with intensity", () => {
    expect(readInstruction("is line ko bahut udaas awaaz mein bolo - Main yahin hoon")).toEqual({ mark: "very sad", spoken: "Main yahin hoon" });
    expect(readInstruction("Say this angrily: Get out of my house!")).toEqual({ mark: "angry", spoken: "Get out of my house!" });
    expect(readInstruction(`इस डायलॉग को भावुक होकर बोलना है: "काश मैं तुम्हें बचा पाता"`)).toEqual({ mark: "emotional", spoken: "काश मैं तुम्हें बचा पाता" });
    expect(readInstruction("thoda gusse mein aur dheere se bolo: Chup raho")).toEqual({ mark: "a bit angry, softly", spoken: "Chup raho" });
    expect(readInstruction("Agla dialogue rote hue bolna hai.")).toEqual({ mark: "crying", spoken: "" });
    expect(readInstruction("is line ko dard bhari awaaz mein bolo Kaash main tumhe bacha paata")?.mark).toBe("regretful");
  });

  it("leaves lines a character would say alone", () => {
    for (const line of [
      "Pyaar se bolo na!",
      "Tum pyaar se bolo na",
      "Maine kaha tha, gusse mein mat bolo.",
      "Usne gusse mein kaha \"Nikal jao\"",
      "He said angrily, \"Get out\"",
      "I read your letter: it was beautiful",
      "Kaash main tumhe bacha paata",
      "Papa, aap rona mat.",
    ]) expect(readInstruction(line), line).toBeNull();
  });

  it("keeps speaker labels and turns instructions into screenplay marks", () => {
    const out = rewriteInstructions(
      ["Papa: is line ko rote hue bolo - Kaash main tumhe bacha paata", "Beti (softly): Papa, aap rona mat.", "Agla dialogue khushi se bolna", "Beti: Main yahin hoon!"].join("\n"),
    );
    expect(out.split("\n")).toEqual(["Papa: (crying) Kaash main tumhe bacha paata", "Beti (softly): Papa, aap rona mat.", "(happy)", "Beti: Main yahin hoon!"]);
    expect(rewriteInstructions("Plain text, nothing to do.")).toBe("Plain text, nothing to do.");
  });

  it("acts the asked emotion in the plan", () => {
    const { items } = buildPlan(`tumhe is dialouge ko emtional hoke bolna hai "Kaash mai, tumhe bacha paa ta"`, speak as any);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mood: "crying", tags: ["emotional"] });
    expect(items[0]!.text).not.toMatch(/bolna|dialouge/);
    const scene = buildPlan("Papa: is line ko bahut udaas hoke bolo: Main roz tera intezaar karta hoon\nBeti: Papa!", base as any).items;
    expect(scene[0]).toMatchObject({ speaker: "Papa", mood: "sad" });
    expect(scene[0]!.moodAmount).toBeGreaterThan(1);
    expect(scene[1]!.mood).toBeUndefined();
  });
});

describe("forgiving direction words", () => {
  it("matches misspelt moods and Hinglish phrasing inside marks", () => {
    expect(findStyles("emtional hoke").map((s) => s.name)).toEqual(["emotional"]);
    expect(findStyles("udaas awaaz mein").map((s) => s.name)).toEqual(["sad"]);
    expect(findStyles("tumhe is dialouge ko").map((s) => s.name)).toEqual([]);
    const d = readDirection("bahut gusse mein");
    expect(d[0]).toMatchObject({ kind: "style" });
    expect((d[0] as any).delivery.mood).toBe("angry");
    expect((d[0] as any).delivery.moodAmount).toBeGreaterThan(1);
    expect(readDirection("thoda udaas")[0]).toMatchObject({ kind: "style", delivery: { mood: "sad", moodAmount: 0.5 } });
    expect(readDirection("to Jon")[0]!.kind).toBe("action");
  });

  it("measures edit distance with swaps", () => {
    expect(editDistance("emtional", "emotional")).toBe(1);
    expect(editDistance("dialouge", "dialogue")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
});
