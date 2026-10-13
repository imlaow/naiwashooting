// Screen-space HUD: health, ammo, wave info, minimap, banners and crosshair.
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { WORLD } from './island.js';
import { WEAPONS, WEAPON_ORDER } from './entities.js';
import { t } from './i18n.js';

export const FONT = '"Lilita One", "ZCOOL KuaiLe", "Arial Black", sans-serif';

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

// Notch / home-indicator insets in CSS pixels (needs viewport-fit=cover).
function safeInsets() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const [top, right, bottom, left] = ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs[`padding${k}`]) || 0);
  el.remove();
  // In the rotated view the physical right edge is the game's top.
  return document.body.classList.contains('rotated') ? { top: right, right: bottom, bottom: left, left: top } : { top, right, bottom, left };
}

// Shrinks a text so it fits within maxW.
function fit(text, maxW, base = 1) {
  text.scale.set(1);
  text.scale.set(Math.min(base, maxW / Math.max(1, text.width)));
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
    this.bossName.text = t('hud.boss');
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
    this.hint.text = t('hud.hint');
    this.hintT = 12;
    ui.addChild(this.bannerTitle, this.bannerSub, this.toastText, this.hint);

    // Crosshair & touch sticks
    this.cross = new Graphics();
    this.reloadArc = new Graphics();
    this.sticks = new Graphics();
    this.stickHints = [label(15, '#e8f6ff'), label(15, '#e8f6ff')];
    this.stickHints[0].text = t('hud.touchMove');
    this.stickHints[1].text = t('hud.touchAim');
    for (const h of this.stickHints) h.anchor.set(0.5, 1);
    ui.addChild(this.cross, this.reloadArc, this.sticks, ...this.stickHints);
  }

  // A touch on the weapon panel switches weapon (slot row) or reloads (ammo area).
  tap(x, y) {
    if (!this.ui.visible || !this.w) return false;
    const P = this.game.player, p = this.wpPanel, s = p.scale.x;
    const lx = (x - p.x) / s, ly = (y - p.y) / s;
    if (lx < 0 || lx > 270 || ly < 0 || ly > 118 || P.dead) return false;
    if (ly >= 64) {
      const k = WEAPON_ORDER[Math.max(0, Math.min(WEAPON_ORDER.length - 1, Math.floor((lx - 11) / 62)))];
      P.switchTo(k);
    } else {
      P.startReload();
    }
    return true;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const touch = (this.touchLayout = this.game.input.touch);
    const ins = safeInsets();
    const L = 14 + ins.left, R = w - 14 - ins.right, T = 14 + ins.top, B = h - 14 - ins.bottom;
    // Shrink everything on phones; narrow (portrait) screens also move the wave counter below the health panel.
    const s = Math.max(0.68, Math.min(1, w / 860, h / 620));
    const narrow = w - ins.left - ins.right < 600;
    this.bs = Math.max(0.55, Math.min(1, w / 900));
    this.hpPanel.scale.set(s);
    this.hpPanel.position.set(L, T);
    this.wpPanel.scale.set(s);
    // Touch play keeps both bottom corners for the sticks, so the weapon panel sits between them.
    this.wpPanel.position.set(touch ? Math.round(w / 2 - 135 * s) : R - 270 * s, B - 118 * s);
    const input = this.game.input, sr = input.stickR;
    input.stickCenters[0] = { x: L + sr + 46, y: B - sr - 36 };
    input.stickCenters[1] = { x: R - sr - 46, y: B - sr - 36 };
    // Small labels shrink less so they stay readable.
    for (const txt of [this.waveText, this.scoreText]) txt.scale.set(s);
    for (const txt of [this.enemyText, this.comboText, this.bossName]) txt.scale.set(Math.max(0.85, s));
    const waveY = narrow ? T + 70 * s + 6 : T - 2;
    this.waveText.position.set(w / 2, waveY);
    this.enemyText.position.set(w / 2, waveY + 36 * s);
    this.bossY = waveY + 80 * s + 4;
    // The pause / mute buttons take the top-right corner in touch mode.
    const scoreY = T - 4 + (touch ? 52 : 0);
    this.scoreText.position.set(R + 2, scoreY);
    this.comboText.position.set(R + 2, scoreY + 36 * s);
    const ms = touch || s < 1 ? 0.62 : 1;
    this.mini.scale.set(ms);
    // Touch players use the bottom-left corner as the move stick, so the minimap goes up top.
    if (touch) this.mini.position.set(L + 4, (narrow ? this.bossY + 30 : T + 70 * s + 14));
    else this.mini.position.set(L, B - this.miniSize * ms);
    this.bannerTitle.position.set(w / 2, h * 0.32);
    this.bannerSub.position.set(w / 2, h * 0.32 + 52 * this.bs);
    this.fitBanner();
    this.toastText.position.set(w / 2, touch || narrow ? B - 118 * s - 22 : h - 60);
    fit(this.toastText, w - 32);
    this.hint.position.set(w / 2, h - 16);
    this.hint.visible = !touch && w >= 700;
    this.stickHints.forEach((hnt, i) => {
      const c = input.stickCenters[i];
      hnt.position.set(c.x, c.y - sr - 10);
      fit(hnt, w * 0.3);
    });
    this.drawStatic();
  }

  fitBanner() {
    fit(this.bannerTitle, this.w - 32, this.bs);
    this.bannerFit = this.bannerTitle.scale.x;
    fit(this.bannerSub, this.w - 32, Math.max(0.8, this.bs));
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
    if (this.w) this.fitBanner();
  }

  toast(msg) {
    this.toastText.text = msg;
    this.toastT = 2.4;
    if (this.w) fit(this.toastText, this.w - 32);
  }

  setText(obj, key, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    obj.text = value;
  }

  update(dt, mouseWorld) {
    const g = this.game, P = g.player, input = g.input;
    if (input.touch !== this.touchLayout) this.resize(this.w, this.h);
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
    this.setText(this.wpName, 'wn', t(`weapon.${P.weapon}`).toUpperCase());
    const reserve = slot.reserve === Infinity ? '∞' : String(slot.reserve);
    this.setText(this.ammoText, 'ammo', P.reloading > 0 ? t('hud.reloading') : `${slot.mag} / ${reserve}`);
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
    this.setText(this.waveText, 'wave', g.wave ? t('hud.wave', { n: g.wave }) : t('hud.getReady'));
    const remaining = g.queue.length + g.enemies.filter((e) => !e.dead).length;
    this.setText(this.enemyText, 'enemies', st === 'break' ? t('hud.nextWave', { n: Math.ceil(g.stateT) }) : st === 'intro' ? t('hud.starting', { n: Math.ceil(g.stateT) }) : t('hud.left', { n: remaining }));
    this.setText(this.scoreText, 'score', g.score.toLocaleString());
    const mult = 1 + Math.min(3, Math.floor(g.combo / 3) * 0.5);
    this.setText(this.comboText, 'combo', g.comboT > 0 && g.combo > 1 ? t('hud.combo', { n: g.combo, m: mult }) : '');

    // Boss bar
    const boss = g.boss && !g.boss.dead ? g.boss : null;
    this.bossBar.clear();
    this.bossName.visible = !!boss;
    if (boss) {
      const w = Math.min(460, this.w - 60), x = (this.w - w) / 2, y = this.bossY;
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
      d.circle(e.x * k, e.y * k, e.type === 'boss' ? 5 : 2.6).fill(e.type === 'egg' ? 0xff5a3d : e.T.color).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
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
    this.bannerTitle.scale.set(this.bannerFit * pop);
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
    // Fixed touch sticks; labels fade out once the player has had time to learn them
    const s = this.sticks.clear();
    const show = input.touch && !P.dead;
    const hintA = show ? Math.max(0, Math.min(1, this.hintT * 0.4)) : 0;
    this.stickHints.forEach((hnt) => { hnt.alpha = hintA * 0.9; });
    if (show) {
      const R = input.stickR;
      const knobs = input.stickCenters.map((c) => ({ x: c.x, y: c.y, on: false }));
      for (const st2 of input.sticks.values()) {
        const k = knobs[st2.left ? 0 : 1], { dx, dy } = input.stickVec(st2);
        const l = Math.hypot(dx, dy), m = Math.min(l, R) / (l || 1);
        k.x += dx * m; k.y += dy * m; k.on = true;
      }
      input.stickCenters.forEach((c, i) => {
        const k = knobs[i];
        s.circle(c.x, c.y, R).fill({ color: 0x0b1e2a, alpha: 0.22 }).stroke({ width: 2, color: 0xffffff, alpha: k.on ? 0.4 : 0.22 });
        s.circle(k.x, k.y, 26).fill({ color: i ? 0xff6b6b : 0x7dd3fc, alpha: k.on ? 0.6 : 0.3 });
      });
    }
  }

  destroy() {
    this.ui.destroy({ children: true });
  }
}
