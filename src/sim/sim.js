// The game itself, without Pixi, DOM, audio or HUD: map colliders and props, the players (co-op,
// 1–4), enemies, bullets, pickups, waves and scoring. The browser (view/game.js) and a server both
// run it.
//
//   const sim = new Sim(world, layout);   // from buildMap(choice) in sim/maps.js
//   new Sim(world, layout, { mode: 'pvp', killLimit, timeLimit })   // a deathmatch round instead
//   const me = sim.addPlayer();           // any time; removePlayer(id) when someone leaves
//   sim.step(STEP, { [me.id]: cmd });     // cmd: see Player.update; no command = stand still
//   for (const e of sim.takeEvents()) …   // what happened during the step, for sounds and particles
//
// Every step is STEP seconds. Events are plain objects with a `type`; `id` is the player's (or
// the enemy's / prop's) id, `by` the player who did it (null when nobody did):
//   shot, enemyShot, ring            a gun went off (ring: the boss's orb ring)
//   hit (by), kill (by, pts), spawn, bite (target)  enemy hit / killed / appeared; an egg bit a player
//   hurt, dash, laugh, laughEnd (heal)
//   downed, revived (by), died, respawned (joined)  co-op: down, back up, bled out, back in at the dock
//   over                             every player is down or dead: the run is over
//   PvP: died (by: the killer, null for none or a player's own barrel), respawned (joined),
//        over (winner: player id or null for a draw, why: 'kills' | 'time')
//   switch, reload, reloaded, empty  the player's gun
//   bulletHit (target: enemy / crate / barrel / wall), bulletEnd (ran out of range)
//   propHit, propBroken, explode     crates and barrels
//   pickup (id, kind, weapon, had, heal)
//   wave (n, boss, count), waveCleared (n, bonus, heals: [{ id, heal, x, y }])
//
// With one player, downed is dead and the run ends, as in single-player.
//
// PvP (deathmatch; online only, the server's sim): no waves or enemies. state is 'pvp' while the
// round runs and 'over' once a player reaches killLimit or roundT (timeLimit seconds) runs out.
// HP 0 is dead; the dead respawn RESPAWN_SECONDS later far from every living player, with a
// pistol and SPAWN_PROTECT seconds of invulnerability. Players' bullets hit other players (no hit
// i-frames), explosions hurt everyone, crates and barrels come back PROP_RESPAWN seconds after
// they break and weapon spots SPOT_RESPAWN seconds after they are taken. Once over, guns still
// fire but nobody is hurt.
import { WORLD } from '../island.js';
import { StaticWorld } from './physics.js';
import { Player, Enemy, WEAPON_ORDER, REVIVE_RANGE, REVIVE_SECONDS, BLEED_SECONDS, moveBody } from './entities.js';

export const STEP = 1 / 60;
// PvP (see the header).
export const RESPAWN_SECONDS = 3;
export const SPAWN_PROTECT = 1.5;
export const PROP_RESPAWN = 30;
export const SPOT_RESPAWN = 20;
// A PvP bullet pushes the player it hits by this much of its gun's knockback.
const PVP_PUSH = 0.6;

const rnd = (a, b) => a + Math.random() * (b - a);

export class Sim {
  // `world` is the map's terrain (an Island or a Factory) and `layout` its colliders, props and
  // weapon spots, both from buildMap (sim/maps.js). `rules`: { mode: 'pvp', killLimit,
  // timeLimit } for a deathmatch round, null for co-op (and single-player).
  constructor(world, layout, rules = null) {
    this.island = world;
    this.mode = rules?.mode === 'pvp' ? 'pvp' : 'coop';
    this.pvp = this.mode === 'pvp';
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
    this.players = new Map();
    for (const w of layout.weaponSpots) this.spawnPickup('weapon', w.x, w.y, w.kind, Infinity).spot = true;

    // Team score and kills; each player also counts their own kills and combo.
    this.score = 0; this.kills = 0;
    this.wave = 0;
    this.queue = [];
    this.state = 'intro';
    this.stateT = 3;
    if (this.pvp) {
      this.state = 'pvp';
      this.stateT = 0;
      this.killLimit = rules.killLimit;
      this.roundT = rules.timeLimit;
      this.winner = null;
    }
  }

  newId() { return ++this.lastId; }

