"""Learn one prosody-space direction per emotion, shared by every voice.

Targets are relative to each voice's own neutral performance of the same line (so the voice keeps its
identity): pitch level shift, pitch range scaling, tempo, pause length and vocal effort (Kokoro's energy
track), following the acoustic profiles of acted emotions (e.g. Juslin & Laukka 2003). The model is frozen;
only 128 numbers per emotion are learned, under the stock-voice prior so the result stays a plausible style.
"""
import os
from common import WORK
import json, sys, glob, random, math, torch
from fit import model, voice, prosody_prior, FR
from render import phonemes

torch.set_num_threads(2)
DB = 1 / 4.343   # dB → Kokoro energy units (natural log of the mel power norm)
EMO = {
    #            pitch st  range  tempo  pauses  effort dB
    'happy':     dict(st=+1.8, rng=1.30, rate=1.08, pause=0.90, en=+3.0),
    'excited':   dict(st=+3.0, rng=1.50, rate=1.15, pause=0.80, en=+5.0),
    'sad':       dict(st=-1.6, rng=0.65, rate=0.85, pause=1.30, en=-4.0),
    'crying':    dict(st=+0.8, rng=0.75, rate=0.78, pause=1.45, en=-3.0),
    'angry':     dict(st=+1.6, rng=1.35, rate=1.10, pause=0.85, en=+6.0),
    'scared':    dict(st=+2.6, rng=0.90, rate=1.18, pause=0.90, en=-1.0),
    'loving':    dict(st=-0.6, rng=0.90, rate=0.90, pause=1.15, en=-3.0),
    'surprised': dict(st=+3.0, rng=1.60, rate=1.00, pause=1.00, en=+3.0),
    'serious':   dict(st=-1.0, rng=0.75, rate=0.95, pause=1.10, en=+1.0),
    'tired':     dict(st=-2.0, rng=0.60, rate=0.82, pause=1.35, en=-5.0),
    'pleading':  dict(st=+2.0, rng=1.20, rate=0.90, pause=1.15, en=-1.0),
}
LINES = ['मुझे यकीन नहीं हो रहा, तुम सच में वापस आ गए!', 'ये सब तुम्हारी वजह से हुआ है, समझे?', 'रात बहुत गहरी है, और रास्ता अभी लंबा है।',
         'चलो, आज कुछ नया करते हैं।', 'क्या तुम मेरी बात सुन रहे हो?', 'I never thought I would see you again.', 'Why did you do that?']
PUNCT = {1, 2, 3, 4, 5, 6, 9, 10, 16}   # ; : , . ! ? — … space

def voice_styles():
    out = {}
    for f in sorted(glob.glob(os.path.join(WORK, 'fit_*.json'))):
        j = json.load(open(f))
        if 'mix' not in j: continue
        tab = sum(w * voice(v)[:, 128:] for v, w in j['mix']) + torch.tensor(j['delta'])[None]
        out[j['voice']] = tab
    for v in ('hm_omega', 'hf_alpha', 'af_heart'):
        out[v] = voice(v)[:, 128:]
    return out

class Item:
    def __init__(self, ids, s_tab, e):
        m = model(); P = m.predictor
        self.x = torch.LongTensor([[0, *ids, 0]]); L = self.x.shape[1]
        self.lengths = torch.LongTensor([L]); self.mask = torch.zeros(1, L, dtype=torch.bool)
        self.s = s_tab[min(L - 2, 509)][None]
        self.punct = torch.tensor([0, *[1 if i in PUNCT else 0 for i in ids], 0], dtype=torch.bool)
        with torch.no_grad():
            self.d_en = m.bert_encoder(m.bert(self.x, attention_mask=(~self.mask).int())).transpose(-1, -2)
            d = P.text_encoder(self.d_en, self.s, self.lengths, self.mask)
            h, _ = P.lstm(d)
            d0 = torch.sigmoid(P.duration_proj(h)).sum(-1)[0]
            # target durations: words at the new tempo, pauses (punctuation, spaces) longer or shorter
            tgt = torch.where(self.punct, d0 * e['pause'], d0 / e['rate'])
            self.dt = tgt.clamp(min=0.6)
            frames = torch.round(self.dt).clamp(min=1).long()
            idx = torch.repeat_interleave(torch.arange(L), frames)
            self.aln = torch.zeros(L, len(idx)); self.aln[idx, torch.arange(len(idx))] = 1
            F0, N = P.F0Ntrain(d.transpose(-1, -2) @ self.aln[None], self.s)
            F0, N = F0[0], N[0]
            self.v = F0 > 50
            st = 12 * torch.log2(F0.clamp(min=1) / 100)
            mu = st[self.v].mean()
            self.f0t = mu + e['st'] + e['rng'] * (st - mu)
            self.Nt = N + e['en'] * DB

    def loss(self, delta):
        P = model().predictor
        s = self.s + delta[None]
        d = P.text_encoder(self.d_en, s, self.lengths, self.mask)
        h, _ = P.lstm(d)
        dur = torch.sigmoid(P.duration_proj(h)).sum(-1)[0]
        F0, N = P.F0Ntrain(d.transpose(-1, -2) @ self.aln[None], s)
        F0, N = F0[0], N[0]
        l_dur = ((torch.log(dur.clamp(min=0.3)) - torch.log(self.dt)) ** 2).mean()
        st = 12 * torch.log2(F0.clamp(min=1) / 100)
        l_f0 = torch.nn.functional.huber_loss(st[self.v], self.f0t[self.v], delta=3.0)
        l_N = ((N - self.Nt) ** 2).mean()
        return 4 * l_dur + 0.15 * l_f0 + 0.5 * l_N, (l_dur.item(), l_f0.item(), l_N.item())

if __name__ == '__main__':
    names = sys.argv[1:] or list(EMO)
    styles = voice_styles()
    ids = phonemes(LINES)
    mu, Cinv = prosody_prior()
    out = json.load(open(os.path.join(WORK, 'emotions.json'))) if glob.glob(os.path.join(WORK, 'emotions.json')) else {}
    for name in names:
        e = EMO[name]
        items = [Item(i, tab, e) for tab in styles.values() for i in ids]
        delta = torch.zeros(128, requires_grad=True)
        opt = torch.optim.Adam([delta], lr=0.03)
        rng = random.Random(1)
        for step in range(70):
            batch = rng.sample(items, 6)
            opt.zero_grad()
            parts = [it.loss(delta) for it in batch]
            reg = (delta @ Cinv @ delta) / 128
            L = sum(p[0] for p in parts) / len(parts) + 0.05 * reg
            L.backward(); opt.step()
        check = items[::3]
        with torch.no_grad():
            before = [it.loss(torch.zeros(128))[1] for it in check]
            after = [it.loss(delta)[1] for it in check]
        avg = lambda xs, k: sum(x[k] for x in xs) / len(xs)
        print(f'{name:9s} dur {avg(before,0):.3f}→{avg(after,0):.3f}  f0 {avg(before,1):.2f}→{avg(after,1):.2f}  N {avg(before,2):.3f}→{avg(after,2):.3f}  reg {reg.item():.2f}', flush=True)
        out[name] = {'delta': [round(float(x), 5) for x in delta.detach()], 'target': e}
        json.dump(out, open(os.path.join(WORK, 'emotions.json'), 'w'), indent=1)
