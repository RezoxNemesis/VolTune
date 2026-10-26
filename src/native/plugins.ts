import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** Native ONNX Runtime inference (Android app only). */
export interface NativeTtsPlugin {
  init(opts: { modelUrl: string; fileName: string; threads: number }): Promise<{ ready: boolean; threads: number; ms: number }>;
  infer(opts: { ids: number[]; style: number[]; speed: number }): Promise<{ pcm: string; samples: number; ms: number }>;
  release(): Promise<void>;
  addListener(event: "downloadProgress", cb: (p: { loaded: number; total: number }) => void): Promise<PluginListenerHandle>;
}

/** System "Save as" dialog (Android app only). */
export interface FileSaverPlugin {
  save(opts: { path: string; name: string; mime: string }): Promise<{ uri: string }>;
}

export const NativeTts = registerPlugin<NativeTtsPlugin>("NativeTts");
export const FileSaver = registerPlugin<FileSaverPlugin>("FileSaver");

export const NATIVE_MODEL_URL = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx";
export const NATIVE_MODEL_FILE = "kokoro-v1.0-fp32.onnx";

/** Decode the plugin's base64 little-endian 16-bit PCM into floats. */
export function decodePcm16(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v / (v < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}