  emit(e) { this.events.push(e); }

  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  // ---------- Players ----------
  // A new player at the dock. Late joiners wait (dead) for the next wave break, unless the run
  // is still in its first wave or between waves. If nobody is up to reach that break (everyone
  // else left or is down), the run is over.
  //
  // PvP: any time (the room's lobby, mid-round, its results), with others alive, dead and
  // waiting to respawn, or nobody at all. While the round is on, the player enters at once at a
  // spawn far from every living player (none: anywhere open), protected like a respawn; once
  // it is over, they wait dead (joining, no respawnT) for the next map. Never ends the round.
  addPlayer() {
    const P = new Player(this, 0, 0);
    if (this.pvp) {
      const sp = this.pvpSpawn();
      P.x = sp.x; P.y = sp.y;
      this.players.set(P.id, P);
      if (this.state === 'over') { P.dead = true; P.joining = true; return P; }
      P.invuln = SPAWN_PROTECT;
      this.emit({ type: 'respawned', id: P.id, x: P.x, y: P.y, joined: true });
      return P;
    }
    const sp = this.dockSpot(this.players.size);
    P.x = sp.x; P.y = sp.y;
    this.players.set(P.id, P);
    if (this.wave > 1 && this.state === 'fight' || this.state === 'dead') { P.dead = true; P.joining = true; this.checkRunOver(); }
    else if (this.players.size > 1) this.emit({ type: 'respawned', id: P.id, x: P.x, y: P.y, joined: true });
    return P;
  }

  // PvP: the player may still have bullets in flight or a barrel about to go off; whoever those
  // kill dies without a killer (onPlayerDown finds no player for `by`). The round goes on, even
  // with nobody left in it (the room starts a new one when the server empties).
  removePlayer(id) {
    const P = this.players.get(id);
    if (!P) return;
    this.players.delete(id);
    for (const e of this.enemies) if (e.target === P) e.target = null;
    for (const o of this.players.values()) if (o.reviver === id) { o.reviveT = 0; o.reviver = null; }
    this.checkRunOver();
  }

  // Where the n-th player stands at the dock: the map's spawn, teammates beside it.
  dockSpot(n) {
    const sp = this.island.spawn;
    const [ox, oy] = [[0, 0], [-46, 12], [46, 12], [0, 44]][n % 4];
    const x = sp.x + ox, y = sp.y + oy;
    return this.island.isWalkable(x, y) && !this.statics.overlaps(x, y, 18) ? { x, y } : { x: sp.x, y: sp.y };
  }

