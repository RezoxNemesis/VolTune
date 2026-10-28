/** Pure PCM helpers: clean-up, loudness matching, and WAV encoding. No DOM or Web Audio required. */

export const SAMPLE_RATE = 24_000;

/** Remove near-silent padding at the edges of a synthesized clip, keeping a short natural tail. */
export function trimSilence(pcm: Float32Array, sampleRate = SAMPLE_RATE, threshold = 0.008, keepMs = 24): Float32Array {
  let start = 0;
  let end = pcm.length;
  while (start < end && Math.abs(pcm[start]!) < threshold) start++;
  while (end > start && Math.abs(pcm[end - 1]!) < threshold) end--;
  const keep = Math.round((keepMs / 1000) * sampleRate);
  start = Math.max(0, start - keep);
  end = Math.min(pcm.length, end + keep);
  return start === 0 && end === pcm.length ? pcm : pcm.slice(start, end);
}

/** Apply short linear fades in place to avoid clicks where clips meet silence. */
export function fadeEdges(pcm: Float32Array, sampleRate = SAMPLE_RATE, ms = 12): Float32Array {
  const n = Math.min(Math.round((ms / 1000) * sampleRate), Math.floor(pcm.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    pcm[i] = pcm[i]! * g;
    pcm[pcm.length - 1 - i] = pcm[pcm.length - 1 - i]! * g;
  }
  return pcm;
}

export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length);
}

export function peak(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]!);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Gain that brings a clip to the target RMS without clipping. Gain is clamped so quiet
 * whispers are not blown up into noise and loud clips are not crushed.
 */
export function loudnessGain(pcm: Float32Array, targetRms = 0.085, maxPeak = 0.97): number {
  const r = rms(pcm);
  const p = peak(pcm);
  if (r < 1e-4 || p < 1e-4) return 1;
  const gain = Math.min(Math.max(targetRms / r, 0.5), 2.5);
  return Math.min(gain, maxPeak / p);
}

/** Prepare a freshly synthesized clip for playback: trim, level, fade. Returns a new array. */
export function polish(pcm: Float32Array, sampleRate = SAMPLE_RATE): Float32Array {
  const trimmed = trimSilence(pcm, sampleRate);
  const out = new Float32Array(trimmed.length);
  const g = loudnessGain(trimmed);
  for (let i = 0; i < trimmed.length; i++) out[i] = trimmed[i]! * g;
  return fadeEdges(out, sampleRate);
}

export interface Placed {
  /** Start time in seconds on the shared timeline. */
  start: number;
  pcm: Float32Array;
}

/** Mix placed clips and gaps into one continuous mono buffer. */
export function stitch(parts: readonly Placed[], sampleRate = SAMPLE_RATE): Float32Array {
  let total = 0;
  for (const p of parts) total = Math.max(total, Math.round(p.start * sampleRate) + p.pcm.length);
  const out = new Float32Array(total);
  for (const p of parts) out.set(p.pcm, Math.round(p.start * sampleRate));
  return out;
}

/** Encode mono float PCM as a 16-bit little-endian WAV file. */
export function encodeWav(pcm: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Quantise float PCM to 16-bit for compact storage and export. */
export function toInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function toFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / (pcm[i]! < 0 ? 0x8000 : 0x7fff);
  return out;
}

/* ---------- voice shaping: pitch, delivery colour, lip-sync envelope ---------- */

/**
 * Time-stretch without changing pitch (WSOLA: overlap-add of windowed frames, each aligned to the
 * waveform by cross-correlation so voiced sounds stay continuous). `factor` > 1 makes it longer.
 */
export function timeStretch(pcm: Float32Array, factor: number, sampleRate = SAMPLE_RATE): Float32Array {
  if (Math.abs(factor - 1) < 1e-3 || pcm.length < 64) return pcm.slice();
  const win = Math.round(sampleRate * 0.04) & ~1;
  const hs = win >> 1;
  const ha = hs / factor;
  const tol = Math.round(sampleRate * 0.01);
  const outLen = Math.round(pcm.length * factor);
  const out = new Float32Array(outLen + win);
  const norm = new Float32Array(outLen + win);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
  let prevPos = 0;
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos += hs) {
    const target = Math.round(k * ha);
    let best = target;
    if (k > 0) {
      // Find the frame start near `target` that best continues the previous frame.
      const natural = prevPos + hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, target - tol);
      const hi = Math.min(pcm.length - win, target + tol);
      for (let c = lo; c <= hi; c += 2) {
        let s = 0;
        for (let i = 0; i < hs; i += 4) s += (pcm[c + i] ?? 0) * (pcm[natural + i] ?? 0);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
    }
    best = Math.max(0, Math.min(best, Math.max(0, pcm.length - win)));
    for (let i = 0; i < win; i++) {
      out[outPos + i]! += (pcm[best + i] ?? 0) * w[i]!;
      norm[outPos + i]! += w[i]!;
    }
    prevPos = best;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i]! > 1e-3 ? out[i]! / norm[i]! : out[i]!;
  return res;
}

