import os
"""Train one VolTune voice's delivery: python train.py <voice>"""
from common import WORK, PHON, VOLTUNE
import json, sys, time, math, random, torch, numpy as np
from fit import *

NAME = sys.argv[1]
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 150
takes = json.load(open(os.path.join(WORK, 'takes.json')))

def take_stats(t):
    """Pitch statistics of a take from its saved features (80 frames/s): voiced fraction, median F0 (Hz),
    interquartile range (semitones) and the share of voiced frame-to-frame jumps over 3 semitones."""
    f0, per, _ = feats(t['file'])
    a, b = int(t['words'][0]['ws'] * 80), int(t['words'][-1]['we'] * 80) + 1
    f, v = f0[a:b], per[a:b] > 0.5
    if not v.any(): return {'vf': 0.0, 'med': 0.0, 'iqr': 0.0, 'wild': 1.0}
    st = 12 * np.log2(f[v] / 55.0)
    jumps = np.abs(np.diff(st)) > 3 if len(st) > 1 else np.zeros(1, bool)
    q1, q3 = np.percentile(st, [25, 75])
    return {'vf': float(v.mean()), 'med': float(np.median(f[v])), 'iqr': float(q3 - q1), 'wild': float(jumps.mean())}

# takes.py / align.py do not measure pitch; fill the statistics in from features.py's output
for _t in takes:
    if _t.get('aligned') and 'vf' not in _t: _t.update(take_stats(_t))

def clean(t, maxmed=None, minscore=0.6):
    if not t.get('aligned') or t.get('ascore', 0) < minscore: return False
    if t.get('wild', 0) > 0.2 or t.get('vf', 0) < 0.2: return False
    if maxmed and t.get('med', 0) > maxmed: return False
    return True

MALE = ['hm_omega', 'hm_psi', 'am_fenrir', 'am_onyx', 'am_michael', 'am_echo', 'am_eric', 'am_liam', 'am_adam', 'am_puck', 'bm_fable', 'bm_george', 'bm_lewis', 'bm_daniel', 'em_alex', 'im_nicola', 'pm_alex', 'zm_yunjian', 'zm_yunxi', 'jm_kumo']
FEMALE = ['hf_alpha', 'hf_beta', 'af_heart', 'af_nicole', 'af_bella', 'af_kore', 'af_aoede', 'af_sarah', 'af_sky', 'af_river', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'if_sara', 'ef_dora', 'pf_dora', 'jf_alpha', 'zf_xiaoxiao']

# WORK/train.json: {voice: {"sources": [source labels] or "category": name, "pool": "male"|"female"|"child",
#   "level_hz": target pitch (optional, e.g. a female voice learned from male takes), "max_hz": drop takes above,
#   "min_score": alignment score floor, "prior": voice to start from, "lam": prior strength}}
_cfg = json.load(open(os.path.join(WORK, 'train.json')))[NAME]
_pool = {'male': MALE, 'female': FEMALE, 'child': FEMALE + ['am_puck', 'hm_psi']}[_cfg.get('pool', 'male')]
def _sel(t):
    ok = t['src'] in _cfg['sources'] if 'sources' in _cfg else t['cat'] == _cfg['category']
    return ok and clean(t, _cfg.get('max_hz'), _cfg.get('min_score', 0.6))
CFG = dict(sel=_sel, cands=_pool, **({'level': 12 * math.log2(_cfg['level_hz'] / 100)} if 'level_hz' in _cfg else {}),
           **({'prior': _cfg['prior']} if 'prior' in _cfg else {}), **({'lam': _cfg['lam']} if 'lam' in _cfg else {}))

sel = [t for t in takes if CFG['sel'](t)]
tr = [Take(t) for t in sel if not is_val(t)] or [Take(t) for t in sel]
va = [Take(t) for t in sel if is_val(t)]
print(f'{NAME}: {len(tr)} train / {len(va)} val takes, {sum(t.real.sum().item() for t in tr) * FR:.0f}s train audio', flush=True)
LEVEL = CFG.get('level')
mu, Cinv = prosody_prior()

