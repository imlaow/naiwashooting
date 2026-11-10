// Draws a dream map from its layout (sim/layoutDream.js). Plays the same role as Environment in
// world.js. Everything here is a Naiwa picture: the ground (painted by dream.js), the statues in
// every team colour (some marching on the spot, some on their heads), the laughing giants (the
// laugh clip, looping), the totem, and the ones tumbling through the void around him. His eyes
// follow whoever is being watched, and blink. Its own seeded RNG only places decoration.
import { Sprite, Graphics, Container } from 'pixi.js';
import { mulberry32 } from '../noise.js';
import { STATUE_POSES } from '../sim/layoutDream.js';

const rnd = (r, a, b) => a + r() * (b - a);
const FEET = 0.965; // where a pose's feet are, down its texture
// Tints for the poses that have no recoloured frames; the last is stone.
const TINTS = [0xffffff, 0xbfe6ff, 0xffc0e0, 0xc8ffc0, 0xffd0a0, 0xb0fff0, 0xd0b0ff, 0x9a96a8];
const VOID = 0x1c0b33;
const NEBULA = [0xff4fd8, 0x4fd8ff, 0xffd23f, 0x8a4fff];

export class DreamEnvironment {
  constructor(game, terrainTex, layout) {
    this.game = game;
    const { island: world, art, layers } = game;
    this.world = world;
    this.art = art;
    this.skins = game.skins;
    this.layout = layout;
    this.rand = mulberry32(world.seed + 99);
    this.t = 0;
    this.cullables = [];
    this.fading = [];
    this.statues = [];
    this.laughers = [];
    this.lights = [];

    this.buildVoid(layers.ocean);
    const terrain = new Sprite(terrainTex.terrain);
    terrain.width = terrain.height = world.size;
    layers.terrain.addChild(terrain);
    this.buildEyes(layers.ground);
    this.placeObjects();
    this.buildSky(layers.air);
    this.bubbleT = 0;
    this.snoreT = 2;
  }

  // ---------- The void ----------
  // Three depths behind him, each sliding with the camera by its own amount: stars and
  // nebulae far away, then Naiwas and eggs tumbling past.
  buildVoid(layer) {
    const R = this.rand, S = this.world.size, M = 1800;
    layer.addChild(new Graphics().rect(-M, -M, S + M * 2, S + M * 2).fill(VOID));
    this.far = new Container();
    layer.addChild(this.far);
    for (let i = 0; i < 16; i++) {
      const s = new Sprite(this.art.glow);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = NEBULA[i % NEBULA.length];
      s.alpha = rnd(R, 0.1, 0.22);
      s.position.set(rnd(R, -600, S + 600), rnd(R, -600, S + 600));
      s.scale.set(rnd(R, 18, 38), rnd(R, 12, 26));
      this.far.addChild(s);
    }
    const stars = new Graphics();
    for (let i = 0; i < 1800; i++) {
      stars.circle(rnd(R, -M, S + M), rnd(R, -M, S + M), rnd(R, 1, 3.2)).fill({ color: R() < 0.3 ? 0xffd6f5 : 0xffffff, alpha: rnd(R, 0.35, 0.95) });
    }
    this.far.addChild(stars);

    this.floaters = [];
    const sk = this.skins;
    const kinds = [...STATUE_POSES.map((p) => sk[p][0]), sk.egg, sk.egg, sk.hero[2], sk.heavy[0], sk.team(1)[1], sk.team(2)[3]];
    for (let i = 0; i < 260; i++) {
      const depth = rnd(R, 0.25, 0.7); // 0 moves with the ground, 1 not at all
      const tex = kinds[(R() * kinds.length) | 0];
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      const sc = (tex === sk.egg ? 4 : 1) * rnd(R, 0.7, 2.4) * (1.2 - depth);
      s.scale.set(R() < 0.5 ? -sc : sc, sc);
      s.rotation = rnd(R, 0, Math.PI * 2);
      s.alpha = 1 - depth * 0.45;
      // Further away: dimmer and more purple.
      const k = 1 - depth * 0.45;
      s.tint = (Math.round(255 * k) << 16) | (Math.round(215 * k) << 8) | Math.round(255 * Math.min(1, k + 0.25));
      layer.addChild(s);
      this.floaters.push({ s, depth, x: rnd(R, -600, S + 600), y: rnd(R, -600, S + 600), vx: rnd(R, -14, 14), vy: rnd(R, -10, 10), vr: rnd(R, -0.5, 0.5), ph: rnd(R, 0, 6) });
    }
  }

