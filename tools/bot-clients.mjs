// Plays a naiwa-server with scripted clients over real WebSockets: starts the server
// (server/index.js) on a spare port with stats on, joins N clients that each drive their player
// with sim/bot.js through a NetSim (src/net/netsim.js), the same mirror the browser draws, and
// reports waves, kills per client, downs and revives, errors, and the server's own stats
// (time per tick, memory, bytes sent per client) plus its CPU use.
//
//   npm install --prefix server       once
//   node tools/bot-clients.mjs                       3 clients, 3 minutes, real time
//   node tools/bot-clients.mjs --clients 4 --minutes 5 --maps island/cove,factory/dairy
//   node tools/bot-clients.mjs --rtt 150 --jitter 30 --loss 0.01    over a bad network (tools/lag.mjs)
//   node tools/bot-clients.mjs --wave 8 [--patch-ms 33]             runs start at wave 8 (a busy fight;
//                                                                   tools/server-tweaks.mjs)
//
// Exits with code 1 on any error: an exception, a client dropped, a position that isn't a
// number, or no wave progress.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from '../src/net/online.js';
import { NetSim } from '../src/net/netsim.js';
import { Bot } from '../src/sim/bot.js';
import { STEP } from '../src/sim/sim.js';
import { idleCommand } from '../src/sim/entities.js';
import { buildMap, makeChoice, choiceKey } from '../src/sim/maps.js';
import { mulberry32 } from '../src/noise.js';
import { lag } from './lag.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const CLIENTS = Math.max(1, Math.min(8, Number(opt('clients', 3))));
const MINUTES = Number(opt('minutes', 3));
const PORT = Number(opt('port', 7790));
const MAPS = opt('maps', 'island/cove,factory/dairy,island/twins').split(',');
const WAVE = Number(opt('wave', 0)), PATCH_MS = Number(opt('patch-ms', 0));
const NET = { rtt: Number(opt('rtt', 0)), jitter: Number(opt('jitter', 0)), loss: Number(opt('loss', 0)) };

// ---------- The server ----------
const dir = mkdtempSync(joinPath(tmpdir(), 'naiwa-bots-'));
const cfgFile = joinPath(dir, 'server.json');
writeFileSync(cfgFile, JSON.stringify({ name: 'bots', port: PORT, mode: 'coop', maxPlayers: CLIENTS, password: '', maps: MAPS, allowedOrigins: [], stats: true }));
const tweaks = WAVE || PATCH_MS ? ['--import', fileURLToPath(new URL('./server-tweaks.mjs', import.meta.url))] : [];
const server = spawn(process.execPath, [...tweaks, fileURLToPath(new URL('../server/index.js', import.meta.url)), cfgFile], {
  stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BOT_WAVE: String(WAVE), BOT_PATCH_MS: String(PATCH_MS) },
});
const stats = [];
const errors = [];
let serverOut = '';
server.stdout.on('data', (d) => {
  serverOut += d;
  for (const line of String(d).split('\n')) if (line.startsWith('[stats]')) stats.push(line);
});
server.stderr.on('data', (d) => { errors.push(`server: ${String(d).trim()}`); });
await new Promise((resolve, reject) => {
  const t = setInterval(() => { if (serverOut.includes('naiwa-server')) { clearInterval(t); resolve(); } }, 50);
  server.on('exit', (code) => reject(new Error(`server exited (${code}): ${serverOut}`)));
});
const cpuOf = (pid) => {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return (Number(f[11]) + Number(f[12])) / 100; // utime + stime, in seconds (USER_HZ 100)
};

// ---------- The clients ----------
const maps = new Map();
const mapFor = (m) => {
  const choice = makeChoice(m.theme, m.id, m.seed), key = choiceKey(choice);
  if (!maps.has(key)) maps.set(key, buildMap(choice));
  return maps.get(key);
};

