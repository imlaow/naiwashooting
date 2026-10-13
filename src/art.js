// Procedurally painted textures (canvas 2D -> Pixi textures).
import { Texture, CanvasSource } from 'pixi.js';
import { mulberry32 } from './noise.js';

const RES = 2;

// Creates a texture of logical size w*h. `anchor` is stored on the texture so
// sprites can pick it up via makeSprite().
export function paint(w, h, anchor, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * RES);
  canvas.height = Math.ceil(h * RES);
  // Keep every painted canvas in CPU memory: on Android a GPU reset (fullscreen, rotation, app switch)
  // wipes GPU-backed canvases, and Pixi re-uploads textures from these canvases when WebGL comes back.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(RES, RES);
  draw(ctx, w, h);
  const tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution: RES }) });
  tex.anchorHint = anchor;
  return tex;
}

const TAU = Math.PI * 2;
const ellipse = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); };

function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

// ---------- Vegetation ----------
function palmTree(seed) {
  const rand = mulberry32(seed);
  return paint(240, 280, [0.5, 265 / 280], (ctx) => {
    const bx = 120, by = 265;
    const lean = (rand() - 0.5) * 70;
    const tx = bx + lean, ty = 100;
    const segs = 15;
    for (let i = 0; i < segs; i++) {
      const t = i / segs, t2 = (i + 1) / segs;
      const x = bx + lean * t * t, y = by + (ty - by) * t;
      const x2 = bx + lean * t2 * t2, y2 = by + (ty - by) * t2;
      const w = 15 - t * 6;
      ctx.fillStyle = linear(ctx, x - w, 0, x + w, 0, [[0, '#a8875f'], [0.45, '#8a6a45'], [1, '#5a4029']]);
      ctx.beginPath();
      ctx.moveTo(x - w, y); ctx.lineTo(x2 - w + 0.6, y2 - 2); ctx.lineTo(x2 + w - 0.6, y2 - 2); ctx.lineTo(x + w, y);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,20,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y + 3, x + w, y); ctx.stroke();
    }
    const n = 8 + (rand() * 3 | 0);
    const fronds = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rand() * 0.4;
      fronds.push({ a, L: 72 + rand() * 30 });
    }
    fronds.sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
    for (const f of fronds) {
      const back = Math.sin(f.a) < -0.2;
      const ex = tx + Math.cos(f.a) * f.L, ey = ty + Math.sin(f.a) * f.L * 0.62 + 22;
      const cx = tx + Math.cos(f.a) * f.L * 0.5, cy = ty + Math.sin(f.a) * f.L * 0.3 - 18;
      const P = (s) => ({
        x: (1 - s) * (1 - s) * tx + 2 * (1 - s) * s * cx + s * s * ex,
        y: (1 - s) * (1 - s) * ty + 2 * (1 - s) * s * cy + s * s * ey,
      });
      const base = back ? ['#1f5e2a', '#2e7d32'] : ['#2e8b3a', '#5cb85c'];
      ctx.lineCap = 'round';
      for (let s = 0.08; s < 1; s += 0.035) {
        const p = P(s), q = P(s + 0.01);
        let dx = q.x - p.x, dy = q.y - p.y;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const len = Math.sin(s * Math.PI) * 20 + 5;
        for (const side of [1, -1]) {
          ctx.strokeStyle = base[side > 0 ? 1 : 0];
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - dy * len * side + dx * len * 0.55, p.y + dx * len * side + dy * len * 0.55 + 4);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = back ? '#4a6b1f' : '#9ccc65';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    }
    for (let i = 0; i < 3 + (rand() * 2 | 0); i++) {
      const cx = tx + (rand() - 0.5) * 18, cy = ty + 4 + rand() * 8;
      ctx.fillStyle = radial(ctx, cx - 2, cy - 2, 1, 7, [[0, '#8d6e4a'], [1, '#4e3420']]);
      ellipse(ctx, cx, cy, 6.5, 6); ctx.fill();
    }
    ctx.lineCap = 'butt';
  });
}

