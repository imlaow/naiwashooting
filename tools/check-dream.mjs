// Checks the dream maps' layouts: every landmark and weapon stands on King Naiwa, no two solids
// overlap, and the spawn reaches every weapon and both feet on foot (a 16 px flood fill around
// the colliders, for a body 18 px wide). The preset and --seeds N random ones (default 200).
//
//   node tools/check-dream.mjs [--seeds 500]
import { buildMap, makeChoice, RANDOM_ID } from '../src/sim/maps.js';

const i = process.argv.indexOf('--seeds');
const SEEDS = i > 0 ? Number(process.argv[i + 1]) : 200;
const G = 16, BODY = 18;
let bad = 0;

function check(choice) {
  const { world, layout } = buildMap(choice);
  const fail = (msg) => { bad++; console.log(`dream/${choice.id} seed ${choice.seed}: ${msg}`); };
  const cs = layout.colliders;
  for (const c of cs) if (!world.onBody(c.x, c.y)) fail(`a solid at ${c.x},${c.y} is off him`);
  for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
    if (Math.hypot(cs[a].x - cs[b].x, cs[a].y - cs[b].y) < cs[a].r + cs[b].r) fail(`solids overlap at ${cs[a].x},${cs[a].y}`);
  }
  for (const p of layout.props) if (!world.onBody(p.x, p.y)) fail(`a ${p.kind} at ${p.x},${p.y} is off him`);
  const n = Math.ceil(world.size / G);
  const open = (gx, gy) => {
    const x = gx * G, y = gy * G;
    return world.isWalkable(x, y) && !cs.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + BODY);
  };
  const seen = new Uint8Array(n * n);
  const start = [Math.round(world.spawn.x / G), Math.round(world.spawn.y / G)];
  if (!open(...start)) fail('the spawn is blocked');
  const queue = [start];
  seen[start[1] * n + start[0]] = 1;
  while (queue.length) {
    const [gx, gy] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n || seen[y * n + x] || !open(x, y)) continue;
      seen[y * n + x] = 1;
      queue.push([x, y]);
    }
  }
  const reached = (p) => seen[Math.round(p.y / G) * n + Math.round(p.x / G)];
  for (const w of layout.weaponSpots) if (!reached(w)) fail(`the ${w.kind} at ${w.x},${w.y} can't be reached`);
  for (const [name, p] of [['left foot', world.at(50, 630)], ['right foot', world.at(432, 635)], ['milk', world.puddle]]) {
    if (!reached(p)) fail(`his ${name} can't be reached`);
  }
  return layout;
}

const preset = check(makeChoice('dream', 'king'));
console.log(`dream/king: ${preset.colliders.length} solids, ${preset.props.length} props, weapons at ${preset.weaponSpots.map((w) => `${w.kind} ${w.x},${w.y}`).join('; ')}`);
for (let s = 1; s <= SEEDS; s++) check(makeChoice('dream', RANDOM_ID, s * 7919));
console.log(bad ? `${bad} problems` : `${SEEDS + 1} layouts: all good`);
process.exitCode = bad ? 1 : 0;
