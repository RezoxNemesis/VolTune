/**
 * Plain-language directions. People ask for a delivery the way they would ask an actor:
 *
 *   tumhe is dialogue ko emotional hoke bolna hai "Kaash main, tumhe bacha paata"
 *   "tumhe is dialouge ko emtional hoke bolna hai" Kaash mai, tumhe bacha paa ta
 *   Papa: is line ko rote hue bolo - Kaash main tumhe bacha paata
 *   Say this angrily: Get out of my house!
 *   इस डायलॉग को भावुक होकर बोलना है: "काश मैं तुम्हें बचा पाता"
 *   Agla dialogue bahut udaas awaaz mein bolna.
 *
 * VolTune rewrites each of these into the screenplay mark the rest of the engine already performs,
 * `(emotional) Kaash main, tumhe bacha paata`, keeping any speaker label. Spelling slips in the
 * instruction ("dialouge", "emtional") are forgiven. A line with no mood word or no instruction
 * verb is left exactly as written, and a line a character could plausibly say ("Pyaar se bolo na!")
 * is only read as an instruction when it clearly points at the line itself.
 */

import { findStyles } from "./delivery";

// Verbs that address the performer: bolo / bolna hai / boliye / kaho / padho / sunao / say / speak / read / deliver.
const VERB = String.raw`(?:bol(?:na\s+hai|na\s+he|na\s+h|na|no|o|iye|ein|en|ega|egi|enge|ke|kar)|kah(?:o|iye|na|ein|en)|keh(?:o|na|iye)|padh(?:o|na|iye|ein|en)|parh(?:o|na)|suna(?:o|iye|na)|say|speak|read|deliver|perform|बोलना\s+है|बोलो|बोलना|बोलिए|बोलें|बोलिये|कहो|कहिए|कहना|पढ़ो|पढ़िए|पढ़ना|सुनाओ|सुनाइए)`;
const verbRe = () => new RegExp(String.raw`(?<=^|[\s,;:("“])${VERB}(?=$|[\s,.;:!?)"'“”‘’\-—–।])`, "giu");
// Words that point at "the line" itself rather than at someone in the scene.
const META_RE = /(?<=^|[\s,"“])(?:d[iy]a?l[aoe]?u?g(?:ue|e|u)?s?|dailog\w*|dialog\w*|line|lines|sentence|next|following|agla|agli|agle|डायलॉग|संवाद|लाइन|वाक्य|अगला|अगली)(?=$|[\s,.:"”])/iu;
// "Kaash…" in straight or curly quotes. Single quotes are left alone: they double as apostrophes.
const QUOTED_RE = /["“”]([^"“”\n]{1,400})["“”]/gu;
// A speaker label kept in front: "Papa:", "[Beti]", "MAA (softly):".
const LABEL_RE = /^(\s*(?:\[[^\]\n]{1,40}\]\s*:?|[\p{L}][\p{L}\p{N}'’. -]{0,31}?\s*(?:\([^)\n]{1,60}\))?\s*:)\s*)(.+)$/u;
// What separates an instruction from its words: "bolo: …", "bolna hai - …", "say this angrily — …".
const SEP_RE = /\s*(?::|\s-\s|\s?—\s?|\s?–\s?|\.\.\.|…|\|)\s*/u;

export interface Instruction {
  /** The direction to perform, as a screenplay mark: "very emotional, softly". */
  mark: string;
  /** The words to say; empty when the instruction is about the next line. */
  spoken: string;
}

const stripQuotes = (s: string) => s.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();

/** Read one line as a plain-language instruction, or return null when it is not one. */
export function readInstruction(line: string): Instruction | null {
  const t = line.trim();
  if (!t || !hasVerb(t)) return null;

  // 1. Quotes: either the words are quoted ("… bolna hai "Kaash …""), or the instruction is ("… bolna hai" Kaash …).
  const quoted = [...t.matchAll(QUOTED_RE)];
  if (quoted.length) {
    const outside = t.replace(QUOTED_RE, " ");
    const mark = markOf(outside);
    if (mark) return { mark, spoken: stripQuotes(quoted.map((m) => m[1]!).join(" ")) };
    for (const q of quoted) {
      const inner = markOf(q[1]!);
      const rest = stripQuotes(t.slice(0, q.index) + " " + t.slice(q.index! + q[0].length)).replace(/^(?::|-|—|–)\s*/, "");
      if (inner && rest) return { mark: inner, spoken: rest };
    }
    return null;
  }

  // 2. A separator after the first instruction verb: "Say this angrily: Get out", "… bolo - Kaash …".
  const first = verbRe().exec(t)!;
  const tail = t.slice(first.index + first[0].length);
  const sep = SEP_RE.exec(tail);
  if (sep && sep.index !== undefined) {
    const ask = t.slice(0, first.index + first[0].length + sep.index);
    const spoken = tail.slice(sep.index + sep[0].length).trim();
    const mark = markOf(ask);
    if (mark && spoken && hasVerb(ask)) return { mark, spoken };
  }

  // 3. Instruction alone ("Agla dialogue udaas hoke bolna"), or run straight into the words
  //    ("is line ko rote hue bolo Kaash …"): only when it clearly points at the line.
  if (!META_RE.test(t)) return null;
  const verbs = [...t.matchAll(verbRe())];
  const last = verbs[verbs.length - 1]!;
  const ask = t.slice(0, last.index! + last[0].length);
  const after = t.slice(last.index! + last[0].length).replace(/^\s*(?:hai|h|he|hain|na|please|plz|है|हैं)(?=$|[\s.!?।])/iu, "");
  const mark = markOf(ask);
  if (!mark) return null;
  const spoken = after.replace(/^[\s.!?।,:;-]+/u, "").trim();
  return { mark, spoken };
}

function hasVerb(s: string): boolean {
  return verbRe().test(s);
}

/** The mood an instruction asks for, as a mark ("very emotional, softly"), or "" when it asks for none. */
function markOf(ask: string): string {
  if (!hasVerb(ask)) return "";
  const text = ask
    .replace(verbRe(), " ")
    .replace(/[“”"'‘’:;()[\]—–|!?.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const parts: string[] = [];
  for (const piece of text.split(/\s*(?:,|;|\band\b|\baur\b|\bphir\b|\bthen\b|\bऔर\b)\s*/).filter(Boolean)) {
    const styles = findStyles(piece);
    if (!styles.length) continue;
    const k = /(?<![\p{L}])(?:a bit|a little|slightly|thoda|thodi|halka|halki|zara|थोड़ा|थोड़ी|हल्का|हल्की|ज़रा)(?![\p{L}])/u.test(piece)
      ? "a bit "
      : /(?<![\p{L}])(?:very|really|extremely|deeply|bahut|bohot|bahot|bohat|zyada|jyada|kaafi|kafi|ekdam|bilkul|बहुत|ज़्यादा|ज्यादा|काफ़ी|काफी|एकदम)(?![\p{L}])/u.test(piece)
        ? "very "
        : "";
    for (const s of styles) parts.push(k + s.name);
  }
  return [...new Set(parts)].join(", ");
}

/**
 * Rewrite plain-language instructions in a script or text into screenplay marks, line by line.
 * Everything that is not an instruction is returned unchanged.
 */
export function rewriteInstructions(input: string): string {
  if (!new RegExp(VERB, "iu").test(input)) return input;
  return input
    .split("\n")
    .map((line) => {
      const label = LABEL_RE.exec(line);
      // A speaker label stays in front, as long as the "name" is not itself the instruction.
      if (label && !hasVerb(label[1]!)) {
        const ins = readInstruction(label[2]!);
        if (ins) return `${label[1]}(${ins.mark}) ${ins.spoken}`.trimEnd();
        return line;
      }
      const ins = readInstruction(line);
      if (!ins) return line;
      const indent = /^\s*/.exec(line)![0];
      return ins.spoken ? `${indent}(${ins.mark}) ${ins.spoken}` : `${indent}(${ins.mark})`;
    })
    .join("\n");
}
