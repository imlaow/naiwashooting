// Painted textures for the factory map, built the first time a factory is played.
import { Texture, CanvasSource } from 'pixi.js';
import { paint } from './art.js';
import { mulberry32 } from './noise.js';

const TAU = Math.PI * 2;
const ellipse = (ctx, x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); };
const linear = (ctx, x0, y0, x1, y1, stops) => {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
};
// Brushed-steel shading across a cylinder or column.
const METAL = [[0, '#7c868d'], [0.22, '#e9eef1'], [0.45, '#c3cbd0'], [0.8, '#8c969d'], [1, '#5d666c']];

function stripes(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#f2c230'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#26241f';
  for (let s = -h; s < w + h; s += 16) {
    ctx.beginPath(); ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + h, y); ctx.lineTo(x + s + h + 8, y); ctx.lineTo(x + s + 8, y + h); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// A milk silo: a steel cylinder with a dome, a ladder and a painted label.
function silo(variant) {
  const W = 190, Hh = 330;
  return paint(W, Hh, [0.5, (Hh - 4) / Hh], (ctx) => {
    const cx = W / 2, base = Hh - 34, top = 80;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, cx + 16, base + 8, 88, 30); ctx.fill();
    // legs/skirt
    ctx.fillStyle = '#6b7378'; ctx.fillRect(cx - 78, base - 30, 156, 34);
    ctx.fillStyle = '#4a5156'; ellipse(ctx, cx, base + 4, 78, 26); ctx.fill();
    // body
    ctx.fillStyle = linear(ctx, cx - 80, 0, cx + 80, 0, METAL);
    ctx.fillRect(cx - 80, top, 160, base - 30 - top);
    ctx.beginPath(); ctx.ellipse(cx, base - 30, 80, 26, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(60,70,76,0.45)'; ctx.lineWidth = 2;
    for (let y = top + 40; y < base - 40; y += 46) { ctx.beginPath(); ctx.ellipse(cx, y, 80, 26, 0, 0, Math.PI); ctx.stroke(); }
    // dome
    ctx.fillStyle = linear(ctx, cx - 80, 0, cx + 80, 0, [[0, '#9aa4ab'], [0.3, '#ffffff'], [1, '#7d878e']]);
    ctx.beginPath(); ctx.ellipse(cx, top, 80, 50, 0, Math.PI, 0); ctx.ellipse(cx, top, 80, 26, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#596268'; ctx.fillRect(cx - 10, top - 58, 20, 14);
    ctx.fillStyle = '#6f797f'; ellipse(ctx, cx, top - 58, 10, 4); ctx.fill();
    // label
    const label = ['#2b6cb0', '#e53e3e', '#2b6cb0', '#d69e2e'][variant % 4];
    ctx.fillStyle = label; ctx.beginPath(); ctx.roundRect(cx - 54, top + 70, 108, 54, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 30px "Lilita One", "Arial Black", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(variant % 2 ? 'EGG' : 'MILK', cx, top + 108);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '900 13px "Arial Black", sans-serif';
    ctx.fillText(`T-0${variant + 1}`, cx, top + 150);
    // ladder
    ctx.strokeStyle = '#3d4449'; ctx.lineWidth = 3;
    const lx = cx + 46;
    ctx.beginPath(); ctx.moveTo(lx, top - 8); ctx.lineTo(lx, base - 10); ctx.moveTo(lx + 16, top - 4); ctx.lineTo(lx + 16, base - 8); ctx.stroke();
    ctx.lineWidth = 2;
    for (let y = top; y < base - 12; y += 12) { ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + 16, y + 1); ctx.stroke(); }
  });
}

// The water tower: the factory's lookout.
function waterTower() {
  const W = 180, Hh = 360;
  return paint(W, Hh, [0.5, (Hh - 8) / Hh], (ctx) => {
    const cx = W / 2, base = Hh - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, cx + 10, base - 6, 76, 18); ctx.fill();
    ctx.strokeStyle = '#7a2e12'; ctx.lineWidth = 7;
    const legs = [[cx - 62, base - 4, cx - 44, 140], [cx + 62, base - 4, cx + 44, 140], [cx - 26, base - 18, cx - 18, 140], [cx + 26, base - 18, cx + 18, 140]];
    for (const [x0, y0, x1, y1] of legs) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeStyle = '#9c3d17';
    for (const [ya, yb] of [[base - 10, 250], [250, 150]]) {
      const wa = 62 - (base - ya) * 0.08, wb = 62 - (base - yb) * 0.09;
      ctx.beginPath(); ctx.moveTo(cx - wa, ya); ctx.lineTo(cx + wb, yb); ctx.moveTo(cx + wa, ya); ctx.lineTo(cx - wb, yb); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - 56, 250); ctx.lineTo(cx + 56, 250); ctx.stroke();
    // tank
    ctx.fillStyle = linear(ctx, cx - 70, 0, cx + 70, 0, [[0, '#9c3d17'], [0.3, '#f97316'], [0.6, '#dd5d14'], [1, '#7a2e12']]);
    ctx.fillRect(cx - 70, 70, 140, 76);
    ctx.beginPath(); ctx.ellipse(cx, 146, 70, 20, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 24px "Lilita One", "Arial Black", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('NAIWA', cx, 120);
    // catwalk
    ctx.fillStyle = '#3d3b37'; ctx.fillRect(cx - 80, 142, 160, 6);
    ctx.fillStyle = '#5b5852';
    for (let x = cx - 78; x <= cx + 76; x += 13) ctx.fillRect(x, 126, 3, 18);
    ctx.fillRect(cx - 80, 124, 160, 3);
    // roof
    ctx.fillStyle = linear(ctx, cx - 76, 0, cx + 76, 0, [[0, '#6b6b6b'], [0.35, '#b9b9b9'], [1, '#5a5a5a']]);
    ctx.beginPath(); ctx.moveTo(cx - 78, 74); ctx.lineTo(cx, 22); ctx.lineTo(cx + 78, 74); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#444'; ctx.fillRect(cx - 2, 8, 4, 16);
    ctx.fillStyle = '#ef4444'; ellipse(ctx, cx, 8, 5, 5); ctx.fill();
  });
}

// A tapering brick chimney with warning bands.
function chimney() {
  const W = 120, Hh = 440;
  return paint(W, Hh, [0.5, (Hh - 10) / Hh], (ctx) => {
    const cx = W / 2, base = Hh - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, cx + 14, base + 8, 56, 16); ctx.fill();
    ctx.fillStyle = '#6b6b6b'; ctx.fillRect(cx - 52, base - 30, 104, 40);
    ctx.fillStyle = '#555'; ellipse(ctx, cx, base + 10, 52, 12); ctx.fill();
    const body = new Path2D();
    body.moveTo(cx - 44, base - 26); body.lineTo(cx - 26, 30); body.lineTo(cx + 26, 30); body.lineTo(cx + 44, base - 26); body.closePath();
    ctx.fillStyle = linear(ctx, cx - 44, 0, cx + 44, 0, [[0, '#6e2a1c'], [0.3, '#c0573a'], [0.65, '#a3442c'], [1, '#5a2216']]);
    ctx.fill(body);
    ctx.save(); ctx.clip(body);
    ctx.strokeStyle = 'rgba(60,20,10,0.35)'; ctx.lineWidth = 1;
    for (let y = 34, row = 0; y < base; y += 9, row++) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      for (let x = (row % 2) * 9; x < W; x += 18) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 9); ctx.stroke(); }
    }
    for (const y of [40, 74]) { ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, y, W, 16); ctx.fillStyle = '#e53e3e'; ctx.fillRect(0, y + 16, W, 16); }
    ctx.restore();
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(cx - 30, 22, 60, 10);
    ctx.fillStyle = '#1a1a1a'; ellipse(ctx, cx, 24, 26, 6); ctx.fill();
  });
}

