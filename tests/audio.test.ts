import { describe, expect, it } from "vitest";
import { encodeWav, fadeEdges, loudnessGain, peak, polish, rms, stitch, trimSilence } from "../src/engine/audio";

const tone = (n: number, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * amp);

describe("trimSilence", () => {
  it("removes silent padding but keeps a short tail", () => {
    const pcm = new Float32Array(24_000);
    pcm.set(tone(2_000), 8_000);
    const out = trimSilence(pcm);
    expect(out.length).toBeLessThan(pcm.length);
    expect(out.length).toBeGreaterThanOrEqual(2_000);
  });
  it("returns the input when there is nothing to trim", () => {
    const pcm = tone(1_000);
    expect(trimSilence(pcm)).toBe(pcm);
  });
});

describe("fadeEdges", () => {
  it("starts and ends at zero", () => {
    const out = fadeEdges(Float32Array.from({ length: 4_800 }, () => 1));
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(0);
    expect(out[2_400]).toBe(1);
  });
  it("copes with tiny clips", () => {
    expect(() => fadeEdges(new Float32Array(3))).not.toThrow();
  });
});

describe("loudnessGain", () => {
  it("raises quiet audio toward the target and never clips", () => {
    const quiet = tone(5_000, 0.02);
    const g = loudnessGain(quiet);
    expect(g).toBeGreaterThan(1);
    expect(peak(quiet) * g).toBeLessThanOrEqual(0.97 + 1e-6);
  });
  it("lowers loud audio and ignores silence", () => {
    expect(loudnessGain(tone(5_000, 0.9))).toBeLessThan(1);
    expect(loudnessGain(new Float32Array(100))).toBe(1);
  });
});

describe("polish", () => {
  it("returns a new, faded, level-matched clip", () => {
    const input = new Float32Array(20_000);
    input.set(tone(10_000, 0.1), 5_000);
    const out = polish(input);
    expect(out).not.toBe(input);
    expect(out[0]).toBe(0);
    expect(rms(out)).toBeGreaterThan(rms(input));
  });
});

describe("stitch", () => {
  it("places clips at their start times with silence between", () => {
    const a = new Float32Array([1, 1]);
    const b = new Float32Array([2, 2]);
    const out = stitch([{ start: 0, pcm: a }, { start: 4 / 24_000, pcm: b }]);
    expect(Array.from(out)).toEqual([1, 1, 0, 0, 2, 2]);
  });
  it("is empty for no input", () => {
    expect(stitch([]).length).toBe(0);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit mono header", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]));
    const v = new DataView(wav);
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(wav, o, n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(wav.byteLength).toBe(44 + 8);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });
  it("clamps out-of-range samples", () => {
    const v = new DataView(encodeWav(Float32Array.from([5, -5])));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});
