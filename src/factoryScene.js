// Builds the factory scene from its layout (sim/layoutFactory.js): floor, perimeter wall,
// machines, belts that move, smoke, lamps and a milk canal. Plays the same role as Environment
// in world.js. Its own seeded RNG only places decoration (cartons, lamp phases, the trees
// outside, clouds, steam vents).
import { Sprite, TilingSprite, Graphics } from 'pixi.js';
import { WORLD } from './island.js';
import { WALL0, WALL1, WALL_T, GATE, CANAL } from './factory.js';
import { factoryArt, building } from './factoryArt.js';
import { makeSprite } from './world.js';
import { mulberry32 } from './noise.js';
import { factoryLayout } from './sim/layoutFactory.js';

const WALL_H = 64; // how tall the perimeter wall stands
const rnd = (r, a, b) => a + r() * (b - a);

export class FactoryEnvironment {
  constructor(game, terrainTex) {
    this.game = game;
    const { island: fac, art, layers } = game;
    this.fac = fac;
    this.art = art;
    this.fa = factoryArt();
    this.layout = factoryLayout(fac);
    this.rand = mulberry32(fac.seed + 1234);
    this.t = 0;
    this.cullables = [];
    this.fading = [];
    this.lights = [];
    this.lamps = [];
    this.weaponSpots = this.layout.weaponSpots;

    for (const c of this.layout.colliders) game.statics.add({ ...c });
    this.buildGround(layers, terrainTex);
    this.buildWalls(layers.objects);
    this.buildBelts(layers);
    this.placeObjects();
    for (const p of this.layout.props) game.addProp(p.kind, p.x, p.y);
    this.buildOutside();
    this.buildAmbient();
  }

  // ---------- Ground ----------
  buildGround(layers, tex) {
    const M = 1600;
    const grass = new TilingSprite({ texture: this.fa.grass, width: WORLD + M * 2, height: WORLD + M * 2 });
    grass.position.set(-M, -M);
    layers.ocean.addChild(grass);
    // The access road out of the gate.
    const road = new Graphics()
      .rect(GATE.x - 40, WALL1 - 10, GATE.w + 80, M + 400).fill(0x4a4e52)
      .rect(GATE.x - 46, WALL1 - 10, 6, M + 400).fill(0xd6d3cb)
      .rect(GATE.x + GATE.w + 40, WALL1 - 10, 6, M + 400).fill(0xd6d3cb);
    for (let y = WALL1 + 80; y < WORLD + M; y += 120) road.rect(GATE.x + GATE.w / 2 - 4, y, 8, 60).fill(0xf2c230);
    layers.ocean.addChild(road);
    const terrain = new Sprite(tex.terrain);
    terrain.width = terrain.height = WORLD;
    layers.terrain.addChild(terrain);
  }

  // ---------- Perimeter wall ----------
  // Concrete panels with a coping on top. The north wall and the side walls sit behind
  // everything; the south wall stands in front of whoever walks along it and fades for them.
  buildWalls(layer) {
    const len = WALL1 - WALL0;
    const face = (g, x, y, w) => {
      g.rect(x, y, w, WALL_H).fill(0x9c978c);
      for (let px = x; px < x + w; px += 120) g.rect(px, y, 3, WALL_H).fill({ color: 0x000000, alpha: 0.22 });
      g.rect(x, y + WALL_H - 10, w, 10).fill({ color: 0x000000, alpha: 0.18 });
    };
    const top = (g, x, y, w, h) => g.rect(x, y, w, h).fill(0xc9c4b8).rect(x, y, w, 4).fill({ color: 0xffffff, alpha: 0.35 });

    const north = new Graphics();
    top(north, WALL0, WALL0 - WALL_H, len, WALL_T);
    face(north, WALL0, WALL0 + WALL_T - WALL_H, len);
    this.wire(north, WALL0, WALL0 - WALL_H, len);
    north.zIndex = WALL0 + WALL_T;
    layer.addChild(north);

    for (const x of [WALL0, WALL1 - WALL_T]) {
      const side = new Graphics();
      top(side, x, WALL0 - WALL_H, WALL_T, len);
      side.zIndex = 0;
      layer.addChild(side);
    }

    // South wall, in two halves around the gate.
    const south = new Graphics();
    const sy = WALL1 - WALL_T;
    for (const [x0, x1] of [[WALL0, GATE.x], [GATE.x + GATE.w, WALL1]]) {
      top(south, x0, sy - WALL_H, x1 - x0, WALL_T);
      face(south, x0, sy + WALL_T - WALL_H, x1 - x0);
      this.wire(south, x0, sy - WALL_H, x1 - x0);
    }
    // Sliding gate: steel bars between two posts, with a hazard stripe along the bottom.
    for (let x = GATE.x + 6; x < GATE.x + GATE.w; x += 14) south.rect(x, sy - 30, 5, WALL_T + 28).fill(0x5b6068);
    south.rect(GATE.x, sy - 34, GATE.w, 7).fill(0x4b5056).rect(GATE.x, sy + WALL_T - 10, GATE.w, 8).fill(0xf2c230);
    for (const x of [GATE.x - 14, GATE.x + GATE.w - 14]) south.rect(x, sy - WALL_H - 20, 28, WALL_H + WALL_T + 20).fill(0x6b6660).rect(x, sy - WALL_H - 20, 28, 6).fill(0xe53e3e);
    south.zIndex = WALL1;
    layer.addChild(south);
    this.fading.push({ s: south, x0: WALL0, x1: WALL1, y0: sy - WALL_H - 90, y1: WALL1, alpha: 1 });
  }

