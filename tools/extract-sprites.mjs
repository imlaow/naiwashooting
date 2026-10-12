// Cuts the 2x2 character sheet into 4 transparent PNG frames.
// Usage: node tools/extract-sprites.mjs [source.jpg]
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'mmexport1791681378822.jpg';
const OUT = 'public/assets';
const TARGET_H = 220;

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const cellW = Math.floor(W / 2), cellH = Math.floor(H / 2);

function isBg(r, g, b) {
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn > 200 && mx - mn < 30;
}

for (let row = 0; row < 2; row++) {
  for (let col = 0; col < 2; col++) {
    const x0 = col * cellW, y0 = row * cellH;
    const w = cellW, h = cellH;
    const rgba = Buffer.alloc(w * h * 4);
    const bg = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * W + (x0 + x)) * 3, di = (y * w + x) * 4;
      rgba[di] = data[si]; rgba[di + 1] = data[si + 1]; rgba[di + 2] = data[si + 2]; rgba[di + 3] = 255;
    }
    // Flood fill background from the cell border so the cream belly stays opaque.
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (bg[i]) return;
      const p = i * 4;
      if (!isBg(rgba[p], rgba[p + 1], rgba[p + 2])) return;
      bg[i] = 1; stack.push(i);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    // Enclosed pockets of floor shadow between the feet aren't reachable by the
    // flood fill; clear near-white pixels in the bottom quarter directly.
    for (let y = Math.floor(h * 0.55); y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      const mn = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]), mx = Math.max(rgba[p], rgba[p + 1], rgba[p + 2]);
      const loose = y > h * 0.72;
      if (loose ? mn > 150 && mx - mn < 60 : mn > 205 && mx - mn < 30) bg[i] = 1;
    }
    // Keep only the largest foreground blob (drops watermarks / specks).
    const label = new Int32Array(w * h);
    let best = 0, bestSize = 0, next = 1;
    for (let s = 0; s < w * h; s++) {
      if (bg[s] || label[s]) continue;
      let size = 0; const q = [s]; label[s] = next;
      while (q.length) {
        const i = q.pop(); size++;
        const x = i % w, y = (i / w) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!bg[j] && !label[j]) { label[j] = next; q.push(j); }
        }
      }
      if (size > bestSize) { bestSize = size; best = next; }
      next++;
    }
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < w * h; i++) {
      if (label[i] !== best) { rgba[i * 4 + 3] = 0; continue; }
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      // Feather edge pixels that touch the background.
      let n = 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && label[ny * w + nx] !== best) n++;
      }
      if (n) rgba[i * 4 + 3] = 255 - n * 50;
    }
    const pad = 4;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const idx = row * 2 + col;
    await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .resize({ height: TARGET_H })
      .png()
      .toFile(`${OUT}/hero_${idx}.png`);
    console.log(`hero_${idx}.png  bbox ${maxX - minX + 1}x${maxY - minY + 1}`);
  }
}
