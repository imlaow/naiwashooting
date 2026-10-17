// Builds the island scene: water, terrain, props, vegetation and ambient life.
import { Container, Sprite, TilingSprite, Graphics, Texture, CanvasSource } from 'pixi.js';
import { WORLD, H_DEEP } from './island.js';
import { islandLayout, ROCK_SIZES } from './sim/layoutIsland.js';

export function makeSprite(tex) {
  const s = new Sprite(tex);
  if (tex.anchorHint) s.anchor.set(tex.anchorHint[0], tex.anchorHint[1]);
  return s;
}

function canvasTexture(canvas, resolution = 1) {
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
}

// Paints the big terrain/foam canvases. Heavy (runs once per map). Maps without a coastline
// (the factory) have no foam.
export function buildTerrainTextures(island, maxTextureSize) {
  const scale = maxTextureSize >= WORLD ? 1 : 0.5;
  const tex = {
    terrain: canvasTexture(island.paintTerrain(scale), scale),
    minimap: canvasTexture(island.paintMinimap(180)),
  };
  if (island.paintFoam) {
    tex.foamA = canvasTexture(island.paintFoam(0.5, 0), 0.5);
    tex.foamB = canvasTexture(island.paintFoam(0.5, 1), 0.5);
  }
  return tex;
}

// Draws an island from its layout (sim/layoutIsland.js), which also supplies the colliders, props
// and weapon spots.
export class Environment {
  constructor(game, terrainTex) {
    this.game = game;
    const { island, art, layers } = game;
    this.island = island;
    this.art = art;
    this.layout = islandLayout(island);
    this.weaponSpots = this.layout.weaponSpots;
    this.t = 0;
    this.cullables = [];
    this.tall = [];
    this.swayers = [];
    this.emitters = [];
    this.lights = [];

    this.buildWater(layers.ocean, terrainTex);
    const terrain = new Sprite(terrainTex.terrain);
    terrain.width = terrain.height = WORLD;
    layers.terrain.addChild(terrain);

    this.boat = makeSprite(art.boat);
    this.boat.position.set(island.boat.x, island.boat.y);
    layers.ground.addChild(this.boat);

    for (const c of this.layout.colliders) game.statics.add({ ...c });
    this.placeObjects();
    for (const p of this.layout.props) game.addProp(p.kind, p.x, p.y);
    this.buildAmbient();
  }

  // ---------- Water ----------
  buildWater(layer, tex) {
    const M = 1600;
    const base = new Graphics().rect(-M, -M, WORLD + M * 2, WORLD + M * 2).fill(0x1a6f9c);
    layer.addChild(base);
    this.wavesA = new TilingSprite({ texture: this.art.waves, width: WORLD + M * 2, height: WORLD + M * 2 });
    this.wavesA.position.set(-M, -M);
    this.wavesA.tileScale.set(2.2);
    this.wavesA.alpha = 0.35;
    this.wavesA.tint = 0xbfefff;
    this.wavesB = new TilingSprite({ texture: this.art.waves, width: WORLD + M * 2, height: WORLD + M * 2 });
    this.wavesB.position.set(-M, -M);
    this.wavesB.tileScale.set(3.4, 2.6);
    this.wavesB.alpha = 0.22;
    this.wavesB.tint = 0x8fd8ff;
    layer.addChild(this.wavesA, this.wavesB);

    this.foamA = new Sprite(tex.foamA);
    this.foamB = new Sprite(tex.foamB);
    for (const f of [this.foamA, this.foamB]) { f.width = f.height = WORLD; }
    this.game.layers.foam.addChild(this.foamB, this.foamA);

    this.glints = [];
    for (let i = 0; i < 22; i++) {
      const s = new Sprite(this.art.orb);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.alpha = 0;
      s.scale.set(0.5, 0.22);
      this.game.layers.foam.addChild(s);
      this.glints.push({ s, life: 0, max: 1 });
    }
  }

  // ---------- Objects ----------
  addObject(sprite, x, y, opts = {}) {
    sprite.position.set(x, y);
    sprite.zIndex = y;
    this.game.layers.objects.addChild(sprite);
    const b = sprite.getLocalBounds();
    const entry = {
      s: sprite,
      x0: x + b.minX * sprite.scale.x - 20, x1: x + b.maxX * sprite.scale.x + 20,
      y0: y + b.minY * sprite.scale.y - 20, y1: y + b.maxY * sprite.scale.y + 20,
    };
    if (sprite.scale.x < 0) { const t = entry.x0; entry.x0 = x - (entry.x1 - x); entry.x1 = x + (x - t); }
    this.cullables.push(entry);
    if (opts.tall) {
      // Fade when something stands behind it.
      this.tall.push({ s: sprite, x, y, x0: entry.x0 + 30, x1: entry.x1 - 30, y0: entry.y0 + 20, y1: y - (opts.footH ?? 10), alpha: 1 });
    }
    if (opts.sway) this.swayers.push({ s: sprite, amp: opts.sway, ph: x * 0.013 + y * 0.007 });
    return entry;
  }

