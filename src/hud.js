// Screen-space HUD: health, ammo, wave info, minimap, banners and crosshair.
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { WORLD } from './island.js';
import { WEAPONS, WEAPON_ORDER } from './entities.js';

export const FONT = '"Lilita One", "Arial Black", sans-serif';

function label(size, color = '#ffffff', extra = {}) {
  return new Text({
    text: '',
    style: {
      fontFamily: FONT, fontSize: size, fill: color,
      stroke: { color: '#10202b', width: Math.max(3, size / 6), join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.35, blur: 2, distance: 2, angle: Math.PI / 2 },
      ...extra,
    },
  });
}

export class Hud {
  constructor(game, minimapTex) {
    this.game = game;
    const ui = (this.ui = new Container());
    game.app.stage.addChild(ui);
    this.cache = {};

    // Health panel
    this.hpPanel = new Container();
    this.hpBg = new Graphics();
    this.portrait = new Sprite(game.skins.hero[1]);
    this.portrait.anchor.set(0.5, 0.25);
    this.portrait.scale.set(0.34);
    const mask = new Graphics().circle(34, 34, 27).fill(0xffffff);
    this.portrait.position.set(34, 18);
    this.portrait.mask = mask;
    this.hpBar = new Graphics();
    this.hpText = label(16);
    this.hpText.position.set(78, 14);
    this.hpPanel.addChild(this.hpBg, this.portrait, mask, this.hpBar, this.hpText);
    ui.addChild(this.hpPanel);

    // Weapon panel
    this.wpPanel = new Container();
    this.wpBg = new Graphics();
    this.gunIcon = new Sprite(game.art.guns.pistol);
    this.gunIcon.anchor.set(0.5);
    this.gunIcon.scale.set(1.6);
    this.wpName = label(16, '#cfe8ff');
    this.ammoText = label(34);
    this.ammoText.anchor.set(1, 0);
    this.slots = new Graphics();
    this.slotIcons = WEAPON_ORDER.map((k) => {
      const s = new Sprite(game.art.guns[k]);
      s.anchor.set(0.5);
      s.scale.set(0.6);
      return s;
    });
    this.slotNums = WEAPON_ORDER.map((_, i) => { const t = label(11); t.text = String(i + 1); return t; });
    this.wpPanel.addChild(this.wpBg, this.gunIcon, this.wpName, this.ammoText, this.slots, ...this.slotIcons, ...this.slotNums);
    ui.addChild(this.wpPanel);

    // Wave & score
    this.waveText = label(30);
    this.waveText.anchor.set(0.5, 0);
    this.enemyText = label(15, '#ffe9b0');
    this.enemyText.anchor.set(0.5, 0);
    this.scoreText = label(30, '#ffd23f');
    this.scoreText.anchor.set(1, 0);
    this.comboText = label(18, '#ff9f43');
    this.comboText.anchor.set(1, 0);
    ui.addChild(this.waveText, this.enemyText, this.scoreText, this.comboText);

    // Boss bar
    this.bossBar = new Graphics();
    this.bossName = label(16, '#ffd6d6');
    this.bossName.anchor.set(0.5, 1);
    this.bossName.text = 'KING NAIWA';
    ui.addChild(this.bossBar, this.bossName);

    // Minimap
    this.mini = new Container();
    this.miniSize = 170;
    this.miniBg = new Graphics();
    this.miniMap = new Sprite(minimapTex);
    this.miniMap.width = this.miniMap.height = this.miniSize;
    this.miniMask = new Graphics().roundRect(0, 0, this.miniSize, this.miniSize, 14).fill(0xffffff);
    this.miniMap.mask = this.miniMask;
    this.miniDots = new Graphics();
    this.mini.addChild(this.miniBg, this.miniMap, this.miniMask, this.miniDots);
    ui.addChild(this.mini);

    // Banner & toast
    this.bannerTitle = label(64);
    this.bannerTitle.anchor.set(0.5);
    this.bannerSub = label(22, '#fff3c4');
    this.bannerSub.anchor.set(0.5);
    this.bannerT = 0;
    this.toastText = label(18, '#e0f2fe');
    this.toastText.anchor.set(0.5);
    this.toastT = 0;
    this.hint = label(15, '#e8f6ff');
    this.hint.anchor.set(0.5, 1);
    this.hint.text = 'WASD move  ·  Mouse aim & shoot  ·  Space dash  ·  R reload  ·  1-4 / wheel switch  ·  P pause  ·  M mute';
    this.hintT = 12;
    ui.addChild(this.bannerTitle, this.bannerSub, this.toastText, this.hint);

    // Crosshair & touch sticks
    this.cross = new Graphics();
    this.reloadArc = new Graphics();
    this.sticks = new Graphics();
    ui.addChild(this.cross, this.reloadArc, this.sticks);
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const small = w < 700;
    const s = small ? 0.8 : 1;
    this.hpPanel.scale.set(s);
    this.hpPanel.position.set(14, 14);
    this.wpPanel.scale.set(s);
    this.wpPanel.position.set(w - 270 * s - 14, h - 118 * s - 14);
    this.waveText.position.set(w / 2, 12);
    this.enemyText.position.set(w / 2, 48);
    this.scoreText.position.set(w - 16, 10);
    this.comboText.position.set(w - 16, 46);
    const ms = small ? 0.65 : 1;
    this.mini.scale.set(ms);
    this.mini.position.set(14, h - this.miniSize * ms - 14);
    this.bannerTitle.position.set(w / 2, h * 0.32);
    this.bannerSub.position.set(w / 2, h * 0.32 + 52);
    this.bannerTitle.scale.set(small ? 0.65 : 1);
    this.toastText.position.set(w / 2, h - 60);
    this.hint.position.set(w / 2, h - 16);
    this.hint.visible = !small;
    this.drawStatic();
  }

