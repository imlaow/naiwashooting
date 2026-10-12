// Player, enemies and weapon definitions.
import { Container, Sprite, Graphics } from 'pixi.js';
import { makeSprite } from './world.js';
import { sfx } from './audio.js';
import { laugh } from './laugh.js';
import { H_GRASS } from './island.js';

export const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 20, rate: 0.24, mag: 12, reload: 0.9, speed: 980, spread: 0.035, pellets: 1, life: 0.72, reserve: Infinity, kick: 3, shake: 2.5, sound: 'pistol', knock: 140 },
  smg: { name: 'SMG', dmg: 12, rate: 0.075, mag: 36, reload: 1.35, speed: 1050, spread: 0.1, pellets: 1, life: 0.6, reserve: 216, kick: 2, shake: 1.6, sound: 'smg', knock: 70 },
  shotgun: { name: 'Shotgun', dmg: 14, rate: 0.7, mag: 6, reload: 1.6, speed: 860, spread: 0.3, pellets: 8, life: 0.42, reserve: 36, kick: 7, shake: 8, sound: 'shotgun', knock: 230 },
  rifle: { name: 'Rifle', dmg: 75, rate: 0.6, mag: 5, reload: 1.8, speed: 1800, spread: 0.004, pellets: 1, life: 0.85, reserve: 30, kick: 8, shake: 6, sound: 'rifle', knock: 320, pierce: 3 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];

const GUN_H = 36; // height bullets fly at above the ground
const HERO_SCALE = 0.42;
const HERO_ANCHOR = { x: 0.5, y: 0.96 };

// Shared movement: axis-separated so characters slide along shorelines,
// then pushed out of obstacles.
function moveBody(e, dx, dy) {
  const isl = e.game.island;
  const nx = e.x + dx, ny = e.y + dy;
  if (isl.isWalkable(nx, e.y)) e.x = nx;
  if (isl.isWalkable(e.x, ny)) e.y = ny;
  e.game.statics.resolve(e, e.r);
  if (!isl.isWalkable(e.x, e.y)) { e.x -= dx; e.y -= dy; }
}

function stepFx(e, dt, moving) {
  const game = e.game;
  const wading = game.island.isWading(e.x, e.y);
  e.stepT -= dt;
  if (e.stepT > 0) return wading;
  if (moving) {
    e.stepT = wading ? 0.28 : 0.24;
    if (wading) { game.fx.splash(e.x, e.y, 3); if (e === game.player) sfx.play('splash', 0.4); }
    else {
      const h = game.island.heightAt(e.x, e.y);
      const onPath = game.island.pathAt(e.x, e.y) > 0.5;
      game.fx.dust(e.x, e.y, 2, onPath ? 0xb89a72 : h < H_GRASS ? 0xe8d6a8 : 0x9cc27a);
    }
  } else if (wading) {
    e.stepT = 0.9;
    game.fx.ripple(e.x, e.y, 0.8);
  }
  return wading;
}

export class Player {
  constructor(game, x, y) {
    this.game = game;
    this.x = x; this.y = y; this.r = 17;
    this.fadePad = 60; // trees fade once he's this close to walking behind them
    this.vx = 0; this.vy = 0;
    this.hp = this.maxHp = 100;
    this.aim = -Math.PI / 2;
    this.arsenal = { pistol: { mag: WEAPONS.pistol.mag, reserve: Infinity } };
    this.weapon = 'pistol';
    this.lastWeapon = 'pistol';
    this.cooldown = 0; this.reloading = 0;
    this.dashT = 0; this.dashCd = 0; this.ghostT = 0;
    this.invuln = 0; this.flash = 0;
    this.animT = 0; this.stepT = 0; this.recoil = 0;
    this.laughT = -1; // seconds into the laugh, -1 when not laughing
    this.dead = false;

    this.root = new Container();
    this.body = new Sprite(game.skins.hero[0]);
    this.body.anchor.copyFrom(HERO_ANCHOR);
    this.body.scale.set(HERO_SCALE);
    this.gun = makeSprite(game.art.guns.pistol);
    this.root.addChild(this.body, this.gun);
    game.layers.objects.addChild(this.root);
    this.shadow = makeSprite(game.art.shadow);
    this.shadow.scale.set(0.8, 0.9);
    game.layers.shadows.addChild(this.shadow);
    this.sync();
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
    this.gun.texture = this.game.art.guns[kind];
    sfx.play('reload');
  }

