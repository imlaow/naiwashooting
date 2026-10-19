// Player, enemies and weapon definitions: positions, health, timers and AI, no sprites.
// PlayerView / EnemyView (view/entities.js) draw them; anything only drawn (walk cycle, recoil,
// hit flash, footstep dust) lives there. Sounds and particles go out as events (see sim.js).
import { mulberry32 } from '../noise.js';

export const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 20, rate: 0.24, mag: 12, reload: 0.9, speed: 980, spread: 0.035, pellets: 1, life: 0.72, reserve: Infinity, kick: 3, shake: 2.5, sound: 'pistol', knock: 140 },
  smg: { name: 'SMG', dmg: 12, rate: 0.075, mag: 36, reload: 1.35, speed: 1050, spread: 0.1, pellets: 1, life: 0.6, reserve: 216, kick: 2, shake: 1.6, sound: 'smg', knock: 70 },
  shotgun: { name: 'Shotgun', dmg: 14, rate: 0.7, mag: 6, reload: 1.6, speed: 860, spread: 0.3, pellets: 8, life: 0.42, reserve: 36, kick: 7, shake: 8, sound: 'shotgun', knock: 230 },
  rifle: { name: 'Rifle', dmg: 75, rate: 0.6, mag: 5, reload: 1.8, speed: 1800, spread: 0.004, pellets: 1, life: 0.85, reserve: 30, kick: 8, shake: 6, sound: 'rifle', knock: 320, pierce: 3 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];

// Gun textures' logical size; art.js paints them at this size with the grip GUN_GRIP px from the
// back, and the muzzle sits at the far end.
export const GUN_SIZES = { pistol: [36, 18], smg: [50, 22], shotgun: [64, 18], rifle: [76, 18] };
export const GUN_GRIP = 10;
// How far ahead of a character bullets leave the gun: the hand is 12 px out, then the barrel.
const muzzleReach = (gun, scale = 1) => 12 + (GUN_SIZES[gun][0] - GUN_GRIP) * scale;

export const GUN_H = 36; // height bullets fly at above the ground
// The laugh clip is 180 frames at 15 fps (public/assets/laugh/index.json).
export const LAUGH_SECONDS = 12;
// PvP: the laugh is short, and the laughing player can't shoot (still untouchable).
export const PVP_LAUGH_SECONDS = 4;
// Co-op: a downed player crawls at DOWN_SPEED and bleeds out after BLEED_SECONDS, unless a
// teammate stays within REVIVE_RANGE for REVIVE_SECONDS.
export const DOWN_SPEED = 0.3;
export const BLEED_SECONDS = 30;
export const REVIVE_RANGE = 60;
export const REVIVE_SECONDS = 3;
// A player without a command this step stands still and holds fire. Also the full command
// shape: other commands start from it (sim/bot.js, view/game.js).
export const idleCommand = (aim) => ({ mx: 0, my: 0, aim, fire: false, dash: false, dashDir: null, reload: false, weapon: null, cycle: 0, last: false });

// Shared movement: axis-separated so characters slide along shorelines,
// then pushed out of obstacles.
export function moveBody(e, dx, dy) {
  const isl = e.sim.island;
  const ox = e.x, oy = e.y;
  if (isl.isWalkable(e.x + dx, e.y)) e.x += dx;
  if (isl.isWalkable(e.x, e.y + dy)) e.y += dy;
  e.sim.statics.resolve(e, e.r);
  // Pushed off walkable ground: go back to where we were, never step backwards
  // (that used to walk stranded enemies off the map, leaving a wave unfinishable).
  if (!isl.isWalkable(e.x, e.y)) { e.x = ox; e.y = oy; }
}