const record = { runs: new Set(), bestWave: 0, maps: new Set(), over: 0 };
class BotClient {
  constructor(n, room) {
    this.n = n; this.room = room;
    this.kills = 0; this.downs = 0; this.revives = 0; this.deaths = 0; this.events = 0;
    this.net = null; this.bot = null; this.ready = -1;
    room.onLeave((code) => { if (!done) errors.push(`client ${n} dropped (${code})`); });
  }

  // Loads each new run's map and says ready; drives its player once it is in.
  step() {
    const S = this.room.state;
    if (this.net && this.net.runId !== S.run) { this.net.destroy(); this.net = null; this.bot = null; }
    if (!this.net) {
      if (this.ready !== S.run) { this.ready = S.run; mapFor(S.map); this.room.send('ready', S.run); }
      if (!S.players.has(this.room.sessionId)) return;
      const { world, layout } = mapFor(S.map);
      this.net = new NetSim(this.room, world, layout);
      this.id = this.net.localId;
      this.bot = new Bot(this.net, this.id, mulberry32(100 + this.n));
      record.runs.add(S.run);
      record.maps.add(`${S.map.theme}/${S.map.id}`);
    }
    const net = this.net, P = net.players.get(this.id);
    net.tick(STEP);
    net.send(P && !P.dead ? this.bot.command(STEP) ?? idleCommand(P.aim) : idleCommand(0));
    net.sync(STEP);
    for (const e of net.takeEvents()) {
      this.events++;
      if (e.type === 'kill' && e.by === this.id) this.kills++;
      else if (e.type === 'downed' && e.id === this.id) this.downs++;
      else if (e.type === 'revived' && e.by === this.id) this.revives++;
      else if (e.type === 'died' && e.id === this.id) this.deaths++;
      else if (e.type === 'over' && this.n === 0) record.over++;
    }
    for (const o of net.players.values()) if (!Number.isFinite(o.x + o.y)) errors.push(`client ${this.n}: player ${o.id} at ${o.x}, ${o.y}`);
    record.bestWave = Math.max(record.bestWave, net.wave);
  }
}

let done = false;
const bots = [];
for (let i = 0; i < CLIENTS; i++) {
  const room = await join(`ws://127.0.0.1:${PORT}`, { name: `bot${i + 1}` });
  lag(room, { ...NET, rand: mulberry32(50 + i) });
  bots.push(new BotClient(i, room));
}
const cpu0 = cpuOf(server.pid), t0 = performance.now();
let steps = 0;
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const due = Math.floor((performance.now() - t0) / 1000 / STEP);
    try {
      for (; steps < due; steps++) for (const b of bots) b.step();
    } catch (err) {
      errors.push(err.stack);
    }
    if (performance.now() - t0 > MINUTES * 60000 || errors.length) { clearInterval(timer); resolve(); }
  }, 8);
});
done = true;
const secs = (performance.now() - t0) / 1000, cpu = cpuOf(server.pid) - cpu0;
for (const b of bots) await b.room.leave().catch(() => {});
server.kill('SIGKILL');

// ---------- Report ----------
console.log(`${CLIENTS} clients, ${secs.toFixed(0)} s real time on ${MAPS.join(', ')}${NET.rtt || NET.jitter || NET.loss ? ` (rtt ${NET.rtt} ms, jitter ${NET.jitter} ms, loss ${NET.loss * 100} %)` : ''}`);
console.log(`  runs ${record.runs.size} (maps ${[...record.maps].join(', ')}), runs ended ${record.over}, best wave ${record.bestWave}`);
for (const b of bots) console.log(`  client ${b.n + 1}: kills ${b.kills}, downs ${b.downs}, revives ${b.revives}, bled out ${b.deaths}, events ${b.events}`);
console.log(`  server CPU ${(cpu / secs * 100).toFixed(1)} % of one core over the run`);
const busy = stats.filter((l) => / run wave [1-9]/.test(l));
for (const l of busy) console.log(`  ${l}`);
if (!busy.length) for (const l of stats) console.log(`  ${l}`);
if (record.bestWave < Math.max(2, WAVE)) errors.push(`no wave progress (best wave ${record.bestWave})`);
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
  process.exit(1);
}
console.log('\nno errors');
process.exit(0);
