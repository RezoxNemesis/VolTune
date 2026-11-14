import os
from common import WORK, kokoro_files
"""Pick each voice's timbre: render held-out lines with the learned delivery over candidate timbre blends,
transcribe with Whisper (Hindi intelligibility) and measure pitch, range, pace, brightness, breathiness."""
import json, sys, re, numpy as np, soundfile as sf, scipy.signal as sg
from faster_whisper import WhisperModel
from render import *

NAME = sys.argv[1]
LINES = {
    'shayar': ['कुछ लोग ज़िंदगी में ऐसे आते हैं, जो जाते-जाते भी, अपनी आदत छोड़ जाते हैं।',
               'मैंने उसे रोका नहीं, बस देखता रहा... जैसे कोई ख़्वाब, सुबह होते ही टूट जाता है।'],
    'kahani': ['बचपन में माँ कहती थी, कि हर अँधेरी रात के बाद सुबह ज़रूर आती है।',
               'आज समझ आया, वो सिर्फ़ रात की बात नहीं कर रही थी, वो ज़िंदगी की बात कर रही थी।'],
    'josh': ['क्या आपको पता है, ज़्यादातर लोग ये गलती रोज़ करते हैं?',
             'आज मैं आपको तीन ऐसे तरीके बताऊँगा, जो आपका पूरा काम आसान कर देंगे!'],
    'chhotu': ['अरे भैया, तुम रोज़ इतने उदास क्यों रहते हो?',
               'पापा, देखो ना, मैं आपके लिए गुलाब लायी हूँ!'],
    'dev': ['मैं शनि हूँ। कर्म का फल देना ही मेरा धर्म है।',
            'और समय... सबका हिसाब रखता है।'],
}
LINES['noor'] = LINES['kahani']

CANDS = {
    'male_deep': [[('hm_omega', 1)], [('hm_psi', 1)], [('hm_omega', .5), ('am_fenrir', .5)], [('hm_omega', .6), ('bm_fable', .4)], [('hm_psi', .5), ('am_onyx', .5)],
                  [('am_fenrir', .5), ('bm_george', .5)], [('hm_omega', .5), ('em_alex', .5)], [('hm_psi', .6), ('am_michael', .4)], [('bm_fable', .5), ('am_onyx', .5)]],
    'male_bright': [[('hm_psi', 1)], [('hm_omega', 1)], [('hm_psi', .6), ('am_puck', .4)], [('hm_psi', .5), ('am_michael', .5)], [('hm_omega', .5), ('am_eric', .5)],
                    [('hm_psi', .5), ('am_liam', .5)], [('am_michael', .5), ('am_puck', .5)], [('hm_psi', .6), ('am_echo', .4)]],
    'female': [[('hf_alpha', 1)], [('hf_beta', 1)], [('hf_alpha', .5), ('hf_beta', .5)], [('hf_beta', .6), ('af_heart', .4)], [('hf_alpha', .6), ('af_nicole', .4)],
               [('hf_beta', .5), ('bf_isabella', .5)], [('hf_alpha', .5), ('af_kore', .5)], [('hf_beta', .6), ('af_aoede', .4)]],
    'child': [[('hf_beta', .6), ('am_puck', .4)], [('hf_alpha', .5), ('am_puck', .5)], [('hf_beta', .7), ('hm_psi', .3)],
              [('hf_beta', .6), ('af_nicole', .4)], [('hf_alpha', .5), ('af_bella', .5)], [('hf_beta', .5), ('af_bella', .3), ('af_heart', .2)]],
}
POOL = {'shayar': 'male_deep', 'kahani': 'male_deep', 'dev': 'male_deep', 'josh': 'male_bright', 'noor': 'female', 'chhotu': 'child'}[NAME]
fit = json.load(open(f'{WORK}/fit_{NAME}.json'))
delivery = [tuple(x) for x in fit['mix']]

asr = WhisperModel('mobiuslabsgmbh/faster-whisper-large-v3-turbo', device='cpu', compute_type='int8', cpu_threads=2)
def norm(s): return re.sub(r'[^ऀ-ॿ]', '', s).replace('़', '').replace('ं', 'ँ')
def cer(a, b):
    a, b = norm(a), norm(b)
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        p, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] != b[j - 1]))
    return d[len(b)] / max(1, len(a))

ids = phonemes(LINES[NAME])
rows = []
stock = {'male_deep': 'hm_omega', 'male_bright': 'hm_psi', 'female': 'hf_alpha', 'child': 'hf_beta'}[POOL]
specs = [('STOCK ' + stock, {'timbre': [(stock, 1)], 'delivery': [(stock, 1)], 'delta': None})]
specs += [('+'.join(f'{v}*{w}' for v, w in c), {'timbre': c, 'delivery': delivery, 'delta': fit['delta']}) for c in CANDS[POOL]]
for label, spec in specs:
    tab = table(spec)
    ms, errs, audio_all = [], [], []
    for line, i in zip(LINES[NAME], ids):
        a, f0 = synth(i, tab)
        a = trim(a)
        ms.append(measure(a, f0))
        segs, _ = asr.transcribe(sg.resample_poly(a, 2, 3).astype('float32'), language='hi', beam_size=3, condition_on_previous_text=False)
        hyp = ' '.join(s.text for s in segs)
        errs.append(cer(line, hyp))
        audio_all += [a, np.zeros(int(0.5 * 24000), dtype=np.float32)]
    m = {k: float(np.mean([x[k] for x in ms])) for k in ms[0]}
    m['cer'] = float(np.mean(errs)); m['label'] = label; m['spec'] = {k: v for k, v in spec.items() if k != 'delta'}
    rows.append(m)
    sf.write(f'{WORK}/eval_{NAME}_{len(rows):02d}.wav', np.concatenate(audio_all), 24000)
    print(f"{len(rows):2d} cer {m['cer']:.3f} f0 {m['f0']:5.0f} range {m['range']:4.1f}st  sec {m['sec']:4.1f}  bright {m['centroid']:5.0f}  flat {m['flatness']:.3f}  {label}", flush=True)
json.dump(rows, open(f'{WORK}/timbre_{NAME}.json', 'w'), indent=1)
