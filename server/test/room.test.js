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
import { makeServer, DEFAULTS, readConfig } from '../index.js';
import { NaiwaRoom, NAME_MAX, STALE_STEPS } from '../room.js';
import { join, joinError, JoinError } from '../../src/net/online.js';
import { PROTOCOL, CHAT_MAX } from '../../src/sim/protocol.js';
import { buildMap, makeChoice } from '../../src/sim/maps.js';

const URL = 'ws://127.0.0.1:2568';
const CONFIG = { ...DEFAULTS, maps: ['island/cove', 'factory/dairy'], allowedOrigins: ['https://good.example'], password: '', maxPlayers: 4, stats: false, log: false };
let colyseus, room, clients = [], errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

// Joins and gets into the sim, as the browser does after loading the map. The SDK only
// reconnects a room that has been up 5 s; here at once.
async function enter(name = 'Tester', opts = {}) {
  const c = await join(URL, { name, ...opts });
  c.reconnection.minUptime = 0;
  clients.push(c);
  c.send('ready', c.state.run);
  await until(() => c.state.players.has(c.sessionId), 'the player in the state');
  return c;
}
// The network goes (the socket closes without a word, as when a phone loses its signal).
const drop = (c) => c.connection.transport.ws.close();
// Messages of a type a client gets, collected.
const collect = (c, type) => { const got = []; c.onMessage(type, (m) => got.push(m)); return got; };
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
  room.reconnectSeconds = 60;
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
  c.onMessage('tick', ([, ev]) => { for (const e of ev) if (e.type === 'dash') dashes.push(e); });
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
  b.onMessage('tick', ([, ev]) => { for (const e of ev) if (e.type === 'respawned') respawned.push(e); });
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

test('one command a step: a burst is played out one per step, and no press is lost', async () => {
  const c = await enter('Steady');
  await startRun();
  room.sim.stateT = 1e6;
  const input = c.input({ mode: 'reliable' });
  // Quiet for over a second first (a held stick would be guessed on, see the next test).
  await sleep(1000 * (STALE_STEPS / 60) + 300);
  const acc = room.inputs.get(c.sessionId), seat = room.seats.get(c.sessionId);
  const consumed = [];
  const tick = room.tick.bind(room);
  room.tick = () => { tick(); consumed.push(acc.consumedCount); };
  const base = acc.consumedCount;
  const dashes = [];
  c.onMessage('tick', ([, ev]) => { for (const e of ev) if (e.type === 'dash') dashes.push(e); });
  simPlayer(c).dashCd = 0;
  // Ten commands at once; the third presses dash.
  for (let i = 0; i < 10; i++) { input.data.mx = 1; input.data.dash = i === 2; input.send(); }
  input.data.dash = false;
  await until(() => acc.consumedCount >= base + 10, 'all ten consumed');
  room.tick = tick;
  const steps = consumed.filter((n) => n > base && n <= base + 10);
  const jumps = steps.slice(1).map((n, i) => n - steps[i]);
  assert.ok(jumps.every((d) => d <= 1), `one command per step (${JSON.stringify(steps)})`);
  assert.equal(seat.folded, 0);
  await until(() => dashes.length, 'the dash');
  // Commands that come late, after steps held on a guess, are folded into one step: presses kept.
  for (let i = 0; i < 30; i++) { input.data.mx = 0; input.send(); await sleep(16); }
  await sleep(200); // ~12 steps on a held command
  const before = seat.folded, dashed = dashes.length;
  simPlayer(c).dashCd = 0;
  for (let i = 0; i < 12; i++) { input.data.mx = 1; input.data.dash = i === 4; input.send(); }
  input.data.dash = false;
  await until(() => dashes.length > dashed, 'the folded dash');
  assert.ok(seat.folded > before, `late commands folded (${seat.folded - before})`);
  assert.deepEqual(errors, []);
});

