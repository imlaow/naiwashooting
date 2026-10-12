// Game session: scene graph, camera, combat, waves and scoring.
import { Container, Sprite } from 'pixi.js';
import { WORLD } from './island.js';
import { StaticWorld } from './physics.js';
import { Fx } from './fx.js';
import { Environment, makeSprite } from './world.js';
import { Player, Enemy, ENEMY_TYPES, WEAPONS, WEAPON_ORDER } from './entities.js';
import { Hud } from './hud.js';
import { sfx } from './audio.js';
import { laugh } from './laugh.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor({ app, art, skins, island, terrainTex, input, onGameOver, onPause, demo = false }) {
    this.demo = demo;
    this.app = app; this.art = art; this.skins = skins; this.island = island; this.input = input;
    this.onGameOver = onGameOver; this.onPause = onPause;
    this.time = 0;
    this.timeScale = 1;
    this.paused = false;

    this.root = new Container();
    app.stage.addChildAt(this.root, 0);
    this.world = new Container();
    this.root.addChild(this.world);
    const names = ['ocean', 'terrain', 'foam', 'ground', 'decals', 'shadows', 'objects', 'bullets', 'fx', 'fxAdd', 'lights', 'text', 'air'];
    this.layers = {};
    for (const n of names) {
      const c = new Container();
      this.layers[n] = c;
      this.world.addChild(c);
    }
    this.layers.objects.sortableChildren = true;
    this.vignette = new Sprite(art.vignette);
    this.vignette.alpha = 0.35;
    this.root.addChild(this.vignette);
    this.hurtVignette = new Sprite(art.vignette);
    this.hurtVignette.tint = 0xff1a1a;
    this.hurtVignette.alpha = 0;
    this.root.addChild(this.hurtVignette);

    this.statics = new StaticWorld();
    this.fx = new Fx(art, this.layers);
    this.props = [];
    this.enemies = [];
    this.bullets = [];
    this.bulletPool = [];
    this.pickups = [];
    this.timers = [];

    this.env = new Environment(this, terrainTex);
    const sp = island.spawn;
    this.player = new Player(this, sp.x, sp.y);
    for (const w of this.env.weaponSpots) this.spawnPickup('weapon', w.x, w.y, w.kind, Infinity);

    this.cam = { x: sp.x, y: sp.y - 80 };
    this.shakeAmt = 0;
    this.score = 0; this.kills = 0;
    this.combo = 0; this.comboT = 0;
    this.wave = 0;
    this.queue = [];
    this.state = 'intro';
    this.stateT = 3;

    this.hud = new Hud(this, terrainTex.minimap);
    this.resize();
    if (demo) this.hud.ui.visible = false;
    else this.hud.banner('NAIWA ISLAND', 'Survive the rival invasion!', 2.6);
  }

  // ---------- Scene helpers ----------
  resize() {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.zoom = Math.max(0.6, Math.min(1.15, Math.min(w, h) / 760));
    for (const v of [this.vignette, this.hurtVignette]) { v.width = w; v.height = h; }
    this.hud.resize(w, h);
  }

  shake(n) { this.shakeAmt = Math.min(22, this.shakeAmt + n); }

  volumeAt(x, y) {
    const d = Math.hypot(x - this.player.x, y - this.player.y);
    return Math.max(0, 1 - d / 1300);
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

  screenToWorld(sx, sy) {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  // ---------- Props ----------
  addProp(kind, x, y) {
    const sprite = makeSprite(kind === 'crate' ? this.art.crate : this.art.barrel);
    sprite.position.set(x, y);
    sprite.zIndex = y;
    if (kind === 'crate' && Math.random() < 0.5) sprite.scale.x = -1;
    this.layers.objects.addChild(sprite);
    const prop = { kind, x, y, hp: kind === 'crate' ? 45 : 22, sprite, shakeT: 0 };
    prop.collider = this.statics.add({ kind: 'circle', x, y: y - 12, r: kind === 'crate' ? 22 : 17, owner: prop });
    this.props.push(prop);
    return prop;
  }

  damageProp(p, dmg) {
    if (p.dead) return;
    p.hp -= dmg;
    p.shakeT = 0.15;
    if (p.kind === 'crate') { this.fx.splinters(p.x, p.y - 24, 0xb8803f, 3); sfx.play('wood', this.volumeAt(p.x, p.y)); }
    if (p.hp <= 0) this.destroyProp(p);
  }

  destroyProp(p) {
    p.dead = true;
    this.statics.remove(p.collider);
    p.sprite.destroy();
    this.props.splice(this.props.indexOf(p), 1);
    if (p.kind === 'crate') {
      this.fx.splinters(p.x, p.y - 20, 0xb8803f, 20);
      sfx.play('crateBreak', this.volumeAt(p.x, p.y));
      this.shake(3);
      const r = Math.random();
      if (r < 0.3) this.spawnPickup('health', p.x, p.y);
      else if (r < 0.6) this.spawnPickup('ammo', p.x, p.y);
      else if (r < 0.7) this.dropWeapon(p.x, p.y);
    } else {
      this.explode(p.x, p.y - 10, 130, 80);
    }
  }

  explode(x, y, R, dmg) {
    this.fx.explosion(x, y, R);
    sfx.play('explosion', Math.max(0.3, this.volumeAt(x, y)));
    this.shake(20 * Math.max(0.3, this.volumeAt(x, y)));
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

  spawnPickup(kind, x, y, weapon = null, life = 22) {
    const root = new Container();
    const glow = new Sprite(this.art.glow);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = kind === 'health' ? 0xff5a7a : kind === 'ammo' ? 0xffd23f : 0x7dd3fc;
    glow.scale.set(1.1, 0.55);
    glow.alpha = 0.7;
    const tex = kind === 'health' ? this.art.medkit : kind === 'ammo' ? this.art.ammo : this.art.guns[weapon];
    const icon = makeSprite(tex);
    if (kind === 'weapon') icon.anchor.set(0.5, 0.5);
    root.addChild(glow, icon);
    root.position.set(x, y);
    root.zIndex = y;
    this.layers.objects.addChild(root);
    this.pickups.push({ kind, weapon, x, y, root, icon, glow, life, t: Math.random() * 6, delay: 0.4 });
  }

  updatePickups(dt) {
    const P = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt; p.life -= dt; p.delay -= dt;
      p.icon.y = (p.kind === 'weapon' ? -22 : -6) + Math.sin(p.t * 3) * 4;
      p.icon.rotation = p.kind === 'weapon' ? Math.sin(p.t * 1.5) * 0.15 : 0;
      p.glow.alpha = 0.5 + Math.sin(p.t * 4) * 0.2;
      p.root.visible = p.life > 4 || Math.floor(p.t * 8) % 2 === 0;
      let take = false;
      if (p.delay <= 0 && !P.dead && Math.hypot(P.x - p.x, P.y - p.y) < 36) {
        if (p.kind === 'health' && P.hp < P.maxHp) {
          const heal = Math.min(35, P.maxHp - P.hp);
          P.hp += heal;
          this.fx.text(P.x, P.y - 100, `+${Math.round(heal)}`, 0x4ade80, 1);
          sfx.play('heal');
          take = true;
        } else if (p.kind === 'ammo') {
          P.giveAmmo();
          this.fx.text(P.x, P.y - 100, 'AMMO', 0xffd23f, 0.9);
          sfx.play('pickup');
          take = true;
        } else if (p.kind === 'weapon') {
          const had = !!P.arsenal[p.weapon];
          P.giveWeapon(p.weapon);
          this.fx.text(P.x, P.y - 100, had ? `${WEAPONS[p.weapon].name} AMMO` : WEAPONS[p.weapon].name.toUpperCase(), 0x7dd3fc, 1.1);
          if (!had) this.hud.toast(`Picked up ${WEAPONS[p.weapon].name}  —  press ${WEAPON_ORDER.indexOf(p.weapon) + 1}`);
          sfx.play('pickup');
          take = true;
        }
      }
      if (take || p.life <= 0) {
        if (take) this.fx.burst(p.x, p.y, p.glow.tint, 8);
        p.root.destroy({ children: true });
        this.pickups.splice(i, 1);
      }
    }
  }

  // ---------- Bullets ----------
  fireBullet(o) {
    let s = this.bulletPool.pop();
    if (!s) { s = new Sprite(); this.layers.bullets.addChild(s); }
    s.texture = o.orb ? this.art.orb : this.art.bullet;
    s.anchor.set(...s.texture.anchorHint);
    s.tint = o.tint ?? 0xffffff;
    s.blendMode = 'add';
    s.scale.set(o.scale ?? 1);
    s.visible = true;
    s.rotation = o.ang;
    this.bullets.push({
      s, x: o.x, y: o.y, vx: Math.cos(o.ang) * o.speed, vy: Math.sin(o.ang) * o.speed,
      ang: o.ang, life: o.life, dmg: o.dmg, team: o.team, pierce: o.pierce ?? 0, knock: o.knock ?? 80,
      h: o.h ?? 36, hits: null, tint: o.tint ?? 0xffffff, orb: !!o.orb, scale: o.scale ?? 1,
    });
  }

  updateBullets(dt) {
    const P = this.player;
    const isl = this.island;
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
          this.fx.sparks(b.x, b.y - b.h, b.ang, c.owner?.kind === 'crate' ? 0xd9a866 : 0xffe2a0, 5);
          if (!c.owner) sfx.play('impact', this.volumeAt(b.x, b.y) * 0.6);
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
            this.fx.sparks(b.x, b.y - b.h, b.ang, e.T.color, 5);
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
        if (isl.heightAt(b.x, b.y) < 0 && !isl.inDock(b.x, b.y)) this.fx.splash(b.x, b.y, 3);
        else this.fx.dust(b.x, b.y, 1);
      }
      if (!alive) {
        b.s.visible = false;
        this.bulletPool.push(b.s);
        this.bullets[i] = this.bullets[this.bullets.length - 1];
        this.bullets.pop();
        continue;
      }
      b.s.position.set(b.x, b.y - b.h);
      if (b.orb) b.s.scale.set(b.scale * (1 + Math.sin(this.time * 30 + i) * 0.12));
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
        const h = isl.heightAt(x, y);
        if (pass === 0 && type === 'crab' && (h > 0.05 || h < -0.09)) continue;
        if (this.statics.overlaps(x, y, 26)) continue;
        return { x, y };
      }
    }
    return null;
  }

  spawnEnemy(type, x, y) {
    const e = new Enemy(this, type, x, y, this.wave);
    this.enemies.push(e);
    if (this.island.isWading(x, y)) this.fx.splash(x, y, 10);
    else this.fx.dust(x, y, 8, 0xdddddd);
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
    let crabs = Math.min(3 + n * 2, 18);
    let gunners = Math.min(n, 10);
    let heavies = Math.min(Math.floor((n - 1) / 2), 6);
    if (boss) { crabs = Math.floor(crabs / 2); gunners = Math.floor(gunners / 2); heavies = Math.floor(heavies / 2); }
    const q = [];
    for (let i = 0; i < crabs; i++) q.push('crab');
    for (let i = 0; i < gunners; i++) q.splice(Math.floor(Math.random() * (q.length + 1)), 0, 'gunner');
    for (let i = 0; i < heavies; i++) q.splice(Math.floor(q.length * 0.4 + Math.random() * q.length * 0.6), 0, 'heavy');
    if (boss) q.splice(Math.min(3, q.length), 0, 'boss');
    this.queue = q;
    this.maxAlive = Math.min(6 + n * 2, 20);
    this.spawnT = 0.6;
    this.waveTotal = q.length;
    this.state = 'fight';
    if (boss) {
      this.hud.banner(`WAVE ${n}`, 'KING NAIWA approaches!', 2.6, 0xff6b6b);
      sfx.play('boss');
    } else {
      this.hud.banner(`WAVE ${n}`, n === 1 ? 'Rivals are landing on the beaches' : `${q.length} hostiles incoming`, 2.2);
      sfx.play('wave');
    }
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
      if (heal > 0) { P.hp += heal; this.fx.text(P.x, P.y - 100, `+${heal}`, 0x4ade80, 1); }
      this.hud.banner('WAVE CLEARED', `+${bonus} bonus`, 2.4, 0x4ade80);
      sfx.play('pickup');
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
    this.fx.text(e.x, e.y - e.height() - 30, `+${pts}`, 0xffd23f, 0.75);
    if (this.kills % 5 === 0 && this.player.laugh()) {
      laugh.play(sfx.muted);
      this.fx.text(this.player.x, this.player.y - 120, 'HA HA HA!', 0xffd23f, 1.4);
      this.hud.toast('Naiwa is laughing his head off  —  invincible!');
    }
    this.fx.burst(e.x, e.y - e.height() * 0.4, e.T.color, e.type === 'boss' ? 40 : 14);
    if (e.type !== 'crab') {
      this.fx.spawn({ tex: e.body.texture, x: e.x, y: e.y, ay: 0.96, life: 0.35, s0: e.T.scale, s1: e.T.scale * 0.2, flip: Math.sign(e.body.scale.x), a0: 1, a1: 0, tint: 0xffffff, sy: 1 });
      this.fx.spawn({ tex: this.art.guns[e.T.gun], x: e.x, y: e.y - 20, z: 20, vz: 200, grav: 700, vx: rnd(-80, 80), life: 1.2, s0: 1, a0: 1, a1: 0.8, vr: rnd(-12, 12), bounce: true });
    } else {
      this.fx.spawn({ tex: e.body.texture, x: e.x, y: e.y, ay: 0.82, life: 0.6, s0: 1, s1: 0.9, sy: 1, a0: 1, a1: 0, z: 0, vz: 260, grav: 900, vr: 10 });
    }
    sfx.play(e.type === 'crab' ? 'crab' : 'die', this.volumeAt(e.x, e.y));
    if (e.type === 'boss') {
      this.shake(22);
      this.fx.explosion(e.x, e.y, 160);
      sfx.play('explosion');
      this.hud.banner('KING NAIWA DEFEATED', `+${pts}`, 3, 0xffd23f);
      for (let i = 0; i < 4; i++) this.spawnPickup(i % 2 ? 'health' : 'ammo', e.x + rnd(-60, 60), e.y + rnd(-40, 40));
      this.dropWeapon(e.x, e.y);
      this.boss = null;
    } else {
      const P = this.player;
      const r = Math.random();
      const healChance = P.hp < 40 ? 0.2 : 0.09;
      if (r < healChance) this.spawnPickup('health', e.x, e.y);
      else if (r < healChance + 0.1 && Object.keys(P.arsenal).length > 1) this.spawnPickup('ammo', e.x, e.y);
      else if (Math.random() < (e.type === 'heavy' ? 0.25 : 0.04)) this.dropWeapon(e.x, e.y);
    }
    this.after(0, () => {
      e.destroy();
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    });
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.timeScale = 0.3;
    const P = this.player;
    P.root.visible = false;
    P.shadow.visible = false;
    this.fx.burst(P.x, P.y - 40, 0xffd23f, 30);
    this.shake(20);
    sfx.play('gameover');
    laugh.stop();
    this.hud.banner('YOU FELL', '', 2, 0xff6b6b);
    this.after(0.6, () => {
      this.onGameOver({ score: this.score, wave: this.wave, kills: this.kills });
    });
  }

  // ---------- Main update ----------
  update(rawDt) {
    const input = this.input;
    input.update();
    if (this.demo) { this.updateDemo(rawDt); input.endFrame(); return; }
    if (input.wasPressed('escape') || input.wasPressed('p')) {
      if (this.state !== 'dead') { this.paused = !this.paused; this.onPause(this.paused); }
    }
    if (input.wasPressed('m')) {
      const muted = sfx.toggleMute();
      laugh.setMuted(muted);
      this.hud.toast(muted ? 'Sound off' : 'Sound on');
    }
    if (this.paused) { input.endFrame(); return; }

    if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + rawDt * 0.6);
    const dt = Math.min(rawDt, 1 / 30) * this.timeScale;
    this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= rawDt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }

    const mouseWorld = this.screenToWorld(input.mouse.x, input.mouse.y);
    this.player.update(dt, input, mouseWorld);
    for (const e of this.enemies) if (!e.dead) e.update(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.updateWaves(dt);
    for (const p of this.props) {
      if (p.shakeT > 0) {
        p.shakeT -= dt;
        p.sprite.x = p.x + (p.shakeT > 0 ? Math.sin(p.shakeT * 90) * 2.5 : 0);
      }
    }
    this.comboT -= dt;
    this.fx.update(dt);

    // Camera
    const P = this.player;
    let lx = 0, ly = 0;
    if (!input.touch) {
      lx = (mouseWorld.x - P.x) * 0.2; ly = (mouseWorld.y - P.y) * 0.2;
      const l = Math.hypot(lx, ly);
      if (l > 150) { lx *= 150 / l; ly *= 150 / l; }
    }
    const k = 1 - Math.exp(-rawDt * 6);
    this.cam.x += (P.x + lx - this.cam.x) * k;
    this.cam.y += (P.y - 40 + ly - this.cam.y) * k;
    this.cam.x = Math.max(0, Math.min(WORLD, this.cam.x));
    this.cam.y = Math.max(0, Math.min(WORLD, this.cam.y));
    this.shakeAmt *= Math.exp(-rawDt * 9);
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const shx = (Math.random() - 0.5) * this.shakeAmt, shy = (Math.random() - 0.5) * this.shakeAmt;
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(sw / 2 - this.cam.x * this.zoom + shx), Math.round(sh / 2 - this.cam.y * this.zoom + shy));
    const hw = sw / 2 / this.zoom, hh = sh / 2 / this.zoom;
    const view = { x0: this.cam.x - hw, x1: this.cam.x + hw, y0: this.cam.y - hh, y1: this.cam.y + hh };
    const focus = [P, ...this.enemies];
    this.env.update(dt, view, focus);

    const low = P.hp / P.maxHp;
    this.hurtVignette.alpha = low < 0.35 ? (0.35 - low) * 1.6 * (0.75 + Math.sin(this.time * 6) * 0.25) : 0;
    this.hud.update(rawDt, mouseWorld);
    input.endFrame();
  }

  // Title-screen backdrop: the camera drifts around the island.
  updateDemo(dt) {
    this.time += dt;
    const isl = this.island;
    const a = this.time * 0.05;
    const tx = isl.village.x + Math.cos(a) * 500, ty = isl.village.y + Math.sin(a) * 380;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 0.8);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 0.8);
    this.player.animT += dt * 2.2;
    this.player.sync();
    this.fx.update(dt);
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(sw / 2 - this.cam.x * this.zoom), Math.round(sh / 2 - this.cam.y * this.zoom));
    const hw = sw / 2 / this.zoom, hh = sh / 2 / this.zoom;
    this.env.update(dt, { x0: this.cam.x - hw, x1: this.cam.x + hw, y0: this.cam.y - hh, y1: this.cam.y + hh }, [this.player]);
  }

  destroy() {
    laugh.stop();
    this.hud.destroy();
    this.root.destroy({ children: true });
  }
}
