// Builds the island scene: water, terrain, props, vegetation and ambient life.
import { Container, Sprite, TilingSprite, Graphics, Texture, CanvasSource } from 'pixi.js';
import { WORLD, H_GRASS, H_ROCK, H_DEEP } from './island.js';
import { mulberry32 } from './noise.js';

export function makeSprite(tex) {
  const s = new Sprite(tex);
  if (tex.anchorHint) s.anchor.set(tex.anchorHint[0], tex.anchorHint[1]);
  return s;
}

function canvasTexture(canvas, resolution = 1) {
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
}

// Paints the big terrain/foam canvases. Heavy (runs once per page load).
export function buildTerrainTextures(island, maxTextureSize) {
  const scale = maxTextureSize >= WORLD ? 1 : 0.5;
  return {
    terrain: canvasTexture(island.paintTerrain(scale), scale),
    foamA: canvasTexture(island.paintFoam(0.5, 0), 0.5),
    foamB: canvasTexture(island.paintFoam(0.5, 1), 0.5),
    minimap: canvasTexture(island.paintMinimap(180)),
  };
}

const rnd = (r, a, b) => a + r() * (b - a);

export class Environment {
  constructor(game, terrainTex) {
    this.game = game;
    const { island, art, layers } = game;
    this.island = island;
    this.art = art;
    this.rand = mulberry32(island.seed + 1234);
    this.t = 0;
    this.cullables = [];
    this.tall = [];
    this.swayers = [];
    this.emitters = [];
    this.lights = [];
    this.occupied = [];
    this.weaponSpots = [];

    this.buildWater(layers.ocean, terrainTex);
    const terrain = new Sprite(terrainTex.terrain);
    terrain.width = terrain.height = WORLD;
    layers.terrain.addChild(terrain);

    this.boat = makeSprite(art.boat);
    this.boat.position.set(island.boat.x, island.boat.y);
    layers.ground.addChild(this.boat);

    this.placeVillage();
    this.placeVegetation();
    this.placeProps();
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

  // ---------- Placement helpers ----------
  isFree(x, y, r) {
    for (const o of this.occupied) {
      const dx = o.x - x, dy = o.y - y, m = o.r + r;
      if (dx * dx + dy * dy < m * m) return false;
    }
    const isl = this.island;
    const d = isl.dock;
    if (x > d.x - 60 - r && x < d.x + d.w + 60 + r && y > d.y - 40 - r && y < d.y + d.h + r) return false;
    if (Math.hypot(x - isl.spawn.x, y - isl.spawn.y) < 140 + r) return false;
    return true;
  }

  find(pred, r, tries = 200) {
    const R = this.rand;
    for (let i = 0; i < tries; i++) {
      const x = rnd(R, 100, WORLD - 100), y = rnd(R, 100, WORLD - 100);
      const h = this.island.heightAt(x, y);
      if (pred(x, y, h) && this.isFree(x, y, r)) return { x, y };
    }
    return null;
  }

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
    if (opts.occupy) this.occupied.push({ x, y, r: opts.occupy });
    return entry;
  }

  addCollider(c) {
    return this.game.statics.add(c);
  }

