# Online play: self-hosted servers (design)

Status: **all 7 stages done** (layout extraction, the sim/view split, several players in the sim,
the Colyseus server with the join screen, 2026-10-17; prediction, interpolation, reconnecting and
the in-game multiplayer UI, 2026-10-18; PvP and rewind-checked hits, the owner's console, the npm
package `naiwa-server`, the image `ghcr.io/imlaow/naiwa-server` and `docs/hosting.md`, 2026-10-19).
This was the agreed design, built in the stages at the end; "Open questions" lists what is left.

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
| Own-player prediction and reconciliation | `Predict.get()`, `predict.sim()` (a `SimReconciler`), `predict.tick()` | our own replay buffer |
| Interpolating other entities | the SDK's server clock (`room.clock`) for a whole-state timeline in `NetSim`; not `attachAll` (see "Stage 5 as built") | our own clock sync |
| Lag compensation for hits | `allowRewindState()`, the input's render-time stamp, `rewind.at(time)` (stage 6b) | nothing (it was deferred) |
| Refusing connections (wrong version, banned, bad origin) | `onAuth` / `beforeUpgrade` | custom checks |
| Admin: player list, kick, ban, say, map, restart | a console on the server's own terminal (stdin, `server/console.js`, stage 7a) | `@colyseus/monitor` / `@colyseus/admin` behind `basicAuth()` (see "Stage 7a as built" for why) |
| Headless tests and bot load tests | `@colyseus/testing`; bots: `tools/bot-clients.mjs`, not `@colyseus/loadtest` (see "Stage 7b as built") | our own harness |
| TLS and a public address | `cloudflared` or Caddy | anything in our code |
| Distribution | Docker image, plus `npx naiwa-server` | an installer |

**Keep it light.** Measured 2026-10-17:

- **Server:** don't install the `colyseus` meta-package. It pulls in uWebSockets binaries for every
  platform, plus Redis, auth and pm2 (180 MB, 159 packages). `@colyseus/core` + `@colyseus/ws-transport`
  + `@colyseus/schema` is 20 MB and 84 packages, and idles at about 80 MB of memory on Node 24 (bare
  Node is 44 MB). No admin page: `@colyseus/monitor` would add 14 MB, 3 packages and 30 MB of idle
  memory (measured in stage 7a), and the owner's console needs none of it.
