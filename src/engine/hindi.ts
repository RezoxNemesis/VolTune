/**
 * Hindi support: Devanagari numbers and text normalisation, and a rule-based Devanagari → phoneme
 * converter that produces the espeak-style IPA the Kokoro Hindi voices were trained on.
 * The browser phonemizer bundled with kokoro-js only knows English, so Hindi is converted here.
 */

export const DEVANAGARI = /[ऀ-ॿ]/;
export const hasDevanagari = (s: string): boolean => DEVANAGARI.test(s);

/** Share of letters in `s` that are Devanagari. */
export function devanagariShare(s: string): number {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  return letters.filter((c) => DEVANAGARI.test(c)).length / letters.length;
}

/* ---------- numbers ---------- */

const N0_99 =
  "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे".split(" ");

/** Cardinal number in Hindi words, using the Indian grouping (hazaar, lakh, crore, arab). */
export function hindiNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 100) return N0_99[n]!;
  const units: Array<[number, string]> = [
    [1_000_000_000, "अरब"],
    [10_000_000, "करोड़"],
    [100_000, "लाख"],
    [1_000, "हज़ार"],
    [100, "सौ"],
  ];
  for (const [size, name] of units) {
    if (n >= size) {
      const q = Math.floor(n / size);
      const r = n % size;
      return `${hindiNumber(q)} ${name}${r ? ` ${hindiNumber(r)}` : ""}`;
    }
  }
  return N0_99[n]!;
}

const DIGIT_MAP: Record<string, string> = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

/** Turn digits, rupee amounts, percentages and decimals into Hindi words. */
export function hindiNormalize(line: string): string {
  let t = line.replace(/[०-९]/g, (d) => DIGIT_MAP[d]!);
  t = t.replace(/(?:₹|रु\.?|Rs\.?)\s?(\d[\d,]*)(?:\.(\d{1,2}))?/g, (_m, w: string, p: string | undefined) => {
    const rupees = hindiNumber(Number(w.replace(/,/g, "")));
    const paise = p && Number(p.padEnd(2, "0")) ? ` ${hindiNumber(Number(p.padEnd(2, "0")))} पैसे` : "";
    return `${rupees} रुपये${paise}`;
  });
  t = t.replace(/(\d[\d,]*)\.(\d+)/g, (_m, w: string, f: string) => `${hindiNumber(Number(w.replace(/,/g, "")))} दशमलव ${[...f].map((d) => hindiNumber(Number(d))).join(" ")}`);
  t = t.replace(/(\d[\d,]*)\s?%/g, (_m, w: string) => `${hindiNumber(Number(w.replace(/,/g, "")))} प्रतिशत`);
  t = t.replace(/\d[\d,]*/g, (m) => hindiNumber(Number(m.replace(/,/g, ""))));
  return t.replace(/%/g, " प्रतिशत").replace(/&/g, " और ").replace(/[ \t]+/g, " ");
}

/* ---------- Devanagari → phonemes ---------- */

const CONS: Record<string, string> = {
  क: "k", ख: "kʰ", ग: "ɡ", घ: "ɡʰ", ङ: "ŋ",
  च: "ʧ", छ: "ʧʰ", ज: "ʤ", झ: "ʤʰ", ञ: "ɲ",
  ट: "ʈ", ठ: "ʈʰ", ड: "ɖ", ढ: "ɖʰ", ण: "ɳ",
  त: "t", थ: "tʰ", द: "d", ध: "dʰ", न: "n",
  प: "p", फ: "pʰ", ब: "b", भ: "bʰ", म: "m",
  य: "j", र: "ɾ", ल: "l", व: "ʋ", श: "ʃ", ष: "ʂ", स: "s", ह: "h", ळ: "l",
};
// With a nukta (़): borrowed sounds and flapped ड़ ढ़
const NUKTA: Record<string, string> = { क: "k", ख: "x", ग: "ɣ", ज: "z", फ: "f", ड: "ɽ", ढ: "ɽʰ", य: "j", न: "n", र: "ɾ" };
const INDEP: Record<string, string> = { अ: "ə", आ: "aː", इ: "ɪ", ई: "iː", उ: "ʊ", ऊ: "uː", ऋ: "ɾɪ", ए: "eː", ऐ: "ɛː", ओ: "oː", औ: "ɔː", ऑ: "ɔ", ऍ: "ɛ" };
const MATRA: Record<string, string> = { "ा": "aː", "ि": "ɪ", "ी": "iː", "ु": "ʊ", "ू": "uː", "ृ": "ɾɪ", "े": "eː", "ै": "ɛː", "ो": "oː", "ौ": "ɔː", "ॉ": "ɔ", "ॅ": "ɛ" };
const VIRAMA = "्";
const NUKTA_MARK = "़";
const TILDE = "̃";