function jungleTree(seed) {
  const rand = mulberry32(seed);
  const palette = [
    ['#1b4d2b', '#2f6f3a', '#4b9b4e', '#86c66a'],
    ['#24502a', '#3a7d34', '#5fa843', '#a3d36a'],
    ['#163f30', '#25634a', '#3f8f63', '#7fc49a'],
  ][seed % 3];
  return paint(210, 240, [0.5, 228 / 240], (ctx) => {
    const bx = 105, by = 228;
    const cx = 105, cy = 98;
    const bark = linear(ctx, bx - 16, 0, bx + 16, 0, [[0, '#8a6844'], [0.4, '#6b4c2e'], [1, '#3a2716']]);
    // contact shadow so the tree sits on the ground
    ctx.fillStyle = radial(ctx, bx + 4, by - 1, 4, 38, [[0, 'rgba(0,0,0,0.32)'], [1, 'rgba(0,0,0,0)']]);
    ellipse(ctx, bx + 4, by - 1, 38, 10); ctx.fill();
    // buttress roots flaring out along the ground
    ctx.fillStyle = bark;
    for (const s of [-1, -0.45, 0.4, 1]) {
      const tip = bx + s * (24 + rand() * 8);
      ctx.beginPath();
      ctx.moveTo(bx + s * 6 - 6, by - 18);
      ctx.quadraticCurveTo(bx + s * 14, by - 6, tip, by + 1);
      ctx.quadraticCurveTo(bx + s * 12, by + 1, bx + s * 6 + 6, by - 4);
      ctx.closePath(); ctx.fill();
    }
    // the trunk runs up into the canopy and forks into limbs, so no cut-off top ever shows
    const trunk = new Path2D();
    trunk.moveTo(bx - 17, by);
    trunk.quadraticCurveTo(bx - 9, by - 22, bx - 8, by - 60);
    trunk.lineTo(bx - 6, 118); trunk.lineTo(bx + 6, 118);
    trunk.lineTo(bx + 8, by - 60);
    trunk.quadraticCurveTo(bx + 9, by - 22, bx + 18, by);
    trunk.closePath();
    ctx.fillStyle = bark; ctx.fill(trunk);
    ctx.strokeStyle = '#4a3220'; ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const ex = bx + s * (26 + rand() * 8), ey = 120 + rand() * 6;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(bx + s * 2, 168); ctx.quadraticCurveTo(bx + s * 6, 140, ex, ey); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.save();
    ctx.clip(trunk);
    // bark grain and a sunlit edge
    ctx.strokeStyle = 'rgba(40,25,12,0.45)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const x = bx - 10 + i * 4 + rand() * 2, y0 = 150 + rand() * 20;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + (rand() - 0.5) * 4, y0 + 30, x + (x - bx) * 0.4, by); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,225,170,0.22)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(bx - 5, 150); ctx.quadraticCurveTo(bx - 7, by - 30, bx - 12, by); ctx.stroke();
    // shade cast by the canopy onto the upper trunk
    ctx.fillStyle = linear(ctx, 0, 150, 0, 195, [[0, 'rgba(10,25,10,0.55)'], [1, 'rgba(10,25,10,0)']]);
    ctx.fillRect(bx - 20, 110, 40, 85);
    ctx.restore();
    const blobs = [
      // fixed lower blobs: the canopy always closes over the trunk top and limb tips
      { x: cx - 30, y: 136, r: 28 }, { x: cx + 30, y: 136, r: 28 }, { x: cx, y: 146, r: 26 },
    ];
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * 62;
      blobs.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.8, r: 22 + rand() * 18 });
    }
    // layered shading: dark rim, mid body, sunlit top-left
    for (const b of blobs) { ctx.fillStyle = palette[0]; ellipse(ctx, b.x + 4, b.y + 6, b.r, b.r * 0.92); ctx.fill(); }
    for (const b of blobs) { ctx.fillStyle = palette[1]; ellipse(ctx, b.x, b.y, b.r * 0.92, b.r * 0.85); ctx.fill(); }
    for (const b of blobs) {
      ctx.fillStyle = palette[2];
      ellipse(ctx, b.x - b.r * 0.22, b.y - b.r * 0.25, b.r * 0.6, b.r * 0.52); ctx.fill();
    }
    for (const b of blobs) {
      if (b.x - cx + b.y - cy > 10) continue;
      ctx.fillStyle = palette[3];
      ellipse(ctx, b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.25, b.r * 0.18); ctx.fill();
    }
    // leaf ticks
    ctx.strokeStyle = 'rgba(20,50,20,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * 80;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.8;
      ctx.beginPath(); ctx.arc(x, y, 4, 0.2, 2.2); ctx.stroke();
    }
    if (seed % 4 === 0) {
      for (let i = 0; i < 9; i++) {
        const a = rand() * TAU, r = rand() * 60;
        ctx.fillStyle = '#e74c3c';
        ellipse(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 3.5, 3.5); ctx.fill();
      }
    }
  });
}

