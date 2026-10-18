// NaiwaRoom tests: a real server on 127.0.0.1:2568 (@colyseus/testing's boot) and clients
// joining through the browser's own join() (src/net/online.js). Countdowns are skipped by
// setting the room's phaseT; the sim is reached through NaiwaRoom.current.
//
//   npm run test:server        from the repo root
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boot } from '@colyseus/testing';
import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { makeServer, DEFAULTS } from '../index.js';
import { NaiwaRoom, NAME_MAX } from '../room.js';
import { join, joinError, JoinError } from '../../src/net/online.js';
import { PROTOCOL } from '../../src/sim/protocol.js';
import { buildMap, makeChoice } from '../../src/sim/maps.js';

const URL = 'ws://127.0.0.1:2568';
const CONFIG = { ...DEFAULTS, maps: ['island/cove', 'factory/dairy'], allowedOrigins: ['https://good.example'], password: '', maxPlayers: 4, stats: false };
let colyseus, room, clients = [], errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

// Joins and gets into the sim, as the browser does after loading the map.
async function enter(name = 'Tester', opts = {}) {
  const c = await join(URL, { name, ...opts });
  clients.push(c);
  c.send('ready', c.state.run);
  await until(() => c.state.players.has(c.sessionId), 'the player in the state');
  return c;
}
const simPlayer = (c) => room.sim.players.get(room.seats.get(c.sessionId).id);
// Skips the lobby's countdown.
const startRun = async () => { room.state.phaseT = 0; await until(() => room.state.phase === 'run', 'the run'); };

before(async () => {
  colyseus = await boot(makeServer(CONFIG));
});
after(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  for (const c of clients) if (c.connection?.isOpen) await c.leave().catch(() => {});
  clients = [];
  if (NaiwaRoom.current) await NaiwaRoom.current.disconnect();
  await until(() => !NaiwaRoom.current, 'the old room to go');
  await matchMaker.createRoom('naiwa', {});
  room = NaiwaRoom.current;
  room.config = { ...CONFIG };
  errors = [];
  room.onUncaughtException = (err, method) => errors.push(`${method}: ${err.stack ?? err}`);
});

test('join, ready and get the state', async () => {
  const c = await enter('A very long name for a naiwa\u0007!');
  const S = c.state;
  assert.equal(S.phase, 'lobby');
  assert.equal(S.mode, 'coop');
  assert.deepEqual([S.map.theme, S.map.id, S.map.seed], ['island', 'cove', 20261012]);
  const me = S.players.get(c.sessionId);
  assert.equal(me.name, 'A very long name');
  assert.equal([...me.name].length, NAME_MAX);
  assert.equal(me.hp, 100);
  assert.equal(me.weapon, 'pistol');
  assert.equal(me.arsenal.get('pistol').reserve, -1);
  // Props are keyed 1–n in layout order, and nothing else of the layout is sent.
  const { layout } = buildMap(makeChoice('island', 'cove'));
  assert.deepEqual([...S.props.keys()].map(Number).sort((a, b) => a - b), layout.props.map((_, i) => i + 1));
  assert.equal(S.pickups.size, layout.weaponSpots.length);
  // The countdown runs once someone is in.
  const t = S.phaseT;
  await sleep(300);
  assert.ok(c.state.phaseT < t, 'lobby counts down');
  assert.deepEqual(errors, []);
});

test('a client that never says ready stays out of the sim', async () => {
  const c = await join(URL, { name: 'Loading' });
  clients.push(c);
  await sleep(200);
  assert.equal(room.sim.players.size, 0);
  assert.equal(c.state.players.size, 0);
  assert.equal(room.state.phaseT, 10, 'no countdown without anyone in');
  c.send('ready', c.state.run + 5); // a stale or made-up run is ignored
  await sleep(100);
  assert.equal(room.sim.players.size, 0);
});

