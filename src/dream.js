// The dream maps: the ground is King Naiwa himself. His picture (public/assets/boss.png) is laid
// flat, 5.5 times life size, floating in a purple void: you fight on his face, his shoulders and
// his belly, down both legs, and wade through the puddle of milk he stands in, which is the only
// way from one foot to the other. His tongue is sticky (it slows you like the milk does).
//
// Same terrain interface as Island and Factory (see sim/maps.js). A server can't decode the PNG,
// so where the picture ends comes from its alpha baked into dreamMask.js
// (tools/bake-dream-mask.mjs). Positions below are in the picture's own pixels (485 × 660) and
// `at` turns them into the world's.
import { MASK } from './dreamMask.js';
import { mulberry32, hash2 } from './noise.js';

const SIZE = 4000;
const SCALE = 5.5;
const X0 = (SIZE - MASK.imgW * SCALE) / 2, Y0 = 110;
// Solid ground is where the picture's alpha is above this (of 255): a little inside its edge.
const SOLID = 150;

// In picture pixels: { x, y, rx, ry }.
export const EYES = [{ x: 176, y: 55, rx: 15, ry: 20 }, { x: 270, y: 54, rx: 20, ry: 20 }];
const TONGUE = { x: 217, y: 115, rx: 17, ry: 21 };
const PUDDLE = { x: 247, y: 608, rx: 215, ry: 70 };
const BELLY = { x: 228, y: 335 };

let alpha = null;
function alphaBytes() {
  return (alpha ??= Uint8Array.from(atob(MASK.data), (c) => c.charCodeAt(0)));
}

const inEllipse = (x, y, e, grow = 0) => ((x - e.x) / (e.rx + grow)) ** 2 + ((y - e.y) / (e.ry + grow)) ** 2 < 1;

// The picture itself, for painting. The browser hands it over once the skins are loaded
// (main.js); without it the ground is painted from the mask, flat yellow.
let picture = null;
export function setDreamPicture(img) { picture = img; }

export class Dream {
  constructor(seed) {
    this.seed = seed;
    this.size = SIZE;
    this.scale = SCALE;
    this.firstWaveKey = 'game.firstWaveDream';
    this.spawn = this.at(BELLY.x, BELLY.y);
    this.village = this.spawn;
    this.eyes = EYES.map((e) => ({ ...this.at(e.x, e.y), rx: e.rx * SCALE, ry: e.ry * SCALE }));
    this.tongue = { ...this.at(TONGUE.x, TONGUE.y), rx: TONGUE.rx * SCALE, ry: TONGUE.ry * SCALE };
    this.puddle = { ...this.at(PUDDLE.x, PUDDLE.y), rx: PUDDLE.rx * SCALE, ry: PUDDLE.ry * SCALE };
    // On his forehead: the layout stands the totem here, with the SMG at its foot.
    this.lookout = { ...this.at(233, 20), h: 1 };
  }

  // Picture pixels → world.
  at(ix, iy) { return { x: Math.round(X0 + ix * SCALE), y: Math.round(Y0 + iy * SCALE) }; }

  // The picture's alpha (0–255) under a world point, bilinear between the mask's cells.
  alphaAt(x, y) {
    const A = alphaBytes(), { w, h, cell } = MASK;
    const u = (x - X0) / SCALE / cell - 0.5, v = (y - Y0) / SCALE / cell - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = (ci, cj) => (ci < 0 || cj < 0 || ci >= w || cj >= h ? 0 : A[cj * w + ci]);
    return (a(i, j) * (1 - fu) + a(i + 1, j) * fu) * (1 - fv) + (a(i, j + 1) * (1 - fu) + a(i + 1, j + 1) * fu) * fv;
  }

  // ---------- Terrain interface ----------
  heightAt() { return 0.3; }
  inDock() { return false; }
  goodSpawn() { return true; }
  drift() { return 0; }

  onBody(x, y) { return this.alphaAt(x, y) > SOLID; }
  inPuddle(x, y) { return inEllipse(x, y, this.puddle) && !this.onBody(x, y); }
  onTongue(x, y) { return inEllipse(x, y, this.tongue); }

  isWalkable(x, y) { return this.onBody(x, y) || inEllipse(x, y, this.puddle); }
  isWading(x, y) { return this.onTongue(x, y) || this.inPuddle(x, y); }

  dustColor(x, y) { return this.onTongue(x, y) ? 0xf08a9a : 0xf2d060; }

