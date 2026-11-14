"""Original lullaby preview: sung lyrics (sing.py) over a synthesized piano + pad, with reverb.

python song.py <spec.json> <out.wav> <transpose semitones> [bpm]
"""
import json, sys, math, numpy as np, soundfile as sf, scipy.signal as sg
from sing import sing, hz

SR = 24000
# Original lyrics and melody (A minor lullaby). Each word: notes as (note, beats); '-' is a rest.
VERSE = [
    ('पापा', [('A4', 1), ('C5', 1)]), ('मेरे', [('B4', 1), ('A4', 1)]), ('-', 0.5), ('मत', [('G4', 1)]), ('रोना', [('E4', 1), ('G4', 2)]), ('-', 1),
    ('मैं', [('A4', 1)]), ('हूँ', [('C5', 1)]), ('यहीं', [('D5', 1), ('C5', 1)]), ('-', 0.5), ('तारों', [('E5', 1), ('D5', 1)]), ('में', [('C5', 1), ('B4', 0.5), ('A4', 2.5)]), ('-', 1),
    ('जब', [('A4', 1)]), ('सीटी', [('C5', 1), ('E5', 1)]), ('बजे', [('D5', 1), ('C5', 1)]), ('-', 0.5), ('रेल', [('B4', 1)]), ('की', [('G4', 1)]), ('-', 0.5),
    ('समझो', [('A4', 1), ('B4', 0.5), ('C5', 1.5)]), ('मैं', [('B4', 1)]), ('पास', [('G4', 1), ('E4', 1)]), ('हूँ', [('A4', 4)]),
]
# chords per bar (4 beats), A minor: Am F C G | Am F G Am ...
CHORDS = [('A3', 'C4', 'E4'), ('F3', 'A3', 'C4'), ('C3', 'E3', 'G3'), ('G3', 'B3', 'D4'), ('A3', 'C4', 'E4'), ('F3', 'A3', 'C4'), ('G3', 'B3', 'D4'), ('A3', 'C4', 'E4')]
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def tr(n, k):
    import re
    m = re.match(r'([A-G])(#?)(\d)', n); i = NAMES.index(m[1] + m[2]) + 12 * int(m[3]) + k
    return NAMES[i % 12] + str(i // 12)

def piano(f, dur, vel=0.25):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 400))
    x = sum((0.6 / k ** 1.4) * np.sin(2 * np.pi * f * k * t * (1 + 0.0004 * k * k)) * np.exp(-t * 0.8 * k) for k in range(1, 7))
    return vel * env * x

def pad(f, dur, vel=0.06):
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, t / 0.8) * np.minimum(1, (dur - t) / 0.8)
    x = sum(np.sin(2 * np.pi * f * d * t) for d in (0.997, 1.0, 1.003)) / 3
    return vel * env * sg.lfilter(*sg.butter(2, 1500 / (SR / 2)), x)

def reverb(x, seconds=1.8, mix=0.22, seed=3):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 6.9 / seconds)
    ir = sg.lfilter(*sg.butter(1, 4500 / (SR / 2)), ir); ir[:int(0.02 * SR)] = 0; ir /= np.sqrt((ir ** 2).sum())
    wet = sg.fftconvolve(x, ir)[:len(x)]
    return (1 - mix) * x + mix * wet * 2.5

def main(spec_path, out, k, bpm=72):
    spec = json.load(open(spec_path)) if spec_path.endswith('.json') else json.loads(spec_path)
    k = int(k); bpm = float(bpm)
    mel = [(w, ns if w == '-' else [(tr(n, k), b) for n, b in ns]) for w, ns in VERSE]
    beat = 60 / bpm
    lead = 4 * beat                                   # one bar of intro
    voice, notes, _ = sing(mel, spec, bpm=bpm)
    voice = voice / (np.abs(voice).max() + 1e-6) * 0.6
    total = lead + len(voice) / SR + 3 * beat
    acc = np.zeros(int(total * SR) + SR)
    bars = int(math.ceil(total / (4 * beat)))
    for b in range(bars):
        ch = CHORDS[b % len(CHORDS)]
        t0 = b * 4 * beat
        for i, n in enumerate(ch):                     # broken chord on each beat
            for rep in range(2):
                st = int((t0 + (i + rep * 2) * beat * (4 / 6) + rep * 0.0) * SR)
                s = piano(hz(tr(n, k)), 2.2, 0.16)
                acc[st:st + len(s)] += s[:len(acc) - st]
        s = pad(hz(tr(ch[0], k - 12)), 4 * beat + 0.6)
        st = int(t0 * SR); acc[st:st + len(s)] += s[:len(acc) - st]
    v = np.zeros_like(acc)
    st = int((lead + 0.06) * SR); v[st:st + len(voice)] += voice[:len(v) - st]
    mixd = reverb(v, 1.6, 0.18) + reverb(acc, 2.4, 0.3) * 0.8
    mixd = mixd[: int(total * SR)]
    fade = int(2.0 * SR); mixd[-fade:] *= np.linspace(1, 0, fade)
    mixd = mixd / (np.abs(mixd).max() + 1e-6) * 0.89
    sf.write(out, mixd.astype(np.float32), SR, subtype='PCM_16')
    print(f'{out}: {total:.1f}s')

if __name__ == '__main__':
    main(*sys.argv[1:])