  cycle(dir) {
    const owned = WEAPON_ORDER.filter((k) => this.arsenal[k]);
    const i = owned.indexOf(this.weapon);
    this.switchTo(owned[(i + dir + owned.length) % owned.length]);
  }

  startReload() {
    const s = this.slot;
    if (this.reloading > 0 || s.mag >= this.def.mag || s.reserve <= 0) return;
    this.reloading = this.def.reload;
    sfx.play('reload');
  }

  // Naiwa laughs his head off: frozen and untouchable until the clip ends.
  laugh() {
    if (!this.game.skins.laugh || this.laughT >= 0 || this.dead) return false;
    this.laughT = 0;
    this.vx = this.vy = 0;
    this.dashT = 0;
    this.gun.visible = false;
    return true;
  }

  // While laughing he can't step out from behind a tree, so trees in front fade for
  // his whole body (arms out) instead of only his feet.
  get focusBox() {
    if (this.laughT < 0) return null;
    const b = this.body, w = Math.abs(b.width), h = b.height;
    const ax = b.scale.x < 0 ? 1 - b.anchor.x : b.anchor.x;
    const x0 = this.x - ax * w, y0 = this.y + b.y - b.anchor.y * h;
    return { x0, x1: x0 + w, y0, y1: y0 + h };
  }

