// Seeded randomness and value-noise helpers used by world generation.

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fast deterministic integer hash -> [0, 1).
export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Value noise. If `period` is set the noise tiles every `period` units.
export function makeNoise(seed, period = 0) {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const wrap = (v) => {
    if (period) v = ((v % period) + period) % period;
    return v & (SIZE - 1);
  };
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
    const a = table[y0 * SIZE + x0], b = table[y0 * SIZE + x1];
    const c = table[y1 * SIZE + x0], d = table[y1 * SIZE + x1];
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x, y) * amp;
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
