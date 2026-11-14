// Reads JSON lines {id, words:[...]} on stdin; writes {id, phon:[...per word]} using VolTune's Hindi converter.
import { hindiNormalize, hindiPhonemize } from "../../src/engine/hindi";
import { hinglishToDevanagari } from "../../src/engine/hinglish";
import { indianEnglish } from "../../src/engine/accent";
import { tokenize } from "../../src/engine/phonemes";
import { phonemize } from "phonemizer";
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const eng = async (run: string) => (await phonemize(run, "en-us")).join(" ");
for await (const line of rl) {
  if (!line.trim()) continue;
  const job = JSON.parse(line) as { id: string; words: string[] };
  const phon: string[] = [];
  for (const w of job.words) phon.push(await hindiPhonemize(hindiNormalize(hinglishToDevanagari(w)), async (r) => indianEnglish(await eng(r))));
  const ids = phon.map((p) => tokenize(p).slice(1, -1));
  process.stdout.write(JSON.stringify({ id: job.id, phon, ids }) + "\n");
}
