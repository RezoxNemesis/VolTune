/**
 * Indian English. Kokoro's Hindi voices read English through the US English phonemes from espeak;
 * this moves those phonemes towards how Indian English is usually spoken, so an Indian voice sounds
 * Indian when it reads English as well as Hindi:
 *  - dental "th" becomes t and d (think → tink, this → dis), as in most Indian English;
 *  - "r" is a tap between vowels (very, carry) and a retroflex approximant elsewhere;
 *  - "v" is a w-like ʋ, and "w" stays;
 *  - the diphthongs ei and ou are pure vowels (say → seː, go → goː), and æ is closer to ɛ;
 *  - the "u" of cup is a plain schwa, and there is no secondary stress (syllable-timed rhythm).
 * The sentence melody still comes from the model.
 */

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["eɪ", "eː"],
  ["oʊ", "oː"],
  ["əʊ", "oː"],
  ["ɚ", "əɻ"],
  ["θ", "t"],
  ["ð", "d"],
  ["v", "ʋ"],
  ["æ", "ɛ"],
  ["ʌ", "ə"],
  ["ˌ", ""],
];

const VOWEL = "[aeiouəɪʊɛɔæɑɜ]";

/** Espeak en-us phonemes → Indian English phonemes (all symbols stay within the Kokoro vocabulary). */
export function indianEnglish(phonemes: string): string {
  let s = phonemes;
  for (const [from, to] of PAIRS) s = s.split(from).join(to);
  return s.replace(new RegExp(`(?<=${VOWEL})ɹ(?=${VOWEL})`, "g"), "ɾ").replace(/ɹ/g, "ɻ");
}
