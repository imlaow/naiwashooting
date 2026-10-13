// Procedurally painted textures (canvas 2D -> Pixi textures).
//
// The look is the "milk & egg" world of the hero sprites in public/assets: everything that was a
// plant, rock or building is now an egg, a belly, a frog leg or a pair of bunny ears. Texture
// sizes and anchors are unchanged so the colliders in world.js still fit.
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

// ---------- The palette of the milk & egg world ----------
export const C = {
  skin: '#f9c72c', skinDark: '#d99a12', skinLight: '#ffe266',
  belly: '#f4dfb3', bellyDark: '#d9bc84',
  shell: '#fbf3e4', shellDark: '#d8c9ae', shellLine: '#b9a583',
  yolk: '#ffb300', yolkDark: '#f08a00',
  pink: '#ff7eb3', pinkDark: '#e0438a', pinkLight: '#ffc4dd',
  iris: '#3f8f3a', pupil: '#101010', tongue: '#ff2e63',
  milk: '#fff3d6',
};

// ---------- Shape helpers ----------
// An egg: wider at the bottom. (x, y) is the centre, rx/ry the half extents.
function eggPath(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.bezierCurveTo(x + rx * 0.75, y - ry, x + rx, y - ry * 0.1, x + rx, y + ry * 0.2);
  ctx.bezierCurveTo(x + rx, y + ry * 0.75, x + rx * 0.55, y + ry, x, y + ry);
  ctx.bezierCurveTo(x - rx * 0.55, y + ry, x - rx, y + ry * 0.75, x - rx, y + ry * 0.2);
  ctx.bezierCurveTo(x - rx, y - ry * 0.1, x - rx * 0.75, y - ry, x, y - ry);
  ctx.closePath();
}

function shadedEgg(ctx, x, y, rx, ry, base = C.shell, dark = C.shellDark) {
  ctx.fillStyle = radial(ctx, x - rx * 0.35, y - ry * 0.35, rx * 0.1, Math.max(rx, ry) * 1.3, [[0, '#ffffff'], [0.3, base], [1, dark]]);
  eggPath(ctx, x, y, rx, ry); ctx.fill();
}

// The egg's face from public/assets/egg.png: two green eyes and a flat little mouth.
function face(ctx, x, y, s, mood = 'blank') {
  for (const side of [-1, 1]) {
    const ex = x + side * s * 0.55, ey = y;
    ctx.fillStyle = '#ffffff'; ellipse(ctx, ex, ey, s * 0.3, s * 0.32); ctx.fill();
    ctx.fillStyle = C.iris; ellipse(ctx, ex, ey + s * 0.02, s * 0.21, s * 0.23); ctx.fill();
    ctx.fillStyle = C.pupil; ellipse(ctx, ex, ey + s * 0.03, s * 0.11, s * 0.12); ctx.fill();
    ctx.fillStyle = '#ffffff'; ellipse(ctx, ex - s * 0.07, ey - s * 0.09, s * 0.05, s * 0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = s * 0.05; ellipse(ctx, ex, ey, s * 0.3, s * 0.32); ctx.stroke();
  }
  ctx.strokeStyle = '#7a4a10'; ctx.lineWidth = Math.max(1, s * 0.07); ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'grin') { ctx.arc(x, y + s * 0.35, s * 0.35, 0.15, Math.PI - 0.15); }
  else if (mood === 'o') { ctx.ellipse(x, y + s * 0.5, s * 0.14, s * 0.2, 0, 0, TAU); }
  else { ctx.moveTo(x - s * 0.22, y + s * 0.48); ctx.quadraticCurveTo(x, y + s * 0.56, x + s * 0.22, y + s * 0.48); }
  ctx.stroke();
  if (mood === 'grin') { ctx.fillStyle = C.tongue; ellipse(ctx, x, y + s * 0.55, s * 0.16, s * 0.1); ctx.fill(); }
  ctx.lineCap = 'butt';
}

