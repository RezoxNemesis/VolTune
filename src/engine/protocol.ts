/** Messages exchanged between the UI thread and the speech worker. */

export type Device = "webgpu" | "wasm";

export interface Job {
  index: number;
  text: string;
  voice: string;
  speed: number;
}

export type ToWorker =
  | { type: "init"; device: Device }
  | { type: "generate"; id: number; jobs: Job[] }
  | { type: "cancel"; id: number };

export type FromWorker =
  | { type: "progress"; loaded: number; total: number; file: string }
  | { type: "ready"; device: Device }
  | { type: "chunk"; id: number; index: number; pcm: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "cancelled"; id: number }
  | { type: "error"; id?: number; message: string; stage: "init" | "generate" };
