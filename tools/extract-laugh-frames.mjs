// Cuts Naiwa out of every frame of the laughing clip as transparent PNGs.
// Extract the frames first (first 12 s, every frame, 30 fps):
//   ffmpeg -i 39607405800-1-192.mp4 -t 12 frames/f_%03d.png
// Usage: node tools/extract-laugh-frames.mjs <frames dir> [out dir] [--masks <dir>] [--cropped]
// --cropped: the frames are already the BOX region (e.g. SeedVR2 2x output), at any scale.
// --grade: shift his yellow fur toward the colour of the hero art in public/assets.
// With --masks, alpha comes from BiRefNet masks (mask_000.png…, one per frame, cropped to
// BOX) instead of the colour-key below. All output frames share one canvas size and
// origin, so they line up as an animation.
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const mi = args.indexOf('--masks');
const MASKS = mi >= 0 ? args.splice(mi, 2)[1] : null;
const ci = args.indexOf('--cropped');
const CROPPED = ci >= 0 && !!args.splice(ci, 1);
const gi = args.indexOf('--grade');
const GRADE = gi >= 0 && !!args.splice(gi, 1);
const [SRC, OUT = 'laugh-frames'] = args;
if (!SRC) { console.error('usage: node tools/extract-laugh-frames.mjs <frames dir> [out dir] [--masks <dir>]'); process.exit(1); }

// Naiwa stays inside this part of the 1280x720 frame; the "LiLa" watermark is outside it.
const BOX = { left: 360, top: 0, width: 560, height: 720 };
const PAD = 4;

const lo = (d, p) => Math.min(d[p], d[p + 1], d[p + 2]);
const chroma = (d, p) => Math.max(d[p], d[p + 1], d[p + 2]) - lo(d, p);

// Studio background: near-white and unsaturated. Near the floor the bar drops to
// catch his warm-grey contact shadow.
function isBg(d, p, y, h) {
  if (y > h * 0.82) return lo(d, p) > 165 && chroma(d, p) < 45;
  return lo(d, p) > 205 && chroma(d, p) < 26;
}
// Pure studio white; teeth, eyes and belly highlights are all warmer than this.
const isPureWhite = (d, p) => lo(d, p) > 225 && chroma(d, p) < 20;

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Labels 4-connected regions where test(i) holds. Returns label array and region sizes.
function regions(w, h, test) {
  const label = new Int32Array(w * h);
  const sizes = [0];
  for (let s = 0; s < w * h; s++) {
    if (label[s] || !test(s)) continue;
    const id = sizes.length;
    let size = 0;
    const q = [s];
    label[s] = id;
    while (q.length) {
      const i = q.pop(), x = i % w, y = (i / w) | 0;
      size++;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!label[j] && test(j)) { label[j] = id; q.push(j); }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

function mask(d, w, h) {
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i] || !isBg(d, i * 3, y, h)) return;
    bg[i] = 1;
    stack.push(i);
  };
  const fill = () => {
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of N4) push(x + dx, y + dy);
    }
  };
  // Flood fill from the border so the cream belly, teeth and eyes stay opaque.
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  fill();
  // Background seen through gaps (between the legs, inside raised arms) is enclosed,
  // so the border fill misses it. Seed a second fill from those pure-white pockets.
  const pockets = regions(w, h, (i) => !bg[i] && isPureWhite(d, i * 3));
  for (let i = 0; i < w * h; i++) {
    if (pockets.label[i] && pockets.sizes[pockets.label[i]] >= 40) push(i % w, (i / w) | 0);
  }
  fill();
  // Keep only the largest foreground blob (drops specks and compression noise).
  const fg = regions(w, h, (i) => !bg[i]);
  let best = 1;
  for (let k = 2; k < fg.sizes.length; k++) if (fg.sizes[k] > fg.sizes[best]) best = k;
  for (let i = 0; i < w * h; i++) if (fg.label[i] !== best) bg[i] = 1;
  return bg;
}

// Distance (in px, capped) from each pixel to the mask boundary, via two-pass chamfer.
function edgeDistance(bg, w, h, cap) {
  const dist = new Uint8Array(w * h).fill(cap);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx] !== bg[i]) { dist[i] = 0; break; }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
  }
  return dist;
}

