# VolTune

Natural text to speech and multi-voice dialogue that runs entirely in the browser. Nothing is uploaded, there is no server to operate, and no API key to manage.

VolTune uses the open [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) voice model (Apache 2.0) through ONNX Runtime Web. It runs on WebGPU when available and falls back to WebAssembly.

## What it does

- **Speak**: paste text, pick a voice, set the pace, listen. Playback starts as soon as the first sentence is ready.
- **Dialogue**: write a script as `Name: line`, `[Name] line` or screenplay style. Each speaker gets their own voice, and the script can act:
  - moods on a label or inline — `Maya (whispering): Come here.`, `[Jon, angry] Stop!`, `(very excited)` — change pace, pitch, loudness and breathiness;
  - sounds such as `(laughs)`, `(sighs)`, `(gasps)` are performed in the character's voice;
  - `[pause 2s]`, `(beat)` and `---` scene breaks control timing; `#` lines are comments;
  - `@Maya = Teen girl` or `@Ghost = af_sky*0.6+am_onyx*0.4, pitch -2` picks voices inside the script.
  The **Script tips** link in the Dialogue tab lists everything.
- **Learned voices** (Hindi and Hinglish): Shayar, Kahani, Noor, Josh, Chhotu, Gudiya, Dev, Papa, Sur and Sargam. Their delivery — rhythm, pauses, pitch movement, effort — was learned from real narrators (see below), and they work everywhere a stock voice does: menus, blends, scripts (`@Papa = hm_papa`), voice codes.
- **Acted emotions**: happy, excited, sad, crying, angry, scared, loving, surprised, serious, tired and pleading are performed by the model itself, for every voice — `Papa (rote hue): …`, `[Beti, pyaar se] …`, `(very angry)`.
- **Hinglish**: Hindi typed in Latin letters ("Papa, aap rona mat") is read as Hindi, English words stay English.
- **Voice Lab** (**Voices** button): blend two voices, shift pitch and pace, preview, save. Ten character presets (Teen boy, Teen girl, Child, Hero, Villain, Elder, Grandma, narrators…) are built in. Every voice can be copied as a `VT1.…` code and imported elsewhere.
- **Claude connector**: the Cloudflare Worker gives Claude a private connector to design voices and share scripts that open ready to play on your site (see below). [`server/`](server/README.md) renders the same voices to WAV files on Node.
- **Read-along**: the sentence being spoken is lit; click any sentence to jump to it.
- **Save audio**: export the whole piece as a 24 kHz mono WAV.

### Learned voices and acted emotions

A Kokoro voice is a table of style vectors: the first half of each sets the timbre, the second half drives the prosody predictor (how long each sound lasts, the pitch curve, the energy curve). The learned voices keep a blended stock timbre and replace the delivery: recordings of narrators were separated from their music, transcribed, force-aligned word by word, and their real word timings were forced into Kokoro so its predicted pitch and energy could be fitted frame by frame to the performance (128 numbers per voice, under a prior built from all 54 stock voices). On lines held out of the fit, the learned deliveries follow real pitch movement and energy more closely than the best stock voice. Each voice also carries the phrasing measured in its recordings — the poetry narrators (Shayar, Dev) pause about 0.8 s at every comma and line break, the explainer (Josh) barely pauses at all.

Emotions are learned directions in the same delivery half, shared by every voice, fitted to the acoustic profile of acted emotions (pitch level and range, tempo, pause length, vocal effort) relative to each voice's own neutral reading. Because the model performs them, a sad or excited line keeps natural timing and formants instead of being pitch-shifted afterwards. Nothing is uploaded and no new model is downloaded: learned voices and moods are built on the device from the stock tables.