test('a player who drops keeps their seat and player, and comes back as them', async () => {
  const a = await enter('Stays');
  const b = await enter('Drops');
  await startRun();
  room.sim.stateT = 1e6;
  const P = simPlayer(b), id = P.id;
  P.kills = 7; P.hp = 55; P.invuln = 1e6;
  const sid = b.sessionId;
  const back = new Promise((resolve) => b.onReconnect(resolve));
  const chat = collect(a, 'chat');
  // Walking when the connection goes: the player stops at once.
  const input = b.input({ mode: 'reliable' });
  input.data.mx = 1; input.send();
  await sleep(100);
  b.reconnection.delay = 400;
  drop(b);
  await until(() => room.seats.get(sid)?.dropped, 'the drop');
  await sleep(100);
  assert.equal(room.seats.size, 2, 'the seat is held');
  assert.equal(room.sim.players.get(id), P, 'the player stays in the sim');
  assert.equal(room.seats.get(sid).cmd.mx, 0, 'and stands still');
  await until(() => a.state.players.get(sid)?.away, 'shown away in the state');
  await back;
  assert.equal(b.sessionId, sid);
  await until(() => !room.seats.get(sid).dropped, 'back in its seat');
  const ps = b.state.players.get(sid);
  assert.equal(ps.id, id);
  assert.equal(ps.kills, 7);
  assert.equal(ps.hp, 55);
  assert.equal(ps.away, false);
  // It plays on: a command moves it again.
  const x = P.x;
  b.input({ mode: 'reliable' }).data.mx = 1;
  for (let i = 0; i < 20; i++) { b.input({ mode: 'reliable' }).send(); await sleep(16); }
  await until(() => P.x > x + 5, 'moving after the reconnect');
  await until(() => chat.some((m) => m.k === 'back'), 'the others told');
  assert.ok(chat.some((m) => m.k === 'drop' && m.n === 'Drops'));
  assert.deepEqual(errors, []);
});

test('after the window the seat goes, and the old token is refused', async () => {
  room.reconnectSeconds = 1;
  const a = await enter('Stays');
  const b = await enter('Gone');
  await startRun();
  const token = b.reconnectionToken, sid = b.sessionId, id = simPlayer(b).id;
  b.reconnection.enabled = false;
  const left = new Promise((resolve) => b.onLeave(resolve));
  drop(b);
  await left;
  await until(() => room.seats.has(sid) && room.seats.get(sid).dropped, 'held');
  await until(() => !room.seats.has(sid), 'the seat to go', 4000);
  assert.ok(!room.sim.players.has(id), 'out of the sim');
  await until(() => !a.state.players.has(sid), 'out of the state');
  await assert.rejects(new Client(URL).reconnect(token));
  assert.equal(room.seats.size, 1);
  assert.equal(room.state.phase, 'run', 'the run goes on');
});

test('a held seat counts as taken; a reconnect still has to come from an allowed site', async () => {
  room.config = { ...CONFIG, maxPlayers: 2 };
  room.maxClients = 2;
  room.reconnectSeconds = 2;
  await enter('One');
  const b = await enter('Two');
  const token = b.reconnectionToken;
  b.reconnection.enabled = false;
  drop(b);
  await until(() => room.seats.get(b.sessionId)?.dropped, 'held');
  await assert.rejects(join(URL, { name: 'Three' }), (e) => e instanceof JoinError && e.reason === 'full');
  // The token alone isn't enough from another site's page.
  const evil = new Client(URL, { headers: { Origin: 'https://evil.example' } });
  await assert.rejects(evil.reconnect(token));
  await until(() => room.seats.size === 1, 'the held seat to run out', 5000);
  clients.push(await join(URL, { name: 'Three' }));
});

test('a reconnect into the next map', async () => {
  const a = await enter('Here');
  const b = await enter('Away');
  await startRun();
  const run = room.state.run, sid = b.sessionId;
  b.reconnection.delay = 1500;
  const back = new Promise((resolve) => b.onReconnect(resolve));
  drop(b);
  await until(() => room.seats.get(sid)?.dropped, 'held');
  // While it is away everyone goes down, and the room moves on to the next map.
  for (const P of room.sim.players.values()) { P.invuln = 0; P.hurt(1000, P.x + 5, P.y); }
  await until(() => room.state.phase === 'results', 'results');
  room.state.phaseT = 0.05;
  await until(() => room.state.run === run + 1, 'the next run');
  assert.equal(room.seats.get(sid).id, 0, 'out of the sim until it has the map');
  await back;
  // The state that comes with the reconnect is the new run's.
  await until(() => b.state.run === run + 1, 'the new run in its state');
  assert.deepEqual([b.state.map.theme, b.state.map.id], ['factory', 'dairy']);
  a.send('ready', a.state.run);
  b.send('ready', b.state.run);
  await until(() => b.state.players.has(sid) && b.state.players.size === 2, 'both on the new map');
  assert.equal(b.state.players.get(sid).name, 'Away');
  assert.deepEqual(errors, []);
});