function bush(seed) {
  const rand = mulberry32(seed);
  return paint(90, 66, [0.5, 0.9], (ctx) => {
    const cx = 45, cy = 38;
    const blobs = [];
    for (let i = 0; i < 9; i++) blobs.push({ x: cx + (rand() - 0.5) * 50, y: cy + (rand() - 0.5) * 22, r: 12 + rand() * 9 });
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, cx + 4, cy + 18, 38, 9); ctx.fill();
    for (const b of blobs) { ctx.fillStyle = '#245c2c'; ellipse(ctx, b.x + 2, b.y + 4, b.r, b.r * 0.9); ctx.fill(); }
    for (const b of blobs) { ctx.fillStyle = '#3b8a3e'; ellipse(ctx, b.x, b.y, b.r * 0.85, b.r * 0.78); ctx.fill(); }
    for (const b of blobs) { ctx.fillStyle = '#69b54f'; ellipse(ctx, b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.4, b.r * 0.3); ctx.fill(); }
    const berry = ['#e63946', '#f1c40f', '#9b59b6', '#ffffff'][seed % 4];
    if (seed % 3 !== 0) {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = berry;
        ellipse(ctx, cx + (rand() - 0.5) * 50, cy + (rand() - 0.5) * 22, 2.4, 2.4); ctx.fill();
      }
    }
  });
}

function fern(seed) {
  const rand = mulberry32(seed);
  return paint(60, 48, [0.5, 0.95], (ctx) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i / 8 - 0.5) * 2.4 + (rand() - 0.5) * 0.2;
      const L = 24 + rand() * 18;
      const ex = 30 + Math.cos(a) * L, ey = 46 + Math.sin(a) * L;
      ctx.strokeStyle = i % 2 ? '#3d8b37' : '#5aae4a';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(30, 46); ctx.quadraticCurveTo(30 + Math.cos(a) * L * 0.5, 46 + Math.sin(a) * L * 0.7 - 6, ex, ey); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  });
}

function rock(seed, size) {
  const rand = mulberry32(seed);
  const w = size * 2.4, h = size * 1.9;
  return paint(w, h, [0.5, 0.86], (ctx) => {
    const cx = w / 2, cy = h * 0.55;
    const n = 10, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      const r = size * (0.78 + rand() * 0.3);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7]);
    }
    const poly = (ox, oy, s) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const px = cx + (x - cx) * s + ox, py = cy + (y - cy) * s + oy;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; poly(size * 0.12, size * 0.18, 1.02); ctx.fill();
    ctx.fillStyle = linear(ctx, cx - size, cy - size, cx + size, cy + size, [[0, '#b4b0a6'], [0.55, '#86827a'], [1, '#55524c']]);
    poly(0, 0, 1); ctx.fill();
    ctx.fillStyle = linear(ctx, cx - size, cy - size, cx + size, cy, [[0, '#d6d2c8'], [1, '#9c988e']]);
    poly(-size * 0.08, -size * 0.2, 0.68); ctx.fill();
    ctx.strokeStyle = 'rgba(40,38,34,0.55)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      let x = cx + (rand() - 0.5) * size, y = cy + (rand() - 0.5) * size * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) { x += (rand() - 0.5) * size * 0.4; y += rand() * size * 0.25; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${90 + rand() * 40 | 0},${140 + rand() * 30 | 0},70,0.75)`;
      ellipse(ctx, cx + (rand() - 0.6) * size, cy - size * 0.35 + rand() * size * 0.3, 2 + rand() * size * 0.12, 1.5 + rand() * size * 0.06);
      ctx.fill();
    }
  });
}

function driftwood(seed) {
  const rand = mulberry32(seed);
  return paint(110, 34, [0.5, 0.7], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ellipse(ctx, 57, 25, 50, 7); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 8, 0, 26, [[0, '#d8c8a8'], [1, '#8f7a5a']]);
    ctx.beginPath(); ctx.roundRect(8, 9, 94, 15, 7); ctx.fill();
    ctx.fillStyle = '#e6d8bc'; ellipse(ctx, 98, 16, 5, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(90,70,50,0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = 11 + rand() * 11;
      ctx.beginPath(); ctx.moveTo(12 + rand() * 20, y); ctx.lineTo(50 + rand() * 45, y + (rand() - 0.5) * 3); ctx.stroke();
    }
    ctx.strokeStyle = '#a89070'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(35, 11); ctx.lineTo(28, 2); ctx.stroke();
    ctx.lineCap = 'butt';
  });
}

