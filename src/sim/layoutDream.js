// The dream maps' layout, in the same shape as islandLayout: what stands on King Naiwa and the
// colliders it brings. Everything is a Naiwa: statues of him and his soldiers (some planted head
// first), two giants that never stop laughing, a ring of eggs around his belly button and a totem
// of three of him on his forehead (the lookout, with the SMG). The landmarks are fixed; the seed
// scatters the smaller statues, eggs, crates and barrels. Pure and seeded (no Pixi, no DOM);
// DreamEnvironment (view/dreamScene.js) draws what this lists.
import { mulberry32 } from '../noise.js';

// The poses a statue can strike: the textures skins.js loads under these names.
export const STATUE_POSES = ['hero', 'gunner', 'punk', 'sniper', 'elite', 'boss'];
// How many colours the scene has for a statue (`tone`).
export const STATUE_TONES = 8;
// A statue's collider is a circle at its feet, this wide per unit of scale; an egg's likewise.
const STATUE_R = 24, EGG_R = 15;

const rnd = (r, a, b) => a + r() * (b - a);

export function dreamLayout(world) {
  const R = mulberry32(world.seed + 4321);
  const colliders = [], objects = [], props = [], weaponSpots = [], occupied = [];
  const keep = (x, y, r) => occupied.push({ x, y, r });

  const solid = (o, r) => {
    objects.push(o);
    colliders.push({ kind: 'circle', x: o.x, y: o.y - r * 0.5, r });
    keep(o.x, o.y, r + 34);
  };
  const statue = (p, pose, scale, more = {}) => solid({ kind: 'statue', x: p.x, y: p.y, pose, scale, tone: 0, ...more }, Math.round(STATUE_R * scale));
  const egg = (p, scale) => solid({ kind: 'egg', x: p.x, y: p.y, scale }, Math.round(EGG_R * scale));

  // Nothing stands on his eyes (they have to be seen), his tongue, or the belly button.
  for (const e of world.eyes) keep(e.x, e.y, Math.max(e.rx, e.ry) + 60);
  keep(world.tongue.x, world.tongue.y, world.tongue.ry + 50);
  const B = world.spawn;
  keep(B.x, B.y, 170);

  // ---------- Landmarks ----------
  // The totem on his forehead: the lookout, with the SMG at its foot.
  const totem = world.lookout;
  solid({ kind: 'totem', x: totem.x, y: totem.y }, 40);
  weaponSpots.push({ x: totem.x, y: totem.y + 70, kind: 'smg' });
  // The shotgun on his right foot, the rifle in his left hand.
  weaponSpots.push({ ...world.at(424, 643), kind: 'shotgun' });
  weaponSpots.push({ ...world.at(62, 281), kind: 'rifle' });
  for (const w of weaponSpots) keep(w.x, w.y, 80);

  // A ring of eggs around the belly button.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    egg({ x: Math.round(B.x + Math.cos(a) * 400), y: Math.round(B.y + Math.sin(a) * 320) }, 3);
  }
  // A statue of himself on his own chest, the two who can't stop laughing on his shoulders, and
  // his soldiers standing guard: on their heads at his hands, on their feet at his knees.
  statue(world.at(228, 196), 'boss', 2.6);
  for (const [ix, phase] of [[112, 0], [352, 0.5]]) solid({ kind: 'laugher', ...world.at(ix, 228), scale: 2.2, phase }, 52);
  statue(world.at(108, 306), 'sniper', 2.3, { down: true });
  statue(world.at(412, 292), 'elite', 2.3, { down: true, flip: true });
  statue(world.at(70, 520), 'gunner', 2.2);
  statue(world.at(402, 520), 'punk', 2.2, { flip: true });

  // ---------- Scattered by the seed ----------
  // Clear of everything kept above, and on him with room to spare (never in the milk).
  const free = (x, y, r) => {
    for (const d of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (!world.onBody(x + d[0], y + d[1])) return false;
    for (const o of occupied) if (Math.hypot(o.x - x, o.y - y) < o.r + r) return false;
    return true;
  };
  const scatter = (n, tries, r, make) => {
    for (let i = 0, k = 0; i < tries && k < n; i++) {
      const x = Math.round(rnd(R, 100, world.size - 100)), y = Math.round(rnd(R, 100, world.size - 100));
      if (!free(x, y, r)) continue;
      make(x, y);
      k++;
    }
  };
  scatter(22, 1500, 110, (x, y) => {
    // Mostly himself, in every colour; one in four stands on its head.
    const pose = R() < 0.55 ? 'hero' : STATUE_POSES[1 + ((R() * 4) | 0)];
    const scale = Math.round(rnd(R, 1.1, 1.9) * 10) / 10;
    statue({ x, y }, pose, scale, { tone: (R() * STATUE_TONES) | 0, flip: R() < 0.5, down: R() < 0.25, march: pose === 'hero' && R() < 0.4 });
  });
  scatter(14, 1000, 90, (x, y) => egg({ x, y }, Math.round(rnd(R, 1.8, 3.4) * 10) / 10));
  scatter(40, 2000, 50, (x, y) => {
    props.push({ kind: R() < 0.62 ? 'crate' : 'barrel', x, y });
    keep(x, y, 34);
  });

  return { colliders, objects, props, weaponSpots, occupied };
}