  update(dt, input, mouseWorld) {
    if (this.dead) return;
    const game = this.game;
    if (this.laughT >= 0) {
      const L = game.skins.laugh;
      this.laughT = laugh.time() ?? this.laughT + dt;
      if (this.laughT < L.frames.length / L.fps) {
        this.invuln -= dt;
        this.flash -= dt;
        this.moving = false;
        this.sync();
        return;
      }
      this.laughT = -1;
      this.gun.visible = true;
    }
    // ----- Aim -----
    let firing = false;
    if (input.touch) {
      if (input.aimStick.active) {
        this.aim = Math.atan2(input.aimStick.y, input.aimStick.x);
        firing = true;
      } else {
        const target = game.nearestEnemy(this.x, this.y, 520);
        if (target) this.aim = Math.atan2(target.y - this.y, target.x - this.x);
        else if (input.move.x || input.move.y) this.aim = Math.atan2(input.move.y, input.move.x);
      }
    } else {
      this.aim = Math.atan2(mouseWorld.y + GUN_H - this.y, mouseWorld.x - this.x);
      firing = input.mouse.down;
    }

    // ----- Weapon switching / reload -----
    WEAPON_ORDER.forEach((k, i) => { if (input.wasPressed(String(i + 1))) this.switchTo(k); });
    if (input.wheel) this.cycle(input.wheel);
    if (input.wasPressed('q')) this.switchTo(this.lastWeapon);
    if (input.wasPressed('r')) this.startReload();

    // ----- Dash -----
    this.dashCd -= dt;
    const wantDash = input.wasPressed(' ') || input.wasPressed('shift') || input.dashTap;
    if (wantDash && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = input.move.x, dy = input.move.y;
      if (!dx && !dy) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); }
      const l = Math.hypot(dx, dy);
      this.dashDir = { x: dx / l, y: dy / l };
      this.dashT = 0.17; this.dashCd = 0.85; this.invuln = Math.max(this.invuln, 0.22);
      sfx.play('dash');
      game.fx.dust(this.x, this.y, 5);
    }

    // ----- Movement -----
    const wading = game.island.isWading(this.x, this.y);
    const speed = 265 * (wading ? 0.62 : 1);
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir.x * 820; this.vy = this.dashDir.y * 820;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.025; this.ghost(); }
    } else {
      const k = Math.min(1, dt * 14);
      this.vx += (input.move.x * speed - this.vx) * k;
      this.vy += (input.move.y * speed - this.vy) * k;
    }
    moveBody(this, this.vx * dt, this.vy * dt);
    const moving = Math.hypot(this.vx, this.vy) > 40;
    stepFx(this, dt, moving);

    // ----- Shooting -----
    this.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 40);
    const slot = this.slot;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const take = Math.min(this.def.mag - slot.mag, slot.reserve);
        slot.mag += take; slot.reserve -= take;
        sfx.play('reload');
      }
    } else if (firing && this.cooldown <= 0) {
      if (slot.mag > 0) this.shoot();
      else if (slot.reserve > 0) this.startReload();
      else { sfx.play('empty'); this.cooldown = 0.25; if (this.weapon !== 'pistol') this.switchTo('pistol'); }
    }
    if (slot.mag === 0 && slot.reserve > 0 && this.reloading <= 0 && !firing) this.startReload();

    // ----- Animation -----
    this.invuln -= dt;
    this.flash -= dt;
    this.animT += dt * (moving ? 9 : 2.2);
    this.moving = moving;
    this.sync();
  }

  shoot() {
    const game = this.game, W = this.def;
    const cos = Math.cos(this.aim), sin = Math.sin(this.aim);
    const len = 12 + this.gun.texture.width * (1 - this.gun.texture.anchorHint[0]);
    const mx = this.x + cos * len, my = this.y + sin * len;
    for (let i = 0; i < W.pellets; i++) {
      const a = this.aim + (Math.random() - 0.5) * 2 * W.spread;
      game.fireBullet({
        x: mx, y: my, ang: a, speed: W.speed * (W.pellets > 1 ? 0.85 + Math.random() * 0.25 : 1),
        dmg: W.dmg, life: W.life * (W.pellets > 1 ? 0.8 + Math.random() * 0.3 : 1), team: 'player',
        pierce: W.pierce ?? 0, knock: W.knock, tint: this.weapon === 'rifle' ? 0x9be7ff : 0xffe28a,
        scale: this.weapon === 'rifle' ? 1.6 : 1,
      });
    }
    this.slot.mag--;
    this.cooldown = W.rate;
    this.recoil = W.kick;
    this.vx -= cos * W.kick * 14; this.vy -= sin * W.kick * 14;
    game.shake(W.shake);
    game.fx.muzzle(mx, my - GUN_H, this.aim);
    game.fx.shell(this.x, this.y, this.aim);
    sfx.play(W.sound);
  }

  ghost() {
    this.game.fx.spawn({
      tex: this.body.texture, x: this.x, y: this.y + this.body.y, ay: 0.96, life: 0.22, s0: HERO_SCALE,
      flip: Math.cos(this.aim) < 0 ? -1 : 1, a0: 0.45, a1: 0, tint: 0x9fe8ff, add: true,
    });
  }

  hurt(dmg, fromX, fromY) {
    if (this.invuln > 0 || this.dead || this.laughT >= 0) return false;
    this.hp -= dmg;
    this.invuln = 0.45; this.flash = 0.15;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.vx += Math.cos(a) * 260; this.vy += Math.sin(a) * 260;
    this.game.shake(9);
    this.game.fx.burst(this.x, this.y - 40, 0xffd23f, 6);
    this.game.fx.text(this.x, this.y - 100, `-${Math.round(dmg)}`, 0xff5a5a, 0.9);
    sfx.play('hurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onPlayerDeath(); }
    return true;
  }

  sync() {
    const facing = Math.cos(this.aim) >= 0 ? 1 : -1;
    const L = this.laughT >= 0 && this.game.skins.laugh;
    if (L) {
      const tex = L.frames[Math.min(L.frames.length - 1, Math.floor(this.laughT * L.fps))];
      this.body.texture = tex;
      this.body.anchor.copyFrom(tex.defaultAnchor);
    } else {
      this.body.texture = this.game.skins.hero[Math.floor(this.animT) % 4];
      this.body.anchor.copyFrom(HERO_ANCHOR);
    }
    const bob = this.moving ? -Math.abs(Math.sin(this.animT * Math.PI)) * 6 : 0;
    const breathe = this.moving || L ? 1 : 1 + Math.sin(this.game.time * 3) * 0.018;
    const wading = this.game.island.isWading(this.x, this.y);
    this.body.y = bob + (wading ? 8 : 0);
    this.body.scale.set(HERO_SCALE * facing, HERO_SCALE * breathe);
    this.body.rotation = this.moving ? (this.vx / 265) * 0.07 : 0;
    this.body.tint = this.flash > 0 ? 0xff6b6b : 0xffffff;
    this.root.alpha = this.invuln > 0 && this.dashT <= 0 ? (Math.floor(this.game.time * 20) % 2 ? 0.45 : 1) : 1;
    const cos = Math.cos(this.aim), sin = Math.sin(this.aim);
    this.gun.position.set(cos * (12 - this.recoil), -GUN_H + bob * 0.5 + sin * 4 - this.recoil * sin);
    this.gun.rotation = this.aim;
    this.gun.scale.set(1, cos < 0 ? -1 : 1);
    // Gun goes behind the body when aiming upward.
    const behind = sin < -0.35;
    if (behind !== this.gunBehind) {
      this.gunBehind = behind;
      this.root.setChildIndex(this.gun, behind ? 0 : 1);
    }
    this.root.position.set(this.x, this.y);
    this.root.zIndex = this.y;
    this.shadow.position.set(this.x + 2, this.y - 2);
    this.shadow.visible = !wading;
  }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}

