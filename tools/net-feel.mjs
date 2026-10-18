// Online feel without a browser: a naiwa-server in this process, two clients over a lagged
// connection (tools/lag.mjs) drawing through NetSim (src/net/netsim.js) as the browser does,
// and numbers for how the prediction and the timeline behave:
//   - error: the predicted position of client A's player at each command the server acknowledged
//     against the server's position after that command (0 means the prediction was exact);
//   - correction: how far each reconcile moved the drawn player before smoothing eased it out;
//   - B as drawn by A: the biggest frame-to-frame change of its drawn velocity (px/s), and how
//     often the timeline ran out of patches (it then holds the last one).
// A walks in a square, dashes, rides a conveyor belt, walks into a crate (no enemies), then
// fights waves with sim/bot.js for a minute; B walks circles throughout.
//
//   node tools/net-feel.mjs                                  0, 80, 150 and 250 ms
//   node tools/net-feel.mjs --rtt 150 --jitter 30 --loss 0.01 [--delay 100] [--fight 60]
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
const PORT = Number(opt('port', 7791));
const FIGHT = Number(opt('fight', 60));
const DELAY = opt('delay', null);
const settings = opt('rtt', null) != null
  ? [{ rtt: Number(opt('rtt')), jitter: Number(opt('jitter', 0)), loss: Number(opt('loss', 0)) }]
  : [{ rtt: 0, jitter: 0, loss: 0 }, { rtt: 80, jitter: 10, loss: 0 }, { rtt: 150, jitter: 30, loss: 0.01 }, { rtt: 250, jitter: 50, loss: 0.01 }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 10000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(5); }
};
const pct = (list, p) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);

const server = await start({ ...DEFAULTS, port: PORT, maps: ['factory/dairy'], allowedOrigins: [], maxPlayers: 4, log: false, stats: false });
const room = NaiwaRoom.current;
const { world, layout } = buildMap(makeChoice('factory', 'dairy'));
const belt = world.belts[0];
const crate = layout.props.filter((p) => p.kind === 'crate').sort((a, b) => Math.hypot(a.x - world.spawn.x, a.y - world.spawn.y) - Math.hypot(b.x - world.spawn.x, b.y - world.spawn.y))[0];

async function client(name, net) {
  const r = await join(`ws://127.0.0.1:${PORT}`, { name });
  lag(r, { ...net, rand: mulberry32(name.length * 7 + net.rtt) });
  r.send('ready', r.state.run);
  await until(() => r.state.players.has(r.sessionId), `${name} in the state`);
  return r;
}

async function measure(net) {
  const rA = await client('A', net), rB = await client('Bee', net);
  // No enemies until the fight: the run starts and the intro is held.
  room.state.phaseT = 0;
  await until(() => room.state.phase === 'run', 'the run');
  room.sim.stateT = 1e6;
  const A = new NetSim(rA, world, layout, { telemetry: true, ...(DELAY ? { delay: Number(DELAY) } : {}) });
  const B = new NetSim(rB, world, layout);
  const simA = () => room.sim.players.get(A.localId), simB = () => room.sim.players.get(B.localId);
  for (const P of [simA(), simB()]) P.invuln = 1e6;
  const bot = new Bot(A, A.localId, mulberry32(3));

  // The script: A's command for step n of a phase, and what to set up when it starts.
  const phases = [
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
          if (p.fight) { room.sim.stateT = 0; simA().invuln = 0; }
        }
        const p = phases[phase], PA = A.players.get(A.localId);
        let cmd;
        if (p.fight) {
          if (PA.hp < 40) simA().hp = 100; // keep it in the fight
          cmd = PA && !PA.dead ? bot.command(STEP) ?? idleCommand(PA.aim) : idleCommand(0);
        } else cmd = { ...idleCommand(0), ...p.cmd(n) };
        A.send(cmd);
        const b = steps / 60;
        B.send({ ...idleCommand(0), mx: Math.cos(b * 0.8), my: Math.sin(b * 0.8) });
        n++;
      }
      A.sync(dt); B.sync(dt);
      A.takeEvents(); B.takeEvents();
      const PB = A.players.get(B.localId);
      if (PB) drawn.push([PB.x, PB.y, dt]);
    }, 2);
  });
  // B's drawn velocity, frame to frame.
  let jerk = 0;
  for (let i = 2; i < drawn.length; i++) {
    const [x0, y0, d0] = drawn[i - 2], [x1, y1, d1] = drawn[i - 1], [x2, y2, d2] = drawn[i];
    const v1 = Math.hypot(x1 - x0, y1 - y0) / d1, v2 = Math.hypot(x2 - x1, y2 - y1) / d2;
    if (d1 > 0.005 && d2 > 0.005) jerk = Math.max(jerk, Math.abs(v2 - v1));
  }
  const out = [];
  const names = phases.map((p) => p.name);
  names.forEach((name, i) => {
    const s = stats[name], next = stats[names[i + 1]];
    const errs = A.tele.errors.slice(s.from, next?.from).filter((e) => !skips.some(([a, b]) => e.seq >= a && e.seq < b)).map((e) => e.err);
    const cors = A.tele.corrections.slice(s.cfrom, next?.cfrom);
    out.push(`    ${name.padEnd(6)} error p50 ${f2(pct(errs, 0.5))} p95 ${f2(pct(errs, 0.95))} max ${f1(Math.max(0, ...errs))} px | correction p95 ${f2(pct(cors, 0.95))} max ${f1(Math.max(0, ...cors))} px (${errs.length} acks)`);
  });
  const sB = simB(), PB = A.players.get(B.localId), seat = room.seats.get(rA.sessionId);
  out.push(`    B drawn by A: velocity change at most ${f1(jerk)} px/s per frame; timeline starved ${A.tele.starved} of ${A.tele.frames} frames (at most ${f1(A.tele.over)} ms); drawn ${f1(Math.hypot(PB.x - sB.x, PB.y - sB.y))} px behind the server`);
  const T = A.tele;
  out.push(`    A's shots: ${T.shots} predicted, ${T.matched} of them confirmed by the server; ${T.late} the server fired that the prediction didn't (played late)`);
  out.push(`    rtt ${f1(rA.clock.smoothedRtt())} ms (input ack), ping ${f1(A.ping)} ms, server steps without a command from A ${seat.idleSteps}, commands folded ${seat.folded}`);
  A.destroy(); B.destroy();
  await rA.leave(); await rB.leave();
  await until(() => room.seats.size === 0, 'the seats to free');
  return out;
}

for (const net of settings) {
  console.log(`rtt ${net.rtt} ms, jitter ±${net.jitter / 2} ms each way, loss ${net.loss * 100} % (+200 ms each)`);
  for (const l of await measure(net)) console.log(l);
}
await server.gracefullyShutdown?.(false).catch(() => {});
process.exit(0);
