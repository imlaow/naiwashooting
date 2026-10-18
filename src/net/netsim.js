// The online stand-in for Sim: a mirror of a naiwa-server room's state (server/schema.js) with
// the parts of Sim's interface that the view (view/game.js, view/entities.js, view/hud.js) and
// the bot (sim/bot.js) read. Game draws it exactly as it draws a Sim: players by id, enemies,
// pickups, props and bullets as lists of objects that keep their identity between frames.
//
//   const net = new NetSim(room, world, layout);  // after the first state has arrived
//   net.send(cmd);                                // each step, the local player's command
//   net.sync(dt);                                 // each frame: copy the state, fly bullets
//   for (const e of net.takeEvents()) …           // the sim's events, as the server sent them
//
// One NetSim per run of the room (state.run): once the room has moved on to the next run, it
// stops following the state and its messages, and main.js starts a new Game for the new run.
// No prediction or interpolation yet: everything is drawn where the last patch put it.
// Bullets come as messages (sim/protocol.js) and fly in a straight line until their end.
// Nothing here imports Pixi or the Colyseus SDK, so tools/ can drive it in Node.
import { StaticWorld } from '../sim/physics.js';
import { WEAPONS, ENEMY_TYPES } from '../sim/entities.js';
import { unpackBullet, weaponCode } from '../sim/protocol.js';

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
  constructor(room, world, layout) {
    this.room = room;
    this.runId = room.state.run;
    this.island = world;
    this.input = room.input({ mode: 'reliable' });
    this.events = [];
    this.players = new Map();
    this.enemies = []; this.enemyById = new Map();
    this.pickups = []; this.pickupById = new Map();
    this.bullets = [];
    this.queue = { length: 0 };
    this.boss = null;
    // Map colliders as the server has them, for touch auto-aim's line of sight and the bots.
    this.statics = new StaticWorld();
    for (const c of layout.colliders) this.statics.add({ ...c });
    // The sim numbers props 1–n in layout order (Sim's constructor).
    this.allProps = layout.props.map((p, i) => ({ id: i + 1, kind: p.kind, x: p.x, y: p.y, hp: 0, collider: null }));
    this.props = [];
    this.off = [
      room.onMessage('events', (list) => { if (this.current) for (const e of list) this.events.push(e); }),
      room.onMessage('bullet', (list) => { if (this.current) for (const a of list) this.bullets.push(unpackBullet(a)); }),
      room.onMessage('bulletEnd', (ids) => {
        if (!this.current) return;
        const gone = new Set(ids);
        this.bullets = this.bullets.filter((b) => !gone.has(b.id));
      }),
    ];
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

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // The local player's command (see Player.update), as the room's Command.
  send(cmd) {
    const d = this.input.data;
    d.mx = cmd.mx; d.my = cmd.my; d.aim = cmd.aim; d.fire = !!cmd.fire;
    d.dash = !!cmd.dash; d.dashX = cmd.dashDir?.x ?? 0; d.dashY = cmd.dashDir?.y ?? 0;
    d.reload = !!cmd.reload; d.weapon = cmd.weapon ? weaponCode(cmd.weapon) : 0;
    d.cycle = Math.max(-4, Math.min(4, Math.trunc(cmd.cycle) || 0)); d.last = !!cmd.last;
    this.input.send();
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

  // Copies the latest state into the mirrors and moves bullets and walk cycles on by dt.
  sync(dt) {
    const S = this.room.state;
    if (!this.current) return;
    this.queue.length = S.queued;

    const seen = new Set();
    S.players.forEach((s) => {
      let P = this.players.get(s.id);
      if (!P) this.players.set(s.id, (P = new NetPlayer(s.id)));
      seen.add(s.id);
      P.name = s.name; P.x = s.x; P.y = s.y; P.aim = s.aim; P.hp = s.hp;
      P.weapon = s.weapon; P.reloading = s.reloading; P.moving = s.moving; P.vx = s.vx;
      P.dashT = s.dashT; P.dashCd = s.dashCd; P.invuln = s.invuln; P.laughT = s.laughT;
      P.down = s.down; P.bleedT = s.bleedT; P.reviveT = s.reviveT; P.dead = s.dead;
      P.kills = s.kills; P.combo = s.combo; P.comboT = s.comboT;
      const ars = {};
      s.arsenal.forEach((a, k) => { ars[k] = { mag: a.mag, reserve: a.reserve < 0 ? Infinity : a.reserve }; });
      P.arsenal = ars;
    });
    for (const id of this.players.keys()) if (!seen.has(id)) this.players.delete(id);

    this.enemies = this.mirror(S.enemies, this.enemyById, (key, s) => new NetEnemy(Number(key), s.type), (e, s) => {
      e.x = s.x; e.y = s.y; e.aim = s.aim; e.hp = s.hp; e.maxHp = s.maxHp;
      e.moving = s.moving; e.vx = s.vx; e.spawnT = s.spawnT;
      if (e.spawnT <= 0) e.animT += dt * (e.moving ? (e.type === 'egg' ? 12 : 8) : 2);
    });
    this.boss = this.enemyById.get(S.boss) ?? null;

    this.pickups = this.mirror(S.pickups, this.pickupById, (key) => ({ id: Number(key) }), (p, s) => {
      p.kind = s.kind; p.weapon = s.weapon || null; p.x = s.x; p.y = s.y;
      p.life = s.fading ? 0 : Infinity;
    });

    // Props: the living ones, with their colliders, as in the sim.
    this.props = [];
    for (const p of this.allProps) {
      const s = S.props.get(String(p.id));
      if (s) {
        p.hp = s.hp;
        p.collider ??= this.statics.add({ kind: 'circle', x: p.x, y: p.y - 12, r: p.kind === 'crate' ? 22 : 17, owner: p });
        this.props.push(p);
      } else if (p.collider) {
        this.statics.remove(p.collider);
        p.collider = null;
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt;
      // Only in case its end never comes.
      if (b.life < -0.5) this.bullets.splice(i, 1);
    }
  }

  // Keeps one mirror object per key of a schema map, in a list.
  mirror(map, byId, create, update) {
    const list = [], keep = new Set();
    map.forEach((s, key) => {
      const id = Number(key);
      let o = byId.get(id);
      if (!o) byId.set(id, (o = create(key, s)));
      update(o, s);
      keep.add(id);
      list.push(o);
    });
    for (const id of byId.keys()) if (!keep.has(id)) byId.delete(id);
    return list;
  }

  destroy() {
    for (const off of this.off) off();
  }
}