/** Resample by linear interpolation to `length` samples. */
export function resampleTo(pcm: Float32Array, length: number): Float32Array {
  const out = new Float32Array(Math.max(0, length));
  if (pcm.length === 0 || length <= 0) return out;
  const step = (pcm.length - 1) / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (pcm[j] ?? 0) * (1 - f) + (pcm[j + 1] ?? pcm[j] ?? 0) * f;
  }
  return out;
}

/** Shift pitch by `semitones` while keeping the duration (stretch, then resample). */
export function pitchShift(pcm: Float32Array, semitones: number, sampleRate = SAMPLE_RATE): Float32Array {
  if (Math.abs(semitones) < 0.05) return pcm;
  const r = Math.pow(2, semitones / 12);
  return resampleTo(timeStretch(pcm, r, sampleRate), pcm.length);
}

/** One-pole low-pass, in place. */
function lowpass(pcm: Float32Array, cutoff: number, sampleRate: number) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  for (let i = 0; i < pcm.length; i++) {
    y = (1 - a) * pcm[i]! + a * y;
    pcm[i] = y;
  }
}

export interface Colour {
  /** Linear gain applied after loudness matching (whispers < 1 < shouts). */
  gain: number;
  /** 0 … 1: darker, breathier, quieter delivery (whisper, murmur). */
  soft: number;
  /** 0 … 1: pushed, slightly saturated delivery (shout, anger). */
  edge: number;
}

/** Give a polished clip the colour of its delivery. Returns a new array. */
export function colour(pcm: Float32Array, c: Partial<Colour>, sampleRate = SAMPLE_RATE): Float32Array {
  const gain = c.gain ?? 1;
  const soft = Math.min(1, Math.max(0, c.soft ?? 0));
  const edge = Math.min(1, Math.max(0, c.edge ?? 0));
  if (gain === 1 && soft === 0 && edge === 0) return pcm;
  const out = pcm.slice();
  if (soft > 0) {
    const dark = out.slice();
    lowpass(dark, 2600 - 1400 * soft, sampleRate);
    // A little shaped noise riding on the voice's own envelope reads as breath.
    let env = 0;
    let seed = 1234567;
    for (let i = 0; i < out.length; i++) {
      env = Math.max(Math.abs(out[i]!), env * 0.9992);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed / 0x7fffffff - 0.5) * env * 0.35 * soft;
      out[i] = out[i]! * (1 - soft) + dark[i]! * soft + n;
    }
  }
  if (edge > 0) {
    const drive = 1 + 2.5 * edge;
    const k = Math.tanh(drive);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * drive) / k;
  }
  let p = 0;
  for (let i = 0; i < out.length; i++) p = Math.max(p, Math.abs(out[i]! * gain));
  const g = p > 0.97 ? (gain * 0.97) / p : gain;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * g;
  return out;
}

/** Mouth-openness per animation frame (0 … 1), for lip-syncing characters to the audio. */
export function mouthEnvelope(pcm: Float32Array, fps = 30, sampleRate = SAMPLE_RATE): number[] {
  const per = sampleRate / fps;
  const n = Math.ceil(pcm.length / per);
  const raw: number[] = [];
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = Math.floor(f * per);
    const b = Math.min(pcm.length, Math.floor((f + 1) * per));
    for (let i = a; i < b; i++) s += pcm[i]! * pcm[i]!;
    raw.push(Math.sqrt(s / Math.max(1, b - a)));
  }
  const ref = [...raw].sort((x, y) => x - y)[Math.floor(raw.length * 0.95)] || 1;
  return raw.map((v) => {
    const x = Math.min(1, v / (ref || 1));
    return Math.round((x < 0.08 ? 0 : Math.pow(x, 0.7)) * 100) / 100;
  });
}
