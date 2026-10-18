// Online feel without a browser: a naiwa-server in this process, two clients over a lagged
// connection (tools/lag.mjs) drawing through NetSim (src/net/netsim.js) as the browser does,
// and numbers for how the prediction and the timeline behave:
//   - error: the predicted position of client A's player at each command the server acknowledged
//     against the server's position after that command (0 means the prediction was exact);
//   - correction: how far each reconcile moved the drawn player before smoothing eased it out;
//   - B as drawn by A: the biggest frame-to-frame change of its drawn velocity (px/s), and how
//     often the timeline ran out of patches (it then holds the last one);
//   - seen vs tested (lag compensation): for each test of one of A's bullets against a target
//     near it, where the server tested the target against where A drew it in the frame that
//     drew that bullet at that point of its flight; and how far apart in time the two were.
//     Own bullets: how many A's prediction ended (a wall, a prop, someone, out of range) where
//     and when the server ended them.
// Co-op: A walks in a square, dashes, rides a conveyor belt, walks into a crate (no enemies),
// then fights waves with sim/bot.js for a minute; B walks circles throughout.
// PvP (--pvp): a duel, A's bot shooting B while B walks circles, then both bots fighting; A's
// first kill (and every 5th after) starts its laugh. Also A's prediction error around its own
// PvP events: hurt (a bullet's knockback), died, respawned, laugh. The first acknowledgement
// that includes the event can't have been predicted (only the server knew); the rest should be
// at the wire's rounding.
//
//   node tools/net-feel.mjs                                  0, 80, 150 and 250 ms
//   node tools/net-feel.mjs --pvp [--duel 30] [--fight 60]   the PvP scenario
//   node tools/net-feel.mjs --rtt 150 --jitter 30 --loss 0.01 [--delay 100] [--fight 60]
//   node tools/net-feel.mjs --rewind off                     bullets tested where targets are now
import { start, DEFAULTS } from '../server/index.js';
import { NaiwaRoom } from '../server/room.js';
import { join } from '../src/net/online.js';
import { NetSim } from '../src/net/netsim.js';
import { Bot } from '../src/sim/bot.js';
import { STEP } from '../src/sim/sim.js';
import { idleCommand } from '../src/sim/entities.js';
import { buildMap, makeChoice } from '../src/sim/maps.js';
import { mulberry32 } from '../src/noise.js';
import { lag } from './lag.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const PVP = args.includes('--pvp');
const PORT = Number(opt('port', 7791));
const FIGHT = Number(opt('fight', 60));
const DUEL = Number(opt('duel', 30));
const DELAY = opt('delay', null);
const REWIND = opt('rewind', 'on') !== 'off';
const settings = opt('rtt', null) != null
  ? [{ rtt: Number(opt('rtt')), jitter: Number(opt('jitter', 0)), loss: Number(opt('loss', 0)) }]
  : PVP
    ? [{ rtt: 0, jitter: 0, loss: 0 }, { rtt: 80, jitter: 10, loss: 0 }, { rtt: 150, jitter: 30, loss: 0 }, { rtt: 250, jitter: 50, loss: 0 }]
    : [{ rtt: 0, jitter: 0, loss: 0 }, { rtt: 80, jitter: 10, loss: 0 }, { rtt: 150, jitter: 30, loss: 0.01 }, { rtt: 250, jitter: 50, loss: 0.01 }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 10000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(5); }
};
const pct = (list, p) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const spread = (list) => `p50 ${f2(pct(list, 0.5))} p95 ${f2(pct(list, 0.95))} max ${f2(Math.max(0, ...list))}`;

const MAP = PVP ? ['island', 'cove'] : ['factory', 'dairy'];
const server = await start({
  ...DEFAULTS, port: PORT, maps: [MAP.join('/')], allowedOrigins: [], maxPlayers: 4, log: false, stats: false,
  mode: PVP ? 'pvp' : 'coop', pvp: { killLimit: 999, timeLimit: 3600 },
});
const room = NaiwaRoom.current;
room.lagComp = { players: REWIND, enemies: REWIND };
const { world, layout } = buildMap(makeChoice(...MAP));
const belt = world.belts?.[0];
const crate = layout.props.filter((p) => p.kind === 'crate').sort((a, b) => Math.hypot(a.x - world.spawn.x, a.y - world.spawn.y) - Math.hypot(b.x - world.spawn.x, b.y - world.spawn.y))[0];

