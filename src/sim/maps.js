// The map catalogue without anything the browser draws: themes, their variants and how to build
// a map's world and layout. A server rebuilds the exact map a client sees from { theme, id, seed }
// with buildMap(makeChoice(theme, id, seed)).
//
// Maps are grouped by THEME. A theme owns a world generator; its VARIANTS are the maps of that
// theme (for the island theme: a seed plus a few terrain knobs). A new theme (desert, snow,
// city…) is one more entry here: give it an id, its variants, a `world(choice)` that returns the
// terrain object the game walks on (same interface as Island: isWalkable / isWading / inDock /
// goodSpawn / dustColor / drift / paintTerrain / paintMinimap / spawn / village / lookout) and a
// `layout(world)` that places its colliders, props and weapon spots (see sim/layoutIsland.js).
// Then add its scene, thumbnail and loading lines in maps.js, and its names under `theme.<id>`
// in i18n.js.
import { Island } from '../island.js';
import { Factory } from '../factory.js';
import { islandLayout } from './layoutIsland.js';
import { factoryLayout } from './layoutFactory.js';

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
    layout: islandLayout,
  },
  {
    id: 'factory',
    variants: [
      // The milk-and-egg plant: belts in the hall, a milk canal to wade, tanks and a loading yard.
      { id: 'dairy', seed: 520, shape: {}, tags: ['large', 'belts'] },
    ],
    world: (choice) => new Factory(choice.seed),
    layout: factoryLayout,
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

// The map's terrain and its layout, built from scratch.
export function buildMap(choice) {
  const th = findTheme(choice.theme);
  const world = th.world(choice);
  return { world, layout: th.layout(world) };
}
