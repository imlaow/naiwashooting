// Runs the game headless in plain Node (no Pixi, no DOM, no stubs) with scripted bots
// (src/sim/bot.js) on every preset map, and reports how far they got. A check that src/sim runs
// on its own, as a server will run it.
//
//   node tools/sim-headless.mjs                 10 minutes of game time on every preset map
//   node tools/sim-headless.mjs --minutes 2 --map island/cove --seed 7
//   node tools/sim-headless.mjs --players 3     co-op with 3 bots (1–4)
//   node tools/sim-headless.mjs --trace > a.txt  also prints the state once per game second, so
//                                                two versions of the sim can be compared with diff
//
// When the run is over (every bot down or dead) a new one starts on the same map. In co-op, each
// run starts with one bot fewer and the last one joins 5 s into wave 2, so it waits for the wave
// break; with 3 or more, one bot also leaves when wave 4 starts and a new one joins 10 s later.
// Exits with code 1 on any error: an exception, a position that isn't a number, a player off
// walkable ground, or a fight with no kill for STALL seconds.
import { THEMES, makeChoice, buildMap } from '../src/sim/maps.js';
import { Sim, STEP } from '../src/sim/sim.js';
import { Bot } from '../src/sim/bot.js';
import { mulberry32 } from '../src/noise.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const MINUTES = Number(opt('minutes', 10));
const ONLY = opt('map', null);
const SEED = Number(opt('seed', 1));
const TRACE = args.includes('--trace');
const PLAYERS = Math.max(1, Math.min(4, Number(opt('players', 1))));
const STALL = 120;

// The sim may use Math.random; seed it so a run can be repeated.
Math.random = mulberry32(SEED);

