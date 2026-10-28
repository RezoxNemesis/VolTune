import { build } from "esbuild";
const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Native and data-heavy packages stay in node_modules.
  external: ["onnxruntime-node", "phonemizer", "kokoro-js", "@modelcontextprotocol/sdk", "zod", "sherpa-onnx-node"],
  logLevel: "info",
};
await build({ ...shared, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node" } });
await build({ ...shared, entryPoints: ["src/mcp.ts"], outfile: "dist/mcp.js" });
