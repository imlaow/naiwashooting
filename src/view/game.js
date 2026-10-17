// Game session in the browser: runs the Sim (sim/sim.js) at its fixed step and draws it. Turns
// keyboard, mouse and touch input into the local player's commands (localId) and the sim's events
// into particles, sounds, banners and screen shake. Also owns the camera, pause and the
// title-screen demo. Every player is drawn; recoil, the hurt flash, shake, toasts and the laugh
// sound are only for the local one.
import { Container, Sprite } from 'pixi.js';
import { WORLD } from '../island.js';
import { mulberry32 } from '../noise.js';
import { Sim, STEP } from '../sim/sim.js';
import { Bot } from '../sim/bot.js';
import { WEAPONS, WEAPON_ORDER, ENEMY_TYPES, GUN_H } from '../sim/entities.js';
import { Fx } from './fx.js';
import { Environment, makeSprite } from './world.js';
import { PlayerView, EnemyView, EGG_FOOT, lerpPos } from './entities.js';
import { Hud } from './hud.js';
import { sfx } from '../audio.js';
import { laugh } from '../laugh.js';
import { t } from '../i18n.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const PICKUP_TINT = { health: 0xff5a7a, ammo: 0xffd23f, weapon: 0x7dd3fc };
// One-shot inputs (key presses, wheel, taps) wait here until a step takes them.
const noPresses = () => ({ dash: false, reload: false, weapon: null, cycle: 0, last: false });

export class Game {
  // `island` is the map's terrain (an Island or a Factory, see maps.js), `layout` its colliders,
  // props and weapon spots, and Scene the class that draws its scenery (Environment by default).
  // `bots` > 1 (debug only) adds bots - 1 scripted teammates (sim/bot.js) to see co-op locally.
  constructor({ app, art, skins, island, layout, terrainTex, input, onGameOver, onPause, onMute, demo = false, Scene = Environment, bots = 1 }) {
    this.demo = demo;
    this.app = app; this.art = art; this.skins = skins; this.island = island; this.input = input;
    this.onGameOver = onGameOver; this.onPause = onPause; this.onMute = onMute;
    this.time = 0;
    this.timeScale = 1;
    this.paused = false;
    this.acc = 0;
    this.presses = noPresses();

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

    this.sim = new Sim(island, layout);
    this.localId = this.sim.addPlayer().id;
    this.bots = [];
    for (let i = 1; i < bots; i++) this.bots.push(new Bot(this.sim, this.sim.addPlayer().id, mulberry32(1000 + i)));
    this.fx = new Fx(art, this.layers);
    // Sprites for the sim's things, by id.
    this.playerViews = new Map();
    this.propViews = new Map();
    this.pickupViews = new Map();
    this.enemyViews = new Map();
    this.bulletViews = new Map();
    this.bulletPool = [];
    this.stamp = 0;

    this.env = new Scene(this, terrainTex, layout);
    this.syncProps(0);
    this.syncPlayers(0, 1);
    this.hero = this.playerViews.get(this.localId);
    this.syncPickups(0);

    const sp = island.spawn;
    this.cam = { x: sp.x, y: sp.y - 80 };
    this.shakeAmt = 0;

    this.hud = new Hud(this, terrainTex.minimap);
    input.uiTap = demo ? null : (x, y) => this.hud.tap(x, y);
    this.resize();
    if (demo) this.hud.ui.visible = false;
    else this.hud.banner(t('game.intro'), t('game.introSub'), 2.6);
  }

  // ---------- Scene helpers ----------
  resize() {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.zoom = Math.max(0.6, Math.min(1.15, Math.min(w, h) / 760));
    for (const v of [this.vignette, this.hurtVignette]) { v.width = w; v.height = h; }
    this.hud.resize(w, h);
  }

  // The local player in the sim.
  get me() { return this.sim.players.get(this.localId); }

  shake(n) { this.shakeAmt = Math.min(22, this.shakeAmt + n); }

