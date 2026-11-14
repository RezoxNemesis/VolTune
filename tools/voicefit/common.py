"""Paths and the Kokoro model for the voicefit tools.

VOICEFIT_WORK (default ./work) holds samples, features, takes and results. The VolTune checkout is found from this
file's location. Kokoro's model code is loaded from the installed `kokoro` package without running its __init__
(which would pull in the English G2P stack the fitting does not need).
"""
import importlib.util, os, sys, types
from huggingface_hub import hf_hub_download

WORK = os.path.abspath(os.environ.get('VOICEFIT_WORK', 'work'))
VOLTUNE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PHON = os.path.join(VOLTUNE, 'server', 'dist', 'phon.mjs')
os.makedirs(WORK, exist_ok=True)

def kokoro_files():
    cfg = hf_hub_download('hexgrad/Kokoro-82M', 'config.json')
    pth = hf_hub_download('hexgrad/Kokoro-82M', 'kokoro-v1_0.pth')
    return cfg, pth

def voice_file(name):
    return hf_hub_download('hexgrad/Kokoro-82M', f'voices/{name}.pt')

def load_kmodel():
    spec = importlib.util.find_spec('kokoro')
    if spec is None: sys.exit('pip install --no-deps kokoro (see README)')
    pkg = types.ModuleType('kok'); pkg.__path__ = [os.path.dirname(spec.origin)]; sys.modules['kok'] = pkg
    from kok.model import KModel
    cfg, pth = kokoro_files()
    return KModel(config=cfg, model=pth)