test('chat: cleaned, capped, one line a second', async () => {
  const a = await enter('Talker');
  const b = await enter('Listener');
  const got = collect(b, 'chat');
  a.send('chat', `  hi\u0000 there‮\n${'x'.repeat(200)}  `);
  await until(() => got.length, 'the line');
  const line = got[0];
  assert.equal(line.n, 'Talker');
  assert.equal(line.c, 0);
  assert.equal([...line.t].length, CHAT_MAX);
  assert.ok(line.t.startsWith('hi therexxx'), line.t);
  assert.ok(!/[\p{C}]/u.test(line.t), 'no control characters');
  a.send('chat', 'too soon');
  await sleep(300);
  for (const bad of ['   ', '\u0007\u0008', 42, { t: 'x' }, null]) a.send('chat', bad);
  await sleep(300);
  assert.equal(got.length, 1, 'the second line within a second, and empty or wrong ones, are dropped');
  await sleep(600);
  a.send('chat', '你好');
  await until(() => got.length === 2, 'a line a second later');
  assert.equal(got[1].t, '你好');
  assert.ok(b.connection.isOpen && a.connection.isOpen);
});

test('names, colours, ping and the scoreboard stats are in the state', async () => {
  const a = await enter('Ann\u0007');
  const b = await enter('Bea');
  const c = await enter('Cid');
  const colour = (x) => a.state.players.get(x.sessionId).colour;
  assert.deepEqual([colour(a), colour(b), colour(c)], [0, 1, 2], 'by join order');
  assert.equal(a.state.players.get(a.sessionId).name, 'Ann');
  // A free colour is taken again by the next to join.
  await b.leave();
  const d = await enter('Dee');
  assert.equal(colour(d), 1);
  // The round trip a browser measured.
  const pong = collect(a, 'pong');
  a.send('ping', [12345.5, 87]);
  await until(() => pong.length, 'the answer');
  assert.equal(pong[0], 12345.5);
  await until(() => a.state.players.get(a.sessionId).ping === 87, 'the ping in the state');
  // Downed, then revived: downs and revives.
  await startRun();
  room.sim.stateT = 1e6;
  const A = simPlayer(a), C = simPlayer(c);
  Object.assign(C, { x: A.x + 30, y: A.y, vx: 0, vy: 0 });
  A.invuln = 0; A.hurt(1000, A.x + 5, A.y);
  assert.ok(A.down);
  const shots = [];
  c.onMessage('tick', ([t, ev]) => { assert.ok(Number.isInteger(t)); for (const e of ev) if (e.type === 'shot') shots.push(e); });
  const input = c.input({ mode: 'reliable' });
  input.data.fire = true; input.data.aim = 0;
  for (let i = 0; i < 20; i++) { input.send(); await sleep(16); }
  input.data.fire = false; input.send();
  await until(() => !A.down, 'the revive', 6000);
  await until(() => a.state.players.get(c.sessionId).revives === 1 && a.state.players.get(a.sessionId).downs === 1, 'the stats in the state');
  assert.equal(a.state.players.get(a.sessionId).revives, 0);
  // Its shots say which command they came from.
  assert.ok(shots.length && shots.every((e) => e.id === C.id && Number.isInteger(e.seq) && e.seq > 0), JSON.stringify(shots[0]));
  assert.deepEqual(errors, []);
});

// ---------- PvP ----------
// The room in PvP from its next run (before anyone joins).
function pvpRoom(pvp = { killLimit: 25, timeLimit: 600 }) {
  room.config = { ...CONFIG, mode: 'pvp', pvp };
  room.state.mode = 'pvp';
  room.loadMap();
}
// A stands 100 px left of B on open ground, neither protected; A's next bullet kills B.
function lineUp(A, B) {
  const sim = room.sim;
  for (let i = 0; i < 20000; i++) {
    const x = 100 + Math.random() * 3000, y = 100 + Math.random() * 3000;
    if (!sim.openSpot(x, y) || !sim.openSpot(x + 100, y) || !sim.statics.clearLine(x, y, x + 100, y, 30)) continue;
    Object.assign(A, { x, y, vx: 0, vy: 0, invuln: 0 });
    Object.assign(B, { x: x + 100, y, vx: 0, vy: 0, invuln: 0, hp: 1 });
    sim.fireBullet({ x: x + 24, y, ang: 0, speed: 980, dmg: 20, life: 0.5, team: 'player', owner: A.id, knock: 140 });
    return;
  }
  throw new Error('no open ground');
}

