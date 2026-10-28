/**
 * Listening without ears: measure a rendered scene (pitch, pace, loudness, brightness, breathiness,
 * clipping, cut-offs, what is actually said) and check it against the script and its delivery marks.
 * Also builds lip-sync tracks with mouth shapes, a spectrogram image, and checks a finished video's
 * audio/visual sync.
 */
import { execFileSync } from "node:child_process";
import { analyseFrames, db, decodeWav, HOP_S, median, quantile, rmsOf, semitones, spectrogram, type Frame } from "./dsp";
import { Canvas, heat } from "./png";
import { recognizer, transcribe, wordErrorRate } from "./asr";

export interface TimelineLine {
  index?: number;
  speaker?: string;
  text: string;
  tags?: string[];
  start: number;
  end: number;
}

export interface LineReport {
  index: number;
  speaker: string;
  text: string;
  tags: string[];
  start: number;
  end: number;
  seconds: number;
  words: number;
  wordsPerMinute: number | null;
  pitchHz: { median: number; low: number; high: number; rangeSemitones: number } | null;
  pitchStability: number | null;
  loudnessDb: number;
  peakDb: number;
  brightnessHz: number;
  breathiness: number;
  clippedSamples: number;
  heard?: string;
  wordErrorRate?: number;
  verdict: "ok" | "check";
  notes: string[];
}

export interface SceneReport {
  seconds: number;
  sampleRate: number;
  loudnessDb: number;
  peakDb: number;
  noiseFloorDb: number;
  speakers: Record<string, { lines: number; pitchHz: number; brightnessHz: number; loudnessDb: number; wordsPerMinute: number | null }>;
  lines: LineReport[];
  issues: string[];
  score: number;
  transcripts: boolean;
}

const SOUND = /^(haha|heh|hehe|hhh|oh|ugh|ahem|hmm|hm|aaah|haaah|wow)[.!?…]*$/i;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = Math.round;

function framesIn(frames: Frame[], a: number, b: number) {
  return frames.filter((f) => f.t >= a && f.t + HOP_S <= b + 1e-6);
}

/** Split audio without a timeline into speech runs separated by ≥250 ms of silence. */
function detectRuns(frames: Frame[]): TimelineLine[] {
  const floor = quantile(frames.map((f) => f.rms), 0.1);
  const thr = Math.max(0.006, floor * 3);
  const runs: TimelineLine[] = [];
  let start = -1;
  let quiet = 0;
  for (const f of frames) {
    if (f.rms > thr) {
      if (start < 0) start = f.t;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= 25) {
      runs.push({ text: "", start, end: f.t - quiet * HOP_S + HOP_S });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ text: "", start, end: frames[frames.length - 1]!.t + HOP_S });
  return runs.map((r, i) => ({ ...r, index: i, speaker: "Speaker" }));
}

