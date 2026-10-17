# Online play: self-hosted servers (design)

Status: **planned, nothing built yet.** This is the agreed design; build it in the stages at the end.

## Decisions

| Question | Decision |
| --- | --- |
| Hosting model | Minecraft-style: players run their own `naiwa-server` and share its address. No official rooms, no relay. |
| How browsers reach a server | The server owner provides a `wss://` address (Cloudflare Tunnel or a reverse proxy with TLS). The official site joins it directly. |
| Modes | Co-op waves **and** PvP deathmatch, picked by the owner in `server.json`. |
| Co-op death | Downed, teammates revive. The run ends only when every player is down or dead. |
| Player count | Owner sets `maxPlayers`, default 4. |
| Authority | The server runs the game logic and the browser draws it. Clients send inputs, never positions or hits. |

## Why the address must be `wss://`

The official site is served over HTTPS, and browsers block an HTTPS page from opening a plain
`ws://1.2.3.4:7777` socket (mixed content). So every server needs a TLS name in front of it. The
server itself speaks plain `ws://` on a local port, and TLS is the owner's job:

- **Cloudflare quick tunnel**, no account or domain: `cloudflared tunnel --url http://localhost:7777`
  prints `https://<random>.trycloudflare.com`; players join `wss://<random>.trycloudflare.com`. The name
  changes every run.