// ---------- Props ----------
function crate() {
  return paint(52, 56, [0.5, 0.93], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 29, 51, 25, 6); ctx.fill();
    // top face
    ctx.fillStyle = '#d9a866';
    ctx.beginPath(); ctx.moveTo(4, 14); ctx.lineTo(10, 3); ctx.lineTo(48, 3); ctx.lineTo(48, 14); ctx.closePath(); ctx.fill();
    // front face
    ctx.fillStyle = linear(ctx, 0, 14, 0, 52, [[0, '#b8803f'], [1, '#8a5a2b']]);
    ctx.fillRect(4, 14, 44, 38);
    ctx.strokeStyle = '#5e3b1a'; ctx.lineWidth = 2;
    ctx.strokeRect(4, 14, 44, 38);
    for (let y = 23; y < 52; y += 9.5) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(48, y); ctx.stroke(); }
    ctx.lineWidth = 4; ctx.strokeStyle = '#6e4620';
    ctx.beginPath(); ctx.moveTo(6, 16); ctx.lineTo(46, 50); ctx.stroke();
    ctx.fillStyle = '#3a3a3a';
    for (const [x, y] of [[7, 17], [45, 17], [7, 49], [45, 49]]) { ellipse(ctx, x, y, 1.6, 1.6); ctx.fill(); }
    ctx.strokeStyle = 'rgba(120,80,30,0.8)'; ctx.lineWidth = 1;
    for (let x = 14; x < 48; x += 10) { ctx.beginPath(); ctx.moveTo(x - 4, 3); ctx.lineTo(x - 8, 14); ctx.stroke(); }
  });
}

function barrel() {
  return paint(38, 52, [0.5, 0.92], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 21, 47, 17, 5); ctx.fill();
    ctx.fillStyle = linear(ctx, 3, 0, 35, 0, [[0, '#7f1d1d'], [0.35, '#e53e3e'], [0.6, '#c53030'], [1, '#63171b']]);
    ctx.beginPath(); ctx.moveTo(3, 9); ctx.lineTo(3, 44); ctx.ellipse(19, 44, 16, 5, 0, Math.PI, 0, true); ctx.lineTo(35, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a1010'; ellipse(ctx, 19, 9, 16, 5); ctx.fill();
    ctx.fillStyle = '#9b2c2c'; ellipse(ctx, 19, 9, 13, 3.6); ctx.fill();
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2.5;
    for (const y of [17, 36]) { ctx.beginPath(); ctx.ellipse(19, y, 16, 5, 0, 0, Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#fbd38d';
    ctx.beginPath(); ctx.moveTo(19, 20); ctx.lineTo(27, 33); ctx.lineTo(11, 33); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(18, 23, 2, 6); ctx.fillRect(18, 30, 2, 1.6);
  });
}

function hut(seed) {
  const rand = mulberry32(seed);
  return paint(240, 220, [0.5, 208 / 220], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 128, 205, 105, 14); ctx.fill();
    // stilts & platform
    ctx.fillStyle = '#5b3a21';
    for (const x of [40, 90, 150, 196]) ctx.fillRect(x, 186, 8, 20);
    ctx.fillStyle = '#9a6b3f'; ctx.fillRect(28, 180, 184, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(28, 188, 184, 2);
    // walls
    for (let x = 40; x < 200; x += 10) {
      const t = 120 + (rand() * 30 | 0);
      ctx.fillStyle = `rgb(${t},${t * 0.7 | 0},${t * 0.45 | 0})`;
      ctx.fillRect(x, 110, 10, 72);
      ctx.fillStyle = 'rgba(40,25,10,0.5)'; ctx.fillRect(x + 9, 110, 1, 72);
    }
    // door
    ctx.fillStyle = '#2a1a0e'; ctx.fillRect(105, 134, 32, 48);
    ctx.strokeStyle = '#6e4a2a'; ctx.lineWidth = 3; ctx.strokeRect(105, 134, 32, 48);
    // window
    ctx.fillStyle = '#1e140c'; ctx.fillRect(56, 132, 30, 24);
    ctx.fillStyle = 'rgba(255,190,90,0.35)'; ctx.fillRect(58, 134, 26, 20);
    ctx.strokeStyle = '#6e4a2a'; ctx.lineWidth = 3; ctx.strokeRect(56, 132, 30, 24);
    ctx.beginPath(); ctx.moveTo(71, 132); ctx.lineTo(71, 156); ctx.moveTo(56, 144); ctx.lineTo(86, 144); ctx.stroke();
    ctx.fillStyle = '#1e140c'; ctx.fillRect(158, 132, 28, 22);
    ctx.strokeRect(158, 132, 28, 22);
    // roof
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.moveTo(14, 126); ctx.lineTo(70, 22); ctx.lineTo(170, 22); ctx.lineTo(232, 126); ctx.closePath(); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 20, 0, 125, [[0, '#e0bb6c'], [1, '#a77d3a']]);
    ctx.beginPath(); ctx.moveTo(8, 118); ctx.lineTo(66, 16); ctx.lineTo(174, 16); ctx.lineTo(232, 118); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 420; i++) {
      const t = rand();
      const y = 18 + t * 98;
      const half = 54 + t * 58;
      const x = 120 + (rand() * 2 - 1) * half;
      const lean = (x - 120) / half * 6;
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(120,85,30,0.55)' : 'rgba(250,225,150,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lean, y + 9 + rand() * 6); ctx.stroke();
    }
    ctx.strokeStyle = '#7a5520'; ctx.lineWidth = 2;
    for (const y of [50, 84]) {
      const half = 54 + (y - 18) / 98 * 58;
      ctx.beginPath(); ctx.moveTo(120 - half, y); ctx.lineTo(120 + half, y); ctx.stroke();
    }
    // fringe
    for (let x = 10; x < 232; x += 4) {
      ctx.strokeStyle = (x / 4) % 2 ? '#b98a40' : '#8c6428';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 116); ctx.lineTo(x + (rand() - 0.5) * 3, 124 + rand() * 6); ctx.stroke();
    }
    ctx.fillStyle = '#6b4a1f'; ctx.fillRect(62, 12, 116, 7);
  });
}

