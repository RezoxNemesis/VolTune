# VolTune renderer (Node)

> The everyday Claude connector is the Cloudflare Worker described in the main README (open `/setup`, paste the URL). This package is for rendering audio **files** outside a browser — for animation timing and lip-sync, or a self-hosted connector that returns WAVs.

The same voices, blends and acted delivery as the VolTune app, running on Node so Claude can use them:

- **Connector (MCP)** — deploy once, add the link in Claude, and Claude can design voices and perform scripts for you, returning WAV links, per-line timings and lip-sync tracks for animation.
- **CLI** — `voltune render script.txt -o scene.wav` for local or scripted rendering.

Voices are portable: every custom voice has a `VT1.…` code. Paste a code from Claude into the app (**Voices → Import**) or from the app into Claude, and it sounds identical in both.

## Deploy the connector

### Hugging Face Space (free CPU)

1. Create a Space → SDK **Docker** → blank.
2. Upload `space/Dockerfile` and `space/README.md` from this folder to the Space root.
3. In the Space settings add a secret **`VOLTUNE_TOKEN`** with a long random value (it works like a password).
4. When the Space is running, your connector URL is `https://<user>-<space>.hf.space/mcp/<VOLTUNE_TOKEN>`.

Free Spaces sleep when idle and forget files on restart: rendered audio links and voices saved on the server are temporary. Voice codes and `@Name = blend` lines in scripts always work.

### Any Docker host (Fly.io, Railway, Render, a VPS)

```bash
docker build -f server/Dockerfile -t voltune-server .      # from the repository root
docker run -d -p 7860:7860 -v voltune:/data -e VOLTUNE_TOKEN=<long-random> voltune-server
```

Serve it over HTTPS. Without `VOLTUNE_TOKEN`, open `/setup` once to see a generated link (shown only once).

### Add it to Claude

Settings → Connectors → **Add custom connector** → paste the URL. Then ask, for example: *"Make a gruff old sailor voice and a cheerful kid voice, and perform this scene."*

## Tools

| Tool | What it does |
| --- | --- |
| `script_help` | The script syntax (speakers, moods, sounds, pauses, `@Name = voice`). |
| `list_voices` | Stock voices, character presets and saved custom voices. |
| `create_voice` | Blend stock voices, shift pitch and pace, save; optional preview. Returns a `VT1` code. |
| `import_voice` / `get_voice_code` / `delete_voice` | Move voices between the app and Claude. |
| `perform_script` | Multi-voice script → WAV URL, per-line start/end times, lip-sync JSON. |
| `speak` | Plain narration in one voice. |

## Environment

| Variable | Default | |
| --- | --- | --- |
| `PORT` | 7860 | |
| `VOLTUNE_TOKEN` | generated | Secret part of the connector URL. |
| `VOLTUNE_DATA` | `~/.voltune` | Voices, renders, generated token. |
| `VOLTUNE_MODEL` | downloaded | Path to `kokoro-v1.0.onnx`. |
| `VOLTUNE_PRECISION` | `fp32` | `int8` downloads a smaller, slightly rougher model. |
| `VOLTUNE_THREADS` | auto | ONNX Runtime threads. |
| `PUBLIC_URL` | from request | Base URL used in audio links. |
| `VOLTUNE_KEEP` | 200 | Renders kept on disk. |

## For animation

```bash
node dist/cli.js scene bundle.json -o out/          # or a script .txt
node dist/cli.js analyze any.wav --timeline out/scene.json -o check/
node dist/cli.js avcheck final.mp4 --scene out/ --mouth drawn-mouths.json
node dist/cli.js pull https://voltune.<you>.workers.dev --script <id> -o bundle.json   # when the network allows
```

| File | Contents |
| --- | --- |
| `scene.wav`, `lines/NN_Speaker.wav` | The scene and each line. |
| `scene.json` | Timeline (speaker, text, delivery, start, end), cast, voice codes. |
| `lipsync.json` | Per character, per video frame: `open` (0–1) and `shapes` (M closed, A open, E wide, O round). |
| `spectrogram.png` | Spectrogram with pitch contour, a coloured lane per speaker, loudness strip. |
| `report.md` / `report.json` | Per line: pitch (median, range), pace (wpm), level, peak, brightness, breathiness, clipping, transcript and word error rate, delivery checks. Per speaker baselines, "voices sound alike" warnings, a 0–100 score. |

`avcheck` extracts the video's soundtrack, cross-correlates it with `scene.wav` to measure offset and drift, compares levels, and — given the per-frame mouth values the animation drew (`{"fps":30,"tracks":{"Name":[…]}}`) — reports correlation, lag in frames and mouths left open during silence.

Transcripts use Whisper tiny.en via `sherpa-onnx-node` (optional dependency); the model (~118 MB) downloads from GitHub on first use, or set `VOLTUNE_ASR_DIR`. Pass `--no-asr` to skip.

## CLI

```bash
cd server && npm ci && npm run build
node dist/cli.js help-script
node dist/cli.js voice-create "Rusty" "am_fenrir*0.7+bm_george*0.3" --pitch -1.5 --speed 0.95
node dist/cli.js render scene.txt -o scene.wav --json scene.json --lipsync 30
```

`--json` writes the timeline (speaker, text, start, end per line) and, with `--lipsync`, mouth-openness per frame for each speaker.
