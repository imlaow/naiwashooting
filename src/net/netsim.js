// The online stand-in for Sim: a mirror of a naiwa-server room's state (server/schema.js) with
// the parts of Sim's interface that the view (view/game.js, view/entities.js, view/hud.js) and
// the bot (sim/bot.js) read. Game draws it exactly as it draws a Sim: players by id, enemies,
// pickups, props and bullets as lists of objects that keep their identity between frames.
//
//   const net = new NetSim(room, world, layout);  // after the local player is in the state
//   net.tick(dt);                                 // each frame, first: reconcile the prediction
//   net.send(cmd);                                // each step, the local player's command
//   net.sync(dt);                                 // each frame: the mirrors for this frame
//   for (const e of net.takeEvents()) …           // the sim's events, on the drawn timeline
//
// Two timelines:
//   - The local player is predicted: every command it sends also runs the sim's own player
//     step (Player.update and the belt drift, the same code the server runs) on a copy of the
//     player, so it moves, dashes and shoots at once. When a patch acknowledges a command, the
//     copy goes back to the server's state for that command and replays the ones still on their
//     way (@colyseus/sdk's SimReconciler); what that moves is eased out over a few frames.
//     Damage, pickups, being downed and revived stay the server's.
//   - Everything else (other players, enemies, props, pickups appearing, bullets, events) is
//     drawn `delay` ms in the past on the server's clock (the patches' timestamps), between the
//     two patches either side, so it moves smoothly. Events and bullets carry the same clock, so
//     a kill's burst plays where the enemy is drawn and bullets leave the drawn muzzle.
//   Events about the local player play when they arrive; the shots, dashes and gun handling the
//   prediction already played aren't played again.
//
// One NetSim per run of the room (state.run): once the room has moved on to the next run, it
// stops following the state and its messages, and main.js starts a new Game for the new run.
// Nothing here imports Pixi, so tools/ can drive it in Node.
import { Predict } from '@colyseus/sdk';
import { StaticWorld } from '../sim/physics.js';
import { Player, WEAPONS, ENEMY_TYPES, moveBody } from '../sim/entities.js';
import { unpackBullet, weaponCode, sanitizeCommand, simCommand } from '../sim/protocol.js';

// How far in the past others are drawn, ms: one patch interval (50 ms) and room for jitter; more
// when the patches arrive unevenly (renderTime), up to 200.
export const DELAY = 100;
// Further than this between two patches is a jump (a respawn, an enemy put back on the map).
const JUMP = 150;
// Patches further apart than this (a dropped connection) aren't drawn between either.
const GAP = 400;
// How long the timeline keeps patches, ms.
const KEEP = 1500;
// Events about the local player that play as they arrive (it is drawn ahead of the timeline).
const MINE = new Set(['hurt', 'downed', 'revived', 'died', 'respawned', 'laugh', 'laughEnd', 'pickup']);
// The local player's own events that its prediction plays (the server's copies are dropped).
const PREDICTED = new Set(['shot', 'dash', 'switch', 'reload', 'reloaded', 'empty']);

// The predicted copy's numbers that the state rounds, with how far apart two values can be and
// still be the same on the wire (a step of their quantization). Timers are sent clamped at 0.
const WIRE = [['x', 0.06], ['y', 0.06], ['vx', 0.035], ['vy', 0.035], ['dashT', 0.001], ['dashCd', 0.0001], ['cooldown', 0.0001], ['reloading', 0.0001], ['invuln', 0.008]];
const TIMERS = new Set(['dashT', 'dashCd', 'cooldown', 'reloading', 'invuln']);

const lerp = (a, b, u) => a + (b - a) * u;
const lerpAngle = (a, b, u) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * u;

class NetPlayer {
  constructor(id) {
    this.id = id;
    this.r = 17; this.maxHp = 100; this.vy = 0;
    this.arsenal = {};
  }

  get up() { return !this.dead && !this.down; }
  get slot() { return this.arsenal[this.weapon] ?? { mag: 0, reserve: 0 }; }
  get def() { return WEAPONS[this.weapon]; }
}