// A bunny ear from the gunner sprite: a long yellow leaf with a pink inside.
function ear(ctx, x, y, len, w, ang, outer = C.skin, inner = C.pink) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = outer;
  ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.quadraticCurveTo(-w * 0.7, -len * 0.6, 0, -len); ctx.quadraticCurveTo(w * 0.7, -len * 0.6, w / 2, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.skinDark; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = inner;
  ctx.beginPath(); ctx.moveTo(-w * 0.22, -len * 0.08); ctx.quadraticCurveTo(-w * 0.4, -len * 0.55, 0, -len * 0.85); ctx.quadraticCurveTo(w * 0.4, -len * 0.55, w * 0.22, -len * 0.08); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// A fat yellow frog leg with three toes, standing on (x, y) and reaching up to (x + lean, y - h).
function leg(ctx, x, y, h, lean, w) {
  ctx.fillStyle = linear(ctx, x - w, 0, x + w, 0, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 1.3 + lean * 0.3, y - h * 0.5, x + lean - w * 0.7, y - h);
  ctx.lineTo(x + lean + w * 0.7, y - h);
  ctx.quadraticCurveTo(x + w * 1.3 + lean * 0.3, y - h * 0.5, x + w, y);
  ctx.closePath(); ctx.fill();
  // knee
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ellipse(ctx, x + lean * 0.5, y - h * 0.5, w * 1.1, w * 0.6); ctx.fill();
  // toes
  ctx.fillStyle = C.skinDark;
  for (const t of [-1, 0, 1]) { ellipse(ctx, x + t * w * 0.9, y + 1, w * 0.45, w * 0.3); ctx.fill(); }
}

function groundShadow(ctx, x, y, rx, ry, a = 0.28) {
  ctx.fillStyle = `rgba(90,40,0,${a})`; ellipse(ctx, x, y, rx, ry); ctx.fill();
}

// ---------- "Vegetation" ----------
// Egg tree: a frog leg with an egg on top that has a face and sprouts a crown of bunny ears.
function palmTree(seed) {
  const rand = mulberry32(seed);
  return paint(240, 280, [0.5, 265 / 280], (ctx) => {
    const bx = 120, by = 265;
    const lean = (rand() - 0.5) * 70;
    const tx = bx + lean, ty = 118;
    groundShadow(ctx, bx + 6, by - 2, 34, 9);
    leg(ctx, bx, by, by - ty - 20, lean, 11);
    const n = 5 + (rand() * 3 | 0);
    const ears = [];
    for (let i = 0; i < n; i++) ears.push({ a: (i / n - 0.5) * 2.6 + (rand() - 0.5) * 0.3, L: 60 + rand() * 30 });
    ears.sort((p, q) => Math.abs(q.a) - Math.abs(p.a));
    for (const e of ears) ear(ctx, tx, ty - 30, e.L, 18, e.a, rand() < 0.3 ? C.skinLight : C.skin, rand() < 0.5 ? C.pink : C.pinkLight);
    shadedEgg(ctx, tx, ty, 40, 52);
    ctx.strokeStyle = C.shellLine; ctx.lineWidth = 1.5; eggPath(ctx, tx, ty, 40, 52); ctx.stroke();
    face(ctx, tx, ty - 4, 22, ['blank', 'grin', 'o'][seed % 3]);
  });
}

// Ear tree: a thick yellow trunk that ends in a huge pair of bunny ears.
function jungleTree(seed) {
  const rand = mulberry32(seed);
  const inner = [C.pink, C.pinkLight, C.tongue][seed % 3];
  return paint(210, 240, [0.5, 228 / 240], (ctx) => {
    const bx = 105, by = 228;
    groundShadow(ctx, bx + 4, by - 1, 40, 10, 0.3);
    // buttress toes flaring out along the ground
    ctx.fillStyle = C.skinDark;
    for (const s of [-1, -0.45, 0.4, 1]) {
      const tip = bx + s * (26 + rand() * 8);
      ctx.beginPath(); ctx.moveTo(bx + s * 6 - 6, by - 18); ctx.quadraticCurveTo(bx + s * 14, by - 6, tip, by + 1); ctx.quadraticCurveTo(bx + s * 12, by + 1, bx + s * 6 + 6, by - 4); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = linear(ctx, bx - 18, 0, bx + 18, 0, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
    ctx.beginPath();
    ctx.moveTo(bx - 17, by); ctx.quadraticCurveTo(bx - 9, by - 22, bx - 10, 120); ctx.lineTo(bx + 10, 120); ctx.quadraticCurveTo(bx + 9, by - 22, bx + 18, by); ctx.closePath(); ctx.fill();
    // belly stripe on the trunk
    ctx.fillStyle = C.belly; ellipse(ctx, bx, 175, 6, 30); ctx.fill();
    const spread = 0.28 + rand() * 0.2;
    ear(ctx, bx - 8, 126, 118 + rand() * 10, 44, -spread, C.skin, inner);
    ear(ctx, bx + 8, 126, 112 + rand() * 10, 44, spread, C.skinLight, inner);
    // a head between the ears
    shadedEgg(ctx, bx, 118, 24, 22, C.skin, C.skinDark);
    face(ctx, bx, 116, 11, seed % 2 ? 'blank' : 'grin');
  });
}

// A clutch of small eggs with faces.
function bush(seed) {
  const rand = mulberry32(seed);
  return paint(90, 66, [0.5, 0.9], (ctx) => {
    const cx = 45, cy = 44;
    groundShadow(ctx, cx + 3, cy + 14, 36, 8, 0.25);
    const eggs = [];
    for (let i = 0; i < 4 + (seed % 3); i++) eggs.push({ x: cx + (rand() - 0.5) * 50, y: cy + (rand() - 0.5) * 14, r: 9 + rand() * 6 });
    eggs.sort((a, b) => a.y - b.y);
    for (const e of eggs) {
      shadedEgg(ctx, e.x, e.y - e.r * 0.3, e.r, e.r * 1.25, rand() < 0.3 ? C.skinLight : C.shell, rand() < 0.3 ? C.skinDark : C.shellDark);
      if (rand() < 0.7) face(ctx, e.x, e.y - e.r * 0.35, e.r * 0.5, rand() < 0.5 ? 'blank' : 'o');
    }
  });
}

// A tuft of tiny ears.
function fern(seed) {
  const rand = mulberry32(seed);
  return paint(60, 48, [0.5, 0.95], (ctx) => {
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2 + (rand() - 0.5) * 0.2;
      ear(ctx, 30, 46, 22 + rand() * 16, 7, a, i % 2 ? C.skin : C.skinLight, rand() < 0.5 ? C.pink : C.pinkLight);
    }
  });
}

// Rocks are eggs: some cracked open with the yolk showing, some with a face.
function rock(seed, size) {
  const rand = mulberry32(seed);
  const w = size * 2.4, h = size * 1.9;
  return paint(w, h, [0.5, 0.86], (ctx) => {
    const cx = w / 2, cy = h * 0.5;
    const rx = size * 0.95, ry = size * 0.8;
    groundShadow(ctx, cx + size * 0.1, h * 0.86, rx * 1.05, ry * 0.3);
    const cracked = seed % 3 === 0;
    if (cracked) {
      // bottom half of the shell with the yolk sitting in it
      ctx.save();
      ctx.beginPath(); ctx.rect(0, cy - ry * 0.15, w, h); ctx.clip();
      shadedEgg(ctx, cx, cy, rx, ry);
      ctx.restore();
      ctx.fillStyle = C.shell;
      ctx.beginPath(); ctx.moveTo(cx - rx * 0.98, cy - ry * 0.1);
      for (let i = 0; i <= 8; i++) ctx.lineTo(cx - rx + (i / 8) * rx * 2, cy - ry * (0.1 + (i % 2 ? 0.32 : 0.05)));
      ctx.lineTo(cx + rx * 0.98, cy - ry * 0.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = radial(ctx, cx - rx * 0.2, cy - ry * 0.4, 1, rx * 0.5, [[0, '#ffd54f'], [1, C.yolkDark]]);
      ellipse(ctx, cx, cy - ry * 0.22, rx * 0.5, ry * 0.36); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ellipse(ctx, cx - rx * 0.18, cy - ry * 0.38, rx * 0.14, ry * 0.08); ctx.fill();
    } else {
      shadedEgg(ctx, cx, cy, rx, ry);
      ctx.strokeStyle = C.shellLine; ctx.lineWidth = 1.2;
      for (let i = 0; i < 2 + (seed % 2); i++) {
        let x = cx + (rand() - 0.5) * rx, y = cy + (rand() - 0.5) * ry * 0.6;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * size * 0.4; y += (rand() - 0.3) * size * 0.25; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      if (seed % 2) face(ctx, cx, cy - ry * 0.05, size * 0.42, 'blank');
      // speckles
      ctx.fillStyle = 'rgba(160,120,60,0.35)';
      for (let i = 0; i < 7; i++) { ellipse(ctx, cx + (rand() - 0.5) * rx * 1.5, cy + (rand() - 0.5) * ry * 1.4, 1.5, 1); ctx.fill(); }
    }
  });
}

// A frog leg lying on the beach, toes and all.
function driftwood(seed) {
  const rand = mulberry32(seed);
  return paint(110, 34, [0.5, 0.7], (ctx) => {
    groundShadow(ctx, 57, 26, 50, 7, 0.22);
    ctx.fillStyle = linear(ctx, 0, 6, 0, 26, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
    ctx.beginPath(); ctx.moveTo(10, 16); ctx.quadraticCurveTo(30, 4, 60, 9); ctx.quadraticCurveTo(85, 12, 100, 10); ctx.lineTo(100, 22); ctx.quadraticCurveTo(80, 26, 55, 24); ctx.quadraticCurveTo(28, 26, 10, 16); ctx.closePath(); ctx.fill();
    // thigh end
    ctx.fillStyle = C.belly; ellipse(ctx, 12, 16, 7, 9); ctx.fill();
    ctx.fillStyle = C.tongue; ellipse(ctx, 12, 16, 4, 6); ctx.fill();
    // toes
    ctx.fillStyle = C.skinDark;
    for (const [dx, dy] of [[9, -5], [11, 0], [9, 6]]) { ellipse(ctx, 100 + dx * 0.9, 16 + dy, 6, 3, Math.atan2(dy, dx * 0.9)); ctx.fill(); }
    ctx.strokeStyle = 'rgba(120,70,0,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const y = 10 + rand() * 12; ctx.beginPath(); ctx.moveTo(25 + rand() * 20, y); ctx.lineTo(55 + rand() * 35, y + (rand() - 0.5) * 3); ctx.stroke(); }
  });
}

// ---------- Props ----------
// A milk carton.
function crate() {
  return paint(52, 56, [0.5, 0.93], (ctx) => {
    groundShadow(ctx, 29, 51, 25, 6, 0.3);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(26, 4); ctx.lineTo(48, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e9e2d2'; ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(48, 16); ctx.lineTo(26, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 16, 0, 52, [[0, '#ffffff'], [1, '#e6ddc8']]);
    ctx.fillRect(4, 16, 44, 36);
    ctx.fillStyle = '#3b7dd8'; ctx.fillRect(4, 16, 44, 8); ctx.fillRect(4, 44, 44, 8);
    ctx.strokeStyle = '#8c8070'; ctx.lineWidth = 1.5; ctx.strokeRect(4, 16, 44, 36);
    ctx.fillStyle = C.pinkDark; ctx.font = 'bold 15px "ZCOOL KuaiLe", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('奶', 26, 38);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.yolk; ctx.fillRect(22, 5, 8, 4);
  });
}

// A bomb egg: black shell, red face, lit fuse.
function barrel() {
  return paint(38, 52, [0.5, 0.92], (ctx) => {
    groundShadow(ctx, 21, 47, 17, 5, 0.3);
    shadedEgg(ctx, 19, 28, 16, 20, '#3a3a3a', '#0d0d0d');
    ctx.strokeStyle = '#ff2e2e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 36); ctx.lineTo(28, 36); ctx.stroke();
    face(ctx, 19, 25, 8, 'o');
    ctx.fillStyle = '#ff2e2e'; ellipse(ctx, 19, 25 + 4, 1.4, 2.2); ctx.fill();
    // fuse
    ctx.strokeStyle = '#d7b98a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(19, 9); ctx.quadraticCurveTo(24, 2, 29, 5); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = radial(ctx, 29, 5, 0, 6, [[0, '#fff5b0'], [0.5, '#ffb300'], [1, 'rgba(255,80,0,0)']]);
    ellipse(ctx, 29, 5, 6, 6); ctx.fill();
  });
}

// A hut is a Naiwa belly: a yellow dome with the cream belly as the front wall, a door cut into it,
// and the face peeking over the top.
function hut(seed) {
  const rand = mulberry32(seed);
  return paint(240, 220, [0.5, 208 / 220], (ctx) => {
    groundShadow(ctx, 128, 205, 105, 14, 0.3);
    // the two feet sticking out
    ctx.fillStyle = C.skinDark;
    for (const x of [60, 180]) for (const t of [-1, 0, 1]) { ellipse(ctx, x + t * 14, 203, 9, 5); ctx.fill(); }
    // body
    ctx.fillStyle = radial(ctx, 90, 70, 10, 190, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
    eggPath(ctx, 120, 118, 104, 92); ctx.fill();
    // belly
    ctx.fillStyle = radial(ctx, 100, 120, 10, 110, [[0, '#fff3dc'], [0.6, C.belly], [1, C.bellyDark]]);
    ellipse(ctx, 120, 138, 76, 66); ctx.fill();
    // navel window
    ctx.fillStyle = '#4a2a10'; ellipse(ctx, 120, 112, 7, 5); ctx.fill();
    // door
    ctx.fillStyle = '#2a1a0e'; ctx.beginPath(); ctx.roundRect(100, 140, 40, 66, [20, 20, 0, 0]); ctx.fill();
    ctx.strokeStyle = C.pinkDark; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(100, 140, 40, 66, [20, 20, 0, 0]); ctx.stroke();
    ctx.fillStyle = C.yolk; ellipse(ctx, 132, 176, 3, 3); ctx.fill();
    // windows: two eyes on the belly
    for (const x of [62, 178]) {
      ctx.fillStyle = '#1e140c'; ellipse(ctx, x, 150, 14, 11); ctx.fill();
      ctx.fillStyle = 'rgba(255,190,90,0.5)'; ellipse(ctx, x, 150, 11, 8); ctx.fill();
      ctx.strokeStyle = C.pinkDark; ctx.lineWidth = 3; ellipse(ctx, x, 150, 14, 11); ctx.stroke();
    }
    // face up top
    face(ctx, 120, 56, 24, ['grin', 'blank', 'o'][seed % 3]);
    // arms hugging the belly
    ctx.strokeStyle = C.skinDark; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(30, 120); ctx.quadraticCurveTo(50, 170, 90, 165); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(210, 120); ctx.quadraticCurveTo(190, 170, 150, 165); ctx.stroke();
    ctx.strokeStyle = C.skin; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(30, 118); ctx.quadraticCurveTo(50, 166, 88, 162); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(210, 118); ctx.quadraticCurveTo(190, 166, 152, 162); ctx.stroke();
    ctx.lineCap = 'butt';
    // a few random ear sprouts on the roof
    for (let i = 0; i < 2 + (seed % 2); i++) ear(ctx, 120 + (rand() - 0.5) * 80, 36, 28 + rand() * 14, 12, (rand() - 0.5) * 1.2);
  });
}

// Half an eggshell floating on the milk, with the yolk for a seat.
function boat() {
  return paint(70, 170, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = 'rgba(200,140,0,0.3)'; ellipse(ctx, 40, 92, 30, 76); ctx.fill();
    const hull = (inset) => {
      ctx.beginPath();
      ctx.moveTo(35, 6 + inset);
      ctx.bezierCurveTo(62 - inset, 40, 62 - inset, 120, 50 - inset, 160 - inset);
      ctx.lineTo(20 + inset, 160 - inset);
      ctx.bezierCurveTo(8 + inset, 120, 8 + inset, 40, 35, 6 + inset);
      ctx.closePath();
    };
    ctx.fillStyle = C.shellDark; hull(0); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 0, 70, 0, [[0, '#ffffff'], [0.5, C.shell], [1, C.shellDark]]); hull(4); ctx.fill();
    // jagged broken rim
    ctx.fillStyle = C.shellDark;
    for (let i = 0; i < 9; i++) { const y = 14 + i * 16; ctx.beginPath(); ctx.moveTo(13 + (i % 2) * 2, y); ctx.lineTo(24, y + 5); ctx.lineTo(13 + (i % 2) * 2, y + 10); ctx.closePath(); ctx.fill(); }
    for (let i = 0; i < 9; i++) { const y = 20 + i * 16; ctx.beginPath(); ctx.moveTo(57 - (i % 2) * 2, y); ctx.lineTo(46, y + 5); ctx.lineTo(57 - (i % 2) * 2, y + 10); ctx.closePath(); ctx.fill(); }
    // inside: egg white with the yolk
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ellipse(ctx, 35, 86, 14, 52); ctx.fill();
    ctx.fillStyle = radial(ctx, 31, 82, 1, 16, [[0, '#ffd54f'], [1, C.yolkDark]]); ellipse(ctx, 35, 90, 13, 16); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(ctx, 30, 84, 4, 2.5); ctx.fill();
    // a paddle: a frog leg
    ctx.strokeStyle = C.skin; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(20, 120); ctx.lineTo(50, 146); ctx.stroke();
    ctx.fillStyle = C.skinDark; for (const t of [-1, 0, 1]) { ellipse(ctx, 52 + t * 1.5, 148 + t * 4, 4, 2.5); ctx.fill(); }
    ctx.lineCap = 'butt';
  });
}

// An egg on a stick with its top blown off: the flame emitter sits in the hole.
function tikiTorch() {
  return paint(26, 80, [0.5, 0.96], (ctx) => {
    groundShadow(ctx, 15, 76, 8, 3, 0.25);
    ctx.fillStyle = linear(ctx, 9, 0, 17, 0, [[0, C.skinLight], [1, C.skinDark]]);
    ctx.fillRect(10, 22, 6, 55);
    ctx.fillStyle = C.skinDark; for (const t of [-1, 0, 1]) { ellipse(ctx, 13 + t * 4, 77, 2.5, 1.5); ctx.fill(); }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 10, 26, 24); ctx.clip();
    shadedEgg(ctx, 13, 18, 10, 13);
    ctx.restore();
    ctx.fillStyle = '#2a1a0e'; ellipse(ctx, 13, 10, 8, 2.6); ctx.fill();
    face(ctx, 13, 19, 4.5, 'o');
  });
}

// Three eggs stacked up, the top one wearing ears, with a belly-skin platform between.
function tower() {
  return paint(150, 250, [0.5, 240 / 250], (ctx) => {
    groundShadow(ctx, 80, 238, 62, 12, 0.3);
    shadedEgg(ctx, 75, 192, 54, 50);
    shadedEgg(ctx, 75, 118, 44, 42);
    face(ctx, 75, 196, 20, 'blank');
    face(ctx, 75, 120, 16, 'grin');
    // platform
    ctx.fillStyle = C.belly; ctx.beginPath(); ctx.roundRect(20, 86, 110, 16, 8); ctx.fill();
    ctx.fillStyle = C.bellyDark; ctx.fillRect(20, 98, 110, 4);
    // rails: small ears
    for (let x = 24; x <= 126; x += 17) ear(ctx, x, 88, 26, 7, 0, C.skin, C.pinkLight);
    shadedEgg(ctx, 75, 54, 30, 34, C.skin, C.skinDark);
    face(ctx, 75, 54, 13, 'o');
    ear(ctx, 62, 26, 34, 14, -0.35);
    ear(ctx, 88, 26, 34, 14, 0.35, C.skinLight);
  });
}

// A floppy pink ear for a flag.
function flag() {
  return paint(40, 24, [0, 0.5], (ctx) => {
    ctx.fillStyle = C.pink;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(20, -4, 40, 8); ctx.quadraticCurveTo(28, 14, 40, 20); ctx.quadraticCurveTo(20, 24, 0, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.tongue; ctx.beginPath(); ctx.moveTo(6, 8); ctx.quadraticCurveTo(20, 2, 32, 10); ctx.quadraticCurveTo(20, 16, 6, 16); ctx.closePath(); ctx.fill();
  });
}

// ---------- Creatures ----------
// A flying egg with bunny ears for wings.
function seagull(phase) {
  return paint(48, 26, [0.5, 0.5], (ctx) => {
    const up = phase === 0;
    for (const side of [-1, 1]) ear(ctx, 24 + side * 6, 14, 20, 9, side * (up ? 1.25 : 1.75), C.skin, C.pink);
    shadedEgg(ctx, 24, 14, 7, 9);
    face(ctx, 24, 13, 3.4, 'o');
  });
}

// A pair of ears flapping like wings.
function butterfly(phase, color) {
  return paint(16, 12, [0.5, 0.5], (ctx) => {
    const spread = phase ? 0.4 : 1.3;
    ear(ctx, 7, 10, 9, 4, -spread, color, C.pinkLight);
    ear(ctx, 9, 10, 9, 4, spread, color, C.pinkLight);
    ctx.fillStyle = '#ffffff'; ellipse(ctx, 8, 9, 2, 2.4); ctx.fill();
    ctx.fillStyle = C.iris; ellipse(ctx, 8, 9, 1, 1.2); ctx.fill();
  });
}

// ---------- Weapons & FX ----------
// Toy guns: yellow plastic with pink grips.
function gun(kind) {
  const specs = {
    pistol: [36, 18], smg: [50, 22], shotgun: [64, 18], rifle: [76, 18],
  };
  const [w, h] = specs[kind];
  return paint(w, h, [10 / w, 0.45], (ctx) => {
    const body = linear(ctx, 0, 0, 0, h, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
    const grip = C.pinkDark;
    ctx.fillStyle = body;
    if (kind === 'pistol') {
      ctx.fillRect(4, 3, 30, 7);
      ctx.fillStyle = grip; ctx.fillRect(5, 9, 8, 9);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(4, 3, 30, 1.5);
    } else if (kind === 'smg') {
      ctx.fillRect(4, 4, 40, 8);
      ctx.fillRect(44, 6, 6, 3);
      ctx.fillStyle = C.shell; ctx.fillRect(22, 12, 6, 10);
      ctx.fillStyle = grip; ctx.fillRect(6, 11, 8, 9);
      ctx.fillStyle = C.skinDark; ctx.fillRect(0, 5, 6, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(4, 4, 40, 1.5);
    } else if (kind === 'shotgun') {
      ctx.fillStyle = grip; ctx.fillRect(0, 6, 18, 9);
      ctx.fillStyle = body; ctx.fillRect(16, 4, 46, 6);
      ctx.fillStyle = C.pink; ctx.fillRect(30, 9, 18, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(16, 4, 46, 1.5);
    } else {
      ctx.fillStyle = grip; ctx.fillRect(0, 5, 26, 9);
      ctx.fillStyle = body; ctx.fillRect(24, 5, 50, 5);
      ctx.fillStyle = C.shell; ctx.fillRect(30, 0, 18, 5);
      ctx.fillStyle = C.iris; ctx.fillRect(46, 1, 2, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(24, 5, 50, 1.2);
    }
    // a googly eye on every gun
    ctx.fillStyle = '#ffffff'; ellipse(ctx, w * 0.55, h * 0.4, 3, 3); ctx.fill();
    ctx.fillStyle = C.pupil; ellipse(ctx, w * 0.55 + 1, h * 0.4, 1.4, 1.4); ctx.fill();
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
  art.gull = [seagull(0), seagull(1)];
  art.butterflies = [C.skin, C.skinLight, C.shell, C.pink].map((c) => [butterfly(0, c), butterfly(1, c)]);
  art.guns = { pistol: gun('pistol'), smg: gun('smg'), shotgun: gun('shotgun'), rifle: gun('rifle') };

  art.shadow = paint(64, 24, [0.5, 0.5], (ctx) => {
    ctx.save();
    ctx.scale(1, 24 / 64);
    ctx.fillStyle = radial(ctx, 32, 32, 0, 32, [[0, 'rgba(90,40,0,0.5)'], [0.6, 'rgba(90,40,0,0.3)'], [1, 'rgba(90,40,0,0)']]);
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
  // Bullets are yolk drops.
  art.bullet = paint(26, 10, [0.75, 0.5], (ctx) => {
    ctx.fillStyle = linear(ctx, 0, 0, 26, 0, [[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,1)']]);
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.quadraticCurveTo(14, 0, 22, 2); ctx.arc(22, 5, 3.5, -Math.PI / 2, Math.PI / 2); ctx.quadraticCurveTo(14, 10, 0, 5); ctx.fill();
  });
  art.orb = paint(18, 18, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 9, 9, 0, 9, [[0, '#fff'], [0.45, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(0, 0, 18, 18);
  });
  art.spark = paint(12, 4, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(0, 0.5, 12, 3, 1.5); ctx.fill();
  });
  art.square = paint(6, 6, [0.5, 0.5], (ctx) => { ctx.fillStyle = '#fff'; ellipse(ctx, 3, 3, 3, 3); ctx.fill(); });
  // Shell shards instead of splinters.
  art.splinter = paint(10, 4, [0.5, 0.5], (ctx) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(4, 0); ctx.lineTo(10, 1); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill(); });
  art.flash = paint(44, 30, [0.15, 0.5], (ctx) => {
    ctx.fillStyle = radial(ctx, 10, 15, 0, 18, [[0, '#ffffff'], [0.4, '#fff3b0'], [1, 'rgba(255,170,40,0)']]);
    ctx.beginPath();
    ctx.moveTo(4, 15); ctx.lineTo(16, 4); ctx.lineTo(18, 11); ctx.lineTo(44, 15); ctx.lineTo(18, 19); ctx.lineTo(16, 26); ctx.closePath();
    ctx.fill();
  });
  art.ring = paint(64, 64, [0.5, 0.5], (ctx) => {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ellipse(ctx, 32, 32, 28, 28); ctx.stroke();
  });
  // Explosions leave a fried egg on the ground.
  art.scorch = paint(110, 70, [0.5, 0.5], (ctx) => {
    const rand = mulberry32(9);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, r = 28 + rand() * 14;
      const x = 55 + Math.cos(a) * r * 1.5, y = 35 + Math.sin(a) * r * 0.9;
      i ? ctx.quadraticCurveTo(55 + Math.cos(a - 0.2) * r * 1.7, 35 + Math.sin(a - 0.2) * r * 1.05, x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = radial(ctx, 50, 31, 1, 16, [[0, '#ffd54f'], [1, C.yolkDark]]);
    ellipse(ctx, 54, 34, 15, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(ctx, 49, 30, 4, 2.5); ctx.fill();
  });
  // A bottle of milk heals.
  art.medkit = paint(30, 26, [0.5, 0.8], (ctx) => {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(8, 7, 14, 19, 4); ctx.fill();
    ctx.fillStyle = C.shellDark; ctx.beginPath(); ctx.roundRect(8, 7, 14, 19, 4); ctx.stroke();
    ctx.fillStyle = '#e53e3e'; ctx.fillRect(13, 12, 4, 10); ctx.fillRect(10, 15, 10, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(11, 1, 8, 7);
    ctx.fillStyle = C.pinkDark; ctx.fillRect(11, 0, 8, 3);
    ctx.strokeStyle = C.shellDark; ctx.lineWidth = 1; ctx.strokeRect(11, 1, 8, 7);
  });
  // An egg carton is the ammo box.
  art.ammo = paint(32, 26, [0.5, 0.8], (ctx) => {
    ctx.fillStyle = '#a7b8c8'; ctx.beginPath(); ctx.roundRect(2, 10, 28, 14, 3); ctx.fill();
    ctx.fillStyle = '#8a9bab'; ctx.fillRect(2, 10, 28, 3);
    for (let i = 0; i < 4; i++) {
      shadedEgg(ctx, 7 + i * 6, 11, 2.8, 4);
    }
    ctx.fillStyle = C.pinkDark; ctx.font = 'bold 7px sans-serif'; ctx.fillText('蛋×4', 7, 22);
  });
  // Cloud shadows shaped like fried eggs drifting over the island.
  art.cloud = paint(420, 300, [0.5, 0.5], (ctx) => {
    const rand = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      const x = 210 + (rand() - 0.5) * 220, y = 150 + (rand() - 0.5) * 120, r = 70 + rand() * 60;
      ctx.fillStyle = radial(ctx, x, y, 0, r, [[0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = radial(ctx, 210, 150, 0, 60, [[0, 'rgba(0,0,0,0.8)'], [1, 'rgba(0,0,0,0)']]);
    ellipse(ctx, 210, 150, 60, 44); ctx.fill();
  });
  art.vignette = paint(256, 256, [0, 0], (ctx) => {
    ctx.fillStyle = radial(ctx, 128, 128, 70, 182, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]);
    ctx.fillRect(0, 0, 256, 256);
  });
  // Yolks that float in the milk.
  art.yolk = paint(90, 70, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ellipse(ctx, 45, 36, 44, 32); ctx.fill();
    ctx.fillStyle = radial(ctx, 36, 26, 2, 30, [[0, '#ffe066'], [0.6, '#ffb300'], [1, '#f08a00']]);
    ellipse(ctx, 45, 35, 26, 20); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ellipse(ctx, 36, 27, 7, 4); ctx.fill();
  });
  art.waves = oceanTexture();
  return art;
}

// Tileable milk pattern: soft swells plus bubbles.
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
  // bubbles
  const rand = mulberry32(7);
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, y = rand() * S, r = 2 + rand() * 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { ellipse(ctx, x + ox, y + oy, r, r); ctx.stroke(); }
  }
  return Texture.from(canvas);
}
