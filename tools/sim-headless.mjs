// Runs the game headless in plain Node (no Pixi, no DOM, no stubs) with a scripted bot on every
// preset map, and reports how far it got. A check that src/sim runs on its own, as a server will
// run it.
//
//   node tools/sim-headless.mjs                 10 minutes of game time on every preset map
//   node tools/sim-headless.mjs --minutes 2 --map island/cove --seed 7
//   node tools/sim-headless.mjs --trace > a.txt  also prints the state once per game second, so
//                                                two versions of the sim can be compared with diff
//
// The bot moves, aims at the nearest enemy, shoots, dashes away from eggs, reloads, switches to
// its best gun and walks over pickups. When it dies a new run starts on the same map. Exits with
// code 1 on any error: an exception, a position that isn't a number, the player off walkable
// ground, or a fight with no kill for STALL seconds.
import { THEMES, makeChoice, buildMap } from '../src/sim/maps.js';
import { Sim, STEP } from '../src/sim/sim.js';
import { WEAPONS } from '../src/sim/entities.js';
import { mulberry32 } from '../src/noise.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const MINUTES = Number(opt('minutes', 10));
const ONLY = opt('map', null);
const SEED = Number(opt('seed', 1));
const TRACE = args.includes('--trace');
const STALL = 120;

// The sim may use Math.random; seed it so a run can be repeated.
Math.random = mulberry32(SEED);

class Bot {
  constructor(sim) {
    this.sim = sim;
    this.rand = mulberry32(SEED + 99);
    this.stuckT = 0; this.detourT = 0; this.detour = 0;
    this.lastX = sim.player.x; this.lastY = sim.player.y; this.checkT = 1;
  }

  wants(p) {
    const P = this.sim.player;
    if (p.kind === 'health') return P.hp < P.maxHp && P.laughT < 0;
    if (p.kind === 'ammo') return Object.keys(P.arsenal).length > 1;
    return true;
  }

  // The best gun it has ammo for at this range.
  pickWeapon(dist) {
    const P = this.sim.player;
    const has = (k) => P.arsenal[k] && P.arsenal[k].mag + P.arsenal[k].reserve > 0;
    if (dist < 260 && has('shotgun')) return 'shotgun';
    for (const k of ['rifle', 'smg', 'shotgun']) if (has(k)) return k;
    return 'pistol';
  }

  command(dt) {
    const sim = this.sim, P = sim.player;
    let target = null, td = Infinity;
    for (const e of sim.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d < td) { td = d; target = e; }
    }
    const seen = target && sim.statics.clearLine(P.x, P.y, target.x, target.y, 6);
    let pick = null, pd = 700;
    for (const p of sim.pickups) {
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if (d < pd && this.wants(p)) { pd = d; pick = p; }
    }

    let dx = 0, dy = 0, dash = false;
    if (target && td < 200) {
      // Back off, sideways a little so it doesn't run into a wall in a straight line.
      dx = (P.x - target.x) / td - (target.y - P.y) / td * 0.5;
      dy = (P.y - target.y) / td + (target.x - P.x) / td * 0.5;
      dash = td < 90 && P.dashCd <= 0;
    } else if (pick) {
      dx = pick.x - P.x; dy = pick.y - P.y;
    } else if (target && (!seen || td > 420)) {
      dx = target.x - P.x; dy = target.y - P.y;
    } else if (target) {
      dx = -(target.y - P.y); dy = target.x - P.x;
    }
    // Detour when it has been trying to move but hasn't got anywhere for a second.
    this.checkT -= dt;
    if (this.checkT <= 0) {
      const moved = Math.hypot(P.x - this.lastX, P.y - this.lastY);
      if ((dx || dy) && moved < 40) { this.detourT = 0.8 + this.rand(); this.detour = this.rand() * Math.PI * 2; }
      this.lastX = P.x; this.lastY = P.y; this.checkT = 1;
    }
    if (this.detourT > 0) { this.detourT -= dt; dx = Math.cos(this.detour); dy = Math.sin(this.detour); }
    const l = Math.hypot(dx, dy);
    if (l > 0) { dx /= l; dy /= l; }

    const slot = P.slot;
    const weapon = this.pickWeapon(target ? td : Infinity);
    return {
      mx: dx, my: dy,
      aim: target ? Math.atan2(target.y - P.y, target.x - P.x) : P.aim,
      fire: !!target && seen && td < 650,
      dash, dashDir: null,
      reload: slot.mag === 0 || (!seen && slot.mag < WEAPONS[P.weapon].mag / 2),
      weapon: weapon !== P.weapon ? weapon : null,
      cycle: 0, last: false,
    };
  }
}

