// The game itself, without Pixi, DOM, audio or HUD: map colliders and props, the player, enemies,
// bullets, pickups, waves and scoring. The browser (view/game.js) and a server both run it.
//
//   const sim = new Sim(world, layout);   // from buildMap(choice) in sim/maps.js
//   sim.step(STEP, cmd);                  // cmd: see Player.update
//   for (const e of sim.takeEvents()) …   // what happened during the step, for sounds and particles
//
// Every step is STEP seconds. Events are plain objects with a `type`:
//   shot, enemyShot, ring            a gun went off (ring: the boss's orb ring)
//   hit, kill, spawn, bite           enemy hit / killed (pts) / appeared; an egg bit the player
//   hurt, died, dash, laugh, laughEnd (heal)
//   switch, reload, reloaded, empty  the player's gun
//   bulletHit (target: enemy / crate / barrel / wall), bulletEnd (ran out of range)
//   propHit, propBroken, explode     crates and barrels
//   pickup (kind, weapon, had, heal)
//   wave (n, boss, count), waveCleared (n, bonus, heal)
import { WORLD } from '../island.js';
import { StaticWorld } from './physics.js';
import { Player, Enemy, WEAPON_ORDER, moveBody } from './entities.js';

export const STEP = 1 / 60;

const rnd = (a, b) => a + Math.random() * (b - a);

export class Sim {
  // `world` is the map's terrain (an Island or a Factory) and `layout` its colliders, props and
  // weapon spots, both from buildMap (sim/maps.js).
  constructor(world, layout) {
    this.island = world;
    this.time = 0;
    this.lastId = 0;
    this.events = [];

    this.statics = new StaticWorld();
    this.props = [];
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.timers = [];

    for (const c of layout.colliders) this.statics.add({ ...c });
    for (const p of layout.props) this.addProp(p.kind, p.x, p.y);
    const sp = world.spawn;
    this.player = new Player(this, sp.x, sp.y);
    for (const w of layout.weaponSpots) this.spawnPickup('weapon', w.x, w.y, w.kind, Infinity);

    this.score = 0; this.kills = 0;
    this.combo = 0; this.comboT = 0;
    this.wave = 0;
    this.queue = [];
    this.state = 'intro';
    this.stateT = 3;
  }

  newId() { return ++this.lastId; }

  emit(e) { this.events.push(e); }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  nearestEnemy(x, y, maxD) {
    let best = null, bd = maxD;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd && this.statics.clearLine(x, y, e.x, e.y, 24)) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- Props ----------
  addProp(kind, x, y) {
    const prop = { id: this.newId(), kind, x, y, hp: kind === 'crate' ? 45 : 22 };
    prop.collider = this.statics.add({ kind: 'circle', x, y: y - 12, r: kind === 'crate' ? 22 : 17, owner: prop });
    this.props.push(prop);
    return prop;
  }

  damageProp(p, dmg) {
    if (p.dead) return;
    p.hp -= dmg;
    this.emit({ type: 'propHit', id: p.id, kind: p.kind, x: p.x, y: p.y });
    if (p.hp <= 0) this.destroyProp(p);
  }

  destroyProp(p) {
    p.dead = true;
    this.statics.remove(p.collider);
    this.props.splice(this.props.indexOf(p), 1);
    this.emit({ type: 'propBroken', id: p.id, kind: p.kind, x: p.x, y: p.y });
    if (p.kind === 'crate') {
      const r = Math.random();
      if (r < 0.3) this.spawnPickup('health', p.x, p.y);
      else if (r < 0.6) this.spawnPickup('ammo', p.x, p.y);
      else if (r < 0.7) this.dropWeapon(p.x, p.y);
    } else {
      this.explode(p.x, p.y - 10, 130, 80);
    }
  }

