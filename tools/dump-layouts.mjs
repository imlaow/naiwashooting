// Dumps the map layout of every preset map (colliders, props, weapon spots, occupied areas) as
// plain text, one entry per line, so two dumps can be compared with diff.
//
//   node tools/dump-layouts.mjs            layouts from src/sim (no Pixi, no DOM)
//   node tools/dump-layouts.mjs --scene    the same lists, recorded while the scene classes
//                                          build each map with Pixi stubbed out
//   node tools/dump-layouts.mjs --scene --draw
//                                          also lists what the scenes drew (sprites, lights,
//                                          decoration), to check single-player looks the same
//   node tools/dump-layouts.mjs --check     compares the layouts with tools/layout-baseline.txt
//
// tools/layout-baseline.txt was recorded with --scene before the layout moved to src/sim, so
// --check proves the layout functions build exactly the maps the game always had.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const SCENE = args.has('--scene'), DRAW = args.has('--draw'), CHECK = args.has('--check');
const BASELINE = new URL('./layout-baseline.txt', import.meta.url);

// Math.random drives some purely visual details (light flicker phases, crate flips). Seed it so
// --draw output is repeatable too.
{
  let s = 1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Pixi stub (scene mode) ----------
// Just enough of Pixi for the scene constructors: display objects remember their position,
// scale and children, and textures are named tokens.
const PIXI_STUB = `
const pt = (v = 0) => ({ x: v, y: v, set(x, y = x) { this.x = x; this.y = y; } });
export class Container {
  constructor() { this.position = pt(); this.scale = pt(1); this.anchor = pt(); this.skew = pt(); this.children = []; this.zIndex = 0; this.alpha = 1; this.visible = true; }
  get x() { return this.position.x; } set x(v) { this.position.x = v; }
  get y() { return this.position.y; } set y(v) { this.position.y = v; }
  addChild(...c) { this.children.push(...c); return c[0]; }
  addChildAt(c) { this.children.push(c); return c; }
  getLocalBounds() { return { minX: 0, maxX: 0, minY: 0, maxY: 0 }; }
  destroy() {}
}
export class Sprite extends Container { constructor(texture) { super(); this.texture = texture; } }
export class TilingSprite extends Sprite {
  constructor({ texture, width, height }) { super(texture); this.width = width; this.height = height; this.tilePosition = pt(); this.tileScale = pt(1); }
}
export class Graphics extends Container {}
for (const m of ['rect', 'fill', 'moveTo', 'lineTo', 'stroke', 'circle', 'ellipse', 'poly', 'roundRect', 'closePath']) Graphics.prototype[m] = function () { return this; };
export class Texture { constructor(o) { Object.assign(this, o); } }
export class CanvasSource { constructor(o) { Object.assign(this, o); } }
`;
// factoryArt.js paints canvases, so the factory's textures are tokens too.
const FACTORY_ART_STUB = `
const token = (name) => new Proxy({ name }, { get: (t, k) => (k in t || typeof k === 'symbol' || k === 'anchorHint' ? t[k] : (t[k] = token(t.name + '.' + String(k)))) });
export const factoryArt = () => token('fa');
export const building = (w, h, H, kind) => ({ name: 'building.' + kind + '.' + w + 'x' + h + 'x' + H });
`;
const HOOKS = `
const stubs = { 'pixi.js': ${JSON.stringify(PIXI_STUB)}, 'factoryArt.js': ${JSON.stringify(FACTORY_ART_STUB)} };
export async function resolve(spec, ctx, next) {
  const key = spec === 'pixi.js' ? spec : spec.endsWith('/factoryArt.js') ? 'factoryArt.js' : null;
  if (key) return { url: 'data:text/javascript,' + encodeURIComponent(stubs[key]), shortCircuit: true };
  return next(spec, ctx);
}
`;

// The island art as named tokens. Array lengths match art.js, because the scenes pick
// variants with them.
function islandArt() {
  const tok = (name) => ({ name });
  const list = (name, n) => Array.from({ length: n }, (_, i) => tok(`${name}.${i}`));
  const known = {
    palms: list('palm', 6), trees: list('tree', 6), bushes: list('bush', 8), ferns: list('fern', 4),
    rocks: list('rock', 7), driftwood: list('driftwood', 2), huts: list('hut', 3), gull: list('gull', 2),
    butterflies: [0, 1, 2, 3].map((i) => list(`butterfly.${i}`, 2)),
  };
  return new Proxy(known, { get: (t, k) => (k in t ? t[k] : (t[k] = tok(String(k)))) });
}

// Builds a map's scene against a fake Game and records what it registered.
async function viaScene(choice) {
  const { findTheme, worldFor } = await import('../src/maps.js');
  const { StaticWorld } = await import('../src/physics.js');
  const { Container } = await import('pixi.js');
  const island = worldFor(choice);
  const statics = new StaticWorld();
  const colliders = [];
  const add = statics.add.bind(statics);
  statics.add = (c) => { colliders.push(c); return add(c); };
  const props = [];
  const layers = new Proxy({}, { get: (t, k) => t[k] ?? (t[k] = new Container()) });
  const game = { island, art: islandArt(), layers, statics, fx: {}, addProp: (kind, x, y) => props.push({ kind, x, y }) };
  const env = new (findTheme(choice.theme).scene)(game, { terrain: { name: 'terrain' } });
  return { colliders, props, weaponSpots: env.weaponSpots, occupied: env.occupied ?? env.layout?.occupied, env, layers };
}

async function viaLayout(choice) {
  const { buildMap } = await import('../src/sim/maps.js');
  return buildMap(choice).layout;
}

// ---------- Text output ----------
const num = (v) => String(v);
function colliderLine(c) {
  const shape = c.kind === 'circle' ? `circle ${num(c.x)} ${num(c.y)} r=${num(c.r)}` : `rect ${num(c.x)} ${num(c.y)} ${num(c.w)}x${num(c.h)}`;
  return c.blocksBullets === false ? `${shape} walk-only` : shape;
}

function logicLines(m) {
  const out = [];
  out.push(`colliders ${m.colliders.length}`, ...m.colliders.map(colliderLine));
  out.push(`props ${m.props.length}`, ...m.props.map((p) => `${p.kind} ${num(p.x)} ${num(p.y)}`));
  out.push(`weaponSpots ${m.weaponSpots.length}`, ...m.weaponSpots.map((w) => `${w.kind} ${num(w.x)} ${num(w.y)}`));
  if (m.occupied) out.push(`occupied ${m.occupied.length}`, ...m.occupied.map((o) => `${num(o.x)} ${num(o.y)} r=${num(o.r)}`));
  return out;
}

// One line per object, keys sorted: numbers and strings as they are, sprites by texture name.
function flat(o) {
  const parts = [];
  for (const [k, v] of Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') parts.push(`${k}=${v}`);
    else if (v && v.texture) parts.push(`${k}=${v.texture.name}@${v.x},${v.y}`);
    else if (v && v.name) parts.push(`${k}=${v.name}`);
    else if (Array.isArray(v) && v[0]?.name) parts.push(`${k}=${v.map((t) => t.name).join('|')}`);
  }
  return parts.join(' ');
}

function nodeLine(n) {
  const kind = n.constructor.name;
  const tex = n.texture ? ` ${n.texture.name}` : '';
  return `${kind}${tex} ${n.x},${n.y} scale=${n.scale.x},${n.scale.y} skew=${n.skew.x},${n.skew.y} z=${n.zIndex} a=${n.alpha} tint=${n.tint ?? ''} blend=${n.blendMode ?? ''}` +
    (n.children.length ? ` [${n.children.map(nodeLine).join('; ')}]` : '');
}

function drawLines({ env, layers }) {
  const out = [];
  for (const name of ['ocean', 'terrain', 'foam', 'ground', 'shadows', 'objects', 'lights', 'air']) {
    const kids = layers[name].children;
    out.push(`layer ${name} ${kids.length}`, ...kids.map(nodeLine));
  }
  for (const key of ['cullables', 'tall', 'fading', 'swayers', 'emitters', 'lights', 'lamps', 'gulls', 'butterflies', 'vents', 'clouds', 'flows']) {
    if (!Array.isArray(env[key])) continue;
    out.push(`${key} ${env[key].length}`, ...env[key].map((e) => (e.position ? nodeLine(e) : flat(e))));
  }
  for (const b of env.belts ?? []) out.push(`belt ${flat(b.b)}`, ...b.cartons.map(flat), `machines ${b.machines.join(',')}`);
  if (env.furnace) out.push(`furnace ${flat(env.furnace)}`);
  if (env.flag) out.push(`flag ${nodeLine(env.flag)}`);
  return out;
}

// ---------- Main ----------
if (SCENE) register('data:text/javascript,' + encodeURIComponent(HOOKS));
const { THEMES, makeChoice } = await import(SCENE ? '../src/maps.js' : '../src/sim/maps.js');
const lines = [];
for (const theme of THEMES) {
  for (const v of theme.variants) {
    const choice = makeChoice(theme.id, v.id);
    const m = SCENE ? await viaScene(choice) : await viaLayout(choice);
    lines.push(`== ${theme.id}/${v.id} seed ${choice.seed}`, ...logicLines(m));
    if (DRAW) lines.push(...drawLines(m));
  }
}
const text = lines.join('\n') + '\n';

if (CHECK) {
  const base = readFileSync(BASELINE, 'utf8');
  if (base === text) {
    console.log(`identical to tools/layout-baseline.txt (${lines.length} lines)`);
  } else {
    const a = base.split('\n'), b = text.split('\n');
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(`differs from tools/layout-baseline.txt at line ${i + 1}:\n  baseline: ${a[i]}\n  now:      ${b[i]}`);
    process.exitCode = 1;
  }
} else {
  process.stdout.write(text);
}
