"""Fit the delivery (prosody half of Kokoro's style vector) to real performances.

For every take the real word timings are teacher-forced into Kokoro's alignment, so the predicted
pitch and energy can be compared frame by frame with the recording, and the predicted word
durations with the real ones. Only 128 numbers per voice are learned; the model is frozen.
"""
import json, math, sys, hashlib, numpy as np, torch
from common import WORK, PHON, VOLTUNE, load_kmodel, voice_file, kokoro_files

torch.set_num_threads(2)
torch.manual_seed(0)
FR = 0.025          # one duration unit = 600 samples at 24 kHz
F0R = FR / 2        # predictor F0/N rate

_model = None
def model():
    global _model
    if _model is None:
        _model = load_kmodel().eval()
        for p in _model.parameters(): p.requires_grad_(False)
    return _model

VOICES = {}
def voice(name):
    if name not in VOICES: VOICES[name] = torch.load(voice_file(name))[:, 0, :].float()
    return VOICES[name]

ALL = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis', 'ef_dora', 'em_alex', 'em_santa', 'ff_siwis', 'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi', 'if_sara', 'im_nicola', 'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo', 'pf_dora', 'pm_alex', 'pm_santa', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang']

def prosody_prior():
    """Mean and inverse covariance of the prosody half across every stock voice (keeps fits plausible)."""
    P = torch.stack([voice(v)[:, 128:].mean(0) for v in ALL])
    mu = P.mean(0)
    C = torch.cov(P.T) + 1e-3 * torch.eye(128)
    return mu, torch.linalg.inv(C)

FEATS = {}
def feats(name):
    if name not in FEATS:
        z = np.load(f'{WORK}/{name}.feat.npz')
        FEATS[name] = (z['f0'], z['per'], z['N'])
    return FEATS[name]

class Take:
    """One phrase: tokens, which word each token belongs to, real word spans, real F0/N."""
    def __init__(self, t):
        self.t = t
        ids, widx = [0], [-1]
        W = t['words']
        for i, w in enumerate(W):
            ids += w['ids']; widx += [i] * len(w['ids'])
            if i < len(W) - 1: ids.append(16); widx.append(i)
        ids.append(0); widx.append(-1)
        self.ids = torch.LongTensor([ids]); self.widx = torch.LongTensor(widx)
        self.n_words = len(W)
        spans = [W[i + 1]['s'] - W[i]['s'] for i in range(len(W) - 1)] + [W[-1]['e'] - W[-1]['s'] + 0.05]
        self.real = torch.tensor([max(1, round(s / FR)) for s in spans], dtype=torch.float32)
        self.wprob = torch.tensor([w['p'] for w in W], dtype=torch.float32)
        m = model()
        L = self.ids.shape[1]
        self.lengths = torch.LongTensor([L])
        self.mask = torch.zeros(1, L, dtype=torch.bool)
        with torch.no_grad():
            bert = m.bert(self.ids, attention_mask=(~self.mask).int())
            self.d_en = m.bert_encoder(bert).transpose(-1, -2)
        self.row = min(max(L - 2, 0), 509)
        # Real features from one pad frame before the first word.
        f0, per, N = feats(t['file'])
        t0 = W[0]['s'] - FR
        k0 = int(round(t0 / F0R))
        total = int(self.real.sum().item()) + 2
        sl = slice(max(0, k0), max(0, k0) + 2 * total)
        def take(a):
            x = np.zeros(2 * total, dtype=np.float32); seg = a[sl]; x[:len(seg)] = seg; return torch.from_numpy(x)
        self.f0, self.per, self.N = take(f0), take(per), take(N)
        self.voiced = (self.per > 0.5) & (self.f0 > 50)
        # speech frames for energy: inside word spans (skip the leading pad frame)
        self.speech = torch.zeros(2 * total, dtype=torch.bool); self.speech[2:2 * total - 2] = True

    def forward(self, s):
        """s: [1,128] prosody style → word durations (frames), teacher-forced F0 and N."""
        m = model(); P = m.predictor
        d = P.text_encoder(self.d_en, s, self.lengths, self.mask)
        x, _ = P.lstm(d)
        dur = torch.sigmoid(P.duration_proj(x)).sum(-1)[0]          # [L]
        keep = self.widx >= 0
        wdur = torch.zeros(self.n_words).index_add(0, self.widx[keep], dur[keep])
        # Teacher-forced alignment: each word's real frames split over its tokens like the model would.
        frames = torch.ones(len(self.widx), dtype=torch.long)       # pads: 1 frame
        dd = dur.detach()
        for i in range(self.n_words):
            J = (self.widx == i).nonzero().squeeze(1)
            share = dd[J] / dd[J].sum() * self.real[i]
            fl = share.floor(); rem = int(self.real[i].item() - fl.sum().item())
            if rem > 0: fl[torch.argsort(share - fl, descending=True)[:rem]] += 1
            frames[J] = fl.long()
        idx = torch.repeat_interleave(torch.arange(len(self.widx)), frames)
        aln = torch.zeros(len(self.widx), len(idx)); aln[idx, torch.arange(len(idx))] = 1
        en = d.transpose(-1, -2) @ aln[None]
        F0, N = P.F0Ntrain(en, s)
        return wdur, F0[0], N[0]

def st(hz): return 12 * torch.log2(hz.clamp(min=1) / 100)

def losses(tk, s, level=None):
    wdur, F0, N = tk.forward(s)
    n = min(len(F0), len(tk.f0))
    F0, N = F0[:n], N[:n]
    w = tk.wprob.clamp(0.3, 1)
    l_dur = (w * (torch.log(wdur.clamp(min=0.5)) - torch.log(tk.real)) ** 2).sum() / w.sum()
    m = tk.voiced[:n] & (F0 > 40)
    if m.sum() > 8:
        ps, rs = st(F0[m]), st(tk.f0[:n][m])
        shape = torch.nn.functional.huber_loss(ps - ps.mean(), rs - rs.mean(), delta=3.0)
        lvl = (ps.mean() - (rs.mean() if level is None else level)) ** 2
        sd = (ps.std() - rs.std()) ** 2
    else:
        shape = lvl = sd = torch.tensor(0.)
    sp = tk.speech[:n]
    pn, rn = N[sp] - N[sp].mean(), tk.N[:n][sp] - tk.N[:n][sp].mean()
    corr = (pn * rn).sum() / (pn.norm() * rn.norm() + 1e-6)
    return {'dur': l_dur, 'f0': shape, 'lvl': lvl, 'sd': sd, 'N': 1 - corr}

W = {'dur': 4.0, 'f0': 0.15, 'lvl': 0.01, 'sd': 0.03, 'N': 0.6}

def total(ls): return sum(W[k] * v for k, v in ls.items())

def is_val(t): return int(hashlib.md5(t['id'].encode()).hexdigest(), 16) % 5 == 0
