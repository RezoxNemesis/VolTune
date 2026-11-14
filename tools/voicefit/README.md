# voicefit — learn new VolTune voices from recordings

VolTune's learned voices (`src/engine/learned.ts`) were made with these scripts. They learn **how someone speaks** —
word timing, pauses, pitch movement and vocal effort — from recordings, and give it to a **new voice** built from
Kokoro's own timbres. They do not copy anyone's voice: the timbre half of the style is a blend of stock Kokoro voices,
and only the delivery half (128 numbers) is fitted.

## How it works

Kokoro-82M turns phonemes into speech under a style vector of 256 numbers. The first 128 set the timbre (the decoder);
the last 128 drive the prosody predictor: how long each phoneme lasts, the pitch curve and the energy curve.

1. **Separate** the voice from music: `python -m demucs --two-stems=vocals -n htdemucs -o $VOICEFIT_WORK/sep audio/*.wav`
2. **Transcribe** with word times: `python transcribe.py` (Whisper large-v3-turbo, Hindi as Devanagari).
3. **Features** at Kokoro's pitch rate (80 Hz): `python features.py` (CREPE pitch, periodicity, StyleTTS2 energy).
4. **Takes**: `python takes.py` cuts the ranges listed in `$VOICEFIT_WORK/ranges.json` into phrases and turns each word
   into Kokoro tokens with VolTune's own Hindi/Hinglish converter (`phon.ts`, built to `server/dist/phon.mjs`).
5. **Align**: `python align.py` refines every word boundary with MMS CTC forced alignment (20 ms).
6. **Fit**: `python train.py <voice>` — the real word timings are forced into Kokoro's alignment, so its predicted pitch
   and energy can be compared frame by frame with the recording and its predicted word lengths with the real ones.
   It ranks the stock deliveries, then learns a blend of the best four plus a 128-number offset, under a prior built
   from all 54 stock voices so the result stays a plausible style. A held-out fifth of the takes checks it.
7. **Timbre**: `python eval_timbre.py <voice>` renders new lines over candidate timbre blends and measures Hindi
   intelligibility (Whisper character error), pitch, range, pace and brightness.
8. **Emotions**: `python emotion_fast.py` learns one delivery direction per mood, shared by every voice: relative changes
   to each voice's own neutral reading (pitch level and range, tempo, pause length, effort). One batched pass per line
   measures how all 128 numbers move timing, pitch and energy; each mood is then a regularised least-squares solve,
   checked against the real model (`emotion.py` is the slower gradient version). Models reach ~85–90 % of the pitch and
   effort targets and about half the tempo change, which VolTune tops up with pace (delivery.ts).
9. **Export**: `python export.py $VOICEFIT_WORK/voices.json $VOICEFIT_WORK/emotions.json ../../src/engine/learned_data.ts`

`sing.py` and `song.py` make the voices sing (`sing_eval.py` auditions singer timbres): each syllable's vowel is held for its note, consonants keep short natural
lengths, and the decoder's pitch input follows the melody with glides and delayed vibrato. The decoder follows pitch
faithfully up to about 360 Hz, so melodies sit in chest-voice ranges (`sing` in each learned voice).

## Setup

```bash
python -m venv .venv && . .venv/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install numpy scipy soundfile librosa praat-parselmouth demucs transformers huggingface_hub loguru faster-whisper torchcrepe uroman
pip install --no-deps kokoro          # only the model code is used
(cd ../../server && npm ci && npx esbuild ../tools/voicefit/phon.ts --bundle --platform=node --format=esm --external:phonemizer --outfile=dist/phon.mjs)
export VOICEFIT_WORK=$PWD/work
```

`$VOICEFIT_WORK/train.json` says which sources each voice learns from, e.g.
`{"kahani": {"sources": ["storyteller-1"], "pool": "male", "max_hz": 165}}`; `ranges.json` lists
`[file, start, end, category, source]`. Recordings and transcripts stay in the work folder; nothing from them is
committed except the 128 learned numbers per voice.

Everything runs on a CPU (two cores were enough); a voice fits in a few minutes.
