// The owner's console: commands typed into the terminal naiwa-server runs in. Nobody else can
// reach it (it isn't on the network), so there is no login: whoever has the terminal is the
// owner. `help` lists the commands; command(room, line) runs one and returns what to print,
// which is also how the tests drive it.
//
// The terminal is optional. With stdin closed or not a terminal (Docker without -it, a service,
// `npx naiwa-server < /dev/null`) the console reads nothing, or what is piped in, and the
// server runs on after the end of it. Started in the background of a shell (`npx naiwa-server
// &`), reading the terminal would get the whole server stopped (SIGTTIN); the signal is caught,
// so the read fails instead and the server runs without a console.
import { createInterface } from 'node:readline';
import { isIP } from 'node:net';
import { addressKey } from './bans.js';
import { RECONNECT_SECONDS, BANNED } from '../src/sim/protocol.js';

const HELP = `Commands:
  players (or list)     who is here, with their numbers, and who left lately
  kick <player>         out of the server; they may join again
  ban <player|address>  out, and refused from now on: a player by browser and address (server.json
                        "banAddresses"), an address with everyone here from it
  bans                  the ban list (bans.json next to server.json)
  unban <n|name|address>  lift a ban (n: its number in "bans")
  say <text>            a line to everyone, from the server
  map [theme/id|next]   another map now (no argument: this one and the rotation)
  restart               this map again from the start
  help                  this
A <player> is their number in "players" (3 or #3) or their name.`;

const ago = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const where = (seat) => (seat.dropped ? `away (seat held up to ${RECONNECT_SECONDS} s)` : seat.id ? 'playing' : 'loading');

