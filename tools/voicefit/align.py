import os
"""Refine every take's word boundaries with MMS CTC forced alignment (20 ms resolution)."""
from common import WORK, PHON, VOLTUNE
import json, re, numpy as np, torch, torchaudio, soundfile as sf, scipy.signal as sg, uroman as ur
torch.set_num_threads(2)
bundle = torchaudio.pipelines.MMS_FA
model = bundle.get_model(with_star=False).eval()
D = bundle.get_dict(star=None)
U = ur.Uroman()
takes = json.load(open(os.path.join(WORK, 'takes.json')))
AUD = {}
def audio(name):
    if name not in AUD:
        a, sr = sf.read(f'{WORK}/sep/htdemucs/{name}/vocals.wav', dtype='float32')
        a = a.mean(1) if a.ndim > 1 else a
        AUD[name] = sg.resample_poly(a, 16000, sr).astype('float32')
    return AUD[name]

def roman(w):
    r = U.romanize_string(w).lower()
    return ''.join(c for c in r if c in D and c != '-')

kept, moved = [], []
for t in takes:
    W = t['words']
    a = audio(t['file'])
    lo = max(0.0, W[0]['s'] - 0.5); hi = min(len(a) / 16000, W[-1]['e'] + 0.5)
    x = torch.from_numpy(a[int(lo * 16000):int(hi * 16000)])[None]
    rom = [roman(w['w']) for w in W]
    if any(not r for r in rom):
        t['aligned'] = False; kept.append(t); continue
    with torch.inference_mode():
        em, _ = model(x)
    em = torch.log_softmax(em, -1)
    tgt = torch.tensor([[D[c] for r in rom for c in r]], dtype=torch.int32)
    try:
        ali, sc = torchaudio.functional.forced_align(em, tgt, blank=0)
    except Exception as e:
        t['aligned'] = False; kept.append(t); continue
    spans = torchaudio.functional.merge_tokens(ali[0], sc[0].exp())
    ratio = x.shape[1] / em.shape[1] / 16000        # seconds per emission frame (~0.02)
    k = 0
    for w, r in zip(W, rom):
        sp = spans[k:k + len(r)]; k += len(r)
        s, e = lo + sp[0].start * ratio, lo + sp[-1].end * ratio
        moved.append(abs(s - w['s']))
        w['ws'], w['we'] = w['s'], w['e']
        w['s'], w['e'] = round(s, 3), round(e, 3)
        w['score'] = float(np.mean([z.score for z in sp]))
    t['aligned'] = True
    t['ascore'] = float(np.mean([w['score'] for w in W]))
    kept.append(t)
json.dump(kept, open(os.path.join(WORK, 'takes.json'), 'w'), ensure_ascii=False, indent=1)
al = [t for t in kept if t.get('aligned')]
print(f'aligned {len(al)}/{len(kept)}; median boundary shift {np.median(moved)*1000:.0f} ms, p90 {np.percentile(moved,90)*1000:.0f} ms')
for t in al[:3]:
    print(t['id'], [(w['w'], round(w['ws'],2), w['s'], round(w['score'],2)) for w in t['words']][:8])
