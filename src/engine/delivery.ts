/**
 * Delivery: how a line is said. Script writers mark it the way screenplays do —
 * `Mira (whispering): come here`, `[angry]`, `*sighs*` — and VolTune turns each mark into
 * concrete controls the model responds to: pace, pitch, level, breathiness, edge, pause length,
 * and the end punctuation Kokoro uses to shape intonation. Vocal sounds such as (laughs) or
 * (gasps) are spoken as short sounds instead of being dropped.
 */

import type { Mood } from "./learned";

export interface Delivery {
  /** An acted emotion performed by the model itself (learned.ts). */
  mood?: Mood;
  /** How strongly the mood is acted, 0…2 (1 = full). */
  moodAmount?: number;
  /** Pace multiplier. */
  speed: number;
  /** Pitch shift in semitones. */
  pitch: number;
  /** Multiplier for the pause after the line. */
  pause: number;
  gain: number;
  /** 0 … 1 breathy/dark (whisper). */
  soft: number;
  /** 0 … 1 pushed/saturated (shout). */
  edge: number;
  /** Replace the end punctuation, which steers Kokoro's intonation. */
  end?: "!" | "." | "?" | "..." | "?!";
  /** Hesitant delivery: a small stumble after the first word. */
  stammer?: boolean;
  /** Names of the marks that produced this delivery, for display and tests. */
  tags: string[];
}

export const NEUTRAL: Delivery = Object.freeze({ speed: 1, pitch: 0, pause: 1, gain: 1, soft: 0, edge: 0, tags: [] as string[] }) as Delivery;

type Spec = Partial<Omit<Delivery, "tags">>;

