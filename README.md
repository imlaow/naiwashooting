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
| `src/sim/sim.js` | The game itself, without Pixi, DOM, audio or HUD: colliders, props, bullets, pickups, waves, scoring. `step(STEP, cmd)` at a fixed 1/60 s; what happened comes out as events (list at the top of the file) |
| `src/sim/entities.js` | Player and enemies (position, HP, timers, AI), weapon and enemy stats, gun sizes, `LAUGH_SECONDS`; the player takes a command per step |
| `src/sim/physics.js` | Static colliders in a spatial hash: push-out, point and line-of-sight tests |
| `src/dashboard.js` | The map dashboard: a section per theme, preview cards, random-seed card |
| `src/island.js` | Height map, coastline, village/dock/path layout, terrain painting; `DEFAULT_SHAPE` lists the knobs a map can turn |
| `src/factory.js` | The factory map's layout (hall, belts, canal, tank farm, buildings, yard), its floor painting and minimap; same terrain interface as `Island` plus belt `drift` |
| `src/factoryArt.js` | Painted factory textures (silos, water tower, chimney, machines, containers, lorry, buildings), built the first time a factory loads |
| `src/art.js` | All procedural textures (palms, huts, rocks, gulls, guns, FX); guns are painted at the sim's `GUN_SIZES` |
| `src/skins.js` | Loads hero frames, the egg and bunny-gunner cut-outs (`public/assets/egg.png`, `gunner.png`), builds recoloured rival skins |
| `src/view/game.js` | The game in the browser: runs the sim's steps for each frame, turns input into commands (touch auto-aim included) and events into particles, sounds, banners and shake; sprites for props, pickups and bullets; camera, pause, title-screen demo |
| `src/view/entities.js` | `PlayerView` / `EnemyView`: sprites, walk cycle, recoil, hit flash, footsteps, dash ghosts, crown, health bars |
| `src/view/world.js` | Draws the island from its layout: water, vegetation, ambient life |
| `src/view/factoryScene.js` | Draws the factory from its layout: perimeter wall, sprites, moving belts and cartons, smoke, steam, lamps |
| `src/view/hud.js` | HUD, minimap, banners, crosshair, touch sticks |
| `src/view/fx.js` | Particles, decals, damage numbers |
| `src/menu.js` | Menu decoration: poking Naiwa on the title screen. The menu look itself lives in `src/style.css` |
| `src/laugh.js` | Laugh sound for the 5th-kill laugh; the animation follows its playback position (the sim times the laugh itself) |
| `src/audio.js` | WebAudio-synthesised sound effects |
| `tools/dump-layouts.mjs` | Dumps every preset map's colliders, props and weapon spots; `--check` compares them with `tools/layout-baseline.txt` (run it after touching layout code) |
| `tools/sim-headless.mjs` | Plays 10 minutes of every preset map in plain Node with a scripted bot and reports waves, kills, deaths and errors; `--trace` prints the state every game second for diffing two versions (run it after touching `src/sim`) |
| `tools/extract-sprites.mjs` | Cuts the 2×2 character sheet into transparent PNG frames (`npm run sprites`) |
| `tools/extract-laugh-frames.mjs` | Cuts Naiwa out of every frame of the laughing clip into `laugh-frames/` (see the file header for the ffmpeg step); `--masks` uses BiRefNet alpha masks, `--cropped` takes upscaled crops, `--grade` matches the fur colour to `public/assets/hero_*.png` |
| `tools/build-laugh-sheets.mjs` | Packs `laugh-frames/` into the 15 fps hero-sized sprite sheets in `public/assets/laugh/` |
| `tools/realesrgan-kaggle/` | Kaggle GPU job: Real-ESRGAN 2× (x4plus / animevideov3) of the frames plus BiRefNet masks of the result (`kaggle kernels push -p tools/realesrgan-kaggle`) |
| `tools/birefnet-kaggle/` | Kaggle GPU job that runs BiRefNet on the frames and outputs `masks_general.zip` / `masks_matting.zip` (`kaggle kernels push -p tools/birefnet-kaggle`) |