export async function analyse(
  pcm: Float32Array,
  sampleRate: number,
  timeline?: readonly TimelineLine[],
  opts: { transcripts?: boolean; log?: (s: string) => void } = {},
): Promise<SceneReport> {
  const frames = analyseFrames(pcm, sampleRate);
  const lines = timeline?.length ? timeline : detectRuns(frames);
  const asr = opts.transcripts === false ? null : await recognizer(opts.log);
  const out: LineReport[] = [];

  for (const [i, l] of lines.entries()) {
    const fs = framesIn(frames, l.start, l.end);
    const a = Math.max(0, Math.floor(l.start * sampleRate));
    const b = Math.min(pcm.length, Math.ceil(l.end * sampleRate));
    const seg = pcm.subarray(a, b);
    const voiced = fs.filter((f) => f.f0 > 0);
    const f0s = voiced.map((f) => f.f0);
    const loud = fs.filter((f) => f.rms > 0.02);
    let jumps: number[] = [];
    for (let k = 1; k < fs.length; k++) if (fs[k]!.f0 > 0 && fs[k - 1]!.f0 > 0) jumps.push(Math.abs(semitones(fs[k]!.f0, fs[k - 1]!.f0)));
    jumps = jumps.filter((j) => j < 7); // ignore octave errors
    const words = l.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    let clipped = 0;
    let peak = 0;
    for (const s of seg) {
      const v = Math.abs(s);
      if (v >= 0.999) clipped++;
      if (v > peak) peak = v;
    }
    const r: LineReport = {
      index: l.index ?? i,
      speaker: l.speaker ?? "Narrator",
      text: l.text,
      tags: l.tags ?? [],
      start: l.start,
      end: l.end,
      seconds: r1((l.end - l.start) * 100) / 100,
      words,
      // Pace over the line's own span (already trimmed of silence at its edges); short lines are too noisy to judge.
      wordsPerMinute: words >= 4 && l.end - l.start > 0.6 ? r0((words / (l.end - l.start)) * 60) : null,
      pitchHz: f0s.length >= 5 ? { median: r0(median(f0s)), low: r0(quantile(f0s, 0.1)), high: r0(quantile(f0s, 0.9)), rangeSemitones: r1(semitones(quantile(f0s, 0.9), quantile(f0s, 0.1))) } : null,
      pitchStability: jumps.length >= 5 ? r1(median(jumps) * 100) / 100 : null,
      loudnessDb: r1(db(rmsOf(seg.length ? seg : new Float32Array(1)) || 1e-9)),
      peakDb: r1(db(peak)),
      brightnessHz: r0(median(loud.map((f) => f.centroid))),
      breathiness: Math.round(median(loud.map((f) => f.flatness)) * 1000) / 1000,
      clippedSamples: clipped,
      verdict: "ok",
      notes: [],
    };
    // Speech level measured on speech frames only, so pauses inside a line don't drag it down.
    if (loud.length) r.loudnessDb = r1(db(Math.sqrt(loud.reduce((n, f) => n + f.rms * f.rms, 0) / loud.length)));
    if (asr && seg.length > sampleRate * 0.15 && /[A-Za-z]/.test(l.text || "a")) {
      r.heard = transcribe(asr, seg, sampleRate);
      if (l.text) r.wordErrorRate = Math.round(wordErrorRate(l.text, r.heard) * 100) / 100;
    }
    out.push(r);
  }

  // Per-speaker baselines, then judge each line against its speaker and its delivery marks.
  const speakers: SceneReport["speakers"] = {};
  const by = new Map<string, LineReport[]>();
  for (const l of out) by.set(l.speaker, [...(by.get(l.speaker) ?? []), l]);
  for (const [name, ls] of by) {
    const plain = ls.filter((l) => !l.tags.length && !SOUND.test(l.text));
    const base = plain.length ? plain : ls;
    const rates = base.map((l) => l.wordsPerMinute).filter((x): x is number => x !== null);
    speakers[name] = {
      lines: ls.length,
      pitchHz: r0(median(base.map((l) => l.pitchHz?.median ?? 0).filter(Boolean))),
      brightnessHz: r0(median(base.map((l) => l.brightnessHz))),
      loudnessDb: r1(median(base.map((l) => l.loudnessDb))),
      wordsPerMinute: rates.length ? r0(median(rates)) : null,
    };
  }

  const has = (l: LineReport, ...t: string[]) => l.tags.some((x) => t.includes(x));
  for (const l of out) {
    const s = speakers[l.speaker]!;
    const n = l.notes;
    const sound = SOUND.test(l.text);
    if (l.clippedSamples > 0) n.push(`clipping: ${l.clippedSamples} samples at full scale`);
    if (l.peakDb > -0.3 && !l.clippedSamples) n.push("peak very close to 0 dBFS");
    if (l.loudnessDb < -40) n.push("almost silent");
    if (l.pitchStability !== null && l.pitchStability > 1.2) n.push(`unstable pitch (median jump ${l.pitchStability} st) — possible warble from pitch shifting`);
    if (!sound && l.wordErrorRate !== undefined && l.words >= 2 && l.wordErrorRate > 0.4) n.push(`speech may be unclear: heard “${l.heard}”`);
    if (!sound && l.wordsPerMinute !== null && !has(l, "slow", "fast", "sad", "tired")) {
      if (l.wordsPerMinute > 230) n.push(`fast delivery (${l.wordsPerMinute} wpm)`);
      if (l.wordsPerMinute < 85) n.push(`slow delivery (${l.wordsPerMinute} wpm)`);
    }
    const dL = l.loudnessDb - s.loudnessDb;
    if (has(l, "whisper") && dL > -2) n.push(`marked whisper but only ${r1(dL)} dB below ${l.speaker}'s normal level`);
    if (has(l, "shout", "screams") && dL < 1) n.push(`marked shout but not louder than ${l.speaker}'s normal level (${r1(dL)} dB)`);
    if (has(l, "whisper", "softly") && l.breathiness < 0.02) n.push("whisper/soft line sounds clean rather than breathy");
    if (s.wordsPerMinute && l.wordsPerMinute) {
      const k = l.wordsPerMinute / s.wordsPerMinute;
      if (has(l, "slow", "sad", "tired") && k > 1.02) n.push(`marked slow/sad/tired but not slower than usual (${Math.round(k * 100)}%)`);
      if (has(l, "fast", "excited", "scared") && k < 0.98) n.push(`marked fast/excited but not quicker than usual (${Math.round(k * 100)}%)`);
    }
    if (l.pitchHz && s.pitchHz && has(l, "excited", "surprised", "shout", "scared") && semitones(l.pitchHz.median, s.pitchHz) < 0.3) n.push("marked excited/surprised but pitch is not raised");
    l.verdict = n.length ? "check" : "ok";
  }

  const issues: string[] = [];
  const names = Object.keys(speakers);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = speakers[names[i]!]!;
      const b = speakers[names[j]!]!;
      if (a.pitchHz && b.pitchHz && Math.abs(semitones(a.pitchHz, b.pitchHz)) < 1.5 && Math.abs(a.brightnessHz - b.brightnessHz) / Math.max(a.brightnessHz, b.brightnessHz, 1) < 0.12)
        issues.push(`${names[i]} and ${names[j]} may sound alike (pitch ${a.pitchHz} vs ${b.pitchHz} Hz, similar brightness) — blend or shift one voice`);
    }
  const floorFrames = frames.filter((f) => f.rms > 0).map((f) => f.rms);
  const noise = db(quantile(floorFrames, 0.05));
  if (noise > -55) issues.push(`noise floor is high (${r1(noise)} dBFS)`);
  for (let k = 1; k < out.length; k++) {
    const gap = out[k]!.start - out[k - 1]!.end;
    if (gap < -0.02) issues.push(`lines ${out[k - 1]!.index} and ${out[k]!.index} overlap by ${r0(-gap * 1000)} ms`);
  }
  let peak = 0;
  for (const s of pcm) peak = Math.max(peak, Math.abs(s));
  const speechFrames = frames.filter((f) => f.rms > 0.02);
  const checked = out.filter((l) => l.verdict === "check").length;
  return {
    seconds: r1((pcm.length / sampleRate) * 100) / 100,
    sampleRate,
    loudnessDb: r1(db(Math.sqrt(speechFrames.reduce((n, f) => n + f.rms * f.rms, 0) / Math.max(1, speechFrames.length)))),
    peakDb: r1(db(peak)),
    noiseFloorDb: r1(noise),
    speakers,
    lines: out,
    issues,
    score: Math.max(0, Math.round(100 - (checked / Math.max(1, out.length)) * 60 - issues.length * 8)),
    transcripts: !!asr,
  };
}

