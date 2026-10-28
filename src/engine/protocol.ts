/** Messages exchanged between the UI thread and the speech worker. */

export type Device = "webgpu" | "wasm" | "native";

export interface Job {
  index: number;
  text: string;
  /** Stock voice id or mix expression ("af_heart*0.6+am_puck*0.4"). */
  voice: string;
  speed: number;
  /** Delivery shaping applied in the worker after synthesis. */
  pitch?: number;
  gain?: number;
  soft?: number;
  edge?: number;
}

export type ToWorker =
  | { type: "init"; device: Device }
  | { type: "generate"; id: number; jobs: Job[] }
  | { type: "cancel"; id: number }
  | { type: "inferResult"; reqId: number; pcm?: Float32Array; error?: string };

export type FromWorker =
  | { type: "progress"; loaded: number; total: number; file: string }
  | { type: "ready"; device: Device }
  | { type: "infer"; reqId: number; ids: BigInt64Array; style: Float32Array; speed: number }
  /** `pcm` is already polished (trimmed, levelled, shaped by its delivery). */
  | { type: "chunk"; id: number; index: number; pcm: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "cancelled"; id: number }
  | { type: "error"; id?: number; message: string; stage: "init" | "generate" };