export class Player {
  constructor(sim, x, y) {
    this.sim = sim;
    this.id = sim.newId();
    this.x = x; this.y = y; this.r = 17;
    this.vx = 0; this.vy = 0;
    this.hp = this.maxHp = 100;
    this.aim = -Math.PI / 2;
    this.arsenal = { pistol: { mag: WEAPONS.pistol.mag, reserve: Infinity } };
    this.weapon = 'pistol';
    this.lastWeapon = 'pistol';
    this.cooldown = 0; this.reloading = 0;
    this.dashT = 0; this.dashCd = 0;
    this.invuln = 0;
    this.moving = false;
    // Shots fired (wrapping at 2¹⁶): a shot's spread comes from it and the player id, so the
    // browser's prediction (net/netsim.js) fires the same pellets the server does.
    this.shotN = 0;
    // Online: the `seen` time of the command it is running (see Sim's header).
    this.seen = 0;
    this.laughT = -1; // seconds into the laugh, -1 when not laughing
    this.respawnT = 0; // PvP: seconds until a dead player is back in
    this.kills = 0; this.combo = 0; this.comboT = 0;
    // For the scoreboard: teammates revived, times downed.
    this.revives = 0; this.downs = 0;
    // Co-op: down (crawling, bleedT seconds left, reviveT seconds of a teammate's revive so far,
    // by `reviver`) and dead (out until the next wave break).
    this.down = false; this.bleedT = 0; this.reviveT = 0; this.reviver = null;
    this.dead = false;
  }

  // In play and able to fight: not dead, not down.
  get up() { return !this.dead && !this.down; }

  // Back at (x, y) with full health and only the pistol (a respawn, or a late joiner entering).
  respawn(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hp = this.maxHp;
    this.arsenal = { pistol: { mag: WEAPONS.pistol.mag, reserve: Infinity } };
    this.weapon = this.lastWeapon = 'pistol';
    this.cooldown = 0; this.reloading = 0;
    this.dashT = 0; this.dashCd = 0;
    this.invuln = 1;
    this.laughT = -1; this.combo = 0; this.comboT = 0;
    this.respawnT = 0;
    this.down = false; this.bleedT = 0; this.reviveT = 0; this.reviver = null;
    this.dead = false;
  }

  get slot() { return this.arsenal[this.weapon]; }
  get def() { return WEAPONS[this.weapon]; }

  giveWeapon(kind) {
    const W = WEAPONS[kind];
    if (this.arsenal[kind]) {
      this.arsenal[kind].reserve += W.mag * 2;
    } else {
      this.arsenal[kind] = { mag: W.mag, reserve: W.mag * 2 };
    }
    this.switchTo(kind);
  }

  giveAmmo() {
    for (const k of Object.keys(this.arsenal)) {
      if (k === 'pistol') continue;
      this.arsenal[k].reserve += WEAPONS[k].mag * 2;
    }
  }

  switchTo(kind) {
    if (!this.arsenal[kind] || kind === this.weapon) return;
    this.lastWeapon = this.weapon;
    this.weapon = kind;
    this.reloading = 0;
    this.cooldown = Math.max(this.cooldown, 0.15);
    this.sim.emit({ type: 'switch', id: this.id, weapon: kind });
  }

  cycle(dir) {
    const owned = WEAPON_ORDER.filter((k) => this.arsenal[k]);
    const i = owned.indexOf(this.weapon), n = owned.length;
    // Wrapped for any number of steps (wheel ticks add up between sim steps).
    this.switchTo(owned[((i + Math.trunc(dir)) % n + n) % n]);
  }

  startReload() {
    const s = this.slot;
    if (this.reloading > 0 || s.mag >= this.def.mag || s.reserve <= 0) return;
    this.reloading = this.def.reload;
    this.sim.emit({ type: 'reload', id: this.id });
  }

  // Naiwa laughs his head off: untouchable and ignored by enemies for LAUGH_SECONDS
  // (he can still move and shoot), then back to full health. In PvP the laugh lasts
  // PVP_LAUGH_SECONDS and he can't shoot through it.
  laugh() {
    if (this.laughT >= 0 || !this.up) return false;
    this.laughT = 0;
    return true;
  }

