// Procedurally painted textures (canvas 2D -> Pixi textures).
//
// The look is the "milk & egg" world of the sprites in public/assets, and the sprites themselves
// are pasted into the textures: the egg is every egg, the bunny gunner's ears are every leaf and
// wing, and Naiwa himself is the huts. Nothing with a face is drawn by hand. Texture sizes and
// anchors are unchanged so the colliders in world.js still fit.
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

// ---------- Sprite pasting ----------
// Bitmaps from skins.js, set by buildArt().
let IMG = null;
// The pair of ears, cut from the gunner sprite.
const EARS = { sx: 285, sy: 0, sw: 265, sh: 200 };

// The egg sprite standing on (x, y), `w` wide, turned by `rot`.
function pasteEgg(ctx, x, y, w, rot = 0) {
  const h = w * IMG.egg.height / IMG.egg.width;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(IMG.egg, -w / 2, -h, w, h);
  ctx.restore();
}

// The egg sprite with a colour laid over its body (the bomb egg); drawn via a scratch canvas so
// the tint stays inside the egg's outline.
function pasteTintedEgg(ctx, x, y, w, color, alpha, rot = 0) {
  const h = w * IMG.egg.height / IMG.egg.width;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
  const cx = c.getContext('2d');
  cx.drawImage(IMG.egg, 0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'source-atop';
  cx.globalAlpha = alpha;
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(c, -w / 2, -h, w, h);
  ctx.restore();
}

// The gunner's ears, their base at (x, y), `w` wide, turned by `rot`.
function pasteEars(ctx, x, y, w, rot = 0, flip = false) {
  const h = w * EARS.sh / EARS.sw;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(IMG.gunner, EARS.sx, EARS.sy, EARS.sw, EARS.sh, -w / 2, -h, w, h);
  ctx.restore();
}

// A Naiwa walk frame standing on (x, y) at height `h`, stretched `wide` times sideways.
function pasteHero(ctx, frame, x, y, h, wide = 1, rot = 0) {
  const img = IMG.hero[frame % IMG.hero.length];
  const w = h * img.width / img.height * wide;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

// The gunner standing on (x, y) at height `h`.
function pasteGunner(ctx, x, y, h) {
  const img = IMG.gunner;
  const w = h * img.width / img.height;
  ctx.drawImage(img, x - w / 2, y - h, w, h);
}

// A plain yellow stalk from (x, y) up to (x + lean, y - h): the one thing still drawn, since the
// sprites have nothing to stand an egg on.
function stalk(ctx, x, y, h, lean, w) {
  ctx.fillStyle = linear(ctx, x - w, 0, x + w, 0, [[0, C.skinLight], [0.5, C.skin], [1, C.skinDark]]);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 1.1 + lean * 0.3, y - h * 0.5, x + lean - w * 0.75, y - h);
  ctx.lineTo(x + lean + w * 0.75, y - h);
  ctx.quadraticCurveTo(x + w * 1.1 + lean * 0.3, y - h * 0.5, x + w, y);
  ctx.closePath(); ctx.fill();
}

function groundShadow(ctx, x, y, rx, ry, a = 0.28) {
  ctx.fillStyle = `rgba(90,40,0,${a})`; ellipse(ctx, x, y, rx, ry); ctx.fill();
}

// ---------- Vegetation ----------
// Egg tree: a stalk with the egg on top; every other one wears the gunner's ears.
function palmTree(seed) {
  const rand = mulberry32(seed);
  return paint(240, 280, [0.5, 265 / 280], (ctx) => {
    const bx = 120, by = 265;
    const lean = (rand() - 0.5) * 70;
    const tx = bx + lean, ty = 150;
    groundShadow(ctx, bx + 6, by - 2, 34, 9);
    stalk(ctx, bx, by, by - ty + 10, lean, 11);
    if (seed % 2) pasteEars(ctx, tx, ty - 70, 150, (rand() - 0.5) * 0.4, rand() < 0.5);
    pasteEgg(ctx, tx, ty + 10, 96, (rand() - 0.5) * 0.3);
  });
}

// Ear tree: a thick stalk that ends in a huge pair of the gunner's ears, with an egg for a head.
function jungleTree(seed) {
  const rand = mulberry32(seed);
  return paint(210, 240, [0.5, 228 / 240], (ctx) => {
    const bx = 105, by = 228;
    groundShadow(ctx, bx + 4, by - 1, 40, 10, 0.3);
    stalk(ctx, bx, by, 120, 0, 16);
    pasteEars(ctx, bx, 112, 190, (rand() - 0.5) * 0.3, seed % 2 === 0);
    pasteEgg(ctx, bx, 128, 62, (rand() - 0.5) * 0.2);
  });
}

// A clutch of small eggs.
function bush(seed) {
  const rand = mulberry32(seed);
  return paint(90, 66, [0.5, 0.9], (ctx) => {
    const cx = 45, cy = 56;
    groundShadow(ctx, cx + 3, cy + 2, 36, 8, 0.25);
    const eggs = [];
    for (let i = 0; i < 3 + (seed % 3); i++) eggs.push({ x: cx + (rand() - 0.5) * 50, y: cy + (rand() - 0.5) * 12, w: 20 + rand() * 12, r: (rand() - 0.5) * 0.5 });
    eggs.sort((a, b) => a.y - b.y);
    for (const e of eggs) pasteEgg(ctx, e.x, e.y, e.w, e.r);
  });
}

// A tuft of small ears.
function fern(seed) {
  const rand = mulberry32(seed);
  return paint(60, 48, [0.5, 0.95], (ctx) => {
    for (let i = 0; i < 2 + (seed % 2); i++) {
      pasteEars(ctx, 30 + (rand() - 0.5) * 20, 46, 26 + rand() * 12, (rand() - 0.5) * 1.2, rand() < 0.5);
    }
  });
}

// Rocks are eggs: upright, tilted, or toppled onto their side.
function rock(seed, size) {
  const rand = mulberry32(seed);
  const w = size * 2.4, h = size * 1.9;
  return paint(w, h, [0.5, 0.86], (ctx) => {
    const cx = w / 2, by = h * 0.86;
    groundShadow(ctx, cx + size * 0.1, by, size * 1.05, size * 0.3);
    const toppled = seed % 3 === 0;
    if (toppled) pasteEgg(ctx, cx, by - size * 0.55, size * 1.55, (rand() < 0.5 ? 1 : -1) * (Math.PI / 2 - 0.15));
    else pasteEgg(ctx, cx, by, size * 1.65, (rand() - 0.5) * 0.35);
  });
}

// A Naiwa lying on the beach where the driftwood used to be.
function driftwood(seed) {
  return paint(110, 60, [0.5, 0.8], (ctx) => {
    groundShadow(ctx, 57, 50, 50, 7, 0.22);
    pasteHero(ctx, seed + 1, 55, 70, 100, 1, seed % 2 ? Math.PI / 2 : -Math.PI / 2);
  });
}

// ---------- Props ----------
// The breakable crate is an egg.
function crate() {
  return paint(52, 56, [0.5, 0.93], (ctx) => {
    groundShadow(ctx, 29, 51, 25, 6, 0.3);
    pasteEgg(ctx, 27, 53, 44);
  });
}

// The bomb egg: the egg dyed dark, with a lit fuse.
function barrel() {
  return paint(38, 52, [0.5, 0.92], (ctx) => {
    groundShadow(ctx, 21, 47, 17, 5, 0.3);
    pasteTintedEgg(ctx, 19, 48, 34, '#2a0a12', 0.8);
    ctx.strokeStyle = '#d7b98a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(19, 9); ctx.quadraticCurveTo(24, 2, 29, 5); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = radial(ctx, 29, 5, 0, 6, [[0, '#fff5b0'], [0.5, '#ffb300'], [1, 'rgba(255,80,0,0)']]);
    ellipse(ctx, 29, 5, 6, 6); ctx.fill();
  });
}

// A hut is Naiwa himself, stretched wide, with a door cut into his belly.
function hut(seed) {
  return paint(240, 220, [0.5, 208 / 220], (ctx) => {
    groundShadow(ctx, 128, 205, 105, 14, 0.3);
    pasteHero(ctx, seed, 120, 208, 206, 1.9);
    ctx.fillStyle = '#2a1a0e'; ctx.beginPath(); ctx.roundRect(102, 150, 36, 58, [18, 18, 0, 0]); ctx.fill();
    ctx.strokeStyle = C.pinkDark; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(102, 150, 36, 58, [18, 18, 0, 0]); ctx.stroke();
    ctx.fillStyle = C.yolk; ellipse(ctx, 131, 182, 3, 3); ctx.fill();
  });
}

// The boat is an egg, pulled long, floating on its back.
function boat() {
  return paint(70, 170, [0.5, 0.5], (ctx) => {
    ctx.fillStyle = 'rgba(200,140,0,0.3)'; ellipse(ctx, 40, 92, 30, 76); ctx.fill();
    ctx.drawImage(IMG.egg, 2, 4, 66, 160);
  });
}

// An egg on a stalk; the flame emitter sits above it.
function tikiTorch() {
  return paint(26, 80, [0.5, 0.96], (ctx) => {
    groundShadow(ctx, 15, 76, 8, 3, 0.25);
    stalk(ctx, 13, 77, 52, 0, 3);
    pasteEgg(ctx, 13, 30, 22);
  });
}

// Two eggs stacked, with the gunner kicking on top.
function tower() {
  return paint(150, 250, [0.5, 240 / 250], (ctx) => {
    groundShadow(ctx, 80, 238, 62, 12, 0.3);
    pasteEgg(ctx, 75, 240, 118);
    pasteEgg(ctx, 75, 120, 92, 0.08);
    pasteGunner(ctx, 75, 30, 112);
  });
}

// The flag is a pair of ears.
function flag() {
  return paint(40, 24, [0, 0.5], (ctx) => {
    pasteEars(ctx, 16, 24, 32, 0.6);
  });
}

// ---------- Creatures ----------
// A flying egg with the gunner's ears for wings.
function seagull(phase) {
  return paint(48, 26, [0.5, 0.5], (ctx) => {
    const up = phase === 0;
    pasteEars(ctx, 14, 16, 26, up ? -1.2 : -1.7);
    pasteEars(ctx, 34, 16, 26, up ? 1.2 : 1.7, true);
    pasteEgg(ctx, 24, 24, 16);
  });
}

// A pair of ears flapping like wings.
function butterfly(phase, size) {
  return paint(16, 12, [0.5, 0.5], (ctx) => {
    const spread = phase ? 0.35 : 1.2;
    pasteEars(ctx, 7, 12, 12 * size, -spread);
    pasteEars(ctx, 9, 12, 12 * size, spread, true);
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
  });
}

// `images` are the sprite bitmaps from skins.js.
export function buildArt(images) {
  IMG = images;
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
  art.butterflies = [0.8, 1, 1.2, 1.4].map((k) => [butterfly(0, k), butterfly(1, k)]);
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
    for (let i = 0; i < 4; i++) pasteEgg(ctx, 7 + i * 6, 15, 5.6);
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
