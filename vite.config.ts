import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** Self-host the ONNX Runtime WebAssembly files so the app needs no third-party CDN at runtime. */
function selfHostOrt(): Plugin {
  const files = [
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ];
  const src = (f: string) => resolve("node_modules/onnxruntime-web/dist", f);
  return {
    name: "voltune-self-host-ort",
    configureServer(server) {
      server.middlewares.use("/ort/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
        if (!files.includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        import("node:fs").then((fs) => fs.createReadStream(src(name)).pipe(res));
      });
    },
    closeBundle() {
      const out = resolve("dist/ort");
      mkdirSync(out, { recursive: true });
      for (const f of files) if (existsSync(src(f))) copyFileSync(src(f), resolve(out, f));
      // The runtime loads wasm from /ort/ (see worker.ts). Drop the hashed duplicate the bundler emits.
      const assets = resolve("dist/assets");
      if (existsSync(assets)) for (const f of readdirSync(assets)) if (/^ort-wasm.*\.wasm$/.test(f)) rmSync(resolve(assets, f));
    },
  };
}

export default defineConfig({
  plugins: [selfHostOrt()],
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 1200 },
  worker: { format: "es" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