  volumeAt(x, y) {
    const P = this.me;
    const d = Math.hypot(x - P.x, y - P.y);
    return Math.max(0, 1 - d / 1300);
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.world.x) / this.zoom, y: (sy - this.world.y) / this.zoom };
  }

  // ---------- Input → commands ----------
  // Collects this frame's key presses; a frame without a step (screens faster than 60 Hz) keeps
  // them for the next one.
  collectPresses() {
    const input = this.input, p = this.presses;
    WEAPON_ORDER.forEach((k, i) => { if (input.wasPressed(String(i + 1))) p.weapon = k; });
    p.cycle += input.wheel;
    if (input.wasPressed('q')) p.last = true;
    if (input.wasPressed('r')) p.reload = true;
    if (input.wasPressed(' ') || input.wasPressed('shift') || input.dashTap) p.dash = true;
  }

  // The sim's command for the next step. Touch play aims at the nearest enemy in sight unless
  // the aim stick is held.
  command(mouseWorld) {
    const P = this.me, input = this.input;
    let aim = P.aim, fire = false;
    if (input.touch) {
      if (input.aimStick.active) {
        aim = Math.atan2(input.aimStick.y, input.aimStick.x);
        fire = true;
      } else {
        const target = this.sim.nearestEnemy(P.x, P.y, 520);
        if (target) aim = Math.atan2(target.y - P.y, target.x - P.x);
        else if (input.move.x || input.move.y) aim = Math.atan2(input.move.y, input.move.x);
      }
    } else {
      aim = Math.atan2(mouseWorld.y + GUN_H - P.y, mouseWorld.x - P.x);
      fire = input.mouse.down;
    }
    const recent = input.recentMove;
    const cmd = { mx: input.move.x, my: input.move.y, aim, fire, dashDir: recent && { x: recent.x, y: recent.y }, ...this.presses };
    this.presses = noPresses();
    return cmd;
  }

  // ---------- Sim events → effects ----------
  onEvent(e) {
    const fx = this.fx;
    // Player events: is it about the local player? Others' sounds fade with distance.
    const mine = e.id === this.localId;
    const vol = mine ? 1 : this.volumeAt(e.x, e.y);
    switch (e.type) {
      case 'shot': {
        const W = WEAPONS[e.weapon];
        if (mine) { this.hero.recoil = W.kick; this.shake(W.shake); }
        fx.muzzle(e.x, e.y - GUN_H, e.ang);
        fx.shell(e.px, e.py, e.ang);
        sfx.play(W.sound, vol);
        break;
      }
      case 'enemyShot':
        fx.muzzle(e.x, e.y - e.h, e.ang);
        sfx.play('enemyShot', this.volumeAt(e.ex, e.ey));
        break;
      case 'ring':
        sfx.play('shotgun', 0.6);
        this.shake(4);
        break;
      case 'hit': {
        const v = this.enemyViews.get(e.id);
        if (v) { v.flash = 0.08; v.hpBarT = 2.5; }
        const crit = e.dmg >= 50;
        fx.text(e.x + (Math.random() - 0.5) * 20, e.y - e.h - 10, String(Math.round(e.dmg)), crit ? 0xffd23f : 0xffffff, crit ? 1.2 : 0.8);
        sfx.play('hit');
        break;
      }
      case 'kill': this.onKill(e); break;
      case 'spawn':
        if (this.island.isWading(e.x, e.y)) fx.splash(e.x, e.y, 10);
        else fx.dust(e.x, e.y, 8, 0xdddddd);
        break;
      case 'bite': sfx.play('egg'); break;
      case 'hurt':
        if (mine) { this.hero.flash = 0.15; this.shake(9); }
        fx.burst(e.x, e.y - 40, 0xffd23f, 6);
        fx.text(e.x, e.y - 100, `-${Math.round(e.dmg)}`, 0xff5a5a, 0.9);
        sfx.play('hurt', vol);
        break;
      case 'downed':
        if (mine) { this.shake(14); this.hud.toast(t('game.downed')); }
        else this.hud.toast(t('game.mateDown'));
        fx.burst(e.x, e.y - 40, 0xff6b6b, 16);
        fx.text(e.x, e.y - 110, t('game.down'), 0xff6b6b, 1.2);
        sfx.play('die', vol);
        break;
      case 'revived':
        if (mine) this.hud.toast(t('game.revived'));
        fx.burst(e.x, e.y - 40, 0x4ade80, 14);
        fx.text(e.x, e.y - 100, '+30', 0x4ade80, 1.1);
        sfx.play('heal', mine || e.by === this.localId ? 1 : vol);
        break;
      case 'died':
        fx.burst(e.x, e.y - 40, 0xffd23f, 30);
        if (mine && this.sim.players.size > 1 && this.sim.state !== 'dead') this.hud.toast(t('game.bledOut'));
        break;
      case 'respawned':
        if (mine) this.hud.toast(t('game.respawned'));
        fx.dust(e.x, e.y, 10, 0xffffff);
        break;
      case 'over': this.onOver(); break;
      case 'dash': {
        const v = this.playerViews.get(e.id);
        if (v) v.dashLeft = 0.17;
        sfx.play('dash', vol);
        fx.dust(e.x, e.y, 5);
        break;
      }
      case 'laugh':
        if (mine) { laugh.play(sfx.muted); this.hud.toast(t('game.laughToast')); }
        fx.text(e.x, e.y - 120, t('game.laugh'), 0xffd23f, 1.4);
        break;
      case 'laughEnd':
        if (e.heal > 0) { fx.text(e.x, e.y - 100, `+${e.heal}`, 0x4ade80, 1.2); if (mine) sfx.play('heal'); }
        break;
      case 'switch': case 'reload': case 'reloaded': if (mine) sfx.play('reload'); break;
      case 'empty': if (mine) sfx.play('empty'); break;
      case 'bulletHit': {
        const color = e.target === 'enemy' ? ENEMY_TYPES[e.enemyType].color : e.target === 'crate' ? 0xd9a866 : 0xffe2a0;
        fx.sparks(e.x, e.y - e.h, e.ang, color, 5);
        if (e.target === 'wall') sfx.play('impact', this.volumeAt(e.x, e.y) * 0.6);
        break;
      }
      case 'bulletEnd':
        if (this.island.isWading(e.x, e.y)) fx.splash(e.x, e.y, 3);
        else fx.dust(e.x, e.y, 1);
        break;
      case 'propHit': {
        const v = this.propViews.get(e.id);
        if (v) v.shakeT = 0.15;
        if (e.kind === 'crate') { fx.splinters(e.x, e.y - 24, 0xb8803f, 3); sfx.play('wood', this.volumeAt(e.x, e.y)); }
        break;
      }
      case 'propBroken':
        if (e.kind === 'crate') {
          fx.splinters(e.x, e.y - 20, 0xb8803f, 20);
          sfx.play('crateBreak', this.volumeAt(e.x, e.y));
          this.shake(3);
        }
        break;
      case 'explode': {
        fx.explosion(e.x, e.y, e.r);
        const v = Math.max(0.3, this.volumeAt(e.x, e.y));
        sfx.play('explosion', v);
        this.shake(20 * v);
        break;
      }
      case 'pickup': this.onPickup(e); break;
      case 'wave':
        if (e.boss) {
          this.hud.banner(t('hud.wave', { n: e.n }), t('game.bossWave'), 2.6, 0xff6b6b);
          sfx.play('boss');
        } else {
          this.hud.banner(t('hud.wave', { n: e.n }), e.n === 1 ? t(this.island.firstWaveKey ?? 'game.firstWave') : t('game.incoming', { n: e.count }), 2.2);
          sfx.play('wave');
        }
        break;
      case 'waveCleared':
        for (const h of e.heals) if (h.heal > 0) fx.text(h.x, h.y - 100, `+${h.heal}`, 0x4ade80, 1);
        this.hud.banner(t('game.cleared'), t('game.bonus', { n: e.bonus }), 2.4, 0x4ade80);
        sfx.play('pickup');
        break;
    }
  }

  onPickup(e) {
    const fx = this.fx, mine = e.id === this.localId, vol = mine ? 1 : this.volumeAt(e.x, e.y);
    if (e.kind === 'health') {
      fx.text(e.px, e.py - 100, `+${Math.round(e.heal)}`, 0x4ade80, 1);
      sfx.play('heal', vol);
    } else if (e.kind === 'ammo') {
      fx.text(e.px, e.py - 100, t('game.ammo'), 0xffd23f, 0.9);
      sfx.play('pickup', vol);
    } else {
      const name = t(`weapon.${e.weapon}`);
      fx.text(e.px, e.py - 100, e.had ? t('game.weaponAmmo', { w: name }) : name.toUpperCase(), 0x7dd3fc, 1.1);
      if (!e.had && mine) this.hud.toast(t(this.input.touch ? 'game.pickedUpTouch' : 'game.pickedUp', { w: name, n: WEAPON_ORDER.indexOf(e.weapon) + 1 }));
      sfx.play('pickup', vol);
    }
    fx.burst(e.x, e.y, PICKUP_TINT[e.kind], 8);
  }

  onKill(e) {
    const fx = this.fx, T = ENEMY_TYPES[e.enemyType], v = this.enemyViews.get(e.id);
    fx.text(e.x, e.y - e.h - 30, `+${e.pts}`, 0xffd23f, 0.75);
    fx.burst(e.x, e.y - e.h * 0.4, T.color, e.enemyType === 'boss' ? 40 : 14);
    if (e.enemyType !== 'egg') {
      if (v) fx.spawn({ tex: v.body.texture, x: e.x, y: e.y, ay: 0.96, life: 0.35, s0: T.scale, s1: T.scale * 0.2, flip: Math.sign(v.body.scale.x), a0: 1, a1: 0, tint: 0xffffff, sy: 1 });
      fx.spawn({ tex: this.art.guns[T.gun], x: e.x, y: e.y - 20, z: 20, vz: 200, grav: 700, vx: rnd(-80, 80), life: 1.2, s0: 1, a0: 1, a1: 0.8, vr: rnd(-12, 12), bounce: true });
    } else if (v) {
      fx.spawn({ tex: v.body.texture, x: e.x, y: e.y, ay: EGG_FOOT, life: 0.6, s0: 1, s1: 0.9, sy: 1, a0: 1, a1: 0, z: 0, vz: 260, grav: 900, vr: 10 });
    }
    sfx.play(e.enemyType === 'egg' ? 'egg' : 'die', this.volumeAt(e.x, e.y));
    if (e.enemyType === 'boss') {
      this.shake(22);
      fx.explosion(e.x, e.y, 160);
      sfx.play('explosion');
      this.hud.banner(t('game.bossDown'), `+${e.pts}`, 3, 0xffd23f);
    }
  }

  // Every player is down or dead (alone: the player died).
  onOver() {
    this.timeScale = 0.3;
    this.shake(20);
    sfx.play('gameover');
    laugh.stop();
    this.hud.banner(t(this.sim.players.size > 1 ? 'game.allDown' : 'game.fell'), '', 2, 0xff6b6b);
    this.overT = 0.6;
  }

  // ---------- Sprites for the sim's things ----------
  // Creates a view for each new item of `list`, updates every one, and destroys the views
  // whose item has gone.
  reconcile(views, list, create, update, destroy) {
    const stamp = ++this.stamp;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      let v = views.get(item.id);
      if (!v) views.set(item.id, (v = create(item)));
      v.stamp = stamp;
      update(v, item, i);
    }
    for (const [id, v] of views) {
      if (v.stamp !== stamp) { destroy(v); views.delete(id); }
    }
  }

  syncPlayers(dt, alpha) {
    this.reconcile(this.playerViews, [...this.sim.players.values()], (P) => new PlayerView(this, P, P.id === this.localId), (v) => v.update(dt, alpha), (v) => v.destroy());
  }

  syncProps(dt) {
    this.reconcile(this.propViews, this.sim.props, (p) => {
      const sprite = makeSprite(p.kind === 'crate' ? this.art.crate : this.art.barrel);
      sprite.position.set(p.x, p.y);
      sprite.zIndex = p.y;
      if (p.kind === 'crate' && Math.random() < 0.5) sprite.scale.x = -1;
      this.layers.objects.addChild(sprite);
      return { sprite, shakeT: 0 };
    }, (v, p) => {
      if (v.shakeT > 0) {
        v.shakeT -= dt;
        v.sprite.x = p.x + (v.shakeT > 0 ? Math.sin(v.shakeT * 90) * 2.5 : 0);
      }
    }, (v) => v.sprite.destroy());
  }

  syncPickups(dt) {
    this.reconcile(this.pickupViews, this.sim.pickups, (p) => {
      const root = new Container();
      const glow = new Sprite(this.art.glow);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = PICKUP_TINT[p.kind];
      glow.scale.set(1.1, 0.55);
      glow.alpha = 0.7;
      const tex = p.kind === 'health' ? this.art.medkit : p.kind === 'ammo' ? this.art.ammo : this.art.guns[p.weapon];
      const icon = makeSprite(tex);
      if (p.kind === 'weapon') icon.anchor.set(0.5, 0.5);
      root.addChild(glow, icon);
      root.position.set(p.x, p.y);
      root.zIndex = p.y;
      this.layers.objects.addChild(root);
      return { root, icon, glow, t: Math.random() * 6 };
    }, (v, p) => {
      v.t += dt;
      v.icon.y = (p.kind === 'weapon' ? -22 : -6) + Math.sin(v.t * 3) * 4;
      v.icon.rotation = p.kind === 'weapon' ? Math.sin(v.t * 1.5) * 0.15 : 0;
      v.glow.alpha = 0.5 + Math.sin(v.t * 4) * 0.2;
      v.root.visible = p.life > 4 || Math.floor(v.t * 8) % 2 === 0;
    }, (v) => v.root.destroy({ children: true }));
  }

  syncBullets(alpha) {
    this.reconcile(this.bulletViews, this.sim.bullets, (b) => {
      let s = this.bulletPool.pop();
      if (!s) { s = new Sprite(); this.layers.bullets.addChild(s); }
      s.texture = b.orb ? this.art.orb : this.art.bullet;
      s.anchor.set(...s.texture.anchorHint);
      s.tint = b.tint;
      s.blendMode = 'add';
      s.scale.set(b.scale);
      s.visible = true;
      s.rotation = b.ang;
      return { s, b };
    }, (v, b, i) => {
      const [x, y] = lerpPos(v, b.x, b.y, alpha);
      v.s.position.set(x, y - b.h);
      if (b.orb) v.s.scale.set(b.scale * (1 + Math.sin(this.time * 30 + i) * 0.12));
    }, (v) => { v.s.visible = false; this.bulletPool.push(v.s); });
  }

  syncEnemies(dt, alpha) {
    this.reconcile(this.enemyViews, this.sim.enemies, (e) => new EnemyView(this, e), (v) => v.update(dt, alpha), (v) => v.destroy());
  }

  // Positions before a step, so a frame can be drawn between two steps.
  rememberPositions() {
    for (const v of this.playerViews.values()) { v.px = v.p.x; v.py = v.p.y; }
    for (const v of this.enemyViews.values()) { v.px = v.e.x; v.py = v.e.y; }
    for (const v of this.bulletViews.values()) { v.px = v.b.x; v.py = v.b.y; }
  }

  togglePause() {
    if (this.demo || this.sim.state === 'dead') return;
    this.paused = !this.paused;
    this.onPause(this.paused);
  }

  toggleMute() {
    const muted = sfx.toggleMute();
    laugh.setMuted(muted);
    this.onMute?.(muted);
    this.hud.toast(muted ? t('game.soundOff') : t('game.soundOn'));
  }

  // ---------- Main update ----------
  update(rawDt) {
    const input = this.input;
    input.update();
    if (this.demo) { this.updateDemo(rawDt); input.endFrame(); return; }
    if (input.wasPressed('escape') || input.wasPressed('p')) this.togglePause();
    if (input.wasPressed('m')) this.toggleMute();
    if (this.paused) { input.endFrame(); return; }
    this.collectPresses();

    if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + rawDt * 0.6);
    const dt = Math.min(rawDt, 1 / 30) * this.timeScale;
    this.time += dt;
    if (this.overT > 0) {
      this.overT -= rawDt;
      if (this.overT <= 0) this.onGameOver({ score: this.sim.score, wave: this.sim.wave, kills: this.sim.kills, coop: this.sim.players.size > 1 });
    }

    // Whole steps until the sim has caught up with the frame; the frame is then drawn between
    // the last two steps (alpha), which only matters on screens faster than 60 Hz. Rounding
    // leftovers (1/30 - 2/60 isn't exactly 0) don't start a step.
    const mouseWorld = this.screenToWorld(input.mouse.x, input.mouse.y);
    for (const v of this.playerViews.values()) v.tick(dt);
    for (const v of this.enemyViews.values()) v.tick(dt);
    this.acc += dt;
    while (this.acc > 1e-9) {
      this.rememberPositions();
      const cmds = { [this.localId]: this.command(mouseWorld) };
      for (const b of this.bots) cmds[b.id] = b.command(STEP);
      this.sim.step(STEP, cmds);
      this.acc -= STEP;
      for (const e of this.sim.takeEvents()) this.onEvent(e);
    }
    const alpha = 1 + this.acc / STEP;

    this.syncPlayers(dt, alpha);
    this.syncEnemies(dt, alpha);
    this.syncBullets(alpha);
    this.syncPickups(dt);
    this.syncProps(dt);
    this.fx.update(dt);

    // Camera: on the local player, or on a teammate while he's out.
    const P = this.focus();
    let lx = 0, ly = 0;
    if (!input.touch && P === this.hero) {
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
    this.env.update(dt, view, [...this.playerViews.values(), ...this.enemyViews.values()]);

    const S = this.me;
    const low = S.dead ? 1 : S.hp / S.maxHp;
    this.hurtVignette.alpha = low < 0.35 ? (0.35 - low) * 1.6 * (0.75 + Math.sin(this.time * 6) * 0.25) : 0;
    this.hud.update(rawDt, mouseWorld);
    input.endFrame();
  }

  focus() {
    if (!this.me.dead) return this.hero;
    for (const v of this.playerViews.values()) if (!v.p.dead) return v;
    return this.hero;
  }

  // Title-screen backdrop: the camera drifts around the map.
  updateDemo(dt) {
    this.time += dt;
    const isl = this.island;
    const a = this.time * 0.05;
    const tx = isl.village.x + Math.cos(a) * 500, ty = isl.village.y + Math.sin(a) * 380;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 0.8);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 0.8);
    this.hero.animT += dt * 2.2;
    this.hero.sync(1);
    this.fx.update(dt);
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(sw / 2 - this.cam.x * this.zoom), Math.round(sh / 2 - this.cam.y * this.zoom));
    const hw = sw / 2 / this.zoom, hh = sh / 2 / this.zoom;
    this.env.update(dt, { x0: this.cam.x - hw, x1: this.cam.x + hw, y0: this.cam.y - hh, y1: this.cam.y + hh }, [this.hero]);
  }

  destroy() {
    laugh.stop();
    this.hud.destroy();
    this.root.destroy({ children: true });
  }
}