type Vowel = { kind: "inh" } | { kind: "ph"; ph: string } | { kind: "none" };
interface Akshara {
  cons: string[];
  vowel: Vowel;
  nasal: boolean;
  /** Homorganic nasal consonant written by an anusvara before another consonant (बंदर → bəndər). */
  nasalCoda?: string;
  coda: string;
}

function mergeCluster(cons: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < cons.length; i++) {
    const c = cons[i]!;
    const n = cons[i + 1];
    if (c === "k" && n === "ʂ") {
      out.push("kʃ");
      i++;
    } else if (c === "ʤ" && n === "ɲ") {
      out.push("ɡj");
      i++;
    } else if (n === c && c.length <= 2 && !c.endsWith("ʰ")) {
      out.push(`${c}ː`);
      i++;
    } else out.push(c);
  }
  return out.join("");
}

function parseWord(word: string): Akshara[] {
  const chars = [...word.normalize("NFD")];
  const out: Akshara[] = [];
  let i = 0;
  const consAt = (k: number): string | undefined => {
    const ch = chars[k];
    if (ch === undefined || !(ch in CONS)) return undefined;
    return chars[k + 1] === NUKTA_MARK ? NUKTA[ch] ?? CONS[ch] : CONS[ch];
  };
  const width = (k: number) => (chars[k + 1] === NUKTA_MARK ? 2 : 1);
  while (i < chars.length) {
    const ch = chars[i]!;
    const c = consAt(i);
    if (c !== undefined) {
      const a: Akshara = { cons: [c], vowel: { kind: "inh" }, nasal: false, coda: "" };
      i += width(i);
      while (chars[i] === VIRAMA) {
        const next = consAt(i + 1);
        if (next === undefined) {
          a.vowel = { kind: "none" };
          i++;
          break;
        }
        a.cons.push(next);
        i += 1 + width(i + 1);
      }
      const m = chars[i];
      if (m !== undefined && m in MATRA && a.vowel.kind === "inh") {
        a.vowel = { kind: "ph", ph: MATRA[m]! };
        i++;
      }
      out.push(a);
    } else if (ch in INDEP) {
      out.push({ cons: [], vowel: { kind: "ph", ph: INDEP[ch]! }, nasal: false, coda: "" });
      i++;
    } else if (ch === "ं" || ch === "ँ") {
      // Anusvara before a consonant is a nasal consonant that shares its place (बंदर → bəndər, पंजाब → pəndʒaːb).
      // Word-final or before a vowel it is a nasalised vowel (हूँ, मैं).
      // After a long vowel the anusvara is a nasalised vowel (मैंने → mɛ̃ːne, not mɛːnneː).
      const last = out[out.length - 1];
      const nxt = ch === "ं" ? consAt(i + 1) : undefined;
      const longVowel = last?.vowel.kind === "ph" && last.vowel.ph.endsWith("ː");
      if (last && nxt !== undefined && !longVowel) last.nasalCoda = homorganicNasal(nxt);
      else if (last) last.nasal = true;
      i++;
    } else if (ch === "ः") {
      if (out.length) out[out.length - 1]!.coda += "h";
      i++;
    } else i++;
  }
  return out;
}

/** Drop the inherent "a" where Hindi speakers do not pronounce it (word-final, and V C a C V). */
function deleteSchwas(a: Akshara[]): void {
  if (a.length < 2) return;
  const alive = (x: Akshara) => x.vowel.kind !== "none";
  for (let i = a.length - 1; i >= 0; i--) {
    const cur = a[i]!;
    if (cur.vowel.kind !== "inh") continue;
    if (i === a.length - 1) {
      cur.vowel = { kind: "none" };
      continue;
    }
    const next = a[i + 1]!;
    // A schwa after a closed syllable (बंदर, संस्कृत) is kept, so the nasal coda does not lose its vowel.
    const closedBefore = Boolean(a[i - 1]?.nasalCoda);
    if (i > 0 && next.cons.length === 1 && alive(next) && !closedBefore) cur.vowel = { kind: "none" };
  }
}

/** The nasal consonant that an anusvara turns into before the given consonant (espeak-style). */
function homorganicNasal(c: string): string {
  const base = c.replace(/ʰ$/, "");
  // Before a velar (k, g, h) the nasal is ŋ (सिंह → sɪŋɦ). Before palatal affricates common speech uses n (पंजाब → pəndʒaːb).
  if (["k", "ɡ", "x", "ɣ", "h"].includes(base)) return "ŋ";
  if (["ʈ", "ɖ", "ɽ"].includes(base)) return "ɳ";
  if (["p", "b", "f", "m"].includes(base)) return "m";
  return "n";
}

/**
 * Hindi has no English-style word stress: the inherent vowel is a plain schwa and the
 * sentence melody comes from the model, so no stress marks are written.
 */