class NetEnemy {
  constructor(id, type) {
    this.id = id; this.type = type; this.T = ENEMY_TYPES[type];
    this.r = this.T.r; this.dead = false;
    // The walk cycle runs here: it is only drawn (the sim's egg waddle steers by its own).
    this.animT = Math.random() * 4;
  }

  height() { return this.type === 'egg' ? 46 : 220 * this.T.scale; }
}

export class NetSim {
  // `room`: a joined @colyseus/sdk room; `world` / `layout`: buildMap of the room's map.
  // opts.delay: the timeline's delay (ms); opts.telemetry: record prediction errors and
  // corrections in `this.tele` (tools/net-feel.mjs).
  constructor(room, world, layout, opts = {}) {
    this.room = room;
    this.runId = room.state.run;
    this.island = world;
    this.delay = opts.delay ?? DELAY;
    this.input = room.input({ mode: 'reliable' });
    this.events = [];
    this.players = new Map();
    this.enemies = []; this.enemyById = new Map();
    this.pickups = []; this.pickupById = new Map();
    this.bullets = [];
    this.queue = { length: 0 };
    this.boss = null;
    this.ping = 0;
    // Map colliders as the server has them now, for the prediction, touch auto-aim's line of
    // sight and the bots. Crates and barrels join and leave with the latest state.
    this.statics = new StaticWorld();
    for (const c of layout.colliders) this.statics.add({ ...c });
    // The sim numbers props 1–n in layout order (Sim's constructor).
    this.allProps = layout.props.map((p, i) => ({ id: i + 1, kind: p.kind, x: p.x, y: p.y, hp: 0, collider: null }));
    this.props = [];

    // The timeline: patches as they arrived, events and bullets waiting for their time.
    this.snaps = [];
    this.T = 0;
    this.pending = []; // [t, event]
    this.flying = []; // { b, t0, x0, y0, end }: bullets, drawn from t0 (fired at x0, y0) until end
    this.killed = new Set(); // enemies whose kill has played
    this.shots = new Set(); // input seqs the prediction fired a shot on
    this.tele = opts.telemetry ? { errors: [], corrections: [], starved: 0, over: 0, frames: 0, shots: 0, matched: 0, late: 0 } : null;

    const onPatch = () => this.capture();
    room.onStateChange(onPatch);
    this.off = [
      () => room.onStateChange.remove(onPatch),
      room.onMessage('tick', ([t, events, born, gone]) => {
        if (!this.current) return;
        for (const e of events) this.arrive(t, e);
        for (const a of born) { const b = unpackBullet(a); this.flying.push({ b, t0: t, end: Infinity, x0: b.x, y0: b.y }); }
        for (const id of gone) {
          const f = this.flying.find((o) => o.b.id === id);
          if (f) f.end = t;
        }
      }),
      room.onMessage('pong', (t) => { if (Number.isFinite(t)) this.ping = Math.round(performance.now() - t); }),
    ];
    this.ms = 0; this.pingT = 0;
    this.predict = Predict.get(room, { delay: this.delay });
    this.me = this.predictor();
    this.capture();
    this.sync(0);
  }

  // Still the room's current run.
  get current() { return this.room.state.run === this.runId; }

