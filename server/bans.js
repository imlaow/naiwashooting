// Bans: who may not join, kept in bans.json next to server.json (server/console.js's ban and
// unban change it). An entry is { name, id, ip, at }: `id` is the random id the player's browser
// keeps (src/online.js browserId), `ip` the address they joined from (null when address bans are
// off in server.json, "banAddresses": false, or the address is this machine). A join matching
// either is refused (NaiwaRoom.refuse by id, NaiwaRoom.onJoin by address).
//
// Neither is proof of who someone is: a new address (mobile data, a VPN, a router restart) or a
// new id (another browser, a private window, cleared site data) gets them back in, and an address
// shared by many (a mobile carrier's NAT, a school) bans everyone behind it. IPv6 addresses are
// banned by their /64, since devices change the rest by themselves.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { isIP } from 'node:net';

// An IPv4 address that arrives as ::ffff:a.b.c.d (a dual-stack socket) as a.b.c.d.
const plain = (ip) => String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

// An address as bans keep it: IPv4 as is (also when it arrives as ::ffff:a.b.c.d), IPv6 as its
// /64 ("2001:db8:1:2::/64"); null for anything that isn't an address.
export function addressKey(ip) {
  // A key already (bans.json): as is.
  const s = plain(ip).replace(/\/64$/, '');
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind !== 6) return null;
  const [head, tail = ''] = s.toLowerCase().split('::');
  const a = head ? head.split(':') : [], b = s.includes('::') && tail ? tail.split(':') : [];
  const groups = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export const isLoopback = (ip) => plain(ip) === '::1' || /^127\./.test(plain(ip));

// Who is on the other end of a connection. `peer` is the socket's address; only when it is one
// of `trust` (server.json "trustProxy": the tunnel or proxy on this machine) is the forwarded
// address believed, and then only the last X-Forwarded-For entry: the one that proxy wrote
// itself (Cloudflare's edge, Caddy and nginx all put the address they saw last). Anything a
// client wrote into the header comes before it. CF-Connecting-IP isn't read: behind Caddy a
// client could send its own.
export function clientAddress(peer, forwarded, trust = []) {
  const p = plain(peer);
  if (!trust.some((t) => plain(t) === p)) return p || null;
  const last = plain(String(forwarded ?? '').split(',').pop());
  return isIP(last) ? last : p || null;
}

export class Bans {
  // `file`: where they are kept (null: only in memory, as in the tests).
  constructor(file = null) {
    this.file = file;
    this.list = [];
    if (file && existsSync(file)) {
      let v;
      try { v = JSON.parse(readFileSync(file, 'utf8')); } catch (err) { throw new Error(`${file}: ${err.message}`); }
      if (!Array.isArray(v)) throw new Error(`${file} must be a list of bans`);
      this.list = v.filter((b) => b && typeof b === 'object').map((b) => ({
        name: String(b.name ?? ''), id: typeof b.id === 'string' ? b.id : '', ip: addressKey(b.ip), at: String(b.at ?? ''),
      }));
    }
  }

  // The ban a join with this browser id or address falls under, or null.
  find({ id, ip }) {
    const k = addressKey(ip);
    return this.list.find((b) => (id && b.id === id) || (k && b.ip === k)) ?? null;
  }

  add({ name, id, ip }) {
    const entry = { name, id: id || '', ip: addressKey(ip), at: new Date().toISOString() };
    this.list.push(entry);
    this.save();
    return entry;
  }

  remove(entry) {
    this.list = this.list.filter((b) => b !== entry);
    this.save();
  }

  // Written whole to a new file that then replaces the old one, so a crash mid-write can't leave
  // half a list.
  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.list, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
