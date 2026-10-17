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
| Netcode | **Don't write our own: use [Colyseus](https://colyseus.io) 0.18** (MIT, Node). We write the game, not the networking. |

## Off-the-shelf pieces

| Need | Use | Instead of |
| --- | --- | --- |
| Rooms, joining, WebSocket transport, reconnects | `colyseus` server + `@colyseus/sdk` client | our own `ws` server and handshake |
| State sync (delta-encoded, binary) | `@colyseus/schema` (`schema({ … })`, plain JS, no decorators) | hand-written snapshot JSON |
| Fixed step and input buffering, clamping values | `setFixedTimestep()`, `defineInput()` with `sanitize` | our own tick loop and validation |
| Own-player prediction and reconciliation | `Predict.get()`, `predict.reconciler()`, `predict.tick()` | our own replay buffer |
| Interpolating other entities | `predict.attachAll({ mode: "lerp" })` | our own interpolation buffer |
| Lag compensation for PvP hits | `allowRewindState()`, `rewind.lastSeenBy(sessionId)` | nothing (it was deferred) |
| Refusing connections (wrong version, banned, bad origin) | `onAuth` / `beforeUpgrade` | custom checks |
| Admin: player list, kick, inspect rooms | `@colyseus/monitor` / `@colyseus/admin` behind `basicAuth()` | a stdin console |
| Headless tests and bot load tests | `@colyseus/testing`, `@colyseus/loadtest` | our own harness |
| TLS and a public address | `cloudflared` or Caddy | anything in our code |
| Distribution | Docker image, plus `npx naiwa-server` | an installer |

The API names come from the 0.18 announcement (released 2026-08-20). Check them against the docs when
building and pin the exact version: Colyseus is pre-1.0 and every minor release has had breaking
changes.

### Considered and rejected

- **geckos.io** (WebRTC, UDP-like): its traffic doesn't pass through Cloudflare Tunnel or an HTTP
  reverse proxy, which option 3 depends on.
- **@geckos.io/snapshot-interpolation**, **Lance**: unmaintained (last pushes 2022 and earlier).
- **nengi.js**: good netcode, but less active and lower-level than Colyseus.
- **Nakama**: a Go server whose JS runtime isn't Node, so it couldn't import our game logic as is.
  Heavy for one game.
