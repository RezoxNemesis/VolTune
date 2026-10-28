/** Small, dependency-free audio analysis: framing, FFT, pitch (YIN), loudness and spectral shape. */

export const HOP_S = 0.01; // 10 ms analysis hop
export const WIN_S = 0.04; // 40 ms window

export function db(x: number): number {
  return 20 * Math.log10(Math.max(1e-9, x));
}

export function rmsOf(a: Float32Array, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Frame {
  t: number;
  rms: number;
  /** Fundamental frequency in Hz, 0 when unvoiced. */
  f0: number;
  /** Spectral centroid in Hz (brightness). */
  centroid: number;
  /** Spectral flatness 0…1 (noise-like/breathy vs tonal). */
  flatness: number;
  /** Share of energy below 1 kHz. */
  low: number;
}

/** YIN pitch estimate for one window; returns 0 when not periodic enough. */
function yin(x: Float32Array, start: number, size: number, sr: number, fmin = 60, fmax = 500): number {
  const maxLag = Math.min(Math.floor(sr / fmin), size >> 1);
  const minLag = Math.floor(sr / fmax);
  const d = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < size - maxLag; i++) {
      const v = x[start + i]! - x[start + i + lag]!;
      s += v * v;
    }
    d[lag] = s;
  }
  let run = 0;
  let best = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    run += d[lag]!;
    const cm = run > 0 ? (d[lag]! * lag) / run : 1;
    if (lag >= minLag && cm < 0.15) {
      // walk to the local minimum
      let l = lag;
      while (l + 1 <= maxLag && d[l + 1]! < d[l]!) l++;
      best = l;
      break;
    }
  }
  if (!best) return 0;
  // parabolic interpolation
  const a = d[best - 1] ?? d[best]!;
  const b = d[best]!;
  const c = d[best + 1] ?? d[best]!;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return sr / (best + shift);
}

/** Frame-by-frame features over the whole signal. */
export function analyseFrames(x: Float32Array, sr: number): Frame[] {
  const hop = Math.round(HOP_S * sr);
  const win = Math.round(WIN_S * sr);
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const hann = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  const frames: Frame[] = [];
  for (let start = 0; start + win <= x.length; start += hop) {
    const rms = rmsOf(x, start, start + win);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win && i < N; i++) re[i] = x[start + i]! * hann[i]!;
    fft(re, im);
    let total = 0;
    let weighted = 0;
    let logSum = 0;
    let low = 0;
    const bins = N / 2;
    for (let k = 1; k < bins; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]! + 1e-12;
      const f = (k * sr) / N;
      total += p;
      weighted += p * f;
      logSum += Math.log(p);
      if (f < 1000) low += p;
    }
    const geo = Math.exp(logSum / (bins - 1));
    const arith = total / (bins - 1);
    const f0 = rms > 0.01 ? yin(x, start, win, sr) : 0;
    frames.push({ t: start / sr, rms, f0, centroid: total > 0 ? weighted / total : 0, flatness: arith > 0 ? geo / arith : 0, low: total > 0 ? low / total : 0 });
  }
  return frames;
}

/** Magnitude spectrogram (dB) with `bins` rows, one column per hop. */
export function spectrogram(x: Float32Array, sr: number, maxHz = 8000): { cols: Float32Array[]; bins: number } {
  const hop = Math.round(HOP_S * sr);
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const bins = Math.floor((maxHz / sr) * N);
  const cols: Float32Array[] = [];
  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = x[start + i]! * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float32Array(bins);
    for (let k = 0; k < bins; k++) col[k] = 10 * Math.log10(re[k]! * re[k]! + im[k]! * im[k]! + 1e-10);
    cols.push(col);
  }
  return { cols, bins };
}

export const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const quantile = (a: number[], q: number): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};

export const semitones = (a: number, b: number): number => (a > 0 && b > 0 ? 12 * Math.log2(a / b) : 0);

/** Downmix/convert a 16-bit PCM WAV (any channels, any rate) to mono float. */
export function decodeWav(buf: Uint8Array): { pcm: Float32Array; sampleRate: number } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let o = 12;
  let channels = 1;
  let rate = 24000;
  let bits = 16;
  let fmt = 1;
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      fmt = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === "data") {
      const frames = Math.floor(size / (channels * (bits / 8)));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const p = o + 8 + (i * channels + c) * (bits / 8);
          if (fmt === 3 && bits === 32) s += v.getFloat32(p, true);
          else if (bits === 16) s += v.getInt16(p, true) / 32768;
          else if (bits === 32) s += v.getInt32(p, true) / 2147483648;
          else if (bits === 24) s += ((buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16)) << 8 >> 8) / 8388608;
        }
        out[i] = s / channels;
      }
      return { pcm: out, sampleRate: rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
