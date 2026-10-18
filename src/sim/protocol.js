// What a naiwa-server and the browser must agree on. Bump PROTOCOL whenever the sim's rules,
// the room state (server/schema.js), the command or these message formats change: a client
// with a different number is refused with "server runs version N, this site needs M".
//
// Besides the state patches, the room sends three messages once per tick when there is
// something in them:
//   events     the sim's events of that tick (see sim.js), numbers rounded by packEvents
//   bullet     new bullets, each packBullet(b); clients move them in a straight line
//   bulletEnd  ids of bullets that hit something or ran out of range
import { WEAPON_ORDER } from './entities.js';

export const PROTOCOL = 1;

// Weapons travel as 1–4 in commands (0: no switch).
export const weaponCode = (k) => WEAPON_ORDER.indexOf(k) + 1;
export const weaponFromCode = (n) => WEAPON_ORDER[n - 1] ?? null;

// A bullet as it is right after the step that fired it: [id, x, y, angle × 10⁴, speed, life
// in ms, height, tint, orb, scale × 100]. Small integers pack into a few bytes each.
export function packBullet(b) {
  return [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.ang * 1e4), Math.round(Math.hypot(b.vx, b.vy)),
    Math.round(b.life * 1000), b.h, b.tint, b.orb ? 1 : 0, Math.round(b.scale * 100)];
}

export function unpackBullet(a) {
  const [id, x, y, ang, speed, life, h, tint, orb, scale] = a;
  const r = ang / 1e4;
  return { id, x, y, ang: r, vx: Math.cos(r) * speed, vy: Math.sin(r) * speed, life: life / 1000, h, tint, orb: !!orb, scale: scale / 100 };
}

// Positions to whole pixels, everything else to 2 decimals (angles stay within 0.3°).
const POS = new Set(['x', 'y', 'px', 'py', 'ex', 'ey']);
const round = (k, v) => (POS.has(k) ? Math.round(v) : Math.round(v * 100) / 100);
function packValue(k, v) {
  if (typeof v === 'number') return Number.isFinite(v) ? round(k, v) : v;
  if (Array.isArray(v)) return v.map((o) => packValue(k, o));
  if (v && typeof v === 'object') {
    const o = {};
    for (const key in v) o[key] = packValue(key, v[key]);
    return o;
  }
  return v;
}
export const packEvents = (list) => list.map((e) => packValue('', e));
