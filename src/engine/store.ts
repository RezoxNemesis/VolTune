/**
 * Disk-backed storage for generated audio. A one-hour narration is ~170 MB of 16-bit PCM, far too
 * much to keep as JavaScript arrays on a phone, so clips live in IndexedDB and are loaded on demand.
 * Because clips persist, an interrupted render can be resumed instead of restarted.
 */

import { SAMPLE_RATE } from "./audio";

export interface ClipMeta {
  index: number;
  /** Position on the shared timeline, in samples at SAMPLE_RATE. */
  startSample: number;
  samples: number;
  /** Silence that follows this clip, in samples. */
  pauseSamples: number;
}

export interface JobRecord {
  id: string;
  planHash: string;
  total: number;
  createdAt: number;
}

export const secs = (samples: number): number => samples / SAMPLE_RATE;

/** Total timeline length (seconds) covered by the clips so far, excluding the trailing pause. */
export function metasDuration(metas: readonly ClipMeta[]): number {
  const last = metas[metas.length - 1];
  return last ? secs(last.startSample + last.samples) : 0;
}

/** Where the next clip should start. */
export function nextStartSample(metas: readonly ClipMeta[]): number {
  const last = metas[metas.length - 1];
  return last ? last.startSample + last.samples + last.pauseSamples : 0;
}

export interface ClipStore {
  /** Find a stored job with this plan, so an interrupted render can continue. */
  findJob(planHash: string): Promise<JobRecord | undefined>;
  /** Start (or restart) a job. Any other job is discarded to bound disk use. */
  startJob(job: JobRecord): Promise<void>;
  put(jobId: string, meta: ClipMeta, pcm: Int16Array): Promise<void>;
  get(jobId: string, index: number): Promise<Int16Array>;
  /** Contiguous metadata from index 0, in order. */
  metas(jobId: string): Promise<ClipMeta[]>;
  deleteJob(jobId: string): Promise<void>;
  /** Drop clips at or after `fromIndex` (used when resuming after a partial write). */
  truncate(jobId: string, fromIndex: number): Promise<void>;
}

/* ---------- in-memory fallback (tests, private browsing) ---------- */

export class MemoryClipStore implements ClipStore {
  private jobs = new Map<string, JobRecord>();
  private clips = new Map<string, Map<number, { meta: ClipMeta; pcm: Int16Array }>>();

  async findJob(planHash: string) {
    return [...this.jobs.values()].find((j) => j.planHash === planHash);
  }
  async startJob(job: JobRecord) {
    this.jobs.clear();
    this.clips.clear();
    this.jobs.set(job.id, job);
    this.clips.set(job.id, new Map());
  }
  async put(jobId: string, meta: ClipMeta, pcm: Int16Array) {
    this.clips.get(jobId)?.set(meta.index, { meta, pcm });
  }
  async get(jobId: string, index: number) {
    const c = this.clips.get(jobId)?.get(index);
    if (!c) throw new Error(`Missing clip ${index}`);
    return c.pcm;
  }
  async metas(jobId: string) {
    return contiguous([...(this.clips.get(jobId)?.values() ?? [])].map((c) => c.meta));
  }
  async deleteJob(jobId: string) {
    this.jobs.delete(jobId);
    this.clips.delete(jobId);
  }
  async truncate(jobId: string, fromIndex: number) {
    const m = this.clips.get(jobId);
    if (m) for (const k of [...m.keys()]) if (k >= fromIndex) m.delete(k);
  }
}

function contiguous(all: ClipMeta[]): ClipMeta[] {
  all.sort((a, b) => a.index - b.index);
  const out: ClipMeta[] = [];
  for (const m of all) {
    if (m.index !== out.length) break;
    out.push(m);
  }
  return out;
}

/* ---------- IndexedDB ---------- */

const DB_NAME = "voltune-audio";
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IdbClipStore implements ClipStore {
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IdbClipStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("jobs", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: ["jobId", "index"] });
        d.createObjectStore("pcm");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("Could not open storage"));
      r.onblocked = () => reject(new Error("Storage is blocked by another tab"));
    });
    return new IdbClipStore(db);
  }

  async findJob(planHash: string) {
    const all = await req(this.db.transaction("jobs").objectStore("jobs").getAll() as IDBRequest<JobRecord[]>);
    return all.find((j) => j.planHash === planHash);
  }

  async startJob(job: JobRecord) {
    const tx = this.db.transaction(["jobs", "meta", "pcm"], "readwrite");
    tx.objectStore("jobs").clear();
    tx.objectStore("meta").clear();
    tx.objectStore("pcm").clear();
    tx.objectStore("jobs").put(job);
    await done(tx);
  }

  async put(jobId: string, meta: ClipMeta, pcm: Int16Array) {
    const tx = this.db.transaction(["meta", "pcm"], "readwrite");
    // Copy into a standalone buffer so the stored value never aliases a larger one.
    tx.objectStore("pcm").put(pcm.slice().buffer, `${jobId}:${meta.index}`);
    tx.objectStore("meta").put({ jobId, ...meta });
    await done(tx);
  }

  async get(jobId: string, index: number) {
    const buf = await req(this.db.transaction("pcm").objectStore("pcm").get(`${jobId}:${index}`) as IDBRequest<ArrayBuffer | undefined>);
    if (!buf) throw new Error(`Missing clip ${index}`);
    return new Int16Array(buf);
  }

  async metas(jobId: string) {
    const range = IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]);
    const rows = await req(this.db.transaction("meta").objectStore("meta").getAll(range) as IDBRequest<Array<ClipMeta & { jobId: string }>>);
    return contiguous(rows.map(({ jobId: _j, ...m }) => m));
  }

  async deleteJob(jobId: string) {
    const tx = this.db.transaction(["jobs", "meta", "pcm"], "readwrite");
    tx.objectStore("jobs").delete(jobId);
    tx.objectStore("meta").delete(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]));
    tx.objectStore("pcm").delete(IDBKeyRange.bound(`${jobId}:`, `${jobId}:￿`));
    await done(tx);
  }

  async truncate(jobId: string, fromIndex: number) {
    const tx = this.db.transaction(["meta", "pcm"], "readwrite");
    tx.objectStore("meta").delete(IDBKeyRange.bound([jobId, fromIndex], [jobId, Number.MAX_SAFE_INTEGER]));
    // pcm keys are strings: remove any whose numeric suffix is >= fromIndex.
    const store = tx.objectStore("pcm");
    const cursorReq = store.openKeyCursor(IDBKeyRange.bound(`${jobId}:`, `${jobId}:￿`));
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (!c) return;
      const idx = Number(String(c.key).slice(jobId.length + 1));
      if (idx >= fromIndex) store.delete(c.key);
      c.continue();
    };
    await done(tx);
  }
}

/** Open IndexedDB storage, or fall back to memory when it is unavailable. */
export async function openStore(): Promise<{ store: ClipStore; persistent: boolean }> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    return { store: await IdbClipStore.open(), persistent: true };
  } catch {
    return { store: new MemoryClipStore(), persistent: false };
  }
}

/** Stable identifier for a render plan, so identical requests can resume. */
export async function hashPlan(plan: ReadonlyArray<{ text: string; voice: string; speed: number; pauseMs: number }>): Promise<string> {
  const s = JSON.stringify(plan.map((p) => [p.text, p.voice, p.speed, p.pauseMs]));
  try {
    if (globalThis.crypto?.subtle) {
      const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fall through */
  }
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) h = ((h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16);
}
