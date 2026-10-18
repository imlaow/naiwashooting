// Draws the sim's players and enemies (sim/entities.js): sprites, walk cycle, recoil, hit flash,
// footstep dust, dash ghosts, the downed look and revive ring, the boss's crown and enemy health
// bars. Each view reads its sim object every frame and keeps only what is drawn.
import { Container, Sprite, Graphics, Text } from 'pixi.js';
import { makeSprite } from './world.js';
import { FONT } from './hud.js';
import { TEAM, teamColour } from '../skins.js';
import { GUN_H, REVIVE_RANGE, REVIVE_SECONDS, BLEED_SECONDS } from '../sim/entities.js';
import { sfx } from '../audio.js';
import { laugh } from '../laugh.js';

const HERO_SCALE = 0.42;
const HERO_ANCHOR = { x: 0.5, y: 0.96 };
// Where the egg touches the ground, as a fraction of egg.png's height.
export const EGG_FOOT = 0.99;

// Between the position before the last step (px, py) and the current one; alpha 1 is the current.
// A jump further than any step's travel (a respawn, a stranded enemy put back) isn't smoothed.
const TELEPORT = 120;
export const lerpPos = (v, x, y, alpha) => (alpha >= 1 || v.px === undefined || Math.abs(x - v.px) + Math.abs(y - v.py) > TELEPORT
  ? [x, y] : [v.px + (x - v.px) * alpha, v.py + (y - v.py) * alpha]);

function stepFx(v, e, dt, moving, splashSound) {
  const game = v.game;
  const wading = game.island.isWading(e.x, e.y);
  v.stepT -= dt;
  if (v.stepT > 0) return;
  if (moving) {
    v.stepT = wading ? 0.28 : 0.24;
    if (wading) { game.fx.splash(e.x, e.y, 3); if (splashSound) sfx.play('splash', 0.4); }
    else game.fx.dust(e.x, e.y, 2, game.island.dustColor(e.x, e.y));
  } else if (wading) {
    v.stepT = 0.9;
    game.fx.ripple(e.x, e.y, 0.8);
  }
}

// The local player's view (`local`) also follows the laugh sound and splashes audibly; recoil and
// the hurt flash are only ever set on it (view/game.js). Online, every player wears their team
// colour, and other players carry their name over their head.
export class PlayerView {
  constructor(game, player, local = true) {
    this.game = game;
    this.p = player;
    this.local = local;
    this.fadePad = 60; // trees fade once he's this close to walking behind them
    this.animT = 0; this.stepT = 0; this.recoil = 0; this.flash = 0;
    this.dashLeft = 0; this.ghostT = 0;

    this.frames = player.colour != null ? game.skins.team(player.colour) : game.skins.hero;
    this.root = new Container();
    this.body = new Sprite(this.frames[0]);
    this.body.anchor.copyFrom(HERO_ANCHOR);
    this.body.scale.set(HERO_SCALE);
    this.gun = makeSprite(game.art.guns.pistol);
    this.root.addChild(this.body, this.gun);
    game.layers.objects.addChild(this.root);
    this.shadow = makeSprite(game.art.shadow);
    this.shadow.scale.set(0.8, 0.9);
    game.layers.shadows.addChild(this.shadow);
    // On the ground around a downed player: how far away a teammate can revive from, the bleed-out
    // time left (red) and the revive so far (green).
    this.ring = new Graphics();
    this.ring.scale.y = 0.5;
    this.ring.visible = false;
    game.layers.shadows.addChild(this.ring);
    if (!local && player.name != null) {
      this.tag = new Text({
        text: player.name,
        style: { fontFamily: FONT, fontSize: 15, fill: teamColour(player.colour).css, stroke: { color: '#10202b', width: 4, join: 'round' } },
      });
      this.tag.anchor.set(0.5, 1);
      game.layers.text.addChild(this.tag);
    }
    this.sync(1);
  }

  // Where he is drawn (the tree fading and the camera use it).
  get x() { return this.root.x; }
  get y() { return this.root.y; }

  // While laughing his arms stick out wide, so trees in front fade for his whole body
  // instead of only his feet.
  get focusBox() {
    if (this.p.laughT < 0) return null;
    const b = this.body, w = Math.abs(b.width), h = b.height;
    const ax = b.scale.x < 0 ? 1 - b.anchor.x : b.anchor.x;
    const x0 = this.x - ax * w, y0 = this.y + b.y - b.anchor.y * h;
    return { x0, x1: x0 + w, y0, y1: y0 + h };
  }

  // Before the frame's steps; their events may set recoil and flash again.
  tick(dt) {
    this.recoil = Math.max(0, this.recoil - dt * 40);
    this.flash -= dt;
  }

