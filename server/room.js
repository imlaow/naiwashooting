// NaiwaRoom: the one room a naiwa-server runs (the server is the room). It runs the sim from
// src/sim at a fixed 1/60 s step, feeds it the clients' commands and sends back the state
// (server/schema.js) plus the sim's events and bullets (src/sim/protocol.js).
//
// Lifecycle: 'lobby' (players stand at the dock; the run starts LOBBY_SECONDS after the first
// one is in), 'run', 'results' for RESULTS_SECONDS once everyone is down or dead, then the next
// map of the rotation and its lobby. When the last player leaves, the room goes back to the
// lobby with a fresh sim on the same map.
//
// PvP ("mode": "pvp"): the same lifecycle, with a deathmatch sim (src/sim/sim.js) whose round
// ends at server.json's pvp.killLimit or pvp.timeLimit; that 'over' starts the results.
//
// A client is only put into the sim once it has loaded the run's map: it sends 'ready' with
// the run number (state.run) after joining and again after every new run, so nobody stands
// defenceless at the dock while their browser is still painting the island. The sim itself
// makes late joiners wait for the wave break.
//
// Commands: each step takes exactly one command per player (inputs.next()), so the input the
// state acknowledges is the one that was simulated and the browser's prediction can replay the
// rest. A step with no command waiting (a late packet) holds the last stick, aim and trigger
// for up to STALE_STEPS, then lets go (a hidden tab stops sending); a dropped player lets go at
// once. The commands that then arrive late stand for steps that already ran on that guess, so
// as many of them are folded into the next step's command (movement, aim and trigger from the
// newest, one-shot presses — dash, reload, weapon, cycle, last — from any of them, so a press is
// never lost): a player walking on through a stall ends up where their browser predicted, and
// isn't left behind by it. A backlog that builds up anyway (a client sending a little fast) is
// folded away the same way, slowly.
//
// A dropped connection keeps its seat (it counts as taken) for RECONNECT_SECONDS: the player stays
// in the sim, standing still, and can be downed. The browser's SDK reconnects with its token,
// which only works for that held seat, so the version, password and origin checks of the first
// join still stand.
import { Room, ServerError, ErrorCode, CloseCode, Protocol } from '@colyseus/core';
import { makeChoice, buildMap, RANDOM_ID } from '../src/sim/maps.js';
import { Sim, STEP } from '../src/sim/sim.js';
import { idleCommand } from '../src/sim/entities.js';
import { PROTOCOL, RECONNECT_SECONDS, CHAT_MAX, CHAT_GAP, packBullet, packEvents, cleanText, sanitizeCommand, simCommand } from '../src/sim/protocol.js';
import { NaiwaState, PlayerState, EnemyState, PickupState, PropState, Slot, Command } from './schema.js';

export const LOBBY_SECONDS = 10;
export const RESULTS_SECONDS = 10;
export const NAME_MAX = 16;
export const STALE_STEPS = 60; // 1 s: a slow phone still sends several commands a second
// Commands waiting beyond BACKLOG_STEPS are folded into the step's command at once; a smaller
// backlog, more than CUSHION, that stands for DRAIN_STEPS loses one the same way.
export const BACKLOG_STEPS = 12;
export const DRAIN_STEPS = 60;
// Late commands are folded only beyond CUSHION waiting; debt is forgotten after DEBT_STEPS.
export const CUSHION = 2;
export const DEBT_STEPS = 120;

// The ways of losing a connection that @colyseus/sdk reconnects after (its Room.connect); a seat
// is held only for those. A client the server threw out (WITH_ERROR) leaves at once.
const MAY_RECONNECT = new Set([CloseCode.GOING_AWAY, CloseCode.NO_STATUS_RECEIVED, CloseCode.ABNORMAL_CLOSURE, CloseCode.MAY_TRY_RECONNECT]);

// Why a join was refused; the browser turns these into messages (src/net/online.js).
export const REFUSED = { version: 'version', full: 'full', password: 'password', origin: 'origin' };

// Whether a browser from `origin` may play: an empty list or '*' lets any site in. Used by the
// room's join check and the server's WebSocket upgrade alike.
export const originAllowed = (list, origin) => !list?.length || list.includes('*') || list.includes(origin);

// A display name: printable, trimmed, at most NAME_MAX characters.
export const cleanName = (name) => cleanText(name, NAME_MAX) || 'Naiwa';