  // ---------- Village ----------
  placeVillage() {
    const { island, art } = this;
    const v = island.village;
    this.occupied.push({ x: v.x, y: v.y, r: 150 });
    const angles = [-2.35, -1.25, -0.1, 3.0];
    angles.forEach((a, i) => {
      const x = v.x + Math.cos(a) * 255, y = v.y + Math.sin(a) * 200 + 40;
      if (island.heightAt(x, y) < 0.08 || !this.isFree(x, y, 90)) return;
      const hut = makeSprite(art.huts[i % art.huts.length]);
      if (i % 2) hut.scale.x = -1;
      this.addObject(hut, x, y, { tall: true, footH: 70, occupy: 110 });
      this.addCollider({ kind: 'rect', x: x - 96, y: y - 82, w: 192, h: 76 });
      if (i === 1) this.weaponSpots.push({ x: x + 20, y: y + 40, kind: 'shotgun' });
    });
    // Campfire
    this.addCollider({ kind: 'circle', x: v.x, y: v.y, r: 26, blocksBullets: false });
    this.emitters.push({ x: v.x, y: v.y - 6, size: 1.6, rate: 40, acc: 0 });
    this.addLight(v.x, v.y - 14, 4.2, 0xff9c3a);
    // Tiki torches around the plaza and the dock
    const torchSpots = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      torchSpots.push([v.x + Math.cos(a) * 130, v.y + Math.sin(a) * 100]);
    }
    const d = island.dock;
    torchSpots.push([d.x - 26, d.y - 10], [d.x + d.w + 26, d.y - 10]);
    for (const [x, y] of torchSpots) {
      this.addObject(makeSprite(art.torch), x, y, { occupy: 16 });
      this.addCollider({ kind: 'circle', x, y: y - 4, r: 7, blocksBullets: false });
      this.emitters.push({ x, y: y - 72, size: 0.65, rate: 22, acc: 0 });
      this.addLight(x, y - 74, 1.8, 0xffa040);
    }
    // Lookout tower on the hill
    const L = island.lookout;
    if (L.h > 0.3) {
      const tower = makeSprite(art.tower);
      this.addObject(tower, L.x, L.y, { tall: true, footH: 40, occupy: 90 });
      this.addCollider({ kind: 'rect', x: L.x - 52, y: L.y - 46, w: 104, h: 40 });
      const pole = new Container();
      pole.addChild(new Graphics().moveTo(0, 0).lineTo(0, -30).stroke({ width: 3, color: 0x4a2f17 }));
      pole.position.set(L.x, L.y - 236);
      pole.zIndex = L.y + 1;
      this.flag = makeSprite(art.flag);
      this.flag.position.set(1, -28);
      pole.addChild(this.flag);
      this.game.layers.objects.addChild(pole);
      this.weaponSpots.push({ x: L.x, y: L.y + 40, kind: 'smg' });
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

  // ---------- Vegetation ----------
  placeVegetation() {
    const { island, art } = this;
    const R = this.rand;
    const offPath = (x, y) => island.pathAt(x, y) < 0.2;

    for (let i = 0; i < 95; i++) {
      const p = this.find((x, y, h) => h > 0.03 && h < 0.32 && offPath(x, y), 38);
      if (!p) continue;
      const palm = makeSprite(art.palms[(R() * art.palms.length) | 0]);
      const sc = rnd(R, 0.8, 1.15);
      palm.scale.set(R() < 0.5 ? -sc : sc, sc);
      this.addObject(palm, p.x, p.y, { tall: true, sway: 0.025, occupy: 38 });
      this.addCollider({ kind: 'circle', x: p.x, y: p.y - 6, r: 11 * sc });
    }
    for (let i = 0; i < 80; i++) {
      const p = this.find((x, y, h) => h > 0.22 && h < H_ROCK + 0.02 && island.moistAt(x, y) > 0.38 && offPath(x, y), 55);
      if (!p) continue;
      const tree = makeSprite(art.trees[(R() * art.trees.length) | 0]);
      const sc = rnd(R, 0.85, 1.2);
      tree.scale.set(R() < 0.5 ? -sc : sc, sc);
      this.addObject(tree, p.x, p.y, { tall: true, sway: 0.012, occupy: 55 });
      this.addCollider({ kind: 'circle', x: p.x, y: p.y - 8, r: 16 * sc });
    }
    for (let i = 0; i < 160; i++) {
      const p = this.find((x, y, h) => h > H_GRASS && h < H_ROCK && offPath(x, y), 22);
      if (!p) continue;
      const b = makeSprite(art.bushes[(R() * art.bushes.length) | 0]);
      b.scale.set(rnd(R, 0.8, 1.3));
      this.addObject(b, p.x, p.y, { sway: 0.02, occupy: 22 });
    }
    for (let i = 0; i < 420; i++) {
      const x = rnd(R, 100, WORLD - 100), y = rnd(R, 100, WORLD - 100);
      const h = island.heightAt(x, y);
      if (h < H_GRASS + 0.02 || h > H_ROCK || island.pathAt(x, y) > 0.35 || !this.isFree(x, y, 6)) continue;
      const f = makeSprite(art.ferns[(R() * art.ferns.length) | 0]);
      f.scale.set(rnd(R, 0.7, 1.2));
      this.addObject(f, x, y, { sway: 0.09 });
    }
    // Rocks: bigger on the hill, pebbly near the shore.
    for (let i = 0; i < 70; i++) {
      const p = this.find((x, y, h) => h > 0.02 && offPath(x, y), 40);
      if (!p) continue;
      const h = island.heightAt(p.x, p.y);
      const idx = h > H_ROCK - 0.08 ? 3 + ((R() * 4) | 0) : (R() * 4) | 0;
      const rockTex = art.rocks[idx];
      const size = [18, 22, 26, 34, 42, 30, 52][idx];
      const r = makeSprite(rockTex);
      if (R() < 0.5) r.scale.x = -1;
      this.addObject(r, p.x, p.y, { occupy: size + 10, tall: size > 35, footH: size * 0.5 });
      this.addCollider({ kind: 'circle', x: p.x, y: p.y - size * 0.5, r: size * 0.82 });
    }
    // Driftwood on the beach
    for (let i = 0; i < 16; i++) {
      const p = this.find((x, y, h) => h > 0.01 && h < 0.08, 50);
      if (!p) continue;
      const d = makeSprite(art.driftwood[i % 2]);
      if (R() < 0.5) d.scale.x = -1;
      this.addObject(d, p.x, p.y, { occupy: 50 });
      this.addCollider({ kind: 'circle', x: p.x - 22, y: p.y - 4, r: 12, blocksBullets: false });
      this.addCollider({ kind: 'circle', x: p.x + 18, y: p.y - 4, r: 12, blocksBullets: false });
    }
    // A rifle stashed on a remote beach.
    const far = this.find((x, y, h) => h > 0.04 && h < 0.12 && Math.hypot(x - island.spawn.x, y - island.spawn.y) > 1300, 20, 600);
    if (far) this.weaponSpots.push({ x: far.x, y: far.y, kind: 'rifle' });
  }

  // ---------- Destructible props ----------
  placeProps() {
    const { island } = this;
    const R = this.rand;
    const d = island.dock;
    const spots = [
      ['crate', d.x - 70, d.y - 30], ['crate', d.x - 105, d.y - 40], ['barrel', d.x + d.w + 70, d.y - 36],
    ];
    const v = island.village;
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2;
      spots.push([R() < 0.7 ? 'crate' : 'barrel', v.x + Math.cos(a) * rnd(R, 180, 330), v.y + Math.sin(a) * rnd(R, 150, 280)]);
    }
    for (let i = 0; i < 34; i++) {
      const p = this.find((x, y, h) => h > 0.03 && island.pathAt(x, y) < 0.4, 30);
      if (p) spots.push([R() < 0.68 ? 'crate' : 'barrel', p.x, p.y]);
    }
    spots.forEach(([kind, x, y], i) => {
      // The first three sit by the dock, inside the area isFree() reserves.
      if (i >= 3 && !this.isFree(x, y, 22)) return;
      if (!island.isWalkable(x, y)) return;
      this.game.addProp(kind, x, y);
      this.occupied.push({ x, y, r: 28 });
    });
  }

