/**
 * VolTune Studio: expressive, natural speech from Chatterbox Multilingual (Resemble AI, MIT licence, 0.5B),
 * run through ONNX Runtime (onnxruntime-node on a PC, onnxruntime-web in the desktop app).
 *
 * VolTune's own voices still decide who is speaking: a short reference clip is rendered with Kokoro in the
 * chosen voice and mood, and Chatterbox takes its timbre and acting from that clip, then speaks the line
 * itself with natural rhythm, pauses and pronunciation. No real person's voice is involved.
 *
 * This file is the engine logic only, shared by every host: tokenizer, text preparation, the speech-token
 * loop (classifier-free guidance, sampling, repetition penalty), and Chatterbox's alignment checks, which
 * stop the line when the words are done and cut babble after them. Hosts supply the ONNX sessions.
 *
 * Model files: onnx-community/chatterbox-multilingual-ONNX (speech_encoder, embed_tokens, language_model_q4,
 * conditional_decoder, tokenizer.json). The language model graph is the same file with three extra outputs
 * (the q/k/v projections of the layers whose attention follows the text), made by exposeAlignment below.
 */

export const STUDIO_SR = 24000;
export const STUDIO_REPO = "onnx-community/chatterbox-multilingual-ONNX";
/** Pinned so the byte offsets below stay valid. */
export const STUDIO_REVISION = "452d3f434aa592098f1eedac9099f33642ab2da5";
export const STUDIO_FILES = [
  "tokenizer.json",
  "onnx/speech_encoder.onnx",
  "onnx/speech_encoder.onnx_data",
  "onnx/embed_tokens.onnx",
  "onnx/embed_tokens.onnx_data",
  "onnx/language_model_q4.onnx_data",
  "onnx/conditional_decoder.onnx",
  "onnx/conditional_decoder.onnx_data",
] as const;
/** text_pos_emb.weight (2050×1024 float32) inside embed_tokens.onnx_data at this revision. */
export const TEXT_POS = { offset: 43200512, rows: 2050, dim: 1024 } as const;

const START = 6561;
const STOP = 6562;
const EXAGGERATION = 6563;
const BOS = 255;
const EOT = 0;
const LAYERS = 30;
const HEADS = 16;
const HD = 64;
/** Attention heads that follow the text (Chatterbox's AlignmentStreamAnalyzer). */
const ALIGNED: ReadonlyArray<readonly [number, number]> = [[12, 15], [13, 11], [9, 2]];
/** Rotary frequencies of the language model (llama3-scaled, theta 500000), read off its cos/sin cache. */
const INV_FREQ = new Float64Array([1.0, 0.663601279258728, 0.44036665558815, 0.2922278344631195, 0.19392277300357819, 0.12868738174438477, 0.08539710193872452, 0.05666961520910263, 0.03760603070259094, 0.02495541051030159, 0.016560440883040428, 0.010989529080688953, 0.00729266507551074, 0.004839420784264803, 0.0032114458736032248, 0.002131119603291154, 0.001414213445968926, 0.0009384738514199853, 0.0006227724370546639, 0.0004132725589442998, 0.00027424818836152554, 0.00017118836694862694, 6.861451402073726e-05, 2.572220728325192e-05, 8.345419701072387e-06, 4.411534519022098e-06, 2.927499735960737e-06, 1.9426925064180978e-06, 1.289173155782919e-06, 8.554969213037111e-07, 5.677088097399974e-07, 3.76732259610435e-07]);

/** Kokoro language letter (voice id prefix) → Chatterbox language. Japanese and Chinese need extra text tools and stay on Kokoro. */
export const STUDIO_LANGS: Readonly<Record<string, string>> = { a: "en", b: "en", e: "es", f: "fr", h: "hi", i: "it", p: "pt" };

// ---------------------------------------------------------------- ONNX Runtime surface (node and web share it)

export interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
export type TensorMaker = (type: "float32" | "int64", data: Float32Array | BigInt64Array, dims: readonly number[]) => OrtTensor;