// "island/cove", "factory/dairy", "island/random" (a new seed each time) → a map choice.
export function parseMap(entry) {
  const [theme, id = ''] = String(entry).split('/');
  return makeChoice(theme, id, id === RANDOM_ID ? 0 : undefined);
}

// What a step without a command keeps of the last one: the stick, aim and trigger, no presses.
const holdLast = ({ latest }) => (latest ? { mx: latest.mx, my: latest.my, aim: latest.aim, fire: latest.fire, dashX: latest.dashX, dashY: latest.dashY } : true);

// Folds later commands into `f`: movement, aim and trigger from the newest, presses from any.
function fold(f, later) {
  const m = { mx: f.mx, my: f.my, aim: f.aim, fire: f.fire, dash: f.dash, dashX: f.dashX, dashY: f.dashY, reload: f.reload, weapon: f.weapon, cycle: f.cycle, last: f.last };
  for (const g of later) {
    m.mx = g.mx; m.my = g.my; m.aim = g.aim; m.fire = g.fire; m.dashX = g.dashX; m.dashY = g.dashY;
    m.dash ||= g.dash; m.reload ||= g.reload; m.last ||= g.last;
    if (g.weapon) m.weapon = g.weapon;
    m.cycle = Math.max(-4, Math.min(4, m.cycle + g.cycle));
  }
  return m;
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
    if (config.mode !== 'coop' && config.mode !== 'pvp') throw new Error(`mode "${config.mode}" isn't supported (only "coop" and "pvp")`);
    this.config = config;
    this.maxClients = config.maxPlayers;
    this.autoDispose = false;
    this.reconnectSeconds = RECONNECT_SECONDS;
    this.setState(new NaiwaState());
    this.state.mode = config.mode;
    this.inputs = this.defineInput(Command, { sanitize: sanitizeCommand, idle: holdLast, bufferMaxSize: 240 });
    // sessionId → { id: sim player id (0 until ready), name, colour, cmd, … }
    this.seats = new Map();
    this.onMessage('ready', (client, run) => this.ready(client, run));
    this.onMessage('chat', (client, text) => this.chat(client, text));
    // [the client's clock, its last measured round trip]: answered at once with the clock.
    this.onMessage('ping', (client, m) => {
      const [t, ms] = Array.isArray(m) ? m : [];
      const seat = this.seats.get(client.sessionId);
      if (seat && Number.isFinite(ms)) seat.ping = Math.max(0, Math.min(9999, Math.round(ms)));
      if (Number.isFinite(t)) client.send('pong', t);
    });
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

  // The server's log: joins, leaves, reconnects (server.json "log": false turns it off).
  log(msg) {
    if (this.config.log !== false) console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
  }

  // Why this join can't happen, or null. `origin` is the browser's Origin header (missing for
  // programs that aren't browsers).
  refuse(options, origin) {
    const cfg = this.config;
    if (options.protocol !== PROTOCOL) return `${REFUSED.version}:${PROTOCOL}`;
    if (origin && !originAllowed(cfg.allowedOrigins, origin)) return REFUSED.origin;
    if (cfg.password && options.password !== cfg.password) return REFUSED.password;
    // A seat held for a dropped player counts too.
    if (this.hasReachedMaxClients()) return REFUSED.full;
    return null;
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

  // The sim's rules for the configured mode (null: co-op).
  rules() {
    const { mode, pvp } = this.config;
    return mode === 'pvp' ? { mode, killLimit: pvp.killLimit, timeLimit: pvp.timeLimit } : null;
  }

  // A fresh sim on the current map and the lobby. Everyone here comes back in once they have
  // loaded it ('ready').
  newRun() {
    const S = this.state;
    this.sim = new Sim(this.world, this.layout, this.rules());
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
    seat.quiet = 0; seat.backlogT = 0; seat.seq = 0;
    // Steps that ran on a held command and whose own commands haven't come yet.
    seat.debt = 0; seat.debtT = 0;
    // How many steps went without a command, and how many commands were folded into another.
    seat.idleSteps = 0; seat.folded = 0;
    const ps = new PlayerState();
    ps.id = P.id;
    ps.name = seat.name;
    ps.colour = seat.colour;
    this.writePlayer(ps, P, seat);
    this.state.players.set(sid, ps);
  }

  onJoin(client, options, auth) {
    // Colours by join order: the lowest one nobody here has.
    const taken = new Set([...this.seats.values()].map((s) => s.colour));
    let colour = 0;
    while (taken.has(colour)) colour++;
    const seat = { id: 0, name: auth?.name ?? cleanName(options?.name), colour, cmd: null, ping: 0, chatAt: -Infinity, dropped: false };
    this.seats.set(client.sessionId, seat);
    if (this.stats) this.countBytes(client);
    this.log(`${seat.name} joined (${this.seats.size}/${this.maxClients})`);
    this.broadcast('chat', { k: 'join', n: seat.name, c: seat.colour }, { except: client });
  }

  // The client has loaded run `run`'s map: into the sim (once per run). In any phase: the lobby,
  // the run (co-op makes late joiners wait for the wave break; PvP puts them in at once, far from
  // everyone, protected) or the results (in PvP they wait dead for the next map).
  ready(client, run) {
    const seat = this.seats.get(client.sessionId);
    if (!seat || seat.id || run !== this.state.run) return;
    this.seat(client.sessionId, seat);
    // The lobby's countdown starts with the first player in.
    if (this.state.phase === 'lobby' && this.sim.players.size === 1) this.state.phaseT = LOBBY_SECONDS;
  }

  // Lost without leaving: hold the seat while the browser reconnects (onLeave follows otherwise).
  onDrop(client, code) {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !MAY_RECONNECT.has(code)) return;
    seat.dropped = true;
    this.log(`${seat.name} lost the connection; holding the seat for ${this.reconnectSeconds} s`);
    this.broadcast('chat', { k: 'drop', n: seat.name, c: seat.colour }, { except: client });
    this.allowReconnection(client, this.reconnectSeconds).catch(() => {});
  }

  onReconnect(client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    seat.dropped = false;
    if (this.stats) this.countBytes(client);
    this.log(`${seat.name} reconnected`);
    this.broadcast('chat', { k: 'back', n: seat.name, c: seat.colour }, { except: client });
  }

  // Left for good: they said so, or the held seat ran out.
  onLeave(client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    this.seats.delete(client.sessionId);
    if (seat.id) this.sim.removePlayer(seat.id);
    this.state.players.delete(client.sessionId);
    this.stats?.bytes.delete(client.sessionId);
    this.log(`${seat.name} left${seat.dropped ? ' (did not come back)' : ''} (${this.seats.size}/${this.maxClients})`);
    this.broadcast('chat', { k: 'leave', n: seat.name, c: seat.colour });
    // A PvP round nobody is in any more, with the players left still loading it: a fresh one for
    // them in the lobby, rather than its clock running out on nobody into a draw. (Co-op ends
    // such a run when the first of them comes in, see Sim.addPlayer.)
    if (!this.seats.size || this.sim.pvp && this.state.phase === 'run' && !this.sim.players.size) this.newRun();
  }

  // A chat line: one a second per player, CHAT_MAX characters, printable only.
  chat(client, text) {
    const seat = this.seats.get(client.sessionId);
    const line = cleanText(text, CHAT_MAX);
    const now = this.clock.elapsedTime / 1000;
    if (!seat || !line || now - seat.chatAt < CHAT_GAP) return;
    seat.chatAt = now;
    this.broadcast('chat', { n: seat.name, c: seat.colour, t: line });
  }

  // ---------- The fixed step ----------
  // This step's command for each seat (see the file header).
  commands() {
    const cmds = {};
    for (const [sid, seat] of this.seats) {
      const acc = this.inputs.get(sid);
      if (!seat.id) { acc.clear(); continue; }
      let f = acc.next();
      if (acc.wasIdle) {
        seat.idleSteps++;
        seat.debtT = 0;
        if (seat.dropped || ++seat.quiet > STALE_STEPS) { f.mx = f.my = 0; f.fire = false; seat.debt = 0; }
        else seat.debt++;
      } else {
        seat.quiet = 0;
        // Late commands pay for the guessed steps, beyond one kept waiting against jitter; a
        // debt nothing pays within a couple of seconds was jitter the cushion took.
        if (++seat.debtT > DEBT_STEPS) seat.debt = 0;
        let extra = Math.min(seat.debt, Math.max(0, acc.size - CUSHION));
        seat.debt -= extra;
        const left = acc.size - extra;
        seat.backlogT = left > CUSHION ? seat.backlogT + 1 : 0;
        if (left > BACKLOG_STEPS) extra += left - BACKLOG_STEPS;
        else if (seat.backlogT >= DRAIN_STEPS) { extra++; seat.backlogT = 0; }
        if (extra) { f = fold(f, acc.take(extra)); seat.folded += extra; }
      }
      seat.seq = acc.consumedCount;
      cmds[seat.id] = simCommand(f, seat.cmd);
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
    if (S.phase === 'run' && events.some((e) => e.type === 'over')) { S.phase = 'results'; S.phaseT = RESULTS_SECONDS; }
    // The input a shot came from, so its player's browser knows it already showed it.
    for (const e of events) if (e.type === 'shot') e.seq = this.seatOf(e.id)?.seq ?? 0;
    const [born, gone] = this.bullets();
    // Whole ms, as the patches carry it.
    if (events.length || born.length || gone.length) this.broadcast('tick', [this.clock.elapsedTime >>> 0, packEvents(events), born, gone]);
    this.record(t0);
  }

  seatOf(id) {
    for (const seat of this.seats.values()) if (seat.id === id) return seat;
    return null;
  }

  // New bullets go out once, with what a client needs to fly them; then only their end.
  bullets() {
    const born = [], now = new Set();
    for (const b of this.sim.bullets) {
      now.add(b.id);
      if (b.id > this.lastBullet) born.push(packBullet(b));
    }
    const gone = [];
    for (const id of this.bulletIds) if (!now.has(id)) gone.push(id);
    for (const a of born) this.lastBullet = Math.max(this.lastBullet, a[0]);
    this.bulletIds = now;
    return [born, gone];
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
    if (sim.pvp) { S.timeLeft = nonNeg(sim.roundT); S.killLimit = sim.killLimit; S.winner = sim.winner ?? 0; }
    for (const [sid, seat] of this.seats) {
      const P = sim.players.get(seat.id), ps = S.players.get(sid);
      if (P && ps) this.writePlayer(ps, P, seat);
    }
    syncMap(S.enemies, sim.enemies.filter((e) => !e.dead), EnemyState, writeEnemy);
    syncMap(S.pickups, sim.pickups, PickupState, writePickup);
    syncMap(S.props, sim.props, PropState, (s, p) => { s.hp = Math.max(0, Math.ceil(p.hp)); });
  }

  writePlayer(s, P, seat) {
    s.ping = seat.ping; s.away = seat.dropped;
    s.x = P.x; s.y = P.y; s.aim = P.aim; s.hp = P.hp;
    s.weapon = P.weapon; s.lastWeapon = P.lastWeapon;
    for (const k of Object.keys(P.arsenal)) {
      const a = P.arsenal[k];
      let slot = s.arsenal.get(k);
      if (!slot) s.arsenal.set(k, (slot = new Slot()));
      slot.mag = a.mag; slot.reserve = a.reserve === Infinity ? -1 : Math.min(32767, a.reserve);
    }
    for (const k of [...s.arsenal.keys()]) if (!P.arsenal[k]) s.arsenal.delete(k);
    s.reloading = nonNeg(P.reloading); s.cooldown = nonNeg(P.cooldown);
    s.moving = P.moving; s.vx = P.vx; s.vy = P.vy;
    s.dashT = nonNeg(P.dashT); s.dashCd = nonNeg(P.dashCd); s.invuln = nonNeg(P.invuln);
    if (P.dashDir) s.dashA = Math.atan2(P.dashDir.y, P.dashDir.x);
    s.laughT = P.laughT;
    s.down = P.down; s.bleedT = P.down ? nonNeg(P.bleedT) : 0; s.reviveT = P.reviveT; s.dead = P.dead;
    s.respawnT = P.dead ? nonNeg(P.respawnT) : 0;
    s.kills = P.kills; s.combo = P.combo; s.comboT = nonNeg(P.comboT);
    s.revives = P.revives; s.downs = P.downs;
  }

  // ---------- Stats (server.json "stats": true) ----------
  // Every 10 s: time per tick, memory and what each client was sent (payload + WebSocket frame
  // header, not TCP/IP).
  countBytes(client) {
    const ws = client.ref, send = ws.send.bind(ws), bytes = this.stats.bytes;
    if (!bytes.has(client.sessionId)) bytes.set(client.sessionId, 0);
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