  drawStatic() {
    this.hpBg.clear()
      .roundRect(0, 0, 300, 70, 16).fill({ color: 0x0b1e2a, alpha: 0.55 }).stroke({ width: 2, color: 0xffffff, alpha: 0.15 })
      .circle(34, 34, 29).fill(0x2a7fa8).stroke({ width: 3, color: 0xffd23f });
    this.wpBg.clear().roundRect(0, 0, 270, 118, 16).fill({ color: 0x0b1e2a, alpha: 0.55 }).stroke({ width: 2, color: 0xffffff, alpha: 0.15 });
    this.gunIcon.position.set(60, 40);
    this.wpName.position.set(126, 12);
    this.ammoText.position.set(258, 30);
    this.miniBg.clear().roundRect(-4, -4, this.miniSize + 8, this.miniSize + 8, 16).fill({ color: 0x0b1e2a, alpha: 0.7 });
  }

  banner(title, sub, dur = 2, color = 0xffffff) {
    this.bannerTitle.text = title;
    this.bannerTitle.tint = color;
    this.bannerSub.text = sub;
    this.bannerT = this.bannerMax = dur;
  }

  toast(msg) {
    this.toastText.text = msg;
    this.toastT = 2.4;
  }

  setText(obj, key, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    obj.text = value;
  }