function boat() {
  return paint(70, 170, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = 'rgba(0,30,40,0.35)'; ellipse(ctx, 40, 92, 30, 76); ctx.fill();
    const hull = (inset) => {
      ctx.beginPath();
      ctx.moveTo(35, 6 + inset);
      ctx.bezierCurveTo(62 - inset, 40, 62 - inset, 120, 50 - inset, 160 - inset);
      ctx.lineTo(20 + inset, 160 - inset);
      ctx.bezierCurveTo(8 + inset, 120, 8 + inset, 40, 35, 6 + inset);
      ctx.closePath();
    };
    ctx.fillStyle = '#f1f5f9'; hull(0); ctx.fill();
    ctx.fillStyle = '#2b6cb0'; hull(3); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 0, 70, 0, [[0, '#8a5a2b'], [0.5, '#c08850'], [1, '#8a5a2b']]); hull(7); ctx.fill();
    ctx.strokeStyle = 'rgba(80,50,20,0.55)'; ctx.lineWidth = 1;
    for (let x = 22; x < 50; x += 5) { ctx.beginPath(); ctx.moveTo(x, 25); ctx.lineTo(x, 150); ctx.stroke(); }
    ctx.fillStyle = '#6b4423';
    for (const y of [55, 105, 140]) ctx.fillRect(14, y, 42, 9);
    ctx.strokeStyle = '#d6b27a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(20, 85); ctx.lineTo(48, 132); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#d6c08a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(35, 8); ctx.quadraticCurveTo(10, 0, 2, 20); ctx.stroke();
  });
}

function tikiTorch() {
  return paint(26, 80, [0.5, 0.96], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, 15, 76, 8, 3); ctx.fill();
    ctx.fillStyle = linear(ctx, 9, 0, 17, 0, [[0, '#8a5a2b'], [1, '#4a2f17']]);
    ctx.fillRect(10, 20, 6, 57);
    ctx.fillStyle = '#3b2513';
    for (const y of [28, 44, 60]) ctx.fillRect(9, y, 8, 3);
    ctx.fillStyle = '#5a3a1c';
    ctx.beginPath(); ctx.moveTo(3, 10); ctx.lineTo(23, 10); ctx.lineTo(18, 24); ctx.lineTo(8, 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a1a0e'; ellipse(ctx, 13, 10, 10, 3); ctx.fill();
  });
}