  update(dt, alpha) {
    const P = this.p;
    // Out of play (bled out, or a late joiner waiting for the wave break).
    this.root.visible = !P.dead;
    if (this.tag) this.tag.visible = !P.dead;
    if (P.dead) { this.shadow.visible = this.ring.visible = false; return; }
    // Dash ghosts, dropped where he was before the last step.
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.025; this.ghost(); }
    }
    stepFx(this, P, dt, P.moving, this.local);
    this.animT += dt * (P.moving ? 9 : 2.2);
    this.sync(alpha);
  }

  ghost() {
    const P = this.p;
    this.game.fx.spawn({
      tex: this.body.texture, x: this.px ?? P.x, y: (this.py ?? P.y) + this.body.y, ax: this.body.anchor.x, ay: this.body.anchor.y, life: 0.22, s0: HERO_SCALE,
      flip: Math.cos(P.aim) < 0 ? -1 : 1, a0: 0.45, a1: 0, tint: 0x9fe8ff, add: true,
    });
  }

  sync(alpha) {
    const P = this.p, game = this.game;
    const [x, y] = lerpPos(this, P.x, P.y, alpha);
    const facing = Math.cos(P.aim) >= 0 ? 1 : -1;
    // The laugh frames follow the sound's playback position when it is playing, so they stay in
    // sync with the audio; the sim's own clock otherwise.
    const L = P.laughT >= 0 && game.skins.laugh;
    if (L) {
      const lt = (this.local ? laugh.time() : null) ?? P.laughT;
      const tex = L.frames[Math.min(L.frames.length - 1, Math.floor(lt * L.fps))];
      this.body.texture = tex;
      this.body.anchor.copyFrom(tex.defaultAnchor);
      // The laugh clip has Naiwa's own colours: a teammate's is turned to theirs while it plays
      // (online, with the filter net/online.js brings along).
      const hue = P.colour ? TEAM[P.colour % TEAM.length].hue : 0;
      if (hue && game.hueFilter && !this.body.filters?.length) this.body.filters = [this.hueFilter ??= game.hueFilter(hue)];
    } else {
      if (this.body.filters?.length) this.body.filters = [];
      this.body.texture = this.frames[Math.floor(this.animT) % 4];
      this.body.anchor.copyFrom(HERO_ANCHOR);
    }
    if (this.weapon !== P.weapon) { this.weapon = P.weapon; this.gun.texture = game.art.guns[P.weapon]; }
    // The walk bob and lean are for the walk cycle; the laugh clip plays upright. Downed, he lies
    // on his side, greyed out.
    const down = P.down;
    const walk = P.moving && !L && !down;
    const bob = walk ? -Math.abs(Math.sin(this.animT * Math.PI)) * 6 : 0;
    const breathe = P.moving || L || down ? 1 : 1 + Math.sin(game.time * 3) * 0.018;
    const wading = game.island.isWading(P.x, P.y);
    this.body.y = bob + (wading ? 8 : 0) + (down ? -6 : 0);
    this.body.scale.set(HERO_SCALE * facing, HERO_SCALE * breathe);
    this.body.rotation = down ? facing * 1.35 : walk ? (P.vx / 265) * 0.07 : 0;
    this.body.tint = this.flash > 0 ? 0xff6b6b : down ? 0x8f9bb0 : 0xffffff;
    this.gun.visible = !down;
    this.root.alpha = P.invuln > 0 && P.dashT <= 0 && !down ? (Math.floor(game.time * 20) % 2 ? 0.45 : 1) : 1;
    const cos = Math.cos(P.aim), sin = Math.sin(P.aim);
    this.gun.position.set(cos * (12 - this.recoil), -GUN_H + bob * 0.5 + sin * 4 - this.recoil * sin);
    this.gun.rotation = P.aim;
    this.gun.scale.set(1, cos < 0 ? -1 : 1);
    // Gun goes behind the body when aiming upward.
    const behind = sin < -0.35;
    if (behind !== this.gunBehind) {
      this.gunBehind = behind;
      this.root.setChildIndex(this.gun, behind ? 0 : 1);
    }
    this.root.position.set(x, y);
    this.root.zIndex = y;
    this.shadow.position.set(x + 2, y - 2);
    this.shadow.visible = !wading;
    this.ring.visible = down;
    if (down) this.drawRing(x, y);
    this.tag?.position.set(x, y - (down ? 62 : 106));
  }

  drawRing(x, y) {
    const P = this.p, g = this.ring.clear(), top = -Math.PI / 2;
    const arc = (r, f) => g.moveTo(Math.cos(top) * r, Math.sin(top) * r).arc(0, 0, r, top, top + f * Math.PI * 2);
    this.ring.position.set(x, y);
    g.circle(0, 0, REVIVE_RANGE).fill({ color: 0x000000, alpha: 0.18 }).stroke({ width: 3, color: 0xffffff, alpha: 0.4 });
    arc(REVIVE_RANGE + 7, Math.max(0, P.bleedT / BLEED_SECONDS)).stroke({ width: 4, color: 0xef4444, alpha: 0.85 });
    if (P.reviveT > 0) arc(REVIVE_RANGE, Math.min(1, P.reviveT / REVIVE_SECONDS)).stroke({ width: 8, color: 0x4ade80 });
  }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
    this.ring.destroy();
    this.tag?.destroy();
    this.hueFilter?.destroy();
  }
}

