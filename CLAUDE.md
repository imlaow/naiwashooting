# 奶蛙射击 (Naiwa Shootout)

See `README.md` for running the game, controls and the code map.

## Repo and deploy

- Source: private GitHub repo `imlaow/naiwashooting`, branch `main`.
- Deploy: Cloudflare Workers Builds builds and deploys the Worker `naiwa-shootout` (`wrangler.jsonc`)
  on every push to `main` (`npm run build`, then `npx wrangler deploy`). Never deploy from this
  machine. Check builds and change settings through the Cloudflare plugin.
- The Worker is static-only: it serves `dist/` and has no server code. The game server
  (`server/`, its own `package.json`, installed with `npm install --prefix server`) isn't deployed
  anywhere: owners run it themselves.

## Online play

In progress (stages 1–5 of 7 done): self-hosted servers in the style of Minecraft (co-op and PvP,
owners put a `wss://` tunnel or proxy in front), built on Colyseus 0.18 rather than our own netcode.
The agreed design and build stages are in `docs/online.md`. Keep it up to date as stages land.

All game logic is in `src/sim/` (no Pixi, DOM, audio or HUD imports); `src/view/` draws it. After
touching `src/sim/`, run `node tools/sim-headless.mjs` and `node tools/sim-headless.mjs --players 4`
(both must end with "no errors"), `node tools/sim-rules.mjs` ("all rules hold") and
`node tools/dump-layouts.mjs --check`.

After touching `server/`, `src/net/`, `src/sim/protocol.js` or anything the room state carries,
run `npm run test:server` (all pass) and `node tools/bot-clients.mjs` ("no errors"; it starts its
own server on port 7790). After touching the prediction, the timeline or how the room takes
commands, also run `node tools/net-feel.mjs` (port 7791, about 6 minutes): at 0 and 80 ms the
prediction error should stay at the wire's rounding (p95 well under 1 px) and B be drawn without
starving the timeline. The local player's prediction runs the sim's own `Player.update`, so a
change to player movement or shooting in `src/sim/` reaches it by itself; anything the step reads
must be in the room state (`server/schema.js`) and adopted in `NetSim.adopt`.

Bump `PROTOCOL` in `src/sim/protocol.js` whenever the sim's rules, the state (`server/schema.js`),
the command or a message format changes. Colyseus is pinned to exact versions (pre-1.0); check its
APIs against the installed type definitions before using one.