  // Draws the layout's objects: village, vegetation, rocks and driftwood.
  placeObjects() {
    const { art } = this;
    for (const o of this.layout.objects) {
      const { x, y } = o;
      switch (o.kind) {
        case 'hut': {
          const hut = makeSprite(art.huts[o.variant]);
          if (o.flip) hut.scale.x = -1;
          this.addObject(hut, x, y, { tall: true, footH: 70 });
          break;
        }
        case 'campfire':
          this.emitters.push({ x, y: y - 6, size: 1.6, rate: 40, acc: 0 });
          this.addLight(x, y - 14, 4.2, 0xff9c3a);
          break;
        case 'torch':
          this.addObject(makeSprite(art.torch), x, y);
          this.emitters.push({ x, y: y - 72, size: 0.65, rate: 22, acc: 0 });
          this.addLight(x, y - 74, 1.8, 0xffa040);
          break;
        case 'tower': {
          this.addObject(makeSprite(art.tower), x, y, { tall: true, footH: 40 });
          const pole = new Container();
          pole.addChild(new Graphics().moveTo(0, 0).lineTo(0, -30).stroke({ width: 3, color: 0x4a2f17 }));
          pole.position.set(x, y - 236);
          pole.zIndex = y + 1;
          this.flag = makeSprite(art.flag);
          this.flag.position.set(1, -28);
          pole.addChild(this.flag);
          this.game.layers.objects.addChild(pole);
          break;
        }
        case 'palm': case 'tree': {
          const tree = makeSprite((o.kind === 'palm' ? art.palms : art.trees)[o.variant]);
          tree.scale.set(o.flip ? -o.scale : o.scale, o.scale);
          this.addObject(tree, x, y, { tall: true, sway: o.kind === 'palm' ? 0.025 : 0.012 });
          break;
        }
        case 'bush': case 'fern': {
          const b = makeSprite((o.kind === 'bush' ? art.bushes : art.ferns)[o.variant]);
          b.scale.set(o.scale);
          this.addObject(b, x, y, { sway: o.kind === 'bush' ? 0.02 : 0.09 });
          break;
        }
        case 'rock': {
          const size = ROCK_SIZES[o.variant];
          const r = makeSprite(art.rocks[o.variant]);
          if (o.flip) r.scale.x = -1;
          this.addObject(r, x, y, { tall: size > 35, footH: size * 0.5 });
          break;
        }
        case 'driftwood': {
          const d = makeSprite(art.driftwood[o.variant]);
          if (o.flip) d.scale.x = -1;
          this.addObject(d, x, y);
          break;
        }
      }
    }
  }

  addLight(x, y, scale, tint) {
    const s = new Sprite(this.art.glow);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = tint;
    s.position.set(x, y);
    s.scale.set(scale);
    s.alpha = 0.45;
    this.game.layers.lights.addChild(s);
    this.lights.push({ s, base: scale, ph: Math.random() * 10 });
  }

  // ---------- Ambient life ----------
  buildAmbient() {
    const { art } = this;
    const { clouds, gulls, butterflies } = this.layout.decor;
    const L = this.game.layers;
    this.clouds = clouds.map((c) => {
      const s = makeSprite(art.cloud);
      s.position.set(c.x, c.y);
      s.scale.set(c.sx, c.sy);
      s.alpha = 0.16;
      L.air.addChild(s);
      return s;
    });
    this.gulls = gulls.map((g) => {
      const s = makeSprite(art.gull[0]);
      const sh = makeSprite(art.gull[0]);
      sh.tint = 0x000000; sh.alpha = 0.18;
      L.air.addChild(s);
      L.shadows.addChild(sh);
      return { s, sh, ...g, flap: 0 };
    });
    this.butterflies = butterflies.map((b) => {
      const frames = art.butterflies[b.variant];
      const s = makeSprite(frames[0]);
      L.air.addChild(s);
      return { s, frames, hx: b.x, hy: b.y, ph: b.ph, sp: b.sp };
    });
  }

