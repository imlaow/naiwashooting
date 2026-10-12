// Packs the cut-out laughing frames (laugh-frames/, see extract-laugh-frames.mjs) into
// sprite-sheet atlases the game plays on the hero after every 5th kill.
// Frames are scaled so Naiwa stands as tall as the hero art, mirrored to face right like
// it, trimmed, and share one anchor at his feet.
// Usage: node tools/build-laugh-sheets.mjs [frames dir]
// The laugh sound is cut from the source clip separately:
//   ffmpeg -i 39607405800-1-192.mp4 -t 12 -vn -c:a aac -b:a 96k public/assets/laugh.m4a
import { readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'laugh-frames';
const OUT = 'public/assets/laugh';
const STEP = 2; // 30 fps clip -> 15 fps animation
const FPS = 30 / STEP;
const RES = 1.25; // texture pixels per logical pixel (hero frames are 220 logical px tall)
const HERO_H = 219; // standing height of the hero art in logical px (657 px at resolution 3)
const GROUND = 8; // logical px the hero art's feet extend below its anchor (0.96 of 220)
const ATLAS = 2048;
const PAD = 4; // gap between frames so mipmaps don't bleed

const files = readdirSync(SRC).filter((f) => f.endsWith('.png')).sort().filter((_, i) => i % STEP === 0);

// Alpha bounding box of one RGBA buffer.
function bbox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 8) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Scale and anchor from the first frame, where he stands upright like the hero art.
const first = await sharp(join(SRC, files[0])).raw().toBuffer({ resolveWithObject: true });
const W0 = first.info.width, H0 = first.info.height;
const b0 = bbox(first.data, W0, H0);
const scale = (HERO_H * RES) / (b0.y1 - b0.y0);
// Horizontal anchor: centre of his feet (bottom 10% of the body), mirrored.
let sx = 0, n = 0;
for (let y = Math.round(b0.y1 - (b0.y1 - b0.y0) * 0.1); y <= b0.y1; y++) {
  for (let x = 0; x < W0; x++) if (first.data[(y * W0 + x) * 4 + 3] > 128) { sx += x; n++; }
}
const anchor = { x: 1 - sx / n / W0, y: (b0.y1 - (GROUND * RES) / scale) / H0 };
const srcW = Math.round(W0 * scale), srcH = Math.round(H0 * scale);
console.log(`${files.length} frames, scale ${scale.toFixed(4)}, canvas ${srcW}x${srcH}, anchor ${anchor.x.toFixed(3)},${anchor.y.toFixed(3)}`);

// Scale, mirror and trim every frame.
const frames = [];
for (const [k, f] of files.entries()) {
  const { data, info } = await sharp(join(SRC, f)).flop().resize(srcW, srcH, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const b = bbox(data, info.width, info.height);
  const rect = { left: b.x0, top: b.y0, width: b.x1 - b.x0 + 1, height: b.y1 - b.y0 + 1 };
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract(rect).raw().toBuffer();
  frames.push({ name: `laugh_${String(k).padStart(3, '0')}`, buf, ...rect });
}

// Shelf packing, in frame order, across as many atlases as needed.
const atlases = [];
let cur = null;
for (const fr of frames) {
  if (!cur || cur.x + fr.width + PAD > ATLAS) {
    if (cur) { cur.y += cur.rowH + PAD; cur.x = PAD; cur.rowH = 0; }
    if (!cur || cur.y + fr.height + PAD > ATLAS) {
      cur = { x: PAD, y: PAD, rowH: 0, w: 0, h: 0, frames: [] };
      atlases.push(cur);
    }
  }
  fr.ax = cur.x; fr.ay = cur.y;
  cur.frames.push(fr);
  cur.x += fr.width + PAD;
  cur.rowH = Math.max(cur.rowH, fr.height);
  cur.w = Math.max(cur.w, cur.x);
  cur.h = Math.max(cur.h, cur.y + cur.rowH + PAD);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [i, a] of atlases.entries()) {
  const image = `laugh_${i}.webp`;
  const info = await sharp({ create: { width: a.w, height: a.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(a.frames.map((fr) => ({ input: fr.buf, raw: { width: fr.width, height: fr.height, channels: 4 }, left: fr.ax, top: fr.ay })))
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(join(OUT, image));
  bytes += info.size;
  const json = {
    frames: Object.fromEntries(a.frames.map((fr) => [fr.name, {
      frame: { x: fr.ax, y: fr.ay, w: fr.width, h: fr.height },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: fr.left, y: fr.top, w: fr.width, h: fr.height },
      sourceSize: { w: srcW, h: srcH },
      anchor,
    }])),
    meta: { image, size: { w: a.w, h: a.h }, scale: String(RES) },
  };
  writeFileSync(join(OUT, `laugh_${i}.json`), JSON.stringify(json));
  console.log(`${image}  ${a.w}x${a.h}  ${a.frames.length} frames  ${(info.size / 1024).toFixed(0)} KB`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ fps: FPS, frames: frames.length, sheets: atlases.map((_, i) => `laugh_${i}`) }));
console.log(`total ${(bytes / 1024 / 1024).toFixed(2)} MB`);