export class EnemyView {
  constructor(game, enemy) {
    this.game = game;
    this.e = enemy;
    const { type, T } = enemy;
    this.stepT = 0; this.flash = 0; this.hpBarT = 0;

    this.root = new Container();
    if (type === 'egg') {
      this.body = new Sprite(game.skins.egg);
      this.body.anchor.set(0.5, EGG_FOOT);
    } else {
      this.body = new Sprite(game.skins[T.skin][0]);
      this.body.anchor.set(0.5, 0.96);
      this.gun = makeSprite(game.art.guns[T.gun]);
      if (T.gunScale) this.gun.scale.set(T.gunScale);
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
    this.sync(1);
  }

  get x() { return this.root.x; }
  get y() { return this.root.y - this.wadeY; }

  tick(dt) {
    if (!this.e.dead) this.flash -= dt;
  }

  // A killed enemy stays in its last pose until the sim drops it.
  update(dt, alpha) {
    const e = this.e;
    if (e.dead) return;
    if (e.spawnT <= 0) stepFx(this, e, dt, e.moving, false);
    this.hpBarT -= dt;
    this.sync(alpha);
  }

  sync(alpha) {
    const game = this.game, e = this.e, T = e.T;
    const moving = e.moving;
    if (e.type === 'egg') {
      // Waddle: rock side to side on its base with a little hop each step.
      this.body.rotation = moving ? Math.sin(e.animT) * 0.16 : 0;
      this.body.y = moving ? -Math.abs(Math.sin(e.animT)) * 3 : 0;
    } else {
      const sc = T.scale;
      const facing = Math.cos(e.aim) >= 0 ? 1 : -1;
      const frame = Math.floor(e.animT) % 4;
      this.body.texture = game.skins[T.skin][frame];
      const bob = moving ? -Math.abs(Math.sin(e.animT * Math.PI)) * 5 : 0;
      this.body.y = bob;
      this.body.scale.set(sc * facing, sc);
      this.body.rotation = moving ? (e.vx / T.speed) * 0.06 : 0;
      const cos = Math.cos(e.aim), sin = Math.sin(e.aim);
      this.gun.position.set(cos * 12, -T.gunH + bob * 0.5 + sin * 4);
      this.gun.rotation = e.aim;
      this.gun.scale.y = Math.abs(this.gun.scale.x) * (cos < 0 ? -1 : 1);
      const behind = sin < -0.35;
      if (behind !== this.gunBehind) { this.gunBehind = behind; this.root.setChildIndex(this.gun, behind ? 0 : 1); }
      if (this.crown) {
        const hx = (game.skins.headX[frame] - 0.5) * this.body.texture.width * sc * facing;
        this.crown.position.set(hx, -this.body.texture.height * sc * 0.97 + bob + 6);
      }
    }
    this.body.tint = this.flash > 0 ? 0xff4d4d : 0xffffff;
    if (e.spawnT > 0) {
      this.root.alpha = 1 - e.spawnT / 0.7;
      this.root.scale.set(1, 1 - e.spawnT * 0.5);
    } else {
      this.root.alpha = 1; this.root.scale.set(1);
    }
    // Health bar
    if (e.type !== 'boss' && this.hpBarT > 0) {
      const w = e.type === 'heavy' ? 54 : 40, y = -e.height() - 12;
      this.hpBar.visible = true;
      this.hpBar.clear()
        .roundRect(-w / 2 - 2, y - 2, w + 4, 9, 3).fill({ color: 0x000000, alpha: 0.6 })
        .roundRect(-w / 2, y, w * Math.max(0, e.hp / e.maxHp), 5, 2).fill(T.color);
    } else this.hpBar.visible = false;
    const [x, y] = lerpPos(this, e.x, e.y, alpha);
    const wading = game.island.isWading(e.x, e.y);
    this.wadeY = wading ? 6 : 0;
    this.root.position.set(x, y + this.wadeY);
    this.root.zIndex = y;
    this.shadow.position.set(x + 2, y - 2);
    this.shadow.visible = !wading;
  }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}