// Emotions are acted by the model (learned.ts); `speed` tops up the tempo change the learned direction only half reaches.
const STYLES: Array<[string[], Spec]> = [
  [["whisper", "whispering", "whispers", "whispered", "hushed", "murmur", "murmuring", "murmurs", "under breath", "under her breath", "under his breath", "barely audible", "phusphusa kar", "phusphusate hue", "phusphusake", "फुसफुसा कर", "फुसफुसाते हुए"], { speed: 0.92, pitch: -0.3, gain: 0.55, soft: 0.85, pause: 1.15 }],
  [["softly", "quietly", "soft", "quiet", "gently", "gentle", "dheere se", "dhire se", "dheemi awaaz", "dheemi", "halki awaaz", "धीरे से", "धीमी आवाज़"], { speed: 0.94, pitch: -0.2, gain: 0.75, soft: 0.35, pause: 1.15 }],
  [["tender", "tenderly", "lovingly", "loving", "affectionately", "fondly", "sweetly", "romantic", "romantically", "pyaar se", "pyar se", "pyaar bhari", "pyar bhari", "pyaar", "pyar", "mamta se", "mamta", "प्यार से", "प्यार भरी", "ममता से"], { mood: "loving", speed: 0.95, gain: 0.85, soft: 0.2, pause: 1.15 }],
  [["shout", "shouting", "shouts", "yell", "yelling", "yells", "scream", "screaming", "screams", "loud", "loudly", "bellowing", "calling out", "calls out", "chilla kar", "chillate hue", "chilla ke", "cheekh kar", "cheekh ke", "zor se", "chillana", "चिल्ला कर", "चिल्लाते हुए", "चीख कर", "ज़ोर से", "जोर से"], { mood: "excited", moodAmount: 0.7, pitch: 0.5, gain: 1.45, edge: 0.55, end: "!" }],
  [["angry", "angrily", "furious", "furiously", "annoyed", "irritated", "mad", "frustrated", "snapping", "snaps", "fuming", "gusse mein", "gusse me", "gusse se", "gusse", "gussa", "gusa", "naraz", "naraaz", "chidh kar", "chidh ke", "krodh", "गुस्से में", "गुस्सा", "नाराज़", "नाराज", "क्रोध"], { mood: "angry", speed: 1.05, gain: 1.2, edge: 0.3, end: "!" }],
  [["excited", "excitedly", "thrilled", "eager", "eagerly", "enthusiastic", "elated", "josh mein", "josh se", "utsah se", "जोश में", "उत्साह से"], { mood: "excited", speed: 1.07, gain: 1.1, end: "!" }],
  [["happy", "happily", "cheerful", "cheerfully", "joyful", "delighted", "beaming", "grinning", "smiling", "khush", "khushi se", "khushi khushi", "khushi", "muskurate hue", "muskura ke", "ख़ुश", "खुश", "खुशी से", "ख़ुशी से", "मुस्कुराते हुए"], { mood: "happy", speed: 1.05, gain: 1.05 }],
  [["laughing", "through laughter", "amused", "giggling", "chuckling", "playful", "playfully", "teasing", "hanste hue", "hans ke", "hans kar", "mazaak mein", "mazak mein", "हँसते हुए", "हंसते हुए", "मज़ाक में"], { mood: "happy", moodAmount: 0.8, pitch: 0.3, gain: 1.05 }],
  [["sad", "sadly", "upset", "hurt", "heartbroken", "grieving", "melancholy", "sorrowful", "udaas", "udas", "udaasi se", "udaasi", "dukhi", "dukh se", "dukh", "उदास", "दुखी", "दुख से"], { mood: "sad", speed: 0.92, gain: 0.85, pause: 1.35, end: "." }],
  [["crying", "tearful", "tearfully", "sobbing", "choked up", "weeping", "in tears", "rote hue", "rote huye", "rote rote", "ro kar", "rokar", "ro ke", "rote", "rona", "रोते हुए", "रोते-रोते", "रो कर"], { mood: "crying", speed: 0.89, gain: 0.8, soft: 0.25, pause: 1.45, end: "." }],
  // "emotional hoke bolna hai": moved, close to tears
  [["emotional", "emotionally", "emotional hoke", "emotional hokar", "bhavuk", "bhaavuk", "bhavuk hoke", "jazbaati", "jazbati", "dil se", "moved", "touched", "emotion", "emotions", "emotion se", "emotion ke saath", "with emotion", "with feeling", "full emotion", "feel karke", "feel kar ke", "भावुक", "भावुक होकर", "इमोशनल", "दिल से"], { mood: "crying", moodAmount: 0.75, speed: 0.92, gain: 0.85, soft: 0.15, pause: 1.35, end: "." }],
  // Grief and regret: "dard bhari awaaz mein", "pachtawe ke saath", "Kaash…" lines
  [["regretful", "regret", "remorseful", "guilty", "painful", "in pain", "pained", "dard bhari", "dard bhare", "dard se", "dard", "gham", "gam", "gham se", "afsos", "afsos se", "pachtawa", "pachtava", "pachhtava", "pachtawe", "toote dil se", "toota dil", "dard bhari awaaz", "दर्द", "दर्द भरी", "दर्द से", "ग़म", "गम", "अफ़सोस", "अफसोस", "पछतावा", "पछतावे"], { mood: "sad", moodAmount: 1.2, speed: 0.9, gain: 0.82, soft: 0.2, pause: 1.45, end: "." }],
  [["sobbing hard", "sisakte hue", "sisak kar", "sisakte huye", "phoot phoot kar", "aansoo", "aansu", "aansuon ke saath", "सिसकते हुए", "फूट फूट कर", "आँसू"], { mood: "crying", moodAmount: 1.3, speed: 0.86, gain: 0.78, soft: 0.3, pause: 1.55, end: "." }],
  [["nervous", "nervously", "anxious", "anxiously", "hesitant", "hesitantly", "unsure", "stammering", "stuttering", "shy", "shyly", "awkward", "awkwardly", "flustered", "embarrassed", "sharmate hue", "शर्माते हुए", "ghabra kar", "घबरा कर"], { mood: "scared", moodAmount: 0.4, pause: 1.25, stammer: true }],
  [["scared", "afraid", "terrified", "frightened", "panicked", "panicking", "fearful", "alarmed", "darr ke", "dar ke", "darte hue", "dara hua", "dari hui", "डर के", "डरते हुए", "डरा हुआ", "डरी हुई"], { mood: "scared", speed: 1.1, gain: 0.95, soft: 0.2, end: "!" }],
  [["calm", "calmly", "warm", "warmly", "kind", "kindly", "reassuring", "soothing", "relaxed", "shaanti se", "shanti se", "शांति से"], { mood: "loving", moodAmount: 0.5, pause: 1.15 }],
  [["serious", "seriously", "firm", "firmly", "stern", "sternly", "cold", "coldly", "flat", "flatly", "grim", "gambhir", "gambheer", "sakhti se", "गंभीर", "सख़्ती से"], { mood: "serious", speed: 0.97, end: "." }],
  [["sarcastic", "sarcastically", "dry", "dryly", "deadpan", "mocking", "smug"], { mood: "serious", moodAmount: 0.5, speed: 0.95, end: "." }],
  [["surprised", "shocked", "amazed", "astonished", "stunned", "startled", "in disbelief", "hairani se", "hairaan", "hairan", "hairaani se", "chaunk kar", "chaunk ke", "chonk kar", "हैरानी से", "हैरान", "चौंक कर"], { mood: "surprised", end: "!" }],
  [["tired", "sleepy", "exhausted", "bored", "drowsy", "weary", "yawning", "thaka hua", "thaki hui", "thake hue", "थका हुआ", "थकी हुई"], { mood: "tired", speed: 0.91, gain: 0.8, soft: 0.25, pause: 1.4 }],
  [["confident", "confidently", "proud", "proudly", "bold", "boldly", "determined"], { mood: "serious", moodAmount: 0.3, gain: 1.1 }],
  [["pleading", "begging", "desperate", "desperately", "gidgida kar", "minnat karte hue", "गिड़गिड़ा कर", "विनती करते हुए"], { mood: "pleading", speed: 0.94, end: "..." }],
  [["mysterious", "mysteriously", "ominous", "ominously", "dramatic", "dramatically", "menacing", "menacingly", "dark"], { mood: "serious", moodAmount: 0.6, speed: 0.92, pitch: -0.5, pause: 1.3 }],
  [["curious", "curiously", "wondering", "puzzled", "confused"], { speed: 0.97, pitch: 0.5, end: "?" }],
  [["slow", "slowly", "deliberately", "measured"], { speed: 0.85, pause: 1.2 }],
  [["fast", "quickly", "rushed", "hurried", "hurriedly", "rapidly", "breathless", "breathlessly"], { speed: 1.15, pause: 0.8 }],
];