  // ---------- His eyes ----------
  // Drawn over the painted ones: a lid-coloured patch underneath, and on it the iris and a
  // pupil that turns towards whoever the camera follows. A blink squashes the eye onto the patch.
  buildEyes(layer) {
    this.eyes = this.world.eyes.map((e, i) => {
      const patch = new Graphics().ellipse(0, 0, e.rx + 2, e.ry + 2).fill(0xf0bf18);
      patch.position.set(e.x, e.y);
      const eye = new Container();
      eye.position.set(e.x, e.y);
      eye.addChild(new Graphics()
        .ellipse(0, 0, e.rx + 5, e.ry + 5).fill(0x2f7d32)
        .ellipse(0, 0, e.rx - 4, e.ry - 4).fill(0x4fb04a)
        .ellipse(0, 0, e.rx * 0.74, e.ry * 0.74).fill(0xdff5d8));
      const pupil = new Graphics()
        .ellipse(0, 0, e.rx * 0.6, e.ry * 0.6).fill(0x0c0c10)
        .circle(-e.rx * 0.2, -e.ry * 0.24, e.rx * 0.16).fill(0xffffff)
        .circle(e.rx * 0.18, e.ry * 0.22, e.rx * 0.07).fill({ color: 0xffffff, alpha: 0.8 });
      eye.addChild(pupil);
      layer.addChild(patch, eye);
      return { e, eye, pupil, px: 0, py: 0, blink: 3 + i * 0.07 };
    });
  }

  // ---------- Solid objects ----------
  add(sprite, x, y, w, h) {
    sprite.position.set(x, y);
    sprite.zIndex = y;
    this.game.layers.objects.addChild(sprite);
    // What it covers on screen: upwards from its foot, whichever end it stands on.
    this.cullables.push({ s: sprite, x0: x - w / 2 - 30, x1: x + w / 2 + 30, y0: y - h - 30, y1: y + 30 });
    this.fading.push({ s: sprite, x0: x - w / 2 + 10, x1: x + w / 2 - 10, y0: y - h + 20, y1: y - 14, alpha: 1 });
    return sprite;
  }

  // The frames a statue shows: Naiwa himself comes recoloured, the others tinted.
  look(o) {
    const sk = this.skins;
    if (o.pose !== 'hero') return { frames: sk[o.pose], tint: TINTS[o.tone] };
    if (o.tone === 6) return { frames: sk.heavy, tint: 0xffffff };
    if (o.tone === 7) return { frames: sk.hero, tint: TINTS[7] };
    // Tones 0–5 are the team colours (skins.js TEAM; 0 is his own).
    return { frames: sk.team(o.tone), tint: 0xffffff };
  }