  // ---------- Painting ----------
  // Draws the picture (or, without it, the mask in yellow) into a w × h box at (x, y).
  drawBody(ctx, x, y, w, h) {
    if (picture) { ctx.drawImage(picture, x, y, w, h); return; }
    const A = alphaBytes(), cw = w / MASK.w, ch = h / MASK.h;
    ctx.fillStyle = '#f5c21c';
    for (let j = 0; j < MASK.h; j++) for (let i = 0; i < MASK.w; i++) {
      if (A[j * MASK.w + i] > 127) ctx.fillRect(x + i * cw, y + j * ch, cw + 0.5, ch + 0.5);
    }
  }

  paintTerrain(scale = 1) {
    const S = Math.round(SIZE * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.scale(scale, scale);
    ctx.imageSmoothingQuality = 'high';
    const W = MASK.imgW * SCALE, H = MASK.imgH * SCALE;
    const rand = mulberry32(this.seed + 77);
    const R = (a, b) => a + rand() * (b - a);

    this.drawBody(ctx, X0, Y0, W, H);

    // Only on him from here: fur grain, so the ground reads as ground when you run across it.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(X0, Y0, W, H);
    // Freckles and the odd hair.
    for (let i = 0; i < 520; i++) {
      const x = R(X0, X0 + W), y = R(Y0, Y0 + H), r = R(5, 16);
      ctx.fillStyle = rand() < 0.5 ? 'rgba(150,95,10,0.16)' : 'rgba(255,246,190,0.2)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * R(0.5, 0.9), R(0, 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,75,10,0.3)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 380; i++) {
      const x = R(X0, X0 + W), y = R(Y0, Y0 + H), a = R(1.2, 1.9), l = R(12, 26);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 6, y + l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    // His belly button, where you start.
    const b = this.spawn;
    const g = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, 64);
    g.addColorStop(0, 'rgba(120,70,30,0.75)'); g.addColorStop(0.6, 'rgba(170,110,60,0.35)'); g.addColorStop(1, 'rgba(170,110,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 64, 50, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,230,0.55)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 40, 30, 0, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

    // Behind him: the milk he stands in, and a glow so he floats off the void.
    ctx.globalCompositeOperation = 'destination-over';
    const P = this.puddle;
    ctx.strokeStyle = 'rgba(214,200,170,0.75)'; ctx.lineWidth = 3;
    for (let i = 0; i < 150; i++) {
      const a = R(0, Math.PI * 2), d = Math.sqrt(rand()) * 0.9, w = R(14, 44);
      const x = P.x + Math.cos(a) * P.rx * d, y = P.y + Math.sin(a) * P.ry * d;
      ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.2, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    }
    const m = ctx.createRadialGradient(P.x, P.y, P.rx * 0.2, P.x, P.y, P.rx);
    m.addColorStop(0, '#fffaf0'); m.addColorStop(0.8, '#f6ecd4'); m.addColorStop(1, '#d9c9a4');
    ctx.save();
    ctx.translate(P.x, P.y); ctx.scale(1, P.ry / P.rx); ctx.translate(-P.x, -P.y);
    ctx.fillStyle = m;
    ctx.beginPath(); ctx.arc(P.x, P.y, P.rx, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(P.x, P.y, P.rx + 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // The glow: his own shape, blurred, drawn underneath.
    ctx.shadowColor = 'rgba(255,120,220,0.85)'; ctx.shadowBlur = 70;
    this.drawBody(ctx, X0, Y0, W, H);
    ctx.shadowColor = 'rgba(40,10,70,0.9)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 60;
    this.drawBody(ctx, X0, Y0, W, H);
    return canvas;
  }

  paintMinimap(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const k = size / SIZE;
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
    g.addColorStop(0, '#5a2a8a'); g.addColorStop(1, '#1c0b33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) ctx.fillRect(hash2(i, 5) * size, hash2(i, 9) * size, 1, 1);
    const P = this.puddle;
    ctx.fillStyle = '#f6ecd4';
    ctx.beginPath(); ctx.ellipse(P.x * k, P.y * k, P.rx * k, P.ry * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.imageSmoothingQuality = 'high';
    this.drawBody(ctx, X0 * k, Y0 * k, MASK.imgW * SCALE * k, MASK.imgH * SCALE * k);
    return canvas;
  }
}

// Fine tileable speckle, as a fill pattern.
function grainPattern(ctx) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d');
  const img = cx.createImageData(S, S);
  for (let y = 0, p = 0; y < S; y++) for (let x = 0; x < S; x++, p += 4) {
    const v = hash2(x, y);
    const dark = v < 0.5;
    img.data[p] = dark ? 110 : 255; img.data[p + 1] = dark ? 70 : 250; img.data[p + 2] = dark ? 0 : 210;
    img.data[p + 3] = Math.abs(v - 0.5) * 2 * 24;
  }
  cx.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}
