// The island's layout: where every hut, tree, rock, prop and weapon spot goes, and the colliders
// they bring. Pure and seeded (no Pixi, no DOM), so the browser and a server build the same map
// from the same Island. Environment in world.js draws what this lists.
import { WORLD, H_GRASS, H_ROCK } from '../island.js';
import { mulberry32 } from '../noise.js';

// How many textures art.js paints of each kind. Variants are picked with the seeded RNG, so
// changing a count reshuffles every island.
export const ART_COUNTS = { palms: 6, trees: 6, bushes: 8, ferns: 4, huts: 3, driftwood: 2, butterflies: 4 };
// Rock textures by size; art.js paints one per entry.
export const ROCK_SIZES = [18, 22, 26, 34, 42, 30, 52];

const rnd = (r, a, b) => a + r() * (b - a);

// Returns {
//   colliders:   in the order they go into the StaticWorld
//   objects:     { kind, x, y, variant?, scale?, flip? } for the scene to draw, in draw order
//   props:       { kind: 'crate' | 'barrel', x, y }
//   weaponSpots: { kind, x, y }
//   occupied:    { x, y, r } circles that placement kept clear
//   decor:       clouds, gulls and butterflies. Only drawn, but they continue the same seeded
//                stream, so they are laid out here too.
// }
export function islandLayout(island) {
  const R = mulberry32(island.seed + 1234);
  const colliders = [], objects = [], props = [], weaponSpots = [], occupied = [];

  const isFree = (x, y, r) => {
    for (const o of occupied) {
      const dx = o.x - x, dy = o.y - y, m = o.r + r;
      if (dx * dx + dy * dy < m * m) return false;
    }
    const d = island.dock;
    if (x > d.x - 60 - r && x < d.x + d.w + 60 + r && y > d.y - 40 - r && y < d.y + d.h + r) return false;
    if (Math.hypot(x - island.spawn.x, y - island.spawn.y) < 140 + r) return false;
    return true;
  };
  const find = (pred, r, tries = 200) => {
    for (let i = 0; i < tries; i++) {
      const x = rnd(R, 100, WORLD - 100), y = rnd(R, 100, WORLD - 100);
      const h = island.heightAt(x, y);
      if (pred(x, y, h) && isFree(x, y, r)) return { x, y };
    }
    return null;
  };
  const object = (o, occupy) => {
    objects.push(o);
    if (occupy) occupied.push({ x: o.x, y: o.y, r: occupy });
  };

  // ---------- Village ----------
  const v = island.village;
  occupied.push({ x: v.x, y: v.y, r: 150 });
  const angles = [-2.35, -1.25, -0.1, 3.0];
  angles.forEach((a, i) => {
    const x = v.x + Math.cos(a) * 255, y = v.y + Math.sin(a) * 200 + 40;
    if (island.heightAt(x, y) < 0.08 || !isFree(x, y, 90)) return;
    object({ kind: 'hut', x, y, variant: i % ART_COUNTS.huts, flip: i % 2 === 1 }, 110);
    colliders.push({ kind: 'rect', x: x - 96, y: y - 82, w: 192, h: 76 });
    if (i === 1) weaponSpots.push({ x: x + 20, y: y + 40, kind: 'shotgun' });
  });
  object({ kind: 'campfire', x: v.x, y: v.y });
  colliders.push({ kind: 'circle', x: v.x, y: v.y, r: 26, blocksBullets: false });
  // Tiki torches around the plaza and the dock
  const torchSpots = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    torchSpots.push([v.x + Math.cos(a) * 130, v.y + Math.sin(a) * 100]);
  }
  const d = island.dock;
  torchSpots.push([d.x - 26, d.y - 10], [d.x + d.w + 26, d.y - 10]);
  for (const [x, y] of torchSpots) {
    object({ kind: 'torch', x, y }, 16);
    colliders.push({ kind: 'circle', x, y: y - 4, r: 7, blocksBullets: false });
  }
  // Lookout tower on the hill
  const L = island.lookout;
  if (L.h > 0.3) {
    object({ kind: 'tower', x: L.x, y: L.y }, 90);
    colliders.push({ kind: 'rect', x: L.x - 52, y: L.y - 46, w: 104, h: 40 });
    weaponSpots.push({ x: L.x, y: L.y + 40, kind: 'smg' });
  }

  // ---------- Vegetation ----------
  const offPath = (x, y) => island.pathAt(x, y) < 0.2;
  for (let i = 0; i < 95; i++) {
    const p = find((x, y, h) => h > 0.03 && h < 0.32 && offPath(x, y), 38);
    if (!p) continue;
    const variant = (R() * ART_COUNTS.palms) | 0;
    const sc = rnd(R, 0.8, 1.15);
    object({ kind: 'palm', ...p, variant, scale: sc, flip: R() < 0.5 }, 38);
    colliders.push({ kind: 'circle', x: p.x, y: p.y - 6, r: 11 * sc });
  }
  for (let i = 0; i < 80; i++) {
    const p = find((x, y, h) => h > 0.22 && h < H_ROCK + 0.02 && island.moistAt(x, y) > 0.38 && offPath(x, y), 55);
    if (!p) continue;
    const variant = (R() * ART_COUNTS.trees) | 0;
    const sc = rnd(R, 0.85, 1.2);
    object({ kind: 'tree', ...p, variant, scale: sc, flip: R() < 0.5 }, 55);
    colliders.push({ kind: 'circle', x: p.x, y: p.y - 8, r: 16 * sc });
  }
  for (let i = 0; i < 160; i++) {
    const p = find((x, y, h) => h > H_GRASS && h < H_ROCK && offPath(x, y), 22);
    if (!p) continue;
    const variant = (R() * ART_COUNTS.bushes) | 0;
    object({ kind: 'bush', ...p, variant, scale: rnd(R, 0.8, 1.3) }, 22);
  }
  for (let i = 0; i < 420; i++) {
    const x = rnd(R, 100, WORLD - 100), y = rnd(R, 100, WORLD - 100);
    const h = island.heightAt(x, y);
    if (h < H_GRASS + 0.02 || h > H_ROCK || island.pathAt(x, y) > 0.35 || !isFree(x, y, 6)) continue;
    const variant = (R() * ART_COUNTS.ferns) | 0;
    object({ kind: 'fern', x, y, variant, scale: rnd(R, 0.7, 1.2) });
  }
  // Rocks: bigger on the hill, pebbly near the shore.
  for (let i = 0; i < 70; i++) {
    const p = find((x, y, h) => h > 0.02 && offPath(x, y), 40);
    if (!p) continue;
    const h = island.heightAt(p.x, p.y);
    const variant = h > H_ROCK - 0.08 ? 3 + ((R() * 4) | 0) : (R() * 4) | 0;
    const size = ROCK_SIZES[variant];
    object({ kind: 'rock', ...p, variant, flip: R() < 0.5 }, size + 10);
    colliders.push({ kind: 'circle', x: p.x, y: p.y - size * 0.5, r: size * 0.82 });
  }
  // Driftwood on the beach
  for (let i = 0; i < 16; i++) {
    const p = find((x, y, h) => h > 0.01 && h < 0.08, 50);
    if (!p) continue;
    object({ kind: 'driftwood', ...p, variant: i % ART_COUNTS.driftwood, flip: R() < 0.5 }, 50);
    colliders.push({ kind: 'circle', x: p.x - 22, y: p.y - 4, r: 12, blocksBullets: false });
    colliders.push({ kind: 'circle', x: p.x + 18, y: p.y - 4, r: 12, blocksBullets: false });
  }
  // A rifle stashed on a remote beach.
  const far = find((x, y, h) => h > 0.04 && h < 0.12 && Math.hypot(x - island.spawn.x, y - island.spawn.y) > 1300, 20, 600);
  if (far) weaponSpots.push({ x: far.x, y: far.y, kind: 'rifle' });

  // ---------- Destructible props ----------
  const spots = [
    ['crate', d.x - 70, d.y - 30], ['crate', d.x - 105, d.y - 40], ['barrel', d.x + d.w + 70, d.y - 36],
  ];
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    spots.push([R() < 0.7 ? 'crate' : 'barrel', v.x + Math.cos(a) * rnd(R, 180, 330), v.y + Math.sin(a) * rnd(R, 150, 280)]);
  }
  for (let i = 0; i < 34; i++) {
    const p = find((x, y, h) => h > 0.03 && island.pathAt(x, y) < 0.4, 30);
    if (p) spots.push([R() < 0.68 ? 'crate' : 'barrel', p.x, p.y]);
  }
  spots.forEach(([kind, x, y], i) => {
    // The first three sit by the dock, inside the area isFree() reserves.
    if (i >= 3 && !isFree(x, y, 22)) return;
    if (!island.isWalkable(x, y)) return;
    props.push({ kind, x, y });
    occupied.push({ x, y, r: 28 });
  });

  // ---------- Decoration ----------
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const x = rnd(R, 0, WORLD), y = rnd(R, 0, WORLD);
    clouds.push({ x, y, sx: rnd(R, 1.8, 3.4), sy: rnd(R, 1.5, 2.6) });
  }
  const gulls = [];
  for (let i = 0; i < 7; i++) {
    gulls.push({
      cx: rnd(R, 600, WORLD - 600), cy: rnd(R, 600, WORLD - 600), rx: rnd(R, 250, 700), ry: rnd(R, 200, 500),
      a: R() * 6.28, w: rnd(R, 0.08, 0.2) * (R() < 0.5 ? -1 : 1), alt: rnd(R, 80, 140),
    });
  }
  const butterflies = [];
  for (let i = 0; i < 26; i++) {
    const p = find((x, y, h) => h > H_GRASS + 0.03 && h < H_ROCK, 0, 80);
    if (!p) continue;
    butterflies.push({ ...p, variant: i % ART_COUNTS.butterflies, ph: R() * 100, sp: rnd(R, 0.4, 0.9) });
  }

  return { colliders, objects, props, weaponSpots, occupied, decor: { clouds, gulls, butterflies } };
}