  // Barbed wire along the top of a wall.
  wire(g, x, y, w) {
    for (let px = x + 30; px < x + w; px += 120) g.rect(px, y - 18, 3, 20).fill(0x3d3b37);
    g.moveTo(x, y - 14).lineTo(x + w, y - 14).stroke({ width: 1.5, color: 0x55524c });
    for (let px = x; px < x + w; px += 9) g.moveTo(px, y - 18).lineTo(px + 6, y - 10).stroke({ width: 1.2, color: 0x6b6862 });
  }

  // ---------- Conveyor belts ----------
  buildBelts(layers) {
    this.belts = [];
    for (const b of this.fac.belts) {
      const s = new TilingSprite({ texture: this.fa.belt, width: b.w, height: b.h });
      s.position.set(b.x, b.y);
      layers.ground.addChild(s);
      // Cartons ride along it, ducking into the machines on the way.
      const cartons = [];
      for (let x = 30; x < b.w; x += rnd(this.rand, 90, 170)) {
        const c = makeSprite(this.fa.cartons[this.rand() < 0.5 ? 0 : 1]);
        c.zIndex = b.y + b.h / 2 + 12;
        layers.objects.addChild(c);
        cartons.push({ s: c, u: x });
      }
      // Machines straddling this belt, by x: cartons inside one are hidden.
      const machines = this.layout.objects.filter((o) => o.kind === 'machine' && o.foot.y < b.y && o.foot.y + o.foot.h > b.y + b.h).map((o) => o.x);
      this.belts.push({ b, s, cartons, machines });
    }
  }

  // ---------- Solid objects ----------
  addObject(sprite, x, y, opts = {}) {
    sprite.position.set(x, y);
    sprite.zIndex = y;
    this.game.layers.objects.addChild(sprite);
    const b = sprite.getLocalBounds();
    const sx = Math.abs(sprite.scale.x);
    const x0 = sprite.scale.x < 0 ? x - b.maxX * sx : x + b.minX * sx;
    const x1 = sprite.scale.x < 0 ? x - b.minX * sx : x + b.maxX * sx;
    const entry = { s: sprite, x0: x0 - 20, x1: x1 + 20, y0: y + b.minY - 20, y1: y + b.maxY + 20 };
    this.cullables.push(entry);
    // Fade when someone walks behind it.
    if (opts.fade) this.fading.push({ s: sprite, x0: x0 + 10, x1: x1 - 10, y0: y + b.minY + 20, y1: y - (opts.footH ?? 20), alpha: 1 });
    return entry;
  }

