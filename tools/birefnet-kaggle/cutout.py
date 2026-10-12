# BiRefNet cut-out of Naiwa's laughing frames: writes one soft alpha mask per frame.
import glob, os, subprocess, sys, tarfile, time, zipfile

subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'kornia', 'timm', 'einops'], check=False)

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

SRC = '/tmp/frames'
OUT = '/kaggle/working'
MODELS = {'general': 'ZhengPeng7/BiRefNet', 'matting': 'ZhengPeng7/BiRefNet-matting'}
SIZE = 1024

pngs = sorted(glob.glob('/kaggle/input/**/frame_*.png', recursive=True))
if not pngs:
    tars = glob.glob('/kaggle/input/**/frames.tar', recursive=True)
    print('archives:', tars, flush=True)
    os.makedirs(SRC, exist_ok=True)
    with tarfile.open(tars[0]) as t:
        t.extractall(SRC)
    pngs = sorted(glob.glob(f'{SRC}/frame_*.png'))
print(len(pngs), 'frames', flush=True)
print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '', flush=True)


def load(repo):
    try:
        from transformers import AutoModelForImageSegmentation
        return AutoModelForImageSegmentation.from_pretrained(repo, trust_remote_code=True)
    except Exception as e:
        print('transformers load failed, using GitHub code:', repr(e), flush=True)
        if not os.path.isdir('/tmp/BiRefNet'):
            subprocess.run(['git', 'clone', '--depth', '1', 'https://github.com/ZhengPeng7/BiRefNet', '/tmp/BiRefNet'], check=True)
        sys.path.insert(0, '/tmp/BiRefNet')
        from models.birefnet import BiRefNet
        return BiRefNet.from_pretrained(repo)


torch.set_float32_matmul_precision('high')
dev = 'cuda'
mean = torch.tensor([0.485, 0.456, 0.406], device=dev).view(1, 3, 1, 1).half()
std = torch.tensor([0.229, 0.224, 0.225], device=dev).view(1, 3, 1, 1).half()

for name, repo in MODELS.items():
    try:
        t0 = time.time()
        model = load(repo).to(dev).eval().half()
        print(name, 'loaded in', round(time.time() - t0, 1), 's', flush=True)
        zpath = f'{OUT}/masks_{name}.zip'
        t0 = time.time()
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_STORED) as z:
            for i, p in enumerate(pngs):
                img = Image.open(p).convert('RGB')
                w, h = img.size
                x = torch.from_numpy(np.asarray(img.resize((SIZE, SIZE), Image.BILINEAR)).copy()).to(dev)
                x = (x.permute(2, 0, 1)[None].half() / 255 - mean) / std
                with torch.no_grad():
                    pred = model(x)[-1].sigmoid()
                pred = F.interpolate(pred.float(), size=(h, w), mode='bilinear', align_corners=False)[0, 0]
                m = (pred.clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8)
                tmp = f'/tmp/mask_{i:03d}.png'
                Image.fromarray(m).save(tmp)
                z.write(tmp, f'mask_{i:03d}.png')
                if i % 60 == 0:
                    print(name, i, flush=True)
        print(name, 'done', len(pngs), 'frames in', round(time.time() - t0, 1), 's', flush=True)
        del model
        torch.cuda.empty_cache()
    except Exception as e:
        print('FAILED', name, repr(e), flush=True)