function tower() {
  return paint(150, 250, [0.5, 240 / 250], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 80, 238, 62, 12); ctx.fill();
    ctx.strokeStyle = '#5b3a21'; ctx.lineWidth = 8;
    const legs = [[28, 238, 40, 110], [122, 238, 110, 110], [50, 228, 52, 110], [100, 228, 98, 110]];
    for (const [x0, y0, x1, y1] of legs) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeStyle = '#6e4a2a';
    ctx.beginPath(); ctx.moveTo(32, 220); ctx.lineTo(108, 130); ctx.moveTo(118, 220); ctx.lineTo(42, 130); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, 180); ctx.lineTo(120, 180); ctx.stroke();
    // platform
    ctx.fillStyle = '#a8794a'; ctx.fillRect(20, 96, 110, 18);
    ctx.fillStyle = '#7a5530'; ctx.fillRect(20, 112, 110, 4);
    // rails
    ctx.fillStyle = '#8a5a2b';
    for (let x = 22; x <= 124; x += 17) ctx.fillRect(x, 66, 5, 34);
    ctx.fillRect(18, 64, 114, 6);
    // roof
    ctx.fillStyle = linear(ctx, 0, 6, 0, 50, [[0, '#e0bb6c'], [1, '#a77d3a']]);
    ctx.beginPath(); ctx.moveTo(8, 52); ctx.lineTo(75, 4); ctx.lineTo(142, 52); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,85,30,0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = 20 + i * 3.1; ctx.beginPath(); ctx.moveTo(75, 8); ctx.lineTo(x, 50); ctx.stroke();
    }
    ctx.fillStyle = '#5b3a21'; ctx.fillRect(22, 50, 5, 18); ctx.fillRect(123, 50, 5, 18);
  });
}

function flag() {
  return paint(40, 24, [0, 0.5], (ctx) => {
    ctx.fillStyle = '#e53e3e';
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(20, -2, 40, 6); ctx.lineTo(36, 14); ctx.lineTo(40, 22); ctx.quadraticCurveTo(20, 16, 0, 22); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ellipse(ctx, 15, 12, 5, 5); ctx.fill();
  });
}

// ---------- Creatures ----------
function crabFrame(phase) {
  return paint(76, 56, [0.5, 0.82], (ctx) => {
    const cx = 38, cy = 32;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, cx + 2, cy + 14, 28, 7); ctx.fill();
    ctx.strokeStyle = '#a3261a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const off = (i + phase) % 2 ? 4 : -3;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 12, cy + 2 + i * 3);
        ctx.lineTo(cx + s * 24, cy - 4 + i * 5 + off);
        ctx.lineTo(cx + s * 30, cy + 10 + i * 4 + off);
        ctx.stroke();
      }
    }
    // claws
    for (const s of [-1, 1]) {
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx + s * 10, cy - 6); ctx.lineTo(cx + s * 22, cy - 16 + phase * 2); ctx.stroke();
      ctx.fillStyle = '#e74c3c';
      ellipse(ctx, cx + s * 25, cy - 22 + phase * 2, 8, 7, s * 0.4); ctx.fill();
      ctx.fillStyle = '#7b1d14';
      ctx.beginPath(); ctx.moveTo(cx + s * 25, cy - 22 + phase * 2); ctx.lineTo(cx + s * 33, cy - 28 + phase * 2); ctx.lineTo(cx + s * 30, cy - 20 + phase * 2); ctx.closePath(); ctx.fill();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = radial(ctx, cx - 5, cy - 6, 2, 22, [[0, '#ff8a65'], [0.6, '#e74c3c'], [1, '#922b21']]);
    ellipse(ctx, cx, cy, 18, 13); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ellipse(ctx, cx - 6, cy - 6, 6, 3); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.strokeStyle = '#922b21'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + s * 5, cy - 10); ctx.lineTo(cx + s * 7, cy - 18); ctx.stroke();
      ctx.fillStyle = '#fff'; ellipse(ctx, cx + s * 7, cy - 20, 4, 4); ctx.fill();
      ctx.fillStyle = '#111'; ellipse(ctx, cx + s * 7.5, cy - 20, 2, 2.4); ctx.fill();
    }
    ctx.strokeStyle = '#5a1510'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy - 2, 6, 0.3, Math.PI - 0.3); ctx.stroke();
  });
}

function seagull(phase) {
  return paint(48, 26, [0.5, 0.5], (ctx) => {
    const up = phase === 0;
    ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, 14);
    ctx.quadraticCurveTo(12, up ? 0 : 20, 1, up ? 3 : 20);
    ctx.quadraticCurveTo(12, up ? 8 : 18, 24, 16);
    ctx.quadraticCurveTo(36, up ? 8 : 18, 47, up ? 3 : 20);
    ctx.quadraticCurveTo(36, up ? 0 : 20, 24, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#334155';
    ellipse(ctx, 3, up ? 4 : 19, 3, 2); ctx.fill(); ellipse(ctx, 45, up ? 4 : 19, 3, 2); ctx.fill();
    ctx.fillStyle = '#fff'; ellipse(ctx, 24, 15, 4, 7); ctx.fill();
    ctx.fillStyle = '#f59e0b'; ctx.fillRect(23, 6, 2, 3);
  });
}

