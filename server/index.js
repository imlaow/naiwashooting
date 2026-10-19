// naiwa-server: a self-hosted co-op or PvP server for 奶蛙射击. Runs one NaiwaRoom (room.js) on plain
// ws:// at server.json's port; the owner puts a wss:// address in front of it.
//
//   npm install --prefix server        once
//   npm run server                     from the repo root (server/server.json, else the defaults)
//   node server/index.js my.json       another config file
//
// Browsers join with `new Client(address).join('naiwa', { protocol, name, password, id })`.
// The owner types commands (kick, ban, map, …; `help`) into the terminal it runs in
// (server/console.js); without a terminal it runs the same, without them.
import { readFileSync, existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineServer, defineRoom, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { NaiwaRoom, originAllowed, mapError, SERVER_NAME_MAX, MOTD_MAX } from './room.js';
import { clientAddress, trusted } from './bans.js';
import { BANNED, PROTOCOL } from '../src/sim/protocol.js';
import { openConsole } from './console.js';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));

// server/package.json in the repo; in the npm package (tools/pack-server.mjs) the package.json is
// one level up, next to server/ and src/.
export const VERSION = JSON.parse(readFileSync([here('./package.json'), here('../package.json')].find(existsSync), 'utf8')).version;

// The defaults are server.example.json's.
export const DEFAULTS = JSON.parse(readFileSync(here('./server.example.json'), 'utf8'));

// server.json over the defaults, checked. Throws with a message an owner can act on.
export function readConfig(path) {
  const file = path ?? here('./server.json');
  const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!own && path) throw new Error(`${path} not found`);
  const cfg = { ...DEFAULTS, ...own, file: own ? file : null };
  // Next to server.json (server/bans.json on the defaults).
  cfg.bansFile = join(dirname(file), 'bans.json');
  if (typeof cfg.name !== 'string' || cfg.name.length > SERVER_NAME_MAX) throw new Error(`"name" must be text of at most ${SERVER_NAME_MAX} characters`);
  if (typeof cfg.motd !== 'string' || cfg.motd.length > MOTD_MAX) throw new Error(`"motd" must be text of at most ${MOTD_MAX} characters ("" for none)`);
  if (cfg.mode !== 'coop' && cfg.mode !== 'pvp') throw new Error(`"mode" must be "coop" or "pvp" (got ${JSON.stringify(cfg.mode)})`);
  cfg.pvp = { ...DEFAULTS.pvp, ...own?.pvp };
  const { killLimit, timeLimit } = cfg.pvp;
  if (!Number.isInteger(killLimit) || killLimit < 1 || killLimit > 999) throw new Error('"pvp": "killLimit" must be 1–999 (kills that win a round)');
  if (!Number.isInteger(timeLimit) || timeLimit < 30 || timeLimit > 3600) throw new Error('"pvp": "timeLimit" must be 30–3600 (seconds a round lasts at most)');
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error(`"port" must be a port number (got ${JSON.stringify(cfg.port)})`);
  if (!Number.isInteger(cfg.maxPlayers) || cfg.maxPlayers < 1 || cfg.maxPlayers > 16) throw new Error('"maxPlayers" must be 1–16');
  if (typeof cfg.password !== 'string') throw new Error('"password" must be a string ("" for none)');
  if (!Array.isArray(cfg.maps) || !cfg.maps.length) throw new Error('"maps" must list at least one map, e.g. "island/cove"');
  for (const m of cfg.maps) {
    const why = mapError(m);
    if (why) throw new Error(`${why.replace('". Maps', '" in "maps". Maps')}`);
  }
  if (!Array.isArray(cfg.allowedOrigins)) throw new Error('"allowedOrigins" must be a list of sites (["*"] for any)');
  if (typeof cfg.log !== 'boolean') throw new Error('"log" must be true or false');
  if (typeof cfg.banAddresses !== 'boolean') throw new Error('"banAddresses" must be true or false');
  if (!Array.isArray(cfg.trustProxy) || cfg.trustProxy.some((a) => !isIP(String(a)))) throw new Error('"trustProxy" must be a list of addresses (the tunnel or proxy in front of the server), e.g. ["127.0.0.1", "::1"]');
  return cfg;
}

