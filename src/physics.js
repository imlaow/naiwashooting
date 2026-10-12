// Static obstacle colliders in a spatial hash, with circle push-out and ray tests.

const CELL = 128;

export class StaticWorld {
  constructor() {
    this.cells = new Map();
  }

  key(cx, cy) {
    return cx * 65536 + cy;
  }

  // collider: { kind: 'circle', x, y, r } or { kind: 'rect', x, y, w, h }
  // Optional fields: blocksBullets (default true), owner (object hit callback target)
  add(c) {
    if (c.blocksBullets === undefined) c.blocksBullets = true;
    const [x0, y0, x1, y1] = bounds(c);
    c.cellKeys = [];
    for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
        c.cellKeys.push(k);
      }
    }
    return c;
  }

  remove(c) {
    for (const k of c.cellKeys ?? []) {
      const list = this.cells.get(k);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    c.removed = true;
  }

  query(x, y, r, out = []) {
    out.length = 0;
    const seen = new Set();
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) {
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const c of list) if (!seen.has(c)) { seen.add(c); out.push(c); }
      }
    }
    return out;
  }

  // Pushes a circle (entity) out of overlapping colliders. Mutates pos.
  resolve(pos, r) {
    const near = this.query(pos.x, pos.y, r + 4, this._tmp || (this._tmp = []));
    let hit = false;
    for (const c of near) {
      if (c.kind === 'circle') {
        const dx = pos.x - c.x, dy = pos.y - c.y;
        const d = Math.hypot(dx, dy), min = r + c.r;
        if (d < min && d > 0.0001) {
          pos.x = c.x + (dx / d) * min;
          pos.y = c.y + (dy / d) * min;
          hit = true;
        }
      } else {
        const cx = clamp(pos.x, c.x, c.x + c.w), cy = clamp(pos.y, c.y, c.y + c.h);
        let dx = pos.x - cx, dy = pos.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < r) {
          if (d < 0.0001) {
            // Centre inside rect: push out along the shallowest axis.
            const l = pos.x - c.x, rr = c.x + c.w - pos.x, t = pos.y - c.y, b = c.y + c.h - pos.y;
            const m = Math.min(l, rr, t, b);
            if (m === l) pos.x = c.x - r; else if (m === rr) pos.x = c.x + c.w + r;
            else if (m === t) pos.y = c.y - r; else pos.y = c.y + c.h + r;
          } else {
            pos.x = cx + (dx / d) * r;
            pos.y = cy + (dy / d) * r;
          }
          hit = true;
        }
      }
    }
    return hit;
  }

  // Returns the collider containing point (x, y) that blocks bullets, or null.
  pointHit(x, y) {
    const near = this.query(x, y, 1, this._tmp2 || (this._tmp2 = []));
    for (const c of near) {
      if (!c.blocksBullets) continue;
      if (c.kind === 'circle') {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r) return c;
      } else if (x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) return c;
    }
    return null;
  }

  // True if a circle at (x, y) would overlap any collider.
  overlaps(x, y, r) {
    const near = this.query(x, y, r, this._tmp3 || (this._tmp3 = []));
    for (const c of near) {
      if (c.kind === 'circle') {
        if ((x - c.x) ** 2 + (y - c.y) ** 2 < (r + c.r) ** 2) return true;
      } else {
        const cx = clamp(x, c.x, c.x + c.w), cy = clamp(y, c.y, c.y + c.h);
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  // Line of sight test, sampling every `step` pixels.
  clearLine(x0, y0, x1, y1, step = 14) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.pointHit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }
}

function bounds(c) {
  if (c.kind === 'circle') return [c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r];
  return [c.x, c.y, c.x + c.w, c.y + c.h];
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
