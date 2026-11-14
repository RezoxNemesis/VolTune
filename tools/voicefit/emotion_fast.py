import os
from common import WORK, kokoro_files
"""Fast emotion solve: batched finite-difference Jacobian of the predictor w.r.t. the 128 delivery numbers,
regularised least squares per emotion, then chord steps checked against the real model."""
import json, sys, math, os, torch
from fit import model, prosody_prior
from render import phonemes
from emotion import EMO, LINES, PUNCT, DB, voice_styles

torch.set_num_threads(2)
EPS = 0.05

class Item:
    @torch.no_grad()
    def __init__(self, ids, s_tab):
        m = model(); P = m.predictor
        x = torch.LongTensor([[0, *ids, 0]]); L = x.shape[1]; self.L = L
        self.mask = torch.zeros(1, L, dtype=torch.bool)
        self.s = s_tab[min(L - 2, 509)][None]
        self.punct = torch.tensor([0, *[1 if i in PUNCT else 0 for i in ids], 0], dtype=torch.bool)
        self.d_en = m.bert_encoder(m.bert(x, attention_mask=(~self.mask).int())).transpose(-1, -2)
        d = P.text_encoder(self.d_en, self.s, torch.LongTensor([L]), self.mask); h, _ = P.lstm(d)
        d0 = torch.sigmoid(P.duration_proj(h)).sum(-1)[0]
        frames = torch.round(d0).clamp(min=1).long()
        idx = torch.repeat_interleave(torch.arange(L), frames)
        self.aln = torch.zeros(L, len(idx)); self.aln[idx, torch.arange(len(idx))] = 1
        self.y0 = self.outputs(self.s)
        self.v = self.y0['hz'][0] > 50
        self.st0 = self.y0['st'][0]; self.mu = self.st0[self.v].mean()
        Y = self.outputs(self.s + EPS * torch.eye(128))
        self.J = {k: (Y[k] - self.y0[k]) / EPS for k in ('ld', 'st', 'N')}   # [128, n]

    @torch.no_grad()
    def outputs(self, S):
        P = model().predictor; B = S.shape[0]
        d = P.text_encoder(self.d_en.expand(B, -1, -1).contiguous(), S, torch.LongTensor([self.L] * B), self.mask.expand(B, -1).contiguous())
        h, _ = P.lstm(d)
        dur = torch.sigmoid(P.duration_proj(h)).sum(-1)
        F0, N = P.F0Ntrain(d.transpose(-1, -2) @ self.aln[None], S)
        return {'ld': torch.log(dur.clamp(min=0.3)), 'st': 12 * torch.log2(F0.clamp(min=1) / 100), 'N': N, 'hz': F0}

    def target(self, e):
        ld = torch.where(self.punct, torch.tensor(math.log(e['pause'])), torch.tensor(-math.log(e['rate']))).float()
        return {'ld': ld, 'st': e['st'] + (e['rng'] - 1) * (self.st0 - self.mu), 'N': torch.full((self.y0['N'].shape[1],), e['en'] * DB)}

    def weights(self):
        return {'ld': torch.full((self.L,), 4.0 / self.L), 'st': self.v.float() * (0.15 * 0.5 / max(1, int(self.v.sum()))),
                'N': torch.full((self.y0['N'].shape[1],), 0.5 / self.y0['N'].shape[1])}

def solve(items, e, Cinv, lam=0.05, resid=None):
    H = lam / 128 * Cinv.clone(); g = torch.zeros(128)
    for i, it in enumerate(items):
        t, w = it.target(e), it.weights()
        for k in ('ld', 'st', 'N'):
            J = it.J[k]; r = t[k] - (resid[i][k] if resid else 0)
            H += (J * w[k][None]) @ J.T / len(items)
            g += (J * w[k][None]) @ r / len(items)
    return torch.linalg.solve(H, g)

def change(it, delta):
    y = it.outputs(it.s + delta[None])
    return {k: (y[k] - it.y0[k])[0] for k in ('ld', 'st', 'N')}

def loss(items, e, delta):
    tot = [0.0, 0.0, 0.0]
    for it in items:
        c, t = change(it, delta), it.target(e)
        tot[0] += float(((c['ld'] - t['ld']) ** 2).mean())
        tot[1] += float(torch.nn.functional.huber_loss(c['st'][it.v], t['st'][it.v], delta=3.0))
        tot[2] += float(((c['N'] - t['N']) ** 2).mean())
    return [x / len(items) for x in tot]

def report(items, delta):
    cs = [change(it, delta) for it in items]
    st = sum(float(c['st'][it.v].mean()) for it, c in zip(items, cs)) / len(items)
    rng = sum(float((it.st0[it.v] + c['st'][it.v]).std() / it.st0[it.v].std()) for it, c in zip(items, cs)) / len(items)
    tempo = sum(float(torch.exp(-c['ld'][~it.punct]).mean()) for it, c in zip(items, cs)) / len(items)
    pz = sum(float(torch.exp(c['ld'][it.punct]).mean()) for it, c in zip(items, cs)) / len(items)
    en = sum(float(c['N'].mean()) for c in cs) / len(cs) / DB
    return st, rng, tempo, pz, en

if __name__ == '__main__':
    names = sys.argv[1:] or list(EMO)
    styles = voice_styles(); ids = phonemes(LINES); _, Cinv = prosody_prior()
    items = [Item(i, tab) for tab in styles.values() for i in ids]
    print(f'measured {len(items)} items', flush=True)
    path = os.path.join(WORK, 'emotions.json')
    out = json.load(open(path)) if os.path.exists(path) else {}
    for name in names:
        e = EMO[name]
        delta = solve(items, e, Cinv)
        for _ in range(2):
            res = []
            for it in items:
                c = change(it, delta)
                res.append({k: c[k] - delta @ it.J[k] for k in c})
            delta = solve(items, e, Cinv, resid=res)
        L0, L1 = loss(items[::3], e, torch.zeros(128)), loss(items[::3], e, delta)
        st, rng, tempo, pz, en = report(items, delta)
        print(f"{name:9s} dur {L0[0]:.3f}→{L1[0]:.3f} f0 {L0[1]:.2f}→{L1[1]:.2f} N {L0[2]:.3f}→{L1[2]:.3f} | pitch {st:+.1f}/{e['st']:+.1f}st range x{rng:.2f}/{e['rng']} tempo x{tempo:.2f}/{e['rate']} pauses x{pz:.2f}/{e['pause']} effort {en:+.1f}/{e['en']:+.0f}dB reg {float(delta @ Cinv @ delta / 128):.2f}", flush=True)
        out[name + ('' if len(sys.argv) < 2 or '--save' in sys.argv else '_fast')] = {'delta': [round(float(x), 5) for x in delta], 'target': e}
        json.dump(out, open(path, 'w'), indent=1)
