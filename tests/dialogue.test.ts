import { describe, expect, it } from "vitest";
import { autoAssignVoices, parseScript, stripDirections } from "../src/engine/dialogue";
import { VOICES } from "../src/engine/voices";

describe("parseScript", () => {
  it("parses Name: line and [Name] line formats", () => {
    const { lines, speakers } = parseScript("Maya: Hello there.\n[Jon] Hi, Maya.\nMaya: How are you?");
    expect(speakers).toEqual(["Maya", "Jon"]);
    expect(lines.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: "Maya", text: "Hello there." },
      { speaker: "Jon", text: "Hi, Maya." },
      { speaker: "Maya", text: "How are you?" },
    ]);
  });
  it("continues a speaker across unlabelled lines", () => {
    const { lines } = parseScript("Maya: First thought.\nand a second line.");
    expect(lines.map(({ speaker, text }) => ({ speaker, text }))).toEqual([{ speaker: "Maya", text: "First thought. and a second line." }]);
  });
  it("treats unlabelled text as Narrator", () => {
    const { lines, speakers } = parseScript("It was late.");
    expect(speakers).toEqual(["Narrator"]);
    expect(lines[0]!.text).toBe("It was late.");
  });
  it("merges speakers case-insensitively", () => {
    expect(parseScript("ANNA: Hi.\nAnna: Again.").speakers).toEqual(["ANNA"]);
  });
  it("removes stage directions and drops empty lines", () => {
    const { lines } = parseScript("Jon: (sighs) Fine. *shrugs*\nMaya: (silence)");
    expect(lines.map(({ speaker, text }) => ({ speaker, text }))).toEqual([{ speaker: "Jon", text: "Fine." }]);
  });
  it("does not mistake URLs for speakers", () => {
    expect(parseScript("Visit https://example.com now.").speakers).toEqual(["Narrator"]);
  });
  it("handles Windows line endings", () => {
    expect(parseScript("A: one\r\nB: two").lines).toHaveLength(2);
  });
});

describe("stripDirections", () => {
  it("collapses whitespace left behind", () => {
    expect(stripDirections("Hello (softly)  world")).toBe("Hello world");
  });
});

describe("autoAssignVoices", () => {
  it("gives each speaker a valid, distinct voice", () => {
    const out = autoAssignVoices(["A", "B", "C", "D"]);
    const ids = Object.values(out);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(VOICES.some((v) => v.id === id)).toBe(true);
  });
  it("keeps voices the user already chose", () => {
    expect(autoAssignVoices(["A", "B"], { B: "bm_fable" }).B).toBe("bm_fable");
  });
  it("alternates gender for the first two speakers", () => {
    const out = autoAssignVoices(["A", "B"]);
    const g = (id: string) => VOICES.find((v) => v.id === id)!.gender;
    expect(g(out.A!)).not.toBe(g(out.B!));
  });
});