  get state() { return this.room.state.state; }
  get stateT() { return this.room.state.stateT; }
  get wave() { return this.room.state.wave; }
  get score() { return this.room.state.score; }
  get kills() { return this.room.state.kills; }
  // The room's own phase ('lobby', 'run', 'results') and its countdown.
  get phase() { return this.room.state.phase; }
  get phaseT() { return this.room.state.phaseT; }
  get run() { return this.room.state.run; }
  // This client's player id, or undefined before the server has added it.
  get localId() { return this.room.state.players.get(this.room.sessionId)?.id; }
  // This client's player in the room state.
  get mine() { return this.room.state.players.get(this.room.sessionId); }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ---------- The local player ----------
  // A copy of the local player (the sim's own Player, on a stand-in for the sim) that each sent
  // command steps at once; @colyseus/sdk's SimReconciler puts it back to the server's state on
  // each acknowledged command and replays the rest.
  predictor() {
    const s = this.mine;
    const live = { on: false, seq: 0 };
    const stand = {
      island: this.island, statics: this.statics,
      newId: () => s.id,
      // Only a command's first run makes sounds and sparks; replays are silent.
      emit: (e) => { if (live.on && PREDICTED.has(e.type)) this.predicted(e, live.seq); },
      fireBullet() {}, onPlayerBledOut() {},
    };
    const P = new Player(stand, s.x, s.y);
    this.adopt(P, s);
    // What each command left the copy with (live and replayed), until it is acknowledged.
    const cmd = {}, history = new Map();
    return this.predict.sim({
      input: this.input,
      world: { P },
      // As Sim.step does for a player: its update, then the belts (Sim.applyDrift).
      step: (ctx, w, f) => {
        // The lobby takes commands but doesn't step the sim (players wait at the dock). Decided
        // when the command is first run, and kept for its replays.
        if (ctx.memo(() => (this.room.state.phase === 'lobby' ? 1 : 0))) return;
        const c = { mx: f.mx, my: f.my, aim: f.aim, fire: f.fire, dash: f.dash, dashX: f.dashX, dashY: f.dashY, reload: f.reload, weapon: f.weapon, cycle: f.cycle, last: f.last };
        sanitizeCommand(c);
        live.on = !ctx.isReplay; live.seq = ctx.tick;
        w.P.update(ctx.dt, simCommand(c, cmd));
        live.on = false;
        if (!w.P.dead) {
          const v = this.island.drift(w.P.x, w.P.y);
          if (v) moveBody(w.P, v * ctx.dt, 0);
        }
        const h = {};
        for (const [k] of WIRE) h[k] = w.P[k];
        history.set(ctx.tick, h);
      },
      // The server's state after the acknowledged command. Where it is what the copy had then,
      // as far as the wire's rounding can tell, the copy's own exact numbers stay: restarting
      // from rounded ones (0.06 px) can land a hair inside a wall, and the step would then refuse
      // to move (moveBody), a real misprediction made by the wire.
      adopt: (w) => {
        const st = this.mine;
        if (!st) return;
        const seq = this.input.lastProcessed, h = history.get(seq);
        for (const k of history.keys()) if (k <= seq) history.delete(k);
        if (h && this.tele) this.tele.errors.push({ seq, err: Math.hypot(h.x - st.x, h.y - st.y) });
        this.adopt(w.P, st);
        if (h) for (const [k, q] of WIRE) if (Math.abs(h[k] - st[k]) <= q || (TIMERS.has(k) && h[k] <= 0 && st[k] === 0)) w.P[k] = h[k];
      },
      pose: (w) => ({ x: w.P.x, y: w.P.y }),
      // A correction eases out with a time constant of one patch interval; a jump further than
      // a step can travel (respawn, revive at a spot, a long drop) moves at once.
      smoothMs: 60,
      snap: 120,
      onReconcile: () => { if (this.tele) this.tele.corrections.push(this.me.lastCorrectionMag); },
      warnOnDivergence: this.tele ? 1e9 : undefined,
    });
  }

  // The server's state of the local player into the predicted copy.
  adopt(P, s) {
    P.x = s.x; P.y = s.y; P.vx = s.vx; P.vy = s.vy; P.aim = s.aim;
    P.hp = s.hp;
    P.weapon = s.weapon; P.lastWeapon = s.lastWeapon || s.weapon;
    const ars = {};
    s.arsenal.forEach((a, k) => { ars[k] = { mag: a.mag, reserve: a.reserve < 0 ? Infinity : a.reserve }; });
    P.arsenal = ars;
    P.reloading = s.reloading; P.cooldown = s.cooldown;
    P.dashT = s.dashT; P.dashCd = s.dashCd; P.invuln = s.invuln;
    P.dashDir = { x: Math.cos(s.dashA), y: Math.sin(s.dashA) };
    P.moving = s.moving; P.laughT = s.laughT;
    P.down = s.down; P.bleedT = s.bleedT; P.dead = s.dead;
  }