// ---------------- Enemies ----------------

export const ENEMY_TYPES = {
  crab: { hp: 36, speed: 150, r: 16, bite: 12, score: 50, color: 0xe74c3c },
  gunner: { hp: 60, speed: 100, r: 17, skin: 'gunner', gun: 'pistol', rate: 1.25, bulletSpeed: 430, dmg: 9, pellets: 1, spread: 0.06, range: [230, 400], score: 100, scale: 0.38, color: 0xff6b8a },
  heavy: { hp: 160, speed: 70, r: 21, skin: 'heavy', gun: 'shotgun', rate: 1.9, bulletSpeed: 360, dmg: 8, pellets: 5, spread: 0.42, range: [120, 250], score: 220, scale: 0.48, color: 0xa78bfa },
  boss: { hp: 1600, speed: 90, r: 32, skin: 'boss', gun: 'smg', rate: 0.1, bulletSpeed: 400, dmg: 8, pellets: 1, spread: 0.12, range: [200, 420], score: 2500, scale: 0.78, color: 0x9ca3af },
};

export class Enemy {
  constructor(game, type, x, y, level = 1) {
    const T = ENEMY_TYPES[type];
    this.game = game; this.type = type; this.T = T;
    this.x = x; this.y = y; this.r = T.r;
    this.maxHp = this.hp = Math.round(T.hp * (1 + (level - 1) * 0.12));
    this.speedMul = 1 + Math.min(0.35, (level - 1) * 0.03);
    this.vx = 0; this.vy = 0; this.kx = 0; this.ky = 0;
    this.aim = 0; this.cd = 1 + Math.random(); this.biteCd = 0;
    this.losT = 0; this.los = false;
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 1 + Math.random() * 2;
    this.animT = Math.random() * 4; this.stepT = 0; this.flash = 0;
    this.spawnT = 0.7; this.dead = false;
    this.phase = 'chase'; this.phaseT = 3; this.sweep = 0;

    this.root = new Container();
    if (type === 'crab') {
      this.body = makeSprite(game.art.crab[0]);
    } else {
      this.body = new Sprite(game.skins[T.skin][0]);
      this.body.anchor.set(0.5, 0.96);
      this.gun = makeSprite(game.art.guns[T.gun]);
      if (type === 'boss') this.gun.scale.set(1.5);
    }
    this.root.addChild(this.body);
    if (this.gun) this.root.addChild(this.gun);
    if (type === 'boss') {
      this.crown = new Graphics()
        .poly([-22, 0, -24, -22, -12, -10, 0, -28, 12, -10, 24, -22, 22, 0]).fill(0xfacc15).stroke({ width: 2, color: 0xb45309 })
        .circle(0, -16, 3.5).fill(0xef4444).circle(-14, -6, 2.5).fill(0x60a5fa).circle(14, -6, 2.5).fill(0x34d399);
      this.root.addChild(this.crown);
    }
    this.hpBar = new Graphics();
    this.hpBar.visible = false;
    this.root.addChild(this.hpBar);
    game.layers.objects.addChild(this.root);
    this.shadow = makeSprite(game.art.shadow);
    const ss = type === 'boss' ? 1.6 : type === 'heavy' ? 1 : 0.8;
    this.shadow.scale.set(ss, ss);
    game.layers.shadows.addChild(this.shadow);
    this.sync();
  }