// A packing machine that straddles a belt: a yellow box with a window, gauges and a lamp.
function machine(variant) {
  const W = 180, Hh = 190;
  return paint(W, Hh, [0.5, (Hh - 6) / Hh], (ctx) => {
    const x0 = 12, x1 = W - 12, base = Hh - 6, frontTop = 70, roofTop = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 8, base - 8, x1 - x0, 12);
    // roof
    ctx.fillStyle = variant ? '#e2b52a' : '#9fb4c2';
    ctx.fillRect(x0, roofTop, x1 - x0, frontTop - roofTop);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x0, roofTop, x1 - x0, 5);
    ctx.fillStyle = '#4b5056'; ctx.fillRect(x0 + 20, roofTop + 12, 50, 24);
    ctx.fillStyle = '#3a3f44';
    for (let x = x0 + 24; x < x0 + 68; x += 8) ctx.fillRect(x, roofTop + 15, 4, 18);
    ctx.fillStyle = '#6b7378'; ctx.fillRect(x1 - 52, roofTop + 8, 30, 30);
    // front
    ctx.fillStyle = linear(ctx, 0, frontTop, 0, base, variant ? [[0, '#f2c230'], [1, '#b8891a']] : [[0, '#c8d6df'], [1, '#7f939f']]);
    ctx.fillRect(x0, frontTop, x1 - x0, base - frontTop);
    // the belt passes through an opening at the bottom
    ctx.fillStyle = '#16181a'; ctx.fillRect(x0 + 18, base - 58, x1 - x0 - 36, 56);
    ctx.fillStyle = '#2b2d30'; ctx.fillRect(x0 + 18, base - 30, x1 - x0 - 36, 28);
    ctx.fillStyle = 'rgba(255,200,80,0.25)'; ctx.fillRect(x0 + 18, base - 58, x1 - x0 - 36, 6);
    // window and gauges
    ctx.fillStyle = '#20313b'; ctx.fillRect(x0 + 14, frontTop + 12, 70, 40);
    ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(x0 + 16, frontTop + 14, 66, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.moveTo(x0 + 20, frontTop + 48); ctx.lineTo(x0 + 40, frontTop + 14); ctx.lineTo(x0 + 50, frontTop + 14); ctx.lineTo(x0 + 30, frontTop + 48); ctx.fill();
    for (const [gx, col] of [[x1 - 64, '#4ade80'], [x1 - 34, '#f87171']]) {
      ctx.fillStyle = '#e5e7eb'; ellipse(ctx, gx, frontTop + 26, 11, 11); ctx.fill();
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(gx, frontTop + 26); ctx.lineTo(gx + 6, frontTop + 20); ctx.stroke();
    }
    stripes(ctx, x0, base - 66, x1 - x0, 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x0, roofTop, x1 - x0, base - roofTop);
    // lamp post
    ctx.fillStyle = '#374151'; ctx.fillRect(x1 - 20, 4, 5, roofTop);
    ctx.fillStyle = '#fbbf24'; ellipse(ctx, x1 - 17.5, 6, 6, 6); ctx.fill();
  });
}

