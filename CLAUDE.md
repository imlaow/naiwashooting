# 奶蛙射击 (Naiwa Shootout)

See `README.md` for running the game, controls and the code map.

## Repo and deploy

- Source: private GitHub repo `imlaow/naiwashooting`, branch `main`.
- Deploy: Cloudflare Workers Builds builds and deploys the Worker `naiwa-shootout` (`wrangler.jsonc`)
  on every push to `main` (`npm run build`, then `npx wrangler deploy`). Never deploy from this
  machine. Check builds and change settings through the Cloudflare plugin.
- The Worker is static-only: it serves `dist/` and has no server code.

## Online play

In progress (stages 1–2 of 7 done): self-hosted servers in the style of Minecraft (co-op and PvP,
owners put a `wss://` tunnel or proxy in front), built on Colyseus 0.18 rather than our own netcode.
The agreed design and build stages are in `docs/online.md`. Keep it up to date as stages land.

All game logic is in `src/sim/` (no Pixi, DOM, audio or HUD imports); `src/view/` draws it. After
touching `src/sim/`, run `node tools/sim-headless.mjs` (must end with "no errors") and
`node tools/dump-layouts.mjs --check`.
