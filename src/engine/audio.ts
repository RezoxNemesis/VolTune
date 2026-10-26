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
