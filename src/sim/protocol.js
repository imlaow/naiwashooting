// What a naiwa-server and the browser must agree on. Bump PROTOCOL whenever the sim's rules,
// the room state (server/schema.js), the command or these message formats change: a client
// with a different number is refused with "server runs version N, this site needs M".
//
// Besides the state patches, the room sends these messages:
//   tick       [t, events, born, gone], once a tick when there is something in it:
//                t       the room clock (whole ms since the room started), the clock the state
//                        patches are stamped with, so clients play events and bullets on the
//                        same timeline as the positions
//                events  the sim's events (see sim.js), numbers rounded by packEvents; a
//                        player's 'shot' also carries `seq`, the input it came from
//                born    new bullets, each packBullet(b); clients fly them in a straight line
//                gone    ids of bullets that hit something or ran out of range
//   chat       { n: name, c: colour, t: text } a player's line, { k: 'join' | 'leave' | 'drop' |
//              'back' | 'kick' | 'ban', n, c } someone joining, leaving, dropping out,
//              reconnecting or being put out by the owner, or { k: 'say', t } a line the owner
//              typed into the server's console
//   pong       t: the answer to a client's 'ping', with the clock it sent
// Clients send commands (server/schema.js Command) and the messages 'ready' (run number),
// 'chat' (text) and 'ping' ([their clock, their last measured round trip in ms] — the round
// trip goes on the scoreboard). They send their browser's id (src/online.js browserId) with the
// join, which a ban goes by.
import { WEAPON_ORDER } from './entities.js';

export const PROTOCOL = 8;

// Close codes the room puts a player out with (server/console.js kick and ban): the browser
// says why, and doesn't try to reconnect (the SDK only does after 1001, 1005, 1006 and 4010).
export const KICKED = 4100;
export const BANNED = 4101;

// How long a dropped player's seat is held, and the browser keeps reconnecting, in seconds.
export const RECONNECT_SECONDS = 60;

// Chat: one line a second at most, CHAT_MAX characters, control characters removed.
export const CHAT_MAX = 80;
export const CHAT_GAP = 1;

// A line of text a player typed: printable, trimmed, at most `max` characters ('' if nothing
// is left). Names and chat both go through it.
export function cleanText(s, max) {
  const v = typeof s === 'string' ? s.replace(/[\p{C}]/gu, '').trim() : '';
  return [...v].slice(0, max).join('').trim();
}

// Weapons travel as 1–4 in commands (0: no switch).
export const weaponCode = (k) => WEAPON_ORDER.indexOf(k) + 1;
export const weaponFromCode = (n) => WEAPON_ORDER[n - 1] ?? null;

// Fixes up a decoded command in place. The wire types already bound every number; this keeps
// the stick inside the unit circle and the switches within the guns and a sane wheel count.
// The server runs it on every command it receives and the browser's prediction on its own, so
// both apply exactly the same command.
export function sanitizeCommand(c) {
  const fin = (v) => (Number.isFinite(v) ? v : 0);
  c.mx = fin(c.mx); c.my = fin(c.my); c.aim = fin(c.aim);
  const l = Math.hypot(c.mx, c.my);
  if (l > 1) { c.mx /= l; c.my /= l; }
  c.dashX = fin(c.dashX); c.dashY = fin(c.dashY);
  if (!(Number.isInteger(c.weapon) && c.weapon >= 0 && c.weapon <= 4)) c.weapon = 0;
  c.cycle = Number.isInteger(c.cycle) ? Math.max(-4, Math.min(4, c.cycle)) : 0;
  for (const k of ['fire', 'dash', 'reload', 'last']) c[k] = c[k] === true;
}

// A sanitized wire command (f) → the sim's command (see Player.update), written into `out`.
export function simCommand(f, out) {
  out.mx = f.mx; out.my = f.my; out.aim = f.aim; out.fire = f.fire;
  out.dash = f.dash;
  out.dashDir = f.dashX || f.dashY ? { x: f.dashX, y: f.dashY } : null;
  out.reload = f.reload; out.weapon = weaponFromCode(f.weapon); out.cycle = f.cycle; out.last = f.last;
  return out;
}

// A bullet as it is right after the step that fired it: [id, x, y, angle × 10⁴, speed, life
// in ms, height, tint, orb, scale × 100, owner (a player's id, 0 for an enemy's)]. Small
// integers pack into a few bytes each.
export function packBullet(b) {
  return [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.ang * 1e4), Math.round(Math.hypot(b.vx, b.vy)),
    Math.round(b.life * 1000), b.h, b.tint, b.orb ? 1 : 0, Math.round(b.scale * 100), b.team === 'player' ? b.owner ?? 0 : 0];
}

export function unpackBullet(a) {
  const [id, x, y, ang, speed, life, h, tint, orb, scale, owner] = a;
  const r = ang / 1e4;
  return { id, x, y, ang: r, vx: Math.cos(r) * speed, vy: Math.sin(r) * speed, life: life / 1000, h, tint, orb: !!orb, scale: scale / 100, owner };
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
