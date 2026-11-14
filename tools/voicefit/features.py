import os
"""Frame features at Kokoro's F0 rate (80 Hz, hop 300 @ 24 kHz): F0 (CREPE), periodicity, energy N (StyleTTS2 definition)."""
from common import WORK, PHON, VOLTUNE
import glob, numpy as np, torch, torchaudio, torchcrepe, soundfile as sf, scipy.signal as sg
torch.set_num_threads(2)
mel = torchaudio.transforms.MelSpectrogram(sample_rate=24000, n_mels=80, n_fft=2048, win_length=1200, hop_length=300)
for f in sorted(glob.glob(os.path.join(WORK, 'sep/htdemucs/*/vocals.wav'))):
    name = f.split('/')[-2]
    a, sr = sf.read(f, dtype='float32'); a = a.mean(1) if a.ndim > 1 else a
    a24 = sg.resample_poly(a, 24000, sr).astype('float32')
    a16 = sg.resample_poly(a, 16000, sr).astype('float32')
    x = torch.from_numpy(a16)[None]
    f0, per = torchcrepe.predict(x, 16000, hop_length=200, fmin=50, fmax=700, model='full', decoder=torchcrepe.decode.viterbi, return_periodicity=True, batch_size=512, device='cpu')
    per = torchcrepe.filter.median(per, 3)
    f0 = f0[0].numpy(); per = per[0].numpy()
    m = mel(torch.from_numpy(a24)[None])[0]            # 80 × T
    N = torch.log((m + 1e-5).norm(dim=0)).numpy()      # StyleTTS2 log_norm on un-normalised mel
    T = min(len(f0), len(N))
    np.savez(f'{WORK}/{name}.feat.npz', f0=f0[:T], per=per[:T], N=N[:T], audio=a24)
    v = per[:T] > 0.5
    print(name, T, f'voiced {v.mean():.2f}', f'median f0 {np.median(f0[:T][v]):.0f}', flush=True)