  update(dt) {
    const game = this.game, P = game.player;
    this.flash -= dt;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      this.sync();
      return;
    }
    const dx = P.x - this.x, dy = P.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const tx = dx / dist, ty = dy / dist;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2 + Math.random() * 0.15;
      this.los = dist < 900 && game.statics.clearLine(this.x, this.y, P.x, P.y);
    }
    let wx = 0, wy = 0, speed = this.T.speed * this.speedMul;
    const T = this.T;

    if (this.type === 'crab') {
      const wob = Math.sin(game.time * 7 + this.animT) * 0.7;
      wx = tx - ty * wob; wy = ty + tx * wob;
      this.biteCd -= dt;
      if (dist < this.r + P.r + 8 && this.biteCd <= 0 && !P.dead) {
        if (P.hurt(T.bite, this.x, this.y)) sfx.play('crab');
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
        if (game.island.isWalkable(px, py) && !game.statics.overlaps(px, py, this.r * 0.8)) {
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
    for (const o of game.enemies) {
      if (o === this) continue;
      const ox = this.x - o.x, oy = this.y - o.y, m = this.r + o.r;
      const d2 = ox * ox + oy * oy;
      if (d2 < m * m && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (m - d) * 0.5;
        this.x += (ox / d) * push; this.y += (oy / d) * push;
      }
    }
    const kf = Math.max(0, 1 - dt * 7);
    this.kx *= kf; this.ky *= kf;
    moveBody(this, (this.vx + this.kx) * dt, (this.vy + this.ky) * dt);
    this.moving = Math.hypot(this.vx, this.vy) > 30;
    stepFx(this, dt, this.moving);
    this.animT += dt * (this.moving ? (this.type === 'crab' ? 12 : 8) : 2);
    this.sync();
  }

  bossBrain(dt, dist, tx, ty) {
    const game = this.game, T = this.T;
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
          game.fireBullet({ x: this.x + Math.cos(a) * 30, y: this.y + Math.sin(a) * 30, ang: a, speed: 260, dmg: 10, life: 3, team: 'enemy', orb: true, tint: 0xc084fc, scale: 1.3, h: 40 });
        }
        sfx.play('shotgun', 0.6);
        game.shake(4);
        this.ringN++;
        this.cd = 0.5;
      }
    } else if (this.phase === 'summon') {
      move[2] = 0;
      if (this.phaseT <= 0.1 && !this.summoned) {
        this.summoned = true;
        for (let i = 0; i < (enraged ? 4 : 3); i++) game.spawnNear('crab', this.x, this.y, 120);
      }
    }
    if (this.phase !== 'chase' && this.phaseT <= 0) {
      this.phase = 'chase'; this.phaseT = enraged ? 2 : 3; this.summoned = false;
    }
    return move;
  }

  fire(pellets, spread, speed, dmg, orb = false) {
    const game = this.game, P = game.player;
    const dist = Math.hypot(P.x - this.x, P.y - this.y);
    const lead = (dist / speed) * 0.45;
    const ax = P.x + P.vx * lead, ay = P.y + P.vy * lead;
    const base = this.type === 'boss' && this.phase === 'spray' ? this.aim : Math.atan2(ay - this.y, ax - this.x);
    this.aim = base;
    const len = 12 + (this.gun ? this.gun.texture.width * (1 - this.gun.texture.anchorHint[0]) * this.gun.scale.x : 0);
    const mx = this.x + Math.cos(base) * len, my = this.y + Math.sin(base) * len;
    const isOrb = orb || this.type === 'heavy';
    const h = this.type === 'boss' ? 60 : this.type === 'heavy' ? 44 : 36;
    for (let i = 0; i < pellets; i++) {
      const a = base + (pellets > 1 ? (i / (pellets - 1) - 0.5) * spread * 2 : 0) + (Math.random() - 0.5) * spread * (pellets > 1 ? 0.3 : 2);
      game.fireBullet({
        x: mx, y: my, ang: a, speed: speed * (pellets > 1 ? 0.9 + Math.random() * 0.2 : 1), dmg, life: 1.8, team: 'enemy',
        orb: isOrb, tint: isOrb ? 0xff7ad9 : 0xff6a3d, scale: isOrb ? 1 : 1.1, h,
      });
    }
    game.fx.muzzle(mx, my - h, base);
    sfx.play('enemyShot', game.volumeAt(this.x, this.y));
  }

  hit(dmg, ang, knock) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = 0.08;
    const kb = this.type === 'boss' ? 0.15 : this.type === 'heavy' ? 0.5 : 1;
    this.kx += Math.cos(ang) * knock * kb; this.ky += Math.sin(ang) * knock * kb;
    this.hpBarT = 2.5;
    const crit = dmg >= 50;
    this.game.fx.text(this.x + (Math.random() - 0.5) * 20, this.y - this.height() - 10, String(Math.round(dmg)), crit ? 0xffd23f : 0xffffff, crit ? 1.2 : 0.8);
    sfx.play('hit');
    if (this.hp <= 0) { this.dead = true; this.game.onEnemyKilled(this); }
  }

  height() {
    if (this.type === 'crab') return 40;
    return 220 * this.T.scale;
  }

  sync() {
    const game = this.game;
    const moving = this.moving;
    if (this.type === 'crab') {
      this.body.texture = game.art.crab[Math.floor(this.animT) % 2];
      this.body.rotation = moving ? Math.sin(this.animT * 2) * 0.12 : 0;
      this.body.y = 0;
    } else {
      const sc = this.T.scale;
      const facing = Math.cos(this.aim) >= 0 ? 1 : -1;
      const frame = Math.floor(this.animT) % 4;
      this.body.texture = game.skins[this.T.skin][frame];
      const bob = moving ? -Math.abs(Math.sin(this.animT * Math.PI)) * 5 : 0;
      this.body.y = bob;
      this.body.scale.set(sc * facing, sc);
      this.body.rotation = moving ? (this.vx / this.T.speed) * 0.06 : 0;
      const gh = this.type === 'boss' ? 60 : this.type === 'heavy' ? 44 : 36;
      const cos = Math.cos(this.aim), sin = Math.sin(this.aim);
      this.gun.position.set(cos * 12, -gh + bob * 0.5 + sin * 4);
      this.gun.rotation = this.aim;
      this.gun.scale.y = Math.abs(this.gun.scale.x) * (cos < 0 ? -1 : 1);
      const behind = sin < -0.35;
      if (behind !== this.gunBehind) { this.gunBehind = behind; this.root.setChildIndex(this.gun, behind ? 0 : 1); }
      if (this.crown) {
        const hx = (game.skins.headX[frame] - 0.5) * this.body.texture.width * sc * facing;
        this.crown.position.set(hx, -this.body.texture.height * sc * 0.97 + bob + 6);
      }
    }
    this.body.tint = this.flash > 0 ? 0xff4d4d : 0xffffff;
    if (this.spawnT > 0) {
      this.root.alpha = 1 - this.spawnT / 0.7;
      this.root.scale.set(1, 1 - this.spawnT * 0.5);
    } else {
      this.root.alpha = 1; this.root.scale.set(1);
    }
    // Health bar
    this.hpBarT = (this.hpBarT ?? 0) - 1 / 60;
    if (this.type !== 'boss' && this.hpBarT > 0) {
      const w = this.type === 'heavy' ? 54 : 40, y = -this.height() - 12;
      this.hpBar.visible = true;
      this.hpBar.clear()
        .roundRect(-w / 2 - 2, y - 2, w + 4, 9, 3).fill({ color: 0x000000, alpha: 0.6 })
        .roundRect(-w / 2, y, w * Math.max(0, this.hp / this.maxHp), 5, 2).fill(this.T.color);
    } else this.hpBar.visible = false;
    const wading = game.island.isWading(this.x, this.y);
    this.root.position.set(this.x, this.y + (wading ? 6 : 0));
    this.root.zIndex = this.y;
    this.shadow.position.set(this.x + 2, this.y - 2);
    this.shadow.visible = !wading;
  }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}
