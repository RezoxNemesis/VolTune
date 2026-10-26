import { describe, expect, it } from "vitest";
import { estimateSeconds, normalize, pauseAfter, splitLong, splitSentences, toChunks } from "../src/engine/text";

describe("normalize", () => {
  it("strips markdown, links and code", () => {
    const out = normalize("# Title\n\nSee **this** [link](https://x.io) and `code`.\n\n```js\nignored()\n```");
    expect(out).toContain("Title");
    expect(out).toContain("this");
    expect(out).toContain("link");
    expect(out).not.toMatch(/https|\*\*|`|ignored/);
  });
  it("expands abbreviations and symbols", () => {
    expect(normalize("Dr. Lee met Mr. Park vs. the clock, 50% sure & ready.")).toBe(
      "Doctor Lee met Mister Park versus the clock, fifty percent sure and ready.",
    );
  });
  it("straightens quotes and ellipses, removes control characters", () => {
    expect(normalize("“Hi” ‘there’…\u0007")).toBe('"Hi" \'there\'...');
  });
  it("returns empty for whitespace", () => {
    expect(normalize("  \n\t ")).toBe("");
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("One. Two! Three? Four.")).toEqual(["One.", "Two!", "Three?", "Four."]);
  });
  it("keeps decimals, domains and initials together", () => {
    expect(splitSentences("It cost 3.5 dollars at example.com today. Then J. Smith left.")).toEqual([
      "It cost 3.5 dollars at example.com today.",
      "Then J. Smith left.",
    ]);
  });
  it("keeps closing quotes with their sentence", () => {
    expect(splitSentences('She said "stop." He did.')).toEqual(['She said "stop."', "He did."]);
  });
});

describe("splitLong", () => {
  it("leaves short sentences alone", () => {
    expect(splitLong("Short one.", 50)).toEqual(["Short one."]);
  });
  it("breaks at clauses and never exceeds the limit", () => {
    const s = "This is a long sentence, with several clauses, that keeps going and going; it needs to be split somewhere sensible.";
    const parts = splitLong(s, 50);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(s);
  });
  it("handles a single unbroken token", () => {
    const parts = splitLong("a".repeat(120), 50);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
    expect(parts.join("")).toBe("a".repeat(120));
  });
});

describe("pauseAfter", () => {
  it("orders pauses by punctuation weight", () => {
    expect(pauseAfter("Wait...", false)).toBeGreaterThan(pauseAfter("Really?", false));
    expect(pauseAfter("Really?", false)).toBeGreaterThan(pauseAfter("Fine.", false));
    expect(pauseAfter("Fine.", false)).toBeGreaterThan(pauseAfter("Well,", false));
  });
  it("lengthens pauses at paragraph ends", () => {
    expect(pauseAfter("Done.", true)).toBeGreaterThanOrEqual(720);
  });
});

describe("toChunks", () => {
  it("returns nothing for empty or symbol-only input", () => {
    expect(toChunks("")).toEqual([]);
    expect(toChunks("... --- ???")).toEqual([]);
  });
  it("chunks paragraphs with longer pauses between them", () => {
    const chunks = toChunks("First paragraph is here, and it is fine.\n\nSecond paragraph follows right after it.");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.pauseMs).toBeGreaterThan(chunks[1]!.pauseMs);
  });
  it("keeps every chunk within the limit", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} carries some words, and a clause`).join(". ") + ".";
    for (const c of toChunks(long, 200)) expect(c.text.length).toBeLessThanOrEqual(200);
  });
});

describe("estimateSeconds", () => {
  it("scales with word count and speed", () => {
    const base = estimateSeconds("word ".repeat(155), 1);
    expect(base).toBeCloseTo(60, 0);
    expect(estimateSeconds("word ".repeat(155), 2)).toBeCloseTo(30, 0);
  });
});