  explode(x, y, R, dmg) {
    this.emit({ type: 'explode', x, y, r: R });
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < R + e.r) e.hit(dmg * (1 - (d / (R + e.r)) * 0.6), Math.atan2(e.y - y, e.x - x), 500);
    }
    const P = this.player;
    const pd = Math.hypot(P.x - x, P.y - y);
    if (pd < R + P.r) P.hurt(dmg * 0.45 * (1 - (pd / (R + P.r)) * 0.5), x, y);
    for (const p of [...this.props]) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < R + 20) this.after(0.12 + Math.random() * 0.1, () => this.damageProp(p, 60));
    }
  }

  // ---------- Pickups ----------
  dropWeapon(x, y) {
    const missing = WEAPON_ORDER.filter((k) => k !== 'pistol' && !this.player.arsenal[k]);
    const pool = missing.length ? missing : WEAPON_ORDER.slice(1);
    this.spawnPickup('weapon', x, y, pool[(Math.random() * pool.length) | 0]);
  }

  // Health and ammo stay on the ground until picked up; dropped weapons fade after a while.
  spawnPickup(kind, x, y, weapon = null, life = kind === 'weapon' ? 22 : Infinity) {
    this.pickups.push({ id: this.newId(), kind, weapon, x, y, life, delay: 0.4 });
  }

  updatePickups(dt) {
    const P = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt; p.delay -= dt;
      let take = false;
      if (p.delay <= 0 && !P.dead && Math.hypot(P.x - p.x, P.y - p.y) < 36) {
        const ev = { type: 'pickup', kind: p.kind, weapon: p.weapon, x: p.x, y: p.y, px: P.x, py: P.y };
        // A laughing Naiwa leaves health packs alone: the laugh ends with a full heal anyway.
        if (p.kind === 'health' && P.hp < P.maxHp && P.laughT < 0) {
          ev.heal = Math.min(35, P.maxHp - P.hp);
          P.hp += ev.heal;
          take = true;
        } else if (p.kind === 'ammo') {
          P.giveAmmo();
          take = true;
        } else if (p.kind === 'weapon') {
          ev.had = !!P.arsenal[p.weapon];
          P.giveWeapon(p.weapon);
          take = true;
        }
        if (take) this.emit(ev);
      }
      if (take || p.life <= 0) this.pickups.splice(i, 1);
    }
  }

  // ---------- Bullets ----------
  fireBullet(o) {
    this.bullets.push({
      id: this.newId(), x: o.x, y: o.y, vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed,
      ang: o.ang, life: o.life, dmg: o.dmg, team: o.team, pierce: o.pierce ?? 0, knock: o.knock ?? 80,
      h: o.h ?? 36, hits: null, tint: o.tint ?? 0xffffff, orb: !!o.orb, scale: o.scale ?? 1,
    });
  }

  updateBullets(dt) {
    const P = this.player;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let alive = true;
      const dist = Math.hypot(b.vx, b.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 10));
      const sx = (b.vx * dt) / steps, sy = (b.vy * dt) / steps;
      for (let k = 0; k < steps && alive; k++) {
        b.x += sx; b.y += sy;
        const c = this.statics.pointHit(b.x, b.y);
        if (c) {
          if (c.owner) this.damageProp(c.owner, b.dmg);
          this.emit({ type: 'bulletHit', x: b.x, y: b.y, h: b.h, ang: b.ang, target: c.owner ? c.owner.kind : 'wall' });
          alive = false;
          break;
        }
        if (b.team === 'player') {
          for (const e of this.enemies) {
            if (e.dead || e.spawnT > 0) continue;
            const dx = e.x - b.x, dy = e.y - b.y, m = e.r + 6;
            if (dx * dx + dy * dy > m * m) continue;
            if (b.hits && b.hits.has(e)) continue;
            e.hit(b.dmg, b.ang, b.knock);
            this.emit({ type: 'bulletHit', x: b.x, y: b.y, h: b.h, ang: b.ang, target: 'enemy', enemyType: e.type });
            if (b.pierce > 0) { b.pierce--; (b.hits ??= new Set()).add(e); }
            else { alive = false; break; }
          }
        } else if (!P.dead) {
          const dx = P.x - b.x, dy = P.y - b.y, m = P.r + 4;
          if (dx * dx + dy * dy < m * m && !(P.dashT > 0)) {
            P.hurt(b.dmg, b.x - b.vx * 0.05, b.y - b.vy * 0.05);
            alive = false;
          }
        }
      }
      b.life -= dt;
      if (alive && b.life <= 0) {
        alive = false;
        this.emit({ type: 'bulletEnd', x: b.x, y: b.y });
      }
      if (!alive) {
        this.bullets[i] = this.bullets[this.bullets.length - 1];
        this.bullets.pop();
      }
    }
  }

  // ---------- Enemies & waves ----------
  spawnPoint(type) {
    const P = this.player, isl = this.island;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = pass < 2 ? rnd(680, 1250) : rnd(400, 1600);
        const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
        if (!isl.isWalkable(x, y) || isl.inDock(x, y)) continue;
        if (pass === 0 && !isl.goodSpawn(type, x, y)) continue;
        if (this.statics.overlaps(x, y, 26)) continue;
        return { x, y };
      }
    }
    // Last resort (player boxed into a corner of the island): anywhere walkable
    // that isn't right on top of him, so the queue can't stall.
    for (let i = 0; i < 200; i++) {
      const x = rnd(40, WORLD - 40), y = rnd(40, WORLD - 40);
      if (Math.hypot(x - P.x, y - P.y) < 300) continue;
      if (!isl.isWalkable(x, y) || isl.inDock(x, y) || this.statics.overlaps(x, y, 26)) continue;
      return { x, y };
    }
    return null;
  }

  spawnEnemy(type, x, y) {
    const e = new Enemy(this, type, x, y, this.wave);
    this.enemies.push(e);
    this.emit({ type: 'spawn', id: e.id, enemyType: type, x, y });
    return e;
  }

  spawnNear(type, x, y, R) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
      if (this.island.isWalkable(px, py) && !this.statics.overlaps(px, py, 18)) return this.spawnEnemy(type, px, py);
    }
    return null;
  }

  startWave(n) {
    this.wave = n;
    const boss = n % 5 === 0;
    let eggs = Math.min(3 + n * 2, 18);
    let gunners = Math.min(n, 10);
    let heavies = Math.min(Math.floor((n - 1) / 2), 6);
    if (boss) { eggs = Math.floor(eggs / 2); gunners = Math.floor(gunners / 2); heavies = Math.floor(heavies / 2); }
    const q = [];
    for (let i = 0; i < eggs; i++) q.push('egg');
    for (let i = 0; i < gunners; i++) q.splice(Math.floor(Math.random() * (q.length + 1)), 0, 'gunner');
    for (let i = 0; i < heavies; i++) q.splice(Math.floor(q.length * 0.4 + Math.random() * q.length * 0.6), 0, 'heavy');
    if (boss) q.splice(Math.min(3, q.length), 0, 'boss');
    this.queue = q;
    this.maxAlive = Math.min(6 + n * 2, 20);
    this.spawnT = 0.6;
    this.waveTotal = q.length;
    this.state = 'fight';
    this.emit({ type: 'wave', n, boss, count: q.length });
  }

  updateWaves(dt) {
    if (this.state === 'intro' || this.state === 'break') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.startWave(this.wave + 1);
      return;
    }
    if (this.state !== 'fight') return;
    this.spawnT -= dt;
    const alive = this.enemies.length;
    if (this.queue.length && alive < this.maxAlive && this.spawnT <= 0) {
      const type = this.queue[0];
      const p = this.spawnPoint(type);
      if (p) {
        this.queue.shift();
        const e = this.spawnEnemy(type, p.x, p.y);
        if (type === 'boss') this.boss = e;
      }
      this.spawnT = rnd(0.35, 0.9) * (this.wave > 6 ? 0.7 : 1);
    }
    if (!this.queue.length && alive === 0) {
      this.state = 'break';
      this.stateT = 5;
      const bonus = 250 * this.wave;
      this.score += bonus;
      const P = this.player;
      const heal = Math.min(20, P.maxHp - P.hp);
      if (heal > 0) P.hp += heal;
      this.emit({ type: 'waveCleared', n: this.wave, bonus, heal, x: P.x, y: P.y });
      // Restock: a supply crate lands near the player every couple of waves.
      if (this.wave % 2 === 0) {
        const a = Math.random() * Math.PI * 2;
        const x = P.x + Math.cos(a) * 120, y = P.y + Math.sin(a) * 120;
        if (this.island.isWalkable(x, y)) this.spawnPickup('ammo', x, y);
      }
    }
  }

  onEnemyKilled(e) {
    this.kills++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 2.6;
    const mult = 1 + Math.min(3, Math.floor(this.combo / 3) * 0.5);
    const pts = Math.round(e.T.score * mult);
    this.score += pts;
    this.emit({ type: 'kill', id: e.id, enemyType: e.type, x: e.x, y: e.y, h: e.height(), pts });
    const P = this.player;
    if (this.kills % 5 === 0 && P.laugh()) this.emit({ type: 'laugh', id: P.id, x: P.x, y: P.y });
    if (e.type === 'boss') {
      for (let i = 0; i < 4; i++) this.spawnPickup(i % 2 ? 'health' : 'ammo', e.x + rnd(-60, 60), e.y + rnd(-40, 40));
      this.dropWeapon(e.x, e.y);
      this.boss = null;
    } else {
      const r = Math.random();
      const healChance = P.hp < 40 ? 0.2 : 0.09;
      if (r < healChance) this.spawnPickup('health', e.x, e.y);
      else if (r < healChance + 0.1 && Object.keys(P.arsenal).length > 1) this.spawnPickup('ammo', e.x, e.y);
      else if (Math.random() < (e.type === 'heavy' ? 0.25 : 0.04)) this.dropWeapon(e.x, e.y);
    }
    this.after(0, () => {
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    });
  }

  onPlayerDeath(P) {
    this.state = 'dead';
    this.emit({ type: 'died', id: P.id, x: P.x, y: P.y });
  }

  // Conveyor belts carry whoever stands on them.
  applyDrift(dt) {
    const isl = this.island;
    for (const e of [this.player, ...this.enemies]) {
      if (e.dead || e.spawnT > 0) continue;
      const v = isl.drift(e.x, e.y);
      if (v) moveBody(e, v * dt, 0);
    }
  }

  // ---------- Main step ----------
  step(dt, cmd) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    this.player.update(dt, cmd);
    for (const e of this.enemies) if (!e.dead) e.update(dt);
    this.applyDrift(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.updateWaves(dt);
    this.comboT -= dt;
  }
}