  // cmd: { mx, my, aim, fire, dash, dashDir, reload, weapon, cycle, last }
  //   mx, my   movement, length ≤ 1
  //   aim      angle the gun points at; fire: trigger held
  //   dash     dash this step, towards (mx, my), else dashDir (the way it was just moving), else aim
  //   reload, weapon (switch to), cycle (±n through owned weapons), last (back to the previous one)
  // A downed player only crawls and aims. Reads `sim.pvp` (the laugh's rules), so the browser's
  // prediction stand-in (net/netsim.js) carries it too.
  update(dt, cmd = idleCommand(this.aim)) {
    if (this.dead) return;
    const sim = this.sim;
    if (this.down) { this.crawl(dt, cmd); return; }
    if (this.laughT >= 0) {
      this.laughT += dt;
      if (this.laughT >= (sim.pvp ? PVP_LAUGH_SECONDS : LAUGH_SECONDS)) {
        this.laughT = -1;
        const heal = Math.ceil(this.maxHp - this.hp);
        if (heal > 0) this.hp = this.maxHp;
        sim.emit({ type: 'laughEnd', id: this.id, x: this.x, y: this.y, heal });
      }
    }
    this.aim = cmd.aim;
    const firing = !!cmd.fire && !(sim.pvp && this.laughT >= 0);

    // ----- Weapon switching / reload -----
    if (cmd.weapon) this.switchTo(cmd.weapon);
    if (cmd.cycle) this.cycle(cmd.cycle);
    if (cmd.last) this.switchTo(this.lastWeapon);
    if (cmd.reload) this.startReload();

    // ----- Dash -----
    this.dashCd -= dt;
    if (cmd.dash && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = cmd.mx, dy = cmd.my;
      if (!dx && !dy && cmd.dashDir) ({ x: dx, y: dy } = cmd.dashDir);
      if (!dx && !dy) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); }
      const l = Math.hypot(dx, dy);
      this.dashDir = { x: dx / l, y: dy / l };
      this.dashT = 0.17; this.dashCd = 0.85; this.invuln = Math.max(this.invuln, 0.22);
      sim.emit({ type: 'dash', id: this.id, x: this.x, y: this.y });
    }

    // ----- Movement -----
    const wading = sim.island.isWading(this.x, this.y);
    const speed = 265 * (wading ? 0.62 : 1);
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir.x * 820; this.vy = this.dashDir.y * 820;
    } else {
      const k = Math.min(1, dt * 14);
      this.vx += (cmd.mx * speed - this.vx) * k;
      this.vy += (cmd.my * speed - this.vy) * k;
    }
    moveBody(this, this.vx * dt, this.vy * dt);
    // Before the gun's kick, so firing on the spot doesn't count as walking.
    this.moving = Math.hypot(this.vx, this.vy) > 40;

    // ----- Shooting -----
    this.cooldown -= dt;
    const slot = this.slot;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const take = Math.min(this.def.mag - slot.mag, slot.reserve);
        slot.mag += take; slot.reserve -= take;
        sim.emit({ type: 'reloaded', id: this.id });
      }
    } else if (firing && this.cooldown <= 0) {
      if (slot.mag > 0) this.shoot();
      else if (slot.reserve > 0) this.startReload();
      else { sim.emit({ type: 'empty', id: this.id }); this.cooldown = 0.25; if (this.weapon !== 'pistol') this.switchTo('pistol'); }
    }
    if (slot.mag === 0 && slot.reserve > 0 && this.reloading <= 0 && !firing) this.startReload();
    this.invuln -= dt;
  }

  crawl(dt, cmd) {
    this.bleedT -= dt;
    if (this.bleedT <= 0) { this.sim.onPlayerBledOut(this); return; }
    this.aim = cmd.aim;
    const speed = 265 * DOWN_SPEED * (this.sim.island.isWading(this.x, this.y) ? 0.62 : 1);
    const k = Math.min(1, dt * 14);
    this.vx += (cmd.mx * speed - this.vx) * k;
    this.vy += (cmd.my * speed - this.vy) * k;
    moveBody(this, this.vx * dt, this.vy * dt);
    this.moving = Math.hypot(this.vx, this.vy) > 40;
    this.invuln -= dt;
  }

  shoot() {
    const sim = this.sim, W = this.def;
    const cos = Math.cos(this.aim), sin = Math.sin(this.aim);
    const len = muzzleReach(this.weapon);
    const mx = this.x + cos * len, my = this.y + sin * len;
    const rand = mulberry32((this.id << 16) ^ this.shotN);
    this.shotN = (this.shotN + 1) & 0xffff;
    let bid = 0;
    for (let i = 0; i < W.pellets; i++) {
      const a = this.aim + (rand() - 0.5) * 2 * W.spread;
      const id = sim.fireBullet({
        x: mx, y: my, ang: a, speed: W.speed * (W.pellets > 1 ? 0.85 + rand() * 0.25 : 1),
        dmg: W.dmg, life: W.life * (W.pellets > 1 ? 0.8 + rand() * 0.3 : 1), team: 'player', owner: this.id,
        pierce: W.pierce ?? 0, knock: W.knock, tint: this.weapon === 'rifle' ? 0x9be7ff : 0xffe28a,
        scale: this.weapon === 'rifle' ? 1.6 : 1,
      });
      bid ||= id;
    }
    this.slot.mag--;
    this.cooldown = W.rate;
    this.vx -= cos * W.kick * 14; this.vy -= sin * W.kick * 14;
    sim.emit({ type: 'shot', id: this.id, weapon: this.weapon, x: mx, y: my, ang: this.aim, px: this.x, py: this.y, bid });
  }

  // A downed player can't be hurt any more; the bleed-out timer is all that's left. Nobody is
  // hurt once a PvP round is over (sim.state 'over'). `by`: the player whose bullet or barrel it
  // was (PvP kill credit), `push` the knockback, `iframes` how long the hit protects (PvP
  // bullets give none, or only one SMG bullet or shotgun pellet in 0.45 s would count).
  hurt(dmg, fromX, fromY, by = null, push = 260, iframes = 0.45) {
    if (this.invuln > 0 || !this.up || this.laughT >= 0 || this.sim.state === 'over') return false;
    this.hp -= dmg;
    this.invuln = iframes;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.vx += Math.cos(a) * push; this.vy += Math.sin(a) * push;
    this.sim.emit({ type: 'hurt', id: this.id, x: this.x, y: this.y, dmg });
    this.sim.onPlayerHurt(this);
    if (this.hp <= 0) { this.hp = 0; this.sim.onPlayerDown(this, by); }
    return true;
  }
}