/** Vocal sounds a direction can ask for. They are spoken, briefly, in the speaker's own voice. */
const SOUNDS: Array<[string[], string, Spec]> = [
  [["laughs", "laugh", "laughter", "bursts out laughing", "laughs out loud"], "Haha!", { speed: 1.05, pitch: 0.8 }],
  [["chuckles", "chuckle", "snickers", "smirks"], "Heh.", { speed: 0.95 }],
  [["giggles", "giggle"], "Hehe!", { speed: 1.08, pitch: 1 }],
  [["sighs", "sigh", "exhales"], "Hhh...", { mood: "tired", moodAmount: 0.6, speed: 0.85, gain: 0.7, soft: 0.6 }],
  [["gasps", "gasp"], "Oh!", { speed: 1.05, pitch: 1.2 }],
  [["groans", "groan"], "Ugh.", { speed: 0.9, pitch: -0.6 }],
  [["clears throat", "clears her throat", "clears his throat", "ahem"], "Ahem.", { speed: 0.95 }],
  [["hums", "hum", "hmm", "thinks", "thinking", "pondering"], "Hmm...", { speed: 0.9 }],
  [["sniffs", "sniffles", "sniff"], "Hm.", { speed: 0.9, gain: 0.7, soft: 0.5 }],
  [["coughs", "cough"], "Ahem!", { speed: 1 }],
  [["screams", "shrieks"], "Aaah!", { speed: 1.05, pitch: 2, gain: 1.4, edge: 0.6 }],
  [["yawns", "yawn"], "Haaah...", { speed: 0.8, soft: 0.4, gain: 0.8 }],
  [["wow"], "Wow!", { pitch: 1 }],
];

const STYLE_INDEX = new Map<string, Spec & { name: string }>();
for (const [names, spec] of STYLES) for (const n of names) STYLE_INDEX.set(n, { ...spec, name: names[0]! });
const SOUND_INDEX = new Map<string, { say: string; spec: Spec; name: string }>();
for (const [names, say, spec] of SOUNDS) for (const n of names) SOUND_INDEX.set(n, { say, spec, name: names[0]! });

export type Direction =
  | { kind: "style"; delivery: Delivery }
  | { kind: "sound"; say: string; delivery: Delivery }
  | { kind: "pause"; ms: number }
  | { kind: "reset" }
  | { kind: "action"; text: string };