function playMap(choice) {
  const t0 = performance.now();
  const { world, layout } = buildMap(choice);
  const buildMs = performance.now() - t0;
  const r = { map: `${choice.theme}/${choice.id}`, buildMs, runs: [], deaths: 0, kills: 0, errors: [], events: {}, maxEnemies: 0, longestQuiet: 0 };
  const steps = Math.round((MINUTES * 60) / STEP);
  let sim = null, bot = null, quietT = 0, stepMs = 0;
  const newRun = () => {
    sim = new Sim(world, layout);
    bot = new Bot(sim);
    quietT = 0;
  };
  const endRun = () => r.runs.push({ wave: sim.wave, kills: sim.kills, score: sim.score, seconds: Math.round(sim.time) });
  newRun();
  for (let i = 0; i < steps; i++) {
    try {
      const s0 = performance.now();
      sim.step(STEP, bot.command(STEP));
      stepMs += performance.now() - s0;
    } catch (err) {
      r.errors.push(`t=${sim.time.toFixed(2)} ${err.stack}`);
      endRun();
      newRun();
      continue;
    }
    for (const e of sim.takeEvents()) {
      const key = e.type === 'propBroken' ? e.kind : e.type === 'kill' && e.enemyType === 'boss' ? 'boss' : e.type;
      r.events[key] = (r.events[key] ?? 0) + 1;
      if (e.type === 'kill' || e.type === 'wave') quietT = 0;
    }
    const P = sim.player;
    r.maxEnemies = Math.max(r.maxEnemies, sim.enemies.length);
    if (!Number.isFinite(P.x + P.y + P.hp) || sim.enemies.some((e) => !Number.isFinite(e.x + e.y + e.hp))) r.errors.push(`t=${sim.time.toFixed(2)} position or hp is not a number`);
    if (!P.dead && !world.isWalkable(P.x, P.y)) r.errors.push(`t=${sim.time.toFixed(2)} player off walkable ground at ${P.x.toFixed(0)},${P.y.toFixed(0)}`);
    if (sim.state === 'fight') {
      quietT += STEP;
      r.longestQuiet = Math.max(r.longestQuiet, quietT);
      if (quietT > STALL) {
        r.errors.push(`t=${sim.time.toFixed(2)} wave ${sim.wave} stalled: no kill for ${STALL} s, ${sim.enemies.length} enemies left, ${sim.queue.length} queued`);
        quietT = -Infinity;
      }
    }
    if (TRACE && i % 60 === 59) {
      const f = (v) => v.toFixed(4);
      console.log(`${r.map} t=${f(sim.time)} wave=${sim.wave} ${sim.state} score=${sim.score} kills=${sim.kills} hp=${f(P.hp)} ` +
        `at=${f(P.x)},${f(P.y)} ${P.weapon} ${P.slot.mag}/${P.slot.reserve} enemies=${sim.enemies.length} queue=${sim.queue.length} ` +
        `props=${sim.props.length} pickups=${sim.pickups.length} bullets=${sim.bullets.length}`);
    }
    if (r.errors.length > 20) break;
    if (P.dead) {
      r.deaths++;
      endRun();
      newRun();
    }
  }
  endRun();
  r.kills = r.runs.reduce((s, x) => s + x.kills, 0);
  r.stepUs = (stepMs / steps) * 1000;
  return r;
}

const maps = [];
for (const th of THEMES) for (const v of th.variants) maps.push(makeChoice(th.id, v.id));
const todo = ONLY ? maps.filter((c) => `${c.theme}/${c.id}` === ONLY) : maps;
if (!todo.length) { console.error(`no preset map ${ONLY}`); process.exit(1); }

console.log(`${MINUTES} min of game time per map, seed ${SEED}\n`);
let failed = 0;
for (const choice of todo) {
  const r = playMap(choice);
  const best = Math.max(...r.runs.map((x) => x.wave));
  const ev = r.events;
  console.log(`${r.map.padEnd(16)} waves ${r.runs.map((x) => x.wave).join(', ').padEnd(12)} best ${String(best).padStart(2)}  kills ${String(r.kills).padStart(4)}  deaths ${r.deaths}  errors ${r.errors.length}`);
  console.log(`${''.padEnd(16)} shots ${ev.shot ?? 0}, crates ${ev.crate ?? 0}, barrels ${ev.barrel ?? 0}, pickups ${ev.pickup ?? 0}, laughs ${ev.laugh ?? 0}, ` +
    `King Naiwa ${ev.boss ?? 0}, most enemies ${r.maxEnemies}, longest fight without a kill ${r.longestQuiet.toFixed(0)} s`);
  // Timings change from run to run, so a trace leaves them out.
  if (!TRACE) console.log(`${''.padEnd(16)} map built in ${r.buildMs.toFixed(0)} ms, ${r.stepUs.toFixed(0)} µs per step`);
  for (const e of r.errors) console.log(`  ERROR ${e}`);
  if (r.errors.length) failed++;
}
if (failed) {
  console.log(`\n${failed} map(s) with errors`);
  process.exitCode = 1;
} else {
  console.log('\nno errors');
}