function render(a: Akshara[]): string {
  const alive = a.map((x, i) => (x.vowel.kind !== "none" ? i : -1)).filter((i) => i >= 0);
  const lastAlive = alive[alive.length - 1];
  let s = "";
  a.forEach((x, i) => {
    s += mergeCluster(x.cons);
    let v = x.vowel.kind === "inh" ? "ə" : x.vowel.kind === "ph" ? x.vowel.ph : "";
    // A long "ee" at the end of a longer word is short in speech (hindi, kahani).
    if (v === "iː" && i === lastAlive && alive.length >= 2 && !x.nasal) v = "i";
    if (x.nasal) {
      // Nasalised vowels keep their length (हूँ → hũː, में → mẽː), as in the espeak reference.
      if (!v) v = "n";
      else {
        const long = v.endsWith("ː");
        const base = long ? v.slice(0, -1) : v;
        v = `${base}${TILDE}${long ? "ː" : ""}`;
      }
    }
    s += v + (x.nasalCoda ?? "") + x.coda;
  });
  return s;
}

/** Phonemes for one run of Devanagari text (words separated by spaces). */
/**
 * Fixed pronunciations for the most frequent Hindi words, where the letter rules alone are unreliable
 * (auxiliaries, postpositions, pronouns and common verb forms). They make grammatical endings such as
 * है, हैं, हूँ, में, रहा/रही/रहे and चाहिए sound right every time.
 */
const LEXICON: Record<string, string> = {
  है: "hɛː", हैं: "hɛ̃ː", हूँ: "hũː", हूं: "hũː", हो: "hoː", था: "tʰaː", थी: "tʰiː", थे: "tʰeː",
  में: "mẽː", मैं: "mɛ̃ː", मुझे: "mʊdʒʰeː", मुझको: "mʊdʒʰkoː", हम: "həm", हमें: "həmẽː", तुम: "tʊm", तुम्हें: "tʊmʰẽː", आप: "aːp", आपका: "aːpkaː",
  यह: "jəh", वह: "vəh", ये: "jeː", वो: "voː", को: "koː", से: "seː", का: "kaː", की: "kiː", के: "keː",
  कि: "kɪ", और: "ɔɾ", या: "jaː", तो: "toː", भी: "biː", ही: "hiː", नहीं: "nəhĩː", क्या: "kjaː", क्यों: "kjõː", कैसे: "kɛseː",
  रहा: "ɾəhaː", रही: "ɾəhiː", रहे: "ɾəheː", गया: "ɡəjaː", गई: "ɡəiː", गए: "ɡəeː", करो: "kəɾo", कर: "kəɾ", करना: "kəɾnaː", किया: "kɪjaː",
  चाहिए: "tʃaːhie", होगा: "hoːɡaː", होगी: "hoːɡiː", हुआ: "hʊaː", लोग: "loːɡ", कल: "kəl", आज: "aːdʒ", अब: "əb", बहुत: "bəhʊt", सब: "səb",
};

export function devanagariToPhonemes(text: string): string {
  return text
    .normalize("NFC")
    .split(/(\s+)/)
    .map((w) => {
      if (/\s/.test(w) || w === "") return w;
      const fixed = LEXICON[w];
      return fixed ?? render(deleteSchwasCopy(parseWord(w)));
    })
    .join("");
}

function deleteSchwasCopy(a: Akshara[]): Akshara[] {
  deleteSchwas(a);
  return a;
}

export interface ScriptRun {
  script: "hindi" | "other";
  text: string;
}

/** Split text into Devanagari runs and everything else (English words, digits, punctuation). */
export function splitScripts(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  const re = /[ऀ-ॿ]+(?:[\s‌‍]+[ऀ-ॿ]+)*|[^ऀ-ॿ]+/g;
  for (const m of text.matchAll(re)) runs.push({ script: DEVANAGARI.test(m[0]) ? "hindi" : "other", text: m[0] });
  return runs;
}

/**
 * Phonemes for mixed Hindi/English text. `english` converts a Latin-script run (the worker supplies
 * the English phonemizer). Danda marks become full stops.
 */
export async function hindiPhonemize(text: string, english: (run: string) => Promise<string>): Promise<string> {
  const parts: string[] = [];
  for (const run of splitScripts(text.replace(/[।॥]/g, ". "))) {
    if (run.script === "hindi") parts.push(devanagariToPhonemes(run.text));
    else if (/[A-Za-z]/.test(run.text)) {
      // Keep the punctuation around English words; phonemize only the letters.
      const pieces = run.text.split(/([A-Za-z][A-Za-z0-9'’ -]*[A-Za-z0-9]|[A-Za-z])/);
      for (const piece of pieces) parts.push(/[A-Za-z]/.test(piece) ? (await english(piece)).trim() : piece);
    } else parts.push(run.text);
  }
  return parts.join("").replace(/ {2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}
