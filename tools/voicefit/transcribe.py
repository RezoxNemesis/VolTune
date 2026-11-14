"""Transcribe separated vocals with Whisper large-v3-turbo; keep word timestamps."""
from common import WORK, PHON, VOLTUNE
import json, sys, glob, os
from faster_whisper import WhisperModel
import soundfile as sf, numpy as np, scipy.signal as sg
def load16(f):
    a, sr = sf.read(f, dtype='float32')
    if a.ndim > 1: a = a.mean(1)
    return sg.resample_poly(a, 16000, sr).astype('float32')
M = 'mobiuslabsgmbh/faster-whisper-large-v3-turbo'
model = WhisperModel(M, device='cpu', compute_type='int8', cpu_threads=2)
out = {}
for f in sorted(glob.glob(os.path.join(WORK, 'sep/htdemucs/*/vocals.wav'))):
    name = f.split('/')[-2]
    segs, info = model.transcribe(load16(f), beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    segs = list(segs)
    lang = info.language
    # Hindi speech → Devanagari text so VolTune's Hindi path can read it
    if lang in ('hi', 'ur'):
        if lang == 'ur':
            segs, info = model.transcribe(load16(f), language='hi', beam_size=5, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
            segs = list(segs)
    out[name] = {'lang': info.language, 'prob': info.language_probability, 'segments': [
        {'start': s.start, 'end': s.end, 'text': s.text.strip(), 'words': [{'w': w.word.strip(), 's': w.start, 'e': w.end, 'p': w.probability} for w in (s.words or [])]}
        for s in segs]}
    print(name, info.language, round(info.language_probability, 2), flush=True)
    for s in segs: print(f'  [{s.start:6.2f}-{s.end:6.2f}] {s.text.strip()}', flush=True)
json.dump(out, open(os.path.join(WORK, 'transcripts.json'), 'w'), ensure_ascii=False, indent=1)