- **Cloudflare named tunnel** on the owner's own domain: a stable address and no port forwarding.
- **Caddy** (or nginx + Let's Encrypt) on a VPS or a home machine with 443 forwarded:
  `naiwa.example.com { reverse_proxy localhost:7777 }`.
- **Testing on the host machine**: browsers treat `localhost` as secure, so `ws://localhost:7777` works
  from the official site (check Safari when building it).

The join screen accepts `wss://…`, turns `https://…` into `wss://…`, allows `ws://` only for
`localhost` / `127.0.0.1`, and otherwise explains the tunnel recipe instead of failing silently.

## Architecture

```
 browser (official site)                      naiwa-server (Node, owner's machine)
 ┌──────────────────────────┐   inputs 30/s   ┌──────────────────────────────┐
 │ Input → PlayerCommand ───┼────────────────▶│ Sim (src/sim, no Pixi)       │
 │ prediction (own player)  │                 │  fixed 60 Hz step            │
 │ View: sprites, fx, sfx,  │◀────────────────┼─ snapshots 20/s + events     │
 │ HUD, interpolation       │  wss (tunnel)   │ server.json, console, logs   │
 └──────────────────────────┘                 └──────────────────────────────┘
 single-player = the same Sim + View in one page, no socket
```

One copy of the game logic (`src/sim/`) runs in three places: the browser for single-player, the
Node server, and the browser again for predicting the local player's movement.

## Code split (the big refactor)

What already runs without Pixi: `island.js` and `factory.js` (only their `paint*` methods use
`document`), `noise.js`, `physics.js`. Map layout is already seeded (`mulberry32(seed + …)` in
`Environment` / `FactoryEnvironment`), so the server and every client can rebuild the same colliders
from the map choice. Nothing about the map goes over the wire except `{ theme, id, seed }`.

What has to change:

1. **Layout out of the scene builders.** `world.js` `placeVillage` / `placeVegetation` / `placeProps`
   and `factoryScene.js` create sprites and colliders together. Split each into a pure
   `layout(island) → { colliders, props, weaponSpots, occupied, … }` in `src/sim/layout*.js` that calls
   the seeded RNG in exactly the same order, and a scene that only draws what the layout lists. Check:
   for all seven maps the collider, prop and weapon-spot lists are identical before and after.
2. **Sim state classes without sprites.** `Player` / `Enemy` keep position, HP, timers and AI;
   `PlayerView` / `EnemyView` own the Pixi containers and `sync()`. Couplings to remove:
   - `Player.update` reads `laugh.time()` (the audio playback position). The sim uses a fixed
     duration (`LAUGH_SECONDS`, from the sheet's frame count / fps, stored as a constant) and the
     view keeps following the audio.
   - Muzzle offsets use gun texture widths (`Player.shoot`, `Enemy.fire`): replace with a constant
     table per gun.
   - `focusBox`, `crown`, the HP bar, `ghost()` and `stepFx` are view-only.
3. **Events instead of direct fx/sfx/HUD calls.** Game logic currently calls `game.fx.*`, `sfx.play`,
   `game.hud.*`, `game.shake` inline. The sim pushes events instead (`shot`, `hit`, `kill`, `explode`,
   `pickup`, `hurt`, `laugh`, `wave`, `waveCleared`, `downed`, `revived`, …) and the view turns them
   into particles, sounds, banners and shake. Same events in single-player and online.
4. **Input as commands.** `Player.update(dt, input, mouseWorld)` becomes `update(dt, cmd)` with
   `cmd = { seq, mx, my, aim, fire, dash, dashDir, reload, weapon, cycle, last }`. The browser builds
   `cmd` from `Input`. Touch auto-aim (`nearestEnemy`) stays in the browser, so the server only sees
   an aim angle.
5. **Fixed time step.** The sim steps at 1/60 s (the current code clamps `dt` to 1/30 anyway). The
   browser accumulates frame time and runs whole steps.

`Math.random` inside the sim can stay: the server is authoritative, so clients never need to
reproduce it. Only the map layout must stay seeded.

## Several players in the sim

`game.player` becomes `players` (a map by id) plus `localId` on the client. Places that assume one
player today: enemy targeting and `fire()` leading (`entities.js`), `spawnPoint`, `explode`,
`updateBullets`, `updatePickups`, `updateWaves` (heal and supply crate), `onEnemyKilled` (heal
chance, laugh), `applyDrift`, camera and `volumeAt` (view: follow the local player).

- **Targeting:** nearest living, not downed, not laughing player that the enemy can see, re-picked
  with the existing `losT` timer. When every player is laughing or downed, enemies wander as they do
  now.
- **Spawns:** around a random living player, at least 680 px from **all** players.
- **Wave size (co-op):** enemy counts × `1 + 0.5 × (players − 1)`, `maxAlive` +4 per extra player,
  boss HP × `1 + 0.6 × (players − 1)`.
- **Pickups:** first to touch it. Weapon spots respawn 20 s after pickup online.
- **Score:** team score for the run; kills and combo per player, shown on the scoreboard.
- **Laugh:** each player laughs on their own 5th, 10th, … kill. Enemies ignore that player and go for
  the others.
- **Friendly fire:** off in co-op.

### Downed and revive (co-op)

- HP 0 → **downed**: crawls at 30 % speed, can't shoot or pick up, bleeds out over 30 s.
- A teammate standing within 60 px for 3 s (progress ring, interrupted when they take damage)
  revives them with 30 HP and 1 s of invulnerability.
- Bled out → dead: spectates a teammate and respawns at the dock with a pistol at the next wave
  break.
- Every player downed or dead → run over, results for 10 s, then the next map in the rotation.
- With a single player on the server, downed = dead, as in single-player.

### PvP deathmatch

- No AI waves. Crates and barrels respawn 30 s after being destroyed, weapon spots after 20 s.
- Spawns: walkable points far from every living player (reuse `spawnPoint`'s checks). Respawn after
  3 s with a pistol and 1.5 s of spawn protection.
- Round ends at `killLimit` or `timeLimit`, then results for 10 s and the next map.
- Bullets from players hit other players. Explosions hurt everyone.
- Laugh: **open question.** 12 s of invulnerability is too strong if the laughing player can shoot.
  Proposal: in PvP the laugh is 4 s, untouchable and unable to shoot.

## Protocol

JSON messages over one WebSocket. Switch to a binary format only if bandwidth turns out to matter.

```
client → server
  hello    { protocol, name, password?, token? }
  input    { seq, cmds: [cmd, …] }            // ~30/s, batches the frames since the last send
  chat     { text }
  ping     { t }

server → client
  welcome  { protocol, id, token, server: { name, motd, mode, maxPlayers },
             map: { theme, id, seed }, tick, state }
  reject   { reason: 'protocol' | 'full' | 'password' | 'banned', serverProtocol }
  snapshot { tick, ack, players:[…], enemies:[…], pickups:[…], props:[changed], wave, score }  // 20/s
  events   { tick, list:[…] }                 // fx/sfx/HUD events, plus bullet spawns
  map      { theme, id, seed }                // map change: client rebuilds via prepare()
  chat / pong / kicked
```

- `PROTOCOL` is a constant in `src/sim/protocol.js`. Bump it whenever the sim or the messages change.
  The official site updates on every push and servers don't, so on a mismatch the client says
  "server runs version N, this site needs M" instead of misbehaving.
- **Bullets** aren't in snapshots. The server sends a spawn event `{ id, x, y, ang, speed, life, kind }`,
  clients move it in a straight line, and the server sends `bulletEnd { id }` when it hits.
- **Props** come from the seeded layout with stable ids. Snapshots only carry HP changes and
  destroyed / respawned ids.
- **Entities** in snapshots: id, x, y, vx, vy, aim, hp, state flags (dash, laugh, downed, spawnT),
  weapon. Positions rounded to 0.1 px. About 3–5 KB per snapshot with 20 enemies, so 60–100 KB/s per
  player. Fine at first; add deltas and quantization if phones struggle.

### Making it feel responsive

- **Own player:** predicted. The client runs the same movement code (`moveBody` on the same island
  and colliders), keeps unacknowledged commands, and when a snapshot arrives with `ack` it resets to
  the server position and replays the rest. Corrections smaller than ~8 px are smoothed over 100 ms.
- **Own shots:** muzzle flash, shell and sound play immediately. Bullets and damage come from the
  server.
- **Everyone else:** drawn 100 ms in the past, interpolated between the two snapshots around that
  time.
- **Lag compensation:** none in v1 (AI enemies in co-op forgive it). Consider rewinding player hitboxes
  for PvP if hits feel unfair.

## The server program

```
server/
  index.js        entry: load config, build world, run sim, accept sockets, console
  room.js         players, join/leave, reconnect, mode rules, map rotation
  net.js          ws handling, rate limits, message validation
  server.example.json
  Dockerfile
```

- Node 20+, one dependency (`ws`). Imports `src/sim/` directly, so map and rule changes reach the
  server with no copying. Run from the repo with `npm run server`. Later publish a bundled
  `naiwa-server` package (`npx naiwa-server`) and a Docker image.
- `server.json`:

  ```json
  {
    "name": "Allen's island",
    "motd": "Be nice to the eggs",
    "port": 7777,
    "mode": "coop",
    "maxPlayers": 4,
    "password": "",
    "maps": ["island/cove", "island/twins", "factory/dairy", "island/random"],
    "pvp": { "killLimit": 25, "timeLimit": 600 },
    "allowedOrigins": ["https://<official site>", "http://localhost:5173"]
  }
  ```

- Lifecycle: waiting lobby (the run starts 10 s after the first player joins), then the run, results,
  next map. Late joiners in co-op drop in at the dock with a pistol at the next wave break, or right
  away if the run is still in wave 1.
- Reconnect: the client keeps `token` in localStorage, and the server holds the player's slot for 60 s.
- Console commands on stdin: `list`, `kick <name>`, `ban <name>`, `say <text>`, `map <theme/id>`,
  `restart`, `mode coop|pvp`.
- Safety: validate every message, clamp command values (aim, move length), cap inputs at 120/s and
  chat at 1/s, check `Origin` against `allowedOrigins`, limit names to 16 characters.

## Client changes

- Title screen: a **联机 / ONLINE** button opens a panel with the server address, player name and
  recently joined servers (localStorage). `?server=wss://…` opens straight into it, so owners can
  share a link.
- Connecting reuses `prepare(choice)` with the map the server sends, behind the loading screen.
- In game: names over heads, teammates tinted with the recoloured skins `skins.js` already builds,
  teammates on the minimap and as edge arrows when off screen, revive ring, spectate banner,
  scoreboard on Tab (and a button on touch), ping, chat (Enter), a "connection lost, reconnecting…"
  overlay.
- Pause is unavailable online. Esc opens a menu while the game keeps running, and hiding the tab
  doesn't pause.
- Online runs don't update the local best or the map cards' records.

## Stages

Each stage leaves single-player working and is pushed on its own.

1. **Layout extraction.** Pure layout for island and factory, scenes draw from it. Check: identical
   collider / prop / weapon-spot lists for all seven maps (a small Node script).
2. **Sim / view split.** `src/sim/` with commands, events and a fixed step; the view in `src/view/`.
   Check: single-player plays the same; a Node script runs the sim headless for 10 minutes of waves
   with a scripted bot and no errors.
3. **Several players in the sim.** Targeting, spawns, scaling, downed/revive, per-player laugh.
   Check: a headless run with 2–4 bots.
4. **Server and join screen.** `server/`, protocol, handshake, snapshots without prediction. Check:
   two browsers play co-op through `ws://localhost` and through a quick tunnel.
5. **Feel.** Prediction, interpolation, reconnect, scoreboard, names, chat.
6. **PvP mode.**
7. **Packaging and docs.** `docs/hosting.md` (tunnel and Caddy recipes in Chinese and English),
   Docker image, npm package.

## Open questions

- The PvP laugh rule (see above).
- Should teammates get distinct colours, or pick a skin?
- Is chat wanted, or only quick emotes (no moderation needed)?
- Later: an optional public server list (servers announce themselves to the official Worker). Not
  part of option 3 as chosen.