function playMap(choice) {
  const t0 = performance.now();
  const { world, layout } = buildMap(choice);
  const buildMs = performance.now() - t0;
  const r = {
    map: `${choice.theme}/${choice.id}`, buildMs, runs: [], deaths: 0, kills: 0, errors: [], events: {}, maxEnemies: 0, longestQuiet: 0,
    bots: [], joins: [],
  };
  const steps = Math.round((MINUTES * 60) / STEP);
  let sim = null, bots = null, added = 0, quietT = 0, stepMs = 0, plan = null;
  // Bots are numbered in the order they joined over the whole session (n); each run's k-th bot
  // gets the same random stream.
  const addBot = () => {
    const P = sim.addPlayer(), n = r.bots.length;
    const b = new Bot(sim, P.id, mulberry32(SEED + 99 + added++));
    b.n = n;
    r.bots.push({ kills: 0, downs: 0, revives: 0, deaths: 0, respawns: 0 });
    bots.set(P.id, b);
    return b;
  };
  const newRun = () => {
    sim = new Sim(world, layout);
    bots = new Map();
    added = 0;
    for (let i = 0; i < (PLAYERS > 1 ? PLAYERS - 1 : 1); i++) addBot();
    // Co-op: who joins and leaves during the run (seconds into a wave).
    plan = PLAYERS > 1 ? [{ wave: 2, at: 5, join: true }] : [];
    if (PLAYERS > 2) plan.push({ wave: 4, at: 0, leave: true }, { wave: 4, at: 10, join: true });
    quietT = 0;
  };
  const endRun = () => r.runs.push({ wave: sim.wave, kills: sim.kills, score: sim.score, seconds: Math.round(sim.time) });
  let waveT = 0;
  newRun();
  for (let i = 0; i < steps; i++) {
    waveT = sim.state === 'fight' ? waveT + STEP : 0;
    while (plan.length && sim.wave >= plan[0].wave && sim.state === 'fight' && waveT >= plan[0].at) {
      const p = plan.shift();
      if (p.join) {
        const b = addBot();
        r.joins.push({ n: b.n, t: sim.time, wave: sim.wave, waiting: sim.players.get(b.id).dead });
      } else {
        // The first bot that is up leaves.
        const b = [...bots.values()].find((x) => sim.players.get(x.id).up) ?? bots.values().next().value;
        sim.removePlayer(b.id);
        bots.delete(b.id);
        r.joins.push({ n: b.n, t: sim.time, wave: sim.wave, left: true });
      }
    }
    const cmds = {};
    try {
      for (const b of bots.values()) cmds[b.id] = b.command(STEP);
      const s0 = performance.now();
      sim.step(STEP, cmds);
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
      const st = (id) => r.bots[bots.get(id)?.n];
      if (e.type === 'kill' && e.by != null && st(e.by)) st(e.by).kills++;
      else if (e.type === 'downed') st(e.id).downs++;
      else if (e.type === 'revived') st(e.by).revives++;
      else if (e.type === 'died' && PLAYERS > 1) st(e.id).deaths++;
      else if (e.type === 'respawned' && !e.joined) st(e.id).respawns++;
      else if (e.type === 'respawned') {
        const j = r.joins.findLast((x) => x.n === bots.get(e.id).n && !x.left);
        if (e.joined && j && j.waiting && j.entered == null) j.entered = { t: sim.time, wave: sim.wave + 1 };
      }
    }
    r.maxEnemies = Math.max(r.maxEnemies, sim.enemies.length);
    for (const P of sim.players.values()) {
      if (!Number.isFinite(P.x + P.y + P.hp)) r.errors.push(`t=${sim.time.toFixed(2)} player ${P.id} position or hp is not a number`);
      if (!P.dead && !world.isWalkable(P.x, P.y)) r.errors.push(`t=${sim.time.toFixed(2)} player ${P.id} off walkable ground at ${P.x.toFixed(0)},${P.y.toFixed(0)}`);
    }
    if (sim.enemies.some((e) => !Number.isFinite(e.x + e.y + e.hp))) r.errors.push(`t=${sim.time.toFixed(2)} position or hp is not a number`);
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
      const [P, ...mates] = sim.players.values();
      console.log(`${r.map} t=${f(sim.time)} wave=${sim.wave} ${sim.state} score=${sim.score} kills=${sim.kills} hp=${f(P.hp)} ` +
        `at=${f(P.x)},${f(P.y)} ${P.weapon} ${P.slot.mag}/${P.slot.reserve} enemies=${sim.enemies.length} queue=${sim.queue.length} ` +
        `props=${sim.props.length} pickups=${sim.pickups.length} bullets=${sim.bullets.length}` +
        mates.map((o) => ` | p${o.id} ${o.dead ? 'dead' : o.down ? `down ${o.bleedT.toFixed(1)} rev ${o.reviveT.toFixed(2)}` : 'up'} hp=${f(o.hp)} at=${f(o.x)},${f(o.y)} k=${o.kills}`).join('') +
        (PLAYERS > 1 && sim.enemies[0] ? ` | e0 ${sim.enemies[0].type} at=${f(sim.enemies[0].x)},${f(sim.enemies[0].y)} hp=${sim.enemies[0].hp} target=p${sim.enemies[0].target?.id}` : ''));
    }
    if (r.errors.length > 20) break;
    if (sim.state === 'dead') {
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

console.log(`${MINUTES} min of game time per map, seed ${SEED}${PLAYERS > 1 ? `, ${PLAYERS} bots (co-op)` : ''}\n`);
let failed = 0;
for (const choice of todo) {
  const r = playMap(choice);
  const best = Math.max(...r.runs.map((x) => x.wave));
  const ev = r.events;
  if (PLAYERS === 1) {
    console.log(`${r.map.padEnd(16)} waves ${r.runs.map((x) => x.wave).join(', ').padEnd(12)} best ${String(best).padStart(2)}  kills ${String(r.kills).padStart(4)}  deaths ${r.deaths}  errors ${r.errors.length}`);
  } else {
    const sum = (k) => r.bots.reduce((s, b) => s + b[k], 0);
    console.log(`${r.map.padEnd(16)} waves ${r.runs.map((x) => x.wave).join(', ').padEnd(12)} best ${String(best).padStart(2)}  kills ${String(r.kills).padStart(4)}  runs over ${r.deaths}  errors ${r.errors.length}`);
    console.log(`${''.padEnd(16)} kills per bot ${r.bots.map((b, i) => `b${i + 1} ${b.kills}`).join(', ')}`);
    console.log(`${''.padEnd(16)} downs ${sum('downs')}, revives ${sum('revives')}, deaths (bled out) ${sum('deaths')}, respawns ${sum('respawns')}`);
    console.log(`${''.padEnd(16)} joined / left mid-run: ${r.joins.map((j) => j.left ? `b${j.n + 1} left (wave ${j.wave})` : `b${j.n + 1} joined in wave ${j.wave}${j.waiting ? `, in at ${j.entered ? `wave ${j.entered.wave}` : 'run end: never'}` : ', in at once'}`).join('; ') || 'none'}`);
  }
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