  // A shot, dash or gun sound the prediction made: played now; a shot is remembered so the
  // server's copy isn't played again.
  predicted(e, seq) {
    if (e.type === 'shot') { this.shots.add(seq); e.seq = seq; if (this.tele) this.tele.shots++; }
    this.events.push({ ...e, predicted: true });
  }

  // The local player's command (see Player.update), as the room's Command.
  send(cmd) {
    if (!this.current) return;
    const d = this.input.data;
    d.mx = cmd.mx; d.my = cmd.my; d.aim = cmd.aim; d.fire = !!cmd.fire;
    d.dash = !!cmd.dash; d.dashX = cmd.dashDir?.x ?? 0; d.dashY = cmd.dashDir?.y ?? 0;
    d.reload = !!cmd.reload; d.weapon = cmd.weapon ? weaponCode(cmd.weapon) : 0;
    d.cycle = Math.max(-4, Math.min(4, Math.trunc(cmd.cycle) || 0)); d.last = !!cmd.last;
    this.input.send();
  }

  // Each frame before the commands: the prediction catches up with acknowledged commands, and
  // every 2 s the round trip is measured (a 'ping' the server answers; it also carries the last
  // measurement, for the scoreboard). Not the SDK's room.ping(): it has one slot, and the debug
  // panel's own pings would take it over.
  tick(dt) {
    this.ms += dt * 1000;
    this.predict.tick(this.ms);
    const acked = this.input.lastProcessed;
    for (const s of this.shots) if (s < acked - 10) this.shots.delete(s);
    this.pingT -= dt;
    if (this.pingT <= 0 && this.room.connection?.isOpen) {
      this.pingT = 2;
      this.room.send('ping', [performance.now(), this.ping]);
    }
  }

  // ---------- The timeline ----------
  // A patch has been applied: keep what is drawn of it, stamped with its server time.
  capture() {
    if (!this.current) return;
    const S = this.room.state, t = this.room.clock.lastServerTime();
    const players = new Map(), enemies = new Map(), props = new Set(), pickups = new Set();
    S.players.forEach((s) => players.set(s.id, {
      x: s.x, y: s.y, aim: s.aim, hp: s.hp, weapon: s.weapon, reloading: s.reloading, moving: s.moving, vx: s.vx,
      dashT: s.dashT, invuln: s.invuln, laughT: s.laughT, down: s.down, bleedT: s.bleedT, reviveT: s.reviveT, dead: s.dead,
    }));
    S.enemies.forEach((s, key) => enemies.set(Number(key), {
      type: s.type, x: s.x, y: s.y, aim: s.aim, hp: s.hp, maxHp: s.maxHp, moving: s.moving, vx: s.vx, spawnT: s.spawnT,
    }));
    S.props.forEach((_, key) => props.add(Number(key)));
    S.pickups.forEach((_, key) => pickups.add(Number(key)));
    const snaps = this.snaps, snap = { t, players, enemies, props, pickups };
    if (snaps.length && snaps[snaps.length - 1].t >= t) snaps[snaps.length - 1] = snap;
    else snaps.push(snap);
    while (snaps.length > 2 && snaps[1].t < t - KEEP) snaps.shift();
  }

  // An event from the server (at server time t): about the local player, now; else when the
  // timeline gets there.
  arrive(t, e) {
    const me = this.localId;
    if (e.id === me && PREDICTED.has(e.type)) {
      // Already played by the prediction: a shot it fired within two commands of the server's
      // (a held or folded step moves it by one or two; even the SMG fires only every 4.5 steps,
      // so that can't pair two different shots). One it didn't see coming plays late.
      if (e.type !== 'shot') return;
      for (const s of [e.seq, e.seq + 1, e.seq - 1, e.seq + 2, e.seq - 2]) if (this.shots.delete(s)) { if (this.tele) this.tele.matched++; return; }
      if (this.tele) this.tele.late++;
      this.events.push(e);
    } else if ((e.id === me && MINE.has(e.type)) || (e.type === 'bite' && e.target === me)) {
      // Drawn on the predicted player, not where the server had him.
      if (e.type === 'hurt' || e.type === 'laugh' || e.type === 'laughEnd') { const C = this.me.world.P; e.x = C.x; e.y = C.y; }
      this.events.push(e);
    } else this.pending.push([t, e]);
  }

