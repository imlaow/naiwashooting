// naiwa-server: a self-hosted co-op or PvP server for 奶蛙射击. Runs one NaiwaRoom (room.js) on plain
// ws:// at server.json's port; the owner puts a wss:// address in front of it.
//
//   npm install --prefix server        once
//   npm run server                     from the repo root (server/server.json, else the defaults)
//   node server/index.js my.json       another config file
//
// Browsers join with `new Client(address).join('naiwa', { protocol, name, password })`.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineServer, defineRoom, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { THEMES } from '../src/sim/maps.js';
import { NaiwaRoom, originAllowed } from './room.js';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));

// The defaults are server.example.json's.
export const DEFAULTS = JSON.parse(readFileSync(here('./server.example.json'), 'utf8'));

// server.json over the defaults, checked. Throws with a message an owner can act on.
export function readConfig(path) {
  const file = path ?? here('./server.json');
  const own = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (!own && path) throw new Error(`${path} not found`);
  const cfg = { ...DEFAULTS, ...own, file: own ? file : null };
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
    const [theme, id] = String(m).split('/');
    const th = THEMES.find((x) => x.id === theme);
    if (!th || !(th.variants.some((v) => v.id === id) || (th.random && id === 'random'))) {
      const all = THEMES.flatMap((x) => [...x.variants.map((v) => `${x.id}/${v.id}`), ...(x.random ? [`${x.id}/random`] : [])]);
      throw new Error(`unknown map "${m}" in "maps". Maps: ${all.join(', ')}`);
    }
  }
  if (!Array.isArray(cfg.allowedOrigins)) throw new Error('"allowedOrigins" must be a list of sites (["*"] for any)');
  if (typeof cfg.log !== 'boolean') throw new Error('"log" must be true or false');
  return cfg;
}

// The Colyseus server for a config, not listening yet. Browsers' WebSocket upgrades from a
// site that isn't in allowedOrigins are refused before the handshake (programs without an
// Origin header, like the bots in tools/, are let through).
export function makeServer(config) {
  return defineServer({
    greet: false,
    transport: new WebSocketTransport({
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
  await server.listen(config.port);
  await matchMaker.createRoom('naiwa', {});
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let config;
  try {
    config = readConfig(process.argv[2]);
  } catch (err) {
    console.error(`naiwa-server: ${err.message}`);
    process.exit(1);
  }
  await start(config);
  console.log(`naiwa-server "${config.name}" on ws://localhost:${config.port} (${config.file ?? 'defaults: copy server/server.example.json to server/server.json to change them'})`);
  const mode = config.mode === 'pvp' ? `PvP deathmatch to ${config.pvp.killLimit} kills or ${config.pvp.timeLimit} s` : 'co-op';
  console.log(`  ${mode}, ${config.maxPlayers} players, maps: ${config.maps.join(', ')}${config.password ? ', password set' : ''}`);
  console.log(`  allowed sites: ${config.allowedOrigins.join(', ') || 'any'}`);
}
