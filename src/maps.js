// Map catalogue for the dashboard, plus the per-map records kept in localStorage.
//
// The themes, their variants and how each map is built live in sim/maps.js, which a server can
// load without Pixi. This adds what the browser needs per theme: the `scene` class that draws
// its scenery (see Environment in world.js), a `thumbnail(world, size)` that paints a preview
// canvas and the two `loading` lines shown while it is built.
import { THEMES as SIM_THEMES, makeChoice, mapKey, choiceKey } from './sim/maps.js';
import { Environment } from './view/world.js';
import { FactoryEnvironment } from './view/factoryScene.js';

export { RANDOM_ID, randomSeed, makeChoice, mapKey, choiceKey } from './sim/maps.js';

const VIEWS = {
  island: {
    scene: Environment,
    thumbnail: (world, size) => world.paintMinimap(size),
    loading: ['loading.island', 'loading.beaches'],
  },
  factory: {
    scene: FactoryEnvironment,
    thumbnail: (world, size) => world.paintMinimap(size),
    loading: ['loading.factory', 'loading.factoryPaint'],
  },
};

export const THEMES = SIM_THEMES.map((th) => ({ ...th, ...VIEWS[th.id] }));

export function findTheme(id) {
  return THEMES.find((t) => t.id === id) ?? null;
}

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