// A steel column with a base plate and a hazard collar.
function pillar() {
  return paint(44, 170, [0.5, 162 / 170], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 26, 162, 22, 7); ctx.fill();
    ctx.fillStyle = '#4b5056'; ctx.fillRect(4, 150, 36, 14);
    ctx.fillStyle = linear(ctx, 10, 0, 34, 0, [[0, '#3b4146'], [0.4, '#8c969d'], [1, '#3b4146']]);
    ctx.fillRect(10, 0, 24, 152);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(20, 0, 4, 152);
    stripes(ctx, 10, 110, 24, 30);
    ctx.fillStyle = '#6b7378';
    for (const y of [150, 156]) { ctx.fillRect(7, y, 3, 3); ctx.fillRect(34, y, 3, 3); }
  });
}

// A shipping container in 3/4 view: lid on top, corrugated side facing the camera.
function container(variant) {
  const W = 256, Hh = 140, depth = 58, wallH = 76;
  const cols = [['#c2410c', '#e8742f'], ['#1d4ed8', '#3b82f6'], ['#15803d', '#22c55e'], ['#b91c1c', '#ef4444']][variant % 4];
  return paint(W, Hh, [0.5, (Hh - 4) / Hh], (ctx) => {
    const x0 = 6, x1 = W - 6, base = Hh - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 10, base - 6, x1 - x0, 10);
    ctx.fillStyle = cols[1]; ctx.fillRect(x0, base - wallH - depth, x1 - x0, depth);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    for (let x = x0 + 16; x < x1; x += 22) { ctx.beginPath(); ctx.moveTo(x, base - wallH - depth + 4); ctx.lineTo(x, base - wallH - 4); ctx.stroke(); }
    ctx.fillStyle = cols[0]; ctx.fillRect(x0, base - wallH, x1 - x0, wallH);
    for (let x = x0 + 6; x < x1 - 4; x += 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, base - wallH + 4, 4, wallH - 8);
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x + 5, base - wallH + 4, 3, wallH - 8);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
    ctx.strokeRect(x0, base - wallH - depth, x1 - x0, wallH + depth);
    ctx.beginPath(); ctx.moveTo(x0, base - wallH); ctx.lineTo(x1, base - wallH); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '900 18px "Arial Black", sans-serif';
    ctx.fillText(`NWA ${400 + variant * 37}`, x0 + 18, base - 44);
  });
}

