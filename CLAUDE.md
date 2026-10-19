# 奶蛙射击 (Naiwa Shootout)

See `README.md` for running the game, controls and the code map.

## Repo and deploy

- Source: private GitHub repo `imlaow/naiwashooting`, branch `main`.
- Deploy: Cloudflare Workers Builds builds and deploys the Worker `naiwa-shootout` (`wrangler.jsonc`)
  on every push to `main` (`npm run build`, then `npx wrangler deploy`). Never deploy from this
  machine. Check builds and change settings through the Cloudflare plugin.
- The Worker is static-only: it serves `dist/` and has no server code. The game server
  (`server/`, its own `package.json`, installed with `npm install --prefix server`) isn't deployed
  anywhere: owners run it themselves, from the published package or image below.
- Published (public, Apache-2.0; they carry the server and the `src/` files it imports, so that
  code is public even though the repo isn't):
  - npm: [`naiwa-server`](https://www.npmjs.com/package/naiwa-server) (`npx naiwa-server@latest`),
    built by `tools/pack-server.mjs` into `build/naiwa-server/` (copied, not bundled; its README is
    `docs/hosting.md`). `server/package.json` stays `"private": true` so `server/` itself can't be
    published by mistake.
  - Docker: `ghcr.io/imlaow/naiwa-server` (`:<version>` and `:latest`, linux/amd64 and
    linux/arm64), from `server/Dockerfile`.
- Publishing the next version (do it whenever `PROTOCOL` changes, together with the site's push:
  the site refuses servers on another protocol):
  1. Bump `version` in `server/package.json`, then run the checks below.
  2. `node tools/pack-server.mjs` (fails on any file outside its allowlist; read the list), and try
     the tarball: `npm install <tgz>` in an empty directory outside the repo, start it, and point
     `node tools/bot-clients.mjs --server ws://127.0.0.1:7777` (and `--pvp`) at it.
  3. `npm publish` from `build/naiwa-server/` (needs `npm login`).
  4. `docker buildx build -f server/Dockerfile --platform linux/arm64,linux/amd64 -t
     ghcr.io/imlaow/naiwa-server:<version> -t ghcr.io/imlaow/naiwa-server:latest --push .` from
     the repo root, in the background (needs `docker login ghcr.io` with a `write:packages` token).
  5. From outside: `npx naiwa-server@<version>` in an empty directory, and `docker pull` plus run.

## Online play

Done (all 7 stages, 2026-10-19): self-hosted servers in the style of Minecraft (co-op and PvP,
owners put a `wss://` tunnel or proxy in front), built on Colyseus 0.18 rather than our own
netcode. The design and what each stage built are in `docs/online.md`; the owners' guide
(npx, Docker, tunnels, Caddy, `trustProxy`, the console) is `docs/hosting.md`, in Chinese and
English. Keep both up to date, and every command in `docs/hosting.md` either run or marked as not
run.

Admin is a console on the server's own terminal (`server/console.js`: kick, ban, say, map,
restart; no admin page, password or admin room message). It must keep working with stdin closed,
not a terminal, or a background job's terminal (`node --test server/test/console.test.js`).
Bans go by browser id and address (`server/bans.js`, `bans.json` next to `server.json`); the
address comes from the socket, or from the last `X-Forwarded-For` entry only when the socket is
from a `trustProxy` address (in Docker the network's gateway, `172.17.0.1`; behind a raw TCP
tunnel `[]`).

All game logic is in `src/sim/` (no Pixi, DOM, audio or HUD imports); `src/view/` draws it. After
touching `src/sim/`, run `node tools/sim-headless.mjs` and `node tools/sim-headless.mjs --players 4`
(both must end with "no errors"), `node tools/sim-rules.mjs` ("all rules hold") and
`node tools/dump-layouts.mjs --check`.

After touching `server/`, `src/net/`, `src/sim/protocol.js` or anything the room state carries,
run `npm run test:server` (all pass; `server/test/console.test.js` starts real servers on port
2571), `node tools/bot-clients.mjs` ("no errors"; it starts its own server on port 7790) and
`node tools/bot-clients.mjs --pvp --port 7792` (bots shooting each other, "no errors"). Also run
`node tools/pack-server.mjs` after an import into `server/` or `src/sim/` changes: the package
copies what the imports reach, and its allowlist must still pass. After touching the prediction, the timeline or how the room takes
commands, also run `node tools/net-feel.mjs` (port 7791, about 6 minutes): at 0 and 80 ms the
prediction error should stay at the wire's rounding (p95 well under 1 px) and B be drawn without
starving the timeline. After touching lag compensation (the render-time stamp, `Sim.seen`,
`NaiwaRoom.seenAt`, the own bullets `NetSim` flies) or PvP rules, also run
`node tools/net-feel.mjs --pvp --port 7793` (about 7 minutes): the target as seen against as
tested should stay under 1 px at p95 at 0–150 ms (about 5 px at 250 ms, where late commands get
folded), and the prediction error after each PvP event at the wire's rounding. The local player's prediction runs the sim's own `Player.update`, so a
change to player movement or shooting in `src/sim/` reaches it by itself; anything the step reads
must be in the room state (`server/schema.js`) and adopted in `NetSim.adopt`.

Bump `PROTOCOL` in `src/sim/protocol.js` whenever the sim's rules, the state (`server/schema.js`),
the command or a message format changes. Colyseus is pinned to exact versions (pre-1.0); check its
APIs against the installed type definitions before using one.
