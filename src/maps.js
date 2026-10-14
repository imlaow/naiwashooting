// Map catalogue for the dashboard, plus the per-map records kept in localStorage.
//
// Maps are grouped by THEME. A theme owns a world generator; its VARIANTS are the maps of that
// theme (for the island theme: a seed plus a few terrain knobs). The dashboard draws one section
// per theme, so a new theme (desert, snow, city…) is one more entry in THEMES: give it an id,
// its variants, a `world(choice)` that returns the terrain object the game walks on (same
// interface as Island: isWalkable / isWading / inDock / goodSpawn / dustColor / drift /
// paintTerrain / paintMinimap / spawn / village / lookout), the `scene` class that builds its
// scenery (see Environment in world.js), a `thumbnail(world, size)` that paints a preview
// canvas, the two `loading` lines shown while it is built, and name strings under
// `theme.<id>` in i18n.js.
import { Island } from './island.js';
import { Factory } from './factory.js';
import { Environment } from './world.js';
import { FactoryEnvironment } from './factoryScene.js';

export const THEMES = [
  {
    id: 'island',
    // A card that rolls a fresh seed every time it is picked.
    random: true,
    variants: [
      // The original island. Its seed and shape are unchanged so old best scores still mean something.
      { id: 'cove', seed: 20261012, shape: {}, tags: ['classic'] },
      // Small and broken up: lots of shallows, few places to hide.
      { id: 'atoll', seed: 7741, shape: { size: 0.36, rough: 0.64, warp: 0.6, hill: 0.18, hillX: 0.1, hillY: 0.12 }, tags: ['small', 'water'] },
      // A big, central peak with rock faces the eggs have to climb around.
      { id: 'peak', seed: 31337, shape: { size: 0.48, rough: 0.42, hill: 0.44, hillX: -0.04, hillY: -0.08, wet: 0.08 }, tags: ['large', 'rock'] },
      // Wet and overgrown: jungle trees everywhere, so fights happen up close.
      { id: 'jungle', seed: 4242, shape: { size: 0.5, rough: 0.46, warp: 0.35, hill: 0.2, hillX: 0.2, hillY: -0.22, wet: 0.32 }, tags: ['large', 'trees'] },
      // Low, dry and open: wide beaches and long sightlines for the rifle.
      { id: 'dunes', seed: 9001, shape: { size: 0.37, rough: 0.26, warp: 0.3, hill: 0.16, hillX: -0.22, hillY: 0.1, wet: -0.3 }, tags: ['small', 'sand'] },
      // Two islands joined by a wadeable strait.
      { id: 'twins', seed: 2024, shape: { size: 0.5, rough: 0.4, warp: 0.3, hill: 0.24, hillX: -0.3, hillY: -0.12, strait: 0.5, straitAngle: 1.1 }, tags: ['large', 'water'] },
    ],
    world: (choice) => new Island(choice.seed, choice.shape),
    scene: Environment,
    thumbnail: (world, size) => world.paintMinimap(size),
    loading: ['loading.island', 'loading.beaches'],
  },
  {
    id: 'factory',
    variants: [
      // The milk-and-egg plant: belts in the hall, a milk canal to wade, tanks and a loading yard.
      { id: 'dairy', seed: 520, shape: {}, tags: ['large', 'belts'] },
    ],
    world: (choice) => new Factory(choice.seed),
    scene: FactoryEnvironment,
    thumbnail: (world, size) => world.paintMinimap(size),
    loading: ['loading.factory', 'loading.factoryPaint'],
  },
];

export const RANDOM_ID = 'random';

export function randomSeed() {
  return 1000 + Math.floor(Math.random() * 9_000_000);
}

export function findTheme(id) {
  return THEMES.find((t) => t.id === id) ?? null;
}

// A map choice: a theme's variant, or its random card with whatever seed it currently shows.
// Falls back to the first map of the first theme when the ids are unknown.
export function makeChoice(theme, id, seed) {
  const th = findTheme(theme) ?? THEMES[0];
  if (id === RANDOM_ID && th.random) return { theme: th.id, id: RANDOM_ID, seed: seed || randomSeed(), shape: {} };
  const v = th.variants.find((m) => m.id === id) ?? th.variants[0];
  return { theme: th.id, id: v.id, seed: v.seed, shape: v.shape };
}

// Identifies a map for its records: presets by name, every random roll under one key.
export const mapKey = (c) => `${c.theme}/${c.id}`;
// Identifies the exact terrain, random seed included.
export const choiceKey = (c) => `${mapKey(c)}:${c.seed}`;

// Worlds are cached by exact terrain, so picking a card again, or playing the card you
// previewed, doesn't rebuild its height field.
const worlds = new Map();
export function worldFor(choice) {
  const key = choiceKey(choice);
  let w = worlds.get(key);
  if (!w) {
    w = findTheme(choice.theme).world(choice);
    worlds.set(key, w);
    if (worlds.size > 12) worlds.delete(worlds.keys().next().value);
  }
  return w;
}

export function thumbnailFor(choice, size) {
  return findTheme(choice.theme).thumbnail(worldFor(choice), size);
}

// ---------- Persistence ----------
const SEL_KEY = 'naiwa-map';
const STATS_KEY = 'naiwa-map-stats';

export function readSelected() {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY));
    if (v && typeof v.id === 'string') return makeChoice(v.theme, v.id, Number(v.seed) || 0);
  } catch { /* storage unavailable or malformed */ }
  return null;
}

export function writeSelected(choice) {
  try { localStorage.setItem(SEL_KEY, JSON.stringify({ theme: choice.theme, id: choice.id, seed: choice.seed })); } catch { /* storage unavailable */ }
}

export function readStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch { return {}; }
}

// Records a finished run against its map and returns that map's updated record.
export function recordRun(choice, { score, wave, kills }) {
  const all = readStats();
  const key = mapKey(choice);
  const s = all[key] ?? { best: 0, wave: 0, kills: 0, plays: 0 };
  s.best = Math.max(s.best, score);
  s.wave = Math.max(s.wave, wave);
  s.kills += kills;
  s.plays += 1;
  all[key] = s;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  return s;
}