// The seat (or, with `left`, the player who left lately) `q` names: { sid, seat } / { gone }, or
// { error }. A number is a player's number first; a name must match one of them only.
function findPlayer(room, q, { left = false } = {}) {
  if (!q) return { error: 'who? A number from "players" or a name' };
  const here = [...room.seats].map(([sid, seat]) => ({ sid, seat }));
  const num = /^#?(\d+)$/.exec(q);
  if (num) {
    const n = Number(num[1]);
    const s = here.find((x) => x.seat.no === n);
    if (s) return s;
    const g = left && room.recent.find((r) => r.no === n);
    if (g) return { gone: g };
    if (q.startsWith('#')) return { error: `nobody is #${n}${left ? ' or left lately as it' : ''}` };
  }
  const name = q.toLowerCase();
  const named = here.filter((x) => x.seat.name.toLowerCase() === name);
  if (named.length === 1) return named[0];
  if (named.length > 1) return { error: `${named.length} players are called ${q}: use a number (${named.map((x) => `#${x.seat.no}`).join(', ')})` };
  const gone = left ? room.recent.filter((r) => r.name.toLowerCase() === name) : [];
  if (gone.length === 1) return { gone: gone[0] };
  if (gone.length > 1) return { error: `${gone.length} who left were called ${q}: use a number (${gone.map((r) => `#${r.no}`).join(', ')})` };
  return { error: `nobody here is called ${q}${left ? ' or left lately' : ''} (see "players")` };
}

function players(room) {
  const cfg = room.config, S = room.state;
  const lines = [`${room.seats.size}/${cfg.maxPlayers} players, ${cfg.mode === 'pvp' ? 'PvP' : 'co-op'} on ${S.map.theme}/${S.map.id}, ${S.phase}${S.phase === 'run' ? '' : ` (${Math.ceil(S.phaseT)} s)`}`];
  for (const seat of room.seats.values()) {
    lines.push(`  #${seat.no} ${seat.name}  ${where(seat)}  ${seat.ip ?? 'address unknown'}  ${seat.ping} ms`);
  }
  if (room.recent.length) {
    lines.push('Left lately (you can still ban them):');
    for (const r of room.recent) lines.push(`  #${r.no} ${r.name}  ${r.ip ?? 'address unknown'}  ${ago(Date.now() - r.at)}`);
  }
  return lines.join('\n');
}

function banList(room) {
  const list = room.bans.list;
  if (!list.length) return 'Nobody is banned.';
  return list.map((b, i) => `  ${i + 1}. ${b.name || '(no name)'}  ${b.ip ?? 'no address'}  ${b.id ? `browser ${b.id.slice(0, 8)}…` : 'no browser id'}  ${b.at.slice(0, 16).replace('T', ' ')}`).join('\n');
}

function ban(room, q) {
  if (!q) return 'ban whom? A number from "players", a name or an address';
  if (isIP(q)) {
    if (room.config.banAddresses === false) return 'address bans are off in server.json ("banAddresses": false)';
    const entry = room.ban({ name: '', bid: '', ip: q });
    if (!entry) return `${q} is this machine: it can't be banned by address`;
    // As Minecraft's ban-ip: everyone here from it goes too.
    const out = [...room.seats].filter(([, s]) => addressKey(s.ip) === entry.ip);
    for (const [sid] of out) room.kick(sid, BANNED);
    return `banned ${entry.ip}${out.length ? ` (and out: ${out.map(([, s]) => s.name).join(', ')})` : ''}`;
  }
  const t = findPlayer(room, q, { left: true });
  if (t.error) return t.error;
  const who = t.seat ?? t.gone;
  const entry = room.ban(who, t.sid ?? null);
  if (!entry) return `${who.name} has no browser id and an address that can't be banned: kick them instead`;
  const by = [entry.id && 'browser', entry.ip && `address ${entry.ip}`].filter(Boolean).join(' and ');
  return `banned ${who.name} by ${by}${t.sid ? '' : ' (they had already left)'}`;
}

function unban(room, q) {
  const list = room.bans.list;
  if (!q) return 'unban which? A number from "bans", a name or an address';
  let found;
  if (/^\d+$/.test(q)) found = list[Number(q) - 1] ? [list[Number(q) - 1]] : [];
  else if (addressKey(q)) found = list.filter((b) => b.ip === addressKey(q));
  else found = list.filter((b) => b.name.toLowerCase() === q.toLowerCase() || b.id === q);
  if (!found.length) return `no ban matches ${q} (see "bans")`;
  if (found.length > 1 && !addressKey(q)) return `${found.length} bans match ${q}: use a number from "bans"`;
  for (const b of found) room.bans.remove(b);
  return `unbanned ${found.map((b) => b.name || b.ip).join(', ')}`;
}

// Runs one line; returns what to print ('' for an empty line).
export function command(room, line) {
  const text = String(line ?? '').trim();
  if (!text) return '';
  const [word] = text.split(/\s+/, 1);
  const arg = text.slice(word.length).trim();
  const cmd = word.toLowerCase();
  if (cmd === 'help' || cmd === '?') return HELP;
  if (!room) return 'the room isn\'t up yet';
  switch (cmd) {
    case 'players': case 'list': return players(room);
    case 'kick': {
      const t = findPlayer(room, arg);
      if (t.error) return t.error;
      room.kick(t.sid);
      return `kicked ${t.seat.name}`;
    }
    case 'ban': return ban(room, arg);
    case 'bans': return banList(room);
    case 'unban': return unban(room, arg);
    case 'say': {
      if (!arg) return 'say what?';
      return `[server] ${room.say(arg)}`;
    }
    case 'map': {
      if (!arg) {
        const { map } = room.state, maps = room.config.maps;
        return `now ${map.theme}/${map.id}${room.offRotation ? ' (outside the rotation)' : ''}; rotation: ${maps.map((m, i) => (i === room.rotation % maps.length ? `[${m}]` : m)).join(', ')}`;
      }
      const why = room.changeMap(arg);
      if (why) return why;
      return `map ${room.state.map.theme}/${room.state.map.id}: everyone loads it, then its lobby`;
    }
    case 'restart':
      room.restart();
      return `${room.state.map.theme}/${room.state.map.id} from the start: its lobby`;
    default:
      return `unknown command "${word}" (try "help")`;
  }
}

// Reads commands from `input` (stdin) for the room `room()` returns, printing the answers.
// Nothing here ends the process: at the end of the input the server runs on.
export function openConsole(room, { input = process.stdin, print = console.log } = {}) {
  process.on('SIGTTIN', () => {});
  input.on('error', () => {});
  // terminal: false: the terminal keeps its own line editing, and Ctrl+C stops the server as it
  // always has (readline's terminal mode would catch it).
  const rl = createInterface({ input, terminal: false });
  rl.on('line', (line) => {
    let out;
    try { out = command(room(), line); } catch (err) { out = `that failed: ${err.message}`; }
    if (out) print(out);
  });
  return rl;
}
