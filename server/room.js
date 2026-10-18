// NaiwaRoom: the one room a naiwa-server runs (the server is the room). It runs the sim from
// src/sim at a fixed 1/60 s step, feeds it the clients' commands and sends back the state
// (server/schema.js) plus the sim's events and bullets (src/sim/protocol.js).
//
// Lifecycle: 'lobby' (players stand at the dock; the run starts LOBBY_SECONDS after the first
// one is in), 'run', 'results' for RESULTS_SECONDS once everyone is down or dead, then the next
// map of the rotation and its lobby. When the last player leaves, the room goes back to the
// lobby with a fresh sim on the same map.
//
// A client is only put into the sim once it has loaded the run's map: it sends 'ready' with
// the run number (state.run) after joining and again after every new run, so nobody stands
// defenceless at the dock while their browser is still painting the island. The sim itself
// makes late joiners wait for the wave break.
//
// Clients only ever send commands. Each tick a client's buffered commands are merged into one:
// movement, aim and the trigger from the newest, one-shot presses (dash, reload, weapon,
// cycle, last) from any of them, so a press is never lost when two commands arrive between
// steps. Without a new command the player keeps the last movement, aim and trigger for up to
// STALE_STEPS, then lets go of the stick and the trigger (a hidden tab stops sending).
import { Room, ServerError, ErrorCode, Protocol } from '@colyseus/core';
import { makeChoice, buildMap, RANDOM_ID } from '../src/sim/maps.js';
import { Sim, STEP } from '../src/sim/sim.js';
import { idleCommand } from '../src/sim/entities.js';
import { PROTOCOL, packBullet, packEvents, weaponFromCode } from '../src/sim/protocol.js';
import { NaiwaState, PlayerState, EnemyState, PickupState, PropState, Slot, Command } from './schema.js';

export const LOBBY_SECONDS = 10;
export const RESULTS_SECONDS = 10;
export const NAME_MAX = 16;
export const STALE_STEPS = 60; // 1 s: a slow phone still sends several commands a second

// Why a join was refused; the browser turns these into messages (src/net/online.js).
export const REFUSED = { version: 'version', full: 'full', password: 'password', origin: 'origin' };

// A display name: printable, trimmed, at most NAME_MAX characters.
export function cleanName(name) {
  const s = typeof name === 'string' ? name.replace(/[\p{C}]/gu, '').trim() : '';
  return [...s].slice(0, NAME_MAX).join('') || 'Naiwa';
}

// "island/cove", "factory/dairy", "island/random" (a new seed each time) → a map choice.
export function parseMap(entry) {
  const [theme, id = ''] = String(entry).split('/');
  return makeChoice(theme, id, id === RANDOM_ID ? 0 : undefined);
}

// Fixes up a decoded command in place. The wire types already bound every number; this keeps
// the stick inside the unit circle and the switches within the guns and a sane wheel count.
function sanitize(c) {
  const fin = (v) => (Number.isFinite(v) ? v : 0);
  c.mx = fin(c.mx); c.my = fin(c.my); c.aim = fin(c.aim);
  const l = Math.hypot(c.mx, c.my);
  if (l > 1) { c.mx /= l; c.my /= l; }
  c.dashX = fin(c.dashX); c.dashY = fin(c.dashY);
  if (!(Number.isInteger(c.weapon) && c.weapon >= 0 && c.weapon <= 4)) c.weapon = 0;
  c.cycle = Number.isInteger(c.cycle) ? Math.max(-4, Math.min(4, c.cycle)) : 0;
  for (const k of ['fire', 'dash', 'reload', 'last']) c[k] = c[k] === true;
}

const nonNeg = (v) => Math.max(0, v);

export class NaiwaRoom extends Room {
  // The running room, for the static onAuth (there is only ever one).
  static current = null;