test('wrong protocol, full server and wrong password are refused with their reasons', async () => {
  await assert.rejects(new Client(URL).join('naiwa', { protocol: PROTOCOL + 1 }), (e) => e.message === `version:${PROTOCOL}`);
  // Through the browser's join(): the reasons it shows.
  const old = await join(URL, { name: 'x' }).catch((e) => e);
  assert.ok(!(old instanceof Error));
  clients.push(old);

  room.config = { ...CONFIG, password: 'secret' };
  await assert.rejects(join(URL, { name: 'y', password: 'nope' }), (e) => e instanceof JoinError && e.reason === 'password');
  await assert.rejects(join(URL, { name: 'y' }), (e) => e instanceof JoinError && e.reason === 'password');
  clients.push(await join(URL, { name: 'y', password: 'secret' }));

  room.config = { ...CONFIG, maxPlayers: 2 };
  room.maxClients = 2;
  await assert.rejects(join(URL, { name: 'z' }), (e) => e instanceof JoinError && e.reason === 'full');
  await clients.pop().leave();
  await until(() => room.clients.length === 1, 'a seat to free up');
  clients.push(await join(URL, { name: 'z' }));
});

test('the browser maps a version refusal to both numbers', async () => {
  const err = await new Client(URL).join('naiwa', { protocol: 0 }).catch((e) => e);
  const j = joinError(err);
  assert.equal(j.reason, 'version');
  assert.equal(j.server, PROTOCOL);
  const down = await join('ws://127.0.0.1:1', { name: 'n' }).catch((e) => e);
  assert.equal(down.reason, 'unreachable');
});

test('a browser from a site not in allowedOrigins is refused', async () => {
  // At matchmaking: the reason reaches the client.
  const evil = new Client(URL, { headers: { Origin: 'https://evil.example' } });
  await assert.rejects(evil.join('naiwa', { protocol: PROTOCOL }), (e) => e.message === 'origin');
  const good = new Client(URL, { headers: { Origin: 'https://good.example' } });
  clients.push(await good.join('naiwa', { protocol: PROTOCOL }));
  // At the WebSocket upgrade (beforeUpgrade), for anything that skips matchmaking.
  const upgrade = (origin) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 2568, path: '/', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: origin } });
    req.on('response', (res) => { resolve(res.statusCode); res.resume(); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(await upgrade('https://evil.example'), 403);
  assert.notEqual(await upgrade('https://good.example'), 403);
});

test('garbage commands are clamped without errors; presses between steps are kept', async () => {
  const c = await enter('Hacker');
  await startRun();
  const input = c.input({ mode: 'reliable' });
  const d = input.data;
  for (const [mx, my, aim] of [[NaN, NaN, NaN], [Infinity, -Infinity, 1e300], [1e30, -1e30, -1e30], [5, 5, Infinity]]) {
    d.mx = mx; d.my = my; d.aim = aim; d.dashX = mx; d.dashY = my;
    d.weapon = 99; d.cycle = 120; d.fire = true;
    input.send();
  }
  // Wrong types and bytes that aren't a command at all, straight onto the socket.
  for (const bad of [() => { d.fire = 'yes'; input.send(); }, () => { d.weapon = 'rifle'; input.send(); }, () => { d.mx = {}; input.send(); }]) {
    try { bad(); } catch { /* the SDK refuses to encode it, which is fine too */ }
  }
  d.fire = false; d.weapon = 0; d.mx = 0; d.my = 0;
  // (Protocol 20, an unreliable input with a negative slot length, used to hang Colyseus.)
  c.connection.send(new Uint8Array([20, 255, 255, 255, 1, 2, 3, 0xc1, 0xff]));
  c.connection.send(new Uint8Array([20, 0, 0xd0, 0x80]));
  // Random frames on the input codes (with and without modifier bits) and codes clients
  // don't send.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const noise = (code) => { const b = new Uint8Array(1 + Math.floor(rnd() * 40)).map(() => Math.floor(rnd() * 256)); b[0] = code; return b; };
  for (let i = 0; i < 300; i++) c.connection.send(noise([14, 15, 19, 20, 19 | 0x20, 19 | 0x40, 20 | 0x20][i % 7]));
  // A message that isn't msgpack gets its sender dropped; the room carries on.
  const vandal = await enter('Vandal');
  const left = new Promise((resolve) => vandal.onLeave((code) => resolve(code)));
  for (let i = 0; i < 20; i++) vandal.connection.send(noise(13));
  assert.equal(await left, 4002);
  await until(() => room.sim.players.size === 1, 'the vandal out of the sim');
  await sleep(300);
  const P = simPlayer(c);
  assert.ok(Number.isFinite(P.x) && Number.isFinite(P.y) && Number.isFinite(P.aim), `position ${P.x}, ${P.y}, aim ${P.aim}`);
  assert.ok(Math.hypot(P.vx, P.vy) < 1000, 'speed stays sane');
  assert.equal(P.weapon, 'pistol');
  // A dash pressed for one command only, with no step in between, still dashes.
  const dashes = [];
  c.onMessage('events', (ev) => { for (const e of ev) if (e.type === 'dash') dashes.push(e); });
  P.dashCd = 0;
  d.dash = true; d.mx = 1; input.send();
  d.dash = false; input.send();
  await until(() => dashes.length, 'the dash event');
  assert.equal(dashes[0].id, P.id);
  assert.ok(c.connection.isOpen, 'still connected');
  assert.deepEqual(errors, []);
});

