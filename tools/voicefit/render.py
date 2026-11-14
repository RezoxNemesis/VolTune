import os
"""Render test lines with a voice spec (timbre mix | delivery mix + offset) and measure them."""
import json, subprocess, numpy as np, torch, soundfile as sf
from common import PHON
from fit import model, voice

def mix_table(mix):
    return sum(w * voice(v) for v, w in mix)

def table(spec):
    """spec: {'timbre': [(id,w)], 'delivery': [(id,w)], 'delta': [128] | None} → 510×256."""
    t = mix_table(spec['timbre'])[:, :128]
    p = mix_table(spec['delivery'])[:, 128:]
    if spec.get('delta') is not None: p = p + torch.tensor(spec['delta'])[None]
    return torch.cat([t, p], 1)

def phonemes(lines):
    """VolTune's own phonemes for whole lines (same path as the app)."""
    js = '\n'.join(json.dumps({'id': str(i), 'words': [l]}, ensure_ascii=False) for i, l in enumerate(lines))
    out = subprocess.run(['node', PHON], input=js, capture_output=True, text=True, cwd=os.path.dirname(PHON)).stdout
    return [json.loads(x)['ids'][0] for x in out.strip().split('\n')]

@torch.no_grad()
def synth(ids, tab, speed=1.0):
    m = model()
    row = min(max(len(ids), 0), 509)
    ref = tab[row][None]
    x = torch.LongTensor([[0, *ids, 0]])
    L = x.shape[1]
    mask = torch.zeros(1, L, dtype=torch.bool)
    bert = m.bert(x, attention_mask=(~mask).int())
    d_en = m.bert_encoder(bert).transpose(-1, -2)
    s = ref[:, 128:]
    d = m.predictor.text_encoder(d_en, s, torch.LongTensor([L]), mask)
    h, _ = m.predictor.lstm(d)
    dur = torch.sigmoid(m.predictor.duration_proj(h)).sum(-1) / speed
    pd = torch.round(dur).clamp(min=1).long().squeeze()
    idx = torch.repeat_interleave(torch.arange(L), pd)
    aln = torch.zeros(L, len(idx)); aln[idx, torch.arange(len(idx))] = 1
    en = d.transpose(-1, -2) @ aln[None]
    F0, N = m.predictor.F0Ntrain(en, s)
    t_en = m.text_encoder(x, torch.LongTensor([L]), mask)
    audio = m.decoder(t_en @ aln[None], F0, N, ref[:, :128]).squeeze().numpy()
    return audio, F0[0].numpy()

def trim(a, thr=0.01):
    nz = np.where(np.abs(a) > thr)[0]
    return a[max(0, nz[0] - 600): nz[-1] + 1200] if len(nz) else a

def measure(audio, f0):
    v = f0[f0 > 40]
    st = 12 * np.log2(v / np.median(v)) if len(v) else np.array([0])
    S = np.abs(np.fft.rfft(audio[: len(audio) // 1024 * 1024].reshape(-1, 1024) * np.hanning(1024), axis=1)) ** 2
    fr = np.fft.rfftfreq(1024, 1 / 24000)
    loud = S.sum(1) > np.percentile(S.sum(1), 40)
    cen = float(np.median((S[loud] * fr).sum(1) / S[loud].sum(1)))
    flat = float(np.median(np.exp(np.log(S[loud] + 1e-12).mean(1)) / (S[loud].mean(1) + 1e-12)))
    return {'f0': float(np.median(v)) if len(v) else 0, 'range': float(np.percentile(st, 90) - np.percentile(st, 10)), 'centroid': cen, 'flatness': flat, 'sec': len(audio) / 24000}