  // Runs on the matchmaking request, before a seat is reserved, so a refusal reaches the
  // browser as an error with the reason.
  static async onAuth(token, options, context) {
    const room = NaiwaRoom.current;
    if (!room) throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, 'not ready');
    const why = room.refuse(options ?? {}, context?.headers?.get('origin'));
    if (why) throw new ServerError(ErrorCode.AUTH_FAILED, why);
    return { name: cleanName(options?.name) };
  }

  // options.config: the server.json settings (see server/index.js).
  onCreate({ config }) {
    if (config.mode !== 'coop') throw new Error(`mode "${config.mode}" isn't supported yet (only "coop")`);
    this.config = config;
    this.maxClients = config.maxPlayers;
    this.autoDispose = false;
    this.setState(new NaiwaState());
    this.inputs = this.defineInput(Command, { sanitize });
    this.seats = new Map(); // sessionId → { id: sim player id (0 until ready), name, cmd }
    this.onMessage('ready', (client, run) => this.ready(client, run));
    this.rotation = 0;
    this.stats = config.stats ? { ticks: 0, tickMs: 0, maxMs: 0, bytes: new Map(), since: performance.now() } : null;
    this.loadMap();
    this.setFixedTimestep(() => this.tick(), Math.round(1 / STEP));
    NaiwaRoom.current = this;
  }

  // Colyseus 0.18.19 loops forever on a malformed unreliable-input frame (a negative slot
  // length in @colyseus/schema's InputDecoder.decodeAll), so one bad client could freeze the
  // server. Our clients only send reliable inputs (there is no unreliable channel over
  // WebSocket anyway), so those frames are dropped before Colyseus reads them.
  _onMessage(client, buffer) {
    if (buffer?.length && (buffer[0] & 0x1f) === Protocol.ROOM_INPUT_UNRELIABLE) return;
    return super._onMessage(client, buffer);
  }

  onDispose() {
    if (NaiwaRoom.current === this) NaiwaRoom.current = null;
  }

  // Why this join can't happen, or null. `origin` is the browser's Origin header (missing for
  // programs that aren't browsers).
  refuse(options, origin) {
    const cfg = this.config;
    if (options.protocol !== PROTOCOL) return `${REFUSED.version}:${PROTOCOL}`;
    if (origin && !this.originAllowed(origin)) return REFUSED.origin;
    if (cfg.password && options.password !== cfg.password) return REFUSED.password;
    if (this.hasReachedMaxClients()) return REFUSED.full;
    return null;
  }

  originAllowed(origin) {
    const list = this.config.allowedOrigins;
    return !list?.length || list.includes('*') || list.includes(origin);
  }

  // ---------- Maps and runs ----------
  loadMap() {
    const maps = this.config.maps;
    const choice = parseMap(maps[this.rotation % maps.length]);
    const { world, layout } = buildMap(choice);
    this.world = world; this.layout = layout;
    const m = this.state.map;
    m.theme = choice.theme; m.id = choice.id; m.seed = choice.seed;
    this.newRun();
  }

  // A fresh sim on the current map and the lobby. Everyone here comes back in once they have
  // loaded it ('ready').
  newRun() {
    const S = this.state;
    this.sim = new Sim(this.world, this.layout);
    this.bulletIds = new Set();
    this.lastBullet = 0;
    S.run++;
    S.players.clear(); S.enemies.clear(); S.pickups.clear(); S.props.clear();
    for (const seat of this.seats.values()) seat.id = 0;
    S.phase = 'lobby';
    S.phaseT = LOBBY_SECONDS;
    this.sim.takeEvents();
    this.sync();
  }

  // Puts a seat's player into the sim and the state.
  seat(sid, seat) {
    const P = this.sim.addPlayer();
    seat.id = P.id;
    seat.cmd = idleCommand(P.aim);
    seat.quiet = 0;
    const ps = new PlayerState();
    ps.id = P.id;
    ps.name = seat.name;
    this.writePlayer(ps, P);
    this.state.players.set(sid, ps);
  }

  onJoin(client, options, auth) {
    this.seats.set(client.sessionId, { id: 0, name: auth?.name ?? cleanName(options?.name), cmd: null });
    if (this.stats) this.countBytes(client);
  }

  // The client has loaded run `run`'s map: into the sim (once per run).
  ready(client, run) {
    const seat = this.seats.get(client.sessionId);
    if (!seat || seat.id || run !== this.state.run) return;
    this.seat(client.sessionId, seat);
    // The lobby's countdown starts with the first player in.
    if (this.state.phase === 'lobby' && this.sim.players.size === 1) this.state.phaseT = LOBBY_SECONDS;
  }

  onLeave(client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    this.seats.delete(client.sessionId);
    if (seat.id) this.sim.removePlayer(seat.id);
    this.state.players.delete(client.sessionId);
    this.stats?.bytes.delete(client.sessionId);
    if (!this.seats.size) this.newRun();
  }

  // ---------- The fixed step ----------
  // This tick's command for each seat (see the file header).
  commands() {
    const cmds = {};
    for (const [sid, seat] of this.seats) {
      const c = seat.cmd;
      if (!seat.id) { this.inputs.get(sid).clear(); continue; }
      c.dash = c.reload = c.last = false; c.weapon = null; c.cycle = 0;
      if (++seat.quiet > STALE_STEPS) { c.mx = c.my = 0; c.fire = false; }
      for (const f of this.inputs.get(sid)) {
        seat.quiet = 0;
        c.mx = f.mx; c.my = f.my; c.aim = f.aim; c.fire = f.fire;
        c.dashDir = f.dashX || f.dashY ? { x: f.dashX, y: f.dashY } : null;
        if (f.dash) c.dash = true;
        if (f.reload) c.reload = true;
        if (f.last) c.last = true;
        if (f.weapon) c.weapon = weaponFromCode(f.weapon);
        c.cycle += f.cycle;
      }
      c.cycle = Math.max(-4, Math.min(4, c.cycle));
      cmds[seat.id] = c;
    }
    return cmds;
  }

  tick() {
    const t0 = performance.now(), S = this.state, sim = this.sim;
    const cmds = this.commands();
    if (S.phase === 'lobby') {
      // Players wait at the dock; the countdown only runs while someone is in.
      if (this.sim.players.size) {
        S.phaseT = nonNeg(S.phaseT - STEP);
        if (S.phaseT <= 0) S.phase = 'run';
      }
    } else {
      sim.step(STEP, cmds);
      if (S.phase === 'results') {
        S.phaseT = nonNeg(S.phaseT - STEP);
        if (S.phaseT <= 0) { this.rotation++; this.loadMap(); this.record(t0); return; }
      }
    }
    const events = sim.takeEvents();
    if (events.length) {
      if (S.phase === 'run' && events.some((e) => e.type === 'over')) { S.phase = 'results'; S.phaseT = RESULTS_SECONDS; }
      this.broadcast('events', packEvents(events));
    }
    this.sendBullets();
    this.record(t0);
  }

  // New bullets go out once, with what a client needs to fly them; then only their end.
  sendBullets() {
    const born = [], now = new Set();
    for (const b of this.sim.bullets) {
      now.add(b.id);
      if (b.id > this.lastBullet) born.push(packBullet(b));
    }
    const gone = [];
    for (const id of this.bulletIds) if (!now.has(id)) gone.push(id);
    for (const a of born) this.lastBullet = Math.max(this.lastBullet, a[0]);
    this.bulletIds = now;
    if (born.length) this.broadcast('bullet', born);
    if (gone.length) this.broadcast('bulletEnd', gone);
  }

  // ---------- Sim → state ----------
  // Before every patch (patchRate, 20 a second), not every step.
  onBeforePatch() { this.sync(); }

  sync() {
    const S = this.state, sim = this.sim;
    S.state = sim.state;
    S.stateT = nonNeg(sim.stateT);
    S.wave = sim.wave; S.score = sim.score; S.kills = sim.kills;
    S.queued = sim.queue.length;
    S.boss = sim.boss && !sim.boss.dead ? sim.boss.id : 0;
    for (const [sid, seat] of this.seats) {
      const P = sim.players.get(seat.id), ps = S.players.get(sid);
      if (P && ps) this.writePlayer(ps, P);
    }
    syncMap(S.enemies, sim.enemies.filter((e) => !e.dead), EnemyState, writeEnemy);
    syncMap(S.pickups, sim.pickups, PickupState, writePickup);
    syncMap(S.props, sim.props, PropState, (s, p) => { s.hp = Math.max(0, Math.ceil(p.hp)); });
  }

  writePlayer(s, P) {
    s.x = P.x; s.y = P.y; s.aim = P.aim; s.hp = P.hp;
    s.weapon = P.weapon;
    for (const k of Object.keys(P.arsenal)) {
      const a = P.arsenal[k];
      let slot = s.arsenal.get(k);
      if (!slot) s.arsenal.set(k, (slot = new Slot()));
      slot.mag = a.mag; slot.reserve = a.reserve === Infinity ? -1 : Math.min(32767, a.reserve);
    }
    for (const k of [...s.arsenal.keys()]) if (!P.arsenal[k]) s.arsenal.delete(k);
    s.reloading = nonNeg(P.reloading);
    s.moving = P.moving; s.vx = P.vx;
    s.dashT = nonNeg(P.dashT); s.dashCd = nonNeg(P.dashCd); s.invuln = nonNeg(P.invuln);
    s.laughT = P.laughT;
    s.down = P.down; s.bleedT = P.down ? nonNeg(P.bleedT) : 0; s.reviveT = P.reviveT; s.dead = P.dead;
    s.kills = P.kills; s.combo = P.combo; s.comboT = nonNeg(P.comboT);
  }

  // ---------- Stats (server.json "stats": true) ----------
  // Every 10 s: time per tick, memory and what each client was sent (payload + WebSocket frame
  // header, not TCP/IP).
  countBytes(client) {
    const ws = client.ref, send = ws.send.bind(ws), bytes = this.stats.bytes;
    bytes.set(client.sessionId, 0);
    ws.send = (data, ...rest) => {
      const n = data.byteLength ?? data.length;
      if (bytes.has(client.sessionId)) bytes.set(client.sessionId, bytes.get(client.sessionId) + n + (n < 126 ? 2 : 4));
      return send(data, ...rest);
    };
  }

  record(t0) {
    const st = this.stats;
    if (!st) return;
    const ms = performance.now() - t0;
    st.ticks++; st.tickMs += ms; st.maxMs = Math.max(st.maxMs, ms);
    const secs = (performance.now() - st.since) / 1000;
    if (secs < 10) return;
    const per = [...st.bytes.values()].map((b) => (b / secs / 1024).toFixed(1));
    const mem = process.memoryUsage();
    console.log(`[stats] ${this.state.phase} wave ${this.sim.wave}, ${this.seats.size} players, ${this.sim.enemies.length} enemies, ${this.sim.bullets.length} bullets | tick ${(st.tickMs / st.ticks).toFixed(3)} ms avg, ${st.maxMs.toFixed(2)} ms max | rss ${(mem.rss / 1048576).toFixed(0)} MB, heap ${(mem.heapUsed / 1048576).toFixed(0)} MB | sent KB/s per client: ${per.join(' ') || '-'}`);
    st.ticks = 0; st.tickMs = 0; st.maxMs = 0; st.since = performance.now();
    for (const k of st.bytes.keys()) st.bytes.set(k, 0);
  }
}

// Creates, updates and deletes a map's entries to match `list` (items with an id).
function syncMap(map, list, Ctor, write) {
  const keep = new Set();
  for (const item of list) {
    const key = String(item.id);
    keep.add(key);
    let s = map.get(key);
    if (!s) { s = new Ctor(); write(s, item); map.set(key, s); } else write(s, item);
  }
  if (map.size > keep.size) for (const key of [...map.keys()]) if (!keep.has(key)) map.delete(key);
}

function writeEnemy(s, e) {
  s.type = e.type;
  s.x = e.x; s.y = e.y; s.aim = e.aim;
  s.hp = e.hp; s.maxHp = e.maxHp;
  s.moving = e.moving; s.vx = e.vx;
  s.spawnT = nonNeg(e.spawnT);
}

function writePickup(s, p) {
  s.kind = p.kind; s.weapon = p.weapon ?? '';
  s.x = p.x; s.y = p.y;
  s.fading = p.life <= 4;
}