function butterfly(phase, color) {
  return paint(16, 12, [0.5, 0.5], (ctx) => {
    const w = phase ? 3 : 7;
    ctx.fillStyle = color;
    ellipse(ctx, 8 - w * 0.6, 5, w * 0.6, 4); ctx.fill();
    ellipse(ctx, 8 + w * 0.6, 5, w * 0.6, 4); ctx.fill();
    ellipse(ctx, 8 - w * 0.4, 9, w * 0.4, 2.5); ctx.fill();
    ellipse(ctx, 8 + w * 0.4, 9, w * 0.4, 2.5); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(7.4, 3, 1.2, 8);
  });
}

// ---------- Weapons & FX ----------
function gun(kind) {
  const specs = {
    pistol: [36, 18], smg: [50, 22], shotgun: [64, 18], rifle: [76, 18],
  };
  const [w, h] = specs[kind];
  return paint(w, h, [10 / w, 0.45], (ctx) => {
    const metal = linear(ctx, 0, 0, 0, h, [[0, '#6b7280'], [0.5, '#374151'], [1, '#111827']]);
    ctx.fillStyle = metal;
    if (kind === 'pistol') {
      ctx.fillRect(4, 3, 30, 7);
      ctx.fillStyle = '#4b2e1a'; ctx.fillRect(5, 9, 8, 9);
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(4, 3, 30, 1.5);
    } else if (kind === 'smg') {
      ctx.fillRect(4, 4, 40, 8);
      ctx.fillRect(44, 6, 6, 3);
      ctx.fillStyle = '#1f2937'; ctx.fillRect(22, 12, 6, 10);
      ctx.fillStyle = '#4b2e1a'; ctx.fillRect(6, 11, 8, 9);
      ctx.fillStyle = '#374151'; ctx.fillRect(0, 5, 6, 5);
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(4, 4, 40, 1.5);
    } else if (kind === 'shotgun') {
      ctx.fillStyle = '#7c4a24'; ctx.fillRect(0, 6, 18, 9);
      ctx.fillStyle = metal; ctx.fillRect(16, 4, 46, 6);
      ctx.fillStyle = '#5a3418'; ctx.fillRect(30, 9, 18, 5);
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(16, 4, 46, 1.5);
    } else {
      ctx.fillStyle = '#6b4423'; ctx.fillRect(0, 5, 26, 9);
      ctx.fillStyle = metal; ctx.fillRect(24, 5, 50, 5);
      ctx.fillStyle = '#111827'; ctx.fillRect(30, 0, 18, 5);
      ctx.fillStyle = '#60a5fa'; ctx.fillRect(46, 1, 2, 3);
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(24, 5, 50, 1.2);
    }
  });
}