def evaluate(style_for, group):
    with torch.no_grad():
        acc = {}
        for tk in group:
            for k, v in losses(tk, style_for(tk), LEVEL).items(): acc[k] = acc.get(k, 0) + float(v) / len(group)
        acc['total'] = sum(W[k] * acc[k] for k in W)
        return acc

# 1. Rank stock prosodies on this delivery.
cands = CFG['cands']
scores = {}
for c in cands:
    scores[c] = evaluate(lambda tk, c=c: voice(c)[tk.row, 128:][None], tr)['total']
ranked = sorted(cands, key=scores.get)
print('stock ranking:', ', '.join(f'{c} {scores[c]:.2f}' for c in ranked[:6]), flush=True)
top = ranked[:4]

# 2. Learn mix weights over the top 4 and an offset.
logits = torch.tensor([2.0, 1.0, 0.5, 0.0], requires_grad=True)
center = torch.zeros(128)
if CFG.get('prior'):
    prev = json.load(open(f'{WORK}/fit_{CFG["prior"]}.json'))
    center = torch.tensor(prev['delta'])
    # Start from the prior voice's prosody so the few takes only nudge it.
    top = [m[0] for m in prev['mix']] + [c for c in top if c not in [m[0] for m in prev['mix']]]
    top = top[:4]
    w0 = [m[1] for m in prev['mix']] + [0.01] * (4 - len(prev['mix']))
    logits = torch.log(torch.tensor(w0[:4])).clone().requires_grad_(True)
delta = center.clone().requires_grad_(True)
lam = CFG.get('lam', 0.3)
tables = torch.stack([voice(c)[:, 128:] for c in top])          # 4 × 510 × 128

def style(tk, w=None, d=None):
    w = torch.softmax(logits, 0) if w is None else w
    d = delta if d is None else d
    return ((w[:, None] * tables[:, tk.row]).sum(0) + d)[None]

def reg(d):
    x = d - center
    return (x @ Cinv @ x) / 128

def run(params, steps, lr, fixed_w=None):
    opt = torch.optim.Adam(params, lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    rng = random.Random(0)
    for step in range(steps):
        batch = rng.sample(tr, min(8, len(tr)))
        opt.zero_grad()
        L = sum(total(losses(tk, style(tk, fixed_w), LEVEL)) for tk in batch) / len(batch) + lam * reg(delta)
        L.backward()
        opt.step(); sched.step()
        if step % 25 == 0 or step == steps - 1:
            print(f'  step {step:3d} loss {L.item():.3f} reg {reg(delta).item():.2f} w {[round(x, 2) for x in torch.softmax(logits, 0).tolist()]}', flush=True)

t0 = time.time()
run([logits, delta], STEPS, 0.03)
# 3. Freeze the mix exactly as VolTune will store it (3 decimals, tiny weights dropped), refit the offset.
w = torch.softmax(logits, 0).detach()
mix = [(c, round(float(x), 3)) for c, x in zip(top, w) if x >= 0.05]
s = sum(x for _, x in mix); mix = [(c, round(x / s, 3)) for c, x in mix]
wf = torch.tensor([dict(mix).get(c, 0.0) for c in top])
run([delta], max(40, STEPS // 3), 0.01, fixed_w=wf)
print(f'trained in {time.time() - t0:.0f}s', flush=True)

base = lambda tk: voice(ranked[0])[tk.row, 128:][None]
fitted = lambda tk: style(tk, wf).detach()
report = {'voice': NAME, 'mix': mix, 'delta': delta.detach().tolist(), 'level': LEVEL,
          'train': {'stock_best': evaluate(base, tr), 'fitted': evaluate(fitted, tr)},
          'val': {'stock_best': evaluate(base, va), 'fitted': evaluate(fitted, va)} if va else None,
          'best_stock': ranked[0], 'ranking': ranked[:8]}
json.dump(report, open(f'{WORK}/fit_{NAME}.json', 'w'), indent=1)
for part in ('train', 'val'):
    if report[part]:
        b, f = report[part]['stock_best'], report[part]['fitted']
        print(f'{part:5s} ' + '  '.join(f'{k} {b[k]:.3f}→{f[k]:.3f}' for k in ('total', 'dur', 'f0', 'lvl', 'sd', 'N')))
print('mix', mix)
