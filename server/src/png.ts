/** Minimal RGB PNG encoder (zlib from Node), for spectrogram and waveform images. */
import { deflateSync } from "node:zlib";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export class Canvas {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: [number, number, number] = [10, 12, 20]) {
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(bg, i * 3);
  }
  set(x: number, y: number, c: readonly [number, number, number]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }
  rect(x: number, y: number, w: number, h: number, c: readonly [number, number, number]) {
    for (let j = Math.max(0, Math.round(y)); j < Math.min(this.h, Math.round(y + h)); j++) for (let i = Math.max(0, Math.round(x)); i < Math.min(this.w, Math.round(x + w)); i++) this.px.set(c, (j * this.w + i) * 3);
  }
  png(): Uint8Array {
    const raw = new Uint8Array((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      raw.set(this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1);
    }
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, this.w);
    v.setUint32(4, this.h);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** "Magma"-like colour ramp, t in 0…1. */
export function heat(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t));
  const stops: Array<[number, number, number]> = [
    [5, 5, 20],
    [60, 15, 110],
    [180, 40, 110],
    [250, 120, 60],
    [252, 250, 190],
  ];
  const p = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round) as [number, number, number];
}