// A box lorry seen from the side, cab on the left.
function truck() {
  const W = 320, Hh = 190;
  return paint(W, Hh, [0.5, (Hh - 6) / Hh], (ctx) => {
    const base = Hh - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(16, base - 10, 300, 14);
    // trailer box: roof then side
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(96, 18, 216, 58);
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(96, 70, 216, 6);
    ctx.fillStyle = linear(ctx, 0, 76, 0, base - 30, [[0, '#f8fafc'], [1, '#cbd5e1']]);
    ctx.fillRect(96, 76, 216, base - 30 - 76);
    ctx.fillStyle = '#f2c230'; ctx.beginPath(); ctx.ellipse(160, 112, 22, 28, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff7d6'; ctx.beginPath(); ctx.arc(160, 118, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1e3a8a'; ctx.font = '900 26px "Lilita One", "Arial Black", sans-serif';
    ctx.fillText('NAIWA', 192, 112);
    ctx.font = '900 10px "Arial Black", sans-serif'; ctx.fillText('FRESH MILK & EGGS', 192, 132);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(96, 18, 216, base - 48);
    // chassis
    ctx.fillStyle = '#26282b'; ctx.fillRect(14, base - 32, 298, 12);
    // cab
    ctx.fillStyle = '#2563eb'; ctx.fillRect(18, 56, 76, 16);
    ctx.fillStyle = linear(ctx, 0, 72, 0, base - 30, [[0, '#3b82f6'], [1, '#1e40af']]);
    ctx.beginPath(); ctx.moveTo(18, 72); ctx.lineTo(94, 72); ctx.lineTo(94, base - 30); ctx.lineTo(12, base - 30); ctx.lineTo(12, 110); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(24, 80); ctx.lineTo(70, 80); ctx.lineTo(70, 112); ctx.lineTo(18, 112); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(28, 84, 14, 24);
    ctx.fillStyle = '#fde68a'; ctx.fillRect(10, base - 52, 8, 10);
    // wheels
    for (const x of [48, 214, 270]) {
      ctx.fillStyle = '#111'; ellipse(ctx, x, base - 18, 20, 20); ctx.fill();
      ctx.fillStyle = '#9ca3af'; ellipse(ctx, x, base - 18, 8, 8); ctx.fill();
    }
  });
}

// Egg cartons stacked on a pallet and wrapped in film.
function pallet() {
  return paint(76, 92, [0.5, 86 / 92], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 42, 84, 34, 8); ctx.fill();
    ctx.fillStyle = '#9a6b3f'; ctx.fillRect(6, 72, 64, 12);
    ctx.fillStyle = '#5b3a21'; for (const x of [8, 34, 60]) ctx.fillRect(x, 78, 8, 6);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 8 + col * 31, y = 50 - row * 20;
        ctx.fillStyle = '#e9d8b4'; ctx.fillRect(x, y, 29, 22);
        ctx.fillStyle = '#d2bb8c'; ctx.fillRect(x, y, 29, 5);
        ctx.fillStyle = '#f2c230'; ellipse(ctx, x + 14.5, y + 13, 5, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(120,90,50,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 29, 22);
      }
    }
    ctx.fillStyle = '#e9d8b4'; ctx.fillRect(8, 2, 60, 10);
    ctx.fillStyle = 'rgba(220,240,255,0.22)'; ctx.fillRect(6, 0, 64, 74);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(10, 66); ctx.lineTo(60, 6); ctx.moveTo(30, 70); ctx.lineTo(68, 26); ctx.stroke();
  });
}