// The WebSocket transport, which also notes who each socket is from (client.ref.address, for
// bans): the socket's own address, or the address the tunnel or proxy forwarded when the socket
// is from one of config.trustProxy (bans.js clientAddress). Colyseus hands the room only an
// address taken from the headers, which any client can write, so it is read here, where the
// socket is (onConnection runs for every join and reconnect). ws-transport 0.18.4 registers
// onConnection unbound (`this` is the ws server there), so the config comes from the closure.
// A reconnect with the token of a held seat the console kicked or banned is closed with that
// code (NaiwaRoom.kick): Colyseus would close it with FAILED_TO_RECONNECT, which the browser
// shows as a lost connection.
//
// A socket that sent X-Forwarded-For came through a proxy. When that proxy isn't trusted (in
// Docker, a tunnel or Caddy on the host arrives from the bridge's gateway, 172.17.0.1), everyone
// through it is the proxy's address, and banning one of them by address would refuse them all:
// the log says so, once per address.
function transport(config, options) {
  const named = new Set();
  class NaiwaTransport extends WebSocketTransport {
    onConnection(rawClient, req, upgrade) {
      const peer = req.socket.remoteAddress, forwarded = req.headers['x-forwarded-for'];
      rawClient.address = clientAddress(peer, forwarded, config.trustProxy);
      if (forwarded && !trusted(peer, config.trustProxy) && !named.has(rawClient.address)) {
        named.add(rawClient.address);
        console.log(`naiwa-server: a connection from ${rawClient.address} came through a proxy (it sent X-Forwarded-For), but ${rawClient.address} isn't in "trustProxy". So everyone through it counts as ${rawClient.address}, and they can only be banned by browser. If it is your tunnel or proxy (cloudflared, Caddy, nginx; not a raw TCP tunnel), add "${rawClient.address}" to "trustProxy" in ${config.file ?? 'server.json'} and restart (https://www.npmjs.com/package/naiwa-server, "trustProxy").`);
      }
      const token = (upgrade?.url ?? new URL(`ws://server${req.url ?? '/'}`)).searchParams.get('reconnectionToken');
      const out = token && NaiwaRoom.current?.outTokens.get(token);
      if (out) return rawClient.close(out, out === BANNED ? 'banned' : 'kicked');
      return super.onConnection(rawClient, req, upgrade);
    }
  }
  return new NaiwaTransport(options);
}

// The Colyseus server for a config, not listening yet. Browsers' WebSocket upgrades from a
// site that isn't in allowedOrigins are refused before the handshake (programs without an
// Origin header, like the bots in tools/, are let through).
export function makeServer(config) {
  return defineServer({
    greet: false,
    transport: transport(config, {
      beforeUpgrade: (request) => {
        const origin = request.headers.get('origin');
        if (origin && !originAllowed(config.allowedOrigins, origin)) return new Response('origin not allowed', { status: 403 });
      },
    }),
    rooms: { naiwa: defineRoom(NaiwaRoom, { config }) },
  });
}

// Listens and creates the one room.
export async function start(config) {
  const server = makeServer(config);
  // A port in use: ws-transport 0.18.4 prints the error, but Colyseus 0.18.19 only listens for
  // the HTTP server's errors once it is listening, so listen() would never settle.
  const failed = new Promise((_, reject) => server.transport.server.once('error', reject));
  await Promise.race([server.listen(config.port), failed]);
  await matchMaker.createRoom('naiwa', {});
  return server;
}

// Reads the config (`file`, else server/server.json, else the defaults), starts the server and
// the console, and says how it is set up. Exits on a config an owner must fix.
export async function main(file) {
  let config;
  try {
    config = readConfig(file);
  } catch (err) {
    console.error(`naiwa-server: ${err.message}`);
    process.exit(1);
  }
  try {
    await start(config);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`naiwa-server: port ${config.port} is in use (another naiwa-server?). Stop it, or set another "port" in ${config.file ?? 'server.json'}.`);
    process.exit(1);
  }
  openConsole(() => NaiwaRoom.current);
  console.log(`naiwa-server ${VERSION} (protocol ${PROTOCOL}) "${config.name}" on ws://localhost:${config.port} (${config.file ?? 'defaults: copy server/server.example.json to server/server.json to change them'})`);
  const mode = config.mode === 'pvp' ? `PvP deathmatch to ${config.pvp.killLimit} kills or ${config.pvp.timeLimit} s` : 'co-op';
  console.log(`  ${mode}, ${config.maxPlayers} players, maps: ${config.maps.join(', ')}${config.password ? ', password set' : ''}`);
  console.log(`  allowed sites: ${config.allowedOrigins.join(', ') || 'any'}`);
  console.log('  type "help" here for the owner\'s commands (kick, ban, say, map, restart, players)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv[2]);