  // The nearest player who is up, for things nobody in particular earned (a crate an enemy shot).
  nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const P of this.players.values()) {
      const d = Math.hypot(P.x - x, P.y - y);
      if (P.up && d < bd) { bd = d; best = P; }
    }
    return best;
  }

  onPlayerHurt(P) {
    // Taking damage interrupts a revive in progress.
    for (const o of this.players.values()) if (o.reviver === P.id) { o.reviveT = 0; o.reviver = null; }
  }

  // HP 0. Alone, that's the end of the run; in co-op the player is down until revived or bled out.
  // PvP: dead, back in RESPAWN_SECONDS later; `by` (who shot them or set off the barrel) gets the
  // kill unless it was their own or that player has left. `downs` counts deaths.
  onPlayerDown(P, by = null) {
    P.downs++;
    if (this.pvp) {
      P.dead = true; P.respawnT = RESPAWN_SECONDS;
      P.reloading = 0; P.dashT = 0; P.laughT = -1; P.combo = 0; P.comboT = 0;
      const K = by !== P.id ? this.players.get(by) : null;
      this.emit({ type: 'died', id: P.id, x: P.x, y: P.y, by: K ? K.id : null });
      if (K) this.onPlayerKilled(K);
      return;
    }
    if (this.players.size === 1) {
      P.dead = true;
      this.emit({ type: 'died', id: P.id, x: P.x, y: P.y });
    } else {
      P.down = true; P.bleedT = BLEED_SECONDS; P.reviveT = 0; P.reviver = null;
      P.reloading = 0; P.dashT = 0;
      this.emit({ type: 'downed', id: P.id, x: P.x, y: P.y });
    }
    this.checkRunOver();
  }

  onPlayerBledOut(P) {
    P.down = false; P.dead = true; P.reviveT = 0; P.reviver = null;
    this.emit({ type: 'died', id: P.id, x: P.x, y: P.y });
    this.checkRunOver();
  }

  // Co-op only. PvP has players dead and waiting to respawn, all of them at once after a barrel,
  // and that isn't the end of a round: only endRound ends one.
  checkRunOver() {
    if (this.pvp || this.state === 'dead' || !this.players.size) return;
    for (const P of this.players.values()) if (P.up) return;
    this.state = 'dead';
    this.emit({ type: 'over' });
  }

  // A teammate who is up and stays within REVIVE_RANGE of a downed player for REVIVE_SECONDS
  // gets them back up with 30 HP and a second of invulnerability.
  updateRevives(dt) {
    for (const D of this.players.values()) {
      if (!D.down) continue;
      let R = D.reviver != null ? this.players.get(D.reviver) : null;
      if (!R || !R.up || Math.hypot(R.x - D.x, R.y - D.y) > REVIVE_RANGE) {
        R = null;
        for (const o of this.players.values()) {
          if (o !== D && o.up && Math.hypot(o.x - D.x, o.y - D.y) <= REVIVE_RANGE) { R = o; break; }
        }
        D.reviveT = 0;
        D.reviver = R ? R.id : null;
      }
      if (!R) continue;
      D.reviveT += dt;
      if (D.reviveT >= REVIVE_SECONDS) {
        D.down = false; D.hp = 30; D.invuln = 1; D.bleedT = 0; D.reviveT = 0; D.reviver = null;
        R.revives++;
        this.emit({ type: 'revived', id: D.id, by: R.id, x: D.x, y: D.y });
      }
    }
  }

  // Dead players (bled out or waiting to join) come back in at the dock.
  respawnPlayers() {
    let n = 0;
    for (const P of this.players.values()) {
      if (!P.dead) continue;
      const sp = this.dockSpot(n++);
      const joined = !!P.joining;
      P.joining = false;
      P.respawn(sp.x, sp.y);
      this.emit({ type: 'respawned', id: P.id, x: P.x, y: P.y, joined });
    }
  }

  // ---------- PvP ----------
  // K killed another player: the kill, the combo, the laugh on every 5th, and the round's end
  // at killLimit.
  onPlayerKilled(K) {
    this.kills++;
    K.kills++;
    K.combo = K.comboT > 0 ? K.combo + 1 : 1;
    K.comboT = 2.6;
    if (K.kills % 5 === 0 && K.laugh()) this.emit({ type: 'laugh', id: K.id, x: K.x, y: K.y });
    if (this.state === 'pvp' && K.kills >= this.killLimit) this.endRound('kills');
  }

  // The most kills wins, then the fewest deaths; still level is a draw (no winner). The dead stay
  // dead until the next map (respawnT 0: no countdown on their HUD through the results).
  endRound(why) {
    let best = null, tie = false;
    for (const P of this.players.values()) {
      const c = best ? P.kills - best.kills || best.downs - P.downs : 1;
      if (c > 0) { best = P; tie = false; } else if (c === 0) tie = true;
    }
    for (const P of this.players.values()) P.respawnT = 0;
    this.state = 'over';
    this.winner = best && !tie ? best.id : null;
    this.emit({ type: 'over', winner: this.winner, why });
  }

  // Dead players back in once their respawnT runs out (not those who joined after the round).
  updateRespawns(dt) {
    for (const P of this.players.values()) {
      if (!P.dead || P.joining) continue;
      P.respawnT -= dt;
      if (P.respawnT > 0) continue;
      const sp = this.pvpSpawn();
      P.respawn(sp.x, sp.y);
      P.invuln = SPAWN_PROTECT;
      this.emit({ type: 'respawned', id: P.id, x: P.x, y: P.y, joined: false });
    }
  }

  // An open spot (spawnPoint's checks, and not in the water) as far as can be found from every
  // living player: the best of up to 24 random ones.
  pvpSpawn() {
    const isl = this.island, up = [...this.players.values()].filter((p) => p.up);
    let best = null, bd = -1;
    for (let i = 0, found = 0; i < 400 && found < 24; i++) {
      const x = rnd(40, WORLD - 40), y = rnd(40, WORLD - 40);
      if (!this.openSpot(x, y) || isl.isWading(x, y)) continue;
      found++;
      let d = Infinity;
      for (const o of up) d = Math.min(d, Math.hypot(x - o.x, y - o.y));
      if (d > bd) { bd = d; best = { x, y }; }
    }
    return best ?? this.dockSpot(0);
  }

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
  // `id`: a PvP prop coming back keeps the id it had (clients key props by layout order).
  addProp(kind, x, y, id = this.newId()) {
    const prop = { id, kind, x, y, hp: kind === 'crate' ? 45 : 22 };
    prop.collider = this.statics.add({ kind: 'circle', x, y: y - 12, r: kind === 'crate' ? 22 : 17, owner: prop });
    this.props.push(prop);
    return prop;
  }

  // `by`: the player who shot it (or set off the barrel that did), null for an enemy's bullet.
  damageProp(p, dmg, by = null) {
    if (p.dead) return;
    p.hp -= dmg;
    this.emit({ type: 'propHit', id: p.id, kind: p.kind, x: p.x, y: p.y });
    if (p.hp <= 0) this.destroyProp(p, by);
  }

  destroyProp(p, by) {
    p.dead = true;
    this.statics.remove(p.collider);
    this.props.splice(this.props.indexOf(p), 1);
    this.emit({ type: 'propBroken', id: p.id, kind: p.kind, x: p.x, y: p.y });
    if (this.pvp) this.after(PROP_RESPAWN, () => this.respawnProp(p));
    if (p.kind === 'crate') {
      const r = Math.random();
      if (r < 0.3) this.spawnPickup('health', p.x, p.y);
      else if (r < 0.6) this.spawnPickup('ammo', p.x, p.y);
      else if (r < 0.7) this.dropWeapon(p.x, p.y, this.players.get(by) ?? this.nearestPlayer(p.x, p.y));
    } else {
      this.explode(p.x, p.y - 10, 130, 80, by);
    }
  }

  // A broken PvP crate or barrel back where it was, unless a player is standing there: then a
  // second later.
  respawnProp(p) {
    const cy = p.y - 12, r = p.kind === 'crate' ? 22 : 17;
    for (const P of this.players.values()) {
      if (!P.dead && Math.hypot(P.x - p.x, P.y - cy) < r + P.r) { this.after(1, () => this.respawnProp(p)); return; }
    }
    this.addProp(p.kind, p.x, p.y, p.id);
  }

  // Hurts every player in range too (friendly fire is off for bullets, not for barrels); in PvP
  // the one who set it off (`by`) gets the kills.
  explode(x, y, R, dmg, by = null) {
    this.emit({ type: 'explode', x, y, r: R, by });
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < R + e.r) e.hit(dmg * (1 - (d / (R + e.r)) * 0.6), Math.atan2(e.y - y, e.x - x), 500, by);
    }
    for (const P of this.players.values()) {
      const pd = Math.hypot(P.x - x, P.y - y);
      if (pd < R + P.r) P.hurt(dmg * 0.45 * (1 - (pd / (R + P.r)) * 0.5), x, y, by);
    }
    for (const p of [...this.props]) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < R + 20) this.after(0.12 + Math.random() * 0.1, () => this.damageProp(p, 60, by));
    }
  }

  // ---------- Pickups ----------
  // A gun `P` (the player it drops for) doesn't have yet, if there is one.
  dropWeapon(x, y, P) {
    const missing = WEAPON_ORDER.filter((k) => k !== 'pistol' && !(P && P.arsenal[k]));
    const pool = missing.length ? missing : WEAPON_ORDER.slice(1);
    this.spawnPickup('weapon', x, y, pool[(Math.random() * pool.length) | 0]);
  }

  // Health and ammo stay on the ground until picked up; dropped weapons fade after a while.
  // The map's weapon spots are marked `spot` (in PvP they come back after SPOT_RESPAWN).
  spawnPickup(kind, x, y, weapon = null, life = kind === 'weapon' ? 22 : Infinity) {
    const p = { id: this.newId(), kind, weapon, x, y, life, delay: 0.4 };
    this.pickups.push(p);
    return p;
  }

  // The first player to touch a pickup (and want it) takes it.
  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt; p.delay -= dt;
      let take = false;
      if (p.delay <= 0) for (const P of this.players.values()) {
        if (!P.up || Math.hypot(P.x - p.x, P.y - p.y) >= 36) continue;
        const ev = { type: 'pickup', id: P.id, kind: p.kind, weapon: p.weapon, x: p.x, y: p.y, px: P.x, py: P.y };
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
        if (take) {
          this.emit(ev);
          if (p.spot && this.pvp) this.after(SPOT_RESPAWN, () => { this.spawnPickup('weapon', p.x, p.y, p.weapon, Infinity).spot = true; });
          break;
        }
      }
      if (take || p.life <= 0) this.pickups.splice(i, 1);
    }
  }

  // ---------- Bullets ----------
  fireBullet(o) {
    this.bullets.push({
      id: this.newId(), x: o.x, y: o.y, vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed,
      ang: o.ang, life: o.life, dmg: o.dmg, team: o.team, owner: o.owner ?? null, pierce: o.pierce ?? 0, knock: o.knock ?? 80,
      h: o.h ?? 36, hits: null, tint: o.tint ?? 0xffffff, orb: !!o.orb, scale: o.scale ?? 1,
    });
  }

  // Players' bullets hit enemies only (no friendly fire); enemies' bullets hit players who are up.
  // PvP: players' bullets hit the other players too, with no hit i-frames; they pass through a
  // player who is dashing or can't be hurt.
  updateBullets(dt) {
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
          if (c.owner) this.damageProp(c.owner, b.dmg, b.owner);
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
            e.hit(b.dmg, b.ang, b.knock, b.owner);
            this.emit({ type: 'bulletHit', x: b.x, y: b.y, h: b.h, ang: b.ang, target: 'enemy', enemyType: e.type });
            if (b.pierce > 0) { b.pierce--; (b.hits ??= new Set()).add(e); }
            else { alive = false; break; }
          }
          if (alive && this.pvp) {
            for (const P of this.players.values()) {
              if (!P.up || P.id === b.owner || (b.hits && b.hits.has(P))) continue;
              const dx = P.x - b.x, dy = P.y - b.y, m = P.r + 4;
              if (dx * dx + dy * dy >= m * m || P.dashT > 0) continue;
              // A player who can't be hurt (spawn protection, the laugh, the round over) lets it
              // through, as a dash does: nobody is a shield for someone else.
              if (!P.hurt(b.dmg, b.x - b.vx * 0.05, b.y - b.vy * 0.05, b.owner, b.knock * PVP_PUSH, 0)) continue;
              if (b.pierce > 0) { b.pierce--; (b.hits ??= new Set()).add(P); }
              else { alive = false; break; }
            }
          }
        } else {
          for (const P of this.players.values()) {
            if (!P.up) continue;
            const dx = P.x - b.x, dy = P.y - b.y, m = P.r + 4;
            if (dx * dx + dy * dy < m * m && !(P.dashT > 0)) {
              P.hurt(b.dmg, b.x - b.vx * 0.05, b.y - b.vy * 0.05);
              alive = false;
              break;
            }
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
  // Around a random living player, and as far from every other player as from that one.
  spawnPoint(type) {
    const isl = this.island, all = [...this.players.values()].filter((p) => !p.dead);
    const up = all.filter((p) => p.up), pool = up.length ? up : all;
    // One random roll only when there is a choice, so single-player rolls what it always did.
    const P = pool.length > 1 ? pool[(Math.random() * pool.length) | 0] : pool[0] ?? this.players.values().next().value ?? isl.spawn;
    const far = (x, y, d) => all.every((o) => o === P || Math.hypot(x - o.x, y - o.y) >= d);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = pass < 2 ? rnd(680, 1250) : rnd(400, 1600);
        const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
        if (!this.openSpot(x, y) || pass === 0 && !isl.goodSpawn(type, x, y)) continue;
        if (!far(x, y, pass < 2 ? 680 : 400)) continue;
        return { x, y };
      }
    }
    // Last resort (players boxed into a corner of the island): anywhere walkable
    // that isn't right on top of one of them, so the queue can't stall.
    for (let i = 0; i < 200; i++) {
      const x = rnd(40, WORLD - 40), y = rnd(40, WORLD - 40);
      if (Math.hypot(x - P.x, y - P.y) < 300 || !far(x, y, 300)) continue;
      if (!this.openSpot(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  // Walkable, off the dock and clear of colliders: where something can appear.
  openSpot(x, y) {
    return this.island.isWalkable(x, y) && !this.island.inDock(x, y) && !this.statics.overlaps(x, y, 26);
  }

  spawnEnemy(type, x, y) {
    const e = new Enemy(this, type, x, y, this.wave, type === 'boss' ? 1 + 0.6 * (this.players.size - 1) : 1);
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
    // Co-op: half as many again per extra player, and room for 4 more on the map at once.
    const extra = Math.max(0, this.players.size - 1);
    if (extra) { const k = 1 + 0.5 * extra; eggs = Math.round(eggs * k); gunners = Math.round(gunners * k); heavies = Math.round(heavies * k); }
    const q = [];
    for (let i = 0; i < eggs; i++) q.push('egg');
    for (let i = 0; i < gunners; i++) q.splice(Math.floor(Math.random() * (q.length + 1)), 0, 'gunner');
    for (let i = 0; i < heavies; i++) q.splice(Math.floor(q.length * 0.4 + Math.random() * q.length * 0.6), 0, 'heavy');
    if (boss) q.splice(Math.min(3, q.length), 0, 'boss');
    this.queue = q;
    this.maxAlive = Math.min(6 + n * 2, 20) + 4 * extra;
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
      const heals = [];
      for (const P of this.players.values()) {
        if (!P.up) continue;
        const heal = Math.min(20, P.maxHp - P.hp);
        if (heal > 0) P.hp += heal;
        heals.push({ id: P.id, heal, x: P.x, y: P.y });
      }
      this.emit({ type: 'waveCleared', n: this.wave, bonus, heals });
      // Restock: a supply crate lands near each player every couple of waves.
      if (this.wave % 2 === 0) {
        for (const P of this.players.values()) {
          if (!P.up) continue;
          const a = Math.random() * Math.PI * 2;
          const x = P.x + Math.cos(a) * 120, y = P.y + Math.sin(a) * 120;
          if (this.island.isWalkable(x, y)) this.spawnPickup('ammo', x, y);
        }
      }
      this.respawnPlayers();
    }
  }

  // The kill, the combo and the laugh go to the player whose bullet or barrel it was. A kill
  // nobody made (an enemy's bullet set off a barrel) goes to the nearest player who is up.
  onEnemyKilled(e, by) {
    this.kills++;
    const P = this.players.get(by) ?? this.nearestPlayer(e.x, e.y);
    let mult = 1;
    if (P) {
      P.kills++;
      P.combo = P.comboT > 0 ? P.combo + 1 : 1;
      P.comboT = 2.6;
      mult = 1 + Math.min(3, Math.floor(P.combo / 3) * 0.5);
    }
    const pts = Math.round(e.T.score * mult);
    this.score += pts;
    this.emit({ type: 'kill', id: e.id, by: P ? P.id : null, enemyType: e.type, x: e.x, y: e.y, h: e.height(), pts });
    // Each player laughs on their own 5th, 10th, … kill.
    if (P && P.kills % 5 === 0 && P.laugh()) this.emit({ type: 'laugh', id: P.id, x: P.x, y: P.y });
    if (e.type === 'boss') {
      for (let i = 0; i < 4; i++) this.spawnPickup(i % 2 ? 'health' : 'ammo', e.x + rnd(-60, 60), e.y + rnd(-40, 40));
      this.dropWeapon(e.x, e.y, P);
      this.boss = null;
    } else {
      const r = Math.random();
      const healChance = P && P.hp < 40 ? 0.2 : 0.09;
      if (r < healChance) this.spawnPickup('health', e.x, e.y);
      else if (r < healChance + 0.1 && P && Object.keys(P.arsenal).length > 1) this.spawnPickup('ammo', e.x, e.y);
      else if (Math.random() < (e.type === 'heavy' ? 0.25 : 0.04)) this.dropWeapon(e.x, e.y, P);
    }
    this.after(0, () => {
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    });
  }

  // Conveyor belts carry whoever stands on them.
  applyDrift(dt) {
    const isl = this.island;
    for (const e of [...this.players.values(), ...this.enemies]) {
      if (e.dead || e.spawnT > 0) continue;
      const v = isl.drift(e.x, e.y);
      if (v) moveBody(e, v * dt, 0);
    }
  }

  // ---------- Main step ----------
  // cmds: { [player id]: cmd }; a player without one stands still.
  // PvP: no enemies or waves ever (updateWaves only acts on co-op states); the round clock and
  // respawns only run while the round is on, and after it is over (the room's results) players
  // still move and shoot but nobody is hurt.
  step(dt, cmds = {}) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    for (const P of this.players.values()) P.update(dt, cmds[P.id]);
    this.updateRevives(dt);
    for (const e of this.enemies) if (!e.dead) e.update(dt);
    this.applyDrift(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    if (this.pvp) {
      if (this.state === 'pvp') {
        this.updateRespawns(dt);
        this.roundT -= dt;
        if (this.roundT <= 0) { this.roundT = 0; this.endRound('time'); }
      }
    } else this.updateWaves(dt);
    for (const P of this.players.values()) P.comboT -= dt;
  }
}