function forklift() {
  return paint(110, 110, [0.5, 104 / 110], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 58, 100, 46, 9); ctx.fill();
    // mast and forks
    ctx.fillStyle = '#374151'; ctx.fillRect(84, 14, 6, 84); ctx.fillRect(96, 14, 6, 84);
    ctx.fillStyle = '#6b7280'; ctx.fillRect(84, 88, 26, 6);
    // body
    ctx.fillStyle = '#f2c230'; ctx.fillRect(12, 56, 72, 34);
    ctx.fillStyle = '#d69e2e'; ctx.fillRect(12, 50, 72, 8);
    ctx.fillStyle = '#26241f'; ctx.fillRect(8, 60, 10, 26);
    // cage
    ctx.strokeStyle = '#26241f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(30, 52); ctx.lineTo(34, 10); ctx.lineTo(78, 10); ctx.lineTo(80, 52); ctx.stroke();
    ctx.fillStyle = '#1f2937'; ctx.fillRect(44, 34, 20, 18);
    for (const x of [30, 72]) {
      ctx.fillStyle = '#111'; ellipse(ctx, x, 92, 12, 12); ctx.fill();
      ctx.fillStyle = '#6b7280'; ellipse(ctx, x, 92, 4, 4); ctx.fill();
    }
  });
}

// A carton riding the conveyor belt.
function carton(variant) {
  return paint(30, 30, [0.5, 0.9], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(4, 22, 24, 6);
    if (variant === 0) {
      ctx.fillStyle = '#e9d8b4'; ctx.fillRect(3, 8, 24, 18);
      ctx.fillStyle = '#d2bb8c'; ctx.fillRect(3, 4, 24, 6);
      ctx.fillStyle = '#f2c230'; ellipse(ctx, 15, 17, 4, 5); ctx.fill();
    } else {
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(7, 8, 16, 18);
      ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(7, 8); ctx.lineTo(15, 1); ctx.lineTo(23, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(7, 14, 16, 6);
    }
  });
}