  // The time the timeline draws: `delay` behind the newest patch's server time, on the SDK's
  // smoothed server clock (renderNow() − rtt/2 is the newest patch's time plus the time since it
  // arrived). It plays at real speed, a little faster or slower while it is off that mark (late
  // patches after a stall are caught up over a few tenths of a second instead of in one jump),
  // never goes back, and holds at the newest patch when the next one is late.
  renderTime(dt) {
    const c = this.room.clock, newest = this.snaps[this.snaps.length - 1].t;
    // More jitter, more delay (the SDK's estimate of how unevenly patches arrive).
    const delay = Math.min(200, Math.max(this.delay, 50 + 4 * c.jitter()));
    const target = c.lastServerTime() ? c.renderNow() - c.smoothedRtt() / 2 - delay : newest;
    let T = this.T;
    if (!T || Math.abs(target - T) > 500) T = target;
    else T += dt * 1000 * Math.max(0.5, Math.min(1.6, 1 + (target - T) / 200));
    if (T > newest) {
      if (this.tele) { this.tele.starved++; this.tele.over = Math.max(this.tele.over, T - newest); }
      T = newest;
    }
    return (this.T = Math.max(this.T, T));
  }

  // The patches either side of T, and how far between them T is.
  bracket(T) {
    const s = this.snaps;
    let i = s.length - 1;
    while (i > 0 && s[i].t > T) i--;
    const A = s[i], B = s[i + 1];
    if (!B || B.t - A.t > GAP || T <= A.t) return [A, null, 0];
    return [A, B, (T - A.t) / (B.t - A.t)];
  }

  // As Sim.nearestEnemy.
  nearestEnemy(x, y, maxD) {
    let best = null, bd = maxD;
    for (const e of this.enemies) {
      if (e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd && this.statics.clearLine(x, y, e.x, e.y, 24)) { bd = d; best = e; }
    }
    return best;
  }

