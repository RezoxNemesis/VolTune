import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IdbClipStore, MemoryClipStore, hashPlan, metasDuration, nextStartSample, type ClipMeta, type ClipStore } from "../src/engine/store";
import { buildWavBlob, rechunk, totalSamples, wavHeader, wavPieces } from "../src/engine/export";

const meta = (index: number, startSample: number, samples: number, pauseSamples: number): ClipMeta => ({ index, startSample, samples, pauseSamples });

async function exercise(make: () => Promise<ClipStore>) {
  const store = await make();
  await store.startJob({ id: "a", planHash: "h1", total: 3, createdAt: 1 });
  await store.put("a", meta(0, 0, 3, 2), Int16Array.from([1, 2, 3]));
  await store.put("a", meta(1, 5, 2, 1), Int16Array.from([4, 5]));
  expect((await store.get("a", 1)).join(",")).toBe("4,5");
  expect((await store.findJob("h1"))?.id).toBe("a");
  expect(await store.findJob("nope")).toBeUndefined();
  const metas = await store.metas("a");
  expect(metas.map((m) => m.index)).toEqual([0, 1]);
  expect(nextStartSample(metas)).toBe(8);
  expect(metasDuration(metas)).toBeCloseTo(7 / 24_000, 9);

  // A gap in the stored clips ends the contiguous run (partial write after a crash).
  await store.put("a", meta(3, 9, 1, 0), Int16Array.from([9]));
  expect((await store.metas("a")).length).toBe(2);
  await store.truncate("a", 1);
  expect((await store.metas("a")).length).toBe(1);
  await expect(store.get("a", 1)).rejects.toThrow();

  // Starting another job discards the old one.
  await store.startJob({ id: "b", planHash: "h2", total: 1, createdAt: 2 });
  expect(await store.findJob("h1")).toBeUndefined();
  expect(await store.metas("a")).toEqual([]);
  await store.deleteJob("b");
  expect(await store.findJob("h2")).toBeUndefined();
}

describe("clip stores", () => {
  it("memory store keeps, resumes and truncates clips", () => exercise(async () => new MemoryClipStore()));
  it("IndexedDB store keeps, resumes and truncates clips", () => exercise(async () => IdbClipStore.open()));
});

describe("hashPlan", () => {
  const p = [{ text: "Hi.", voice: "v", speed: 1, pauseMs: 300 }];
  it("is stable and sensitive to content", async () => {
    expect(await hashPlan(p)).toBe(await hashPlan(p));
    expect(await hashPlan(p)).not.toBe(await hashPlan([{ ...p[0]!, text: "Hello." }]));
    expect(await hashPlan(p)).not.toBe(await hashPlan([{ ...p[0]!, voice: "w" }]));
  });
});

describe("streaming WAV export", () => {
  async function setup() {
    const store = new MemoryClipStore();
    await store.startJob({ id: "j", planHash: "x", total: 2, createdAt: 0 });
    await store.put("j", meta(0, 0, 3, 2), Int16Array.from([1, 2, 3]));
    await store.put("j", meta(1, 5, 2, 0), Int16Array.from([4, 5]));
    return { store, metas: await store.metas("j") };
  }

  it("lays clips and silence out sample-exact", async () => {
    const { store, metas } = await setup();
    const blob = await buildWavBlob(store, "j", metas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBe(44 + 7 * 2);
    const v = new DataView(bytes.buffer);
    expect(Array.from({ length: 7 }, (_, i) => v.getInt16(44 + i * 2, true))).toEqual([1, 2, 3, 0, 0, 4, 5]);
    expect(v.getUint32(40, true)).toBe(14);
    expect(v.getUint32(4, true)).toBe(36 + 14);
  });

  it("reports the total length", async () => {
    const { metas } = await setup();
    expect(totalSamples(metas)).toBe(7);
    expect(new DataView(wavHeader(7).buffer).getUint32(24, true)).toBe(24_000);
  });

  it("rechunks into bounded pieces without losing bytes", async () => {
    const { store, metas } = await setup();
    const all: number[] = [];
    let max = 0;
    for await (const c of rechunk(wavPieces(store, "j", metas), 10)) {
      max = Math.max(max, c.length);
      all.push(...c);
    }
    expect(all.length).toBe(44 + 14);
    expect(max).toBeLessThanOrEqual(10);
  });
});