async function client(name, net) {
  const r = await join(`ws://127.0.0.1:${PORT}`, { name });
  lag(r, { ...net, rand: mulberry32(name.length * 7 + net.rtt) });
  r.send('ready', r.state.run);
  await until(() => r.state.players.has(r.sessionId), `${name} in the state`);
  return r;
}

// The server's tests of A's bullets against targets near them: { bid, age, tid, x, y, time }.
function watchTests(idA) {
  const tests = [], seenAt = room.seenAt;
  room.seenAt = (e, b) => {
    const r = seenAt.call(room, e, b);
    if (r && b.owner === idA) {
      const player = room.sim.players.get(e.id) === e, on = player ? room.lagComp.players : room.lagComp.enemies;
      const near = (player ? e.r + 4 : e.r + 6) + 30;
      const time = on ? room.seenTime(b) : room.clock.elapsedTime;
      if (Math.hypot(r.x - b.x, r.y - b.y) < near) tests.push({ bid: b.id, age: b.age, tid: e.id, x: r.x, y: r.y, time });
    }
    return r;
  };
  return { tests, stop: () => { room.seenAt = seenAt; } };
}

// Seen vs tested, from A's frames ({ ms, T, pos: Map id → [x, y] }) and the server's tests.
function seenVsTested(A, frames, tests) {
  const dist = [], off = [];
  let missing = 0;
  for (const s of tests) {
    const fired = A.tele.fired.get(s.bid);
    if (!fired) { missing++; continue; }
    // The frame that drew the bullet at this age (NetSim.flyOwn draws it STEP ahead).
    const ms = fired.c + (s.age - STEP) * 1000;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].ms <= ms) lo = mid; else hi = mid - 1; }
    const a = frames[lo], b = frames[lo + 1];
    const pa = a?.pos.get(s.tid), pb = b?.pos.get(s.tid);
    if (!pa) { missing++; continue; }
    const u = b && pb && b.ms > a.ms ? Math.max(0, Math.min(1, (ms - a.ms) / (b.ms - a.ms))) : 0;
    const x = pb ? pa[0] + (pb[0] - pa[0]) * u : pa[0], y = pb ? pa[1] + (pb[1] - pa[1]) * u : pa[1];
    const T = b ? a.T + (b.T - a.T) * u : a.T;
    dist.push(Math.hypot(x - s.x, y - s.y));
    off.push(Math.abs(T - s.time));
  }
  return { dist, off, missing };
}

// Own bullets the prediction ended as the server did: the same kind of target, within 3 steps.
// `deaths`: server time each target died (killed or a player's death); a bullet the prediction
// ended on a target that had died before the server's bullet got there flew on through it.
function fates(A, deaths) {
  let same = 0, n = 0, dead = 0;
  const differ = {};
  for (const [bid, { pred, srv }] of A.tele.fates) {
    if (!pred.end || !srv) continue;
    n++;
    if (pred.end.kind === srv.kind && Math.abs(pred.end.age - srv.age) <= 3 * STEP + 0.001) { same++; continue; }
    const k = `${pred.end.kind}→${srv.kind}`;
    differ[k] = (differ[k] ?? 0) + 1;
    const died = deaths.get(pred.end.id), t0 = A.tele.fired.get(bid).t0;
    if (died != null && died <= t0 + pred.end.age * 1000 + 20) dead++;
  }
  const d = Object.entries(differ).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
  return `${same} of ${n} own bullets ended where and when the server ended them${d ? ` (predicted→server: ${d}; ${dead} of these on a target the server already had dead)` : ''}`;
}

