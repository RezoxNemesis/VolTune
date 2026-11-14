import os
"""Cut the transcribed samples into fitting "takes" (one phrase each, single speaker) per voice category.

A take keeps Whisper's word timings; VolTune's own Hindi converter turns each word into Kokoro tokens,
so the voices are fitted on exactly the phonemes the app will feed the model.
"""
from common import WORK, PHON, VOLTUNE
import json, re, subprocess, sys

T = json.load(open(os.path.join(WORK, 'transcripts.json')))

# Which parts of which recordings to learn from: WORK/ranges.json, a list of
# [file stem, start s, end s, voice name, source label]. Pick single-speaker stretches with no singing.
RANGES = [tuple(r) for r in json.load(open(os.path.join(WORK, 'ranges.json')))]

def words_in(name, a, b):
    out = []
    for s in T[name]['segments']:
        for w in s['words']:
            if w['s'] >= a - 0.05 and w['e'] <= b + 0.05 and w['w'] and 0.04 <= w['e'] - w['s'] <= 1.6 and '\ufffd' not in w['w']:
                out.append(w)
    return out

def split_takes(words, max_len=9.0, min_len=1.2):
    takes, cur = [], []
    for i, w in enumerate(words):
        if cur:
            gap = w['s'] - cur[-1]['e']
            dur = cur[-1]['e'] - cur[0]['s']
            punct = bool(re.search(r'[,.!?।]$', cur[-1]['w']))
            if gap > 0.6 or (dur > 2.5 and (gap > 0.28 or punct)) or dur > max_len:
                takes.append(cur); cur = []
        cur.append(w)
    if cur: takes.append(cur)
    return [t for t in takes if t[-1]['e'] - t[0]['s'] >= min_len and len(t) >= 2]

takes = []
for name, a, b, cat, src in RANGES:
    for k, ws in enumerate(split_takes(words_in(name, a, b))):
        p = sum(w['p'] for w in ws) / len(ws)
        takes.append({'id': f'{src}:{ws[0]["s"]:.2f}', 'file': name, 'cat': cat, 'src': src, 'prob': p,
                      'words': [{'w': w['w'], 's': w['s'], 'e': w['e'], 'p': w['p']} for w in ws]})

# Phonemize every word with VolTune's converter (node helper built from the repo sources).
proc = subprocess.run(['node', PHON], input='\n'.join(json.dumps({'id': t['id'], 'words': [w['w'] for w in t['words']]}, ensure_ascii=False) for t in takes),
                      capture_output=True, text=True, cwd=os.path.dirname(PHON))
if proc.returncode: sys.exit(proc.stderr)
ph = {o['id']: o for o in map(json.loads, proc.stdout.strip().split('\n'))}
for t in takes:
    for w, p, ids in zip(t['words'], ph[t['id']]['phon'], ph[t['id']]['ids']):
        w['ph'], w['ids'] = p, ids
json.dump(takes, open(os.path.join(WORK, 'takes.json'), 'w'), ensure_ascii=False, indent=1)
from collections import Counter
c = Counter(); d = Counter()
for t in takes: c[t['cat']] += 1; d[t['cat']] += t['words'][-1]['e'] - t['words'][0]['s']
for k in c: print(f'{k:10s} {c[k]:3d} takes {d[k]:6.1f} s')
