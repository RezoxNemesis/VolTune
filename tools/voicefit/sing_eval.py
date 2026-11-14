import os
from common import WORK, kokoro_files
"""Pick singer timbres: sing the lullaby with each candidate and score tuning, voicing, clarity (HNR) and words."""
import json, re, sys, numpy as np, soundfile as sf, scipy.signal as sg, torch, torchcrepe, parselmouth
from faster_whisper import WhisperModel
from sing import sing
from song import VERSE, tr
torch.set_num_threads(2)
asr = WhisperModel('mobiuslabsgmbh/faster-whisper-large-v3-turbo', device='cpu', compute_type='int8', cpu_threads=2)
LYR = ' '.join(w for w, _ in VERSE if w != '-')
def norm(s): return re.sub(r'[^ऀ-ॿ]', '', s).replace('़', '').replace('ं', 'ँ')
def cer(a, b):
    a, b = norm(a), norm(b); d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        p, d[0] = d[0], i
        for j in range(1, len(b) + 1): p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] != b[j - 1]))
    return d[len(b)] / max(1, len(a))

which = sys.argv[1]
fits = {k: json.load(open(f'{WORK}/fit_{k}.json')) for k in ('kahani', 'noor')}
if which == 'male':
    shift, deliv = -17, fits['kahani']
    cands = [[('hm_omega', .6), ('bm_fable', .4)], [('hm_omega', .5), ('em_alex', .5)], [('hm_psi', .5), ('am_michael', .5)], [('hm_omega', .5), ('am_fenrir', .5)], [('hm_psi', .6), ('am_echo', .4)]]
else:
    shift, deliv = -12, fits['noor']
    cands = [[('hf_beta', .6), ('af_nicole', .4)], [('hf_alpha', .6), ('af_heart', .4)], [('hf_beta', .5), ('af_aoede', .5)], [('hf_alpha', .5), ('bf_isabella', .5)], [('hf_beta', .6), ('af_heart', .4)]]
mel = [(w, ns if w == '-' else [(tr(n, shift), b) for n, b in ns]) for w, ns in VERSE]
rows = []
for c in cands:
    spec = {'timbre': c, 'delivery': deliv['mix'], 'delta': deliv['delta']}
    a, notes, f0 = sing(mel, spec, bpm=72)
    a = a / (np.abs(a).max() + 1e-6) * 0.9
    x = torch.from_numpy(sg.resample_poly(a, 2, 3).astype('float32'))[None]
    p, per = torchcrepe.predict(x, 16000, hop_length=200, fmin=60, fmax=700, model='tiny', return_periodicity=True, device='cpu')
    p, per = p[0].numpy(), per[0].numpy()
    errs, voiced = [], []
    for s, e, h in notes:
        a2, b2 = s + (e - s) // 4, e - (e - s) // 4
        seg = p[a2:b2][per[a2:b2] > 0.4]
        voiced.append(len(seg) > (b2 - a2) / 2)
        if len(seg) > 3: errs.append(abs(1200 * np.log2(np.median(seg) / h)))
    hnr = parselmouth.Sound(a.astype('float64'), 24000).to_harmonicity_cc().values
    hnr = float(np.median(hnr[hnr > 0])) if (hnr > 0).any() else 0
    segs, _ = asr.transcribe(sg.resample_poly(a, 2, 3).astype('float32'), language='hi', beam_size=3, condition_on_previous_text=False)
    heard = ' '.join(s.text for s in segs)
    r = {'timbre': c, 'cents': float(np.median(errs)), 'voiced': float(np.mean(voiced)), 'hnr': hnr, 'cer': cer(LYR, heard), 'heard': heard}
    rows.append(r)
    name = '+'.join(f'{v}*{w}' for v, w in c)
    sf.write(f'{WORK}/singer_{which}_{len(rows)}.wav', a, 24000)
    print(f"{len(rows)} cents {r['cents']:4.1f} voiced {r['voiced']:.2f} hnr {hnr:5.1f}dB cer {r['cer']:.3f}  {name} | {heard[:70]}", flush=True)
json.dump(rows, open(f'{WORK}/singers_{which}.json', 'w'), ensure_ascii=False, indent=1)
