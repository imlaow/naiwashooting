# 奶蛙射击 (Naiwa Shootout)

A top-down 2D island shooter built with [PixiJS](https://pixijs.com) v8 and Vite.
The hero is Naiwa, whose sprite frames are cut from `mmexport1791681378822.jpg`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

Pick a map on the title screen's **选择地图 / MAPS** dashboard. Maps are grouped by theme; the
island theme has six hand-tuned islands plus a random card that rolls a fresh seed, and the
factory theme has the **奶蛋加工厂 / Dairy Plant**. Each card shows a painted preview and that
map's best score, best wave and run count (kept in the browser). `?map=island/twins` or
`?map=factory/dairy` opens a map directly and `?seed=1234` plays a random island with that seed.

Phones always play in landscape: Android locks the orientation in fullscreen, and an upright iPhone gets the page rotated a quarter turn.

## Online co-op (self-hosted servers)

Anyone can run a `naiwa-server` and friends join it from the site's **联机 / ONLINE** button
(server address, name, password if any; recently joined servers are remembered). A link with
`?server=wss://…` opens straight into that panel. The server runs the game and the browsers draw
it: your own player is predicted so it answers at once, everyone else is drawn a moment in the
past so they move smoothly, and a dropped connection reconnects by itself (the server keeps the
seat for 60 s). Teammates wear their own colour and name; Tab shows the scoreboard and Enter opens
the chat. See `docs/online.md` for the design and what is still to come.

```bash
npm install --prefix server        # once: the server's own packages (Colyseus), kept out of the site build
cp server/server.example.json server/server.json   # optional, edit to taste
npm run server                     # ws://localhost:7777; Node 22+
npm run test:server                # the room tests
```

`server/server.json` (any key left out takes the value from `server.example.json`):

| Key | Meaning |
| --- | --- |
| `name` | The server's name (up to 32 characters): in its log, on the players' loading screen and menu, and in their recently joined servers |
| `motd` | A message of the day under the name (up to 200 characters, `""` for none) |
| `port` | Local port for plain `ws://` (default 7777) |
| `mode` | `"coop"` (waves of enemies) or `"pvp"` (deathmatch) |
| `pvp` | `{ "killLimit": 25, "timeLimit": 600 }`: a PvP round ends when someone reaches killLimit kills (1–999) or after timeLimit seconds (30–3600) |
| `maxPlayers` | Players at once (1–16, default 4) |
| `password` | `""` for none |
| `maps` | The rotation, e.g. `"island/cove"`, `"factory/dairy"`, `"island/random"` (a new island each time) |
| `allowedOrigins` | Sites whose pages may join (the official domains and `http://localhost:5173` by default); `["*"]` for any |
| `banAddresses` | `true` (default): a ban also refuses the player's address, not only their browser |
| `trustProxy` | The tunnel or proxy in front of the server (`["127.0.0.1", "::1"]`: one on the same machine). Only from these is the forwarded `X-Forwarded-For` address believed |
| `log` | `true` (default) prints a line when someone joins, leaves, loses the connection or comes back |
| `stats` | `true` prints time per tick, memory and bytes sent per player every 10 s |

The site is served over HTTPS, so browsers can only reach a server through a `wss://` address
(`ws://localhost:7777` works from the same machine). A run starts 10 s after the first player is
in, ends when everyone is down or dead, shows the results for 10 s and moves on to the next map.
In PvP a round ends at the kill or time limit instead; the dead respawn 3 s later with a pistol.

The owner runs the server from its own terminal: type `help` there. `players` lists who is here
with their numbers; `kick 3`, `ban 3` (or a name, or `ban 1.2.3.4`), `bans`, `unban 1`,
`say hello`, `map factory/dairy` (or `map next`) and `restart` do what they say. Bans are kept in
`bans.json` next to `server.json`; they go by the player's browser and address, so another browser
on another network gets back in. Without a terminal (Docker, a service, started in the background)
the server runs the same, without the commands.

The UI defaults to Chinese. Use the 中文 / EN toggle on the title screen (remembered per browser) or add `?lang=en`.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD / arrows | left stick (bottom-left) |
| Aim & shoot | mouse, hold left button | right stick (bottom-right) |
| Dash (i-frames) | Space / Shift | tap left side |
| Reload | R | automatic, or tap the ammo count |
| Switch weapon | 1–4, wheel, Q (last) | tap a weapon slot |
| Pause / mute | P or Esc / M | top-right buttons |
| Online: scoreboard / chat | hold Tab / Enter | top-right buttons |

## Gameplay

- You start on the beach by the dock. Waves of rivals land on the shores: yellow eggs that waddle up and bump into you, long-eared bunny gunners, and purple shotgun heavies.
- Every 5th wave, **King Naiwa** shows up. He sprays bullets, fires rings of orbs, and summons eggs.
- Weapons are hidden around the island: a shotgun by a village hut, an SMG at the hilltop lookout tower, and a rifle on a remote beach. Enemies and crates also drop weapons, ammo and medkits.
- Shooting a red barrel makes it explode, and nearby barrels go off too.
- Shallow water slows you down. Kill enemies in quick succession to build a combo multiplier.
- Every 5th kill, Naiwa stops and laughs his head off for 12 seconds. He can't move or shoot while laughing, but nothing can hurt him.
- In the factory, the two conveyor belts in the production hall carry anyone standing on them (in opposite directions), the milk canal is wadeable but slow except on the two bridges, and machines, silos, containers and the warehouse and boiler house are cover. The SMG is under the water tower, the shotgun outside the warehouse and the rifle in the far corner behind the tanks.

## Code map

| File | Purpose |
| --- | --- |
| `src/maps.js` | The browser side of the map catalogue: each theme's scene class, thumbnail and loading lines, the worlds cache and per-map records |
| `src/sim/maps.js` | Map catalogue without Pixi: themes, their variants (seed + terrain knobs for islands), `makeChoice` and `buildMap` (world + layout from `{ theme, id, seed }`). A new theme is one more entry here, see the file header |
| `src/sim/layoutIsland.js` | Island layout: huts, vegetation, rocks, props, weapon spots and their colliders, from the seeded RNG; no Pixi or DOM |
| `src/sim/layoutFactory.js` | Factory layout: the perimeter wall plus `Factory.plan()`'s solids, props and weapon spots, as colliders in insertion order |
| `src/sim/sim.js` | The game itself, without Pixi, DOM, audio or HUD: colliders, props, players (co-op, 1–4: `addPlayer` / `removePlayer`, downed and revive, respawns at the wave break), bullets, pickups, waves, scoring. `step(STEP, { [id]: cmd })` at a fixed 1/60 s; what happened comes out as events (list at the top of the file) |
| `src/sim/entities.js` | Player and enemies (position, HP, timers, AI, enemy targeting), weapon and enemy stats, gun sizes, `LAUGH_SECONDS` and the downed/revive constants; a player takes a command per step |
| `src/sim/bot.js` | The scripted player: the headless runs' bots and the browser's debug teammates (`?debug&bots=N`) |
| `src/sim/physics.js` | Static colliders in a spatial hash: push-out, point and line-of-sight tests |
| `src/sim/protocol.js` | What server and browser must agree on: `PROTOCOL` (bump it whenever the sim, the room state or a message changes), the bullet and event message formats |
| `server/index.js` | `naiwa-server`: reads and checks `server.json`, refuses WebSocket upgrades from sites not in `allowedOrigins`, notes each socket's address, runs one `NaiwaRoom` and the console (`npm run server`) |
| `server/room.js` | `NaiwaRoom` (Colyseus 0.18): joining rules (version, full, password, origin, bans), lobby → run → results → next map, the 1/60 s step taking one command per player per step, the sim's events and bullets out as messages stamped with the room clock, the state written before each patch; seats held for 60 s after a drop, chat, the join/leave log; the console's kick, ban, say, map change and restart |
| `server/console.js` | The owner's console: the commands typed into the server's terminal, read from stdin (and still running without one) |
| `server/bans.js` | `bans.json`, and the address a player connects from (the socket's, or a trusted proxy's `X-Forwarded-For`) |
| `server/schema.js` | The room state (`@colyseus/schema`): players, enemies, pickups, living props, the map choice and the sim's wave state; and the `Command` clients send |
| `server/test/room.test.js` | Room tests with `@colyseus/testing` (`npm run test:server`) |
| `server/test/console.test.js` | The console in real server processes: stdin piped, empty, closed, or a background job's terminal |
| `src/net/netsim.js` | `NetSim`: the room's state mirrored with `Sim`'s interface, so `Game`, the views, the HUD and the bot draw and read it as they do a local sim. Predicts the local player (the sim's own `Player.update` on a copy, reconciled by `@colyseus/sdk`'s `SimReconciler`) and draws everything else, events and bullets included, on a timeline a little in the past, between patches |
| `src/net/online.js` | Joins a server with `@colyseus/sdk` (reconnecting after a drop) and turns refusals into reasons; loads the SDK's debug panel for `?debug`; loaded only when ONLINE is used |
| `src/online.js` | The ONLINE panel's address rules, recently joined servers, the player's name and the browser's id (which bans go by) |
| `src/dashboard.js` | The map dashboard: a section per theme, preview cards, random-seed card |
| `src/island.js` | Height map, coastline, village/dock/path layout, terrain painting; `DEFAULT_SHAPE` lists the knobs a map can turn |
| `src/factory.js` | The factory map's layout (hall, belts, canal, tank farm, buildings, yard), its floor painting and minimap; same terrain interface as `Island` plus belt `drift` |
| `src/factoryArt.js` | Painted factory textures (silos, water tower, chimney, machines, containers, lorry, buildings), built the first time a factory loads |
| `src/art.js` | All procedural textures (palms, huts, rocks, gulls, guns, FX); guns are painted at the sim's `GUN_SIZES` |
| `src/skins.js` | Loads hero frames, the egg and bunny-gunner cut-outs (`public/assets/egg.png`, `gunner.png`), builds recoloured rival skins and, online, the teammates' colours (`TEAM`) |
| `src/view/game.js` | The game in the browser: runs the sim's steps for each frame (online: sends the command each step and draws the room's state through `NetSim`, no pause), turns input into the local player's commands (touch auto-aim included) and events into particles, sounds, banners and shake (shake, toasts and the laugh sound only for the local player); sprites for players, props, pickups and bullets; camera, pause, title-screen demo, `?debug&bots=N` |
| `src/view/entities.js` | `PlayerView` / `EnemyView`: sprites, walk cycle, recoil, hit flash, footsteps, dash ghosts, downed look and revive ring, crown, health bars; online a player's colour and name tag |
| `src/view/world.js` | Draws the island from its layout: water, vegetation, ambient life |
| `src/view/factoryScene.js` | Draws the factory from its layout: perimeter wall, sprites, moving belts and cartons, smoke, steam, lamps |
| `src/view/hud.js` | HUD, minimap, banners, crosshair, touch sticks; online also arrows to teammates out of sight, who is being watched, the ping |
| `src/view/fx.js` | Particles, decals, damage numbers |
| `src/menu.js` | Menu decoration: poking Naiwa on the title screen. The menu look itself lives in `src/style.css` |
| `src/laugh.js` | Laugh sound for the 5th-kill laugh; the animation follows its playback position (the sim times the laugh itself) |
| `src/audio.js` | WebAudio-synthesised sound effects |
| `tools/dump-layouts.mjs` | Dumps every preset map's colliders, props and weapon spots; `--check` compares them with `tools/layout-baseline.txt` (run it after touching layout code) |
| `tools/sim-headless.mjs` | Plays 10 minutes of every preset map in plain Node with scripted bots and reports waves, kills, deaths and errors; `--players 2`–`4` plays co-op with bots joining and leaving mid-run (kills per bot, downs, revives, respawns); `--trace` prints the state every game second for diffing two versions (run it after touching `src/sim`) |
| `tools/bot-clients.mjs` | Starts a server and plays it with 2–8 bot clients over real WebSockets (`sim/bot.js` through `NetSim`); reports waves, kills per client, errors and the server's tick time, memory, CPU and bytes per client. `--rtt/--jitter/--loss` for a bad network, `--wave 8` to start runs at a busy wave (`tools/server-tweaks.mjs`), `--pvp` for bots shooting each other |
| `tools/net-feel.mjs` | Online feel without a browser: a server and two lagged clients through `NetSim`, scripted walks, dashes, a belt, a crate and a fight; reports prediction errors and corrections, how smoothly the other player is drawn, shots predicted vs the server's, and lag compensation: targets as the shooter saw them vs as the server tested them, and own bullets ended as the server ended them (0, 80, 150 and 250 ms by default; `--pvp` a duel and a bot fight with the prediction around PvP events, `--rewind off` to compare) |
| `tools/lag.mjs` | Delay, jitter and TCP-like loss for a joined SDK room in Node (as the SDK's debug latency simulator does in the browser) |
| `tools/sim-rules.mjs` | Sets up each co-op rule by hand (downed, revive, bleed-out, respawn, late joiners, targeting, laugh, pickups, scaling) and checks it |
| `tools/extract-sprites.mjs` | Cuts the 2×2 character sheet into transparent PNG frames (`npm run sprites`) |
| `tools/extract-laugh-frames.mjs` | Cuts Naiwa out of every frame of the laughing clip into `laugh-frames/` (see the file header for the ffmpeg step); `--masks` uses BiRefNet alpha masks, `--cropped` takes upscaled crops, `--grade` matches the fur colour to `public/assets/hero_*.png` |
| `tools/build-laugh-sheets.mjs` | Packs `laugh-frames/` into the 15 fps hero-sized sprite sheets in `public/assets/laugh/` |
| `tools/realesrgan-kaggle/` | Kaggle GPU job: Real-ESRGAN 2× (x4plus / animevideov3) of the frames plus BiRefNet masks of the result (`kaggle kernels push -p tools/realesrgan-kaggle`) |
| `tools/birefnet-kaggle/` | Kaggle GPU job that runs BiRefNet on the frames and outputs `masks_general.zip` / `masks_matting.zip` (`kaggle kernels push -p tools/birefnet-kaggle`) |