test('a client that stops sending lets go of the stick and the trigger', async () => {
  const c = await enter('Sleepy');
  await startRun();
  const input = c.input({ mode: 'reliable' });
  input.data.mx = 1; input.data.fire = true; input.data.aim = 1;
  input.send();
  await sleep(100);
  const seat = room.seats.get(c.sessionId);
  assert.equal(seat.cmd.mx, 1);
  assert.equal(seat.cmd.fire, true);
  await sleep(1300);
  assert.equal(seat.cmd.mx, 0);
  assert.equal(seat.cmd.fire, false);
  assert.ok(Math.abs(seat.cmd.aim - 1) < 0.01, 'keeps its aim');
});

test('a late joiner waits for the wave break', async () => {
  const a = await enter('First');
  await startRun();
  room.sim.startWave(2);
  const b = await enter('Late');
  const L = simPlayer(b);
  assert.ok(L.dead && L.joining, 'waits, dead, for the break');
  assert.equal(b.state.players.get(b.sessionId).dead, true);
  // Clear the wave: the break brings the late joiner in at the dock.
  const respawned = [];
  b.onMessage('events', (ev) => { for (const e of ev) if (e.type === 'respawned') respawned.push(e); });
  room.sim.queue = [];
  for (const e of room.sim.enemies) e.hit(1e6, 0, 0, null);
  await until(() => respawned.length, 'the respawn');
  assert.equal(respawned[0].id, L.id);
  assert.equal(respawned[0].joined, true);
  assert.ok(!L.dead);
  await until(() => !b.state.players.get(b.sessionId).dead, 'the state to show it');
  assert.ok(a.state.players.size === 2);
});

test('leaving takes the player out of the sim at once', async () => {
  const a = await enter('Stays');
  const b = await enter('Goes');
  await startRun();
  const id = simPlayer(b).id;
  assert.equal(room.sim.players.size, 2);
  await b.leave();
  await until(() => !room.sim.players.has(id), 'removePlayer');
  await until(() => a.state.players.size === 1, 'the state to drop it');
  assert.equal(room.state.phase, 'run', 'the run goes on for the others');
});

test('everyone down → results → the next map', async () => {
  const a = await enter('One');
  const b = await enter('Two');
  await startRun();
  const run = room.state.run;
  for (const c of [a, b]) { const P = simPlayer(c); P.invuln = 0; P.hurt(1000, P.x + 5, P.y); }
  await until(() => a.state.phase === 'results', 'results');
  assert.ok(room.state.phaseT > 9);
  room.state.phaseT = 0.05;
  await until(() => a.state.run === run + 1, 'the next run');
  assert.equal(a.state.phase, 'lobby');
  assert.deepEqual([a.state.map.theme, a.state.map.id], ['factory', 'dairy']);
  assert.equal(a.state.players.size, 0, 'everyone reloads the map first');
  for (const c of [a, b]) c.send('ready', c.state.run);
  await until(() => a.state.players.size === 2, 'both back in');
  assert.equal(room.sim.players.size, 2);
  assert.equal(room.sim.wave, 0);
});

test('an empty server goes back to the lobby', async () => {
  const a = await enter('Alone');
  await startRun();
  room.sim.startWave(3);
  const run = room.state.run;
  await a.leave();
  await until(() => room.state.run === run + 1, 'a new run');
  assert.equal(room.state.phase, 'lobby');
  assert.equal(room.state.phaseT, 10);
  assert.equal(room.sim.wave, 0);
  assert.equal(room.sim.players.size, 0);
  assert.equal(room.state.players.size, 0);
  // Ticks go on without anyone and the countdown waits.
  await sleep(200);
  assert.equal(room.state.phaseT, 10);
  assert.deepEqual(errors, []);
});
