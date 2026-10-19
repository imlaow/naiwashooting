#!/usr/bin/env node
// `npx naiwa-server [server.json]`: the command the npm package and the Docker image run
// (tools/pack-server.mjs). Unlike `npm run server` in the repo, the config is the owner's own:
// server.json in the directory it is started from (bans.json goes next to it), created from
// server.example.json on a first run so there is a file to edit.
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [arg] = process.argv.slice(2);
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`naiwa-server needs Node 22 or newer (this is ${process.version}): https://nodejs.org`);
  process.exit(1);
}
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
if (arg === '--version' || arg === '-v') {
  console.log(JSON.parse(readFileSync([here('./package.json'), here('../package.json')].find(existsSync), 'utf8')).version);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(`naiwa-server [server.json]

Runs a 奶蛙射击 (Naiwa Shootout) server on plain ws:// at server.json's "port" (7777).
Players need a wss:// address in front of it (a Cloudflare tunnel or Caddy): see https://www.npmjs.com/package/naiwa-server

  server.json   the config (default: ./server.json, created from the example on a first run)
                bans.json is kept next to it

Type "help" in this terminal once it runs for the owner's commands (players, kick, ban, say,
map, restart).`);
  process.exit(0);
}

const file = resolve(arg ?? 'server.json');
if (!arg && !existsSync(file)) {
  try {
    copyFileSync(here('./server.example.json'), file);
  } catch (err) {
    // In Docker: a host directory mounted on /data that the image's user (node, uid 1000) can't write.
    console.error(`naiwa-server: can't create ${file} (${err.code}). Make its directory writable for this user (uid ${process.getuid?.()}): for a directory mounted into Docker, sudo chown 1000:1000 <directory>.`);
    process.exit(1);
  }
  console.log(`naiwa-server: created ${file} from the example. Edit it (name, mode, password, maps…) and restart to change them.`);
}
const { main } = await import('./index.js');
await main(file);