test('server.json: "pvp" mode and its limits are checked', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/naiwa-cfg-`);
  const write = (o) => { const f = `${dir}/s${Math.random()}.json`; writeFileSync(f, JSON.stringify(o)); return f; };
  const cfg = readConfig(write({ mode: 'pvp', pvp: { killLimit: 10 } }));
  assert.equal(cfg.mode, 'pvp');
  assert.deepEqual(cfg.pvp, { killLimit: 10, timeLimit: 600 });
  assert.throws(() => readConfig(write({ mode: 'pvp', pvp: { killLimit: 0 } })), /killLimit/);
  assert.throws(() => readConfig(write({ mode: 'pvp', pvp: { timeLimit: 5 } })), /timeLimit/);
  assert.throws(() => readConfig(write({ mode: 'ffa' })), /"coop" or "pvp"/);
});

test('pvp: players shoot each other, die and respawn; late joiners are in at once', async () => {
  pvpRoom();
  const a = await enter('Shooter');
  const b = await enter('Target');
  assert.equal(a.state.mode, 'pvp');
  await startRun();
  const A = simPlayer(a), B = simPlayer(b);
  lineUp(A, B);
  const died = [];
  a.onMessage('tick', ([, ev]) => { for (const e of ev) if (e.type === 'died') died.push(e); });
  await until(() => died.length, 'the kill');
  assert.equal(died[0].id, B.id);
  assert.equal(died[0].by, A.id);
  const sb = () => a.state.players.get(b.sessionId);
  await until(() => sb().dead && sb().respawnT > 0 && sb().downs === 1 && a.state.players.get(a.sessionId).kills === 1, 'the death in the state');
  assert.equal(a.state.killLimit, 25);
  assert.ok(a.state.timeLeft < 600 && a.state.timeLeft > 590, `${a.state.timeLeft}`);
  assert.equal(a.state.state, 'pvp');
  await until(() => !sb().dead, 'the respawn', 5000);
  assert.ok(sb().invuln > 0, 'spawn protection in the state');
  assert.equal(sb().respawnT, 0);
  const c = await enter('Late');
  assert.ok(!simPlayer(c).dead, 'in at once');
  assert.equal(room.sim.enemies.length, 0);
  assert.deepEqual(errors, []);
});

test('pvp: killLimit → results with the winner → the next map, still PvP; joiners during results wait', async () => {
  pvpRoom({ killLimit: 1, timeLimit: 600 });
  const a = await enter('Winner');
  const b = await enter('Loser');
  await startRun();
  const run = room.state.run;
  lineUp(simPlayer(a), simPlayer(b));
  await until(() => a.state.phase === 'results', 'results');
  assert.equal(a.state.state, 'over');
  assert.equal(a.state.winner, simPlayer(a).id);
  // The loser stays dead through the results, with no countdown.
  assert.ok(a.state.players.get(b.sessionId).dead);
  assert.equal(a.state.players.get(b.sessionId).respawnT, 0);
  const c = await enter('TooLate');
  assert.ok(simPlayer(c).dead, 'waits for the next map');
  room.state.phaseT = 0.05;
  await until(() => a.state.run === run + 1, 'the next run');
  assert.equal(a.state.mode, 'pvp');
  assert.equal(a.state.winner, 0);
  assert.ok(room.sim.pvp);
  for (const x of [a, b, c]) x.send('ready', x.state.run);
  await until(() => a.state.players.size === 3, 'all back in');
  assert.ok([a, b, c].every((x) => !simPlayer(x).dead));
  assert.deepEqual(errors, []);
});

test('pvp: the last one in the round leaves while another still loads: a fresh round in the lobby', async () => {
  pvpRoom();
  const a = await enter('Alone');
  await startRun();
  // Joined, but still loading the map (no 'ready' yet).
  const b = await join(URL, { name: 'Loading' });
  b.reconnection.minUptime = 0;
  clients.push(b);
  await until(() => room.seats.has(b.sessionId), 'the seat');
  const run = room.state.run;
  await a.leave();
  await until(() => b.state.run === run + 1, 'a new run');
  assert.equal(b.state.phase, 'lobby');
  assert.equal(room.sim.players.size, 0);
  // The 'ready' for the old run counts for nothing; the new run's puts them in.
  b.send('ready', run);
  b.send('ready', b.state.run);
  await until(() => b.state.players.has(b.sessionId), 'in the new round');
  assert.equal(room.sim.state, 'pvp');
  assert.ok(room.sim.roundT === 600, `${room.sim.roundT}`);
  assert.deepEqual(errors, []);
});