export interface StudioModels {
  tensor: TensorMaker;
  embed: OrtSession;
  /** language_model_q4 with the aligned layers' qkv projections as extra outputs. */
  lm: OrtSession;
  decoder: OrtSession;
  /** Loaded on first use: only needed to make a new speaker. */
  encoder: () => Promise<OrtSession>;
  tokenizer: StudioTokenizer;
  /** text_pos_emb rows (TEXT_POS.rows × 1024). */
  textPos: Float32Array;
}

// ---------------------------------------------------------------- text

/** Chatterbox's punctuation clean-up (punc_norm), so lines read the way the model was trained. */
export function puncNorm(text: string): string {
  let t = text;
  if (!t) return t;
  if (t[0] !== t[0]!.toUpperCase()) t = t[0]!.toUpperCase() + t.slice(1);
  t = t.split(/\s+/).filter(Boolean).join(" ");
  const swaps: Array<[string, string]> = [["...", ", "], ["…", ", "], [":", ","], [" - ", ", "], [";", ", "], ["—", "-"], ["–", "-"], [" ,", ","], ["“", '"'], ["”", '"'], ["‘", "'"], ["’", "'"]];
  for (const [a, b] of swaps) t = t.split(a).join(b);
  t = t.replace(/ +$/, "");
  if (![".", "!", "?", "-", ",", "、", "，", "。", "？", "！"].some((p) => t.endsWith(p))) t += ".";
  return t;
}

/** Text as the multilingual tokenizer expects it: cleaned, lower case, NFKD, language tag, spaces marked. */
export function prepareText(text: string, lang: string): string {
  const t = puncNorm(text).toLowerCase().normalize("NFKD");
  return `[${lang}]${t}`.replace(/ /g, "[SPACE]");
}

interface TokenizerJson {
  model: { vocab: Record<string, number>; merges: Array<string | [string, string]>; unk_token?: string };
  added_tokens: Array<{ id: number; content: string }>;
}

/** The grapheme BPE tokenizer (tokenizer.json), enough of Hugging Face's tokenizers to match it exactly. */
export class StudioTokenizer {
  private vocab: Map<string, number>;
  private ranks = new Map<string, number>();
  private added: Array<[string, number]>;
  private unk: number;
  constructor(json: TokenizerJson | string) {
    const j: TokenizerJson = typeof json === "string" ? JSON.parse(json) : json;
    this.vocab = new Map(Object.entries(j.model.vocab));
    j.model.merges.forEach((m, i) => this.ranks.set(Array.isArray(m) ? m.join(" ") : m, i));
    this.added = j.added_tokens.map((a) => [a.content, a.id] as [string, number]).sort((a, b) => b[0].length - a[0].length);
    this.unk = this.vocab.get(j.model.unk_token ?? "[UNK]") ?? 1;
  }

  /** Token ids for prepared text (see prepareText), wrapped in the model's template. */
  encode(prepared: string): number[] {
    const ids: number[] = [];
    let buf = "";
    const flush = () => {
      if (buf) for (const w of buf.match(WORD_RE) ?? []) ids.push(...this.bpe(w));
      buf = "";
    };
    for (let i = 0; i < prepared.length; ) {
      if (prepared[i] === "[") {
        const hit = this.added.find(([s]) => prepared.startsWith(s, i));
        if (hit) {
          flush();
          ids.push(hit[1]);
          i += hit[0].length;
          continue;
        }
      }
      buf += prepared[i];
      i++;
    }
    flush();
    return [EXAGGERATION, BOS, ...ids, EOT, START, START];
  }

  private bpe(word: string): number[] {
    let parts = [...word];
    for (;;) {
      let best = -1;
      let rank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (r !== undefined && r < rank) [rank, best] = [r, i];
      }
      if (best < 0) break;
      const a = parts[best]!;
      const b = parts[best + 1]!;
      const merged: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) {
          merged.push(a + b);
          i++;
        } else merged.push(parts[i]!);
      }
      parts = merged;
    }
    return parts.map((p) => this.vocab.get(p) ?? this.unk);
  }
}