// A traffic cone.
function cone() {
  return paint(26, 32, [0.5, 0.9], (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ellipse(ctx, 15, 28, 11, 4); ctx.fill();
    ctx.fillStyle = '#ea580c'; ctx.fillRect(3, 24, 20, 5);
    ctx.beginPath(); ctx.moveTo(6, 25); ctx.lineTo(11, 2); ctx.lineTo(15, 2); ctx.lineTo(20, 25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(8, 12, 10, 4);
  });
}

// A building as a block in 3/4 view: roof on top, front wall of height H facing the camera.
// style 'warehouse' has corrugated walls and roller doors; 'boiler' is brick with a furnace mouth.
export function building(w, d, H, style) {
  const rand = mulberry32(w * 7 + d);
  return paint(w + 24, d + H + 8, [12 / (w + 24), (d + H) / (d + H + 8)], (ctx) => {
    const x0 = 12, x1 = 12 + w, roof0 = 0, roof1 = d, base = d + H;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x0 + 14, base - 8, w, 14);
    // front wall
    if (style === 'warehouse') {
      ctx.fillStyle = linear(ctx, 0, roof1, 0, base, [[0, '#7c97b0'], [1, '#4f6b84']]);
      ctx.fillRect(x0, roof1, w, H);
      for (let x = x0; x < x1; x += 12) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, roof1, 5, H);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 6, roof1, 3, H);
      }
      for (const dx of [0.12, 0.56]) {
        const dw = w * 0.32, dxp = x0 + w * dx;
        ctx.fillStyle = '#4b5563'; ctx.fillRect(dxp, roof1 + H * 0.3, dw, H * 0.7);
        ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
        for (let y = roof1 + H * 0.3 + 6; y < base; y += 8) { ctx.beginPath(); ctx.moveTo(dxp, y); ctx.lineTo(dxp + dw, y); ctx.stroke(); }
        stripes(ctx, dxp - 6, roof1 + H * 0.3 - 8, dw + 12, 8);
      }
    } else {
      ctx.fillStyle = linear(ctx, 0, roof1, 0, base, [[0, '#b65a3c'], [1, '#7e3522']]);
      ctx.fillRect(x0, roof1, w, H);
      ctx.strokeStyle = 'rgba(60,20,10,0.35)'; ctx.lineWidth = 1;
      for (let y = roof1, row = 0; y < base; y += 10, row++) {
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        for (let x = x0 + (row % 2) * 12; x < x1; x += 24) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 10); ctx.stroke(); }
      }
      // furnace mouth (lit by a glow sprite in the scene)
      const fx = x0 + w / 2 - 50;
      ctx.fillStyle = '#2a1a12'; ctx.beginPath(); ctx.roundRect(fx, roof1 + H * 0.35, 100, H * 0.65, [40, 40, 0, 0]); ctx.fill();
      const g = ctx.createRadialGradient(fx + 50, base - 10, 4, fx + 50, base - 10, 70);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.35, '#ff9a2e'); g.addColorStop(1, 'rgba(120,30,10,0.2)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(fx + 8, roof1 + H * 0.35 + 10, 84, H * 0.65 - 10, [34, 34, 0, 0]); ctx.fill();
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 4;
      for (let x = fx + 20; x < fx + 96; x += 16) { ctx.beginPath(); ctx.moveTo(x, roof1 + H * 0.4); ctx.lineTo(x, base); ctx.stroke(); }
      for (const wx of [x0 + 24, x1 - 64]) {
        ctx.fillStyle = '#1e140c'; ctx.fillRect(wx, roof1 + 24, 40, 30);
        ctx.fillStyle = 'rgba(255,170,60,0.45)'; ctx.fillRect(wx + 3, roof1 + 27, 34, 24);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.strokeRect(x0, roof1, w, H);
    // roof
    ctx.fillStyle = style === 'warehouse' ? '#9aa3aa' : '#6b6560';
    ctx.fillRect(x0, roof0, w, d);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
    for (let x = x0 + 10; x < x1; x += 14) { ctx.beginPath(); ctx.moveTo(x, roof0); ctx.lineTo(x, roof1); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x0, roof0, w, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0, roof1 - 6, w, 6);
    if (style === 'warehouse') {
      for (let y = roof0 + 50; y < roof1 - 40; y += 110) {
        ctx.fillStyle = 'rgba(180,220,240,0.75)'; ctx.fillRect(x0 + w * 0.3, y, w * 0.4, 40);
        ctx.strokeStyle = '#4b5563'; ctx.strokeRect(x0 + w * 0.3, y, w * 0.4, 40);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const vx = x0 + 40 + rand() * (w - 100), vy = roof0 + 30 + rand() * (d - 90);
        ctx.fillStyle = '#4b5056'; ctx.fillRect(vx, vy, 44, 34);
        ctx.fillStyle = '#2b2d30'; ellipse(ctx, vx + 22, vy + 17, 13, 13); ctx.fill();
        ctx.strokeStyle = '#6b7378'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(vx + 9, vy + 17); ctx.lineTo(vx + 35, vy + 17); ctx.moveTo(vx + 22, vy + 4); ctx.lineTo(vx + 22, vy + 30); ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3; ctx.strokeRect(x0, roof0, w, d);
  });
}

// A strip of conveyor belt that tiles horizontally.
function beltTile() {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 56;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#3a3d42'; ctx.fillRect(0, 0, 64, 56);
  ctx.fillStyle = '#2a2c30';
  for (let x = 0; x < 64; x += 16) ctx.fillRect(x, 4, 7, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 0; x < 64; x += 16) ctx.fillRect(x + 7, 4, 2, 48);
  ctx.fillStyle = '#5b6068'; ctx.fillRect(0, 0, 64, 4); ctx.fillRect(0, 52, 64, 4);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

// Mown grass for outside the fence.
function grassTile() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#5f9a45'; ctx.fillRect(0, 0, S, S);
  const rand = mulberry32(5);
  for (let i = 0; i < 900; i++) {
    const x = rand() * S, y = rand() * S;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(40,90,30,0.5)' : 'rgba(150,200,90,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 4, y - 4 - rand() * 6); ctx.stroke();
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

let cached = null;
export function factoryArt() {
  if (cached) return cached;
  cached = {
    silos: [0, 1, 2, 3].map(silo),
    tower: waterTower(),
    chimney: chimney(),
    machines: [0, 1].map(machine),
    pillar: pillar(),
    containers: [0, 1, 2, 3].map(container),
    truck: truck(),
    pallet: pallet(),
    forklift: forklift(),
    cartons: [0, 1].map(carton),
    cone: cone(),
    belt: beltTile(),
    grass: grassTile(),
  };
  return cached;
}