export function buildArt() {
  const art = {};
  art.palms = [11, 22, 33, 44, 55, 66].map(palmTree);
  art.trees = [1, 2, 3, 4, 5, 6].map(jungleTree);
  art.bushes = [1, 2, 3, 4, 5, 6, 7, 8].map(bush);
  art.ferns = [1, 2, 3, 4].map(fern);
  art.rocks = [[1, 18], [2, 22], [3, 26], [4, 34], [5, 42], [6, 30], [7, 52]].map(([s, z]) => rock(s, z));
  art.driftwood = [1, 2].map(driftwood);
  art.crate = crate();
  art.barrel = barrel();
  art.huts = [1, 2, 3].map(hut);
  art.boat = boat();
  art.torch = tikiTorch();
  art.tower = tower();
  art.flag = flag();
  art.crab = [crabFrame(0), crabFrame(1)];
  art.gull = [seagull(0), seagull(1)];
  art.butterflies = ['#f472b6', '#facc15', '#60a5fa', '#fb923c'].map((c) => [butterfly(0, c), butterfly(1, c)]);
  art.guns = { pistol: gun('pistol'), smg: gun('smg'), shotgun: gun('shotgun'), rifle: gun('rifle') };

  art.shadow = paint(64, 24, [0.5, 0.5], (ctx) => {
    ctx.save();
    ctx.scale(1, 24 / 64);
    ctx.fillStyle = radial(ctx, 32, 32, 0, 32, [[0, 'rgba(0,0,0,0.55)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(0, 0, 64, 64);
    ctx.restore();
  });
  art.glow = paint(64, 64, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 32, 32, 0, 32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, 64, 64);
  });
  art.soft = paint(48, 48, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 24, 24, 0, 24, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, 48, 48);
  });
  art.bullet = paint(26, 10, [0.75, 0.5], (ctx) => {
    ctx.fillStyle = linear(ctx, 0, 0, 26, 0, [[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,1)']]);
    ctx.beginPath(); ctx.roundRect(0, 2, 26, 6, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(15, 3, 10, 4, 2); ctx.fill();
  });
  art.orb = paint(18, 18, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 9, 9, 0, 9, [[0, '#fff'], [0.45, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, 18, 18);
  });
  art.spark = paint(12, 4, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(0, 0.5, 12, 3, 1.5); ctx.fill();
  });
  art.square = paint(6, 6, [0.5, 0.5], (ctx) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 6, 6); });
  art.splinter = paint(10, 4, [0.5, 0.5], (ctx) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 10, 4); });
  art.flash = paint(44, 30, [0.15, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 10, 15, 0, 18, [[0, '#ffffff'], [0.4, '#fff3b0'], [1, 'rgba(255,170,40,0)']]);
    ctx.beginPath();
    ctx.moveTo(4, 15); ctx.lineTo(16, 4); ctx.lineTo(18, 11); ctx.lineTo(44, 15); ctx.lineTo(18, 19); ctx.lineTo(16, 26); ctx.closePath();
    ctx.fill();
  });
  art.ring = paint(64, 64, [0.5, 0.5], (ctx) => {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ellipse(ctx, 32, 32, 28, 28); ctx.stroke();
  });
  art.scorch = paint(110, 70, [0.5, 0.5], (ctx) => {
    const rand = mulberry32(9);
    for (let i = 0; i < 14; i++) {
      const x = 55 + (rand() - 0.5) * 50, y = 35 + (rand() - 0.5) * 30, r = 12 + rand() * 18;
      ctx.fillStyle = radial(ctx, x, y, 0, r, [[0, 'rgba(20,15,10,0.45)'], [1, 'rgba(20,15,10,0)']]);
      ellipse(ctx, x, y, r, r * 0.7); ctx.fill();
    }
  });
  art.medkit = paint(30, 26, [0.5, 0.8], (ctx) => {
    ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.roundRect(2, 4, 26, 20, 4); ctx.fill();
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.fillRect(12, 8, 6, 13); ctx.fillRect(8.5, 11.5, 13, 6);
    ctx.fillStyle = '#64748b'; ctx.fillRect(11, 1, 8, 3);
  });
  art.ammo = paint(32, 26, [0.5, 0.8], (ctx) => {
    ctx.fillStyle = '#556b2f'; ctx.beginPath(); ctx.roundRect(2, 8, 28, 16, 3); ctx.fill();
    ctx.fillStyle = '#6b8e23'; ctx.fillRect(2, 8, 28, 4);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#d4a017'; ctx.fillRect(6 + i * 6, 1, 4, 9);
      ctx.fillStyle = '#b87333'; ctx.fillRect(6 + i * 6, 0, 4, 3);
    }
    ctx.fillStyle = '#fef3c7'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('AMMO', 6, 21);
  });
  art.cloud = paint(420, 300, [0.5, 0.5], (ctx) => {
    const rand = mulberry32(42);
    for (let i = 0; i < 16; i++) {
      const x = 210 + (rand() - 0.5) * 240, y = 150 + (rand() - 0.5) * 140, r = 60 + rand() * 60;
      ctx.fillStyle = radial(ctx, x, y, 0, r, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  art.vignette = paint(256, 256, [0, 0], (ctx) => {
    ctx.fillStyle = radial(ctx, 128, 128, 70, 182, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]);
    ctx.fillRect(0, 0, 256, 256);
  });
  art.waves = oceanTexture();
  return art;
}

// Tileable ocean pattern with soft swells and sparkles.
function oceanTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(S, S);
  for (let y = 0, p = 0; y < S; y++) for (let x = 0; x < S; x++, p += 4) {
    const u = x / S * TAU, v = y / S * TAU;
    const w = Math.sin(u * 2 + Math.sin(v * 3) * 1.2) * 0.5 + Math.sin(v * 4 + Math.sin(u * 2) * 1.5) * 0.35 + Math.sin((u + v) * 3) * 0.15;
    const crest = Math.max(0, w - 0.55) * 2.2;
    img.data[p] = 255; img.data[p + 1] = 255; img.data[p + 2] = 255;
    img.data[p + 3] = Math.min(255, crest * 160 + (w + 1) * 18);
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}