- **Browser:** `@colyseus/sdk` with `Predict` adds about 69 KB gzipped (the game's JS is about 233 KB).
  Load it on demand when ONLINE opens.

**Server size.** Measured on one Neoverse-N1 (ARM) core, Node 24: building the island takes 140 ms
and 15 MB, the factory 3 ms. A synthetic heavy tick (20 enemies steering, 120 bullets, line-of-sight
checks, 8 players moving) takes 0.22 ms, so 1.3 % of a core at 60 Hz. (Stage 7b measured the real thing
with bots: 4–8 % of a core, 91–122 MB, 2–16 KB/s per player; see "Stage 7b as built".) Allowing ×5 for the real sim plus
schema encoding, that's under 10 % of one core and about 100–150 MB of memory with Colyseus. Upload
bandwidth is the real limit. The estimate is 15–25 KB/s per player (20 Hz delta patches + bullet and
event messages), so about 0.8 Mbps for 4 players and 1.5 Mbps for 8. Measure it in stage 7. (Stage 4 measured
8–12 KB/s per player in a busy wave with 4 players, 0.4 Mbps in all, and stage 5, with what the
prediction needs, 9.5–14 KB/s; see "Stage 4 as built" and "Stage 5 as built".)
Recommended minimum: 1 vCPU and 512 MB–1 GB RAM (cheapest VPS, Oracle free tier, Raspberry Pi 4/5, or
any home PC). Pick the location by ping to the players. For players in mainland China, Cloudflare
tunnels route through edges outside the mainland, so a nearby VPS (e.g. Hong Kong) with Caddy may
play better.

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
 │ HUD                      │  wss (tunnel)   │ server.json, console (stdin) │
 └──────────────────────────┘                 └──────────────────────────────┘
 single-player = the same Sim + View in one page, no Colyseus
```

One copy of the game logic (`src/sim/`) runs in three places: the browser for single-player, the
Colyseus room on the server, and the browser again inside `Predict` for the local player's movement.
Colyseus doesn't remove this split. Every authoritative framework needs game logic that runs without
the renderer, so it's still the biggest job.

## Code split (the big refactor)

What runs without Pixi: `island.js` and `factory.js` (only their `paint*` methods use `document`),
`noise.js`, and everything in `src/sim/`, which since stage 2 is the whole game. Map layout is
seeded, so the server and every client rebuild the same colliders from the map choice:
`buildMap(makeChoice(theme, id, seed))` from `src/sim/maps.js`. Nothing about the map goes over the
wire except `{ theme, id, seed }`.

What has to change:

1. **Layout out of the scene builders. Done.** See "Stage 1 as built" below.
2. **Sim state classes without sprites. Done.** `Player` / `Enemy` keep position, HP, timers and AI;
   `PlayerView` / `EnemyView` own the Pixi containers and `sync()`. Couplings to remove:
   - `Player.update` reads `laugh.time()` (the audio playback position). The sim uses a fixed
     duration (`LAUGH_SECONDS`, from the sheet's frame count / fps, stored as a constant) and the
     view keeps following the audio.
   - Muzzle offsets use gun texture widths (`Player.shoot`, `Enemy.fire`): replace with a constant
     table per gun.
   - `focusBox`, `crown`, the HP bar, `ghost()` and `stepFx` are view-only.
3. **Events instead of direct fx/sfx/HUD calls. Done.** Game logic used to call `game.fx.*`, `sfx.play`,
   `game.hud.*`, `game.shake` inline. The sim pushes events instead (`shot`, `hit`, `kill`, `explode`,
   `pickup`, `hurt`, `laugh`, `wave`, `waveCleared`, `downed`, `revived`, …) and the view turns them
   into particles, sounds, banners and shake. Online, the room broadcasts the same events.
4. **Input as commands. Done.** `Player.update(dt, input, mouseWorld)` becomes `update(dt, cmd)` with
   `cmd = { mx, my, aim, fire, dash, dashDir, reload, weapon, cycle, last }`. The browser builds `cmd`
   from `Input`. Online it goes through `defineInput()`, which also numbers commands for
   reconciliation. Touch auto-aim (`nearestEnemy`) stays in the browser, so the server only sees an
   aim angle.
5. **Fixed time step. Done.** The sim steps at 1/60 s (the old code clamped `dt` to 1/30 anyway). The
   browser accumulates frame time and runs whole steps. On the server, `setFixedTimestep` drives
   the steps.

`Math.random` inside the sim can stay: the server is authoritative, so clients never need to
reproduce it. Only the map layout must stay seeded.

### Stage 1 as built

- `src/sim/layoutIsland.js` `islandLayout(island)` and `src/sim/layoutFactory.js`
  `factoryLayout(factory)` return `{ colliders, objects, props, weaponSpots }`, plus `occupied` and
  `decor` for the island. `colliders` are in the order they go into the `StaticWorld` (the order
  decides which collider a bullet hits first). `props` are `{ kind, x, y }`.
- `src/sim/maps.js` holds the map catalogue (themes, variants, `world`, `layout`, `makeChoice`) and
  `buildMap(choice) → { world, layout }`. `src/maps.js` adds the browser parts (scene class,
  thumbnail, loading lines, worlds cache, records) on top.
- `Environment` and `FactoryEnvironment` call the layout, add its colliders and props to the game,
  and draw `objects`. For now the scenes still do the adding; stage 2 moves that into the sim.
- **Different from the plan:**
  - The island layout also lists **what to draw** (`objects`: kind, position, texture variant,
    scale, flip) and the **decoration** (`decor`: clouds, gulls, butterflies). On the island,
    sprite choices are seeded rolls in the same stream as the placement (a palm's scale sets its
    collider radius, flips are rolled between placements, and decoration is rolled after the props),
    so they can't stay in the scene without changing the map. The server ignores both.
  - The layout can't read `art.js` (it paints canvases), so the texture counts it rolls against are
    constants: `ART_COUNTS` and `ROCK_SIZES` in `layoutIsland.js`. `art.js` paints its rocks from
    `ROCK_SIZES`; changing a count reshuffles every island.
  - The factory needed less: `Factory.plan()` was already a seeded layout. `factoryLayout` adds the
    perimeter wall colliders. The factory scene's own seeded RNG only places decoration (cartons,
    lamp phases, trees outside the fence, clouds, steam vents) and stays in the scene.
  - `island.js` and `factory.js` stay in `src/` and `src/sim/` imports them. Their `paint*` methods
    are browser-only. Moving the pure parts into `src/sim/` can happen in stage 2.
- **Check:** `node tools/dump-layouts.mjs --check` compares the layouts with
  `tools/layout-baseline.txt`, recorded from the old scenes before the change (Pixi stubbed).
  `--scene` records the same lists through the scene classes, and `--scene --draw` lists everything
  the scenes drew. All three were identical before and after, and the browser showed the same
  colliders, props and weapon pickups on all seven maps; crates still break and barrels still explode.
- **Found, not fixed:** on every island the shotgun spot never appears. Hut slots 0 and 1 are at most
  about 230 px from the village centre, but `isFree` needs 150 + 90 px, so those huts and the shotgun
  by hut 1 are always skipped (only two huts are ever built). Fixing it changes every island and the
  baseline, so it's a separate decision.
- Cost on the server: building an island world takes 110–200 ms, the island layout another 8–19 ms,
  the factory under 3 ms in total.

### Stage 2 as built

- **Files.** `src/sim/sim.js` (`Sim`: colliders, props, player, enemies, bullets, pickups, waves,
  scoring, events), `src/sim/entities.js` (`Player`, `Enemy`, weapon and enemy tables, `moveBody`),
  `src/sim/physics.js` (moved from `src/`). The browser side is in `src/view/`: `game.js` (the
  session: fixed-step loop, input → command, events → effects, sprites for props / pickups / bullets,
  camera, pause, title demo), `entities.js` (`PlayerView`, `EnemyView`), and the moved `world.js`,
  `factoryScene.js`, `fx.js`, `hud.js`. `island.js` and `factory.js` stay in `src/`.
- **API.** `new Sim(world, layout)` with both from `buildMap` (the browser computes the layout once
  per map in `prepare()` and hands the same object to the sim and the scene). `sim.step(STEP, cmd)`,
  then `sim.takeEvents()`. `STEP = 1/60`. The events and their fields are listed at the top of
  `sim.js`. Every player, enemy, prop, pickup and bullet has an `id` from `sim.newId()`, and the view
  keeps its sprites in maps by id (`Game.reconcile`), which is how it will follow schema maps later.
- **Scenes only draw.** The sim adds the layout's colliders, props and weapon pickups; `Environment`
  and `FactoryEnvironment` take `(game, terrainTex, layout)` and draw `layout.objects`. Prop sprites
  (and the crate flip) are made by `Game`.
- **Different from the plan:**
  - **Drawing between steps.** Not in the plan, but needed so 90/120/144 Hz screens don't judder: the
    browser runs whole steps until the sim has caught up with the frame (so the sim is up to one step
    ahead), then draws the player, enemies and bullets between their positions before and after the
    last step. At 60 Hz that is always the latest step, as before. Frame time is still capped at
    1/30 s (below 30 fps the game slows down rather than jumping), and the death slow-motion scales
    frame time, not the step.
  - **Key presses wait for a step.** Number keys, wheel, Q, R, dash and HUD taps (weapon slot,
    reload) are collected each frame and go into the next step's command, so a frame without a step
    doesn't lose them. HUD taps used to call the player directly.
  - **Some drawn state stays in the sim** because the logic reads it: `Enemy.animT` (the egg's
    waddle steers by its walk phase) and `moving` on the player and enemies (the player's is taken
    before the gun's kick, so firing on the spot doesn't start the walk cycle). Bullets carry their
    look (`tint`, `orb`, `scale`), which is the `kind` of the planned bullet message.
  - **The laugh no longer waits for its frames.** Before, there was no laugh at all until the laugh
    sprite sheets had loaded in the background. Now the sim always laughs (12 s) and the view shows
    the walk frames until the sheets arrive.
  - **Muzzle offsets:** `GUN_SIZES` and `GUN_GRIP` in `sim/entities.js`, and `art.js` paints the guns
    from them (like `ROCK_SIZES`). They give exactly the old offsets (38 / 52 / 66 / 78 px, the
    boss's SMG 72). Enemy gun heights are `ENEMY_TYPES[t].gunH`, the boss's gun scale `gunScale`.
  - **Game over** (the 0.6 s before the results, the slow-motion) is the view's, on the `died`
    event, in real time. The sim only sets `state = 'dead'`.
  - Touch auto-aim calls `sim.nearestEnemy()` from the browser; the sim only ever sees an angle.
- **Checks.**
  - **Same behaviour, exactly.** Before the change, the old game ran in headless Chromium with the
    Pixi ticker stopped, `game.update(1/60)` stepped by hand and a scripted bot (moves away from
    close enemies, walks to pickups, aims at the nearest enemy, fires, dashes, presses R, 1–4, the
    wheel and Q on a timer), tracing player position / HP, score, kills, wave, state, enemy count,
    queue, props, pickups, bullets, weapon and ammo, laugh, and the first enemy's position and HP once
    per second. `Math.random` was split into two seeded streams: one for the game logic, one for
    view-only randomness (particles, shake, text drift, crate flips, pickup bob phase), so effects
    that are drawn in a different order can't shift the logic's sequence. The 5-minute traces on
    `island/cove`, `factory/dairy` and `island/twins` (waves 2–6, all four weapons, laughs, King
    Naiwa on cove and dairy, crates and barrels) and a run where the bot doesn't shoot and dies
    are **byte-identical** before and after. Screenshots taken at the same frames differ in 0.1–1.4 %
    of pixels, all particles, floating-text drift and decal rotation.
  - In the browser, both themes: pause and resume, touch auto-aim and the aim stick, HUD weapon and
    reload taps, dash ghosts and i-frames, barrel chain reactions, crates breaking, the laugh (laugh
    frames, untouchable, over at 12 s with a full heal), King Naiwa with his crown on wave 5, belt
    drift and slow wading in the factory, game over with the results panel and records, the title
    demo; one second of frames at 144, 90 and 30 Hz runs one second of sim.
  - `node tools/sim-headless.mjs` runs 10 minutes of game time on all seven maps in plain Node in
    about 11 s: waves 8–10, 176–197 kills per map, King Naiwa beaten on every map, at most one death
    per map, no errors (seeds 1–3). `--trace` prints the state every game second; record one before
    stage 3 and compare after it to show single-player is unchanged.
  - Layout check, `--scene` and `--scene --draw` dumps unchanged.
- **Cost:** one step is 30–60 µs on one Neoverse-N1 core with up to 20 enemies (the bot runs).

## Several players in the sim

**Done in stage 3**, see "Stage 3 as built" below.

`sim.player` becomes `players` (a map by id) plus `localId` on the client. Places that assume one
player today (since stage 2 all in `src/sim/` unless marked): enemy targeting and `fire()` leading
(`entities.js`), `spawnPoint`, `explode`, `updateBullets`, `updatePickups`, `updateWaves` (heal and
supply crate), `onEnemyKilled` (heal chance, laugh), `dropWeapon` (picks a gun the player lacks),
`applyDrift`, `onPlayerDeath` (ends the run), and in the view `Game.hero`, the camera, `volumeAt`,
the HUD and the `command()` it builds (follow the local player).

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

Found in stage 2:

- `step(dt, cmd)` becomes `step(dt, cmds)` keyed by player id; a player without a command this step
  keeps its last one (or stands still).
- The player events already carry the player's `id` (`shot`, `hurt`, `dash`, `laugh`, `laughEnd`,
  `switch`, `reload`, `reloaded`, `empty`, `died`); `pickup` needs one. The view must only apply
  recoil, the hurt flash, screen shake, toasts and the laugh sound for `localId`, and draw the rest
  for everyone.
- Bullets need an `owner` (player id) for per-player kills, combo and laugh; `kill` should say who.
- Record `node tools/sim-headless.mjs --trace` before starting and compare after: with one bot the
  trace must not change.

### Downed and revive (co-op)

- HP 0 → **downed**: crawls at 30 % speed, can't shoot or pick up, bleeds out over 30 s.
- A teammate standing within 60 px for 3 s (progress ring, interrupted when they take damage)
  revives them with 30 HP and 1 s of invulnerability.
- Bled out → dead: spectates a teammate and respawns at the dock with a pistol at the next wave
  break.
- Every player downed or dead → run over, results for 10 s, then the next map in the rotation.
- With a single player on the server, downed = dead, as in single-player.

#### Stage 3 as built

- **API.** `sim.players` is a `Map` by id. `sim.addPlayer()` returns the new `Player`;
  `sim.removePlayer(id)` takes one out (enemies drop it as a target, a revive it was doing stops,
  and the run ends if nobody left is up). `sim.step(STEP, cmds)` takes a plain object
  `{ [player id]: cmd }`. A player with no command stands still and holds fire (it doesn't keep its
  last command). The browser adds its player first and keeps `game.localId`; ids are the sim's
  shared counter, so the player's id now comes after the props' and weapon spots'.
- **Player state** (`sim/entities.js`): `up` (not down, not dead), `down`, `bleedT`, `reviveT`,
  `reviver`, `dead`, `joining`, and per player `kills`, `combo`, `comboT`. `sim.kills` and
  `sim.score` are the team's. Constants: `DOWN_SPEED`, `BLEED_SECONDS`, `REVIVE_RANGE`,
  `REVIVE_SECONDS`.
- **Events.** New: `downed`, `revived` (`by`), `respawned` (`joined` for a late joiner entering)
  and `over` (every player down or dead). `died` now means "out": alone at HP 0, or bled out.
  The view's game over hangs off `over`, not `died`. Fields added: `kill.by`, `hit.by`, `pickup.id`,
  `bite.target`, `explode.by`, and `waveCleared.heals: [{ id, heal, x, y }]` instead of one heal.
- **Different from the plan, or decided while building:**
  - **Targeting** is re-picked on the `losT` timer, but a target that starts laughing or goes down
    is dropped at once: the enemy mills around until the next pick. When nobody can be targeted,
    it keeps its target (or takes the nearest player) and keeps checking line of sight to it. That
    is exactly what one player did before, which keeps single-player identical.
  - **One random roll more only when there is a choice.** `spawnPoint` picks the player to spawn
    around with `Math.random` only when more than one is up, so with one player the random
    sequence is unchanged. Spawns stay at least 680 px (pass 3: 400 px, last resort 300 px) from
    every player who isn't dead.
  - **Kills nobody made** (an enemy's bullet set off a barrel) go to the nearest player who is up,
    with that player's combo; the same player is who a crate broken by an enemy drops a gun for.
    Bullets carry `owner`, barrels pass it on through chain reactions.
  - **`dropWeapon(x, y, P)`** picks a gun that `P` lacks, where `P` is the player it drops for
    (the killer, or whoever broke the crate), decided when it drops, because the pickup shows its
    gun on the ground.
  - **Barrels still hurt every player in range,** teammates and the shooter included, as they
    hurt the player in single-player. "No friendly fire" applies to bullets.
  - **Downed** players can't be hurt (bullets pass through them), can aim and crawl but not
    shoot, dash, switch, reload or pick up, and can't start a laugh, so a 5th kill made while down
    (a bullet still in flight) doesn't laugh. The revive goes to the first teammate who is up and
    within 60 px. Its progress resets when that teammate steps out of range, takes damage, or
    leaves. A laughing teammate can revive.
  - **Respawn and late joiners:** at the wave break, after the wave-clear heal and the supply
    crates, every dead player is put back at the dock with full HP, a pistol and 1 s of
    invulnerability (spawn protection, not in the plan). Players stand at the spawn and beside it
    (`dockSpot`). A late joiner is added `dead` + `joining` during a fight in wave 2 or later, and
    enters right away during the intro, wave 1 or a break.
  - **Co-op scaling** uses `players.size` when the wave starts (counting dead and waiting players)
    and rounds the scaled counts. Boss HP scales when King Naiwa spawns. The wave-clear heal and
    the supply crate are per player who is up (one crate each).
  - **Records:** co-op game overs (`?bots`) don't update the best score or the map cards.
  - **The bot** moved to `src/sim/bot.js` (`new Bot(sim, id, rand)`). In co-op it also walks to a
    downed teammate and waits by them, crawls to a teammate when it is down, and gives up on a
    pickup it can't reach (2 s within 80 px without getting it): four bots once all stood at an
    ammo box behind a wall while the last egg was stuck across the map. That last rule is off with
    one player so the old traces stay comparable.
- **View.** `Game.playerViews` by id (the `reconcile` pattern), `Game.hero` is the local one,
  `Game.me` the local sim player. Recoil, the hurt flash, shake, toasts and the laugh sound are
  only for the local player. Other players' shots, hurts, dashes and pickups sound with distance,
  and gun handling (switch, reload, empty) is local only. A downed player lies on his side, greyed,
  with a ring on the ground: the revive range, the bleed-out time left (red) and revive progress
  (green). The HUD shows `DOWN n s` and, while out, "Waiting to respawn", and the camera follows a
  teammate. Teammates are dots on the minimap (red while down). `?debug&bots=N` adds N − 1 bot
  teammates driven by `sim/bot.js`.
- **Checks.**
  - **Same behaviour, exactly:** `node tools/sim-headless.mjs --trace` with one bot is
    byte-identical to the trace recorded before the change, for seeds 1, 2 and 3 (all seven maps,
    10 min each). The browser traces from stage 2's harness (headless Chromium, ticker stopped,
    `game.update(1/60)` by hand, `Math.random` seeded, view randomness on its own stream, mouse
    aimed 36 px above the target) are byte-identical on `island/cove`, `factory/dairy` and
    `island/twins` (5 min each) and in the run where the bot doesn't shoot and dies.
  - `node tools/sim-headless.mjs --players N` (2–4; one bot joins 5 s into wave 2, and with 3+ one
    leaves at wave 4 and another joins 10 s later), 10 min on all seven maps, seeds 1–3: no errors.
    Best waves 10–13 (single-player bots reach 8–10); every late joiner waited and came in at the
    next break. 0–4 downs per map, most of them revived; the rest are runs where the whole team
    went down together. Nobody bled out in these runs, so `sim-rules.mjs` and the browser check
    cover bleed-out and respawn.
  - `node tools/sim-rules.mjs` sets up each co-op rule by hand and checks it (alone = dead, downed,
    crawl speed, revive, interrupt, bleed-out, respawn, run over, late joiners, removePlayer,
    targeting, per-player laugh, team and player kills, pickups, no friendly fire, `dropWeapon`,
    spawn distance, scaling).
  - In the browser, both themes, `?bots=1` and `?bots=3`: one player, one view, and a death ends
    the run with the results panel and updated records; with 3, downed (ring, lying down, HUD
    countdown), a bot walking over to revive, bleed-out (hidden, camera on a teammate, "Waiting to
    respawn"), respawn at the dock with a pistol at the wave break, a bot's 5th kill making only it
    laugh (no laugh sound), enemies switching from a laughing or downed player to the one who is
    up and milling around when nobody is, everyone down → "EVERYONE IS DOWN" and results, records
    left alone. No page errors.
  - Layout check, `--scene` and `--scene --draw` dumps unchanged.
- **Cost:** a step is about 36 µs with one bot and 70 µs with four (factory, Neoverse-N1).
- **For stage 4:**
  - The room maps `sessionId` → player id, calls `addPlayer()` in `onJoin` (late joiners need
    nothing more) and `removePlayer(id)` when a seat is given up. While `allowReconnection` holds
    a seat, the player stays in the sim with no command, so it stands still and can be downed.
  - `over` is the room's cue for results and the next map; the sim only sets `state = 'dead'`.
  - What the view reads, so it has to be in the schema (or worked out on the client): players
    `x, y, aim, hp, weapon, moving, vx, laughT, invuln, dashT, down, bleedT, reviveT, dead,
    kills, combo, comboT`, and the arsenal for the local HUD; enemies `x, y, aim, hp, maxHp, type,
    moving, animT, vx, spawnT`; sim `state, stateT, wave, score, kills, queue.length, boss`. Today
    `Game` owns its `Sim`; online it needs a mode that reads this state instead.
  - Events carry the ids clients need to filter on (`id`, `by`, `target`), and they can be
    broadcast as they are.
  - Not done here: weapon spots respawning 20 s after pickup ("online" in the plan).

## Stage 4 as built

- **Packages, pinned exactly** (Colyseus is pre-1.0). The server has its own `server/package.json`
  (`npm install --prefix server`), so the Worker build at the repo root never installs it:
  `@colyseus/core` 0.18.19, `@colyseus/ws-transport` 0.18.4, `@colyseus/schema` 5.0.40, and for the
  tests `@colyseus/testing` 0.18.6 with `@colyseus/sdk` 0.18.5 (testing pulls in `@colyseus/tools`
  as its peer). A production install is 105 packages and 28 MB (the 84 / 20 MB measured before was
  an older 0.18). The root has `@colyseus/sdk` 0.18.5 for the browser and `@colyseus/schema` 5.0.40
  pinned next to it, so browser and server always decode the same wire format.
- **API names checked against the installed 0.18 sources.** As announced: `defineServer`,
  `defineRoom`, `setFixedTimestep`, `defineInput` (its `sanitize` has a map form and a callback
  form; we use the callback), `onBeforePatch`, `beforeUpgrade` (an option of `WebSocketTransport`,
  given a `Request` and returning a `Response` to refuse), `room.input()` on the client,
  `boot()` / `ColyseusTestServer` in `@colyseus/testing` (given a `Server`, it always listens on
  2568). Different: **`onAuth` is static** (`static onAuth(token, options, context)`) and runs on
  the HTTP matchmaking request before a seat exists; the instance `onAuth` still exists but runs
  later, at the WebSocket join, where a refusal reaches the client less cleanly. Errors thrown there
  arrive in the SDK as `MatchMakeError` with our message. `Predict` and rewind weren't touched.
- **Files.** `server/index.js` (reads and checks `server.json` over `server.example.json`, refuses to
  start with `"mode": "pvp"`, the transport's Origin check, creates the one room at startup),
  `server/room.js` (`NaiwaRoom`), `server/schema.js` (state and `Command`), `src/sim/protocol.js`
  (`PROTOCOL = 1`, message formats), `src/net/netsim.js` (`NetSim`), `src/net/online.js` (join,
  refusal reasons; loaded with the SDK on demand), `src/online.js` (address rules, recent servers),
  `server/test/room.test.js`, `tools/bot-clients.mjs`.
- **One room per server.** `index.js` creates it with `matchMaker.createRoom('naiwa')` at startup,
  `autoDispose` is off, and browsers `join` (never `joinOrCreate`), so a full server can't spawn a
  second room. `maxClients = maxPlayers` is the backstop for two joins racing past `onAuth`.
- **Refusals.** `onAuth` refuses, in this order, a wrong protocol (`version:N`), an Origin header
  not in `allowedOrigins` (`origin`), a wrong password (`password`) and a full room (`full`, from
  `hasReachedMaxClients()`). The browser shows "The server runs version N, this site needs M",
  "Server full", "Wrong password", "This server doesn't accept players from this site", or "Can't
  reach the server" when nothing answers. `beforeUpgrade` answers 403 to a WebSocket upgrade whose
  Origin isn't allowed (for anything that skips matchmaking). Requests without an Origin header
  (programs, like the bots) pass both checks: Origin only stops other websites, not other
  programs. Names are cleaned (control characters removed, trimmed) and capped at 16 characters.
- **Different from the plan: a `ready` handshake.** `onJoin` doesn't call `addPlayer()`. The client
  first loads the run's map (`prepare()` behind the loading screen, seconds on a slow phone) and
  then sends `ready` with the run number; only then is it added to the sim and the state. Without
  this a joining player stood defenceless at the dock while the island was still being painted:
  in the first browser test the lobby ran out and eggs killed the loading player. The same happens
  after every new run (the next map): everyone reloads and says `ready` again. The lobby's countdown
  starts with the first player in the sim, not the first connection. Late joiners still wait for
  the wave break inside the sim.
- **Commands.** `defineInput(Command)`: the sim's command with quantized fields (stick and dash
  direction in 8 bits, aim as a 16-bit angle, the gun as 0–4, the wheel as an int8), so a value off
  the wire is always in range; the sanitizer keeps the stick inside the unit circle, the gun within
  0–4, the wheel within ±4 and the flags strictly boolean. The browser sends one command per 1/60 s
  step with `room.input({ mode: 'reliable' })` (there is no unreliable channel over WebSocket).
  Each server tick takes every buffered command of a client: movement, aim and trigger from the
  newest, `dash` / `reload` / `last` if any of them had it, the last gun switch, the wheel summed.
  So a press is never lost when two commands arrive between steps. A tick without a new command
  keeps the last movement, aim and trigger, for up to 1 s (`STALE_STEPS`); then the stick and the
  trigger are let go and the aim kept, because a hidden tab stops sending (browsers stop animation
  frames) and its player shouldn't run into the sea firing. Offline, a player without a command
  stands still at once.
- **A Colyseus bug, worked around.** A malformed *unreliable* input frame (a negative slot length in
  `@colyseus/schema`'s `InputDecoder.decodeAll`) sends the server into an endless loop: nine bytes
  from any client froze it. `NaiwaRoom._onMessage` drops unreliable input frames before Colyseus
  reads them (ours never sends them). A message that isn't valid msgpack gets its sender
  disconnected by Colyseus itself (close code 4002); the room carries on. Worth reporting upstream.
- **State** (`server/schema.js`): players (by sessionId, with the sim's `id` that events use: position,
  aim, HP, gun and arsenal, reload, walk flag and lean speed, dash, dash cooldown, invulnerability,
  laugh, down / bleed-out / revive, dead, kills, combo), enemies (by id: type, position, aim, HP and
  max HP, walk flag, lean speed, spawn fade), pickups (kind, gun, position, `fading` for a dropped
  gun's last 4 s), living props (by the id the sim gave them, 1–n in layout order; only HP), and the
  room's `phase` / `phaseT` / `run` / `map` plus the sim's `state`, `stateT`, wave, score, kills,
  queued enemies and King Naiwa's id. Positions are 16-bit (0.06 px), timers 8 or 16 bits and sent
  clamped at 0, so timers that only count down stop changing. Off the schema because the client
  works them out: an enemy's walk phase (`NetEnemy.animT` runs locally), a pickup's bob, the player's
  max HP and radius. The state is written from the sim in `onBeforePatch` (20 times a second), not
  every step. `name` is in it already for stage 5.
- **Messages,** once per tick and only when not empty: `events` (the sim's events, positions rounded
  to whole pixels and other numbers to 2 decimals), `bullet` (new bullets as
  `[id, x, y, angle×10⁴, speed, life ms, height, tint, orb, scale×100]`) and `bulletEnd` (ids of
  bullets that are gone, from comparing the bullet list before and after the step). Clients fly
  bullets in a straight line. Messages go out at once while the state goes out at 20 Hz, so events
  and bullets arrive up to 50 ms ahead of the positions they belong to.
- **Lifecycle.** `lobby`: the sim exists but isn't stepped, so players stand at the dock (the HUD
  shows "Run starts in N"); the countdown (10 s) runs while someone is in. `run`: the sim steps.
  `results`: on the sim's `over` event, for 10 s; the sim keeps stepping underneath. Then the next
  map of the rotation (`island/random` rolls a seed each time) and its lobby. When the last client
  leaves, a fresh sim on the same map and the lobby. Building the island blocks the room for
  110–200 ms once per map.
- **Browser.** `NetSim` mirrors the state with the parts of `Sim`'s interface the view, the HUD and
  the bot read (players by id, enemy / pickup / prop / bullet lists whose objects keep their
  identity, `nearestEnemy` with the map's colliders for touch auto-aim), so `PlayerView`,
  `EnemyView`, `reconcile` and the HUD needed no changes for it. `Game` takes `net` instead of making
  a `Sim`: it sends `command()` each step (an idle command while the Esc menu is open), copies the
  state each frame, draws at alpha 1 (no interpolation) and plays the broadcast events through the
  same `onEvent`. One `NetSim` per run; when the room moves on it stops following the state, so the
  old `Game` doesn't see players vanish before the new one exists. Online: Esc / P / the pause
  button open a menu and the game keeps running, hiding the tab doesn't pause, the game over slow
  motion is off, records aren't touched, the results panel follows the room's phase, a dropped
  connection shows "Connection lost" and goes back to the title. `Input` ignores keys typed into
  form fields (Space used to be swallowed).
- **The ONLINE panel.** Address, name, password, up to 5 recently joined servers (localStorage
  `naiwa-servers`, the name in `naiwa-name`), `?server=…` opens it filled in. `wss://` as is,
  `https://` → `wss://`, a bare host name gets `wss://` (`ws://` for localhost), `ws://` and
  `http://` only for localhost / 127.0.0.1, anything else gets "The address must start with wss://".
  The SDK chunk starts loading when the panel opens.
- **Bundle.** The single-player bundle doesn't contain or load the SDK: `dist/assets/index-*.js` went
  from 449.74 kB (141.06 kB gzipped) to 456.77 kB (143.85 kB gzipped) for the panel, its strings in
  both languages and `Game`'s online branch, and the CSS from 16.51 to 17.58 kB (4.99 → 5.20 kB
  gzipped). `online-*.js` (SDK, `NetSim`, protocol) is 167.87 kB (53.07 kB gzipped); `index.html`
  doesn't preload it and only the ONLINE panel fetches it.
