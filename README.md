# VolTune

Natural text to speech and multi-voice dialogue that runs entirely in the browser. Nothing is uploaded, there is no server to operate, and no API key to manage.

VolTune uses the open [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) voice model (Apache 2.0) through ONNX Runtime Web. It runs on WebGPU when available and falls back to WebAssembly.

## What it does

- **Speak**: paste text, pick a voice, set the pace, listen. Playback starts as soon as the first sentence is ready.
- **Dialogue**: write a script as `Name: line` or `[Name] line`. Each speaker gets their own voice, with a beat of silence when the speaker changes. Stage directions like `(sighs)` or `*laughs*` are not spoken.
- **Read-along**: the sentence being spoken is lit; click any sentence to jump to it.
- **Save audio**: export the whole piece as a 24 kHz mono WAV.

### Why it sounds less robotic

- Text is cleaned first: markdown, links and code are dropped, abbreviations (`Dr.`, `vs.`, `e.g.`) are expanded, quotes and ellipses are normalised.
- Sentences are split without breaking on initials, decimals or domains, and long ones are split at clause boundaries, so the model always speaks phrase-sized units.
- Pauses follow punctuation (ellipsis > question > full stop > colon > comma) and are longer between paragraphs and speakers.
- Every clip is trimmed of model padding, loudness-matched across voices, and faded at the edges to avoid clicks.

## Quick start

Requires Node 22 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Unit tests (text, dialogue, audio) |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Deploying

VolTune is a static site. Deploy `dist/` to any static host.

```bash
npm run build
```

- **Cloudflare Pages / Netlify**: publish `dist`. The included `public/_headers` file is copied into the build and sets a strict Content-Security-Policy, security headers and cache rules. On other hosts, apply the same headers.
- The ONNX Runtime WebAssembly files are served from your own origin under `/ort/`, so the page loads no third-party scripts. The largest file is about 21 MB, under Cloudflare Pages' 25 MB per-file limit.
- The only external request at runtime is the one-time model download from `huggingface.co`, which the browser then caches. To avoid that dependency, host the model files yourself and change `MODEL_ID` handling in `src/engine/worker.ts`.

## How it is built

```
src/
  engine/
    text.ts       normalise, split and pace text
    dialogue.ts   script parser and voice assignment
    audio.ts      trim, level, fade, stitch, WAV encode (pure functions)
    voices.ts     curated voice list
    worker.ts     Kokoro model in a Web Worker
    client.ts     worker client; turns segments into timed clips
    player.ts     gapless Web Audio timeline with pause and seek
    protocol.ts   messages between UI and worker
  ui/string.ts    the live waveform line
  styles/main.css design tokens and layout
  main.ts         application wiring
```

Design: Instrument Serif for the script, Geist for interface text, one accent colour, light and dark themes that follow the system, and reduced-motion support. The logo is a plucked string: a V with the pluck point marked.

## First-run download and requirements

| Path | Model download | When |
| --- | --- | --- |
| WebGPU | about 300 MB (fp32) | Chrome, Edge, recent Safari with WebGPU |
| WebAssembly | about 90 MB (8-bit) | Everything else with WebAssembly support |

The download happens once and is cached by the browser. The interface shows progress. If WebGPU fails to start, VolTune retries automatically on WebAssembly.

## Limitations

- English voices only (US and UK). Other Kokoro languages need extra phonemizer support that is not included here.
- No voice cloning, and no control over emotion beyond what punctuation and voice choice give you.
- Generation speed depends on the device. WebAssembly on a phone can be slower than real time for long text; playback pauses and resumes as sentences arrive.
- The first run needs a network connection to download the model.
- `npm audit` reports advisories on `sharp`, a dependency of `@huggingface/transformers` used only for image processing in Node. It is not part of the browser bundle.

## Licence

MIT for this project. Kokoro-82M is Apache 2.0; see its model card for credits.