// ---------------- Enemies ----------------

export const ENEMY_TYPES = {
  egg: { hp: 36, speed: 150, r: 16, bite: 12, score: 50, color: 0xe0a030 },
  gunner: { hp: 60, speed: 100, r: 17, skin: 'gunner', gun: 'pistol', rate: 1.25, bulletSpeed: 430, dmg: 9, pellets: 1, spread: 0.06, range: [230, 400], score: 100, scale: 0.38, gunH: 36, color: 0xff6b8a },
  heavy: { hp: 160, speed: 70, r: 21, skin: 'heavy', gun: 'shotgun', rate: 1.9, bulletSpeed: 360, dmg: 8, pellets: 5, spread: 0.42, range: [120, 250], score: 220, scale: 0.48, gunH: 44, color: 0xa78bfa },
  boss: { hp: 1600, speed: 90, r: 32, skin: 'boss', gun: 'smg', gunScale: 1.5, rate: 0.1, bulletSpeed: 400, dmg: 8, pellets: 1, spread: 0.12, range: [200, 420], score: 2500, scale: 0.78, gunH: 60, color: 0x9ca3af },
};

export class Enemy {
  // hpMul: co-op makes King Naiwa tougher.
  constructor(sim, type, x, y, level = 1, hpMul = 1) {
    const T = ENEMY_TYPES[type];
    this.sim = sim; this.type = type; this.T = T;
    this.id = sim.newId();
    this.x = x; this.y = y; this.r = T.r;
    this.maxHp = this.hp = Math.round(T.hp * (1 + (level - 1) * 0.12) * hpMul);
    this.speedMul = 1 + Math.min(0.35, (level - 1) * 0.03);
    this.vx = 0; this.vy = 0; this.kx = 0; this.ky = 0;
    this.aim = 0; this.cd = 1 + Math.random(); this.biteCd = 0;
    // The player it goes for, re-picked with the line-of-sight check (los: can it see them).
    this.target = null; this.losT = 0; this.los = false;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 1 + Math.random() * 2;
    // The walk cycle's phase. Drawn, but the egg's waddle steers by it too.
    this.animT = Math.random() * 4; this.moving = false;
    this.spawnT = 0.7; this.dead = false;
    this.phase = 'chase'; this.phaseT = 3; this.sweep = 0;
  }