  // ---------- Ambient life ----------
  buildAmbient() {
    const { art, island } = this;
    const R = this.rand;
    const L = this.game.layers;
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const s = makeSprite(art.cloud);
      s.position.set(rnd(R, 0, WORLD), rnd(R, 0, WORLD));
      s.scale.set(rnd(R, 1.8, 3.4), rnd(R, 1.5, 2.6));
      s.alpha = 0.16;
      L.air.addChild(s);
      this.clouds.push(s);
    }
    this.gulls = [];
    for (let i = 0; i < 7; i++) {
      const s = makeSprite(art.gull[0]);
      const sh = makeSprite(art.gull[0]);
      sh.tint = 0x000000; sh.alpha = 0.18;
      L.air.addChild(s);
      L.shadows.addChild(sh);
      this.gulls.push({
        s, sh, cx: rnd(R, 600, WORLD - 600), cy: rnd(R, 600, WORLD - 600), rx: rnd(R, 250, 700), ry: rnd(R, 200, 500),
        a: R() * 6.28, w: rnd(R, 0.08, 0.2) * (R() < 0.5 ? -1 : 1), flap: 0, alt: rnd(R, 80, 140),
      });
    }
    this.butterflies = [];
    for (let i = 0; i < 26; i++) {
      const p = this.find((x, y, h) => h > H_GRASS + 0.03 && h < H_ROCK, 0, 80);
      if (!p) continue;
      const frames = art.butterflies[i % art.butterflies.length];
      const s = makeSprite(frames[0]);
      L.air.addChild(s);
      this.butterflies.push({ s, frames, hx: p.x, hy: p.y, ph: R() * 100, sp: rnd(R, 0.4, 0.9) });
    }
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