// Hugging Face's Whitespace pre-tokenizer: \w+|[^\w\s]+ with Unicode \w.
const W = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}`;
const WORD_RE = new RegExp(`[${W}]+|[^${W}\\s]+`, "gu");

// ---------------------------------------------------------------- speakers

/** A voice as Chatterbox sees it: made once from a reference clip by the speech encoder. */
export interface Speaker {
  condEmb: Float32Array;
  condLen: number;
  promptToken: BigInt64Array;
  xvec: Float32Array;
  promptFeat: Float32Array;
  featLen: number;
}

export async function makeSpeaker(models: StudioModels, ref: Float32Array): Promise<Speaker> {
  const enc = await models.encoder();
  // The encoder keeps 10 s for the acoustic prompt and 6 s for the style; longer clips only cost time.
  const clip = ref.length > STUDIO_SR * 10 ? ref.subarray(0, STUDIO_SR * 10) : ref;
  const out = await enc.run({ audio_values: models.tensor("float32", Float32Array.from(clip), [1, clip.length]) });
  // audio_features = conditioning for the language model, audio_tokens = the clip's speech tokens (decoder prompt)
  const [cond, tok, xv, feat] = ["audio_features", "audio_tokens", "speaker_embeddings", "speaker_features"].map((k) => out[k]!);
  return {
    condEmb: Float32Array.from(cond!.data as Float32Array),
    condLen: cond!.dims[1]!,
    promptToken: BigInt64Array.from(tok!.data as BigInt64Array),
    xvec: Float32Array.from(xv!.data as Float32Array),
    promptFeat: Float32Array.from(feat!.data as Float32Array),
    featLen: feat!.dims[1]!,
  };
}

/** Speaker ⇄ bytes, for caching on disk. Layout: magic, 3 lengths, then the arrays (float32 / int64). */
export function packSpeaker(s: Speaker): Uint8Array {
  const head = new Int32Array([0x56545331, s.condLen, s.promptToken.length, s.featLen]);
  const parts = [head, s.condEmb, s.promptToken, s.xvec, s.promptFeat];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o);
    o += p.byteLength;
  }
  return out;
}

export function unpackSpeaker(bytes: Uint8Array): Speaker {
  const b = bytes.slice().buffer;
  const [magic, condLen, nTok, featLen] = new Int32Array(b, 0, 4);
  if (magic !== 0x56545331) throw new Error("Not a VolTune studio speaker file");
  let o = 16;
  const take = <T>(make: (o: number, n: number) => T, n: number, size: number): T => {
    const v = make(o, n);
    o += n * size;
    return v;
  };
  const condEmb = take((o, n) => new Float32Array(b, o, n), condLen! * 1024, 4);
  const promptToken = take((o, n) => new BigInt64Array(b, o, n), nTok!, 8);
  const xvec = take((o, n) => new Float32Array(b, o, n), 192, 4);
  const promptFeat = take((o, n) => new Float32Array(b, o, n), featLen! * 80, 4);
  return { condEmb, condLen: condLen!, promptToken, xvec, promptFeat, featLen: featLen! };
}

// ---------------------------------------------------------------- speaking

export interface SayOptions {
  lang: string;
  /** 0.25…2: how strongly the line is acted (Chatterbox "exaggeration"). */
  exaggeration?: number;
  /** Classifier-free guidance weight; lower is slower and more deliberate. */
  cfg?: number;
  temperature?: number;
  minP?: number;
  repetitionPenalty?: number;
  seed?: number;
  /** Called with the number of speech tokens made so far (25 per second of speech). */
  onToken?: (n: number) => void;
}

export interface SayResult {
  pcm: Float32Array;
  /** How the take went, for retries: false when the alignment never reached the end of the text. */
  complete: boolean;
  /** Why generation stopped: the model's own end, or one of the alignment checks. */
  reason: "end" | "long_tail" | "repetition" | "token_repetition" | "cap";
  tokens: number;
}

/** Chatterbox's AlignmentStreamAnalyzer, fed from attention we compute from the exposed projections. */
class Aligner {
  readonly S: number;
  private frame = 0;
  pos = 0;
  complete = false;
  private completedAt = -1;
  endAt = -1;
  private rows = 0;
  private tailSums: Float64Array;
  private repSum = 0;
  private lastTok: number[] = [];
  constructor(readonly i: number, readonly j: number) {
    this.S = j - i;
    this.tailSums = new Float64Array(3);
  }

  /** One frame of attention over the text (S values per row); may force or forbid the end in `logits`. */
  step(rows: Float32Array[], logits: Float32Array, lastToken: number): SayResult["reason"] | null {
    const S = this.S;
    let cur = 0;
    for (const r of rows) {
      for (let c = this.frame + 1; c < S; c++) r[c] = 0; // monotonic mask, as the reference does
      this.rows++;
      if (this.complete) {
        for (let k = 0; k < 3; k++) this.tailSums[k] = this.tailSums[k]! + (r[S - 3 + k] ?? 0);
        let m = 0;
        for (let c = 0; c < S - 5; c++) m = Math.max(m, r[c]!);
        this.repSum += m;
      }
    }
    const last = rows[rows.length - 1]!;
    for (let c = 1; c < S; c++) if (last[c]! > last[cur]!) cur = c;
    if (cur - this.pos > -4 && cur - this.pos < 7) this.pos = cur;
    if (this.endAt < 0 && this.pos >= S - 2) this.endAt = this.rows;
    if (!this.complete && this.pos >= S - 3) {
      this.complete = true;
      this.completedAt = this.rows;
    }
    const longTail = this.complete && Math.max(...this.tailSums) >= 5;
    const repetition = this.complete && S > 5 && this.repSum > 5;
    this.lastTok.push(lastToken);
    const n = this.lastTok.length;
    const tokenRep = n >= 3 && this.lastTok[n - 1] === this.lastTok[n - 2];
    if (cur < S - 3 && S > 5) logits[STOP] = -1e9;
    this.frame++;
    if (longTail || repetition || tokenRep) {
      logits.fill(-1e9);
      logits[STOP] = 1e9;
      return longTail ? "long_tail" : repetition ? "repetition" : "token_repetition";
    }
    return null;
  }
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Say one line with a speaker. Returns 24 kHz audio. */
export async function say(models: StudioModels, text: string, spk: Speaker, o: SayOptions): Promise<SayResult> {
  const T = models.tensor;
  const ex = o.exaggeration ?? 0.5;
  const cfg = o.cfg ?? 0.5;
  const temp = o.temperature ?? 0.8;
  const minP = o.minP ?? 0.05;
  const rep = o.repetitionPenalty ?? 2.0;
  const rand = rng(o.seed ?? 1);
  const ids = models.tokenizer.encode(prepareText(text, o.lang));
  const n = ids.length;
  const pos = ids.map((id, k) => (id >= START ? 0 : k - 1));
  const exT = T("float32", new Float32Array([ex]), [1]);
  const emb = await models.embed.run({
    input_ids: T("int64", BigInt64Array.from(ids, BigInt), [1, n]),
    position_ids: T("int64", BigInt64Array.from(pos, BigInt), [1, n]),
    exaggeration: exT,
  });
  const e = emb.inputs_embeds!.data as Float32Array;
  const D = 1024;
  const B = cfg > 0 ? 2 : 1;
  const L0 = spk.condLen;
  const seq0 = L0 + n;
  // Row 0: speaker + text. Row 1 (guidance): the same without the text (position embeddings kept, as Chatterbox does).
  const x = new Float32Array(B * seq0 * D);
  for (let b = 0; b < B; b++) {
    x.set(spk.condEmb, b * seq0 * D);
    x.set(e, (b * seq0 + L0) * D);
  }
  if (B === 2) {
    for (let k = 0; k < n; k++) {
      if (ids[k]! >= START) continue;
      const p = pos[k]!;
      x.set(models.textPos.subarray(p * D, (p + 1) * D), (seq0 + L0 + k) * D);
    }
  }
  const textIdx = ids.map((id, k) => (id < START ? k : -1)).filter((k) => k >= 0);
  const al = new Aligner(L0 + textIdx[0]!, L0 + textIdx[textIdx.length - 1]! + 1);
  const nText = textIdx.length;
  const cap = 40 + nText * 6;

  let feeds: Record<string, OrtTensor> = { inputs_embeds: T("float32", x, [B, seq0, D]) };
  for (let l = 0; l < LAYERS; l++)
    for (const kv of ["key", "value"]) feeds[`past_key_values.${l}.${kv}`] = T("float32", new Float32Array(0), [B, HEADS, 0, HD]);
  let total = seq0;
  const gen: number[] = [START];
  let reason: SayResult["reason"] = "cap";
  for (let i = 0; i < cap; i++) {
    feeds.attention_mask = T("int64", new BigInt64Array(B * total).fill(1n), [B, total]);
    const out = await models.lm.run(feeds);
    const lg = out.logits!;
    const V = lg.dims[2]!;
    const seq = lg.dims[1]!;
    const ld = lg.data as Float32Array;
    const c0 = (seq - 1) * V;
    const l = new Float32Array(V);
    if (B === 2) {
      const c1 = (seq + seq - 1) * V;
      for (let v = 0; v < V; v++) l[v] = ld[c0 + v]! + cfg * (ld[c0 + v]! - ld[c1 + v]!);
    } else l.set(ld.subarray(c0, c0 + V));

    // alignment: the three heads' attention for the new query rows, over the text
    const rows = i === 0 ? Array.from({ length: total - al.j }, (_, k) => al.j + k) : [total - 1];
    const maps = headAttention(out, rows, total, seq);
    const A = rows.map((_, r) => {
      const row = new Float32Array(al.S);
      for (const m of maps) for (let c = 0; c < al.S; c++) row[c] = row[c]! + m[r * total + al.i + c]! / maps.length;
      return row;
    });
    const why = al.step(A, l, gen[gen.length - 1]!);

    // repetition penalty, temperature, min-p, sample
    for (const t of new Set(gen)) l[t] = l[t]! < 0 ? l[t]! * rep : l[t]! / rep;
    let next: number;
    if (temp > 0) {
      let mx = -Infinity;
      for (let v = 0; v < V; v++) mx = Math.max(mx, l[v]!);
      const p = new Float64Array(V);
      let sum = 0;
      let pmax = 0;
      for (let v = 0; v < V; v++) {
        p[v] = Math.exp((l[v]! - mx) / temp);
        sum += p[v]!;
      }
      for (let v = 0; v < V; v++) pmax = Math.max(pmax, (p[v]! /= sum));
      let kept = 0;
      for (let v = 0; v < V; v++) if (p[v]! < minP * pmax) p[v] = 0;
      for (let v = 0; v < V; v++) kept += p[v]!;
      let r = rand() * kept;
      next = V - 1;
      for (let v = 0; v < V; v++) {
        r -= p[v]!;
        if (r <= 0 && p[v]! > 0) {
          next = v;
          break;
        }
      }
    } else {
      next = 0;
      for (let v = 1; v < V; v++) if (l[v]! > l[next]!) next = v;
    }
    gen.push(next);
    o.onToken?.(gen.length - 1);
    if (next === STOP) {
      reason = why ?? "end";
      break;
    }
    const nextFeeds: Record<string, OrtTensor> = {};
    for (let ly = 0; ly < LAYERS; ly++)
      for (const kv of ["key", "value"]) nextFeeds[`past_key_values.${ly}.${kv}`] = out[`present.${ly}.${kv}`]!;
    const ne = await models.embed.run({
      input_ids: T("int64", new BigInt64Array([BigInt(next)]), [1, 1]),
      position_ids: T("int64", new BigInt64Array([BigInt(i + 1)]), [1, 1]),
      exaggeration: exT,
    });
    const nd = ne.inputs_embeds!.data as Float32Array;
    const xb = new Float32Array(B * D);
    for (let b = 0; b < B; b++) xb.set(nd.subarray(0, D), b * D);
    nextFeeds.inputs_embeds = T("float32", xb, [B, 1, D]);
    feeds = nextFeeds;
    total++;
  }

  let toks = gen.slice(1).filter((t) => t < START);
  // A long tail is babble after the last word: keep a short release after the text ended.
  if (al.endAt >= 0 && toks.length > al.endAt + 12) toks = toks.slice(0, al.endAt + 10);
  const speech = new BigInt64Array(spk.promptToken.length + toks.length);
  speech.set(spk.promptToken);
  speech.set(BigInt64Array.from(toks, BigInt), spk.promptToken.length);
  const dec = await models.decoder.run({
    speech_tokens: T("int64", speech, [1, speech.length]),
    speaker_embeddings: T("float32", spk.xvec, [1, 192]),
    speaker_features: T("float32", spk.promptFeat, [1, spk.featLen, 80]),
  });
  const wav = Float32Array.from(Object.values(dec)[0]!.data as Float32Array);
  return { pcm: trimSilence(wav), complete: al.complete, reason, tokens: toks.length };

  /** Mean-free attention maps (rows × total) of the aligned heads, batch row 0. */
  function headAttention(out: Record<string, OrtTensor>, rows: number[], total: number, seq: number): Float32Array[] {
    return ALIGNED.map(([layer, h]) => {
      const qkv = out[`/model/layers.${layer}/attn/qkv_proj/MatMul/output_0`]!.data as Float32Array; // [B, seq, 3072]
      const key = out[`present.${layer}.key`]!.data as Float32Array; // [B, 16, total, 64]
      const m = new Float32Array(rows.length * total);
      const q = new Float64Array(HD);
      rows.forEach((r, ri) => {
        const off = (r - (total - seq)) * 3072 + h * HD;
        for (let d = 0; d < 32; d++) {
          const a = qkv[off + d]!;
          const b = qkv[off + d + 32]!;
          const ang = r * INV_FREQ[d]!;
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          q[d] = a * c - b * s;
          q[d + 32] = b * c + a * s;
        }
        const kb = h * total * HD;
        let mx = -Infinity;
        const sc = new Float64Array(r + 1);
        for (let t = 0; t <= r; t++) {
          let dot = 0;
          for (let d = 0; d < HD; d++) dot += q[d]! * key[kb + t * HD + d]!;
          sc[t] = dot * 0.125;
          mx = Math.max(mx, sc[t]!);
        }
        let sum = 0;
        for (let t = 0; t <= r; t++) sum += sc[t] = Math.exp(sc[t]! - mx);
        for (let t = 0; t <= r; t++) m[ri * total + t] = sc[t]! / sum;
      });
      return m;
    });
  }
}

/** Trim leading and trailing silence (40 dB below the loudest 20 ms frame), keeping a short margin. */
export function trimSilence(pcm: Float32Array, sr = STUDIO_SR): Float32Array {
  const hop = Math.round(sr * 0.02);
  const frames = Math.floor(pcm.length / hop);
  if (frames < 3) return pcm;
  const e = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += pcm[i]! * pcm[i]!;
    e[f] = Math.sqrt(s / hop);
    peak = Math.max(peak, e[f]!);
  }
  const floor = peak * 0.01;
  let a = 0;
  let b = frames - 1;
  while (a < frames && e[a]! < floor) a++;
  while (b > a && e[b]! < floor) b--;
  const start = Math.max(0, (a - 2) * hop);
  const end = Math.min(pcm.length, (b + 4) * hop);
  return pcm.slice(start, end);
}

// ---------------------------------------------------------------- model graph

/**
 * Add the aligned layers' qkv projections as outputs of language_model_q4.onnx (a small protobuf edit:
 * three ValueInfoProto entries appended to ModelProto.graph.output). The weights are untouched.
 */
export function exposeAlignment(model: Uint8Array): Uint8Array {
  const names = [...new Set(ALIGNED.map(([l]) => l))].map((l) => `/model/layers.${l}/attn/qkv_proj/MatMul/output_0`);
  const enc = new TextEncoder();
  const outputs = names.map((name) => {
    const dim = (param: string | null, value?: number) => (param ? field(2, enc.encode(param)) : varintField(1, value!));
    const shape = concat([field(1, dim("batch_size")), field(1, dim("sequence_length")), field(1, dim(null, 3072))]);
    const tensorType = concat([varintField(1, 1), field(2, shape)]); // elem_type FLOAT, shape
    const type = field(1, tensorType);
    return field(12, concat([field(1, enc.encode(name)), field(2, type)]));
  });
  const parts: Uint8Array[] = [];
  let i = 0;
  let found = false;
  while (i < model.length) {
    const start = i;
    const [tag, a] = readVarint(model, i);
    i = a;
    const wire = tag & 7;
    if (wire === 0) i = readVarint(model, i)[1];
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) {
      const [len, b] = readVarint(model, i);
      if (tag >>> 3 === 7) {
        found = true;
        parts.push(field(7, concat([model.subarray(b, b + len), ...outputs])));
        i = b + len;
        continue;
      }
      i = b + len;
    } else throw new Error("Unexpected protobuf wire type in the language model");
    parts.push(model.subarray(start, i));
  }
  if (!found) throw new Error("The language model has no graph");
  return concat(parts);
}

function readVarint(b: Uint8Array, i: number): [number, number] {
  let v = 0;
  let mul = 1;
  for (;;) {
    const x = b[i++]!;
    v += (x & 0x7f) * mul;
    if (x < 0x80) return [v, i];
    mul *= 128;
  }
}
function varint(n: number): Uint8Array {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Uint8Array.from(out);
}
const field = (no: number, bytes: Uint8Array) => concat([varint((no << 3) | 2), varint(bytes.length), bytes]);
const varintField = (no: number, n: number) => concat([varint(no << 3), varint(n)]);
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** text_pos_emb rows from embed_tokens.onnx_data (see TEXT_POS). */
export function textPositions(embedData: Uint8Array): Float32Array {
  const n = TEXT_POS.rows * TEXT_POS.dim;
  if (embedData.length < TEXT_POS.offset + n * 4) throw new Error("embed_tokens.onnx_data is not the expected revision");
  return new Float32Array(embedData.slice(TEXT_POS.offset, TEXT_POS.offset + n * 4).buffer);
}

// ---------------------------------------------------------------- acting

/** How strongly each mood is acted, and the guidance weight (slower moods get less, which slows the speech). */
export const MOOD_ACTING: Readonly<Record<string, { exaggeration: number; slow?: boolean }>> = {
  happy: { exaggeration: 0.7 },
  excited: { exaggeration: 0.85 },
  sad: { exaggeration: 0.65, slow: true },
  crying: { exaggeration: 0.8, slow: true },
  angry: { exaggeration: 0.85 },
  scared: { exaggeration: 0.75 },
  loving: { exaggeration: 0.55, slow: true },
  surprised: { exaggeration: 0.75 },
  serious: { exaggeration: 0.55 },
  tired: { exaggeration: 0.55, slow: true },
  pleading: { exaggeration: 0.7, slow: true },
};

/** Exaggeration and guidance for a mood at a strength (0…2, 1 = as marked). */
export function acting(mood: string | undefined, amount = 1): { exaggeration: number; cfg: number } {
  const a = mood ? MOOD_ACTING[mood] : undefined;
  if (!a) return { exaggeration: 0.5, cfg: 0.5 };
  return { exaggeration: Math.round((0.5 + (a.exaggeration - 0.5) * Math.min(1.5, amount)) * 100) / 100, cfg: a.slow ? 0.3 : 0.5 };
}

/** A stable seed for a line, so the same script renders the same takes. */
export function seedFor(...parts: string[]): number {
  let h = 2166136261;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