  // ---------- Per-frame ----------
  update(dt, view, focus) {
    this.t += dt;
    const t = this.t;
    this.wavesA.tilePosition.set(t * 9, t * 5);
    this.wavesB.tilePosition.set(-t * 6, t * 11);
    // Foam bands pulse out of phase so waves appear to roll in.
    const ph = (t * 0.45) % 1;
    this.foamA.alpha = 0.55 + 0.45 * Math.sin(ph * Math.PI * 2);
    this.foamB.alpha = 0.3 + 0.3 * Math.sin(ph * Math.PI * 2 - 1.9);
    this.boat.rotation = Math.sin(t * 0.9) * 0.035;
    this.boat.y = this.island.boat.y + Math.sin(t * 1.3) * 2;
    if (this.flag) {
      this.flag.scale.x = 0.85 + Math.sin(t * 6) * 0.15;
      this.flag.skew.y = Math.sin(t * 4.3) * 0.12;
    }

    for (const g of this.glints) {
      g.life -= dt;
      if (g.life <= 0) {
        g.max = g.life = 0.4 + Math.random() * 0.8;
        g.s.x = view.x0 + Math.random() * (view.x1 - view.x0);
        g.s.y = view.y0 + Math.random() * (view.y1 - view.y0);
        g.ok = this.island.heightAt(g.s.x, g.s.y) < H_DEEP + 0.03;
      }
      const k = g.life / g.max;
      g.s.alpha = g.ok ? Math.sin(k * Math.PI) * 0.55 : 0;
      g.s.scale.x = 0.3 + Math.sin(k * Math.PI) * 0.4;
    }

    const margin = 60;
    for (const c of this.cullables) {
      c.s.visible = c.x1 > view.x0 - margin && c.x0 < view.x1 + margin && c.y1 > view.y0 - margin && c.y0 < view.y1 + margin;
    }
    for (const w of this.swayers) {
      if (w.s.visible) w.s.skew.x = Math.sin(t * 1.7 + w.ph) * w.amp + Math.sin(t * 0.6 + w.ph * 0.3) * w.amp * 0.5;
    }
    for (const o of this.tall) {
      // A focus with a body box (the laughing hero) fades trees further so he stays visible.
      // fadePad widens the zone sideways and upward (not downward: standing in front needs no fade).
      let target = 1;
      for (const f of focus) {
        const b = f.focusBox, p = f.fadePad ?? 0;
        if (b) { if (f.y < o.y && b.x1 + p > o.x0 && b.x0 - p < o.x1 && b.y1 > o.y0 && b.y0 - p < o.y1) target = Math.min(target, 0.2); }
        else if (f.x > o.x0 - p && f.x < o.x1 + p && f.y > o.y0 - p && f.y < o.y1) target = Math.min(target, 0.42);
      }
      o.alpha += (target - o.alpha) * Math.min(1, dt * 8);
      o.s.alpha = o.alpha;
    }
    for (const e of this.emitters) {
      if (e.x < view.x0 - 100 || e.x > view.x1 + 100 || e.y < view.y0 - 100 || e.y > view.y1 + 100) continue;
      e.acc += dt * e.rate;
      while (e.acc > 1) { e.acc -= 1; this.game.fx.flame(e.x, e.y, e.size); }
    }
    for (const l of this.lights) {
      const f = Math.sin(t * 9 + l.ph) * 0.05 + Math.sin(t * 23 + l.ph * 2) * 0.04;
      l.s.scale.set(l.base * (1 + f));
      l.s.alpha = 0.4 + f;
    }
    for (const c of this.clouds) {
      c.x += 14 * dt; c.y += 5 * dt;
      if (c.x > WORLD + 600) c.x = -600;
      if (c.y > WORLD + 500) c.y = -500;
    }
    for (const g of this.gulls) {
      g.a += g.w * dt;
      const x = g.cx + Math.cos(g.a) * g.rx, y = g.cy + Math.sin(g.a) * g.ry;
      const vx = -Math.sin(g.a) * g.rx * g.w, vy = Math.cos(g.a) * g.ry * g.w;
      g.flap += dt;
      const gliding = Math.sin(t * 0.5 + g.cx) > 0.3;
      const frame = gliding ? 0 : Math.floor(g.flap / 0.16) % 2;
      g.s.texture = g.sh.texture = this.art.gull[frame];
      g.s.position.set(x, y - g.alt);
      g.s.rotation = Math.atan2(vy, vx) + Math.PI / 2;
      g.sh.position.set(x + g.alt * 0.5, y + g.alt * 0.25);
      g.sh.rotation = g.s.rotation;
    }
    for (const b of this.butterflies) {
      const tt = t * b.sp + b.ph;
      b.s.x = b.hx + Math.sin(tt * 1.3) * 60 + Math.sin(tt * 3.1) * 14;
      b.s.y = b.hy + Math.cos(tt * 0.9) * 40 + Math.sin(tt * 4.3) * 8 - 20;
      b.s.texture = b.frames[Math.floor(t * 14 + b.ph) % 2];
    }
  }
}