// Drops quotes and sentence punctuation, but keeps decimal points ("pause 0.5s").
const clean = (s: string) => s.toLowerCase().replace(/[“”"'’!?]|\.(?!\d)|(?<!\d)\./g, "").replace(/\s+/g, " ").trim();

function asDelivery(spec: Spec, name: string): Delivery {
  const d: Delivery = { ...NEUTRAL, ...spec, tags: [name] };
  if (d.mood && d.moodAmount === undefined) d.moodAmount = 1;
  return d;
}

/** Parse the inside of one direction: "(whispering)", "[pause 2s]", "*laughs*", "(to Jon, angrily)". */
export function readDirection(raw: string): Direction[] {
  const s = clean(raw);
  if (!s) return [];
  const pause = /^(?:(long|short)\s+)?(?:pause|beat|silence|wait)(?:\s+(?:for\s+)?([\d.]+)\s*(ms|s|sec|secs|seconds?)?)?$/.exec(s);
  if (pause) {
    let ms = pause[1] === "long" ? 1400 : pause[1] === "short" ? 350 : 700;
    if (pause[2]) ms = parseFloat(pause[2]) * (pause[3] === "ms" ? 1 : 1000);
    return [{ kind: "pause", ms: Math.min(10_000, Math.max(50, Math.round(ms))) }];
  }
  if (/^(normal|normally|neutral|plain|back to normal)$/.test(s)) return [{ kind: "reset" }];
  const out: Direction[] = [];
  // "to Jon, angrily" / "softly and slowly" / "bahut udaas aur dheere se" → look at every phrase.
  const phrases = s.split(/\s*(?:,|;|\band\b|\bthen\b|\bwhile\b|\baur\b|\bphir\b|\bऔर\b)\s*/).filter(Boolean);
  let matched = false;
  for (const p of phrases) {
    const k = intensity(p);
    const words = p.replace(LESS_RE, "").replace(MORE_RE, "").trim();
    const snd = SOUND_INDEX.get(words);
    if (snd) {
      out.push({ kind: "sound", say: snd.say, delivery: asDelivery(snd.spec, snd.name) });
      matched = true;
      continue;
    }
    const st = STYLE_INDEX.get(words) ?? STYLE_INDEX.get(words.split(" ").pop() ?? "") ?? STYLE_INDEX.get(words.split(" ")[0] ?? "");
    const found = st ? [st] : findStyles(words);
    for (const f of found) {
      const d = asDelivery(f, f.name);
      if (k !== 1) Object.assign(d, soften(d, k));
      out.push({ kind: "style", delivery: d });
      matched = true;
    }
  }
  if (!matched) out.push({ kind: "action", text: raw.trim() });
  return out;
}

// Intensity words, English and Hinglish: "a bit sad", "thoda gussa", "bahut emotional", "ekdam dheere se".
const LESS_RE = /^(?:(?:a bit|a little|slightly|somewhat|kinda|thoda sa|thodi si|thoda|thodi|halka sa|halki si|halka|halki|zara sa|zara|थोड़ा|थोड़ी|हल्का|हल्की|ज़रा)\s+)+/;
const MORE_RE = /^(?:(?:very|really|so|extremely|super|deeply|truly|totally|bahut|bohot|bahot|bohat|bahut hi|zyada|jyada|kaafi|kafi|ekdam|bilkul|poori tarah|pura|बहुत|ज़्यादा|ज्यादा|काफ़ी|काफी|एकदम|बिल्कुल)\s+)+/;
function intensity(p: string): number {
  if (LESS_RE.test(p)) return 0.5;
  const more = MORE_RE.exec(p);
  if (more) return /extremely|super|bahut hi|ekdam|bilkul|poori|पूरी|एकदम/.test(more[0]) || more[0].trim().split(/\s+/).length > 1 ? 1.8 : 1.5;
  return 1;
}

// Words around a mood that carry no meaning of their own: "(udaas awaaz mein)", "(emotional hoke)", "(in a sad tone)".
const FILLER = new Set(["hoke", "hokar", "ho", "kar", "ke", "ki", "ka", "ko", "se", "mein", "me", "main", "mai", "wala", "wali", "wale", "andaaz", "andaz", "awaaz", "awaz", "aawaz", "aawaaz", "tone", "voice", "way", "style", "manner", "mood", "with", "in", "a", "an", "the", "like", "sound", "sounding", "saath", "sath", "hue", "huye", "hua", "hui", "bhari", "bhara", "bhare", "आवाज़", "आवाज", "में", "से", "होकर", "होके", "के", "साथ", "अंदाज़"]);

/**
 * Find moods in free text, forgiving spelling slips ("emtional", "gusee", "udaass"):
 * whole phrases first, then each meaningful word, matched exactly or within a small edit distance.
 */
export function findStyles(text: string): Array<Spec & { name: string }> {
  const s = clean(text);
  if (!s) return [];
  const exact = STYLE_INDEX.get(s);
  if (exact) return [exact];
  const words = s.split(" ");
  const out: Array<Spec & { name: string }> = [];
  const seen = new Set<string>();
  const add = (st: (Spec & { name: string }) | undefined) => {
    if (st && !seen.has(st.name)) {
      seen.add(st.name);
      out.push(st);
    }
  };
  for (let i = 0; i < words.length; i++) {
    // Longest known phrase starting here ("dard bhari awaaz", "rote hue"), else the word itself.
    let hit: (Spec & { name: string }) | undefined;
    let used = 1;
    for (let n = Math.min(4, words.length - i); n >= 2 && !hit; n--) {
      const st = STYLE_INDEX.get(words.slice(i, i + n).join(" "));
      if (st) [hit, used] = [st, n];
    }
    const w = words[i]!;
    if (!hit && !FILLER.has(w)) hit = STYLE_INDEX.get(w) ?? fuzzyStyle(w);
    add(hit);
    i += used - 1;
  }
  return out;
}

const SINGLE_WORDS = [...STYLE_INDEX.keys()].filter((k) => !k.includes(" "));
function fuzzyStyle(w: string): (Spec & { name: string }) | undefined {
  if (w.length < 5 || !/^[a-z]+$/.test(w)) return undefined;
  const limit = w.length >= 8 ? 2 : 1;
  let best: string | undefined;
  let bestD = limit + 1;
  for (const k of SINGLE_WORDS) {
    if (Math.abs(k.length - w.length) > limit || k.length < 5) continue;
    const d = editDistance(w, k, limit);
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best ? STYLE_INDEX.get(best) : undefined;
}

/** Damerau–Levenshtein distance (adjacent swaps count once), giving up past `limit`. */
export function editDistance(a: string, b: string, limit = 3): number {
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

/** Scale a delivery towards (k < 1) or beyond (k > 1) neutral. */
export function soften(d: Delivery, k: number): Delivery {
  const lerp = (n: number, v: number) => n + (v - n) * k;
  return {
    ...d,
    speed: lerp(1, d.speed),
    pitch: lerp(0, d.pitch),
    pause: lerp(1, d.pause),
    gain: lerp(1, d.gain),
    soft: Math.min(1, lerp(0, d.soft)),
    edge: Math.min(1, lerp(0, d.edge)),
    ...(d.mood ? { moodAmount: Math.min(2, Math.max(0, (d.moodAmount ?? 1) * k)) } : {}),
  };
}

/** Combine several marks, e.g. "(nervous, whispering)". */
export function combine(list: readonly Delivery[]): Delivery {
  const out: Delivery = { ...NEUTRAL, tags: [] };
  for (const d of list) {
    out.speed *= d.speed;
    out.pitch += d.pitch;
    out.pause *= d.pause;
    out.gain *= d.gain;
    out.soft = Math.max(out.soft, d.soft);
    out.edge = Math.max(out.edge, d.edge);
    if (d.end) out.end = out.end === "!" && d.end === "?" ? "?!" : d.end;
    if (d.stammer) out.stammer = true;
    // One acted mood per line: the strongest mark wins ("(sad, whispering)" acts sad and whispers).
    if (d.mood && (d.moodAmount ?? 1) >= (out.moodAmount ?? 0)) {
      out.mood = d.mood;
      out.moodAmount = d.moodAmount ?? 1;
    }
    out.tags.push(...d.tags);
  }
  out.speed = Math.min(1.5, Math.max(0.6, out.speed));
  out.pitch = Math.min(4, Math.max(-4, out.pitch));
  out.gain = Math.min(1.8, Math.max(0.35, out.gain));
  return out;
}

/** Shape the words so Kokoro's intonation follows the delivery. */
export function applyToText(text: string, d: Delivery): string {
  let t = text.trim();
  if (!t) return t;
  if (d.stammer) {
    const m = /^([A-Za-z']{1,8})(\s+)(\S)/.exec(t);
    if (m && t.length > 12) t = `${m[1]}... ${m[1]!.toLowerCase() === "i" ? "I" : m[1]!.toLowerCase()}${m[2]}${t.slice(m[0].length - 1)}`;
  }
  if (d.end) {
    const endsQ = /\?["')\]]*$/.test(t);
    const core = t.replace(/[.!?…,;:]+(["')\]]*)$/, "$1");
    const tail = /(["')\]]*)$/.exec(core)?.[1] ?? "";
    const body = core.slice(0, core.length - tail.length);
    let end: string = d.end;
    // A question stays a question; a shouted question gets both marks.
    if (endsQ && (end === "!" || end === ".")) end = end === "!" ? "?!" : "?";
    t = body + end + tail;
  }
  return t;
}