  placeObjects() {
    const R = this.rand, sk = this.skins;
    const shadows = new Graphics();
    this.game.layers.shadows.addChild(shadows);
    const shade = (x, y, r) => shadows.ellipse(x, y, r, r * 0.42).fill({ color: 0x3a1a05, alpha: 0.3 });
    for (const o of this.layout.objects) {
      if (o.kind === 'statue') {
        const { frames, tint } = this.look(o);
        const tex = frames[(R() * frames.length) | 0];
        const s = new Sprite(tex);
        const sx = o.flip ? -o.scale : o.scale;
        // On its head: the same picture turned over, its crown where the feet would be.
        s.anchor.set(0.5, o.down ? 1 - FEET : FEET);
        s.scale.set(sx, o.down ? -o.scale : o.scale);
        s.tint = tint;
        this.add(s, o.x, o.y, tex.width * o.scale, tex.height * o.scale);
        shade(o.x, o.y, (o.down ? 22 : 40) * o.scale);
        this.statues.push({ s, o, frames, sx, sy: s.scale.y, ph: rnd(R, 0, 6) });
      } else if (o.kind === 'egg') {
        const s = new Sprite(sk.egg);
        s.anchor.set(0.5, 0.94);
        s.scale.set(o.scale);
        s.rotation = rnd(R, -0.12, 0.12);
        this.add(s, o.x, o.y, sk.egg.width * o.scale, sk.egg.height * o.scale);
        shade(o.x, o.y, 17 * o.scale);
      } else if (o.kind === 'laugher') {
        const s = new Sprite(sk.hero[1]);
        s.anchor.set(0.5, FEET);
        s.scale.set(o.scale);
        this.add(s, o.x, o.y, 150 * o.scale, 230 * o.scale);
        shade(o.x, o.y, 40 * o.scale);
        this.laughers.push({ s, o });
      } else if (o.kind === 'totem') {
        // Three of him, each standing on the last one's head, marching out of step.
        const c = new Container();
        this.totem = [];
        let y = 0;
        [1.7, 1.35, 1.05].forEach((sc, i) => {
          const frames = i === 1 ? sk.heavy : i === 2 ? sk.team(2) : sk.hero;
          const s = new Sprite(frames[0]);
          s.anchor.set(0.5, FEET);
          s.scale.set(i % 2 ? -sc : sc, sc);
          s.position.set(0, y);
          y -= frames[0].height * sc * 0.9;
          c.addChild(s);
          this.totem.push({ s, frames, i });
        });
        this.add(c, o.x, o.y, 200, -y + 40);
        shade(o.x, o.y, 64);
        const glow = new Sprite(this.art.glow);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = 0xff4fd8;
        glow.position.set(o.x, o.y + y - 10);
        this.game.layers.lights.addChild(glow);
        this.lights.push(glow);
      }
    }
  }

