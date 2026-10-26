import { SAMPLE_RATE } from "./audio";
import type { ClipMeta, ClipStore } from "./store";

/** 44-byte RIFF/WAVE header for 16-bit mono PCM. */
export function wavHeader(samples: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = samples * 2;
  const buf = new ArrayBuffer(44);
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
  return new Uint8Array(buf);
}

export function totalSamples(metas: readonly ClipMeta[]): number {
  const last = metas[metas.length - 1];
  return last ? last.startSample + last.samples : 0;
}

/**
 * Yields the WAV file piece by piece (header, then audio and silence in order) so callers can
 * stream it to disk without ever holding the whole file in memory.
 */
export async function* wavPieces(store: ClipStore, jobId: string, metas: readonly ClipMeta[]): AsyncGenerator<Uint8Array> {
  yield wavHeader(totalSamples(metas));
  let cursor = 0;
  for (const m of metas) {
    const gap = m.startSample - cursor;
    if (gap > 0) yield new Uint8Array(gap * 2);
    const pcm = await store.get(jobId, m.index);
    yield new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    cursor = m.startSample + m.samples;
  }
}

/** Join pieces into chunks of roughly `size` bytes (last one may be smaller). */
export async function* rechunk(pieces: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  let buf = new Uint8Array(size);
  let n = 0;
  for await (const p of pieces) {
    let off = 0;
    while (off < p.length) {
      const take = Math.min(size - n, p.length - off);
      buf.set(p.subarray(off, off + take), n);
      n += take;
      off += take;
      if (n === size) {
        yield buf;
        buf = new Uint8Array(size);
        n = 0;
      }
    }
  }
  if (n > 0) yield buf.subarray(0, n);
}

/** Whole WAV as a Blob (browser download). Blob parts let the browser spill large files to disk. */
export async function buildWavBlob(store: ClipStore, jobId: string, metas: readonly ClipMeta[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  for await (const p of wavPieces(store, jobId, metas)) parts.push(p as BlobPart);
  return new Blob(parts, { type: "audio/wav" });
}
