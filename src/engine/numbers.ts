/** Spoken forms of numbers, years, money, times and ordinals so the voice never stumbles on digits. */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    if (r < 20) parts.push(ONES[r]!);
    else parts.push(TENS[Math.floor(r / 10)]! + (r % 10 ? `-${ONES[r % 10]}` : ""));
  }
  return parts.join(" ");
}

/** Cardinal number in words. Handles negatives and values up to the trillions. */
export function numberToWords(value: number | bigint): string {
  let n = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (n === 0n) return "zero";
  const neg = n < 0n;
  if (neg) n = -n;
  const groups: string[] = [];
  let scale = 0;
  while (n > 0n) {
    const chunk = Number(n % 1000n);
    if (chunk) groups.unshift(`${below1000(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    n /= 1000n;
    scale++;
    if (scale >= SCALES.length && n > 0n) return (neg ? "minus " : "") + String(value).replace(/\D/g, " ").trim();
  }
  return (neg ? "minus " : "") + groups.join(" ");
}

const ORDINAL_IRREGULAR: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

export function ordinalToWords(n: number): string {
  const words = numberToWords(n);
  const m = /^(.*?)([a-z]+)$/.exec(words.replace(/-/g, "- "));
  if (!m) return words;
  const head = m[1]!.replace(/- /g, "-");
  const last = m[2]!;
  let out: string;
  if (ORDINAL_IRREGULAR[last]) out = ORDINAL_IRREGULAR[last]!;
  else if (last.endsWith("y")) out = `${last.slice(0, -1)}ieth`;
  else out = `${last}th`;
  return head + out;
}

/** Years read as pairs: 1995 "nineteen ninety-five", 2026 "twenty twenty-six", 2005 "two thousand five". */
export function yearToWords(y: number): string {
  if (y >= 2000 && y <= 2009) return y === 2000 ? "two thousand" : `two thousand ${ONES[y - 2000]}`;
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${numberToWords(hi)} hundred`;
  if (lo < 10) return `${numberToWords(hi)} oh ${ONES[lo]}`;
  return `${numberToWords(hi)} ${numberToWords(lo)}`;
}

const CURRENCY: Record<string, [string, string]> = {
  $: ["dollar", "cent"],
  "€": ["euro", "cent"],
  "£": ["pound", "pence"],
  "₹": ["rupee", "paisa"],
  "¥": ["yen", "sen"],
};

function plural(word: string, n: number): string {
  if (n === 1) return word;
  if (word === "pence") return word;
  if (word === "yen") return word;
  return `${word}s`;
}

const MONTHS = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

/** Replace digits in running text with their spoken form. */
export function expandNumbers(text: string): string {
  let t = text;

  // Currency: $5, $5.50, $1,200, €3.2 million
  t = t.replace(/([$€£₹¥])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s?(?:thousand|million|billion|trillion))?/gi, (_m, sym: string, whole: string, frac: string | undefined, scale: string | undefined) => {
    const [major, minor] = CURRENCY[sym]!;
    const w = Number(whole.replace(/,/g, ""));
    if (scale) return `${numberToWords(w)}${frac ? ` point ${[...frac].map((d) => ONES[Number(d)]).join(" ")}` : ""}${scale} ${plural(major, 2)}`;
    let out = `${numberToWords(w)} ${plural(major, w)}`;
    if (frac) {
      const c = Number(frac.padEnd(2, "0"));
      if (c) out += ` and ${numberToWords(c)} ${plural(minor, c)}`;
    }
    return out;
  });

  // Times: 10:30, 9:05, with optional am/pm
  t = t.replace(/\b(\d{1,2}):(\d{2})\s?([ap])\.?m\.?\b/gi, (_m, h: string, mm: string, ap: string) => {
    const hh = numberToWords(Number(h));
    const min = Number(mm);
    const mins = min === 0 ? "" : min < 10 ? ` oh ${ONES[min]}` : ` ${numberToWords(min)}`;
    return `${hh}${mins} ${ap.toLowerCase()} m`;
  });
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, mm: string) => {
    const min = Number(mm);
    return `${numberToWords(Number(h))}${min === 0 ? " o'clock" : min < 10 ? ` oh ${ONES[min]}` : ` ${numberToWords(min)}`}`;
  });
  t = t.replace(/\b(\d{1,2})\s?([ap])\.?m\.?\b/gi, (_m, h: string, ap: string) => `${numberToWords(Number(h))} ${ap.toLowerCase()} m`);

  // Ordinals: 1st, 22nd, 103rd
  t = t.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (_m, n: string) => ordinalToWords(Number(n)));

  // Dates like "March 5, 2024" or "5 March 2024": years are handled below; keep the day as an ordinal.
  t = t.replace(new RegExp(`\\b(${MONTHS})\\.?\\s(\\d{1,2})\\b(?![:\\d])`, "g"), (_m, mon: string, d: string) => `${mon} ${ordinalToWords(Number(d))}`);
  t = t.replace(new RegExp(`\\b(\\d{1,2})\\s(${MONTHS})\\b`, "g"), (_m, d: string, mon: string) => `${ordinalToWords(Number(d))} ${mon}`);

  // Percent and decimals
  t = t.replace(/(\d+(?:,\d{3})*)\.(\d+)/g, (_m, whole: string, frac: string) => `${numberToWords(Number(whole.replace(/,/g, "")))} point ${[...frac].map((d) => ONES[Number(d)]).join(" ")}`);

  // Years standing alone (1100-2099) when they are not part of a larger quantity
  t = t.replace(/(?<![\d,.$€£₹¥-])(1[1-9]\d{2}|20\d{2})(?![\d,]|\.\d)(?!\s?(?:percent|%|people|items|users|km|kg|miles|dollars|euros))/g, (_m, y: string) => yearToWords(Number(y)));

  // Ranges: 10-20 -> ten to twenty
  t = t.replace(/\b(\d+)\s?[-–]\s?(\d+)\b/g, (_m, a: string, b: string) => `${a} to ${b}`);

  // Remaining integers, including thousands separators
  t = t.replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (m) => numberToWords(BigInt(m.replace(/,/g, ""))));
  return t;
}
