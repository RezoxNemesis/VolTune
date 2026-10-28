/**
 * Text → phonemes → token ids for Kokoro-82M, independent of any model runtime.
 *
 * The normalisation and punctuation-preserving phonemisation follow kokoro-js 1.2.1 (Apache 2.0,
 * hexgrad / Xenova) so the browser, the Android app and the Node server all feed the model the
 * exact same tokens. Owning this step lets VolTune use blended voices and per-line delivery,
 * which kokoro-js's own `generate()` does not allow.
 */

/** Kokoro-82M v1.0 symbol table (from the model's config.json). Id 0 is the start/end pad. */
export const VOCAB: Readonly<Record<string, number>> = Object.freeze({
  ";": 1, ":": 2, ",": 3, ".": 4, "!": 5, "?": 6, "—": 9, "…": 10, '"': 11, "(": 12, ")": 13, "“": 14, "”": 15, " ": 16,
  "̃": 17, "ʣ": 18, "ʥ": 19, "ʦ": 20, "ʨ": 21, "ᵝ": 22, "ꭧ": 23, A: 24, I: 25, O: 31, Q: 33, S: 35, T: 36, W: 39, Y: 41,
  "ᵊ": 42, a: 43, b: 44, c: 45, d: 46, e: 47, f: 48, h: 50, i: 51, j: 52, k: 53, l: 54, m: 55, n: 56, o: 57, p: 58, q: 59,
  r: 60, s: 61, t: 62, u: 63, v: 64, w: 65, x: 66, y: 67, z: 68, "ɑ": 69, "ɐ": 70, "ɒ": 71, "æ": 72, "β": 75, "ɔ": 76,
  "ɕ": 77, "ç": 78, "ɖ": 80, "ð": 81, "ʤ": 82, "ə": 83, "ɚ": 85, "ɛ": 86, "ɜ": 87, "ɟ": 90, "ɡ": 92, "ɥ": 99, "ɨ": 101,
  "ɪ": 102, "ʝ": 103, "ɯ": 110, "ɰ": 111, "ŋ": 112, "ɳ": 113, "ɲ": 114, "ɴ": 115, "ø": 116, "ɸ": 118, "θ": 119, "œ": 120,
  "ɹ": 123, "ɾ": 125, "ɻ": 126, "ʁ": 128, "ɽ": 129, "ʂ": 130, "ʃ": 131, "ʈ": 132, "ʧ": 133, "ʊ": 135, "ʋ": 136, "ʌ": 138,
  "ɣ": 139, "ɤ": 140, "χ": 142, "ʎ": 143, "ʒ": 147, "ʔ": 148, "ˈ": 156, "ˌ": 157, "ː": 158, "ʰ": 162, "ʲ": 164, "↓": 169,
  "→": 171, "↗": 172, "↘": 173, "ᵻ": 177,
});

/** The model reads at most 512 positions, two of which are the pads. */
export const MAX_TOKENS = 510;

/** Phoneme string → token ids, padded with 0 at both ends. Unknown symbols are skipped. */
export function tokenize(phonemes: string): number[] {
  const ids: number[] = [0];
  for (const ch of phonemes) {
    const id = VOCAB[ch];
    if (id !== undefined) ids.push(id);
    if (ids.length > MAX_TOKENS) break;
  }
  ids.push(0);
  return ids;
}

/* ---------- normalisation (ported from kokoro-js) ---------- */

function splitNum(num: string): string {
  if (num.includes(".")) return num;
  if (num.includes(":")) {
    const [h, m] = num.split(":").map(Number) as [number, number];
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = parseInt(num.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return num;
  const left = num.slice(0, 2);
  const right = parseInt(num.slice(2, 4), 10);
  const suffix = num.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(m: string): string {
  const bill = m[0] === "$" ? "dollar" : "pound";
  if (isNaN(Number(m.slice(1)))) return `${m.slice(1)} ${bill}s`;
  if (!m.includes(".")) {
    const s = m.slice(1) === "1" ? "" : "s";
    return `${m.slice(1)} ${bill}${s}`;
  }
  const [b, c] = m.slice(1).split(".") as [string, string];
  const d = parseInt(c.padEnd(2, "0"), 10);
  const coins = m[0] === "$" ? (d === 1 ? "cent" : "cents") : d === 1 ? "penny" : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}

function pointNum(n: string): string {
  const [a, b] = n.split(".") as [string, string];
  return `${a} point ${b.split("").join(" ")}`;
}

export function kokoroNormalize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RUN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`, "g");

/** Split text into runs of punctuation (kept verbatim) and words (sent to the phonemizer). */
export function splitPunctuation(text: string): Array<{ match: boolean; text: string }> {
  const out: Array<{ match: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(PUNCT_RUN)) {
    const s = m[0];
    if (last < m.index!) out.push({ match: false, text: text.slice(last, m.index) });
    if (s.length > 0) out.push({ match: true, text: s });
    last = m.index! + s.length;
  }
  if (last < text.length) out.push({ match: false, text: text.slice(last) });
  return out;
}

export type Phonemizer = (text: string, lang: string) => Promise<string[]>;

/** English text → Kokoro phonemes. `lang` is "a" (American) or "b" (British). */
export async function englishPhonemes(text: string, lang: "a" | "b", phonemize: Phonemizer, normalize = true): Promise<string> {
  const src = normalize ? kokoroNormalize(text) : text;
  const espeak = lang === "a" ? "en-us" : "en";
  const parts = await Promise.all(splitPunctuation(src).map(async ({ match, text: t }) => (match ? t : (await phonemize(t, espeak)).join(" "))));
  let ph = parts
    .join("")
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (lang === "a") ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return ph.trim();
}