- **Measured** on one Neoverse-N1 core (ARM, 2 cores in all), Node 24, `stats: true`, payload plus
  WebSocket frame headers (not TCP/IP):
  - 4 bot clients for 4 minutes (`tools/bot-clients.mjs --clients 4 --minutes 4`, waves 1–6, up to
    14 enemies): server CPU 4.2 % of one core, a tick 0.08–0.29 ms on average (11 ms at worst, a GC
    pause), RSS 92–108 MB, 1.2–8.5 KB/s sent per client.
  - A busy wave (the same 4 bots with the run moved on to wave 8, 25–28 enemies and up to 20 bullets
    in flight, then wave 10 with King Naiwa): 8–12.3 KB/s per client, ticks 0.3–0.5 ms on average.
    So 4 players need about 50 KB/s (0.4 Mbps) of upload, below the 15–25 KB/s per player
    estimated above.
  - An idle server: 86–94 MB RSS.
- **Checks.**
  - Single-player unchanged: `node tools/sim-headless.mjs --trace` for seeds 1–3 and the browser
    traces (headless Chromium, ticker stopped, `game.update(1/60)` by hand, seeded `Math.random`,
    view randomness on its own stream, mouse 36 px above the target) on `island/cove`,
    `factory/dairy`, `island/twins` and the run where the bot doesn't shoot are byte-identical to
    those recorded before the change. `sim-headless` (1 and 4 players), `sim-rules` and the layout
    check pass.
  - `npm run test:server`, 11 room tests: join and get the state; a client that never says ready
    stays out; wrong protocol, wrong password and full refused with their reasons (and a seat frees
    up when someone leaves); the version message carries both numbers; a bad Origin refused at
    matchmaking and at the WebSocket upgrade; NaN / infinite / huge values, unknown guns, a wheel of
    120, wrong types, random bytes on every input code (the frame that used to hang Colyseus
    included) leave the player finite and in range with no room errors, and a dash pressed for a
    single command between two steps still dashes; a client that stops sending lets go of the stick
    and the trigger after 1 s and keeps its aim; a late joiner waits for the wave break and comes
    in at it; leaving removes the player at once; everyone down → results → the next map, where
    everyone says ready again; an empty server goes back to the lobby.
  - `tools/bot-clients.mjs`: see the numbers above, no errors, every client killing and reviving.
  - Two headless browsers (one in English, one in Chinese) through `ws://localhost:7777`, each
    page's keyboard and mouse driven by `sim/bot.js` so commands go through the real input path.
    The server ran in the test process, holding each run's intro and healing the players between
    the scripted moments (SwiftShader draws about 1.5 frames a second, so bots die fast and page
    polls lag by seconds). Both saw two players; with A knocked down at the dock, B walked over and
    revived it and both pages got `revived` with A's and B's ids; each saw the other shoot (35 and
    37 shots) and move across the island, the same kills, and as many enemy sprites as enemies in
    the state; everyone down → the results panel on both → the next map (`factory/dairy`) loaded
    and joined on both. Esc opens the menu and the game keeps updating under it; Leave goes back to
    the title and the other browser sees the player go. The panel showed "The address must start
    with wss://" for `ws://example.com`, "The server runs version 2, this site needs 1", "Wrong
    password", "Server full", and a dropped connection showed "Connection lost" and then the title;
    the server was remembered under recently joined. No page errors (the browser does log the
    matchmaking request's HTTP 525 for each refusal).
  - Single-player in the browser, both themes (`island/cove`, `factory/dairy`): play, pause and
    resume, game over with the results panel and records; and `?debug&bots=3` co-op.
- **For stage 5:**
  - **Prediction.** `defineInput` is in place and the browser already sends one input per step, so
    `Predict` can number and replay them. But the room drains every buffered input per tick and
    applies only the newest movement, which moves the reconcile ack past inputs it never simulated
    (the docs warn about exactly this). For prediction, consume one input per tick per player
    (`next()` with an `idle` policy) and keep the merged one-shots.
  - **Interpolation.** Today everything snaps to each 20 Hz patch. Interpolate players and enemies
    in `NetSim` (it owns the mirrors) or with `predict.attachAll`; `NetEnemy.animT` already runs
    locally. Events and bullets arrive up to one patch before the state: delay them to the
    interpolated time (or send them `afterNextPatch`) so a kill's burst lines up with the drawn enemy.
  - **Reconnect.** `onLeave` removes the player at once and the client shows "Connection lost".
    `allowReconnection(client, 60)` should keep the seat (the player stays in the sim; after 1 s
    without commands it stands still and can be downed) and `NetSim` needs to survive the SDK's
    reconnect.
  - **Names, scoreboard, teammate colours, edge arrows:** `PlayerState.name`, `kills` and `combo` are
    already in the state; per-player score isn't (the sim only keeps a team score).
  - The loading window: a client is out of the sim until `ready`, so a slow phone joining mid-run
    misses nothing dangerous but also sees nothing until it has loaded.
  - The server log has no player join / leave lines yet; the admin page is still to come (stage 7a
    made it a console on the server's terminal instead).

## Stage 5 as built

- **Packages unchanged.** Colyseus stays at the stage 4 versions (`@colyseus/core` 0.18.19,
  `@colyseus/sdk` 0.18.5, `@colyseus/schema` 5.0.40); nothing needed an upgrade and no package was
  added. Every API below was checked against the installed sources
  (`server/node_modules/@colyseus/core/src`, `node_modules/@colyseus/sdk/src`).
- **API names, as announced:** `Predict.get(room, { delay })`, `predict.tick(now)`,
  `defineInput(…, { idle })`, the input accessor's `next()` / `wasIdle` / `take(n)` / `size` /
  `consumedCount`, `onDrop` / `allowReconnection(client, seconds)` / `onReconnect`,
  `room.reconnection`, `room.clock` (`renderNow()`, `smoothedRtt()`, `jitter()`,
  `lastServerTime()`), `@colyseus/sdk/debug` (its panel and the `__net(rtt, jitter)` latency
  simulator). **Different:**
  - `predict.reconciler()` (the flat `Reconciler`) mirrors scalar fields of one schema instance.
    The player's step also reads the arsenal (a map) and the gun (a string), so the local player
    is a `predict.sim()` (`SimReconciler`) with an opaque world: a copy of the sim's own `Player`,
    plus `adopt` and `pose` callbacks.
  - `predict.attachAll({ mode: "lerp" })` isn't used. It lerps each numeric field on its own, as
    it arrives: booleans, HP, spawns and removals land on arrival while positions lag by the
    delay, so a killed enemy vanishes `delay` ms before its burst. Its `snap` is per field, too, so
    an x can jump while the y slides. `NetSim` keeps a timeline of whole patches instead, on the
    SDK's server clock, and draws everything on it (below).
  - `room.ping()` has one callback slot, which the debug panel's own pings take over (the
    readout showed 9 ms at 150 ms). The ping is our own `ping` / `pong` message.
- **The server takes one command per player per step** (`inputs.next()`, with an `idle` policy
  that holds the last stick, aim and trigger, no presses), so the acknowledged command is the one
  that was simulated. After `STALE_STEPS` (1 s) without commands the stick and trigger are let go,
  as in stage 4; a dropped player lets go at once. Steps that ran on a held command are a debt: the
  commands that then arrive late are folded into one step (movement from the newest, presses from
  any, so none is lost), beyond `CUSHION` (2) left waiting against jitter. A player walking on
  through a stall ends up where the browser predicted. The server also folds what waits beyond
  `BACKLOG_STEPS` (12) at once, and one command a second while more than the cushion stands
  waiting. With a cushion of 1, Node's fixed-step timer (sometimes two steps in one callback)
  emptied the queue often: 109–237 steps of a minute's run went on a held command at 80–150 ms. With 2 it's 15–27, at the
  cost of one step (17 ms) of input delay on the server, which the prediction hides from the player.
- **Prediction** (`src/net/netsim.js`): every command the browser sends also runs `Player.update`
  and the belt drift (as `Sim.applyDrift`) on a copy of the local player, whose sim is a stand-in
  (map, colliders with the props of the latest state, no bullets). Nothing in `src/sim/` changed
  for it. It covers walking, wading, dashes, belts, colliders and crates, switching, reloading
  and the gun's cooldown, so the muzzle flash, shell, gun sound and the gun's kick play at once.
  The room state carries what the step reads (velocity `vx`/`vy` at 16 bits, `dashA`, `cooldown`,
  `lastWeapon`, 16-bit `dashCd` and `reloading`). On each acknowledged command `adopt` puts the
  copy back to the server's state and the SDK replays the commands still on their way; the
  correction is eased out (`smoothMs: 60`), and a jump over 120 px (respawn) is drawn at once.
  The lobby takes commands without stepping, decided per command with `ctx.memo`.
  - **Different: the wire's rounding has to be kept out.** Restarting from the state's 16-bit
    position (0.057 px steps) put the copy 0.02 px inside a wall, `moveBody` refused the move, and
    walking along the factory wall mispredicted 13 px on every acknowledgement. `adopt` keeps the
    copy's own value of every rounded field (position, velocity, timers) where it matches the
    server's to within one step of its quantization, as the SDK's flat `Reconciler` does.
  - Shots carry `seq` (the command they came from). A server shot within two commands of a
    predicted one isn't played again; an unpredicted one plays late. The prediction's dashes and
    gun sounds replace the server's copies for the local player.
  - Online, frame time comes from `performance.now()`: headless Chromium stamps every frame 1/60 s
    after the last however long it took, and its game clock ran at 66 % of real time, sending 40
    commands a second. Online frames take up to 1 s of steps (single-player keeps its 1/30 s cap).
- **Interpolation and the timeline.** Each patch is kept whole (players, enemies, living props,
  pickups) with its server time (`room.clock.lastServerTime()`). Other players and enemies are
  drawn at `T = renderNow() − smoothedRtt/2 − delay`, between the two patches either side,
  angles the short way round. A move over 150 px between patches, an enemy whose spawn fade
  restarts (put back on the map) and a respawn (dead in one patch, alive in the next) jump.
  Discrete fields (HP, down, dead, the walk flag) come from the earlier patch, so they change
  with the drawn position. `T` plays at real speed, 0.5–1.6× while it is off the mark (late
  patches after a stall are caught up over a few tenths of a second, not in one jump), never
  goes back, and holds at the newest patch when the next is late.
  - **Delay: 100 ms, more with jitter** (`50 + 4 × clock.jitter()`, up to 200), at the stage 4
    patch rate of **20 Hz**. 30 Hz would allow about 67 ms but costs about 40 % more upload in a
    busy wave (12–18.9 against 9.5–14.2 KB/s per client; events and bullets don't change with the
    rate); for a home host's upload, 20 Hz it is.
  - **Events and bullets are on the same clock.** The room sends one `tick` message per tick
    (`[t, events, born, gone]`, `t` the room clock in whole ms, as the patches carry it). Events
    play when `T` reaches them, so a kill's burst plays where the enemy is drawn, and the enemy
    goes when its kill plays. Bullets fly from where and when they were fired along `T`, so they
    leave the drawn muzzle. Events about the local player (hurt, downed, revived, died, respawned,
    laugh, pickup, an egg's bite) play as they arrive, on the predicted player. Pickups appear at
    `T` (a dropped gun with its kill) and go as soon as the server says. Props are drawn at `T`,
    their colliders follow the latest state.
  - Merging the three stage 4 messages into `tick`, with the time in whole ms, matters: the first
    version sent `events`, `bullet` and `bulletEnd` each with a float timestamp (9 bytes) and
    cost 60 % more than stage 4 in a busy wave.
- **Reconnect.** `onDrop` holds the seat with `allowReconnection(client, 60)` for the close codes
  the SDK reconnects after (going away, no status, abnormal, may-try-reconnect); a client the
  server threw out (4002) leaves at once. The held seat counts toward `maxPlayers`
  (`hasReachedMaxClients()`), the player stays in the sim standing still, can be downed, and is
  `away` in the state. The browser shows "Connection lost, reconnecting…" over the still running
  game; the SDK retries (backoff capped at 3 s), the input handle resets (its `epoch`), and the
  `SimReconciler` follows it by itself. A reconnect into a new run (the map changed or results
  passed while away) goes through the same `enterRun` as any new run. After 60 s the page gives up
  and shows the stage 4 "Connection lost". A reconnect only works with the session's token
  (`client.reconnect(token)` or the SDK's own retry), so the password and version checks of the
  first join stand, and the WebSocket upgrade still checks the Origin. `pagehide` leaves the room
  (best effort) so a closed tab doesn't hold its seat.
- **In-game UI**, both languages: names over other players' heads; colours by join order
  (`colour` in the state, the lowest one free): Naiwa's own and then sky, pink, green, orange,
  teal, built with `skins.js`'s `recolor` the first time a colour shows up, on the skin, name tag,
  minimap dot, edge arrow and scoreboard row; a laughing teammate's clip gets a hue filter in
  their colour (the filter comes with the online chunk). **Different:** not the enemies' recoloured
  skins (a purple teammate looks like a shotgun heavy). Edge arrows for teammates out of sight
  (bigger and pulsing red while down); "Watching <name>" while dead or waiting to join; the
  scoreboard on Tab (a touch button): name, kills, revives, downs (new `Player` counters in the
  sim, in the state) and ping; the ping in the top-right corner; chat on Enter (a touch button):
  one line a second, 80 characters, control characters removed on the server, shown with
  `textContent`, the last six lines fading out after 9 s, plus lines for players joining,
  leaving, dropping out and coming back. The server logs joins, leaves, drops and reconnects
  (`"log": false` in server.json turns it off).
- **`PROTOCOL` 2:** the state's new fields, the `tick` message, `seq` on shots, `chat`,
  `ping` / `pong`, `away`.
- **`PROTOCOL` 3 (review fixes after stage 5):** `laughT` is quantized over -1–14 so a laugh
  that just started (0) arrives as 0, not -0.000015 (which read as not laughing); a late joiner
  into a run nobody is up in any more ends it (the room had stayed in the run with the joiner
  waiting for a wave break that never came). `RECONNECT_SECONDS` lives in `src/sim/protocol.js`
  for both sides, and the origin rule in one `originAllowed` (server/room.js).
- **Bundle.** Single-player: `index-*.js` 463.19 kB (146.13 kB gzipped), from 456.77 kB
  (143.85 kB) for the teammate skins, the online HUD, chat and scoreboard and their strings; CSS
  19.73 kB (5.69 kB). Online: `online-*.js` 234.45 kB (75.09 kB gzipped), from 167.87 kB
  (53.07 kB), for `Predict` and the hue filter. `@colyseus/sdk/debug` is its own chunk
  (83.10 kB, 24.37 kB gzipped), fetched only for `?debug`; nothing preloads either.
- **Measured: prediction** (`node tools/net-feel.mjs`: a server and two clients in Node through
  `NetSim`, the SDK's latency model with TCP-like loss, a 200 ms stall per lost message, on the
  factory). The error is the predicted position at each acknowledged command against the
  server's; p95 / max in px:

  | rtt, jitter (each way), loss | walk | dash | belt | crate | fight | B drawn |
  | --- | --- | --- | --- | --- | --- | --- |
  | 0 | 0.05 / 4.4 | 0.13 / 0.3 | 0.04 / 0 | 0.17 / 0.2 | 0.07 / 0.1 | never starved |
  | 80 ms, ±5 | 0.04 / 9.6 | 0.14 / 0.2 | 0.03 / 0 | 0.17 / 0.3 | 0.07 / 4.4 | 1 of 3600 frames |
  | 150 ms, ±15 | 0.03 / 4.1 | 0.11 / 0.2 | 0.04 / 0 | 0.18 / 0.2 | 0.08 / 7.9 | 4 frames |
  | 150 ms, ±15, 1 % | 8.7 / 25 | 0.3 / 89 | 0.04 / 4.4 | 22 / 40 | 3.5 / 34 | 99 frames (≤ 30 ms) |
  | 250 ms, ±25 | 4.4 / 7.9 | 6.7 / 17.7 | 4.4 / 4.5 | 4.4 / 4.4 | 1.1 / 8.8 | 10 frames |
  | 250 ms, ±25, 1 % | 8.7 / 12.7 | 38 / 55 | 0.07 / 4.4 | 4.4 / 4.4 | 4.9 / 40 | 92 frames (≤ 44 ms) |

  0.03–0.2 px is the wire's rounding: up to 150 ms with jitter the prediction is exact, and
  corrections stay under 1 px at p95 (the largest 15 px, a turn on a held step). 4.4 px is one
  step of walking (a step the server ran on a held command at a turn). With loss, a 200 ms stall
  over a dash or a turn moves the player by up to a dash (89 px at worst), eased out over 60 ms:
  visible, but rare at 1 %. The fight includes hits' knockback, which only the server knows.
  Shots: every predicted shot confirmed at 0 and 80 ms, 38 of 40 at 150 ms; with loss 72 of 85
  and 10 played late. The other player, walking at 265 px/s, is drawn 25 px (0 ms) to 61 px
  (250 ms) behind the server, its drawn speed changing by at most 120–200 px/s from frame to frame
  (440 px/s while catching up after a stall).
- **Measured: the server** (`tools/bot-clients.mjs`, one Neoverse-N1 core, Node 24): the default
  run (3 bots, 3 minutes): 4.0 % CPU, no errors; 4 bots for 3 minutes over 150 ms ± 15 with 1 %
  loss: 4.8 %, no errors. A busy wave (4 bots with runs starting at
  wave 8, `--wave 8`: 25–32 enemies, up to 40 bullets, then King Naiwa): ticks 0.3–0.5 ms,
  9.5–12.2 KB/s per client (one 10-s window 14.2), 5.2 % CPU. The same tool on the stage 4 code:
  7.4–10.5 KB/s, ticks 0.36–0.45 ms. The difference is the prediction fields (each player's
  velocity, cooldown and timers go to everyone); state views (owner-only fields) could take most
  of it back, for stage 7.
- **Checks.**
  - Single-player unchanged: `node tools/sim-headless.mjs --trace` (seeds 1–3) and the four
    browser traces (`island/cove`, `factory/dairy`, `island/twins`, the bot that doesn't shoot)
    are byte-identical to those recorded before the change (which also matched stage 4's).
    `sim-headless` (1 and 4 players), `sim-rules` (now with the downs and revives counters) and
    the layout check pass. In the browser, both themes: pause, frame rates, aim, touch, HUD taps,
    dash, game over and records; `?debug&bots=3` co-op.
  - `npm run test:server`, 18 room tests, 7 new: a burst is played out one command per step with
    a press in it kept, and late commands folded with their dash; a dropped player keeps seat,
    player, kills and HP, stands still, shows `away`, and comes back as them; after the window the
    seat goes and the old token is refused; a held seat counts as full, and a reconnect from a
    site not allowed is refused; a reconnect into the next map; chat cleaned (control characters,
    trimmed), capped at 80, one line a second, empty or wrong ones dropped; names, colours by join
    order (a freed one reused), ping, downs and revives in the state, `seq` on shots.
  - `tools/bot-clients.mjs`, plain and over 150 ms ± 15 with 1 % loss: no errors.
  - Two headless browsers (English and Chinese) through `ws://localhost:7777` with the debug
    panel's latency simulator at 150 ± 30 ms (also 0 and 250 ± 50), pages driven by `sim/bot.js`
    at full frame rate with drawing switched off except for screenshots: the drawn player moves
    on the first or second frame after a key goes down (17–33 ms) while the server's copy moves
    200–500 ms later; every own shot predicted (39 of 39, 44 of 44); the other player and the
    enemies drawn without a jump (over 1000 px/s, or 700 for enemies) in 2,000 frames each; enemy
    sprites matching the timeline; names in the right colours, the scoreboard on Tab and chat
    (English and Chinese) on both; B revived A; A's network cut (offline, socket closed): the
    banner, the game running on, the seat held, back in the same `Game` as the same player; then
    everyone down and the next map while A was offline, A reconnecting into it. No page errors.
- **For stage 6 (rewind-checked PvP hits; as built in "Stage 6b as built"):**
  - The timeline already draws others between the patches the server's rewind records
    (`allowRewindState()` records on each broadcast, stamped with the same clock), so "what you
    see is what you hit" only needs the input's render time to equal `NetSim.T`. The SDK stamps
    `renderTime = reckon − (renderDelay + rtt/2)`; bind the handle's render delay to the real lag,
    `serverNow() − T − smoothedRtt()/2` (our delay adapts to jitter and `T`'s playback rate moves),
    rather than leaving it at `Predict`'s fixed `delay`.
  - Bullets are projectiles over several steps, not hitscan: a bullet should carry its shooter's
    render-time offset and test players at `now − offset` on each step (`rewind.at(time)`).
  - Co-op hits on enemies aren't lag-compensated: at 150 ms and the 100 ms delay, an egg crossing
    at 150 px/s is about 37 px from where it is drawn when the server tests the bullet. The same
    rewind would fix that.
  - Teleport thresholds (`JUMP` 150 px, the reconciler's `snap` 120 px) need checking against PvP
    respawns; the shot `seq` matching works for shots at players as it is.

## PvP deathmatch

- No AI waves. Crates and barrels respawn 30 s after being destroyed, weapon spots after 20 s.
- Spawns: walkable points far from every living player (reuse `spawnPoint`'s checks). Respawn after
  3 s with a pistol and 1.5 s of spawn protection.
- Round ends at `killLimit` or `timeLimit`, then results for 10 s and the next map.
- Bullets from players hit other players, tested where the shooter saw them (the rewind, stage 6b;
  6a tested them against the server's current positions).
  Explosions hurt everyone.
- Laugh: **decided** (it was an open question: 12 s of invulnerability is too strong if the
  laughing player can shoot): in PvP the laugh is 4 s, untouchable and unable to shoot. Co-op is
  unchanged.

## Stage 6a as built

The deathmatch rules, with hits checked against the server's current positions; the rewind is
stage 6b. The prediction and the timeline are unchanged.

- **Configuration.** `"mode": "pvp"` in server.json now starts a deathmatch server;
  `"pvp": { "killLimit": 25, "timeLimit": 600 }` is in `server.example.json` and is merged over
  those defaults key by key, so `"pvp": { "killLimit": 10 }` keeps the 600 s. `readConfig` checks
  killLimit 1–999 and timeLimit 30–3600 s. The server's start-up line says which mode it runs.
- **The sim** (`src/sim/sim.js`): `new Sim(world, layout, { mode: 'pvp', killLimit, timeLimit })`;
  co-op and single-player pass nothing and run the code they ran before (single-player traces for
  seeds 1–3 and the 4-player trace are byte-identical to those before the change). `sim.mode`,
  `sim.pvp`, and two new states: `'pvp'` while the round runs, `'over'` once it has ended.
  - No waves or enemies: `step` runs `updateWaves` only in co-op.
  - HP 0 is dead (no downed state): `onPlayerDown(P, by)` sets `respawnT` to `RESPAWN_SECONDS` (3)
    and emits `died` with `by`, the killer. The killer gets the kill and a combo (`onPlayerKilled`);
    their own barrel or bullets from a player who has left credit nobody. `downs` counts deaths.
  - Respawns (`updateRespawns`, only while the round runs): at `pvpSpawn()`, the best of 24 random
    open spots (spawnPoint's checks, factored out as `openSpot`, plus not in the water) by
    distance to the nearest living player, with `respawn()`'s pistol and full HP and
    `SPAWN_PROTECT` (1.5 s) of `invuln`.
  - Player bullets hit the other players who are up (not the shooter; a dash dodges them, as it
    does enemy bullets). They go through a player who can't be hurt (spawn protection, the
    laugh, the round over), so nobody is a shield for the one behind. **Decided while building:** they give no hit i-frames (the co-op 0.45 s
    would let only one SMG bullet or shotgun pellet in 0.45 s count) and push by 0.6 × the gun's
    knockback rather than co-op's flat 260. `Player.hurt(dmg, fromX, fromY, by, push, iframes)`
    carries both; co-op calls it as before.
  - Explosions hurt everyone in range, the player who set them off included; `by` reaches
    `hurt`, so a barrel's kills are its shooter's.
  - Laugh: on every 5th kill of a player, `PVP_LAUGH_SECONDS` (4) long, untouchable and unable to
    shoot (`Player.update` reads `sim.pvp`); it still ends with the full heal.
  - Crates and barrels come back `PROP_RESPAWN` (30) s after breaking, with the id they had (the
    browser numbers props by layout order) and full HP, a second later if a player stands there;
    weapon spots (pickups marked `spot`) come back `SPOT_RESPAWN` (20) s after being taken.
  - The round ends (`endRound`, the `over` event with `winner` and `why`) when a player reaches
    killLimit or `roundT` runs out: most kills wins, then fewest deaths, still level is a draw
    (`winner` null). Once over, guns still fire (as the browser predicts) but nobody is hurt, and
    nobody respawns or comes in until the next map (the dead get `respawnT` 0, so their HUD
    shows no countdown through the results).
- **New calls into older code, and the states they now meet** (also in those functions' comments):
  - `addPlayer` in PvP may run in the room's lobby, mid-round, or during results, with others
    alive, waiting to respawn, or nobody: it puts the player in at once at `pvpSpawn` with spawn
    protection (`respawned`, `joined`), never at the dock and never waiting for a wave break;
    during `'over'` they wait dead (`joining`) for the next map. It never ends a round.
  - `removePlayer`: the leaver's bullets in flight and pending barrels still hit, and their kills
    credit nobody; the round goes on even with nobody left in it (the room makes a new run when
    the server empties).
  - `checkRunOver` returns at once in PvP: players dead and waiting to respawn, or all of them
    dead at once after a barrel, aren't the end of a round.
  - `step` in PvP never sees an enemy; during the room's results it keeps moving players (their
    guns fire harmlessly) and stops the clock, respawns and damage.
  - The room's `ready` puts a PvP player into the sim in any phase (see `addPlayer`), the seat
    flow is otherwise unchanged; a dropped player stands still and can be killed, as a dropped
    co-op player can be downed. The `over` event comes only out of `step` (a kill or the clock),
    never in the lobby, and starts the results as in co-op; `newRun` builds the next map's PvP
    sim (`NaiwaRoom.rules()`), with a fresh clock and kill counts.
  - The room's `onLeave`: when the last player in a PvP round leaves while others are still
    loading it (seated, not yet 'ready'), the room starts a fresh round in the lobby, as it does
    when the server empties, instead of running the clock out on nobody into a draw.
- **State** (`server/schema.js`): `timeLeft` (quantized 0–3600 s, 16 bits), `killLimit`, `winner`
  (the sim's player id, 0 for none or a draw) on `NaiwaState`, so someone who joins or reconnects
  during the results sees the winner; `respawnT` on `PlayerState`; `state` can be `'pvp'` or
  `'over'`. The mode was already in the state.
- **Browser.** `NetSim` exposes `pvp`, `timeLeft`, `killLimit`, `winner` and each player's
  `respawnT`, and gives the prediction's stand-in sim `pvp` (the only change to it: the
  predicted `Player.update` reads it for the laugh). HUD: the round clock in the wave's place,
  "Kills n / limit", the leader, "Respawn in n" while dead; opponents aren't on the minimap or
  edge arrows, and while dead the camera stays on your own body rather than following an
  opponent (`Game.focus`). Toasts for your kills and deaths, the PvP laugh's own toast (and its sound cut at
  4 s), a winner / draw banner. The results panel shows the winner and your deaths; the scoreboard
  shows kills and deaths, most kills first. Not checked in a browser in this stage.
- **`PROTOCOL` 4:** the rules above, the new state fields, `died.by`, `over.winner` / `why`.
- **`PROTOCOL` 5 (review fixes after stage 6a):** bullets go through players who can't be hurt;
  the dead get `respawnT` 0 when a round ends; an empty round with players still loading goes
  back to the lobby; the dead don't spectate opponents. Checked by 2 more sim-rules checks (bullets
  through a protected or laughing player; no countdown after the round) and a 22nd server test
  (the last one in leaves while another loads).
- **Checks.**
  - `node tools/sim-rules.mjs`: 28 PvP checks, one or more per rule (no waves, hits and no
    i-frames, not the shooter, dash dodges, death and kill credit, respawn after 3 s with a pistol
    and protection, spawn protection, spawns far from the living and not the dead, the laugh, the
    co-op laugh unchanged, explosions and own barrels, everyone dead at once, crates and weapon
    spots coming back (and not in co-op), killLimit, timeLimit with tie-breaks, after the round,
    late joiners, a killer who left), plus the co-op ones as before.
  - `npm run test:server`: 21 tests, 3 new (the config's PvP checks; kills, respawns and late
    joiners through a real room; killLimit → results with the winner → the next map, still PvP,
    a joiner during results waiting).
  - `tools/bot-clients.mjs --pvp` (bots shoot each other; the bot targets the nearest other
    player it can hurt), 4 clients for 3 minutes to 8 kills
    or 90 s: two rounds (`island/cove`, `factory/dairy`), one ended (won at the kill limit), 34
    kills, 32 respawns, no enemies, no errors; ticks 0.10–0.16 ms, 1.8–3.6 KB/s per client, 4.0 %
    CPU.
  - `sim-headless` (1 and 4 players), the layout check and plain `bot-clients`: no errors.

## Stage 6b as built

Lag compensation: a player's bullets are tested where that player saw the target, in PvP and on
co-op enemies. Packages unchanged (`@colyseus/core` 0.18.19, `@colyseus/sdk` 0.18.5).

- **APIs, checked against the installed sources.** `allowRewindState({ maxRewindMs })` records the
  attached fields after `onBeforePatch` on every patch, stamped with `clock.elapsedTime`, the same
  number the browser reads as `room.clock.lastServerTime()` for that patch, so the rewind holds
  exactly what the timeline draws between (and lerps the same way). Attaching a `mode: "snapshot"`
  group makes the SDK stamp every reliable input with `round(serverNow()) −
  round(renderDelay + smoothedRtt()/2)`, in whole ms, delta-coded (about a byte). The server's
  input accessor gives it as `renderTime` (after `next()` that command's, after `take(n)` the
  newest's; a held step keeps the last). `rewind.at(time)` clamps to `[lastRecordedAt −
  maxRewindMs, lastRecordedAt]` and interpolates linearly; there is no teleport handling beyond
  `interpolate: "step"`. **Different from the plan:** not `rewind.lastSeenBy(sid)`, which reads
  the shooter's *current* stamp and has no notion of a bullet in flight; `rewind.at(time)` with a
  time per bullet and step instead. The handle's `renderDelay` can't be set after `room.input()`
  (only an internal `bindRenderDelay`), but `Predict.sim({ input })` binds it to Predict's default
  `delay`, read on every send, and `predict.setDefaults({ delay })` is public.
- **The stamp is the timeline's time** (`src/net/netsim.js`). Each frame, after working out `T`,
  `NetSim.sync` sets Predict's delay to `serverNow() − T − smoothedRtt()/2`; the commands sent in
  the next frame are then stamped `T` plus however far `serverNow()` moved, which is `T` as that
  frame draws it (the frame order is tick, send, sync, in the browser as in the tools). The SDK's
  own lerp delay isn't used (the timeline draws everything), so nothing else reads it.
- **The server** (`server/room.js`): `allowRewindState({ maxRewindMs: 500 })` with players and
  enemies (`x`, `y`) attached in `onCreate`, before anyone joins (attaching decides the stamp).
  Each step's command carries `seen`, the stamp of the newest command taken (a held step adds a
  step to the last one). The sim (`src/sim/sim.js`) keeps `seen` on the bullets a player fires and
  asks `sim.seen(target, bullet)` for every player bullet against every enemy, and in PvP every
  other player, on each sub-step: `NaiwaRoom.seenAt` answers from the rewind at `seenTime(b)`. The
  sim doesn't know about the rewind; without `sim.seen` (single-player, the tools) or with a
  command not stamped yet, bullets test current positions as before.
  - **Which time, decided while building.** The plan was "now − the shooter's offset" per step.
    Two problems, both measured: Node runs two steps in one timer callback now and then, and
    `clock.elapsedTime` is the same for both (the first version, PvP at 80 ms: p95 12.8 ms apart,
    2.5 px; counting the bullet's flight in steps instead: 1.1 ms, 0.3 px); and after a stall the browser's timeline catches up at up to 1.6× (co-op at 150 ms with
    1 % loss: p95 108 ms apart, 12.8 px). What's used: the stamp of the command the shooter is on
    at that step. The server takes one command a step, so that's the command sent with the frame
    that drew the bullet at the same age, whatever speed the timeline ran at (p95 17 ms, 2.3 px in
    the same setting). If the shooter has left, the bullet's own stamp plus its age less a step.
  - **What is as it is now:** whether a target can be hit (alive, dashing, spawn protection, the
    laugh, enemy spawn fade, the round over), the knockback's direction, the damage. Only
    positions are rewound.
  - **Teleports:** a target that moved more than `JUMP` (150 px) between two patches, or came back
    alive, has that patch's time recorded (`jumped`, a WeakMap by state entry); a rewound time
    before it means the shooter saw it before the jump (the timeline doesn't draw across one
    either), so the bullet doesn't test it (`seenAt` returns null). Without that, the rewind would
    lerp a respawned player from the corpse to the spawn point.
  - Allocation-free: `RewindView.read` into one reused object. Ticks in a busy wave: see Checks.
- **Own bullets fly on the predicted timeline** (`NetSim.fire` / `flyOwn`). Drawn on `T` as in
  stage 5, they would leave the muzzle the round trip and the delay late, and with the rewind the
  shooter would see them meet the target where the server didn't test it, off by as much as the
  rewind fixes. The prediction's `fireBullet` now makes a bullet (on a command's first run only)
  that flies from the muzzle at once, by the frame clock, tested each frame in 10 px steps against
  the walls and props (the latest colliders) and everyone as drawn this frame, by the sim's rules
  (enemies that have faded in; in PvP other players who are up, not dashing, protected or
  laughing, the round not over; pierce). Where it ends it plays the spark or dust; it shows a hit
  on a player as a spark too.
  - To fire the same pellets as the server, a shot's spread no longer comes from `Math.random`:
    `Player.shoot` seeds `mulberry32` from the player's id and a new 16-bit shot counter `shotN`
    (in the state, adopted by the prediction). Single-player traces change from here (shots
    spread differently); the rules don't.
  - Bullets carry their `owner` (`packBullet`), and `bulletHit` / `bulletEnd` the bullet's id
    (`bid`). The server's copies of a shot the prediction fired (matched through the shot's `seq`,
    as before; claimed by the shot's `bid` since `PROTOCOL` 7, below) aren't drawn, nor their hits
    and ends; a shot the prediction didn't fire is drawn on `T` as before. `bulletHit` now also has `target: 'player'` (PvP), which every browser draws.
- **`PROTOCOL` 6:** the input's render-time stamp, `shotN` in the state, the bullet's `owner`,
  `bid` on bullet events, `target: 'player'`, and the deterministic spread.
- **`PROTOCOL` 7 (review fixes after stage 6b):** `shot` carries `bid`, its first bullet (its
  pellets are `bid`, `bid + 1`, …). The browser claims the server's copies of a shot it predicted
  when the shot arrives, rather than from the tick's born bullets: a bullet that hits on its first
  step (point-blank, an enemy biting the shooter) is never born, and its hit (as a piercing
  bullet's first-step hit, which came before its born in the tick) played a second spark on top of
  the predicted one. Telemetry pairs each predicted pellet with the server's by id, i.e. in firing
  order; the born order isn't that (the sim's swap-remove reorders bullets). Checked by a sim-rules
  check (a shotgun shot's `bid` is its first pellet and the other 7 follow) and a 24th server test
  (through a real `NetSim`: a pistol shot at B 40 px away hits on the server's first step and is
  never born, and A's browser plays one hit, the predicted one; two before the fix). net-feel
  unchanged within run-to-run spread (seen vs tested p95: co-op 0.23 / 0.29 px at 0 / 80 ms, PvP
  0.46 / 0.38 / 0.41 / 4.41 px at 0–250 ms).
- **Teleport thresholds against PvP respawns.** A respawn lands at the best of 24 open spots by
  distance to the nearest living player, the killer included: in 2,000 tries on each of
  `island/cove`, `factory/dairy` and `island/twins` with the killer 150–400 px from the corpse, it
  landed 347, 787 and 430 px away at least, never under 120. So the reconciler's `snap` (120 px)
  always draws the local player's respawn at once (net-feel: corrections of 1,000–1,800 px at
  respawns, drawn at once), and the timeline never lerps across one, whatever `JUMP` says: it
  doesn't lerp to or from a dead patch. Knockback is far below both (the rifle's PvP push is
  192 px/s, under 10 px a patch). Both stay.
- **Known and measured, not changed:**
  - A bullet the shooter saw hit a target that the server already had dead (killed by an earlier
    bullet, usually the shooter's own, which the timeline shows only `T` later) flies on through
    on the server. The target dies anyway and the server's copies of own bullets aren't drawn, so
    the only effect is a rare hit on someone behind the shooter didn't see. Most of the co-op
    mismatches below are this.
  - A shot the server fires on a held step (its command came too late for its step, common at
    250 ms with ±25 ms jitter beyond the 2-step cushion) is a step off the frame its browser fired
    it in for its whole flight: ±16 ms, about 4 px for a walking target, the same step the
    prediction is off by there.
  - A short tap of the trigger can be lost after a stall. `fold()` takes the trigger from the
    newest command, like the stick (stage 5 treated it as held, not as a press), so when every
    fire command of a tap lands in a folded batch that ends after the release, the server never
    fires it. The browser has already drawn the muzzle flash, the bullet and maybe a predicted
    hit; no damage is dealt and the next correction puts the round back. Only a backlog after a
    stall does this (the once-a-second drain folds one command, so it loses only a one-frame
    tap). "Fire if any folded command fired" would trade it for an extra shot after a release
    inside the batch, aimed and stamped by the newest command, and its `seq` could fall outside
    the browser's ±2 match; left as it is until real play says the lost tap is noticeable.
- **Measured** (`tools/net-feel.mjs`; `--pvp` for the PvP scenario, `--rewind off` for current
  positions). *Seen vs tested:* each server test of one of A's bullets against a target within
  30 px of it, the tested position against where A drew that target in the frame that drew the
  bullet at that age; p95 / max in px, and how far apart the two times were (p95, ms). PvP: A's
  bot shoots B walking circles for 30 s, then both bots fight for 60 s, on `island/cove`, no loss;
  co-op: the stage 5 scenario's minute of fighting waves on `factory/dairy`.

  | rtt, jitter (each way), loss | PvP: B | co-op: enemies, rewound | co-op: enemies, current positions |
  | --- | --- | --- | --- |
  | 0 | 0.39 / 0.57 (1.5 ms) | 0.24 / 0.35 (2.0 ms) | 17.1 / 19.7 (117 ms) |
  | 80 ms, ±5 | 0.60 / 0.63 (2.5 ms) | 0.28 / 0.46 (2.3 ms) | 35.1 / 39.2 (218 ms) |
  | 150 ms, ±15 | 3.36 / 5.0 (12.5 ms)¹ | 2.29 / 6.0 (17 ms), 1 % loss | 47.0 / 65.4 (324 ms), 1 % loss |
  | 250 ms, ±25 | 4.94 / 5.2 (18 ms) | 4.70 / 7.6 (34 ms), 1 % loss | 67.9 / 70.6 (495 ms), 1 % loss |

  ¹ In the full run, alongside the co-op run on the machine's other core: 51 held steps and 23
  folded. Alone: 0.39 / 0.74 (2.0 ms) with 26 held and none folded.

  Before the rewind a co-op shooter had to lead an egg by 17 px with no lag at all (the 100 ms
  delay) and by 47–68 px at 150–250 ms; now it's under half a pixel up to 80 ms and a few px
  beyond, where commands come late. *Own bullets ended where and when the server ended them* (the
  same kind of target, within 3 steps): PvP 27 of 28, 39 of 40, 41 of 47, 71 of 84; co-op 90 of 92,
  225 of 256, 132 of 167, 165 of 204 (of the mismatches, 30 of 31, 28 of 35 and 21 of 39 on an enemy
  the server already had dead); with current positions 112 of 121, 79 of 108, 42 of 71, 46 of 94.

  *Prediction error around A's PvP events* (p95 px): the first acknowledgement that includes the
  event, which only the server knew, then the acks over the next second.

  | rtt | hurt (knockback) | died | respawned | laugh starts | duel / fight overall |
  | --- | --- | --- | --- | --- | --- |
  | 0 | 3.35, then 0.07 | 3.35, then 0.03 | 1140 (the jump), then 0.03 | 0.06, then 0.06 | 0.07 / 0.06 |
  | 80 ms | 8.10, then 0.06 | 8.10, then 0.04 | 1091, then 0.06 | 0.06, then 0.07 | 0.08 / 0.06 |
  | 150 ms | 1.94, then 0.07 | 0.05, then 0.05 | 1135, then 0.06 | 0.07, then 0.08 | 0.08 / 0.07 |
  | 250 ms | 6.80, then 4.42 | 4.35, then 0.04 | 1368, then 4.43 | 0.06, then 4.33 | 4.42 / 4.41 |

  12–14 hits, 1–4 deaths and respawns, 5–8 laughs per latency. After each event the prediction is
  back at the wire's rounding at once up to 150 ms; at 250 ms the 4.4 px (one step of walking, a
  held step at a turn) is there all the time, not around the events. The first ack's error is
  the push or the steps walked before the death (up to 8.5 px), and the respawn's jump; nothing
  the browser could have predicted, so nothing to fix. Co-op prediction is unchanged (p95 / max,
  walk, dash, belt, crate, fight): 0 ms 0.04 / 4.4, 0.13 / 0.3, 0.05 / 0.1, 0.17 / 0.3,
  0.07 / 0.1; 80 ms 0.04 / 0.0, 0.12 / 0.2, 0.03 / 0.0, 0.16 / 0.2, 0.07 / 0.2; with 1 % loss at
  150 and 250 ms as in stage 5 (fight 4.3 / 101 and 5.5 / 64).
- **Checks.**
  - `node tools/sim-rules.mjs`: 6 new checks (a bullet with `seen` tests players where `sim.seen`
    says, on each step at `seen` plus its flight; not at all where it says null; current positions
    without `seen`; co-op enemies the same; a shot's spread from the id and shot count).
  - `npm run test:server`: 23 tests, 1 new (through a real room and the SDK: commands carry the
    render time, bullets carry it, the rewind gives where the target was back then, and nothing
    from before a respawn).
  - `sim-headless` (1 and 4 players) and the layout check: no errors. `npm run build`: the online
    chunk 237.37 kB (76.08 kB gzipped).
  - `tools/bot-clients.mjs`: plain (3 bots, 3 minutes, to wave 5) and `--pvp` (2 rounds, one won
    at the kill limit, 26 kills, 25 respawns): no errors, 4.3 % and 3.4 % CPU. A busy wave (4 bots
    from wave 8, 27–31 enemies, the bots' bullets all tested through the rewind): ticks 0.30–0.55 ms,
    7.6–13.6 KB/s per client, 5.7 % CPU, against stage 5's 0.3–0.5 ms and 5.2 %.
  - `tools/net-feel.mjs` and `--pvp`: the tables above.
  - Not checked in a browser in this stage: the own bullets' drawing and sparks go through the
    view code single-player uses (`syncBullets`, the `bulletHit` / `bulletEnd` effects).

## Stage 7a as built

The owner's admin tools (2026-10-19). 7b, packaging, the hosting docs and a load test, comes next.

**A console, not an admin page.** The owner types commands into the terminal the server runs in
(`server/console.js`). It isn't on the network, so there is no password and no login: whoever has
the terminal is the owner. There is no `adminPassword`, no admin page, and no admin room message.
Browsers can't send any of these commands.

| Command | Does |
| --- | --- |
| `players` (or `list`) | who is here with their number (`#3`, by join order, never reused while the server runs), loading / playing / away, address and ping, plus the last 10 who left |
| `kick <player>` | out at once; they may join again |
| `ban <player\|address>` | a player: out, with every other seat that has their browser id (back since, another tab), and refused by browser id and address. An address: everyone here from it goes too, as with Minecraft's `ban-ip`. A player who already left (from the `players` list) can be banned too |
| `bans`, `unban <n\|name\|address>` | the list (`bans.json`), and lifting one |
| `say <text>` | a line from the server to everyone, `[Server]: …` in the chat |
| `map [theme/id\|next]` | another map now (no argument: this one and the rotation) |
| `restart` | this map from its start, in its lobby |
| `help` | the list |

A `<player>` is a number from `players` (`3` or `#3`) or a name. A name more than one player has is
refused, with their numbers.

Why not the monitor, which "Off-the-shelf pieces" first named (measured on the pinned versions):

- **`@colyseus/monitor` 0.18.6** adds 3 packages and 14 MB. Idle memory goes from 96–102 MB to
  133 MB, mostly zod. It doesn't need express: it mounts through `defineServer({ routes })`, and
  `basicAuth` is in `@colyseus/core` 0.18.19 itself.
- Its UI can list rooms and clients, show the state, message clients, edit or delete state fields,
  disconnect a client and dispose a room. It has nothing for ban, say, map or restart.
- Its `/api/room/call` calls *any* room method with JSON arguments, so its password is full control
  of the room, exposed on the tunnel's public address.
- Its "dispose" would end the only room, and nothing would make another.
- Its "disconnect" closes without a code, so the browser reconnects instead of saying why.
- **`@colyseus/admin` 0.18.6** is a panel backed by a database. It needs `@colyseus/auth`,
  `@colyseus/database` (drizzle), JWT and user accounts: 45 packages, 44 MB.

**The console without a terminal.** It is a `readline` with `terminal: false` over stdin. Ctrl+C
still stops the server, because readline's terminal mode would catch it.

- **stdin empty, closed, or not a terminal** (Docker without `-it`, a service, `< /dev/null`): it
  reads what there is. The server runs on after the end of it, and nothing in the console ends the
  process.
- **Started with `&` from an interactive shell:** reading the terminal from a background job gets the
  whole process stopped by SIGTTIN, with the room frozen. This happened when checked here.
  - Fix: the console catches SIGTTIN. The read then fails, and the error is swallowed.
  - So a background server just has no console (`fg` it, or restart it in the foreground, to type).

**Who a ban is.** An entry in `bans.json` is `{ name, id, ip, at }`. A join is refused when either
the id or the address matches.

- **The id** is a random id the browser keeps (localStorage `naiwa-id`, `src/online.js browserId`)
  and sends with every join.
  - It is checked in the static `onAuth`, so the refusal (`banned`) reaches the browser's
    `join()`.
  - It isn't in the state, so other players never see it.
- **The address**, behind a tunnel or Caddy, is always the proxy's (127.0.0.1). The real one is in a
  header that only the proxy may be believed about. `server.json "trustProxy"` (default
  `["127.0.0.1", "::1"]`) lists the proxies; only for a socket from one of them is the **last**
  `X-Forwarded-For` entry used (`bans.js clientAddress`):
  - That last entry is the one the proxy wrote itself: Cloudflare's edge, Caddy and nginx all put
    the address they saw last. Anything a client sends sits before it.
  - `CF-Connecting-IP` isn't used: behind Caddy a client can send its own.
  - A port or brackets some proxies put around the entry (`1.2.3.4:5678`, `[2001:db8::1]:5678`)
    are dropped. An entry that still isn't an address leaves the proxy's own.
  - A socket from anywhere else is its own address, whatever it claims.
- **Where the address is read.** Colyseus gives `onAuth` only `context.ip`, which it takes from
  `x-real-ip` / `X-Forwarded-For` before the socket. The matchmaking request's context has no socket
  address at all, and the room's own `onAuth` doesn't run once the static one has. So the transport
  notes the address on each socket:
  - `server/index.js`: a `WebSocketTransport` subclass whose `onConnection` (protected in the
    typings) sets `rawClient.address`. ws-transport registers it unbound, so the config comes from a
    closure.
  - `onJoin` checks the address and throws `banned`. The browser's `join()` gets that as its error,
    as it does for `onAuth`'s refusals. Colyseus then runs `onDrop` and `onLeave`, which find no
    seat.
- **Address rules.** IPv6 addresses are banned by their /64, since devices change the rest by
  themselves. An IPv4 address that arrives as `::ffff:a.b.c.d` counts as `a.b.c.d`. This machine's
  address (loopback, and anything in `::1`'s /64, which its ban would cover) and the addresses in
  `trustProxy` are never banned (`bans.js bannable`), because that is the owner's own browser, or
  everyone when a proxy forwarded nothing or isn't in `trustProxy`; such a ban goes by id alone.
  `"banAddresses": false` turns address bans off (then they are neither made nor checked).
- **What it can't stop:**
  - a new address: mobile data, a VPN, a router restart;
  - a new id: another browser, a private window, cleared site data;
  - collateral bans: an address many share (a mobile carrier's NAT, common in mainland China, or a
    school) bans everyone behind it;
  - a proxy chain that isn't trusted (Docker's bridge, Cloudflare in front of Caddy) makes everyone
    the proxy, so its address must go into `trustProxy` (7b's hosting docs say how).
  - It's a speed bump, as Minecraft's IP bans are. A server `password` is the real gate.
- **`bans.json`** sits next to `server.json` (`server/bans.json` on the defaults; gitignored). It is
  read at start and rewritten whole, to a temporary file then renamed, on every ban and unban. A
  ban or unban whose write fails changes nothing (the console says "that failed: …", and nobody is
  kicked), so the bans in force are always the ones in the file. A file
  someone broke by hand stops the server with the reason, rather than being emptied. Editing it by
  hand takes effect at the next start.

**Kicked and banned players see why.**

- The room closes their socket with `KICKED` (4100) or `BANNED` (4101), from `src/sim/protocol.js`.
  The SDK only reconnects after 1001, 1005, 1006 and 4010, so these go straight to `room.onLeave(code)`.
- A dropped player whose held seat was kicked or banned has no socket to close: their browser's
  next reconnect with its old token is closed with the code instead (`NaiwaRoom.outTokens`, the
  last 10, checked in `index.js NaiwaTransport` before Colyseus, which would close it with
  `FAILED_TO_RECONNECT` and the browser would say "connection lost").
- The browser's "connection lost" panel then says "Kicked" / "Banned" with a line on it. A later join
  is refused with "You are banned from this server".
- Everyone else's chat says "… was kicked" / "… was banned" instead of "left".

**The new calls into older code, and the states they find** (also in the comments of
`NaiwaRoom.kick`, `ban`, `changeMap` and `restart`). Console lines run in Node's event loop,
between two steps, never during one.

| Call × state | Handling |
| --- | --- |
| kick / ban while the player is still loading the map (no sim player) | `kickClient` → `onDrop` (not a reconnect code: nothing held) → `onLeave`, which only removes the seat. The browser finishes painting behind the panel and stops there (`enterRun` finds no session). |
| kick / ban of a player in the sim (alive, down, being revived, reviving, dead in PvP) | as a leave: `Sim.removePlayer` clears revives and targets. The last co-op player up gone ends the run into the results. A PvP round left with only loading players starts afresh. |
| kick / ban of a dropped player whose seat is held | There is no socket, and their token would still get them back (a reconnect never passes `onAuth`). So `seat.held`, the `allowReconnection` deferred, is rejected, and Colyseus runs `onLeave` now rather than after `RECONNECT_SECONDS`. The old token is refused, with `KICKED` / `BANNED` as the close code. |
| kick / ban just as they reconnect (resolved, `onReconnect` not run yet) | The new socket is in `this.clients`, and `kickClient` closes it. |
| ban of someone who already left | The last 10 who left are kept (`this.recent`) with name, id and address. If they came back since (a new seat with the same browser id), that seat goes. |
| `map` / `restart` in the lobby, mid co-op run, mid PvP round, or during the results | `loadMap` / `newRun` drop whatever was happening for a fresh lobby. A PvP round dropped this way has no winner and no `over`. A map given during the results replaces the one coming: the rotation moves past the map that just ended, so the one after it follows. |
| `map` / `restart` while someone still loads the old map | Their `ready` for an old run is ignored, as before. The browser loads the new map at once: `enterRun` now loops while `state.run` moved on during a load. Before, a lobby nobody was in yet sent no state change, which would have left it on the loading screen. |
| `map` off the rotation | The rotation goes on from where it was once that map ends (`offRotation`); `map next` likewise. A map in the rotation moves the rotation to it. |
| `restart` on a random island | the same seed (the world isn't rebuilt) |
| building a map | holds up the steps for about 0.15 s, as the end of every map already does |

**The server's name and motd** are in the state (`NaiwaState.name`, `motd`; `PROTOCOL` 8).
`server.json` "name" is at most 32 characters and "motd" at most 200. The browser shows them on the
loading screen and at the top of the in-game menu (online only), and the ONLINE panel's recent
servers are labelled with the name they had last time.

**Checked:**

- `npm run test:server`: 46 tests, 22 new (5 of them after a review of 7a).
  - `room.test.js` calls the console's `command()` on the running room:
    - `help`, `players`, `say`, unknown commands;
    - kick while playing, and by name: refused when no one or two players match;
    - kick while loading;
    - kick of the last co-op player up, which ends the run;
    - kick and ban of a held seat (gone at once, token refused);
    - kick during a reconnect;
    - bans by id and by address: loopback by id only, `banAddresses: false`, `ban <address>`
      kicking everyone from it, IPv6 /64, and `clientAddress` ignoring headers from untrusted
      peers;
    - ban of someone who already left, `unban`, and `bans.json` read back (a broken file is an
      error);
    - `map` in the lobby, mid-run and during the results, `map next`, off the rotation, and a bad
      name;
    - `map` / `restart` while someone still loads;
    - `restart` with a random seed;
    - PvP `map` / `restart` mid-round (no `over`), and a kick of the last player in the round;
    - the new `server.json` keys;
    - after the review: a held seat kicked or banned closes the browser's next try with the code; a
      ban takes every seat with that browser id; `::1`'s /64 and `trustProxy` addresses aren't
      banned; a ban or unban `bans.json` can't take changes nothing; a map off the rotation picked
      during a rotation map's results is followed by the next one; forwarded addresses with a
      port or brackets; the browser id pattern, shared as `protocol.js BROWSER_ID`.
  - `console.test.js` starts real servers:
    - commands from a pipe, and the server running on after it ends;
    - stdin `/dev/null`, and stdin closed;
    - started with `&` from an interactive shell through `script`: running, not "Stopped (tty
      input)". Without the SIGTTIN guard this test fails.
- A browser (headless Chromium on the built site, `vite preview`) against a real server driven
  through its console. All steps passed:
  - the name and MOTD in the in-game menu and on the loading screen;
  - `say` in the chat as "[Server]: …";
  - `map` twice, the second arriving while the browser still built the first (page CPU throttled
    ×6; it went straight on to the second map and in);
  - "Kicked", then the recent server listed by its name;
  - "Banned" (this machine: by browser id), then a new join refused with "You are banned from
    this server".
  - The same steps against the old `enterRun` also got in. Another state change woke it soon
    after, so the stuck loading screen didn't show in that test. The loop takes away the
    dependence on such a change.
- `sim-headless` (1 and 4 players), `sim-rules`, the layout check: no errors. `npm run build`: the
  online chunk is 237.46 kB (76.15 kB gzipped).
- `tools/bot-clients.mjs`: 3 bots, 3 minutes, to wave 5, 4.2 % CPU; and `--pvp`: 2 rounds, one won
  at the kill limit, 24 kills, 22 respawns, 3.6 % CPU. No errors in either.
- `tools/net-feel.mjs` (nothing it measures changed; run as a check):
  - Prediction error p95 0.04–0.17 px at 0 and 80 ms, with no timeline starving.
  - `--pvp`: the target as seen against as tested, p95 0.36, 0.40 and 0.49 px at 0, 80 and 150 ms,
    and 3.97 px at 250 ms. The prediction is back at the wire's rounding within a second of each
    PvP event.

## Stage 7b as built

Packaging, publishing, the hosting docs and a load test (2026-10-19). Owners now run
`npx naiwa-server@latest` or the Docker image, and follow `docs/hosting.md`.

**The npm package `naiwa-server`** (public on npmjs.com, Apache-2.0 like the repo; the repo stays
private). `tools/pack-server.mjs` builds it in `build/`:

- **Copied, not bundled.** The server's files and what they import (`src/sim/` and `src/island.js`,
  `factory.js` and `noise.js`, which the sim's map builders use) go in at the same relative
  paths. So every import works unchanged, a stack trace points at the same file and line as in the
  repo, and there is no bundler to add or configure. Only files reachable by imports from
  `server/cli.js` go in: not `sim/bot.js`, the view or the tests.
- The Colyseus packages stay dependencies at their pinned versions, and an `npm-shrinkwrap.json`
  (the server's `package-lock.json` pruned of its devDependencies) gives every install the tree
  that was tested, transitive dependencies included. A newer `ws` reaches owners only with a new
  release.
- The script lists what npm would publish and fails on anything outside an allowlist
  (`package.json`, `README.md`, `LICENSE`, `npm-shrinkwrap.json`, `server/*.js` outside `test/`,
  `server/server.example.json`, `src/**/*.js`). The 0.1.0 tarball: 21 files, 92 kB packed,
  281 kB unpacked (35 kB of it the README). No tests, `.env`, `server.json`, `bans.json` or scratch files.
- The package's README is `docs/hosting.md`, so the guide is on npmjs.com, the one public page
  owners can read (the repo is private).
- `server/cli.js` is the package's command. Its config is `./server.json` in the directory it is
  started from, or the path given; `bans.json` goes next to it. With neither, it copies the example
  there and says where. It refuses Node < 22 with a message (checked on Node 20: npm only warns
  `EBADENGINE`), and a directory it can't write with what to do. `--version`, `--help`.
  `npm run server` in the repo keeps `server/server.json` or the defaults, as before.
- `server/index.js` prints `naiwa-server <version> (protocol N)` on start (`VERSION` from
  `server/package.json` in the repo, the package's own `package.json` one level up in the package).

**The Docker image `ghcr.io/imlaow/naiwa-server`** (`server/Dockerfile`, built from the repo root
with `.dockerignore` sending only `server/`, `src/`, the pack script, `docs/hosting.md` and
`LICENSE`):

- Two stages. The first runs `tools/pack-server.mjs` and installs the tarball into `/app`, on the
  build machine's own platform (`FROM --platform=$BUILDPLATFORM`): the packages are plain JS, so the
  amd64 image builds on this arm64 machine with no QEMU. The second is `node:24-alpine` with only
  `COPY` lines (no `RUN`, which would need the emulator), `USER node` (uid 1000), `WORKDIR /data`,
  `VOLUME /data`, the entrypoint `node /app/node_modules/naiwa-server/server/cli.js`. So it runs
  exactly what `npx` runs, with `/data/server.json` made on a first start.
- About 66 MB compressed per platform (`node:24-alpine` is 62 MB of that); 263 MB on disk for arm64.
  The amd64 image was inspected (an x86-64 musl `node`, the same package, user and entrypoint) but
  can't run here without a binfmt emulator.
- Node is PID 1. Colyseus handles SIGTERM, so `docker stop` takes 0.17 s, not the 10 s kill.
- **The console in a container** (all checked here through a pseudo-terminal):
  - `docker run -dit` then `docker attach`: commands work. Ctrl+P Ctrl+Q detaches and the server
    runs on. Ctrl+C in the attach stops it (exit 0; `docker start` brings it back).
  - Without `-it`, stdin is empty: the server runs on, and the console now says so in the log
    (`(stdin ended: …)`, `console.js`), which also covers a service and `< /dev/null`.
  - Compose with `stdin_open` and `tty`: `docker attach` and `docker compose attach` both work.
  - Editing the config: `docker exec -it naiwa vi /data/server.json` works (busybox vi).
  - A bind-mounted directory owned by root: the first start couldn't write `server.json` and
    crashed with a stack trace. `cli.js` now says to `chown 1000:1000` it, and that fix was checked.
- **What address the server sees through Docker's port mapping** (checked with `players`):
  connections to the host's `127.0.0.1` or `::1` come through docker-proxy from the network's
  gateway: `172.17.0.1` on the default bridge, `172.22.0.1` on the Compose project's network here.
  A connection to the host's own LAN address kept its address (10.0.0.115). So a tunnel or Caddy
  on the host arrives as the gateway, and `trustProxy` must hold it: `["172.17.0.1"]` for
  `docker run`. Without that, everyone was 172.17.0.1, and banning one player's address would have
  refused them all. The docs publish the port on `127.0.0.1` only (Docker's published ports bypass
  ufw, and nothing but the tunnel or Caddy on the host needs it).
- **A new log line for an untrusted proxy** (`index.js transport`): a socket that sent
  `X-Forwarded-For` from an address not in `trustProxy` is named once per address
  (`a connection from 172.17.0.1 came through a proxy …, add it to "trustProxy"`), unless it is a
  raw TCP tunnel. That is how a Docker or Compose owner finds the gateway to trust. It can't spot the
  opposite mistake (a raw TCP tunnel on a trusted 127.0.0.1), which only the docs can warn about.

**Proxy chains, checked with real Caddy 2.11.7 and cloudflared 2026.10.1:**

- Caddy alone: it replaces whatever `X-Forwarded-For` the client sent with the address it saw, so
  the default `trustProxy` is right (a forged header from 10.0.0.115 came out as 10.0.0.115).
- **Cloudflare in front of Caddy needs more than 7a thought.** Trusting Cloudflare in Caddy
  (`trusted_proxies`) makes Caddy *append* Cloudflare's edge (`client, edge`), and not trusting it
  makes the header just the edge. Either way the last entry, the one `clientAddress` reads, is
  Cloudflare's edge, so the server would ban Cloudflare edges. The recipe: `trusted_proxies static
  <Cloudflare's ranges>`, `client_ip_headers Cf-Connecting-Ip` and
  `header_up X-Forwarded-For {client_ip}`. Checked with 127.0.0.1 standing in for Cloudflare: a
  request from "Cloudflare" gets the `CF-Connecting-IP` address; one from elsewhere with a forged
  `CF-Connecting-IP` gets its own address.
- The whole chain: bots over `wss://` through Caddy (`tls internal`) into the arm64 container, and
  through a real quick tunnel (`trycloudflare.com`) into the container and into the npm install.
  Through the tunnel, `players` showed this machine's public address in both.
- Raw TCP tunnels: simulated with a local relay that adds `X-Forwarded-For: 6.6.6.6`, as a client
  can through playit.gg or ngrok tcp. With the default `trustProxy` the player was 6.6.6.6, with
  `[]` 127.0.0.1. Hence `[]` in the docs and the `bans.js clientAddress` comment, with the exception
  of an `ssh -R` port only Caddy on the VPS can reach. These tunnels carry no TLS, so browsers can't
  join through them alone.
- Ban by address and `bans.json` in the volume, through Caddy and Docker with the gateway trusted:
  the banned address refused (`banned`), `unban` lifting it.

**Smaller fixes found on the way:**

- A port in use made `npm run server` hang for good. ws-transport prints the error, but Colyseus
  0.18.19 only rejects `listen()` for errors after it listens. `start()` now races the HTTP server's
  first `error`, and the owner is told which port and file.
- `tools/bot-clients.mjs --server <url> [--pid N]` joins a server already running (the package, the
  container, a tunnel), whose own `server.json` sets the rules, and reports its CPU from `--pid`.

**The load test: `tools/bot-clients.mjs`, not `@colyseus/loadtest`.** loadtest 0.18.3 is a blessed
terminal UI that starts N copies of a client script. The CPU, memory and bytes it shows are its own
process's and what its clients received, not the server's, and its clients would have been our bots
anyway (a client that only joins never says `ready`, so the server never runs a fight). It would add
blessed, typescript and a second `@colyseus/sdk`, and give nothing bot-clients doesn't. bot-clients
reports the server's own `stats` (tick time, memory, bytes sent per client) and its CPU from
`/proc`. Run alone on this machine (2 Neoverse-N1 cores, Node 24, other services idling at a load of
about 0.5), 3 minutes each, `maxPlayers` = the bots:

| Run | Server CPU (one core) | RSS | Tick avg / max | Sent per client (mean / peak 10 s) | Estimate ("Server size") |
| --- | --- | --- | --- | --- | --- |
| co-op 4, from wave 8 (to wave 10, up to 28 enemies) | 5.3 % | 102–121 MB | 0.30 / 11.2 ms | 7.5 / 12.5 KB/s | < 10 %, 100–150 MB, 15–25 KB/s |
| co-op 8, from wave 8 (to wave 10) | 8.0 % | 95–122 MB | 0.45 / 6.2 ms | 10.9 / 16.4 KB/s | the same; 1.5 Mbps in all |
| PvP 4 (44 kills) | 3.7 % | 91–106 MB | 0.10 / 2.7 ms | 2.3 / 2.8 KB/s | |
| PvP 8 (107 kills) | 6.0 % | 92–117 MB | 0.21 / 3.3 ms | 4.9 / 5.7 KB/s | |

- Every figure is under the estimate. Eight players in a busy co-op wave send about 1 Mbps at the
  peak (0.7 Mbps on average), against 1.5 Mbps estimated, and use under a tenth of a core.
- PvP sends far less than co-op: no enemies, and players' bullets are few.
- The 11 ms tick is a single one in the co-op 4 run: a GC or a map build, still under the 16.7 ms
  step.
- The bots themselves (one process, 8 NetSims) took 11–13 % of a core for 8 players. The recommended
  minimum stays 1 vCPU and 512 MB–1 GB.

**`docs/hosting.md`**, in Chinese and English: install with npx or Docker (and Compose), updating,
`server.json`, localhost testing, the quick tunnel, a named tunnel, Caddy, Cloudflare in front of
Caddy, raw TCP tunnels, a `trustProxy` table for each setup, every console command and how to reach
the console under npx, tmux, Docker, Compose and systemd, bans, firewall and ports, mainland China,
and the measured machine size. Commands not run here are marked: the named tunnel, Caddy with a
real domain, apt and ufw, the system service (the same command ran under `systemd-run --user`; a
node from nvm needs its full path there), the macOS and Windows installs, playit.gg / ngrok /
ssh -R. The ONLINE panel has no help text to link it from. The README links it.

**Published** (2026-10-19), once every check above had passed:

- npm `naiwa-server@0.1.0` (`latest`), published by `laowdev` with a one-time code (the account
  needs 2FA to publish; a plain `npm publish` is refused with 403). Its shasum is the tarball
  tested here. Checked from outside: `npx --yes naiwa-server@0.1.0` in an empty directory with an
  empty npm cache made `server.json`, and bots and the console worked against it. In a terminal,
  npx first asks `Ok to proceed? (y)`.
- `ghcr.io/imlaow/naiwa-server:0.1.0` and `:latest`: one index with linux/arm64 and linux/amd64
  (plus the build's attestation), pushed with `docker buildx … --push`. A new ghcr package starts
  private, and GitHub's API can't change a container package's visibility. So it was made public
  by hand, under the package's settings ("Change visibility"). Checked: a `docker pull` with no
  login, and bots against that image. Before that, with a login: `docker pull`, the
  guide's `docker run -dit …` and its Compose file word for word: bots, the console, and
  `172.17.0.1` through the port mapping.
- Found by running the guide's commands against the published artifacts: `tmux new -s naiwa
  'npx …'` dies at once with an nvm node (tmux runs the command without the shell's PATH). The
  guide now opens the session first. The README on npm is still the old text until the next
  version.


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

**Messages (broadcasts), for things that happen once** (formats in `src/sim/protocol.js`):

- `tick` (since stage 5 one message per tick; stage 4 sent `events`, `bullet` and `bulletEnd`): the
  tick's room-clock time, the sim's fx/sfx/HUD events, new bullets and ended bullets. Bullets aren't
  in the state: the server sends `{ id, x, y, ang, speed, life, kind }` and clients move each one in
  a straight line until it ends.
- `chat`: players' lines, and someone joining, leaving, dropping out or coming back.

**Joining:** `client.join("naiwa", { protocol, name, password, id })`. `onAuth` rejects a wrong
`PROTOCOL` (from `src/sim/protocol.js`, bumped whenever the sim or state changes), a full server, a
wrong password or a banned browser id, and `onJoin` a banned address (stage 7a); the reason is shown
to the player ("server runs version N, this site needs M"). `beforeUpgrade` checks `Origin` against `allowedOrigins`. Colyseus handles reconnecting
after a drop. `allowReconnection(client, 60)` holds the player's slot.

**Feel:** `Predict` runs the shared movement step for the local player and reconciles against the
server. Other players and enemies are drawn a fixed delay in the past, between server states. The
local player's muzzle flash, shell, sound and own bullets play immediately; others' bullets and
all damage come from the server, which tests a player's bullets where that player saw their
targets (stage 6b). `@colyseus/sdk/debug` (drift telemetry and a latency simulator) is how we tune it. See
"Stage 5 as built".

## The server program

```
server/
  index.js        defineServer(): NaiwaRoom, the transport, port from server.json, the console
  room.js         NaiwaRoom: onAuth, onJoin/onLeave, fixed step → Sim, mode rules, map rotation
  cli.js          the package's command (npx naiwa-server, the image): ./server.json
  console.js      the owner's commands, typed into the server's terminal
  bans.js         bans.json, addresses behind a tunnel
  schema.js       NaiwaState and friends
  server.example.json
  Dockerfile
```

- Node 22+ (Colyseus 0.18's minimum). Imports `src/sim/` directly, so map and rule changes reach the
  server with no copying. Run from the repo with `npm run server`. Published as the npm package
  `naiwa-server` (`npx naiwa-server`, with `src/sim/` copied in) and the Docker image
  `ghcr.io/imlaow/naiwa-server` (stage 7b).
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
    "allowedOrigins": ["https://<official site>", "http://localhost:5173"],
    "banAddresses": true,
    "trustProxy": ["127.0.0.1", "::1"]
  }
  ```

- Lifecycle: waiting lobby (the run starts 10 s after the first player joins), then the run, results,
  next map. Late joiners in co-op drop in at the dock with a pistol at the next wave break, or right
  away if the run is still in wave 1.
- Admin: commands typed into the terminal the server runs in (`help`, `players`, `kick`, `ban`,
  `bans`, `unban`, `say`, `map`, `restart`). The terminal is the owner's, so there is no password,
  no admin page and nothing an admin could do from a browser. Bans are kept in `bans.json` next to
  `server.json`. See "Stage 7a as built".
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

1. **Layout extraction. Done.** Pure layout for island and factory, scenes draw from it. Check: identical
   collider / prop / weapon-spot lists for all seven maps (a small Node script).
2. **Sim / view split. Done.** `src/sim/` with commands, events and a fixed step; the view in `src/view/`.
   Check: single-player plays the same; a Node script runs the sim headless for 10 minutes of waves
   with a scripted bot and no errors.
3. **Several players in the sim. Done.** Targeting, spawns, scaling, downed/revive, per-player laugh.
   Check: a headless run with 2–4 bots.
4. **Colyseus server and join screen. Done.** `server/`, schema, `NaiwaRoom`, `onAuth` version check,
   the ONLINE panel. No prediction yet. Check: `@colyseus/testing` room tests; two browsers play
   co-op through `ws://localhost` (the quick tunnel is the owner's part and wasn't tested here).
   See "Stage 4 as built" below.
5. **Feel. Done.** `Predict` reconciliation and interpolation, tuned with the SDK debug panel.
   Reconnect, scoreboard, names, chat. See "Stage 5 as built".
6. **PvP mode,** with rewind-checked hits. **Done.** 6a: the deathmatch rules (see "Stage 6a as
   built"). 6b: bullets tested where their shooter saw the target, in PvP and on co-op enemies
   (see "Stage 6b as built").
7. **Admin, packaging and docs. Done.** 7a: the owner's console (kick, ban, say, map, restart;
   see "Stage 7a as built"). 7b: `docs/hosting.md` (tunnel and Caddy recipes in Chinese and
   English, `trustProxy` for Docker and proxy chains), the Docker image, the npm package, a bot
   load test at `maxPlayers` 4 and 8 (see "Stage 7b as built").

## Open questions

- Teammates have distinct colours by join order (stage 5); picking a skin is still open.
- Chat is text, rate-limited and cleaned (stage 5); the owner can kick and ban from the console
  (stage 7a), but there is no mute or chat filter. Whether servers want a way to turn chat off is
  open.
- Later: an optional public server list (servers announce themselves to the official Worker). Not
  part of option 3 as chosen.
