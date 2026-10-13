// Pooled particles, decals and floating damage numbers.
import { Sprite, Container, BitmapText } from 'pixi.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor(art, layers) {
    this.art = art;
    this.normal = layers.fx;
    this.additive = layers.fxAdd;
    this.decals = layers.decals;
    this.textLayer = layers.text;
    this.live = [];
    this.pool = [];
    this.texts = [];
    this.textPool = [];
    this.decalList = [];
  }

  spawn(o) {
    let s = this.pool.pop();
    if (!s) s = new Sprite();
    s.texture = o.tex;
    s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
    s.blendMode = o.add ? 'add' : 'normal';
    s.tint = o.tint ?? 0xffffff;
    s.rotation = o.rot ?? 0;
    s.visible = true;
    const p = {
      s, x: o.x, y: o.y, z: o.z ?? 0, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      grav: o.grav ?? 0, drag: o.drag ?? 0, life: o.life, max: o.life,
      s0: o.s0 ?? 1, s1: o.s1 ?? o.s0 ?? 1, a0: o.a0 ?? 1, a1: o.a1 ?? 0,
      vr: o.vr ?? 0, align: o.align ?? false, sy: o.sy ?? 1, flip: o.flip ?? 1, bounce: o.bounce ?? false,
    };
    (o.add ? this.additive : this.normal).addChild(s);
    this.live.push(p);
    return p;
  }

  update(dt) {
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.removeFromParent();
        this.pool.push(p.s);
        live[i] = live[live.length - 1];
        live.pop();
        continue;
      }
      const k = 1 - p.life / p.max;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grav) {
        p.vz -= p.grav * dt; p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          if (p.bounce && Math.abs(p.vz) > 60) { p.vz *= -0.4; p.vx *= 0.6; p.vy *= 0.6; } else { p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; p.vr *= 0.8; }
        }
      }
      const sc = p.s0 + (p.s1 - p.s0) * k;
      p.s.scale.set(sc * p.flip, sc * p.sy);
      p.s.alpha = p.a0 + (p.a1 - p.a0) * k;
      p.s.x = p.x; p.s.y = p.y - p.z;
      if (p.align) p.s.rotation = Math.atan2(p.vy - p.vz, p.vx);
      else p.s.rotation += p.vr * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.vy += 300 * dt;
      t.obj.y += t.vy * dt;
      t.obj.x += t.vx * dt;
      const k = t.life / t.max;
      t.obj.alpha = Math.min(1, k * 3);
      const pop = k > 0.85 ? 1 + (k - 0.85) * 4 : 1;
      t.obj.scale.set(t.scale * pop);
      if (t.life <= 0) {
        t.obj.visible = false;
        this.textPool.push(t.obj);
        this.texts.splice(i, 1);
      }
    }
  }

  text(x, y, str, color = 0xffffff, scale = 1) {
    let obj = this.textPool.pop();
    if (!obj) {
      obj = new BitmapText({
        text: str,
        style: { fontFamily: 'Arial', fontSize: 26, fontWeight: 'bold', fill: '#ffffff', stroke: { color: '#1a1a1a', width: 5 } },
      });
      obj.anchor.set(0.5);
      this.textLayer.addChild(obj);
    }
    obj.text = str;
    obj.tint = color;
    obj.visible = true;
    obj.x = x; obj.y = y;
    this.texts.push({ obj, life: 0.9, max: 0.9, vx: rnd(-40, 40), vy: -260, scale });
  }

  decal(tex, x, y, scale = 1, alpha = 1, rot = 0) {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(scale);
    s.alpha = alpha;
    s.rotation = rot;
    this.decals.addChild(s);
    this.decalList.push(s);
    if (this.decalList.length > 80) this.decalList.shift().destroy();
  }

  // ----- Presets -----
  muzzle(x, y, ang) {
    const a = this.art;
    this.spawn({ tex: a.flash, x, y, rot: ang, life: 0.06, s0: rnd(0.9, 1.3), s1: 0.6, a0: 1, a1: 0.6, add: true });
    this.spawn({ tex: a.glow, x, y, life: 0.08, s0: 1.4, s1: 0.4, a0: 0.8, tint: 0xffc94a, add: true });
    for (let i = 0; i < 2; i++) {
      const sp = rnd(30, 80), aa = ang + rnd(-0.5, 0.5);
      this.spawn({ tex: a.soft, x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp - 20, life: rnd(0.3, 0.5), s0: 0.25, s1: 0.7, a0: 0.35, a1: 0, tint: 0xd8d8d8, drag: 2 });
    }
  }

  shell(x, y, ang) {
    const side = Math.cos(ang) > 0 ? -1 : 1;
    this.spawn({
      tex: this.art.square, x, y, z: 30, vx: side * rnd(60, 120), vy: rnd(-20, 20), vz: rnd(120, 200), grav: 700,
      life: 0.8, s0: 0.6, sy: 0.5, a0: 1, a1: 0.6, tint: 0xe0b040, vr: rnd(-20, 20), bounce: true,
    });
  }

  sparks(x, y, ang, color = 0xffd27a, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = ang + Math.PI + rnd(-0.9, 0.9), sp = rnd(120, 340);
      this.spawn({ tex: this.art.spark, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.12, 0.28), s0: rnd(0.6, 1), s1: 0.2, a0: 1, a1: 0, tint: color, add: true, align: true, drag: 4 });
    }
  }

  dust(x, y, n = 3, color = 0xd9c49a) {
    for (let i = 0; i < n; i++) {
      this.spawn({ tex: this.art.soft, x: x + rnd(-6, 6), y: y + rnd(-3, 3), vx: rnd(-30, 30), vy: rnd(-25, 0), life: rnd(0.35, 0.6), s0: 0.25, s1: rnd(0.6, 0.9), a0: 0.45, a1: 0, tint: color, drag: 3 });
    }
  }

  splash(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(30, 90);
      this.spawn({ tex: this.art.square, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, z: 2, vz: rnd(80, 180), grav: 600, life: rnd(0.3, 0.5), s0: rnd(0.4, 0.8), a0: 0.9, a1: 0.2, tint: 0xe0fbff });
    }
    this.ripple(x, y);
  }

  ripple(x, y, size = 1) {
    this.spawn({ tex: this.art.ring, x, y, life: 0.7, s0: 0.15 * size, s1: 0.9 * size, sy: 0.5, a0: 0.6, a1: 0, tint: 0xe6fcff });
  }

  splinters(x, y, color = 0xb8803f, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(60, 220);
      this.spawn({ tex: this.art.splinter, x, y, z: rnd(5, 25), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: rnd(100, 260), grav: 800, life: rnd(0.6, 1.1), s0: rnd(0.6, 1.2), a0: 1, a1: 0.7, tint: color, vr: rnd(-15, 15), bounce: true });
    }
    this.dust(x, y, 4, 0xc8a878);
  }

  burst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(60, 260);
      this.spawn({ tex: this.art.orb, x, y, z: rnd(10, 40), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, vz: rnd(50, 250), grav: 700, life: rnd(0.4, 0.8), s0: rnd(0.5, 1.1), s1: 0.3, a0: 1, a1: 0.5, tint: color, bounce: true });
    }
    this.spawn({ tex: this.art.glow, x, y: y - 30, life: 0.25, s0: 1, s1: 2.6, a0: 0.8, a1: 0, tint: color, add: true });
    this.spawn({ tex: this.art.ring, x, y: y - 10, life: 0.35, s0: 0.3, s1: 1.6, sy: 0.6, a0: 0.8, a1: 0, tint: 0xffffff });
  }

  explosion(x, y, radius) {
    const a = this.art;
    this.spawn({ tex: a.glow, x, y, life: 0.35, s0: 2, s1: radius / 14, a0: 1, a1: 0, tint: 0xffd27a, add: true });
    this.spawn({ tex: a.ring, x, y, life: 0.4, s0: 0.4, s1: radius / 24, sy: 0.7, a0: 0.9, a1: 0, tint: 0xfff2c4, add: true });
    for (let i = 0; i < 26; i++) {
      const ang = rnd(0, Math.PI * 2), sp = rnd(40, radius * 2.2);
      this.spawn({ tex: a.soft, x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.7, z: rnd(0, 20), vz: rnd(20, 120), life: rnd(0.3, 0.6), s0: rnd(0.8, 1.4), s1: 0.3, a0: 1, a1: 0, tint: i % 3 ? 0xff8c2a : 0xffe066, add: true, drag: 3 });
    }
    for (let i = 0; i < 16; i++) {
      const ang = rnd(0, Math.PI * 2), sp = rnd(20, 90);
      this.spawn({ tex: a.soft, x: x + rnd(-20, 20), y: y + rnd(-15, 15), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6 - 30, life: rnd(1, 1.8), s0: rnd(0.8, 1.2), s1: rnd(2, 3), a0: 0.55, a1: 0, tint: 0x3f3a36, drag: 1.5 });
    }
    this.sparks(x, y, 0, 0xffe2a0, 14);
    this.decal(a.scorch, x, y, radius / 60, 0.9, rnd(0, 6));
  }

  flame(x, y, size = 1) {
    this.spawn({ tex: this.art.soft, x: x + rnd(-5, 5) * size, y, vx: rnd(-10, 10), vy: rnd(-70, -40) * size, life: rnd(0.35, 0.6), s0: 0.55 * size, s1: 0.1, a0: 0.95, a1: 0, tint: Math.random() < 0.5 ? 0xff9a2e : 0xffd34e, add: true });
    if (Math.random() < 0.15) {
      this.spawn({ tex: this.art.soft, x: x + rnd(-4, 4), y: y - 20 * size, vx: rnd(-8, 8) + 10, vy: rnd(-40, -25), life: rnd(1.2, 2), s0: 0.3 * size, s1: 1.2 * size, a0: 0.25, a1: 0, tint: 0x5a5550 });
    }
    if (Math.random() < 0.05) {
      this.spawn({ tex: this.art.square, x, y: y - 10, vx: rnd(-20, 20), vy: rnd(-90, -50), life: rnd(0.6, 1), s0: 0.3, a0: 1, a1: 0, tint: 0xffc04a, add: true });
    }
  }
}