// Soft edges: pixels on the boundary are a blend of Naiwa and white. Estimate how much
// is Naiwa by comparing against solid foreground colour 2-3 px inside, then un-mix the white.
function compose(d, w, h, bg) {
  const rgba = Buffer.alloc(w * h * 4);
  const dist = edgeDistance(bg, w, h, 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 3, o = i * 4;
    rgba[o] = d[p]; rgba[o + 1] = d[p + 1]; rgba[o + 2] = d[p + 2];
    rgba[o + 3] = bg[i] ? 0 : 255;
    if (dist[i] > 1) continue;
    const x = i % w, y = (i / w) | 0;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (bg[j] || dist[j] < 2) continue;
      r += d[j * 3]; g += d[j * 3 + 1]; b += d[j * 3 + 2]; n++;
    }
    if (!n) { if (!bg[i]) rgba[o + 3] = 160; continue; }
    const ref = [r / n, g / n, b / n];
    // Use the channel where the foreground differs most from white.
    let c = 0;
    for (let k = 1; k < 3; k++) if (ref[k] < ref[c]) c = k;
    const span = 255 - ref[c];
    if (span < 30) continue;
    let a = Math.max(0, Math.min(1, (255 - d[p + c]) / span));
    if (bg[i]) a = Math.min(a, 0.6);
    else a = Math.max(a, 0.35);
    rgba[o + 3] = Math.round(a * 255);
    if (a > 0.02) {
      for (let k = 0; k < 3; k++) {
        const v = (d[p + k] - (1 - a) * 255) / a;
        rgba[o + k] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return rgba;
}

// Model alpha over a known white background: un-mix the white from edge pixels so
// there is no pale fringe, and drop the faint haze BiRefNet leaves around the body.
function composeAlpha(d, w, h, alpha) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = i * 3, o = i * 4;
    const a = Math.max(0, Math.min(1, (alpha[i] / 255 - 0.03) / 0.97));
    rgba[o + 3] = Math.round(a * 255);
    for (let k = 0; k < 3; k++) {
      rgba[o + k] = a > 0.02 ? Math.max(0, Math.min(255, Math.round((d[p + k] - (1 - a) * 255) / a))) : d[p + k];
    }
  }
  return rgba;
}

async function loadMask(k) {
  const { data } = await sharp(join(MASKS, `mask_${String(k).padStart(3, '0')}.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data;
}

// Returns the cut-out frame as RGBA on the BOX canvas.
async function cut(k, f) {
  const { d, w, h } = await load(f);
  if (MASKS) return { rgba: composeAlpha(d, w, h, await loadMask(k)), w, h };
  return { rgba: compose(d, w, h, mask(d, w, h)), w, h };
}

async function load(f) {
  const img = sharp(join(SRC, f));
  const { data, info } = await (CROPPED ? img : img.extract(BOX)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.png')).sort();
mkdirSync(OUT, { recursive: true });

// ---------- Colour grade toward the hero art ----------
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// Fur pixels: saturated yellow-orange. Cream belly, olive hands and the mouth fall outside.
const isFur = (h, s, v) => h > 25 && h < 65 && s > 0.6 && v > 0.5;
// How strongly a pixel counts as fur, so the grade fades out instead of cutting off.
const furWeight = (h, s, v) => {
  const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  return ramp(s, 0.35, 0.6) * ramp(v, 0.3, 0.5) * Math.min(ramp(h, 15, 25), 1 - ramp(h, 65, 75));
};
function furStats(rgba, n) {
  let k = 0, H = 0, S = 0, V = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 250) continue;
    const [h, s, v] = rgb2hsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (isFur(h, s, v)) { k++; H += h; S += s; V += v; }
  }
  return { k, H, S, V };
}
async function heroFur() {
  const t = { k: 0, H: 0, S: 0, V: 0 };
  for (const i of [0, 1, 2, 3]) {
    const { data, info } = await sharp(`public/assets/hero_${i}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const s = furStats(data, info.width * info.height);
    for (const key in t) t[key] += s[key];
  }
  return t;
}
function grade(rgba, n, g) {
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!rgba[o + 3]) continue;
    const [h, s, v] = rgb2hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
    const w = furWeight(h, s, v);
    if (!w) continue;
    const rgb = hsv2rgb((h + g.dh * w + 360) % 360, Math.min(1, s * (1 + (g.ks - 1) * w)), Math.min(1, v * (1 + (g.kv - 1) * w)));
    for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(Math.max(0, Math.min(255, rgb[c])));
  }
}

// Pass 1: union bounding box of Naiwa across every frame.
const src = { k: 0, H: 0, S: 0, V: 0 };
let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, W = 0, H = 0;
for (const [k, f] of files.entries()) {
  const { rgba, w, h } = await cut(k, f);
  W = w; H = h;
  if (GRADE) { const st = furStats(rgba, w * h); for (const key in src) src[key] += st[key]; }
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 8) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
minX = Math.max(0, minX - PAD); minY = Math.max(0, minY - PAD);
maxX = Math.min(W - 1, maxX + PAD); maxY = Math.min(H - 1, maxY + PAD);
const crop = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

let g = null;
if (GRADE) {
  const hero = await heroFur();
  const mean = (t) => [t.H / t.k, t.S / t.k, t.V / t.k].map((x) => x.toFixed(3));
  g = { dh: hero.H / hero.k - src.H / src.k, ks: (hero.S / hero.k) / (src.S / src.k), kv: (hero.V / hero.k) / (src.V / src.k) };
  console.log(`grade: frames fur hsv ${mean(src)} -> hero ${mean(hero)}  (hue ${g.dh.toFixed(1)}, sat x${g.ks.toFixed(3)}, val x${g.kv.toFixed(3)})`);
}

// Pass 2: cut out and write every frame on the shared canvas.
for (const [k, f] of files.entries()) {
  const { rgba, w, h } = await cut(k, f);
  if (g) grade(rgba, w * h, g);
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract(crop)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `laugh_${String(k).padStart(3, '0')}.png`));
}
console.log(`${files.length} frames → ${OUT}/  (${crop.width}x${crop.height})`);