  update(dt, mouseWorld) {
    const g = this.game, P = g.player, input = g.input;
    // Health
    const hpFrac = Math.max(0, P.hp / P.maxHp);
    this.shownHp = this.shownHp == null ? hpFrac : this.shownHp + (hpFrac - this.shownHp) * Math.min(1, dt * 4);
    const col = hpFrac > 0.5 ? 0x4ade80 : hpFrac > 0.25 ? 0xfacc15 : 0xef4444;
    const dashFrac = P.dashCd > 0 ? 1 - P.dashCd / 0.85 : 1;
    this.hpBar.clear()
      .roundRect(76, 36, 208, 16, 8).fill({ color: 0x000000, alpha: 0.5 })
      .roundRect(78, 38, 204 * this.shownHp, 12, 6).fill({ color: 0xffffff, alpha: 0.5 })
      .roundRect(78, 38, 204 * hpFrac, 12, 6).fill(col)
      .roundRect(78, 39, 204 * hpFrac, 4, 2).fill({ color: 0xffffff, alpha: 0.3 })
      .roundRect(76, 56, 90, 6, 3).fill({ color: 0x000000, alpha: 0.5 })
      .roundRect(76, 56, 90 * dashFrac, 6, 3).fill(dashFrac >= 1 ? 0x7dd3fc : 0x3b6b85);
    this.setText(this.hpText, 'hp', `${Math.ceil(P.hp)} / ${P.maxHp}`);
    this.portrait.texture = g.skins.hero[Math.floor(g.time * 1.5) % 4];

    // Weapon
    const W = WEAPONS[P.weapon], slot = P.slot;
    this.gunIcon.texture = g.art.guns[P.weapon];
    this.setText(this.wpName, 'wn', W.name.toUpperCase());
    const reserve = slot.reserve === Infinity ? '∞' : String(slot.reserve);
    this.setText(this.ammoText, 'ammo', P.reloading > 0 ? 'RELOADING' : `${slot.mag} / ${reserve}`);
    const fs = P.reloading > 0 ? 22 : 34;
    if (this.cache.fs !== fs) { this.cache.fs = fs; this.ammoText.style.fontSize = fs; }
    this.ammoText.tint = slot.mag === 0 && P.reloading <= 0 ? 0xff6b6b : 0xffffff;
    this.slots.clear();
    WEAPON_ORDER.forEach((k, i) => {
      const x = 14 + i * 62, y = 74;
      const owned = !!P.arsenal[k], cur = k === P.weapon;
      this.slots.roundRect(x, y, 56, 32, 8)
        .fill({ color: cur ? 0x2a7fa8 : 0x000000, alpha: cur ? 0.8 : 0.35 })
        .stroke({ width: 2, color: cur ? 0xffd23f : 0xffffff, alpha: cur ? 1 : 0.15 });
      this.slotIcons[i].position.set(x + 30, y + 17);
      this.slotIcons[i].alpha = owned ? 1 : 0.18;
      this.slotNums[i].position.set(x + 4, y + 1);
    });

    // Wave & score
    const st = g.state;
    this.setText(this.waveText, 'wave', g.wave ? `WAVE ${g.wave}` : 'GET READY');
    const remaining = g.queue.length + g.enemies.filter((e) => !e.dead).length;
    this.setText(this.enemyText, 'enemies', st === 'break' ? `Next wave in ${Math.ceil(g.stateT)}` : st === 'intro' ? `Starting in ${Math.ceil(g.stateT)}` : `${remaining} hostiles left`);
    this.setText(this.scoreText, 'score', g.score.toLocaleString());
    const mult = 1 + Math.min(3, Math.floor(g.combo / 3) * 0.5);
    this.setText(this.comboText, 'combo', g.comboT > 0 && g.combo > 1 ? `${g.combo} combo  x${mult}` : '');

    // Boss bar
    const boss = g.boss && !g.boss.dead ? g.boss : null;
    this.bossBar.clear();
    this.bossName.visible = !!boss;
    if (boss) {
      const w = Math.min(460, this.w - 60), x = (this.w - w) / 2, y = 92;
      this.bossBar.roundRect(x - 3, y - 3, w + 6, 20, 8).fill({ color: 0x000000, alpha: 0.6 })
        .roundRect(x, y, w * Math.max(0, boss.hp / boss.maxHp), 14, 6).fill(0xe11d48)
        .roundRect(x, y, w * Math.max(0, boss.hp / boss.maxHp), 4, 2).fill({ color: 0xffffff, alpha: 0.3 });
      this.bossName.position.set(this.w / 2, y - 4);
    }

    // Minimap
    const k = this.miniSize / WORLD;
    const d = this.miniDots.clear();
    for (const p of g.pickups) d.circle(p.x * k, p.y * k, 2.5).fill(p.kind === 'weapon' ? 0x7dd3fc : p.kind === 'health' ? 0xff5a7a : 0xffd23f);
    for (const e of g.enemies) {
      if (e.dead) continue;
      d.circle(e.x * k, e.y * k, e.type === 'boss' ? 5 : 2.6).fill(e.type === 'crab' ? 0xff5a3d : e.T.color).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
    }
    const hw = this.w / 2 / g.zoom, hh = this.h / 2 / g.zoom;
    d.rect((g.cam.x - hw) * k, (g.cam.y - hh) * k, hw * 2 * k, hh * 2 * k).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    const pulse = 3.5 + Math.sin(g.time * 6) * 0.8;
    d.circle(P.x * k, P.y * k, pulse).fill(0xffd23f).stroke({ width: 1.5, color: 0x000000 });

    // Banner & toast
    if (this.bannerT > 0) this.bannerT -= dt;
    const bt = Math.max(0, this.bannerT);
    const into = this.bannerMax ? this.bannerMax - bt : 1;
    const ba = Math.min(1, bt * 2, into * 4);
    this.bannerTitle.alpha = this.bannerSub.alpha = ba;
    const pop = into < 0.25 ? 1 + (0.25 - into) * 1.6 : 1;
    const bs = this.w < 700 ? 0.65 : 1;
    this.bannerTitle.scale.set(bs * pop);
    this.toastT -= dt;
    this.toastText.alpha = Math.max(0, Math.min(1, this.toastT * 2));
    this.hintT -= dt;
    this.hint.alpha = Math.max(0, Math.min(0.85, this.hintT * 0.5));

    // Crosshair
    const c = this.cross.clear();
    const r = this.reloadArc.clear();
    if (!input.touch && !P.dead) {
      const mx = input.mouse.x, my = input.mouse.y;
      const spread = 9 + W.spread * 60 + P.recoil * 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(mx + dx * spread, my + dy * spread).lineTo(mx + dx * (spread + 9), my + dy * (spread + 9));
      }
      c.stroke({ width: 5, color: 0x000000, alpha: 0.5 });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(mx + dx * spread, my + dy * spread).lineTo(mx + dx * (spread + 9), my + dy * (spread + 9));
      }
      c.stroke({ width: 2.5, color: 0xffffff });
      c.circle(mx, my, 2).fill(0xffd23f);
      if (P.reloading > 0) {
        const f = 1 - P.reloading / W.reload;
        r.arc(mx, my, 24, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).stroke({ width: 4, color: 0x7dd3fc });
      }
    }
    // Touch sticks
    const s = this.sticks.clear();
    for (const st2 of input.sticks.values()) {
      s.circle(st2.ox, st2.oy, 60).fill({ color: 0xffffff, alpha: 0.08 }).stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
      const dx = st2.x - st2.ox, dy = st2.y - st2.oy, l = Math.hypot(dx, dy), m = Math.min(l, 60) / (l || 1);
      s.circle(st2.ox + dx * m, st2.oy + dy * m, 26).fill({ color: st2.left ? 0x7dd3fc : 0xff6b6b, alpha: 0.45 });
    }
  }

  destroy() {
    this.ui.destroy({ children: true });
  }
}
