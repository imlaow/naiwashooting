// Procedural island: height field, layout (village, dock, paths), and the
// painted terrain / foam / minimap canvases.
import { mulberry32, makeNoise, fbm, hash2, clamp, lerp, smoothstep } from './noise.js';

export const WORLD = 3200;
const GRID = 8;
const GW = WORLD / GRID + 1;
const PGRID = 4;
const PW = WORLD / PGRID + 1;

// Height thresholds
export const H_DEEP = -0.17;
export const H_WADE = -0.1; // deeper than this is not walkable
export const H_SAND = 0.025;
export const H_GRASS = 0.15;
export const H_ROCK = 0.55;

export class Island {
  constructor(seed) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.height = new Float32Array(GW * GW);
    this.moist = new Float32Array(GW * GW);
    this.path = new Float32Array(PW * PW);
    this.buildHeight();
    this.planLayout();
  }

  // ---------- Height field ----------
  buildHeight() {
    const n1 = makeNoise(this.seed + 1), n2 = makeNoise(this.seed + 2), n3 = makeNoise(this.seed + 3);
    const c = WORLD / 2;
    for (let gy = 0; gy < GW; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const x = gx * GRID, y = gy * GRID;
        const dx = (x - c) / c, dy = (y - c) / c;
        const wx = dx + (fbm(n2, x / 700, y / 700, 3) - 0.5) * 0.4;
        const wy = dy + (fbm(n2, x / 700 + 40, y / 700 + 40, 3) - 0.5) * 0.4;
        const d2 = wx * wx + wy * wy;
        let h = 0.46 - 1.15 * d2 + (fbm(n1, x / 520, y / 520, 5) - 0.5) * 0.5;
        // A hill north-west of centre for a rocky lookout.
        const hx = dx + 0.16, hy = dy + 0.2;
        h += 0.26 * Math.exp(-(hx * hx + hy * hy) / 0.03);
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r > 0.78) h -= (r - 0.78) * 3;
        const i = gy * GW + gx;
        this.height[i] = h;
        this.moist[i] = fbm(n3, x / 420, y / 420, 4);
      }
    }
  }

  heightAt(x, y) {
    return sampleGrid(this.height, GW, GRID, x, y);
  }

  moistAt(x, y) {
    return sampleGrid(this.moist, GW, GRID, x, y);
  }

  pathAt(x, y) {
    return sampleGrid(this.path, PW, PGRID, x, y);
  }

  inDock(x, y) {
    const d = this.dock;
    return x > d.x - 4 && x < d.x + d.w + 4 && y > d.y && y < d.y + d.h;
  }

  isWalkable(x, y) {
    if (x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) return false;
    return this.heightAt(x, y) > H_WADE || this.inDock(x, y);
  }

  isWading(x, y) {
    return this.heightAt(x, y) < 0 && !this.inDock(x, y);
  }

  // ---------- Layout ----------
  planLayout() {
    const rand = this.rand;
    const c = WORLD / 2;
    // Village: flat grassy spot near the centre.
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 600; i++) {
      const a = rand() * Math.PI * 2, r = rand() * 420;
      const x = c + Math.cos(a) * r + 80, y = c + Math.sin(a) * r + 120;
      const h = this.heightAt(x, y);
      if (h < 0.2 || h > 0.45) continue;
      const slope = Math.abs(this.heightAt(x + 60, y) - this.heightAt(x - 60, y)) +
        Math.abs(this.heightAt(x, y + 60) - this.heightAt(x, y - 60));
      const score = slope * 8 + Math.hypot(x - c, y - c) / 1500;
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
    this.village = best ?? { x: c, y: c };

    // Dock: march south from the village to the shoreline.
    let sx = this.village.x, sy = this.village.y;
    while (sy < WORLD - 200 && this.heightAt(sx, sy) > -0.005) sy += 4;
    const shoreY = sy;
    let ey = shoreY;
    while (ey < WORLD - 120 && this.heightAt(sx, ey) > H_DEEP - 0.06) ey += 4;
    const dockLen = clamp(ey - shoreY + 60, 200, 320);
    this.shore = { x: sx, y: shoreY };
    this.dock = { x: sx - 34, y: shoreY - 70, w: 68, h: dockLen + 70 };
    this.boat = { x: sx + 110, y: this.dock.y + this.dock.h - 70 };
    this.spawn = { x: sx, y: shoreY - 110 };

    // Hilltop lookout.
    let top = { x: c, y: c, h: -1 };
    for (let gy = 0; gy < GW; gy += 2) for (let gx = 0; gx < GW; gx += 2) {
      const h = this.height[gy * GW + gx];
      if (h > top.h) top = { x: gx * GRID, y: gy * GRID, h };
    }
    this.lookout = top;

    // Paths
    this.paths = [];
    this.addPath(this.spawn.x, this.dock.y + 40, this.village.x, this.village.y + 60, 26);
    this.addPath(this.village.x - 40, this.village.y - 40, top.x + 50, top.y + 60, 20);
    for (let k = 0; k < 2; k++) {
      // Trails out to two more beaches.
      const a = (k === 0 ? Math.PI : 0) + (rand() - 0.5) * 0.6;
      let x = this.village.x, y = this.village.y;
      while (this.heightAt(x, y) > 0.06 && x > 100 && x < WORLD - 100) {
        x += Math.cos(a) * 8; y += Math.sin(a) * 8;
      }
      this.addPath(this.village.x, this.village.y, x, y, 18);
    }
    this.stampPath(this.village.x, this.village.y, 165);
  }

  addPath(x0, y0, x1, y1, width) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    const phase = this.rand() * 10;
    const pts = [];
    for (let d = 0; d <= len; d += 6) {
      const t = d / len;
      const wob = Math.sin(t * Math.PI) * (Math.sin(t * 7 + phase) * 45 + Math.sin(t * 17 + phase) * 12);
      const x = lerp(x0, x1, t) + nx * wob, y = lerp(y0, y1, t) + ny * wob;
      pts.push({ x, y });
      this.stampPath(x, y, width);
    }
    this.paths.push(pts);
  }

  stampPath(x, y, r) {
    const r2 = r * 1.6;
    const gx0 = Math.max(0, Math.floor((x - r2) / PGRID)), gx1 = Math.min(PW - 1, Math.ceil((x + r2) / PGRID));
    const gy0 = Math.max(0, Math.floor((y - r2) / PGRID)), gy1 = Math.min(PW - 1, Math.ceil((y + r2) / PGRID));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const d = Math.hypot(gx * PGRID - x, gy * PGRID - y);
      const v = 1 - smoothstep(r * 0.6, r2, d);
      const i = gy * PW + gx;
      if (v > this.path[i]) this.path[i] = v;
    }
  }

  // ---------- Painting ----------
  paintTerrain(scale = 1) {
    const S = Math.round(WORLD * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(S, S);
    const px = img.data;
    const detailNoise = makeNoise(this.seed + 9);
    const DG = 4, DW = WORLD / DG + 1;
    const detail = new Float32Array(DW * DW);
    for (let gy = 0; gy < DW; gy++) for (let gx = 0; gx < DW; gx++) {
      detail[gy * DW + gx] = fbm(detailNoise, gx * DG / 70, gy * DG / 70, 3);
    }
    // Hill shading from the height gradient (sun from the upper left).
    const shade = new Float32Array(GW * GW);
    for (let gy = 1; gy < GW - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
      const i = gy * GW + gx;
      const dx = this.height[i + 1] - this.height[i - 1];
      const dy = this.height[i + GW] - this.height[i - GW];
      shade[i] = clamp(1 - (dx + dy) * 9, 0.72, 1.25);
    }
    for (let i = 0; i < GW; i++) {
      shade[i] = shade[(GW - 1) * GW + i] = shade[i * GW] = shade[i * GW + GW - 1] = 1;
    }

    const inv = 1 / scale;
    let p = 0;
    for (let sy = 0; sy < S; sy++) {
      const y = sy * inv;
      for (let sx = 0; sx < S; sx++, p += 4) {
        const x = sx * inv;
        const h = sampleGrid(this.height, GW, GRID, x, y);
        if (h < H_DEEP) { px[p + 3] = 0; continue; }
        const grain = hash2(sx, sy) - 0.5;
        const det = sampleGrid(detail, DW, DG, x, y);
        const sh = sampleGrid(shade, GW, GRID, x, y);
        let r, g, b, a = 255;
        if (h < 0) {
          // Shallow lagoon water over sand.
          const t = (h - H_DEEP) / -H_DEEP;
          const ripple = Math.sin(x * 0.045 + det * 14 + Math.sin(y * 0.03) * 2) * 0.5 + 0.5;
          r = lerp(22, 92, t); g = lerp(128, 206, t); b = lerp(160, 196, t);
          const sand = t * t * 0.5;
          r = lerp(r, 214, sand); g = lerp(g, 204, sand); b = lerp(b, 156, sand);
          r += ripple * 14 * t; g += ripple * 14 * t; b += ripple * 10 * t;
          a = 255 * (0.25 + 0.7 * smoothstep(0, 0.55, t));
        } else if (h < H_GRASS + 0.02) {
          const wet = 1 - smoothstep(0, H_SAND, h);
          const ripple = Math.sin(x * 0.07 + y * 0.025 + det * 12) * 5;
          r = 238 + grain * 22 + ripple; g = 218 + grain * 20 + ripple; b = 168 + grain * 18 + ripple;
          r = lerp(r, 186, wet * 0.8); g = lerp(g, 160, wet * 0.8); b = lerp(b, 112, wet * 0.8);
          if (h > H_GRASS - 0.03) {
            const k = smoothstep(H_GRASS - 0.03, H_GRASS + 0.02, h + (det - 0.5) * 0.08 + grain * 0.03);
            const gc = grassColor(this.moistAt(x, y), det, grain);
            r = lerp(r, gc[0], k); g = lerp(g, gc[1], k); b = lerp(b, gc[2], k);
          }
        } else {
          const gc = grassColor(this.moistAt(x, y), det, grain);
          r = gc[0]; g = gc[1]; b = gc[2];
          if (h > H_ROCK - 0.06) {
            const k = smoothstep(H_ROCK - 0.06, H_ROCK + 0.04, h + (det - 0.5) * 0.12);
            const rr = 132 + grain * 30 + det * 20;
            r = lerp(r, rr, k); g = lerp(g, rr - 4, k); b = lerp(b, rr - 18, k);
          }
        }
        if (h > -0.01) {
          const pv = sampleGrid(this.path, PW, PGRID, x, y);
          if (pv > 0.05) {
            const k = smoothstep(0.25, 0.65, pv + grain * 0.35);
            const dr = 168 + grain * 30 + det * 16;
            r = lerp(r, dr, k); g = lerp(g, dr - 38, k); b = lerp(b, dr - 82, k);
          }
          r *= sh; g *= sh; b *= sh;
        }
        px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.scale(scale, scale);
    this.paintDecals(ctx);
    ctx.restore();
    return canvas;
  }

  // Flat details painted straight into the terrain: grass blades, flowers,
  // shells, pebbles, footprints, the dock and the campfire ring.
  paintDecals(ctx) {
    const rand = mulberry32(this.seed + 77);
    const R = (a, b) => a + rand() * (b - a);

    // Grass blades and clover
    for (let i = 0; i < 26000; i++) {
      const x = R(0, WORLD), y = R(0, WORLD);
      const h = this.heightAt(x, y);
      if (h < H_GRASS + 0.01 || h > H_ROCK || this.pathAt(x, y) > 0.3) continue;
      const m = this.moistAt(x, y);
      const dark = rand() < 0.5;
      ctx.strokeStyle = dark ? `rgba(40,${90 + m * 40 | 0},30,0.55)` : `rgba(150,${200 + m * 30 | 0},90,0.45)`;
      ctx.lineWidth = R(1, 2);
      ctx.beginPath();
      const n = 2 + (rand() * 3 | 0);
      for (let k = 0; k < n; k++) {
        const bx = x + R(-4, 4), len = R(5, 11);
        ctx.moveTo(bx, y);
        ctx.quadraticCurveTo(bx + R(-2, 2), y - len * 0.6, bx + R(-4, 4), y - len);
      }
      ctx.stroke();
    }
    // Flowers
    const petals = ['#ff6b8b', '#ffd23f', '#ffffff', '#c084fc', '#ff8c42', '#7dd3fc'];
    for (let i = 0; i < 1600; i++) {
      const x = R(0, WORLD), y = R(0, WORLD);
      const h = this.heightAt(x, y);
      if (h < H_GRASS + 0.03 || h > H_ROCK - 0.05 || this.pathAt(x, y) > 0.2) continue;
      const col = petals[(rand() * petals.length) | 0];
      const cluster = 1 + (rand() * 4 | 0);
      for (let k = 0; k < cluster; k++) {
        const fx = x + R(-14, 14), fy = y + R(-10, 10), s = R(1.6, 2.8);
        ctx.fillStyle = col;
        for (let pIdx = 0; pIdx < 5; pIdx++) {
          const a = pIdx / 5 * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * s, fy + Math.sin(a) * s, s * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe066';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Pebbles on paths and beaches
    for (let i = 0; i < 5000; i++) {
      const x = R(0, WORLD), y = R(0, WORLD);
      const h = this.heightAt(x, y);
      const onPath = this.pathAt(x, y) > 0.5;
      if (!(onPath || (h > 0 && h < H_GRASS - 0.02 && rand() < 0.35))) continue;
      const s = R(1.5, onPath ? 5 : 3.5);
      const v = R(110, 190) | 0;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(x + 1, y + 1.2, s, s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, R(0, 3), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(x - s * 0.3, y - s * 0.25, s * 0.4, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Shells and starfish on the sand
    for (let i = 0; i < 4000; i++) {
      const x = R(0, WORLD), y = R(0, WORLD);
      const h = this.heightAt(x, y);
      if (h < 0.003 || h > 0.08) continue;
      if (rand() < 0.75) continue;
      if (rand() < 0.3) drawStarfish(ctx, x, y, R(5, 8), R(0, 6), rand() < 0.5 ? '#ff7b54' : '#f4a259');
      else drawShell(ctx, x, y, R(3.5, 6), R(0, 6), rand() < 0.5 ? '#fde2e4' : '#f9d5a7');
    }
    // Seaweed in the shallows
    for (let i = 0; i < 2600; i++) {
      const x = R(0, WORLD), y = R(0, WORLD);
      const h = this.heightAt(x, y);
      if (h > -0.03 || h < H_DEEP + 0.02 || rand() < 0.5) continue;
      ctx.strokeStyle = `rgba(30,${110 + (rand() * 40 | 0)},70,0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(x + k * 3, y);
        ctx.bezierCurveTo(x + k * 3 + 6, y - 6, x + k * 3 - 6, y - 12, x + k * 3 + 2, y - 18);
      }
      ctx.stroke();
    }
    // Stepping stones along the main path
    const main = this.paths[0];
    for (let i = 4; i < main.length - 4; i += 5) {
      const pt = main[i];
      const s = R(6, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(pt.x + R(-8, 8) + 1.5, pt.y + 2, s, s * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8a29e';
      ctx.beginPath(); ctx.ellipse(pt.x + R(-8, 8), pt.y, s, s * 0.7, R(0, 3), 0, Math.PI * 2); ctx.fill();
    }
    // Footprints from the dock up the beach
    for (let i = 0; i < 14; i++) {
      const x = this.spawn.x + Math.sin(i * 0.5) * 8 + (i % 2 ? 7 : -7);
      const y = this.dock.y + 20 - i * 22;
      if (this.heightAt(x, y) > H_GRASS) break;
      ctx.fillStyle = 'rgba(120,95,60,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    this.paintDock(ctx);
    this.paintPlaza(ctx);
  }

  paintDock(ctx) {
    const d = this.dock;
    // Posts
    for (let y = d.y + 40; y < d.y + d.h; y += 70) {
      for (const x of [d.x - 4, d.x + d.w - 6]) {
        ctx.fillStyle = 'rgba(0,30,40,0.35)';
        ctx.beginPath(); ctx.ellipse(x + 5, y + 14, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5b3a21';
        ctx.fillRect(x, y - 6, 10, 18);
      }
    }
    // Shadow on the water
    ctx.fillStyle = 'rgba(0,30,40,0.3)';
    ctx.fillRect(d.x + 8, d.y + 60, d.w, d.h - 50);
    const rand = mulberry32(this.seed + 5);
    for (let y = d.y; y < d.y + d.h; y += 12) {
      const tone = 140 + (rand() * 30 | 0);
      ctx.fillStyle = `rgb(${tone},${tone * 0.68 | 0},${tone * 0.42 | 0})`;
      ctx.fillRect(d.x, y, d.w, 11);
      ctx.fillStyle = 'rgba(60,35,15,0.6)';
      ctx.fillRect(d.x, y + 10, d.w, 2);
      ctx.fillStyle = 'rgba(255,240,200,0.18)';
      ctx.fillRect(d.x, y, d.w, 2);
      ctx.fillStyle = '#3b2a1a';
      ctx.fillRect(d.x + 6, y + 4, 2, 2);
      ctx.fillRect(d.x + d.w - 8, y + 4, 2, 2);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = 'rgba(80,50,25,0.35)';
        ctx.fillRect(d.x + rand() * d.w, y + 3 + rand() * 6, 6 + rand() * 14, 1);
      }
    }
    // Rope rails
    ctx.strokeStyle = '#d6c08a'; ctx.lineWidth = 2;
    for (const x of [d.x + 2, d.x + d.w - 2]) {
      ctx.beginPath();
      for (let y = d.y + 40; y < d.y + d.h - 70; y += 70) {
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x, y + 35, x, y + 70);
      }
      ctx.stroke();
    }
  }

  paintPlaza(ctx) {
    const { x, y } = this.village;
    // Stone ring for the campfire
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const sx = x + Math.cos(a) * 26, sy = y + Math.sin(a) * 18;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(sx + 1.5, sy + 2, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i % 2 ? '#8d8a82' : '#a29e94';
      ctx.beginPath(); ctx.ellipse(sx, sy, 7, 5, a, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createRadialGradient(x, y, 2, x, y, 24);
    g.addColorStop(0, '#2a1d14'); g.addColorStop(1, 'rgba(60,40,25,0.4)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 22, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a2f1c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 14, y + 6); ctx.lineTo(x + 12, y - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 12, y - 7); ctx.lineTo(x + 14, y + 5); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Two foam bands, shown with alternating alpha to make waves roll in.
  paintFoam(scale, offset) {
    const S = Math.round(WORLD * scale);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(S, S);
    const px = img.data;
    const noise = makeNoise(this.seed + 31 + offset * 100);
    const inv = 1 / scale;
    const center = -0.012 - offset * 0.05, width = 0.018 + offset * 0.01;
    for (let sy = 0, p = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++, p += 4) {
        const x = sx * inv, y = sy * inv;
        const h = sampleGrid(this.height, GW, GRID, x, y);
        const d = Math.abs(h - center);
        if (d > width || this.inDock(x, y)) continue;
        const brk = fbm(noise, x / 40, y / 40, 3);
        const a = (1 - d / width) * smoothstep(0.3, 0.6, brk + 0.15 - offset * 0.1);
        px[p] = 255; px[p + 1] = 255; px[p + 2] = 255; px[p + 3] = a * 235;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  paintMinimap(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(size, size);
    const k = WORLD / size;
    for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p += 4) {
      const wx = x * k, wy = y * k;
      const h = this.heightAt(wx, wy);
      let c;
      if (h < H_DEEP) c = [22, 84, 128];
      else if (h < 0) c = [52, 160, 176];
      else if (this.pathAt(wx, wy) > 0.5) c = [170, 130, 90];
      else if (h < H_GRASS) c = [232, 210, 160];
      else if (h < H_ROCK) c = lerpC([96, 156, 62], [58, 118, 48], this.moistAt(wx, wy));
      else c = [140, 138, 126];
      if (this.inDock(wx, wy)) c = [150, 100, 60];
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

function grassColor(m, det, grain) {
  const out = lerpC([118, 172, 66], [56, 122, 46], clamp(m * 1.3 - 0.15, 0, 1));
  const patch = smoothstep(0.55, 0.75, det);
  out[0] = out[0] * (1 - patch * 0.18) + grain * 14;
  out[1] = out[1] * (1 - patch * 0.1) + grain * 18;
  out[2] = out[2] * (1 - patch * 0.15) + grain * 10;
  return out;
}

function lerpC(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function sampleGrid(arr, w, cell, x, y) {
  let fx = x / cell, fy = y / cell;
  if (fx < 0) fx = 0; else if (fx > w - 1.001) fx = w - 1.001;
  if (fy < 0) fy = 0; else if (fy > w - 1.001) fy = w - 1.001;
  const ix = fx | 0, iy = fy | 0;
  const tx = fx - ix, ty = fy - iy;
  const i = iy * w + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + w], d = arr[i + w + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function drawStarfish(ctx, x, y, r, rot, col) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  starPath(ctx, 1, 1.5, r); ctx.fill();
  ctx.fillStyle = col;
  starPath(ctx, 0, 0, r); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 - Math.PI / 2;
    ctx.fillRect(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, 1, 1);
  }
  ctx.restore();
}

function starPath(ctx, ox, oy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function drawShell(ctx, x, y, r, rot, col) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.arc(1, 1.5, r, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.lineTo(r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, r * 0.4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(150,100,80,0.5)'; ctx.lineWidth = 0.7;
  for (let i = 1; i < 5; i++) {
    const a = Math.PI + i / 5 * Math.PI;
    ctx.beginPath(); ctx.moveTo(0, r * 0.3); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
  }
  ctx.restore();
}