- **Hosted services** (Colyseus Cloud, Playroom, Rune …): the opposite of self-hosting.

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
 browser (official site)                      naiwa-server (Node 22+, owner's machine)
 ┌──────────────────────────┐  room.send(input)┌──────────────────────────────┐
 │ Input → PlayerCommand ───┼────────────────▶│ Colyseus Room                │
 │ @colyseus/sdk Predict    │                 │  setFixedTimestep → Sim.step │
 │ View: sprites, fx, sfx,  │◀────────────────┼─ schema patches + broadcasts │
 │ HUD                      │  wss (tunnel)   │ server.json, monitor         │
 └──────────────────────────┘                 └──────────────────────────────┘
 single-player = the same Sim + View in one page, no Colyseus
```

One copy of the game logic (`src/sim/`) runs in three places: the browser for single-player, the
Colyseus room on the server, and the browser again inside `Predict` for the local player's movement.
Colyseus doesn't remove this split. Every authoritative framework needs game logic that runs without
the renderer, so it's still the biggest job.

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
   into particles, sounds, banners and shake. Online, the room broadcasts the same events.
4. **Input as commands.** `Player.update(dt, input, mouseWorld)` becomes `update(dt, cmd)` with
   `cmd = { mx, my, aim, fire, dash, dashDir, reload, weapon, cycle, last }`. The browser builds `cmd`
   from `Input`. Online it goes through `defineInput()`, which also numbers commands for
   reconciliation. Touch auto-aim (`nearestEnemy`) stays in the browser, so the server only sees an
   aim angle.
5. **Fixed time step.** The sim steps at 1/60 s (the current code clamps `dt` to 1/30 anyway). The
   browser accumulates frame time and runs whole steps. On the server, `setFixedTimestep` drives
   the steps.

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
- Bullets from players hit other players, checked against `rewind.lastSeenBy(shooter)` so hits match
  what the shooter saw. Explosions hurt everyone.
- Laugh: **open question.** 12 s of invulnerability is too strong if the laughing player can shoot.
  Proposal: in PvP the laugh is 4 s, untouchable and unable to shoot.

## Networking with Colyseus

One room type, `NaiwaRoom`, one room per server (the server *is* the room). The map choice, mode and
config are room metadata.

**State (`@colyseus/schema`), patched to every client automatically:**

```
NaiwaState { phase, mode, map: MapChoice, wave, score, timeLeft,
             players: MapSchema<PlayerState>,   // x, y, aim, hp, weapon, flags, name, kills
             enemies: MapSchema<EnemyState>,    // x, y, aim, hp, type, flags
             pickups: MapSchema<PickupState>,
             props:   MapSchema<PropState> }    // only hp / destroyed; positions come from the seeded layout
```

Fields that are only drawn (animation time, flash, recoil) stay off the schema; the view works them
out locally. Schema allows at most 63 fields per type, far more than these need.

**Messages (broadcasts), for things that happen once:**

- `events`: the sim's fx/sfx/HUD events for that tick.
- `bullet` / `bulletEnd`: bullets aren't in the state. The server sends `{ id, x, y, ang, speed, life,
  kind }` and clients move each one in a straight line until `bulletEnd`.
- `chat`.

**Joining:** `client.joinOrCreate("naiwa", { protocol, name, password })`. `onAuth` rejects a wrong
`PROTOCOL` (from `src/sim/protocol.js`, bumped whenever the sim or state changes), a full server, a
wrong password or a ban, and the reason is shown to the player ("server runs version N, this site
needs M"). `beforeUpgrade` checks `Origin` against `allowedOrigins`. Colyseus handles reconnecting
after a drop. `allowReconnection(client, 60)` holds the player's slot.

**Feel:** `Predict` runs the shared movement step for the local player and reconciles against the
server. Other players and enemies are drawn with its lerp interpolation. The local player's muzzle
flash, shell and sound play immediately, and bullets and damage come from the server.
`@colyseus/sdk/debug` (drift telemetry and a latency simulator) is how we tune it.

## The server program

```
server/
  index.js        defineServer(): NaiwaRoom, monitor behind basicAuth, port from server.json
  room.js         NaiwaRoom: onAuth, onJoin/onLeave, fixed step → Sim, mode rules, map rotation
  schema.js       NaiwaState and friends
  server.example.json
  Dockerfile
```

- Node 22+ (Colyseus 0.18's minimum). Imports `src/sim/` directly, so map and rule changes reach the
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
    "adminPassword": "",
    "maps": ["island/cove", "island/twins", "factory/dairy", "island/random"],
    "pvp": { "killLimit": 25, "timeLimit": 600 },
    "allowedOrigins": ["https://<official site>", "http://localhost:5173"]
  }
  ```

- Lifecycle: waiting lobby (the run starts 10 s after the first player joins), then the run, results,
  next map. Late joiners in co-op drop in at the dock with a pistol at the next wave break, or right
  away if the run is still in wave 1.
- Admin: the Colyseus monitor/admin page at `/admin`, protected by `adminPassword`. Kick, ban, `say`,
  map change and restart are room messages only an admin session may send.
- Safety: `sanitize` clamps every command field. Also cap chat at 1/s and names at 16 characters.

## Client changes

- Title screen: a **联机 / ONLINE** button opens a panel with the server address, player name and
  recently joined servers (localStorage). `?server=wss://…` opens straight into it, so owners can
  share a link.
- Connecting reuses `prepare(choice)` with the map from the room state, behind the loading screen.
- `@colyseus/sdk` is only loaded when the player opens ONLINE (dynamic `import()`), so single-player
  downloads nothing extra.
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
4. **Colyseus server and join screen.** `server/`, schema, `NaiwaRoom`, `onAuth` version check, the
   ONLINE panel. No prediction yet. Check: `@colyseus/testing` room tests; two browsers play co-op
   through `ws://localhost` and through a quick tunnel.
5. **Feel.** `Predict` reconciliation and interpolation, tuned with the SDK debug panel. Reconnect,
   scoreboard, names, chat.
6. **PvP mode,** with rewind-checked hits.
7. **Packaging and docs.** `docs/hosting.md` (tunnel and Caddy recipes in Chinese and English),
   Docker image, npm package, a `@colyseus/loadtest` run at `maxPlayers`.

## Open questions

- The PvP laugh rule (see above).
- Should teammates get distinct colours, or pick a skin?
- Is chat wanted, or only quick emotes (no moderation needed)?
- Later: an optional public server list (servers announce themselves to the official Worker). Not
  part of option 3 as chosen.