async function measure(net) {
  const rA = await client('A', net), rB = await client('Bee', net);
  // The run starts at once; co-op holds the intro (no enemies until the fight).
  room.state.phaseT = 0;
  await until(() => room.state.phase === 'run', 'the run');
  if (!PVP) room.sim.stateT = 1e6;
  const A = new NetSim(rA, world, layout, { telemetry: true, ...(DELAY ? { delay: Number(DELAY) } : {}) });
  const B = new NetSim(rB, world, layout);
  const simA = () => room.sim.players.get(A.localId), simB = () => room.sim.players.get(B.localId);
  if (!PVP) for (const P of [simA(), simB()]) P.invuln = 1e6;
  const bot = new Bot(A, A.localId, mulberry32(3)), botB = PVP ? new Bot(B, B.localId, mulberry32(5)) : null;
  const watch = watchTests(A.localId);
  const seatA = room.seats.get(rA.sessionId);
  // PvP: A's own events, with the command the server was on; deaths of enemies and players.
  const marks = [], deaths = new Map();
  if (PVP) simA().kills = 4;
  const sim = room.sim, take = sim.takeEvents.bind(sim);
  sim.takeEvents = () => {
    const ev = take();
    for (const e of ev) {
      if (e.id === A.localId && ['hurt', 'died', 'respawned', 'laugh'].includes(e.type)) marks.push({ type: e.type, seq: seatA.seq });
      if (e.type === 'kill' || e.type === 'died') deaths.set(e.id, room.clock.elapsedTime);
    }
    return ev;
  };

  // The script: A's command for step n of a phase, and what to set up when it starts.
  const phases = PVP
    ? [{ name: 'duel', secs: DUEL, fight: true }, { name: 'fight', secs: FIGHT, fight: true, both: true }]
    : [
      { name: 'walk', secs: 6, cmd: (n) => { const a = Math.floor(n / 60) * Math.PI / 2; return { mx: Math.cos(a), my: Math.sin(a) }; } },
      { name: 'dash', secs: 5, cmd: (n) => ({ mx: n % 96 < 48 ? 1 : -1, my: 0.3, dash: n % 48 === 10 }) },
      { name: 'belt', secs: 5, at: { x: belt.x + belt.w / 2, y: belt.y - 34 }, cmd: (n) => (n < 30 ? { my: 1 } : n < 200 ? {} : { my: 1 }) },
      { name: 'crate', secs: 4, at: { x: crate.x - 90, y: crate.y - 12 }, cmd: (n) => (n < 120 ? { mx: 1 } : { mx: 0.4, my: n < 180 ? 1 : -1 }) },
      { name: 'fight', secs: FIGHT, fight: true },
    ];
  const stats = {};
  let phase = -1, n = 0, steps = 0;
  const skips = []; // [from, to): commands around a teleport, left out of the errors
  const drawn = []; // B as A draws it, per frame: [x, y]
  const frames = []; // what A draws, per frame: { ms, T, pos: Map id → [x, y] } (others and enemies)
  const t0 = performance.now();
  let last = t0;
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = performance.now(), due = Math.floor((now - t0) / 1000 / STEP);
      if (due <= steps) return;
      const dt = (now - last) / 1000;
      last = now;
      A.tick(dt); B.tick(dt);
      for (; steps < due; steps++) {
        const total = phases.slice(0, phase + 1).reduce((s, p) => s + p.secs * 60, 0);
        if (steps >= total) {
          phase++; n = 0;
          if (phase >= phases.length) { clearInterval(timer); resolve(); return; }
          const p = phases[phase];
          stats[p.name] = { from: A.tele.errors.length, cfrom: A.tele.corrections.length };
          if (p.at) {
            const P = simA(); P.x = p.at.x; P.y = p.at.y; P.vx = P.vy = 0;
            skips.push([A.input.sentCount - Math.ceil((net.rtt + 200) / 1000 / STEP), A.input.sentCount + Math.ceil((net.rtt + 300) / 1000 / STEP)]);
          }
          if (p.fight && !PVP) { room.sim.stateT = 0; simA().invuln = 0; }
        }
        const p = phases[phase], PA = A.players.get(A.localId);
        let cmd;
        if (p.fight) {
          if (!PVP && PA.hp < 40) simA().hp = 100; // keep it in the fight
          cmd = PA && !PA.dead ? bot.command(STEP) ?? idleCommand(PA.aim) : idleCommand(0);
        } else cmd = { ...idleCommand(0), ...p.cmd(n) };
        A.send(cmd);
        // PvP: every 5th kill laughs; after one, the next kill is a 5th again.
        if (PVP) { const P = simA(); if (P && P.kills % 5 === 0 && P.laughT < 0) P.kills += 4; }
        const b = steps / 60, PB = B.players.get(B.localId);
        if (p.both) B.send(PB && !PB.dead ? botB.command(STEP) ?? idleCommand(PB.aim) : idleCommand(0));
        else B.send({ ...idleCommand(0), mx: Math.cos(b * 0.8), my: Math.sin(b * 0.8) });
        n++;
      }
      A.sync(dt); B.sync(dt);
      A.takeEvents(); B.takeEvents();
      const pos = new Map();
      for (const [id, P] of A.players) if (id !== A.localId) pos.set(id, [P.x, P.y]);
      for (const e of A.enemies) pos.set(e.id, [e.x, e.y]);
      frames.push({ ms: A.ms, T: A.T, pos });
      const PB = A.players.get(B.localId);
      if (PB) drawn.push([PB.x, PB.y, dt]);
    }, 2);
  });
  watch.stop();
  // B's drawn velocity, frame to frame (not across its respawns).
  let jerk = 0;
  for (let i = 2; i < drawn.length; i++) {
    const [x0, y0, d0] = drawn[i - 2], [x1, y1, d1] = drawn[i - 1], [x2, y2, d2] = drawn[i];
    const v1 = Math.hypot(x1 - x0, y1 - y0) / d1, v2 = Math.hypot(x2 - x1, y2 - y1) / d2;
    if (d1 > 0.005 && d2 > 0.005 && v1 < 1500 && v2 < 1500) jerk = Math.max(jerk, Math.abs(v2 - v1));
  }
  const out = [];
  const names = phases.map((p) => p.name);
  // PvP: the first acknowledgement that includes each of A's events, left out of the phases'
  // errors and shown on its own.
  const firstAck = new Map(); // error index → event type
  for (const m of marks) {
    const i = A.tele.errors.findIndex((e) => e.seq >= m.seq);
    if (i >= 0 && !firstAck.has(i)) firstAck.set(i, m.type);
  }
  names.forEach((name, i) => {
    const s = stats[name], next = stats[names[i + 1]];
    const errs = A.tele.errors.slice(s.from, next?.from).filter((e, k) => !firstAck.has(s.from + k) && !skips.some(([a, b]) => e.seq >= a && e.seq < b)).map((e) => e.err);
    const cors = A.tele.corrections.slice(s.cfrom, next?.cfrom);
    out.push(`    ${name.padEnd(6)} error p50 ${f2(pct(errs, 0.5))} p95 ${f2(pct(errs, 0.95))} max ${f1(Math.max(0, ...errs))} px | correction p95 ${f2(pct(cors, 0.95))} max ${f1(Math.max(0, ...cors))} px (${errs.length} acks)`);
  });
  if (PVP) {
    // Each event: the first ack that includes it, then the next second's acks (60 commands).
    for (const type of ['hurt', 'died', 'respawned', 'laugh']) {
      const ms = marks.filter((m) => m.type === type);
      const first = [], after = [];
      for (const m of ms) {
        const errs = A.tele.errors.filter((e) => e.seq >= m.seq && e.seq <= m.seq + 60);
        if (!errs.length) continue;
        first.push(errs[0].err);
        for (const e of errs.slice(1)) if (!firstAck.has(A.tele.errors.indexOf(e))) after.push(e.err);
      }
      out.push(`    around ${type.padEnd(9)} (${ms.length}): first ack ${spread(first)} px; the next second ${spread(after)} px (${after.length} acks)`);
    }
  }
  const sB = simB(), PB = A.players.get(B.localId), seat = room.seats.get(rA.sessionId);
  out.push(`    B drawn by A: velocity change at most ${f1(jerk)} px/s per frame; timeline starved ${A.tele.starved} of ${A.tele.frames} frames (at most ${f1(A.tele.over)} ms); drawn ${f1(Math.hypot(PB.x - sB.x, PB.y - sB.y))} px behind the server`);
  const sv = seenVsTested(A, frames, watch.tests);
  out.push(`    A's bullets, ${PVP ? 'B' : 'enemies'} seen vs tested (${REWIND ? 'rewound' : 'current positions'}): ${spread(sv.dist)} px, time apart p95 ${f1(pct(sv.off, 0.95))} ms (${sv.dist.length} tests${sv.missing ? `, ${sv.missing} not drawn` : ''})`);
  out.push(`    ${fates(A, deaths)}`);
  const T = A.tele;
  out.push(`    A's shots: ${T.shots} predicted, ${T.matched} of them confirmed by the server; ${T.late} the server fired that the prediction didn't (played late)`);
  if (PVP) { const P = simA(); out.push(`    A: ${P.kills} kills (counting the laugh's +4s), ${P.downs} deaths`); }
  out.push(`    rtt ${f1(rA.clock.smoothedRtt())} ms (input ack), ping ${f1(A.ping)} ms, server steps without a command from A ${seat.idleSteps}, commands folded ${seat.folded}`);
  A.destroy(); B.destroy();
  await rA.leave(); await rB.leave();
  await until(() => room.seats.size === 0, 'the seats to free');
  return out;
}

for (const net of settings) {
  console.log(`${PVP ? 'PvP, ' : ''}rtt ${net.rtt} ms, jitter ±${net.jitter / 2} ms each way, loss ${net.loss * 100} % (+200 ms each)`);
  for (const l of await measure(net)) console.log(l);
}
await server.gracefullyShutdown?.(false).catch(() => {});
process.exit(0);
