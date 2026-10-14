// The milk-and-egg factory: a walled compound with a production hall full of conveyor belts,
// a milk canal you have to wade across, a tank farm, a warehouse, a boiler house and a loading
// yard by the gate. It has the same terrain interface as Island (see maps.js) plus `drift` for
// the belts. This file holds the layout and paints the floor; factoryScene.js builds the Pixi
// scene from it.
import { WORLD } from './island.js';
import { mulberry32, makeNoise, fbm, hash2 } from './noise.js';

// The perimeter wall's footprint runs along these lines; you can walk between IN0 and IN1.
export const WALL0 = 208, WALL1 = WORLD - 208, WALL_T = 32;
const IN0 = 262, IN1 = WORLD - 262;

export const HALL = { x: 680, y: 900, w: 1840, h: 1060 };
export const CANAL = { x: WALL0 + WALL_T, y: 2160, w: WALL1 - WALL0 - WALL_T * 2, h: 100 };
export const GATE = { x: 1480, w: 240 };
const BELT_SPEED = 110;

const inRect = (x, y, r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;

export class Factory {
  constructor(seed) {
    this.seed = seed;
    this.firstWaveKey = 'game.firstWaveFactory';
    this.rand = mulberry32(seed);
    // Everything solid: { kind, x, y, foot } where (x, y) is where the sprite stands and
    // foot is its collider, { kind: 'rect', x, y, w, h } or { kind: 'circle', x, y, r }.
    this.objects = [];
    this.props = [];
    this.weaponSpots = [];
    this.plan();
  }

  // ---------- Terrain interface ----------
  heightAt() { return 0.3; }
  inDock() { return false; }

  isWalkable(x, y) {
    return x > IN0 && x < IN1 && y > IN0 && y < IN1;
  }

  inCanal(x, y) {
    return inRect(x, y, CANAL) && !this.bridges.some((b) => inRect(x, y, b));
  }

  isWading(x, y) {
    return this.inCanal(x, y);
  }

  // Eggs roll off the production line: early in a wave they turn up in the hall.
  goodSpawn(type, x, y) {
    return type !== 'egg' || inRect(x, y, HALL);
  }

  dustColor(x, y) {
    return inRect(x, y, HALL) ? 0x9aa69c : 0xbdb8ae;
  }

  // Conveyor belts carry whatever stands on them.
  drift(x, y) {
    for (const b of this.belts) if (inRect(x, y, b)) return b.dir * BELT_SPEED;
    return 0;
  }

  // ---------- Layout ----------
  add(kind, x, y, foot, extra = {}) {
    const o = { kind, x, y, foot, ...extra };
    this.objects.push(o);
    return o;
  }

  rect(x, y, w, h) { return { kind: 'rect', x, y, w, h }; }
  circle(x, y, r) { return { kind: 'circle', x, y, r }; }

  // True when a circle of radius r at (x, y) is clear of every solid, belt, the canal and the gate.
  isFree(x, y, r) {
    if (x < IN0 + r || x > IN1 - r || y < IN0 + r || y > IN1 - r) return false;
    for (const o of this.objects) if (hits(o.foot, x, y, r + 14)) return false;
    for (const b of this.belts) if (hits({ kind: 'rect', ...b }, x, y, r + 10)) return false;
    if (hits({ kind: 'rect', ...CANAL }, x, y, r + 16)) return false;
    for (const p of this.props) if (Math.hypot(p[1] - x, p[2] - y) < r + 34) return false;
    if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 150 + r) return false;
    return true;
  }

  plan() {
    const R = this.rand;
    const H = HALL;
    this.spawn = { x: GATE.x + GATE.w / 2, y: WALL1 - 190 };
    this.village = { x: H.x + H.w / 2, y: H.y + H.h / 2 };
    this.bridges = [{ x: 740, w: 150 }, { x: 2310, w: 150 }].map((b) => ({ x: b.x, y: CANAL.y - 12, w: b.w, h: CANAL.h + 24 }));

    // Production hall: two belts running opposite ways, machines straddling them, steel columns.
    this.belts = [
      { x: H.x + 170, y: H.y + 290, w: H.w - 340, h: 56, dir: 1 },
      { x: H.x + 170, y: H.y + 700, w: H.w - 340, h: 56, dir: -1 },
    ];
    const beltA = this.belts[0], beltB = this.belts[1];
    for (const [belt, xs] of [[beltA, [0.2, 0.52, 0.84]], [beltB, [0.36, 0.68]]]) {
      xs.forEach((f, i) => {
        const x = belt.x + belt.w * f, y = belt.y + belt.h + 4;
        this.add('machine', x, y, this.rect(x - 78, y - 100, 156, 100), { variant: i % 2 });
      });
    }
    for (let i = 0; i <= 5; i++) {
      const x = H.x + (H.w / 5) * i;
      this.add('pillar', x, H.y, this.circle(x, H.y - 4, 17));
      this.add('pillar', x, H.y + H.h, this.circle(x, H.y + H.h - 4, 17));
    }
    for (const fx of [0.3, 0.7]) {
      const x = H.x + H.w * fx, y = H.y + H.h * 0.5 + 10;
      this.add('pillar', x, y, this.circle(x, y - 4, 17));
    }
    // Egg-carton pallets by the belt ends.
    for (const [x, y] of [[H.x + 90, beltA.y + 30], [H.x + H.w - 90, beltA.y + 30], [H.x + 90, beltB.y + 30], [H.x + H.w - 90, beltB.y + 30], [H.x + 380, H.y + 560], [H.x + H.w - 380, H.y + 470]]) {
      this.add('pallet', x, y, this.circle(x, y - 14, 30));
    }
    this.add('forklift', H.x + H.w * 0.5 + 40, H.y + 150, this.rect(H.x + H.w * 0.5 + 4, H.y + 112, 74, 40));

    // Tank farm along the north wall, a water tower (the lookout) and the chimney.
    this.tanks = [];
    [560, 820, 1080, 1340].forEach((x, i) => {
      const y = 700 + (i % 2) * 40;
      this.add('silo', x, y, this.rect(x - 76, y - 64, 152, 60), { variant: i });
      this.tanks.push({ x, y: y - 40 });
    });
    const L = { x: 2030, y: 640 };
    this.add('tower', L.x, L.y, this.rect(L.x - 58, L.y - 48, 116, 42));
    this.lookout = { x: L.x, y: L.y, h: 1 };
    this.weaponSpots.push({ x: L.x, y: L.y + 44, kind: 'smg' });
    this.chimney = { x: 2560, y: 560 };
    this.add('chimney', this.chimney.x, this.chimney.y, this.circle(this.chimney.x, this.chimney.y - 30, 44));

    // Warehouse (west) and boiler house (east): solid blocks you fight around.
    this.warehouse = { x: 330, y: 1060, w: 300, h: 420, H: 150 };
    this.add('warehouse', 0, 0, this.rect(this.warehouse.x, this.warehouse.y, this.warehouse.w, this.warehouse.h));
    this.weaponSpots.push({ x: this.warehouse.x + this.warehouse.w / 2, y: this.warehouse.y + this.warehouse.h + 50, kind: 'shotgun' });
    this.boiler = { x: 2610, y: 1120, w: 300, h: 300, H: 130 };
    this.add('boiler', 0, 0, this.rect(this.boiler.x, this.boiler.y, this.boiler.w, this.boiler.h));
    // The rifle waits in the far corner behind the tanks.
    this.weaponSpots.push({ x: 360, y: 380, kind: 'rifle' });

    // Loading yard: containers, a lorry, stacked pallets.
    const containers = [[470, 2440, 0], [470, 2600, 1], [2700, 2470, 2], [1060, 2830, 3]];
    for (const [x, y, c] of containers) this.add('container', x, y, this.rect(x - 122, y - 58, 244, 58), { variant: c });
    this.add('truck', 2240, 2700, this.rect(2240 - 150, 2700 - 62, 300, 62));
    this.add('truck', 860, 2560, this.rect(860 - 150, 2560 - 62, 300, 62), { flip: true });
    for (const [x, y] of [[1980, 2420], [2060, 2440], [1240, 2440], [2560, 2860]]) this.add('pallet', x, y, this.circle(x, y - 14, 30));
    // Between the canal and the hall.
    for (const [x, y] of [[1180, 2060], [2020, 2070]]) this.add('pallet', x, y, this.circle(x, y - 14, 30));

    // Crates and red barrels: a few on purpose, the rest scattered.
    const fixed = [
      ['barrel', this.boiler.x - 50, this.boiler.y + 140], ['barrel', this.boiler.x - 40, this.boiler.y + 200], ['barrel', this.boiler.x + 60, this.boiler.y + this.boiler.h + 60],
      ['crate', this.spawn.x - 150, this.spawn.y - 60], ['crate', this.spawn.x + 160, this.spawn.y - 40],
      ['barrel', 1600, 2400], ['crate', 1500, 1440], ['crate', 1700, 1440], ['barrel', this.chimney.x - 110, this.chimney.y + 40],
    ];
    for (const p of fixed) if (this.isFree(p[1], p[2], 22)) this.props.push(p);
    for (let i = 0, n = 0; i < 600 && n < 30; i++) {
      const x = IN0 + R() * (IN1 - IN0), y = IN0 + R() * (IN1 - IN0);
      if (!this.isFree(x, y, 24)) continue;
      this.props.push([R() < 0.62 ? 'crate' : 'barrel', x, y]);
      n++;
    }
  }

  // ---------- Painting ----------
  paintTerrain(scale = 1) {
    const S = Math.round(WORLD * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.scale(scale, scale);
    const rand = mulberry32(this.seed + 77);
    const R = (a, b) => a + rand() * (b - a);
    const inner = WALL0 + WALL_T;
    const span = WALL1 - WALL_T - inner;

    // Yard concrete with slab joints.
    ctx.fillStyle = concretePattern(ctx, this.seed, [176, 172, 162]);
    ctx.fillRect(WALL0 - 20, WALL0 - 20, WALL1 - WALL0 + 40, WALL1 - WALL0 + 40);
    ctx.strokeStyle = 'rgba(70,64,56,0.28)'; ctx.lineWidth = 2;
    for (let v = inner; v < WALL1; v += 200) {
      ctx.beginPath(); ctx.moveTo(v, inner); ctx.lineTo(v, WALL1); ctx.moveTo(inner, v); ctx.lineTo(WALL1, v); ctx.stroke();
    }
    // Weathering: damp patches, cracks, oil.
    for (let i = 0; i < 70; i++) {
      const x = R(inner, inner + span), y = R(inner, inner + span), r = R(40, 160);
      ctx.fillStyle = radialFill(ctx, x, y, r, rand() < 0.5 ? 'rgba(90,84,74,0.16)' : 'rgba(255,250,235,0.12)');
      ctx.beginPath(); ctx.ellipse(x, y, r, r * R(0.5, 0.9), R(0, 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,54,46,0.35)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 90; i++) {
      let x = R(inner, inner + span), y = R(inner, inner + span);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += R(-22, 22); y += R(-22, 22); ctx.lineTo(x, y); }
      ctx.stroke();
    }

    this.paintTankFarm(ctx, R);
    this.paintHall(ctx, R);
    this.paintCanal(ctx, R);
    this.paintYard(ctx, R);
    for (const b of [this.warehouse, this.boiler]) {
      // Apron in front of each building.
      ctx.fillStyle = 'rgba(60,56,50,0.18)';
      ctx.fillRect(b.x - 30, b.y + b.h, b.w + 60, 90);
      hazard(ctx, b.x - 30, b.y + b.h + 84, b.w + 60, 10);
    }
    for (let i = 0; i < 46; i++) {
      const x = R(inner + 40, inner + span - 40), y = R(inner + 40, inner + span - 40);
      if (inRect(x, y, CANAL)) continue;
      oilStain(ctx, x, y, R(14, 46), rand);
    }
    // Drain grates and manholes.
    for (let i = 0; i < 22; i++) {
      const x = R(inner + 60, inner + span - 60), y = R(inner + 60, inner + span - 60);
      if (inRect(x, y, CANAL) || !this.isFree(x, y, 10)) continue;
      if (rand() < 0.5) {
        ctx.fillStyle = '#5c5a55'; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3d3b37'; ctx.lineWidth = 2;
        for (let k = -12; k <= 12; k += 6) { ctx.beginPath(); ctx.moveTo(x - 14, y + k); ctx.lineTo(x + 14, y + k); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#4a4844'; ctx.fillRect(x - 20, y - 9, 40, 18);
        ctx.fillStyle = '#26241f';
        for (let k = -16; k < 18; k += 6) ctx.fillRect(x + k, y - 6, 3, 12);
      }
    }
    return canvas;
  }

  paintTankFarm(ctx, R) {
    // A bunded slab with a low curb under the silos, and pipes running down to the hall.
    const x0 = 400, y0 = 520, x1 = 1500, y1 = 860;
    ctx.fillStyle = 'rgba(120,128,132,0.35)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = '#d8d4c8'; ctx.lineWidth = 8;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 5, y0 + 5, x1 - x0 - 10, y1 - y0 - 10);
    for (const t of this.tanks) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(t.x + 30, t.y + 60, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
      pipe(ctx, [[t.x + 50, t.y + 40], [t.x + 50, 900], [t.x + 50, HALL.y + 60]], 14, '#9aa6ad');
    }
    pipe(ctx, [[x1 - 20, 640], [1900, 640], [1900, HALL.y + 60]], 12, '#b8c4c8');
    pipe(ctx, [[2560, 640], [2560, 980], [HALL.x + HALL.w - 40, 980]], 16, '#a15c38');
  }

  paintHall(ctx, R) {
    const H = HALL;
    // Epoxy floor, a shade darker at the edges, with the walkway markings.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(H.x - 46, H.y - 46, H.w + 92, H.h + 92);
    ctx.fillStyle = concretePattern(ctx, this.seed + 3, [118, 140, 128]);
    ctx.fillRect(H.x - 40, H.y - 40, H.w + 80, H.h + 80);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let x = H.x - 40; x < H.x + H.w + 40; x += 80) { ctx.beginPath(); ctx.moveTo(x, H.y - 40); ctx.lineTo(x, H.y + H.h + 40); ctx.stroke(); }
    for (let y = H.y - 40; y < H.y + H.h + 40; y += 80) { ctx.beginPath(); ctx.moveTo(H.x - 40, y); ctx.lineTo(H.x + H.w + 40, y); ctx.stroke(); }
    ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 6;
    ctx.strokeRect(H.x - 20, H.y - 20, H.w + 40, H.h + 40);
    ctx.setLineDash([36, 26]); ctx.lineWidth = 4;
    for (const b of this.belts) {
      for (const y of [b.y - 46, b.y + b.h + 74]) { ctx.beginPath(); ctx.moveTo(b.x - 60, y); ctx.lineTo(b.x + b.w + 60, y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    // Hazard borders and end rollers under the belts.
    for (const b of this.belts) {
      hazard(ctx, b.x - 30, b.y - 16, b.w + 60, 12);
      hazard(ctx, b.x - 30, b.y + b.h + 4, b.w + 60, 12);
      ctx.fillStyle = '#2b2d30';
      ctx.fillRect(b.x - 30, b.y - 4, b.w + 60, b.h + 8);
      for (const x of [b.x - 26, b.x + b.w + 4]) {
        ctx.fillStyle = '#5b6068'; ctx.fillRect(x, b.y - 2, 22, b.h + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 4, b.y - 2, 4, b.h + 4);
      }
      // Arrows showing which way it runs.
      ctx.fillStyle = 'rgba(242,194,48,0.85)';
      for (let x = b.x + 80; x < b.x + b.w; x += 260) {
        const y = b.y + b.h + 44, d = b.dir;
        ctx.beginPath(); ctx.moveTo(x + 22 * d, y); ctx.lineTo(x - 10 * d, y - 14); ctx.lineTo(x - 10 * d, y + 14); ctx.closePath(); ctx.fill();
      }
    }
    for (const o of this.objects) {
      if (o.kind !== 'machine') continue;
      const f = o.foot;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(f.x - 14, f.y - 10, f.w + 28, f.h + 20);
      hazard(ctx, f.x - 14, f.y + f.h + 4, f.w + 28, 8);
    }
    // The company egg painted in the middle of the floor.
    const { x, y } = this.village;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#f7e7b0';
    ctx.beginPath(); ctx.ellipse(0, 8, 92, 118, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c230';
    ctx.beginPath(); ctx.arc(0, 26, 52, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#5b4a1a';
    ctx.font = '900 34px "Lilita One", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NAIWA', 0, -54);
    ctx.font = '900 18px "Lilita One", "Arial Black", sans-serif';
    ctx.fillText('MILK & EGG CO.', 0, 112);
    ctx.restore();
  }

  paintCanal(ctx, R) {
    const C = CANAL;
    // Concrete lips, then milk: creamy, a little darker along the edges.
    ctx.fillStyle = '#d9d4c6';
    ctx.fillRect(C.x, C.y - 14, C.w, C.h + 28);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(C.x, C.y - 2, C.w, 6);
    const g = ctx.createLinearGradient(0, C.y, 0, C.y + C.h);
    g.addColorStop(0, '#cfc2a2'); g.addColorStop(0.2, '#f1e8d0'); g.addColorStop(0.8, '#f8f1de'); g.addColorStop(1, '#ddd0b2');
    ctx.fillStyle = g;
    ctx.fillRect(C.x, C.y, C.w, C.h);
    ctx.strokeStyle = 'rgba(200,190,165,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < 260; i++) {
      const x = R(C.x, C.x + C.w), y = R(C.y + 12, C.y + C.h - 10), w = R(10, 34);
      ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.18, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    }
    // Milk splashed onto the concrete.
    ctx.fillStyle = 'rgba(250,244,226,0.7)';
    for (let i = 0; i < 24; i++) {
      const x = R(C.x, C.x + C.w), y = rand01(i) < 0.5 ? C.y - R(16, 30) : C.y + C.h + R(16, 30), r = R(4, 9);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Steel grating bridges.
    for (const b of this.bridges) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      ctx.fillStyle = '#7b8288'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = '#4b5056'; ctx.lineWidth = 2;
      for (let x = b.x + 6; x < b.x + b.w; x += 8) { ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke(); }
      for (let y = b.y + 10; y < b.y + b.h; y += 20) { ctx.beginPath(); ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); ctx.stroke(); }
      hazard(ctx, b.x - 4, b.y, 8, b.h, true);
      hazard(ctx, b.x + b.w - 4, b.y, 8, b.h, true);
    }
  }

  paintYard(ctx, R) {
    // Gate apron, zebra crossing, parking bays and tyre tracks.
    const gx = GATE.x, gw = GATE.w, wy = WALL1 - WALL_T;
    ctx.fillStyle = 'rgba(40,40,44,0.35)';
    ctx.fillRect(gx - 40, wy - 520, gw + 80, 520);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let x = gx; x < gx + gw; x += 40) ctx.fillRect(x + 6, wy - 120, 24, 70);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(gx - 40, wy - 8, gw + 80, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4;
    for (const [x0, y0, n] of [[340, 2340, 6], [2470, 2340, 5]]) {
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * 90, y0); ctx.lineTo(x0 + i * 90, y0 + 120); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(40,36,32,0.22)'; ctx.lineWidth = 12;
    for (let i = 0; i < 7; i++) {
      const x0 = gx + R(30, gw - 30), x1 = R(500, 2700), y1 = R(2380, 2800);
      for (const o of [-16, 16]) {
        ctx.beginPath(); ctx.moveTo(x0 + o, wy); ctx.bezierCurveTo(x0 + o, wy - 260, x1 + o, y1 + 200, x1 + o, y1); ctx.stroke();
      }
    }
  }

  paintMinimap(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const k = size / WORLD;
    ctx.scale(k, k);
    ctx.fillStyle = '#3f6b3a'; ctx.fillRect(0, 0, WORLD, WORLD);
    ctx.fillStyle = '#4a4e52'; ctx.fillRect(GATE.x, WALL1, GATE.w, WORLD - WALL1);
    ctx.fillStyle = '#b4b0a6'; ctx.fillRect(WALL0, WALL0, WALL1 - WALL0, WALL1 - WALL0);
    ctx.strokeStyle = '#55524c'; ctx.lineWidth = WALL_T * 1.5;
    ctx.strokeRect(WALL0 + WALL_T / 2, WALL0 + WALL_T / 2, WALL1 - WALL0 - WALL_T, WALL1 - WALL0 - WALL_T);
    ctx.fillStyle = '#7d9285'; ctx.fillRect(HALL.x - 40, HALL.y - 40, HALL.w + 80, HALL.h + 80);
    ctx.fillStyle = '#f6f1e4'; ctx.fillRect(CANAL.x, CANAL.y, CANAL.w, CANAL.h);
    ctx.fillStyle = '#7b8288';
    for (const b of this.bridges) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#2b2d30';
    for (const b of this.belts) ctx.fillRect(b.x - 30, b.y - 4, b.w + 60, b.h + 8);
    const colors = { silo: '#e8edf0', tower: '#c2410c', chimney: '#9a3b2a', warehouse: '#5b7a99', boiler: '#a14e36', container: '#c46b2d', truck: '#e2e8f0', machine: '#f2c230', pallet: '#c49a5a', forklift: '#f2c230', pillar: '#3b3f44' };
    for (const o of this.objects) {
      ctx.fillStyle = colors[o.kind] ?? '#555';
      const f = o.foot;
      if (f.kind === 'circle') { ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(f.r, 24), 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(f.x, f.y, f.w, f.h);
    }
    return canvas;
  }
}

// Does a circle at (x, y) of radius r touch collider c?
function hits(c, x, y, r) {
  if (c.kind === 'circle') return Math.hypot(x - c.x, y - c.y) < c.r + r;
  const cx = Math.max(c.x, Math.min(x, c.x + c.w)), cy = Math.max(c.y, Math.min(y, c.y + c.h));
  return Math.hypot(x - cx, y - cy) < r;
}

function rand01(i) { return hash2(i, 991); }

// A tileable concrete texture, as a fill pattern.
function concretePattern(ctx, seed, [r, g, b]) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cx = c.getContext('2d', { willReadFrequently: true });
  const img = cx.createImageData(S, S);
  const n = makeNoise(seed, 8);
  for (let y = 0, p = 0; y < S; y++) for (let x = 0; x < S; x++, p += 4) {
    const v = (fbm(n, x / 32, y / 32, 3) - 0.5) * 22 + (hash2(x, y) - 0.5) * 14;
    img.data[p] = r + v; img.data[p + 1] = g + v; img.data[p + 2] = b + v; img.data[p + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

function radialFill(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  return g;
}

function oilStain(ctx, x, y, r, rand) {
  for (let i = 0; i < 4; i++) {
    const ox = x + (rand() - 0.5) * r, oy = y + (rand() - 0.5) * r * 0.6, rr = r * (0.4 + rand() * 0.6);
    ctx.fillStyle = radialFill(ctx, ox, oy, rr, 'rgba(30,28,34,0.35)');
    ctx.beginPath(); ctx.ellipse(ox, oy, rr, rr * 0.65, rand() * 3, 0, Math.PI * 2); ctx.fill();
  }
}

// Yellow and black warning stripes.
function hazard(ctx, x, y, w, h, vertical = false) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = '#f2c230'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#26241f';
  const len = vertical ? h : w;
  for (let s = -20; s < len + 20; s += 20) {
    ctx.beginPath();
    if (vertical) { ctx.moveTo(x, y + s); ctx.lineTo(x + w, y + s - w); ctx.lineTo(x + w, y + s - w + 10); ctx.lineTo(x, y + s + 10); }
    else { ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + h, y); ctx.lineTo(x + s + h + 10, y); ctx.lineTo(x + s + 10, y + h); }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// A pipe lying on the floor along a polyline, with flanges.
function pipe(ctx, pts, w, color) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = w + 4;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 3, y + 5) : ctx.moveTo(x + 3, y + 5))); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = w * 0.25;
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - w * 0.2, y - w * 0.2) : ctx.moveTo(x - w * 0.2, y - w * 0.2))); ctx.stroke();
  ctx.fillStyle = 'rgba(40,40,40,0.5)';
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 60; d < len; d += 120) {
      const t = d / len, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (x0 === x1) ctx.fillRect(x - w * 0.75, y - 3, w * 1.5, 6);
      else ctx.fillRect(x - 3, y - w * 0.75, 6, w * 1.5);
    }
  }
}
