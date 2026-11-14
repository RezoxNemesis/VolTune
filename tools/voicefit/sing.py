import os
from common import WORK, kokoro_files
"""Sing with Kokoro: lyrics + melody → audio, by forcing note lengths and a melody pitch curve.

Kokoro's decoder is driven by an explicit pitch track (F0) and an alignment of phonemes to frames.
For singing, each syllable's vowel is stretched over its note, consonants keep natural short lengths,
and F0 follows the melody with portamento (glides between notes) and delayed vibrato. Unvoiced
consonants keep the model's own (unvoiced) pitch so s, t, k stay crisp.
"""
import json, math, numpy as np, torch
from fit import model
from render import phonemes, table

FR = 0.025                       # duration unit (s); F0/energy run at twice this rate
VOWELS = set('aeiouəɪʊɛɔʌæɑɐɜɒɚᵻɨAIOWYQ')
MODS = {'ː', '̃', 'ʰ'}
VOCAB = json.load(open(kokoro_files()[0]))['vocab']
SYM = {v: k for k, v in VOCAB.items()}
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

def hz(note):
    """'A4', 'C#5', 'Bb3' → Hz."""
    n, rest = note[0], note[1:]
    acc = 1 if rest.startswith('#') else -1 if rest.startswith('b') else 0
    octv = int(rest.lstrip('#b'))
    midi = 12 * (octv + 1) + NOTE[n] + acc
    return 440.0 * 2 ** ((midi - 69) / 12)

def syllables(ids):
    """Split one word's token ids into syllables: [(onset ids, nucleus ids, coda ids)]."""
    syms = [SYM.get(i, '') for i in ids]
    nuclei = []
    k = 0
    while k < len(syms):
        if syms[k] and syms[k][0] in VOWELS:
            j = k + 1
            while j < len(syms) and (syms[j] in MODS or (syms[j] and syms[j][0] in VOWELS and j == k + 1 and syms[k] in 'aeo' and syms[j] in 'ɪʊ')):
                j += 1
            nuclei.append((k, j)); k = j
        else:
            k += 1
    if not nuclei:
        return [([], ids, [])]
    out, start = [], 0
    for n, (a, b) in enumerate(nuclei):
        nxt = nuclei[n + 1][0] if n + 1 < len(nuclei) else len(ids)
        between = list(range(b, nxt))
        cons = [t for t in between if syms[t] not in ('ˈ', 'ˌ')]
        # one consonant between vowels starts the next syllable; a cluster splits (first one closes this syllable)
        if n + 1 < len(nuclei):
            coda_n = 0 if len(cons) <= 1 else 1
        else:
            coda_n = len(between)
        coda = between[:coda_n] if n + 1 < len(nuclei) else between
        onset = list(range(start, a))
        out.append(([ids[t] for t in onset], [ids[t] for t in range(a, b)], [ids[t] for t in coda]))
        start = b + len(coda)
    return out