  // The nearest player it can go for (up and not laughing), preferring one in sight. With
  // nobody to go for it keeps its target, or takes the nearest player, and mills around (update).
  pickTarget() {
    const sim = this.sim;
    let best = null, rank = Infinity, bd = Infinity;
    for (const P of sim.players.values()) {
      const d = Math.hypot(P.x - this.x, P.y - this.y);
      const ok = P.up && P.laughT < 0;
      const r = ok ? (d < 900 && sim.statics.clearLine(this.x, this.y, P.x, P.y) ? 0 : 1) : P.dead ? 3 : 2;
      if (r < rank || (r === rank && d < bd)) { best = P; rank = r; bd = d; }
    }
    if (rank >= 2 && this.target) best = this.target;
    this.target = best;
    // Seen from where it stands now, so it knows the moment its target is worth chasing again.
    this.los = rank === 0 || (rank >= 2 && !!best && Math.hypot(best.x - this.x, best.y - this.y) < 900 && sim.statics.clearLine(this.x, this.y, best.x, best.y));
  }

  update(dt) {
    const sim = this.sim;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      return;
    }
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2 + Math.random() * 0.15;
      this.pickTarget();
    }
    const P = this.target;
    const dx = P ? P.x - this.x : 0, dy = P ? P.y - this.y : 0;
    const dist = Math.hypot(dx, dy) || 1;
    const tx = dx / dist, ty = dy / dist;
    let wx = 0, wy = 0, speed = this.T.speed * this.speedMul;
    const T = this.T;

    if (!P || P.laughT >= 0 || !P.up) {
      // Enemies lose track of a laughing (or downed, or dead) Naiwa and mill around until they can
      // pick someone else.
      this.wanderT -= dt;
      if (!(this.wanderT > 0)) { this.wanderT = 1.2 + Math.random() * 1.8; this.wanderA = Math.random() * Math.PI * 2; }
      wx = Math.cos(this.wanderA); wy = Math.sin(this.wanderA); speed *= 0.35;
      this.aim = this.wanderA;
    } else if (this.type === 'egg') {
      const wob = Math.sin(sim.time * 7 + this.animT) * 0.7;
      wx = tx - ty * wob; wy = ty + tx * wob;
      this.biteCd -= dt;
      if (dist < this.r + P.r + 8 && this.biteCd <= 0 && !P.dead) {
        if (P.hurt(T.bite, this.x, this.y)) sim.emit({ type: 'bite', id: this.id, target: P.id, x: this.x, y: this.y });
        this.biteCd = 0.9;
        this.kx -= tx * 220; this.ky -= ty * 220;
      }
    } else {
      this.aim = Math.atan2(P.y - this.y, P.x - this.x);
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.2 + Math.random() * 2; }
      if (this.type === 'boss') {
        const out = this.bossBrain(dt, dist, tx, ty);
        wx = out[0]; wy = out[1]; speed *= out[2];
      } else {
        if (!this.los || dist > T.range[1]) { wx = tx; wy = ty; }
        else if (dist < T.range[0]) { wx = -tx - ty * this.strafe * 0.6; wy = -ty + tx * this.strafe * 0.6; }
        else { wx = -ty * this.strafe + tx * 0.15; wy = tx * this.strafe + ty * 0.15; speed *= 0.7; }
        this.cd -= dt;
        if (this.cd <= 0 && this.los && dist < T.range[1] + 150 && !P.dead) {
          this.fire(T.pellets, T.spread, T.bulletSpeed, T.dmg);
          this.cd = T.rate * (0.8 + Math.random() * 0.45);
        }
      }
    }
    // Steering around obstacles and water.
    const wl = Math.hypot(wx, wy);
    if (wl > 0.01) {
      wx /= wl; wy /= wl;
      const base = Math.atan2(wy, wx);
      for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4]) {
        const a = base + off * (this.turnBias || 1);
        const px = this.x + Math.cos(a) * 34, py = this.y + Math.sin(a) * 34;
        if (sim.island.isWalkable(px, py) && !sim.statics.overlaps(px, py, this.r * 0.8)) {
          wx = Math.cos(a); wy = Math.sin(a);
          if (off) this.turnBias = Math.sign(off);
          break;
        }
      }
    }
    const k = Math.min(1, dt * 8);
    this.vx += (wx * speed - this.vx) * k;
    this.vy += (wy * speed - this.vy) * k;
    // Separation from other enemies
    for (const o of sim.enemies) {
      if (o === this) continue;
      const ox = this.x - o.x, oy = this.y - o.y, m = this.r + o.r;
      const d2 = ox * ox + oy * oy;
      if (d2 < m * m && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (m - d) * 0.5;
        const nx = this.x + (ox / d) * push, ny = this.y + (oy / d) * push;
        if (sim.island.isWalkable(nx, ny)) { this.x = nx; this.y = ny; }
      }
    }
    const kf = Math.max(0, 1 - dt * 7);
    this.kx *= kf; this.ky *= kf;
    moveBody(this, (this.vx + this.kx) * dt, (this.vy + this.ky) * dt);
    // Safety net: an enemy stuck out in deep water (or with a broken position) is
    // brought back onto the map so the wave can still be cleared.
    if (!sim.island.isWalkable(this.x, this.y) || !Number.isFinite(this.x + this.y)) {
      this.strandedT = (this.strandedT || 0) + dt;
      if (this.strandedT > 1.5) {
        this.strandedT = 0;
        const p = sim.spawnPoint(this.type);
        if (p) {
          this.x = p.x; this.y = p.y;
          this.vx = this.vy = this.kx = this.ky = 0;
          this.spawnT = 0.7;
        }
      }
    } else this.strandedT = 0;
    this.moving = Math.hypot(this.vx, this.vy) > 30;
    this.animT += dt * (this.moving ? (this.type === 'egg' ? 12 : 8) : 2);
  }

  bossBrain(dt, dist, tx, ty) {
    const sim = this.sim, T = this.T;
    const enraged = this.hp < this.maxHp * 0.4;
    this.phaseT -= dt;
    this.cd -= dt;
    let move = [tx * (dist > 300 ? 1 : -0.3) - ty * this.strafe * 0.7, ty * (dist > 300 ? 1 : -0.3) + tx * this.strafe * 0.7, 1];
    if (this.phase === 'chase') {
      if (this.cd <= 0 && this.los) { this.fire(3, 0.25, T.bulletSpeed, T.dmg + 2, true); this.cd = enraged ? 0.6 : 0.9; }
      if (this.phaseT <= 0) {
        const r = Math.random();
        this.phase = r < 0.45 ? 'spray' : r < 0.8 ? 'ring' : 'summon';
        this.phaseT = this.phase === 'spray' ? 2.2 : this.phase === 'ring' ? 1.6 : 0.8;
        this.sweep = -0.6; this.ringN = 0;
      }
    } else if (this.phase === 'spray') {
      move[2] = 0.35;
      this.sweep += dt * 0.6;
      if (this.cd <= 0) {
        this.aim += Math.sin(this.sweep * 4) * 0.35;
        this.fire(1, 0.06, T.bulletSpeed + 40, T.dmg);
        this.cd = enraged ? 0.07 : 0.1;
      }
    } else if (this.phase === 'ring') {
      move[2] = 0;
      if (this.cd <= 0) {
        const n = enraged ? 22 : 16;
        const off = this.ringN * 0.5;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + off;
          sim.fireBullet({ x: this.x + Math.cos(a) * 30, y: this.y + Math.sin(a) * 30, ang: a, speed: 260, dmg: 10, life: 3, team: 'enemy', orb: true, tint: 0xc084fc, scale: 1.3, h: 40 });
        }
        sim.emit({ type: 'ring', id: this.id, x: this.x, y: this.y });
        this.ringN++;
        this.cd = 0.5;
      }
    } else if (this.phase === 'summon') {
      move[2] = 0;
      if (this.phaseT <= 0.1 && !this.summoned) {
        this.summoned = true;
        for (let i = 0; i < (enraged ? 4 : 3); i++) sim.spawnNear('egg', this.x, this.y, 120);
      }
    }
    if (this.phase !== 'chase' && this.phaseT <= 0) {
      this.phase = 'chase'; this.phaseT = enraged ? 2 : 3; this.summoned = false;
    }
    return move;
  }

  fire(pellets, spread, speed, dmg, orb = false) {
    const sim = this.sim, P = this.target, T = this.T;
    const dist = Math.hypot(P.x - this.x, P.y - this.y);
    const lead = (dist / speed) * 0.45;
    const ax = P.x + P.vx * lead, ay = P.y + P.vy * lead;
    const base = this.type === 'boss' && this.phase === 'spray' ? this.aim : Math.atan2(ay - this.y, ax - this.x);
    this.aim = base;
    const len = T.gun ? muzzleReach(T.gun, T.gunScale) : 12;
    const mx = this.x + Math.cos(base) * len, my = this.y + Math.sin(base) * len;
    const isOrb = orb || this.type === 'heavy';
    const h = T.gunH;
    for (let i = 0; i < pellets; i++) {
      const a = base + (pellets > 1 ? (i / (pellets - 1) - 0.5) * spread * 2 : 0) + (Math.random() - 0.5) * spread * (pellets > 1 ? 0.3 : 2);
      sim.fireBullet({
        x: mx, y: my, ang: a, speed: speed * (pellets > 1 ? 0.9 + Math.random() * 0.2 : 1), dmg, life: 1.8, team: 'enemy',
        orb: isOrb, tint: isOrb ? 0xff7ad9 : 0xff6a3d, scale: isOrb ? 1 : 1.1, h,
      });
    }
    sim.emit({ type: 'enemyShot', id: this.id, x: mx, y: my, h, ang: base, ex: this.x, ey: this.y });
  }

  // `by`: the id of the player whose bullet or barrel it was, if any.
  hit(dmg, ang, knock, by = null) {
    if (this.dead) return;
    this.hp -= dmg;
    const kb = this.type === 'boss' ? 0.15 : this.type === 'heavy' ? 0.5 : 1;
    this.kx += Math.cos(ang) * knock * kb; this.ky += Math.sin(ang) * knock * kb;
    this.sim.emit({ type: 'hit', id: this.id, x: this.x, y: this.y, dmg, h: this.height(), by });
    if (this.hp <= 0) { this.dead = true; this.sim.onEnemyKilled(this, by); }
  }

  // How tall it stands, for floating text above it.
  height() {
    if (this.type === 'egg') return 46;
    return 220 * this.T.scale;
  }
}