  placeObjects() {
    const { fac, fa } = this;
    for (const o of this.layout.objects) {
      let s = null, opts = { fade: true };
      switch (o.kind) {
        case 'pillar': s = makeSprite(fa.pillar); opts = { fade: true, footH: 10 }; break;
        case 'machine':
          s = makeSprite(fa.machines[o.variant]);
          this.lamps.push(this.addLight(o.x + 72, o.y - 178, 0.9, 0xfbbf24, 'blink'));
          break;
        case 'silo': s = makeSprite(fa.silos[o.variant]); opts = { fade: true, footH: 60 }; break;
        case 'tower':
          s = makeSprite(fa.tower); opts = { fade: true, footH: 40 };
          this.lamps.push(this.addLight(o.x, o.y - 352, 1.2, 0xff3030, 'beacon'));
          break;
        case 'chimney': s = makeSprite(fa.chimney); opts = { fade: true, footH: 60 }; break;
        case 'container': s = makeSprite(fa.containers[o.variant]); opts = { fade: true, footH: 50 }; break;
        case 'truck': s = makeSprite(fa.truck); if (o.flip) s.scale.x = -1; opts = { fade: true, footH: 50 }; break;
        case 'pallet': s = makeSprite(fa.pallet); opts = {}; break;
        case 'forklift': s = makeSprite(fa.forklift); opts = {}; break;
        case 'warehouse': case 'boiler': {
          const b = o.kind === 'warehouse' ? fac.warehouse : fac.boiler;
          s = makeSprite(building(b.w, b.h, b.H, o.kind));
          this.addObject(s, b.x, b.y + b.h, { fade: true, footH: 30 });
          if (o.kind === 'boiler') {
            // The furnace mouth glows and flickers.
            const fx = b.x + b.w / 2, fy = b.y + b.h - 20;
            this.addLight(fx, fy, 3.2, 0xff8a2a);
            this.furnace = { x: fx, y: fy };
          }
          continue;
        }
        default: continue;
      }
      this.addObject(s, o.x, o.y, opts);
    }
  }

  addLight(x, y, scale, tint, mode = 'flicker') {
    const s = new Sprite(this.art.glow);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = tint;
    s.position.set(x, y);
    s.scale.set(scale);
    s.alpha = 0.45;
    this.game.layers.lights.addChild(s);
    const l = { s, base: scale, ph: this.rand() * 10, mode };
    this.lights.push(l);
    return l;
  }