  // The mirrors for this frame: the predicted local player, everything else at the timeline's
  // time, and the events and bullets up to it.
  sync(dt) {
    const S = this.room.state;
    if (!this.current || !this.snaps.length) return;
    if (this.tele) this.tele.frames++;
    this.queue.length = S.queued;
    const T = this.renderTime(dt);
    const [A, B, u] = this.bracket(T);

    // Events up to T, in order.
    let n = 0;
    while (n < this.pending.length && this.pending[n][0] <= T) {
      const e = this.pending[n++][1];
      if (e.type === 'kill') this.killed.add(e.id);
      this.events.push(e);
    }
    if (n) this.pending.splice(0, n);

    // Players: the latest state for names and scores; others drawn at T, the local one predicted.
    const latest = new Map();
    S.players.forEach((s) => latest.set(s.id, s));
    const me = this.localId, seen = new Set();
    for (const [id, a] of A.players) {
      if (id === me) continue;
      const P = this.player(id), b = B?.players.get(id);
      Object.assign(P, a);
      if (b && !a.dead && !b.dead && Math.hypot(b.x - a.x, b.y - a.y) < JUMP) {
        P.x = lerp(a.x, b.x, u); P.y = lerp(a.y, b.y, u); P.aim = lerpAngle(a.aim, b.aim, u);
        P.vx = lerp(a.vx, b.vx, u);
      }
      seen.add(id);
    }
    const s = latest.get(me);
    if (s) {
      const P = this.player(me), C = this.me.world.P;
      P.x = this.me.value('x'); P.y = this.me.value('y');
      P.aim = C.aim; P.weapon = C.weapon; P.arsenal = C.arsenal; P.reloading = C.reloading;
      P.moving = C.moving; P.vx = C.vx; P.dashT = C.dashT; P.dashCd = C.dashCd; P.invuln = C.invuln;
      P.hp = s.hp; P.laughT = s.laughT; P.down = s.down; P.bleedT = s.bleedT; P.reviveT = s.reviveT; P.dead = s.dead;
      seen.add(me);
    }
    for (const [id, P] of this.players) {
      if (!seen.has(id)) { this.players.delete(id); continue; }
      const l = latest.get(id);
      if (l) {
        P.name = l.name; P.colour = l.colour; P.ping = l.ping;
        P.kills = l.kills; P.combo = l.combo; P.comboT = l.comboT; P.revives = l.revives; P.downs = l.downs;
      }
    }

    // Enemies at T; a killed one goes when its kill plays.
    const enemies = [], keep = new Set();
    for (const [id, a] of A.enemies) {
      if (this.killed.has(id)) continue;
      let e = this.enemyById.get(id);
      if (!e) this.enemyById.set(id, (e = new NetEnemy(id, a.type)));
      const b = B?.enemies.get(id);
      e.x = a.x; e.y = a.y; e.aim = a.aim; e.hp = a.hp; e.maxHp = a.maxHp;
      e.moving = a.moving; e.vx = a.vx; e.spawnT = a.spawnT;
      if (b && b.spawnT <= a.spawnT && Math.hypot(b.x - a.x, b.y - a.y) < JUMP) {
        e.x = lerp(a.x, b.x, u); e.y = lerp(a.y, b.y, u); e.aim = lerpAngle(a.aim, b.aim, u);
        e.vx = lerp(a.vx, b.vx, u); e.spawnT = lerp(a.spawnT, b.spawnT, u);
      }
      if (e.spawnT <= 0) e.animT += dt * (e.moving ? (e.type === 'egg' ? 12 : 8) : 2);
      keep.add(id);
      enemies.push(e);
    }
    for (const id of this.enemyById.keys()) if (!keep.has(id)) this.enemyById.delete(id);
    for (const id of this.killed) if (!A.enemies.has(id) && !S.enemies.has(String(id))) this.killed.delete(id);
    this.enemies = enemies;
    this.boss = this.enemyById.get(S.boss) ?? null;

    // Pickups appear at T (a dropped gun with its kill) and go as soon as the server says.
    const pickups = [], pkeep = new Set();
    S.pickups.forEach((ps, key) => {
      const id = Number(key);
      if (!A.pickups.has(id)) return;
      let p = this.pickupById.get(id);
      if (!p) this.pickupById.set(id, (p = { id }));
      p.kind = ps.kind; p.weapon = ps.weapon || null; p.x = ps.x; p.y = ps.y;
      p.life = ps.fading ? 0 : Infinity;
      pkeep.add(id);
      pickups.push(p);
    });
    for (const id of this.pickupById.keys()) if (!pkeep.has(id)) this.pickupById.delete(id);
    this.pickups = pickups;

    // Props: drawn as they are at T; their colliders follow the latest state.
    this.props = [];
    for (const p of this.allProps) {
      const live = S.props.get(String(p.id));
      if (live) {
        p.hp = live.hp;
        p.collider ??= this.statics.add({ kind: 'circle', x: p.x, y: p.y - 12, r: p.kind === 'crate' ? 22 : 17, owner: p });
      } else if (p.collider) {
        this.statics.remove(p.collider);
        p.collider = null;
      }
      if (A.props.has(p.id)) this.props.push(p);
    }

    // Bullets: in a straight line from where and when they were fired, until their end.
    const bullets = [];
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i], b = f.b;
      const age = (T - f.t0) / 1000;
      // Only in case its end never comes.
      if (T >= f.end || age > b.life + 0.5) { this.flying.splice(i, 1); continue; }
      if (age < 0) continue;
      b.x = f.x0 + b.vx * age; b.y = f.y0 + b.vy * age;
      bullets.push(b);
    }
    this.bullets = bullets.reverse();
  }

  player(id) {
    let P = this.players.get(id);
    if (!P) this.players.set(id, (P = new NetPlayer(id)));
    return P;
  }

  destroy() {
    for (const off of this.off) off();
    this.predict.dispose();
  }
}
