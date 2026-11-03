// The milk-and-egg factories: walled compounds with production halls full of conveyor belts,
// milk canals you have to wade across, tank farms, warehouses, boiler houses and a loading yard
// by the gate. A factory has the same terrain interface as Island (see sim/maps.js) plus `drift`
// for the belts. Each map is a plan (factoryPlans.js) that builds it from the blocks below: a
// hall with its belts, a row of silos, a canal with bridges, a building, a container… This file
// holds those blocks and paints the floor; factoryScene.js builds the Pixi scene from it.
import { mulberry32, makeNoise, fbm, hash2 } from './noise.js';
import { PLANS } from './factoryPlans.js';

// The perimeter wall stands this far in from the map's edge, this thick; you can walk between
// in0 and in1. Maps are up to 4000 px (wire positions cover 4256).
export const WALL_T = 32;
const MARGIN = 208;
const BELT_SPEED = 110;

const inRect = (x, y, r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
const inside = (a, r) => a.x >= r.x - 1 && a.x + a.w <= r.x + r.w + 1 && a.y >= r.y - 1 && a.y + a.h <= r.y + r.h + 1;

export class Factory {
  // plan: a key of PLANS ('dairy', 'depot', …; 'random' rolls one from the seed).
  constructor(seed, plan = 'dairy') {
    this.seed = seed;
    this.plan = PLANS[plan] ? plan : 'random';
    this.firstWaveKey = 'game.firstWaveFactory';
    this.rand = mulberry32(seed);
    // Everything solid: { kind, x, y, foot } where (x, y) is where the sprite stands and
    // foot is its collider, { kind: 'rect', x, y, w, h } or { kind: 'circle', x, y, r }.
    this.objects = [];
    this.props = [];
    this.weaponSpots = [];
    // What the floor painting and the scene draw: halls (with belts), canals (with bridges),
    // bunded slabs under the silos, pipes on the floor, parking bays, buildings, chimneys.
    this.halls = [];
    this.belts = [];
    this.canals = [];
    this.bridges = [];
    this.farms = [];
    this.tanks = [];
    this.pipes = [];
    this.bays = [];
    this.buildings = [];
    this.chimneys = [];
    this.logo = null; // where the company egg is painted on the floor
    this.yard = null; // where lorries' tyre tracks lead from the gate
    PLANS[this.plan](this, this.rand);
  }

  // Every plan starts here: the map's side, the wall, the gate and the spawn in front of it.
  setSize(size) {
    this.size = size;
    this.wall0 = MARGIN;
    this.wall1 = size - MARGIN;
    this.in0 = MARGIN + 54;
    this.in1 = size - MARGIN - 54;
    this.gate = { x: size / 2 - 120, w: 240 };
    this.spawn = { x: size / 2, y: this.wall1 - 190 };
  }

  // ---------- Terrain interface ----------
  heightAt() { return 0.3; }
  inDock() { return false; }

  isWalkable(x, y) {
    return x > this.in0 && x < this.in1 && y > this.in0 && y < this.in1;
  }

  inCanal(x, y) {
    return this.canals.some((c) => inRect(x, y, c)) && !this.bridges.some((b) => inRect(x, y, b));
  }

  isWading(x, y) {
    return this.inCanal(x, y);
  }

  // Eggs roll off the production line: early in a wave they turn up in a hall.
  goodSpawn(type, x, y) {
    return type !== 'egg' || !this.halls.length || this.halls.some((h) => inRect(x, y, h));
  }

  dustColor(x, y) {
    return this.halls.some((h) => inRect(x, y, h)) ? 0x9aa69c : 0xbdb8ae;
  }

  // Conveyor belts carry whatever stands on them.
  drift(x, y) {
    for (const b of this.belts) if (inRect(x, y, b)) return b.dir * BELT_SPEED;
    return 0;
  }

  // ---------- Layout blocks ----------
  add(kind, x, y, foot, extra = {}) {
    const o = { kind, x, y, foot, ...extra };
    this.objects.push(o);
    return o;
  }

  rect(x, y, w, h) { return { kind: 'rect', x, y, w, h }; }
  circle(x, y, r) { return { kind: 'circle', x, y, r }; }

  // True when a circle of radius r at (x, y) is clear of every solid, belt, canal, prop and the
  // spawn.
  isFree(x, y, r) {
    if (x < this.in0 + r || x > this.in1 - r || y < this.in0 + r || y > this.in1 - r) return false;
    for (const o of this.objects) if (hits(o.foot, x, y, r + 14)) return false;
    for (const b of this.belts) if (hits({ kind: 'rect', ...b }, x, y, r + 10)) return false;
    for (const c of this.canals) if (hits({ kind: 'rect', ...c }, x, y, r + 16)) return false;
    for (const p of this.props) if (Math.hypot(p[1] - x, p[2] - y) < r + 34) return false;
    if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 150 + r) return false;
    return true;
  }

  // True when rectangle a, grown by pad, is inside the wall and clear of every solid, belt, canal,
  // hall floor, prop and the spawn: where a container or lorry can go.
  rectFree(a, pad) {
    const g = { x: a.x - pad, y: a.y - pad, w: a.w + pad * 2, h: a.h + pad * 2 };
    if (g.x < this.in0 || g.y < this.in0 || g.x + g.w > this.in1 || g.y + g.h > this.in1) return false;
    const over = (r) => g.x < r.x + r.w && g.x + g.w > r.x && g.y < r.y + r.h && g.y + g.h > r.y;
    const box = (f) => (f.kind === 'circle' ? { x: f.x - f.r, y: f.y - f.r, w: f.r * 2, h: f.r * 2 } : f);
    if (this.objects.some((o) => over(box(o.foot)))) return false;
    if ([...this.belts, ...this.canals, ...this.bridges].some(over)) return false;
    if (this.halls.some((h) => over({ x: h.x - 40, y: h.y - 40, w: h.w + 80, h: h.h + 80 }))) return false;
    if (this.props.some((p) => over({ x: p[1] - 24, y: p[2] - 24, w: 48, h: 48 }))) return false;
    return !over({ x: this.spawn.x - 150, y: this.spawn.y - 150, w: 300, h: 300 });
  }

  // A production hall: belts in rows across it, machines straddling them, steel columns along its
  // edges and in the lanes, pallets by the belt ends. Each row is { y, dir, m, gap }: y from the
  // hall's top (negative: from its bottom), m the machines' places along the belt (0–1) and gap,
  // if set, cuts the belt in two around the middle, that far each side, so you can walk across.
  // opts: cols (edge column bays), mid ([{ y, xs }] rows of columns in the lanes, y as for rows),
  // pallets and forklifts ([[x, y]] more of them).
  addHall(H, rows, { cols = 6, mid = [], pallets = [], forklifts = [] } = {}) {
    this.halls.push(H);
    const at = (y) => (y >= 0 ? H.y + y : H.y + H.h + y);
    const x0 = H.x + 170, x1 = H.x + H.w - 170, cx = H.x + H.w / 2;
    const placed = [];
    for (const r of rows) {
      const y = at(r.y);
      const parts = r.gap ? [[x0, cx - r.gap], [cx + r.gap, x1]] : [[x0, x1]];
      parts.forEach(([a, b], k) => {
        const belt = { x: a, y, w: b - a, h: 56, dir: r.dir };
        this.belts.push(belt);
        placed.push({ belt, m: r.m, k });
      });
    }
    for (const { belt, m, k } of placed) {
      m.forEach((f, i) => {
        const x = belt.x + belt.w * f, y = belt.y + belt.h + 4;
        this.add('machine', x, y, this.rect(x - 78, y - 100, 156, 100), { variant: (i + k) % 2 });
      });
    }
    for (let i = 0; i <= cols; i++) {
      const x = H.x + (H.w / cols) * i;
      this.add('pillar', x, H.y, this.circle(x, H.y - 4, 17));
      this.add('pillar', x, H.y + H.h, this.circle(x, H.y + H.h - 4, 17));
    }
    for (const row of mid) {
      const y = at(row.y);
      for (const fx of row.xs) {
        const x = H.x + H.w * fx;
        this.add('pillar', x, y, this.circle(x, y - 4, 17));
      }
    }
    const ends = rows.flatMap((r) => [[H.x + 90, at(r.y) + 30], [H.x + H.w - 90, at(r.y) + 30]]);
    for (const [x, y] of [...ends, ...pallets]) this.addPallet(x, y);
    for (const [x, y] of forklifts) this.add('forklift', x, y, this.rect(x - 36, y - 38, 74, 40));
  }

  // Silos standing at [[x, y]], with the label variants counting up from v0.
  addSilos(spots, v0 = 0) {
    spots.forEach(([x, y], i) => {
      this.add('silo', x, y, this.rect(x - 76, y - 64, 152, 60), { variant: (v0 + i) % 4 });
      this.tanks.push({ x, y: y - 40 });
    });
  }

  // The water tower: the lookout, with the SMG at its foot.
  addTower(x, y) {
    this.add('tower', x, y, this.rect(x - 58, y - 48, 116, 42));
    this.lookout = { x, y, h: 1 };
    this.weaponSpots.push({ x, y: y + 44, kind: 'smg' });
  }

  addChimney(x, y) {
    const c = { x, y };
    this.chimneys.push(c);
    this.add('chimney', x, y, this.circle(x, y - 30, 44));
    return c;
  }

  // A solid block: { x, y, w, h, H, style } where H is how tall its front wall stands and style
  // 'warehouse' (corrugated, roller doors) or 'boiler' (brick, a furnace mouth).
  addBuilding(b) {
    this.buildings.push(b);
    this.add(b.style, 0, 0, this.rect(b.x, b.y, b.w, b.h), { b });
    return b;
  }

  addContainer(x, y, variant) { this.add('container', x, y, this.rect(x - 122, y - 58, 244, 58), { variant }); }
  addTruck(x, y, flip = false) { this.add('truck', x, y, this.rect(x - 150, y - 62, 300, 62), flip ? { flip: true } : {}); }
  addPallet(x, y) { this.add('pallet', x, y, this.circle(x, y - 14, 30)); }

  // A milk canal right across the compound at y, with steel bridges 150 px wide at xs.
  addCanal(y, xs, h = 100) {
    const c = { x: this.wall0 + WALL_T, y, w: this.wall1 - this.wall0 - WALL_T * 2, h };
    this.canals.push(c);
    for (const x of xs) this.bridges.push({ x, y: y - 12, w: 150, h: h + 24 });
    return c;
  }

  // Crates and red barrels: `fixed` ones where they fit ([kind, x, y]), then n scattered.
  scatter(fixed, n, tries) {
    const R = this.rand;
    for (const p of fixed) if (this.isFree(p[1], p[2], 22)) this.props.push(p);
    for (let i = 0, k = 0; i < tries && k < n; i++) {
      const x = this.in0 + R() * (this.in1 - this.in0), y = this.in0 + R() * (this.in1 - this.in0);
      if (!this.isFree(x, y, 24)) continue;
      this.props.push([R() < 0.62 ? 'crate' : 'barrel', x, y]);
      k++;
    }
  }

  // ---------- Painting ----------
  paintTerrain(scale = 1) {
    const S = Math.round(this.size * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.scale(scale, scale);
    const rand = mulberry32(this.seed + 77);
    const R = (a, b) => a + rand() * (b - a);
    const { wall0, wall1 } = this;
    const inner = wall0 + WALL_T;
    const span = wall1 - WALL_T - inner;
    const area = (this.size / 4000) ** 2;
    const inCanal = (x, y) => this.canals.some((c) => inRect(x, y, c));

    // Yard concrete with slab joints.
    ctx.fillStyle = concretePattern(ctx, this.seed, [176, 172, 162]);
    ctx.fillRect(wall0 - 20, wall0 - 20, wall1 - wall0 + 40, wall1 - wall0 + 40);
    ctx.strokeStyle = 'rgba(70,64,56,0.28)'; ctx.lineWidth = 2;
    for (let v = inner; v < wall1; v += 200) {
      ctx.beginPath(); ctx.moveTo(v, inner); ctx.lineTo(v, wall1); ctx.moveTo(inner, v); ctx.lineTo(wall1, v); ctx.stroke();
    }
    // Weathering: damp patches, cracks, oil.
    for (let i = 0; i < Math.round(118 * area); i++) {
      const x = R(inner, inner + span), y = R(inner, inner + span), r = R(40, 160);
      ctx.fillStyle = radialFill(ctx, x, y, r, rand() < 0.5 ? 'rgba(90,84,74,0.16)' : 'rgba(255,250,235,0.12)');
      ctx.beginPath(); ctx.ellipse(x, y, r, r * R(0.5, 0.9), R(0, 3), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,54,46,0.35)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < Math.round(152 * area); i++) {
      let x = R(inner, inner + span), y = R(inner, inner + span);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += R(-22, 22); y += R(-22, 22); ctx.lineTo(x, y); }
      ctx.stroke();
    }

    this.paintFarms(ctx);
    for (const H of this.halls) this.paintHall(ctx, H);
    if (this.logo) this.paintLogo(ctx, this.logo);
    for (const C of this.canals) this.paintCanal(ctx, C, R);
    this.paintYard(ctx, R);
    for (const b of this.buildings) {
      // Apron in front of each building.
      ctx.fillStyle = 'rgba(60,56,50,0.18)';
      ctx.fillRect(b.x - 30, b.y + b.h, b.w + 60, 90);
      hazard(ctx, b.x - 30, b.y + b.h + 84, b.w + 60, 10);
    }
    for (let i = 0; i < Math.round(78 * area); i++) {
      const x = R(inner + 40, inner + span - 40), y = R(inner + 40, inner + span - 40);
      if (inCanal(x, y)) continue;
      oilStain(ctx, x, y, R(14, 46), rand);
    }
    // Drain grates and manholes.
    for (let i = 0; i < Math.round(37 * area); i++) {
      const x = R(inner + 60, inner + span - 60), y = R(inner + 60, inner + span - 60);
      if (inCanal(x, y) || !this.isFree(x, y, 10)) continue;
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

  paintFarms(ctx) {
    // A bunded slab with a low curb under the silos, and the pipes on the floor.
    for (const { x0, y0, x1, y1 } of this.farms) {
      ctx.fillStyle = 'rgba(120,128,132,0.35)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = '#d8d4c8'; ctx.lineWidth = 8;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 5, y0 + 5, x1 - x0 - 10, y1 - y0 - 10);
    }
    for (const t of this.tanks) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(t.x + 30, t.y + 60, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of this.pipes) pipe(ctx, p.pts, p.w, p.color);
  }

  paintHall(ctx, H) {
    const belts = this.belts.filter((b) => inside(b, H));
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
    for (const b of belts) {
      for (const y of [b.y - 46, b.y + b.h + 74]) { ctx.beginPath(); ctx.moveTo(b.x - 60, y); ctx.lineTo(b.x + b.w + 60, y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    // Hazard borders and end rollers under the belts.
    for (const b of belts) {
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
      if (o.kind !== 'machine' || !inRect(o.x, o.y, H)) continue;
      const f = o.foot;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(f.x - 14, f.y - 10, f.w + 28, f.h + 20);
      hazard(ctx, f.x - 14, f.y + f.h + 4, f.w + 28, 8);
    }
  }

  // The company egg painted on the floor.
  paintLogo(ctx, { x, y }) {
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

  paintCanal(ctx, C, R) {
    const k = C.w / 3520; // swirls and splashes go by the canal's length
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
    for (let i = 0; i < Math.round(260 * k); i++) {
      const x = R(C.x, C.x + C.w), y = R(C.y + 12, C.y + C.h - 10), w = R(10, 34);
      ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.18, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    }
    // Milk splashed onto the concrete.
    ctx.fillStyle = 'rgba(250,244,226,0.7)';
    for (let i = 0; i < Math.round(24 * k); i++) {
      const x = R(C.x, C.x + C.w), y = rand01(i) < 0.5 ? C.y - R(16, 30) : C.y + C.h + R(16, 30), r = R(4, 9);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Steel grating bridges.
    for (const b of this.bridges) {
      if (b.y > C.y || b.y + b.h < C.y + C.h) continue;
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
    const gx = this.gate.x, gw = this.gate.w, wy = this.wall1 - WALL_T;
    ctx.fillStyle = 'rgba(40,40,44,0.35)';
    ctx.fillRect(gx - 40, wy - 520, gw + 80, 520);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let x = gx; x < gx + gw; x += 40) ctx.fillRect(x + 6, wy - 120, 24, 70);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(gx - 40, wy - 8, gw + 80, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4;
    for (const [x0, y0, n] of this.bays) {
      for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * 90, y0); ctx.lineTo(x0 + i * 90, y0 + 120); ctx.stroke(); }
    }
    if (!this.yard) return;
    const Y = this.yard;
    ctx.strokeStyle = 'rgba(40,36,32,0.22)'; ctx.lineWidth = 12;
    for (let i = 0; i < 9; i++) {
      const x0 = gx + R(30, gw - 30), x1 = R(Y.x0, Y.x1), y1 = R(Y.y0, Y.y1);
      for (const o of [-16, 16]) {
        ctx.beginPath(); ctx.moveTo(x0 + o, wy); ctx.bezierCurveTo(x0 + o, wy - 260, x1 + o, y1 + 200, x1 + o, y1); ctx.stroke();
      }
    }
  }

  paintMinimap(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const S = this.size, { wall0, wall1, gate } = this;
    const k = size / S;
    ctx.scale(k, k);
    ctx.fillStyle = '#3f6b3a'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#4a4e52'; ctx.fillRect(gate.x, wall1, gate.w, S - wall1);
    ctx.fillStyle = '#b4b0a6'; ctx.fillRect(wall0, wall0, wall1 - wall0, wall1 - wall0);
    ctx.strokeStyle = '#55524c'; ctx.lineWidth = WALL_T * 1.5;
    ctx.strokeRect(wall0 + WALL_T / 2, wall0 + WALL_T / 2, wall1 - wall0 - WALL_T, wall1 - wall0 - WALL_T);
    ctx.fillStyle = '#7d9285';
    for (const H of this.halls) ctx.fillRect(H.x - 40, H.y - 40, H.w + 80, H.h + 80);
    ctx.fillStyle = '#f6f1e4';
    for (const C of this.canals) ctx.fillRect(C.x, C.y, C.w, C.h);
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
