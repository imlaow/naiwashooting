# Real-ESRGAN 2x of Naiwa's laughing frames (4x model, resized to 2x), then BiRefNet masks.
# Writes, per model: esrgan_<model>_frames.zip, esrgan_<model>_masks.zip and preview_<model>_NNN.png.
import glob, os, subprocess, sys, tarfile, time, urllib.request, zipfile

subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'spandrel', 'kornia', 'timm', 'einops'], check=False)

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from spandrel import ModelLoader

MODELS = {
    'x4plus': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
    'animevideov3': 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth',
}
SCALE = 2
PREVIEW = {0, 120, 226, 240, 330}
OUT = '/kaggle/working'
SRC = '/tmp/frames'

pngs = sorted(glob.glob('/kaggle/input/**/frame_*.png', recursive=True))
if not pngs:
    tar = glob.glob('/kaggle/input/**/frames.tar', recursive=True)[0]
    os.makedirs(SRC, exist_ok=True)
    with tarfile.open(tar) as t:
        t.extractall(SRC)
    pngs = sorted(glob.glob(f'{SRC}/frame_*.png'))
print(len(pngs), 'frames,', torch.cuda.get_device_name(0), flush=True)

to_t = lambda img: torch.from_numpy(np.asarray(img).copy()).cuda().permute(2, 0, 1)[None].float() / 255
to_img = lambda t: Image.fromarray((t[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).round().astype(np.uint8))

results = {}
for name, url in MODELS.items():
    path = f'/tmp/{os.path.basename(url)}'
    urllib.request.urlretrieve(url, path)
    model = ModelLoader().load_from_file(path).cuda().eval()
    half = model.supports_half
    if half:
        model.half()
    print(name, model.architecture.name, 'scale', model.scale, 'half', half, flush=True)
    t0 = time.time()
    outs = []
    with zipfile.ZipFile(f'{OUT}/esrgan_{name}_frames.zip', 'w', zipfile.ZIP_STORED) as z:
        for i, p in enumerate(pngs):
            img = Image.open(p).convert('RGB')
            w, h = img.size
            x = to_t(img)
            with torch.no_grad():
                y = model(x.half() if half else x).float()
                y = F.interpolate(y, size=(h * SCALE, w * SCALE), mode='bicubic', antialias=True, align_corners=False)
            out = f'/tmp/esr_{name}_{i:03d}.png'
            to_img(y).save(out)
            z.write(out, f'frame_{i:03d}.png')
            outs.append(out)
            if i in PREVIEW:
                to_img(y).save(f'{OUT}/preview_{name}_{i:03d}.png')
    print(name, 'upscaled', len(outs), 'frames in', round(time.time() - t0, 1), 's', flush=True)
    results[name] = outs
    del model
    torch.cuda.empty_cache()

from transformers import AutoModelForImageSegmentation
seg = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).cuda().eval().half()
mean = torch.tensor([0.485, 0.456, 0.406], device='cuda').view(1, 3, 1, 1)
std = torch.tensor([0.229, 0.224, 0.225], device='cuda').view(1, 3, 1, 1)
for name, outs in results.items():
    t0 = time.time()
    with zipfile.ZipFile(f'{OUT}/esrgan_{name}_masks.zip', 'w', zipfile.ZIP_STORED) as z:
        for i, p in enumerate(outs):
            img = Image.open(p).convert('RGB')
            w, h = img.size
            x = (to_t(img.resize((1024, 1024), Image.BILINEAR)) - mean) / std
            with torch.no_grad():
                pred = seg(x.half())[-1].sigmoid()
            pred = F.interpolate(pred.float(), size=(h, w), mode='bilinear', align_corners=False)[0, 0]
            Image.fromarray((pred.clamp(0, 1).cpu().numpy() * 255).round().astype(np.uint8)).save('/tmp/m.png')
            z.write('/tmp/m.png', f'mask_{i:03d}.png')
    print(name, 'BIREFNET masks in', round(time.time() - t0, 1), 's', flush=True)
print('ALL DONE', flush=True)
