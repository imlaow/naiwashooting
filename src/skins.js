// Loads the hero frames and builds recoloured enemy variants from them.
import { Assets, Texture, CanvasSource, Spritesheet } from 'pixi.js';

const FRAME_URLS = [0, 1, 2, 3].map((i) => `${import.meta.env.BASE_URL}assets/hero_${i}.png`);
// Frames are stored at 3x (660px tall) but keep their original 220px logical size.
// Mipmaps keep the big frames from shimmering when drawn small.
const FRAME_OPTS = { resolution: 3, autoGenerateMipmaps: true };

export async function loadSkins() {
  const textures = await Promise.all(FRAME_URLS.map((src) => Assets.load({ src, data: FRAME_OPTS })));
  const images = textures.map((t) => t.source.resource);
  const headX = images.map(findHeadX);
  return {
    hero: textures,
    headX,
    // Hue-shifted rivals. Yellow (~50deg) rotated to the target hue.
    gunner: images.map((img) => recolor(img, { hue: -55, sat: 1.1, light: 0.95 })),
    heavy: images.map((img) => recolor(img, { hue: 215, sat: 0.9, light: 0.85 })),
    boss: images.map((img) => recolor(img, { hue: 160, sat: 0.35, light: 0.55 })),
  };
}

// Laugh animation frames (sprite sheets from tools/build-laugh-sheets.mjs), in play order.
export async function loadLaugh() {
  const base = `${import.meta.env.BASE_URL}assets/laugh/`;
  const index = await (await fetch(`${base}index.json`)).json();
  const frames = [];
  for (const name of index.sheets) {
    const data = await (await fetch(`${base}${name}.json`)).json();
    const src = `${base}${data.meta.image}`;
    const tex = await Assets.load({ src, data: { resolution: parseFloat(data.meta.scale), autoGenerateMipmaps: true } });
    const sheet = new Spritesheet(tex, data);
    await sheet.parse();
    frames.push(...Object.keys(data.frames).map((k) => sheet.textures[k]));
  }
  return { fps: index.fps, frames };
}

// Horizontal position (0..1) of the top of the head, for hats/crowns.
function findHeadX(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let y = 0; y < c.height; y++) {
    let sum = 0, n = 0;
    for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 200) { sum += x; n++; }
    if (n > 4) return sum / n / c.width;
  }
  return 0.5;
}

function recolor(img, { hue, sat, light }) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    // Only shift saturated body colours; keep eyes/mouth/dark feet recognisable.
    if (s > 0.25 && l > 0.25) {
      h = (h + hue / 360 + 1) % 1;
      s = Math.min(1, s * sat);
      l = l * light;
    }
    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(id, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: c, ...FRAME_OPTS }) });
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
