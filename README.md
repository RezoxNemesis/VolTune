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

## Android app

The `android/` folder is a native Android project (Capacitor 8) that bundles the same web app, so the speech model runs on the phone with no server. App id `com.voltune.app`, Android 7.0 (API 24) and newer.

**Get an APK without installing anything:** push to `main` (or run the *Android* workflow from the Actions tab). The build uploads `voltune-debug-apk` as a workflow artifact. Download it, copy it to the phone and install it (allow installs from your file manager or browser when asked).

**Build locally** (needs JDK 21 and the Android SDK, for example via Android Studio):

```bash
npm install
npm run android:debug     # APK at android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open      # or open the project in Android Studio
```

**Signed release APK:** create a keystore, then add these repository secrets: `ANDROID_KEYSTORE_BASE64` (the keystore, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Pushing a tag such as `v1.0.0` then builds a signed `app-release.apk` and attaches it to a GitHub release. Keep the keystore safe: updates must be signed with the same key.

On Android, **Save audio** opens the share sheet instead of downloading, because WebViews cannot download blob URLs. WebGPU is not generally available in Android WebView, so the app uses the WebAssembly path (about 90 MB model download on first run).

## Long narration, speed and saving

- **Up to 250,000 characters** (several hours) per piece. Finished clips are stored on the device (IndexedDB) rather than in memory, and only the next ~25 seconds are decoded for playback.
- **Resumable.** If the screen locks, the app closes or you press Stop, pressing Speak again with the same text and settings continues where it left off; a finished piece replays instantly.
- **Hindi.** Four Hindi voices (Alpha, Beta, Omega, Psi). Devanagari text is converted to speech sounds by a built-in rule-based converter (schwa deletion, nasalisation, conjuncts, Hindi number words, danda sentence breaks) because the bundled phonemizer only knows English. Mixed Hindi/English lines work; a voice is chosen automatically to match the script. Kokoro rates its Hindi voices below its best English ones, so expect good but not flawless Hindi.
- **Rhythm** (Brisk / Natural / Relaxed) scales the pauses between phrases, with small repeatable variation so long passages do not sound metronomic. Dialogue adds a beat when the speaker changes.
- **Numbers, dates, money, times and acronyms** are spoken as words ("$5.50", "March 5th", "3:30 pm", "NASA").
- **Speed.** The first phrase is kept short so audio starts sooner. The page is cross-origin isolated (COOP/COEP headers in `public/_headers`) so the browser engine can use several threads. The Android app runs the full-precision model in native ONNX Runtime, falling back to the browser engine if that fails.
- **Saving.** On the web, the full WAV is assembled from stored clips and downloaded. In the Android app it is streamed to a temporary file and then the system "Save as" dialog lets you choose the location.

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
android/          Capacitor Android project (generated assets are not committed)
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