export function reportMarkdown(r: SceneReport): string {
  const L: string[] = [];
  L.push(`# Audio check — score ${r.score}/100`, "");
  L.push(`${r.seconds}s · speech level ${r.loudnessDb} dBFS · peak ${r.peakDb} dBFS · noise floor ${r.noiseFloorDb} dBFS · transcripts ${r.transcripts ? "on" : "off"}`, "");
  L.push("| Speaker | Lines | Pitch | Brightness | Level | Pace |", "| --- | --- | --- | --- | --- | --- |");
  for (const [n, s] of Object.entries(r.speakers)) L.push(`| ${n} | ${s.lines} | ${s.pitchHz || "–"} Hz | ${s.brightnessHz} Hz | ${s.loudnessDb} dB | ${s.wordsPerMinute ?? "–"} wpm |`);
  if (r.issues.length) L.push("", "**Scene issues**", ...r.issues.map((i) => `- ${i}`));
  L.push("", "| # | Speaker | Time | Delivery | Pitch | Level | Pace | Heard | Verdict |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const l of r.lines)
    L.push(
      `| ${l.index} | ${l.speaker} | ${l.start.toFixed(2)}–${l.end.toFixed(2)} | ${l.tags.join(", ") || "–"} | ${l.pitchHz ? `${l.pitchHz.median} Hz (${l.pitchHz.rangeSemitones} st)` : "–"} | ${l.loudnessDb} dB | ${l.wordsPerMinute ?? "–"} | ${l.heard ? `${l.heard}${l.wordErrorRate !== undefined ? ` (WER ${l.wordErrorRate})` : ""}` : "–"} | ${l.verdict === "ok" ? "ok" : "check: " + l.notes.join("; ")} |`,
    );
  return L.join("\n") + "\n";
}

/* ---------- lip-sync with mouth shapes ---------- */

export type Shape = "M" | "A" | "E" | "O";
export interface LipTrack {
  fps: number;
  frames: number;
  /** Per speaker: mouth openness 0…1 per frame, and a mouth shape per frame (M closed, A open, E wide, O round). */
  tracks: Record<string, { open: number[]; shapes: string }>;
}

export function lipTrack(pcm: Float32Array, sampleRate: number, timeline: readonly TimelineLine[], fps = 30): LipTrack {
  const frames = analyseFrames(pcm, sampleRate);
  const total = Math.ceil((pcm.length / sampleRate) * fps);
  const at = (t: number) => frames[Math.min(frames.length - 1, Math.max(0, Math.round(t / HOP_S)))];
  const speakers = [...new Set(timeline.map((l) => l.speaker ?? "Narrator"))];
  const tracks: LipTrack["tracks"] = {};
  for (const sp of speakers) {
    const mine = timeline.filter((l) => (l.speaker ?? "Narrator") === sp);
    const own = mine.flatMap((l) => framesIn(frames, l.start, l.end));
    const ref = quantile(own.map((f) => f.rms), 0.95) || 1;
    // Mouth shape from brightness relative to this voice: darker than usual reads as O, brighter as E.
    const voicedC = own.filter((f) => f.rms > ref * 0.2).map((f) => f.centroid);
    const cLow = quantile(voicedC, 0.25);
    const cHigh = quantile(voicedC, 0.8);
    const open = new Array<number>(total).fill(0);
    const shapes: Shape[] = new Array<Shape>(total).fill("M");
    for (const l of mine) {
      for (let f = Math.floor(l.start * fps); f < Math.min(total, Math.ceil(l.end * fps)); f++) {
        // Average the analysis frames that fall inside this video frame.
        const t0 = f / fps;
        const fr = framesIn(frames, t0, t0 + 1 / fps);
        const src = fr.length ? fr : [at(t0)!];
        const rms = src.reduce((n, x) => n + x.rms, 0) / src.length;
        const x = Math.min(1, rms / ref);
        const o = x < 0.1 ? 0 : Math.round(Math.pow(x, 0.7) * 100) / 100;
        open[f] = o;
        const c = src.reduce((n, x) => n + x.centroid, 0) / src.length;
        const low = src.reduce((n, x) => n + x.low, 0) / src.length;
        shapes[f] = o === 0 ? "M" : c < cLow && low > 0.6 ? "O" : c > cHigh ? "E" : "A";
      }
    }
    // Hold each shape for at least two frames so mouths don't flicker.
    for (let f = 1; f < total - 1; f++) if (shapes[f] !== shapes[f - 1] && shapes[f] !== shapes[f + 1]) shapes[f] = shapes[f - 1]!;
    tracks[sp] = { open, shapes: shapes.join("") };
  }
  return { fps, frames: total, tracks };
}

/* ---------- images ---------- */

const PALETTE: Array<[number, number, number]> = [
  [110, 168, 255],
  [255, 140, 170],
  [140, 230, 160],
  [255, 200, 90],
  [190, 150, 255],
  [120, 220, 230],
];

/** Spectrogram with pitch contour (white), a lane per line coloured by speaker, and a loudness strip. */
export function scenePicture(pcm: Float32Array, sampleRate: number, timeline: readonly TimelineLine[] = []): Uint8Array {
  const { cols, bins } = spectrogram(pcm, sampleRate);
  const frames = analyseFrames(pcm, sampleRate);
  const step = Math.max(1, Math.ceil(cols.length / 2400));
  const W = Math.ceil(cols.length / step);
  const SH = 220;
  const H = SH + 24 + 50;
  const c = new Canvas(W, H);
  let mx = -Infinity;
  for (const col of cols) for (const v of col) mx = Math.max(mx, v);
  for (let x = 0; x < W; x++) {
    const col = cols[x * step]!;
    for (let y = 0; y < SH; y++) {
      // log-frequency axis, 60 Hz … 8 kHz
      const hz = 60 * Math.pow(8000 / 60, 1 - y / SH);
      const k = Math.min(bins - 1, Math.round((hz / 8000) * bins));
      c.set(x, y, heat((col[k]! - (mx - 80)) / 80));
    }
  }
  const yOf = (hz: number) => SH * (1 - Math.log(hz / 60) / Math.log(8000 / 60));
  for (const f of frames) if (f.f0 > 0) c.rect(Math.floor(f.t / HOP_S / step), yOf(f.f0) - 1, 1, 2, [255, 255, 255]);
  const speakers = [...new Set(timeline.map((l) => l.speaker ?? "Narrator"))];
  for (const l of timeline) {
    const col = PALETTE[speakers.indexOf(l.speaker ?? "Narrator") % PALETTE.length]!;
    c.rect(l.start / HOP_S / step, SH + 4, Math.max(1, (l.end - l.start) / HOP_S / step), 16, col);
  }
  for (let x = 0; x < W; x++) {
    const f = frames[Math.min(frames.length - 1, x * step)];
    const h = f ? Math.max(0, Math.min(1, (db(f.rms) + 60) / 60)) * 46 : 0;
    c.rect(x, H - h, 1, h, [120, 140, 190]);
  }
  return c.png();
}

/* ---------- finished-video check ---------- */

function envelope(pcm: Float32Array, sr: number): Float32Array {
  const hop = Math.round(sr * HOP_S);
  const out = new Float32Array(Math.floor(pcm.length / hop));
  for (let i = 0; i < out.length; i++) out[i] = rmsOf(pcm, i * hop, (i + 1) * hop);
  return out;
}

function bestLag(a: Float32Array, b: Float32Array, maxLag: number, from = 0, to = a.length): { lag: number; corr: number } {
  let best = { lag: 0, corr: -1 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = from; i < to; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      sab += a[i]! * b[j]!;
      saa += a[i]! * a[i]!;
      sbb += b[j]! * b[j]!;
    }
    const corr = saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
    if (corr > best.corr) best = { lag, corr };
  }
  return best;
}

