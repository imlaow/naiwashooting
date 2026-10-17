# Online play: self-hosted servers (design)

Status: **stages 1–3 of 7 done** (layout extraction, the sim/view split and several players in the
sim, 2026-10-17). This is the agreed design; build it in the stages at the end.

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

**Keep it light.** Measured 2026-10-17:

- **Server:** don't install the `colyseus` meta-package. It pulls in uWebSockets binaries for every
  platform, plus Redis, auth and pm2 (180 MB, 159 packages). `@colyseus/core` + `@colyseus/ws-transport`
  + `@colyseus/schema` is 20 MB and 84 packages, and idles at about 80 MB of memory on Node 24 (bare
  Node is 44 MB). Add `@colyseus/monitor` only if the admin page is wanted.
- **Browser:** `@colyseus/sdk` with `Predict` adds about 69 KB gzipped (the game's JS is about 233 KB).
  Load it on demand when ONLINE opens.

**Server size.** Measured on one Neoverse-N1 (ARM) core, Node 24: building the island takes 140 ms
and 15 MB, the factory 3 ms. A synthetic heavy tick (20 enemies steering, 120 bullets, line-of-sight
checks, 8 players moving) takes 0.22 ms, so 1.3 % of a core at 60 Hz. Allowing ×5 for the real sim plus
schema encoding, that's under 10 % of one core and about 100–150 MB of memory with Colyseus. Upload
bandwidth is the real limit. The estimate is 15–25 KB/s per player (20 Hz delta patches + bullet and
event messages), so about 0.8 Mbps for 4 players and 1.5 Mbps for 8. Measure it in stage 7.
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
 │ HUD                      │  wss (tunnel)   │ server.json, monitor         │
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

## PvP deathmatch

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

1. **Layout extraction. Done.** Pure layout for island and factory, scenes draw from it. Check: identical
   collider / prop / weapon-spot lists for all seven maps (a small Node script).
2. **Sim / view split. Done.** `src/sim/` with commands, events and a fixed step; the view in `src/view/`.
   Check: single-player plays the same; a Node script runs the sim headless for 10 minutes of waves
   with a scripted bot and no errors.
3. **Several players in the sim. Done.** Targeting, spawns, scaling, downed/revive, per-player laugh.
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