def f0_curve(notes, frames2, rng):
    """notes: [(start_frame2, end_frame2, hz)] at 80 Hz → melody F0 with glides and vibrato."""
    f = np.zeros(frames2)
    for k, (a, b, h) in enumerate(notes):
        f[a:b] = h
    # portamento: glide over ~70 ms into each new note
    g = 6
    for k in range(1, len(notes)):
        a = notes[k][0]; h0 = notes[k - 1][2]; h1 = notes[k][2]
        for t in range(max(0, a - g // 2), min(frames2, a + g)):
            x = (t - (a - g // 2)) / (1.5 * g)
            x = 0.5 - 0.5 * math.cos(math.pi * min(1, max(0, x)))
            f[t] = h0 * (h1 / h0) ** x
    # vibrato after 250 ms of a held note, 5.4 Hz, up to ±32 cents; small drift
    for a, b, h in notes:
        for t in range(a, b):
            age = (t - a) * FR / 2
            depth = min(1, max(0, (age - 0.25) / 0.35)) * 32
            cents = depth * math.sin(2 * math.pi * 5.4 * age + rng.uniform(0, 0.2)) + rng.normal(0, 3)
            f[t] *= 2 ** (cents / 1200)
    return f

@torch.no_grad()
def sing(lyrics, spec, bpm=80, seed=0):
    """lyrics: [(devanagari word, [(note, beats), …]), …] or ('-', beats) for a rest. → 24 kHz audio."""
    m = model(); P = m.predictor
    rng = np.random.default_rng(seed)
    words = [w for w, _ in lyrics if w != '-']
    wids = phonemes(words) if words else []
    beat = 60 / bpm
    tokens, frames, notes = [0], [2], []
    t2 = 4      # running time in F0 frames (80 Hz)
    wi = 0
    vowel_frames = []
    for w, ns in lyrics:
        if w == '-':
            f = round(ns * beat / FR)
            tokens.append(16); frames.append(f); t2 += 2 * f
            continue
        sy = syllables(wids[wi]); wi += 1
        # spread notes over syllables: one note each, extra notes become melisma on the last vowel
        groups = [[] for _ in sy]
        for k, n in enumerate(ns):
            groups[min(k, len(sy) - 1)].append(n)
        for k in range(len(sy)):
            if not groups[k]: groups[k] = [groups[k - 1][-1] if k else ns[0]]
        for (on, nu, co), gs in zip(sy, groups):
            total = sum(round(b * beat / FR) for _, b in gs)
            cons = [(i, 2 if SYM.get(i, '') not in ('ˈ', 'ˌ') else 0) for i in on] + [(i, 2 if SYM.get(i, '') not in ('ˈ', 'ˌ') else 0) for i in co]
            cf = sum(c for _, c in cons)
            vf = max(2, total - cf)
            for i, c in [(i, 2 if SYM.get(i, '') not in ('ˈ', 'ˌ') else 0) for i in on]:
                tokens.append(i); frames.append(c); t2 += 2 * c
            # the vowel: first token gets the note length, length/nasal marks 1 frame
            v0 = t2
            for j, i in enumerate(nu):
                f = vf - (len(nu) - 1) if j == 0 else 1
                tokens.append(i); frames.append(f); t2 += 2 * f
            # notes on this vowel
            acc = v0
            share = [round(b * beat / FR) for _, b in gs]
            scale = (t2 - v0) / max(1, 2 * sum(share))
            for (n, b), s in zip(gs, share):
                e = acc + round(2 * s * scale)
                notes.append((acc, e, hz(n))); acc = e
            vowel_frames.append((v0, t2))
            for i in co:
                c = 2 if SYM.get(i, '') not in ('ˈ', 'ˌ') else 0
                tokens.append(i); frames.append(c); t2 += 2 * c
        tokens.append(16); frames.append(1); t2 += 2
    tokens.append(0); frames.append(4)
    tab = table(spec)
    L = len(tokens)
    ref = tab[min(L - 2, 509)][None]
    x = torch.LongTensor([tokens]); mask = torch.zeros(1, L, dtype=torch.bool); lengths = torch.LongTensor([L])
    d_en = m.bert_encoder(m.bert(x, attention_mask=(~mask).int())).transpose(-1, -2)
    s = ref[:, 128:]
    d = P.text_encoder(d_en, s, lengths, mask)
    fr = torch.tensor(frames)
    idx = torch.repeat_interleave(torch.arange(L), fr)
    aln = torch.zeros(L, len(idx)); aln[idx, torch.arange(len(idx))] = 1
    F0, N = P.F0Ntrain(d.transpose(-1, -2) @ aln[None], s)
    F0, N = F0[0].numpy(), N[0].numpy()
    mel = f0_curve(notes, len(F0), rng)
    voiced = F0 > 40
    out = np.where(mel > 0, mel, F0)
    # keep unvoiced consonants unvoiced; inside sung vowels always voiced
    sung = np.zeros(len(F0), bool)
    for a, b in vowel_frames: sung[a:min(b, len(F0))] = True
    out = np.where(sung | voiced, out, 0.0)
    # sustain: hold the vowel's energy instead of letting it decay; gentle swell on long notes
    N2 = N.copy()
    for a, b in vowel_frames:
        b = min(b, len(N2))
        if b - a < 4: continue
        top = np.percentile(N[a:b], 80)
        ln = b - a
        swell = 0.15 * np.sin(np.linspace(0, math.pi, ln))
        N2[a:b] = np.maximum(N[a:b], top - 0.1) + swell
    t_en = m.text_encoder(x, lengths, mask)
    audio = m.decoder(t_en @ aln[None], torch.tensor(out, dtype=torch.float32)[None], torch.tensor(N2, dtype=torch.float32)[None], ref[:, :128]).squeeze().numpy()
    return audio, notes, out