function pearsonLag(a: number[], b: number[], maxLag: number): { lag: number; corr: number } {
  let best = { lag: 0, corr: -2 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < b.length) {
        xs.push(a[i]!);
        ys.push(b[j]!);
      }
    }
    const mx = xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
    const my = ys.reduce((s, x) => s + x, 0) / (ys.length || 1);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) ** 2;
      syy += (ys[i]! - my) ** 2;
    }
    const corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    if (corr > best.corr) best = { lag, corr };
  }
  return best;
}

export interface AvReport {
  video: { seconds: number; fps: number };
  audioOffsetMs: number;
  driftMs: number;
  matchCorrelation: number;
  levelChangeDb: number;
  mouths?: Record<string, { correlation: number; lagFrames: number; openWhileSilent: number; verdict: string }>;
  verdict: "in sync" | "check";
  notes: string[];
}

/** Compare a finished video's soundtrack with the scene audio, and (optionally) the drawn mouth track with the speech. */
export function avCheck(videoPath: string, scenePcm: Float32Array, sceneRate: number, timeline: readonly TimelineLine[], drawn?: { fps: number; tracks: Record<string, number[]> }): AvReport {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate:format=duration", "-of", "json", videoPath]).toString()) as {
    streams?: Array<{ r_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const [num, den] = (probe.streams?.[0]?.r_frame_rate ?? "30/1").split("/").map(Number);
  const fps = Math.round(((num ?? 30) / (den || 1)) * 100) / 100;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", videoPath, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", String(sceneRate), "-f", "s16le", "-"], { maxBuffer: 1 << 30 });
  const vid = new Float32Array(raw.length >> 1);
  for (let i = 0; i < vid.length; i++) vid[i] = raw.readInt16LE(i * 2) / 32768;
  const notes: string[] = [];
  if (!vid.length) notes.push("the video has no audio track");
  const a = envelope(scenePcm, sceneRate);
  const b = envelope(vid, sceneRate);
  const whole = bestLag(a, b, 300);
  // Drift: offset measured on the first and last thirds.
  const third = Math.floor(a.length / 3);
  const first = bestLag(a, b, 300, 0, third);
  const last = bestLag(a, b, 300, a.length - third, a.length);
  const offsetMs = whole.lag * HOP_S * 1000;
  const driftMs = (last.lag - first.lag) * HOP_S * 1000;
  const level = db(rmsOf(vid)) - db(rmsOf(scenePcm));
  if (whole.corr < 0.8) notes.push(`soundtrack differs from the scene audio (correlation ${whole.corr.toFixed(2)})`);
  if (Math.abs(offsetMs) > 45) notes.push(`audio is ${offsetMs > 0 ? "late" : "early"} by ${Math.abs(offsetMs)} ms`);
  if (Math.abs(driftMs) > 40) notes.push(`audio drifts ${driftMs} ms from start to end (frame-rate or speed mismatch)`);
  if (Math.abs(level) > 3) notes.push(`level changed by ${level.toFixed(1)} dB in the video`);

  let mouths: AvReport["mouths"];
  if (drawn) {
    const lips = lipTrack(scenePcm, sceneRate, timeline, drawn.fps);
    mouths = {};
    for (const [sp, track] of Object.entries(drawn.tracks)) {
      const heard = lips.tracks[sp]?.open;
      if (!heard) {
        mouths[sp] = { correlation: 0, lagFrames: 0, openWhileSilent: 0, verdict: "no lines for this character in the scene" };
        continue;
      }
      const res = pearsonLag(heard, track, 6);
      const silent = heard.map((h, i) => (h === 0 && (track[i] ?? 0) > 0.25 ? 1 : 0) as number).reduce((n, x) => n + x, 0);
      const quiet = heard.filter((h) => h === 0).length || 1;
      const openWhileSilent = Math.round((silent / quiet) * 100) / 100;
      const bad: string[] = [];
      if (res.corr < 0.5) bad.push(`mouth follows the speech weakly (r=${res.corr.toFixed(2)})`);
      if (Math.abs(res.lag) > 1) bad.push(`mouth is ${Math.abs(res.lag)} frames ${res.lag > 0 ? "late" : "early"}`);
      if (openWhileSilent > 0.1) bad.push(`mouth open during ${Math.round(openWhileSilent * 100)}% of silent frames`);
      mouths[sp] = { correlation: Math.round(res.corr * 100) / 100, lagFrames: res.lag, openWhileSilent, verdict: bad.length ? bad.join("; ") : "matches" };
      if (bad.length) notes.push(`${sp}: ${bad.join("; ")}`);
    }
  }
  return {
    video: { seconds: Math.round(Number(probe.format?.duration ?? 0) * 100) / 100, fps },
    audioOffsetMs: offsetMs,
    driftMs,
    matchCorrelation: Math.round(whole.corr * 100) / 100,
    levelChangeDb: Math.round(level * 10) / 10,
    ...(mouths ? { mouths } : {}),
    verdict: notes.length ? "check" : "in sync",
    notes,
  };
}

export function readWavFile(buf: Uint8Array) {
  return decodeWav(buf);
}