  // Giant eggs drifting overhead, faint, where the other maps have clouds.
  buildSky(layer) {
    const R = this.rand, S = this.world.size;
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      const s = new Sprite(this.skins.egg);
      s.anchor.set(0.5);
      s.position.set(rnd(R, 0, S), rnd(R, 0, S));
      s.scale.set(rnd(R, 12, 20));
      s.rotation = rnd(R, 0, 6);
      s.alpha = 0.07;
      layer.addChild(s);
      this.clouds.push({ s, vr: rnd(R, -0.08, 0.08) });
    }
  }

  // ---------- Per-frame ----------
  update(dt, view, focus) {
    this.t += dt;
    const t = this.t, world = this.world, fx = this.game.fx;
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    const inView = (x, y, m = 120) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;

    this.far.position.set((cx - world.size / 2) * 0.85, (cy - world.size / 2) * 0.85);
    for (const f of this.floaters) {
      f.x += f.vx * dt; f.y += f.vy * dt;
      const span = world.size + 1200;
      f.x = ((f.x + 600) % span + span) % span - 600;
      f.y = ((f.y + 600) % span + span) % span - 600;
      // Parallax about the map's middle, so the void's far side stays reachable by eye.
      const x = f.x + (cx - world.size / 2) * f.depth, y = f.y + (cy - world.size / 2) * f.depth + Math.sin(t * 0.7 + f.ph) * 14;
      f.s.visible = inView(x, y, 500);
      if (!f.s.visible) continue;
      f.s.position.set(x, y);
      f.s.rotation += f.vr * dt;
    }

    // The eyes follow the first one in focus (the player the camera is on).
    const who = focus[0];
    for (const E of this.eyes) {
      const { e } = E;
      let tx = 0, ty = 0;
      if (who) {
        const dx = who.x - e.x, dy = who.y - e.y, d = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, d / 500);
        tx = (dx / d) * e.rx * 0.34 * reach; ty = (dy / d) * e.ry * 0.34 * reach;
      }
      const k = Math.min(1, dt * 6);
      E.px += (tx - E.px) * k; E.py += (ty - E.py) * k;
      E.pupil.position.set(E.px, E.py);
      E.blink -= dt;
      if (E.blink < -0.16) E.blink = 2.5 + Math.random() * 4;
      // Closing and opening over the last 0.16 s before the next wait.
      E.eye.scale.y = E.blink > 0 ? 1 : Math.max(0.06, Math.abs(E.blink + 0.08) / 0.08);
    }

    const margin = 60;
    for (const c of this.cullables) {
      c.s.visible = c.x1 > view.x0 - margin && c.x0 < view.x1 + margin && c.y1 > view.y0 - margin && c.y0 < view.y1 + margin;
    }
    for (const o of this.fading) {
      let target = 1;
      for (const f of focus) {
        const b = f.focusBox, p = f.fadePad ?? 0;
        if (b) { if (f.y < o.y1 && b.x1 + p > o.x0 && b.x0 - p < o.x1 && b.y1 > o.y0 && b.y0 - p < o.y1) target = Math.min(target, 0.25); }
        else if (f.x > o.x0 - p && f.x < o.x1 + p && f.y > o.y0 - p && f.y < o.y1) target = Math.min(target, 0.45);
      }
      o.alpha += (target - o.alpha) * Math.min(1, dt * 8);
      o.s.alpha = o.alpha;
    }

    // Statues breathe; the marching ones step through the walk cycle on the spot.
    for (const st of this.statues) {
      if (!st.s.visible) continue;
      const b = Math.sin(t * 2.2 + st.ph) * 0.03;
      st.s.scale.set(st.sx * (1 - b), st.sy * (1 + b));
      if (st.o.march) st.s.texture = st.frames[Math.floor(t * 5 + st.ph) % st.frames.length];
    }
    const L = this.skins.laugh;
    for (const { s, o } of this.laughers) {
      if (!s.visible) continue;
      if (L) {
        const tex = L.frames[Math.floor((t + o.phase * 7) * L.fps) % L.frames.length];
        s.texture = tex;
        s.anchor.copyFrom(tex.defaultAnchor);
      }
      s.scale.y = o.scale * (1 + Math.sin(t * 9) * 0.015);
    }
    for (const { s, frames, i } of this.totem ?? []) {
      s.texture = frames[Math.floor(t * 4 + i * 1.3) % frames.length];
      s.rotation = Math.sin(t * 1.6 + i * 2) * 0.05 * i;
    }
    for (const g of this.lights) {
      g.scale.set(1.6 + Math.sin(t * 4) * 0.3);
      g.alpha = 0.5 + Math.sin(t * 4) * 0.2;
    }

    // Bubbles in the milk, and he snores: a Z drifts up from his mouth now and then.
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.25;
      const P = world.puddle, a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.9;
      const x = P.x + Math.cos(a) * P.rx * d, y = P.y + Math.sin(a) * P.ry * d;
      if (inView(x, y) && world.inPuddle(x, y)) fx.ripple(x, y, 0.5 + Math.random() * 0.6);
    }
    this.snoreT -= dt;
    if (this.snoreT <= 0) {
      this.snoreT = 1.4;
      const m = world.tongue;
      if (inView(m.x, m.y, 300)) fx.text(m.x + 40 + Math.random() * 60, m.y - 90, 'Z', 0xffffff, 1 + Math.random() * 0.8);
    }
    for (const c of this.clouds) {
      c.s.x += 16 * dt; c.s.y += 5 * dt;
      c.s.rotation += c.vr * dt;
      if (c.s.x > world.size + 900) c.s.x = -900;
      if (c.s.y > world.size + 900) c.s.y = -900;
    }
  }
}
