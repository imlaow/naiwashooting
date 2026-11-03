// The factory maps. Each plan builds one compound out of Factory's blocks (factory.js): it
// starts with setSize, then places halls, silos, canals, buildings and the yard, puts the three
// weapons down (the tower brings the SMG; the shotgun and the rifle go where the plan says), and
// ends by scattering crates and barrels. `random` rolls a different compound from the seed.
//
// Only Factory's own RNG (`R`, the seed's) may decide anything, so a server and every client build
// the same map. Changing a plan changes its map: bump PROTOCOL (src/sim/protocol.js).

const pick = (R, list) => list[(R() * list.length) | 0];
const between = (R, a, b) => a + R() * (b - a);

export const PLANS = {
  // The milk-and-egg plant: three belts in a big hall, a tank farm and a cold store up north,
  // a milk canal and the loading yard by the gate.
  dairy(f) {
    f.setSize(4000);
    const H = { x: 860, y: 1120, w: 2280, h: 1440 };
    f.village = { x: H.x + H.w / 2, y: H.y + H.h / 2 };
    f.logo = f.village;
    const canal = f.addCanal(2760, [920, 2930]);
    f.addHall(H, [
      { y: 260, dir: 1, m: [0.2, 0.52, 0.84] },
      // The middle belt runs the other way, cut in two around the company egg.
      { y: H.h / 2 - 28, dir: -1, m: [0.5], gap: 260 },
      { y: -316, dir: 1, m: [0.3, 0.7] },
    ], {
      cols: 6,
      mid: [{ y: 490, xs: [0.3, 0.7] }, { y: -520, xs: [0.3, 0.7] }],
      pallets: [[H.x + 380, H.y + 500], [H.x + H.w - 380, H.y + 460], [H.x + H.w - 420, H.y + H.h - 500]],
      forklifts: [[H.x + H.w * 0.5 + 40, H.y + 150], [H.x + H.w * 0.18, H.y + H.h - 500]],
    });

    // Tank farm along the north wall, a water tower (the lookout) and the chimney.
    const farm = { x0: 440, y0: 560, x1: 2060, y1: 940 };
    f.farms.push(farm);
    f.addSilos([0, 1, 2, 3, 4, 5].map((i) => [farm.x0 + 160 + i * 260, 760 + (i % 2) * 40]));
    f.addTower(2440, 720);
    const ch = f.addChimney(3180, 640);

    // Warehouse (west), boiler house (east) and the cold store in the north-east corner.
    const warehouse = f.addBuilding({ x: 380, y: 1250, w: 300, h: 420, H: 150, style: 'warehouse' });
    const boiler = f.addBuilding({ x: 3270, y: 1340, w: 300, h: 300, H: 130, style: 'boiler' });
    const cold = f.addBuilding({ x: 3340, y: 420, w: 300, h: 240, H: 130, style: 'warehouse' });
    f.weaponSpots.push({ x: warehouse.x + warehouse.w / 2, y: warehouse.y + warehouse.h + 50, kind: 'shotgun' });
    // The rifle waits in the far corner behind the tanks.
    f.weaponSpots.push({ x: 390, y: 400, kind: 'rifle' });

    for (const t of f.tanks) f.pipes.push({ pts: [[t.x + 50, t.y + 40], [t.x + 50, farm.y1 + 40], [t.x + 50, H.y + 60]], w: 14, color: '#9aa6ad' });
    f.pipes.push({ pts: [[farm.x1 - 20, 720], [2300, 720], [2300, H.y + 60]], w: 12, color: '#b8c4c8' });
    f.pipes.push({ pts: [[ch.x, ch.y], [ch.x, H.y + 80], [H.x + H.w - 40, H.y + 80]], w: 16, color: '#a15c38' });
    f.pipes.push({ pts: [[cold.x + 40, cold.y + cold.h], [cold.x + 40, H.y + 40], [H.x + H.w - 20, H.y + 40]], w: 12, color: '#b8c4c8' });

    // Loading yard: containers, lorries, stacked pallets; a couple of containers up the sides.
    for (const [x, y, v] of [[500, 3060, 0], [500, 3230, 1], [3480, 3090, 2], [3480, 3260, 1], [1300, 3480, 3], [2700, 3560, 0], [530, 2060, 2], [3450, 2120, 3]]) f.addContainer(x, y, v);
    f.addTruck(2800, 3330);
    f.addTruck(1060, 3160, true);
    f.addTruck(3300, 3640, true);
    for (const [x, y] of [[2420, 3000], [2500, 3020], [1560, 3020], [3100, 3480], [880, 3560], [450, 2320], [3540, 2380]]) f.addPallet(x, y);
    // Between the canal and the hall.
    for (const [x, y] of [[1460, canal.y - 100], [2540, canal.y - 90]]) f.addPallet(x, y);
    f.bays.push([380, 2940, 6], [3080, 2940, 6]);
    f.yard = { x0: 600, x1: 3400, y0: 2980, y1: 3500 };

    f.scatter([
      ['barrel', boiler.x - 50, boiler.y + 140], ['barrel', boiler.x - 40, boiler.y + 200], ['barrel', boiler.x + 60, boiler.y + boiler.h + 60],
      ['crate', f.spawn.x - 150, f.spawn.y - 60], ['crate', f.spawn.x + 160, f.spawn.y - 40],
      ['barrel', 2000, 3010], ['crate', 1860, 1610], ['crate', 2140, 1610], ['barrel', ch.x - 110, ch.y + 40],
      ['crate', cold.x + 60, cold.y + cold.h + 60], ['crate', cold.x + 120, cold.y + cold.h + 70],
    ], 50, 1000);
  },

  // A cold-chain depot: no canal, two cold stores up north with lorries at their doors, a sorting
  // shed with one belt, and a maze of stacked containers where fights happen round corners.
  depot(f) {
    f.setSize(3400);
    f.village = { x: 1700, y: 1700 };
    const west = f.addBuilding({ x: 380, y: 400, w: 520, h: 280, H: 150, style: 'warehouse' });
    const east = f.addBuilding({ x: 2500, y: 400, w: 520, h: 280, H: 150, style: 'warehouse' });
    f.addTower(1700, 600);
    f.pipes.push({ pts: [[west.x + west.w, 470], [east.x, 470]], w: 12, color: '#b8c4c8' });
    f.addTruck(640, 900);
    f.addTruck(2760, 900, true);
    f.addPallet(1000, 860);
    f.addPallet(2400, 860);

    // The sorting shed: one belt, two machines.
    const H = { x: 420, y: 1300, w: 940, h: 700 };
    f.addHall(H, [{ y: 300, dir: 1, m: [0.3, 0.75] }], {
      cols: 3,
      forklifts: [[H.x + H.w * 0.5, H.y + 600]],
    });

    // The container maze: a 4 × 7 grid with gaps.
    const maze = [
      'XX.X',
      'X.XX',
      '.XX.',
      'XX.X',
      'X.XX',
      'XXX.',
      '.X.X',
    ];
    maze.forEach((row, j) => {
      [...row].forEach((c, i) => {
        if (c === 'X') f.addContainer(1760 + i * 380, 1250 + j * 200, (i + j) % 4);
      });
    });

    // A boiler house with its chimney in the south-west, the yard by the gate.
    const boiler = f.addBuilding({ x: 400, y: 2240, w: 280, h: 260, H: 120, style: 'boiler' });
    const ch = f.addChimney(860, 2330);
    f.pipes.push({ pts: [[ch.x, ch.y], [ch.x, H.y + H.h + 60], [H.x + H.w - 60, H.y + H.h + 60]], w: 14, color: '#a15c38' });
    f.addTruck(1100, 2860);
    f.addTruck(2450, 2820, true);
    f.addContainer(2900, 2600, 1);
    for (const [x, y] of [[1420, 2700], [2050, 2600], [2700, 3000], [600, 2900]]) f.addPallet(x, y);
    f.bays.push([820, 2620, 5], [2260, 2620, 5]);
    f.yard = { x0: 700, x1: 2700, y0: 2650, y1: 2950 };

    f.weaponSpots.push({ x: 1760 + 1.5 * 380, y: 1250 + 3 * 200 - 100, kind: 'shotgun' });
    f.weaponSpots.push({ x: 3050, y: 340, kind: 'rifle' });

    f.scatter([
      ['barrel', boiler.x + boiler.w + 50, boiler.y + 120], ['barrel', boiler.x + boiler.w + 60, boiler.y + 190],
      ['crate', f.spawn.x - 150, f.spawn.y - 60], ['crate', f.spawn.x + 160, f.spawn.y - 40],
      ['crate', west.x + 100, west.y + west.h + 70], ['crate', east.x + east.w - 100, east.y + east.h + 70],
    ], 34, 800);
  },

  // A bottling plant: two halls with a street down the middle, a canal along the north between
  // them and the tanks (three bridges), and the boiler house and chimney up in the north-east.
  bottling(f) {
    f.setSize(4000);
    const canal = f.addCanal(900, [700, 1925, 3150]);
    const farm = { x0: 440, y0: 420, x1: 1880, y1: 760 };
    f.farms.push(farm);
    f.addSilos([0, 1, 2, 3, 4].map((i) => [600 + i * 280, 610 + (i % 2) * 40]), 1);
    for (const t of f.tanks) f.pipes.push({ pts: [[t.x + 50, t.y + 40], [t.x + 50, canal.y - 20]], w: 14, color: '#9aa6ad' });
    const boiler = f.addBuilding({ x: 2240, y: 380, w: 300, h: 280, H: 130, style: 'boiler' });
    f.addTower(2900, 640);
    const ch = f.addChimney(3320, 560);
    f.pipes.push({ pts: [[boiler.x + 150, boiler.y + boiler.h + 40], [boiler.x + 150, canal.y - 20]], w: 16, color: '#a15c38' });

    // The two halls, their belts running opposite ways to each other.
    const W = { x: 420, y: 1240, w: 1440, h: 1400 }, E = { x: 2140, y: 1240, w: 1440, h: 1400 };
    for (const [H, d] of [[W, 1], [E, -1]]) {
      f.addHall(H, [
        { y: 240, dir: d, m: d > 0 ? [0.25, 0.7] : [0.3, 0.75] },
        { y: 672, dir: -d, m: [d > 0 ? 0.45 : 0.55] },
        { y: -300, dir: d, m: d > 0 ? [0.3, 0.75] : [0.25, 0.7] },
      ], {
        cols: 4,
        mid: [{ y: 470, xs: [0.5] }, { y: -520, xs: [0.5] }],
        forklifts: [[H.x + H.w * (d > 0 ? 0.62 : 0.38), H.y + 150]],
      });
    }
    // The company egg on the street between them.
    f.village = { x: 2000, y: 1940 };
    f.logo = f.village;
    f.pipes.push({ pts: [[1925 + 75, canal.y + canal.h + 40], [2000, W.y - 80], [W.x + W.w - 60, W.y - 80]], w: 12, color: '#b8c4c8' });
    f.pipes.push({ pts: [[2000, W.y - 80], [E.x + 60, W.y - 80]], w: 12, color: '#b8c4c8' });

    // The yard: a warehouse on the west, containers, lorries.
    const warehouse = f.addBuilding({ x: 420, y: 2920, w: 340, h: 300, H: 150, style: 'warehouse' });
    for (const [x, y, v] of [[1150, 3060, 0], [2900, 3060, 2], [3300, 3300, 1], [3300, 3470, 3], [1250, 3520, 1]]) f.addContainer(x, y, v);
    f.addTruck(1500, 3300);
    f.addTruck(2600, 3450, true);
    for (const [x, y] of [[2350, 2920], [2440, 2940], [1700, 2900], [3550, 2900], [900, 3500]]) f.addPallet(x, y);
    f.bays.push([2700, 2860, 6]);
    f.yard = { x0: 900, x1: 3100, y0: 2950, y1: 3450 };

    f.weaponSpots.push({ x: warehouse.x + warehouse.w / 2, y: warehouse.y + warehouse.h + 50, kind: 'shotgun' });
    f.weaponSpots.push({ x: 3660, y: 340, kind: 'rifle' });

    f.scatter([
      ['barrel', boiler.x - 50, boiler.y + 160], ['barrel', boiler.x - 40, boiler.y + 220], ['barrel', ch.x - 110, ch.y + 40],
      ['crate', f.spawn.x - 150, f.spawn.y - 60], ['crate', f.spawn.x + 160, f.spawn.y - 40],
      ['crate', 1960, 2500], ['crate', 2040, 1400],
    ], 50, 1000);
  },

  // A creamery's tank forest: two big slabs of silos with an avenue between them up north, long
  // sightlines for the rifle, a canal across the middle and a small hall down south.
  tanks(f) {
    f.setSize(3800);
    f.village = { x: 1900, y: 1900 };
    const rows = [700, 1080, 1460];
    for (const [x0, xs] of [[460, [620, 1040, 1460]], [2180, [2340, 2760, 3180]]]) {
      const farm = { x0, y0: 440, x1: x0 + 1160, y1: 1560 };
      f.farms.push(farm);
      const n = f.tanks.length;
      f.addSilos(rows.flatMap((y) => xs.map((x) => [x, y])), n);
      for (const y of rows) f.pipes.push({ pts: [[farm.x0 + 40, y + 30], [farm.x1 - 40, y + 30]], w: 12, color: '#9aa6ad' });
    }
    f.addTower(1900, 640);
    f.addCanal(1760, [900, 1825, 2750]);

    // Down south: a small hall, the boiler house and a warehouse.
    const H = { x: 600, y: 2120, w: 1500, h: 820 };
    f.addHall(H, [
      { y: 250, dir: 1, m: [0.3, 0.7] },
      { y: -300, dir: -1, m: [0.5] },
    ], { cols: 4, forklifts: [[H.x + H.w * 0.8, H.y + 420]] });
    const boiler = f.addBuilding({ x: 2450, y: 2180, w: 300, h: 300, H: 130, style: 'boiler' });
    const ch = f.addChimney(2960, 2300);
    const warehouse = f.addBuilding({ x: 3150, y: 2500, w: 300, h: 300, H: 150, style: 'warehouse' });
    f.pipes.push({ pts: [[ch.x, ch.y], [ch.x, 1940], [H.x + H.w - 40, 1940], [H.x + H.w - 40, H.y - 60]], w: 16, color: '#a15c38' });

    for (const [x, y, v] of [[600, 3150, 1], [3200, 3150, 0], [1250, 3400, 2]]) f.addContainer(x, y, v);
    f.addTruck(2700, 3300);
    for (const [x, y] of [[2300, 3050], [2380, 3070], [450, 3450], [3400, 3450]]) f.addPallet(x, y);
    f.bays.push([2500, 2960, 5]);
    f.yard = { x0: 700, x1: 3100, y0: 3050, y1: 3350 };

    f.weaponSpots.push({ x: warehouse.x + warehouse.w / 2, y: warehouse.y + warehouse.h + 50, kind: 'shotgun' });
    f.weaponSpots.push({ x: 330, y: 340, kind: 'rifle' });

    f.scatter([
      ['barrel', boiler.x - 50, boiler.y + 140], ['barrel', boiler.x - 40, boiler.y + 200], ['barrel', ch.x - 100, ch.y + 60],
      ['crate', f.spawn.x - 150, f.spawn.y - 60], ['crate', f.spawn.x + 160, f.spawn.y - 40],
      ['crate', 1900, 1100], ['crate', 1860, 1400], ['barrel', 1950, 1250],
    ], 44, 1000);
  },

  // A compound rolled from the seed: a band of silos and buildings up north, one big hall or two
  // halls in the middle with side buildings where they fit, a canal north or south of them (or
  // none), and a yard with containers and lorries in front of the gate.
  random(f, R) {
    const S = pick(R, [3200, 3600, 4000]);
    f.setSize(S);
    const { in0, in1 } = f;
    const k = S / 4000;

    // --- North band: a row of silos on one side, the tower, a chimney and a building on the other.
    const nY = Math.round(S * 0.19);
    const n = 3 + ((R() * 4) | 0);
    const left = R() < 0.5;
    const farmW = (n - 1) * 260 + 320;
    const fx0 = left ? 440 : in1 - 180 - farmW;
    const farm = { x0: fx0, y0: nY - 200, x1: fx0 + farmW, y1: nY + 180 };
    f.farms.push(farm);
    f.addSilos(Array.from({ length: n }, (_, i) => [fx0 + 160 + i * 260, nY + (i % 2) * 40]), (R() * 4) | 0);
    // The free stretch beside the farm.
    const a = left ? farm.x1 + 160 : in0 + 140, b = left ? in1 - 120 : farm.x0 - 160;
    const style = R() < 0.5 ? 'boiler' : 'warehouse';
    const bw = 300, bh = style === 'boiler' ? 280 : 240;
    const bx = left ? b - bw : a;
    const north = f.addBuilding({ x: bx, y: nY - bh - 20, w: bw, h: bh, H: 130, style });
    const tx = left ? a + 120 : b - 120;
    f.addTower(tx, nY - 40);
    let ch = null;
    const room = left ? bx - (tx + 58) : tx - 58 - (bx + bw);
    if (room > 320) ch = f.addChimney(left ? (tx + 58 + bx) / 2 : (bx + bw + tx - 58) / 2, nY - 80);
    const rifle = { x: left ? 390 : in1 - 130, y: 400 };

    // --- Canal: north of the halls, south of them, or none.
    const canalAt = pick(R, ['north', 'south', 'south', 'none']);
    const yardH = Math.round(S * (canalAt === 'south' ? 0.2 : 0.22));
    const yardTop = in1 - yardH;
    let mid0 = farm.y1 + 220, mid1 = yardTop - 180;
    const bridgeXs = (y) => {
      const m = 2 + (R() < 0.5 ? 1 : 0);
      const xs = [];
      for (let i = 0; i < m; i++) xs.push(Math.round(in0 + 200 + ((in1 - in0 - 550) * (i + between(R, 0.25, 0.75))) / m));
      return f.addCanal(y, xs);
    };
    if (canalAt === 'north') {
      const c = bridgeXs(farm.y1 + 120);
      mid0 = c.y + c.h + 260;
    } else if (canalAt === 'south') {
      const c = bridgeXs(yardTop - 140);
      mid1 = c.y - 220;
    }
    // Pipes from the silos down toward the halls (or the canal).
    const pipeEnd = canalAt === 'north' ? farm.y1 + 100 : mid0 - 60;
    for (const t of f.tanks) f.pipes.push({ pts: [[t.x + 50, t.y + 40], [t.x + 50, pipeEnd]], w: 14, color: '#9aa6ad' });

    // --- Halls.
    const hallH = mid1 - mid0;
    const rowsFor = (H, d) => {
      const m = Math.max(1, Math.min(3, Math.floor((H.h - 160) / 400)));
      const span = H.w - 340;
      const sets = [[0.5], [0.3, 0.7], [0.25, 0.7], [0.2, 0.52, 0.84], [0.35, 0.75]].filter((s) => s.length * 260 < span);
      const rows = [];
      for (let i = 0; i < m; i++) {
        const y = m === 1 ? H.h / 2 - 28 : Math.round(240 + (i * (H.h - 240 - 300)) / (m - 1));
        const gap = m === 3 && i === 1 && span > 1500 && R() < 0.6 ? 260 : 0;
        rows.push({ y, dir: i % 2 ? -d : d, m: gap ? [0.5] : pick(R, sets), gap });
      }
      const mid = [];
      for (let i = 0; i + 1 < rows.length; i++) mid.push({ y: Math.round((rows[i].y + 56 + rows[i + 1].y - 40) / 2) + 4, xs: span > 1200 ? [0.3, 0.7] : [0.5] });
      return { rows, mid };
    };
    const two = R() < 0.4;
    const halls = [];
    if (two) {
      const street = 300;
      const w = Math.floor((in1 - in0 - 240 - street) / 2);
      halls.push({ x: in0 + 120, y: mid0, w, h: hallH }, { x: in1 - 120 - w, y: mid0, w, h: hallH });
    } else {
      const w = Math.round(S * between(R, 0.5, 0.6));
      halls.push({ x: Math.round(S / 2 - w / 2), y: mid0, w, h: hallH });
    }
    const d0 = R() < 0.5 ? 1 : -1;
    halls.forEach((H, i) => {
      const { rows, mid } = rowsFor(H, i ? -d0 : d0);
      f.addHall(H, rows, { cols: Math.max(2, Math.round(H.w / 380)), mid, forklifts: [[H.x + H.w * 0.5 + 40, H.y + 150]] });
      if (rows.some((r) => r.gap)) f.logo = { x: H.x + H.w / 2, y: H.y + H.h / 2 };
    });
    f.village = f.logo ?? (two ? { x: S / 2, y: mid0 + hallH / 2 } : { x: halls[0].x + halls[0].w / 2, y: halls[0].y + halls[0].h / 2 });
    if (two && R() < 0.6) f.logo = f.village;

    // --- Side buildings beside a single hall, where the strip is wide enough.
    let shotgun = null;
    const fixed = [];
    if (!two) {
      const H = halls[0];
      const strip = H.x - 40 - in0;
      if (strip >= 440) {
        const w = Math.min(320, strip - 140);
        const wh = f.addBuilding({ x: in0 + 70, y: H.y + Math.round(H.h * 0.15), w, h: Math.min(420, Math.round(H.h * 0.4)), H: 150, style: 'warehouse' });
        shotgun = { x: wh.x + wh.w / 2, y: wh.y + wh.h + 50 };
        const bo = f.addBuilding({ x: in1 - 70 - w, y: H.y + Math.round(H.h * 0.3), w, h: Math.min(300, Math.round(H.h * 0.35)), H: 130, style: 'boiler' });
        fixed.push(['barrel', bo.x - 50, bo.y + 120], ['barrel', bo.x - 40, bo.y + 190]);
      }
    }

    // --- Yard: lorries, containers and pallets, kept off the road in from the gate.
    const g = f.gate;
    const road = { x: g.x - 160, y: yardTop - 100, w: g.w + 320, h: in1 - yardTop + 100 };
    const yard = { x0: in0 + 60, x1: in1 - 60, y0: yardTop, y1: in1 - 60 };
    const placeRect = (w, h, pad) => {
      for (let i = 0; i < 80; i++) {
        const x = Math.round(between(R, yard.x0, yard.x1 - w)), y = Math.round(between(R, yard.y0, yard.y1 - h));
        const r = { x, y, w, h };
        const offRoad = x + w + pad < road.x || x - pad > road.x + road.w;
        if (offRoad && f.rectFree(r, pad)) return r;
      }
      return null;
    };
    if (!shotgun) {
      // No side buildings: a warehouse in the yard holds the shotgun.
      const r = placeRect(300, 260, 90);
      if (r) {
        const wh = f.addBuilding({ x: r.x, y: r.y, w: 300, h: 260, H: 140, style: 'warehouse' });
        shotgun = { x: wh.x + wh.w / 2, y: wh.y + wh.h + 50 };
      }
    }
    for (let i = 0, m = 1 + ((R() * 3) | 0); i < m; i++) {
      const r = placeRect(300, 62, 90);
      if (r) f.addTruck(r.x + 150, r.y + 62, R() < 0.5);
    }
    for (let i = 0, m = Math.round((3 + R() * 4) * k); i < m; i++) {
      const r = placeRect(244, 58, 80);
      if (r) f.addContainer(r.x + 122, r.y + 58, (R() * 4) | 0);
    }
    for (let i = 0, m = Math.round((3 + R() * 4) * k); i < m; i++) {
      const r = placeRect(60, 60, 40);
      if (r) f.addPallet(r.x + 30, r.y + 50);
    }
    f.bays.push([in0 + 120, yardTop + 40, 4 + ((R() * 3) | 0)]);
    if (R() < 0.6) f.bays.push([in1 - 120 - 90 * 5, yardTop + 40, 5]);
    f.yard = { x0: in0 + 340, x1: in1 - 340, y0: yardTop + 80, y1: in1 - 240 };

    f.weaponSpots.push({ ...(shotgun ?? { x: S / 2, y: yardTop + 60 }), kind: 'shotgun' });
    f.weaponSpots.push({ ...rifle, kind: 'rifle' });

    f.scatter([
      ['crate', f.spawn.x - 150, f.spawn.y - 60], ['crate', f.spawn.x + 160, f.spawn.y - 40],
      ...(ch ? [['barrel', ch.x - 110, ch.y + 40]] : []),
      ['crate', north.x + 60, north.y + north.h + 60],
      ...fixed,
    ], Math.round(50 * k * k), 1000);
  },
};