[`tools/voicefit`](tools/voicefit/README.md) has the whole pipeline, including singing (Kokoro's decoder driven by a melody pitch curve and note lengths).

### Studio voices: natural acting (PC)

The studio engine makes every English and Hindi VolTune voice sound like a person acting the line rather than a model reading it: natural rhythm, breaths, pauses and much better Hindi pronunciation. It runs [Chatterbox Multilingual](https://huggingface.co/onnx-community/chatterbox-multilingual-ONNX) (Resemble AI, MIT licence) through ONNX Runtime. VolTune still decides who is speaking: for each voice and mood it renders a short reference line with Kokoro (`src/engine/studio_refs.ts`), and Chatterbox takes the timbre and the acting from that clip. No real person's voice is involved.

- CLI: `voltune render scene.txt -o scene.wav --studio` (or `VOLTUNE_ENGINE=studio`); connector: `engine: "studio"` on `perform_script` and `speak`. VideoStudio 2 desktop uses it for every line once it is installed (`voice.studio {install:true}`).
- First use downloads about 1.5 GB (pinned revision) and makes a small speaker file per voice and mood (`~/.voltune/studio/speakers`). It needs a PC: about 2 GB of memory, and a few seconds per line on 8 cores.
- Moods set how strongly a line is acted (exaggeration) and its pace (guidance); plain directions such as `is dialogue ko emotional hoke bolna hai "…"` work here too.
- Chatterbox's own alignment checks are kept (`src/engine/studio.ts`): attention from three of its heads follows the text, so a line stops when its words are done and babble after them is cut. The heads' projections are exposed by a small edit to the language-model graph made on first use.
- Phones and the website keep the standard engine.

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
| `npm test` | Unit tests (text, dialogue, delivery, voices, audio) |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Website and Claude connector (Cloudflare)

One Cloudflare Worker serves the VolTune website and a private connector for Claude, set up like Reuz: no secrets to copy by hand.

1. In Cloudflare: **Workers & Pages → Create → Import a repository → `RezoxNemesis/VolTune`**. Keep the defaults (deploy command `npx wrangler deploy`). Cloudflare builds the site and deploys it on every push to `main`. Your site is `https://voltune.<your-subdomain>.workers.dev`.
2. Open **`https://voltune.<your-subdomain>.workers.dev/setup`** once. It shows your private connector URL, only on that first visit, so copy it.
3. In Claude: **Settings → Connectors → Add custom connector**, name it VolTune and paste the URL.

Then Claude can, from any chat:

| Tool | What it does |
| --- | --- |
| `script_help` | The script syntax. |
| `list_voices` | Stock voices, character presets and the voices saved on your site. |
| `create_voice` / `import_voice` / `delete_voice` / `get_voice_code` | Design and manage voices. Voices Claude creates appear in the website's voice menus automatically. |
| `check_script` | Shows how a script will be performed: speakers, voices, per-line delivery, length, warnings. |
| `share_script` | Saves a script and returns a link that opens it on your site, ready to play and download. |
| `list_scripts` | Scripts shared so far. |
| `get_scene` / `get_voices_bundle` | A script with its exact voice recipes, for rendering audio files for animation (see below). |

Speech is generated in the visitor's browser, as before; the Worker only stores voices and scripts (in a Durable Object). To replace the connector URL later, open `/setup/reset?token=<current token>`.

Local check: `npm run worker:dev`, then open http://localhost:8787/setup.

The site is static apart from `/setup`, `/mcp/*` and `/api/*`, so `dist/` can also be published on any static host (without the connector). `public/_headers` sets the Content-Security-Policy and cross-origin isolation headers; the ONNX Runtime WebAssembly is served from `/ort/`, and the only outside request is the one-time model download from `huggingface.co`.

### Voices in animations

`server/` renders the website's voices to files and checks them without anyone listening:

```bash
node server/dist/cli.js scene bundle.json -o out/   # bundle from get_scene, or a plain script file
```

writes `scene.wav`, a WAV per line, `scene.json` (who speaks when, voice codes), `lipsync.json` (mouth openness and shape M/A/E/O per video frame, per character), `spectrogram.png` and `report.md`. The report measures every line — pitch, pace, loudness, brightness, breathiness, clipping — transcribes it with Whisper to catch unclear words, and checks delivery marks (a whisper must be quieter, a shout louder, "slowly" slower). `avcheck video.mp4 --scene out/` then confirms the finished video's audio is not offset or drifting and that the drawn mouths follow the speech. See [`server/README.md`](server/README.md).

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
- **Hindi and Indian English.** Four Hindi voices (Alpha, Beta, Omega, Psi) and two Indian character presets (Indian woman, Indian man). Devanagari text is converted to speech sounds by a built-in rule-based converter (anusvara as a homorganic nasal, schwa deletion, nasalised long vowels such as हूँ, conjuncts, Hindi number words, danda sentence breaks) because the bundled phonemizer only knows English. An Indian voice keeps its own timbre for English lines too, which are spoken with Indian English pronunciation (dental th, tapped r, pure vowels for ei and ou, syllable-timed rhythm). A Devanagari line switches to a Hindi voice automatically. Kokoro rates its Hindi voices below its best English ones, so expect good but not flawless Hindi.
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

- English (US, UK, Indian) and Hindi/Hinglish only. Other Kokoro languages need extra phonemizer support that is not included here.
- The studio engine is for PCs (≈1.5 GB download, ≈2 GB memory) and is slower than the standard one; very short exclamations are its weakest lines.
- No voice cloning: learned voices take a delivery from recordings but their timbre is a blend of Kokoro's own voices.
- Kokoro's pitch breaks above about 360 Hz, so very high or shouted lines and soprano singing are out of reach.
- Generation speed depends on the device. WebAssembly on a phone can be slower than real time for long text; playback pauses and resumes as sentences arrive.
- The first run needs a network connection to download the model.
- `npm audit` reports advisories on `sharp`, a dependency of `@huggingface/transformers` used only for image processing in Node. It is not part of the browser bundle.

## Licence

MIT for this project. Kokoro-82M is Apache 2.0; see its model card for credits.