  // ---------- Outside the fence ----------
  buildOutside() {
    const { art } = this;
    const R = this.rand;
    const L = this.game.layers;
    for (let i = 0; i < 70; i++) {
      // A belt of trees around the compound, kept off the road.
      const side = i % 4;
      const along = rnd(R, -300, WORLD + 300), out = rnd(R, 90, 520);
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? WALL0 - out : WALL1 + out;
      const y = side === 0 ? WALL0 - out - 60 : side === 1 ? WALL1 + out : along;
      if (side === 1 && x > GATE.x - 160 && x < GATE.x + GATE.w + 160) continue;
      const tree = makeSprite(R() < 0.6 ? art.trees[(R() * art.trees.length) | 0] : art.bushes[(R() * art.bushes.length) | 0]);
      const sc = rnd(R, 0.85, 1.2);
      tree.scale.set(R() < 0.5 ? -sc : sc, sc);
      this.addObject(tree, x, y);
    }
    for (const [x, y] of [[GATE.x - 70, WALL1 + 40], [GATE.x + GATE.w + 70, WALL1 + 40], [GATE.x - 70, WALL1 - 120], [GATE.x + GATE.w + 70, WALL1 - 120]]) {
      this.addObject(makeSprite(this.fa.cone), x, y);
    }
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const s = makeSprite(art.cloud);
      s.position.set(rnd(R, 0, WORLD), rnd(R, 0, WORLD));
      s.scale.set(rnd(R, 1.8, 3.4), rnd(R, 1.5, 2.6));
      s.alpha = 0.14;
      L.air.addChild(s);
      this.clouds.push(s);
    }
  }

  // ---------- Ambient ----------
  buildAmbient() {
    const L = this.game.layers;
    // The milk canal flows: a strip of the ocean swell texture between each pair of bridges.
    this.flows = [];
    const cuts = [CANAL.x, ...this.fac.bridges.flatMap((b) => [b.x, b.x + b.w]), CANAL.x + CANAL.w];
    for (let i = 0; i < cuts.length; i += 2) {
      const s = new TilingSprite({ texture: this.art.waves, width: cuts[i + 1] - cuts[i], height: CANAL.h - 16 });
      s.position.set(cuts[i], CANAL.y + 8);
      s.tileScale.set(1.2, 0.5);
      s.tint = 0xd9cfb8;
      s.alpha = 0.5;
      L.foam.addChild(s);
      this.flows.push(s);
    }
    // Steam vents in the hall floor.
    const R = this.rand;
    this.vents = [];
    for (let i = 0; i < 6; i++) {
      const x = rnd(R, 760, 2440), y = rnd(R, 1000, 1880);
      if (!this.fac.isFree(x, y, 20)) continue;
      this.vents.push({ x, y, t: rnd(R, 0, 6) });
    }
    this.smokeT = 0;
    this.sparkT = 1;
  }

  // ---------- Per-frame ----------
  update(dt, view, focus) {
    this.t += dt;
    const t = this.t;
    const fx = this.game.fx;
    const inView = (x, y, m = 120) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;

    for (const { b, s, cartons, machines } of this.belts) {
      s.tilePosition.x = (s.tilePosition.x + b.dir * 110 * dt) % 64;
      for (const c of cartons) {
        c.u = (c.u + b.dir * 110 * dt + b.w) % b.w;
        c.s.position.set(b.x + c.u, b.y + b.h / 2 + 12);
        // Hidden inside a machine.
        c.s.visible = inView(c.s.x, c.s.y) && !machines.some((mx) => Math.abs(mx - c.s.x) < 66);
      }
    }
    for (const f of this.flows) f.tilePosition.x += 26 * dt;

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

    for (const l of this.lights) {
      if (l.mode === 'blink') {
        const on = Math.sin(t * 5 + l.ph) > 0.2;
        l.s.alpha = on ? 0.6 : 0.08;
      } else if (l.mode === 'beacon') {
        l.s.alpha = 0.25 + Math.max(0, Math.sin(t * 3 + l.ph)) * 0.6;
      } else {
        const f = Math.sin(t * 9 + l.ph) * 0.06 + Math.sin(t * 23 + l.ph * 2) * 0.05;
        l.s.scale.set(l.base * (1 + f));
        l.s.alpha = 0.45 + f;
      }
    }

    // Chimney smoke, furnace embers, steam and the odd welding spark from a machine.
    const ch = this.fac.chimney;
    this.smokeT -= dt;
    if (this.smokeT <= 0 && inView(ch.x, ch.y - 420, 600)) {
      this.smokeT = 0.12;
      fx.spawn({ tex: this.art.soft, x: ch.x + rnd(Math.random, -12, 12), y: ch.y - 410, vx: rnd(Math.random, 10, 30), vy: rnd(Math.random, -60, -35), life: rnd(Math.random, 2.4, 3.6), s0: 0.6, s1: rnd(Math.random, 3, 4.5), a0: 0.45, a1: 0, tint: 0x6b6764, drag: 0.4 });
    }
    if (this.furnace && inView(this.furnace.x, this.furnace.y) && Math.random() < dt * 6) {
      fx.flame(this.furnace.x + rnd(Math.random, -30, 30), this.furnace.y, 0.7);
    }
    for (const v of this.vents) {
      v.t -= dt;
      if (v.t > 0 || !inView(v.x, v.y)) continue;
      if (v.t < -1.2) v.t = rnd(Math.random, 3, 7);
      fx.spawn({ tex: this.art.soft, x: v.x + rnd(Math.random, -6, 6), y: v.y, vx: rnd(Math.random, -12, 12), vy: rnd(Math.random, -80, -50), life: rnd(Math.random, 0.7, 1.1), s0: 0.4, s1: 1.8, a0: 0.5, a1: 0, tint: 0xf4f4f4, drag: 1 });
    }
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = rnd(Math.random, 0.6, 1.8);
      const machines = this.layout.objects.filter((o) => o.kind === 'machine' && inView(o.x, o.y));
      const m = machines[(Math.random() * machines.length) | 0];
      if (m) fx.sparks(m.x + rnd(Math.random, -60, 60), m.y - 10, -Math.PI / 2, 0xffe08a, 8);
    }
    for (const c of this.clouds) {
      c.x += 12 * dt; c.y += 4 * dt;
      if (c.x > WORLD + 600) c.x = -600;
      if (c.y > WORLD + 500) c.y = -500;
    }
  }
}
