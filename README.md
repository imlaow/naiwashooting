# 奶蛙枪战 (Naiwa Shootout)

A top-down 2D island shooter built with [PixiJS](https://pixijs.com) v8 and Vite.
The hero is Naiwa, whose sprite frames are cut from `mmexport1791681378822.jpg`.

The world is built from the sprites in `public/assets`, pasted straight into the procedural
textures (`src/art.js`, `src/island.js`): the egg is every egg (trees, rocks, bushes, crates,
the boat, the torches, the tiny eggs in the grass), the bunny gunner's ears are every leaf,
wing and flag, Naiwa himself is the huts and the gunner stands on the egg tower. Only the
terrain (yolk beaches, Naiwa-skin hills, tongue paths, a sea of milk with yolks in it, eyeballs
and teeth on the sand) and the stalks the eggs stand on are drawn by hand. The menus and the lobby are built from the same sprites:
the egg is every main button and holds every number, the bunny gunner is every secondary
button, the loading bar is a row of eggs, the laughing Naiwa leans into the pause screen and
the island previews sit inside eggs (`public/assets/egg_cursor.png` and `laugh_pose.png` are
cut from `egg.png` and the laugh sheet for the cursor and the pause screen).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

The site opens on the **map lobby** (`index.html`): overall records up top, one tab per map
theme, a card per map with a painted preview and that map's best score, best wave and run count
(kept in the browser), and a detail panel whose PLAY button opens the game (`play.html`) on that
map. The island theme has six hand-tuned islands plus a random card that rerolls its seed.
`play.html?map=island/twins` opens a map directly, `play.html?map=island/random&seed=1234` a
random island with that seed, and the old `?seed=1234` link still works.

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

## Code map

| File | Purpose |
| --- | --- |
| `src/maps.js` | Map catalogue: themes, their variants (seed + terrain knobs for islands) and per-map records. A new theme is one more entry here, see the file header |
| `src/lobby.js` | The map lobby page (`index.html`): records, theme tabs, map cards, detail panel |
| `src/main.js` | Game page (`play.html`) boot: reads the map from the URL, loads art, runs the title / pause / game-over screens |
| `src/island.js` | Height map, coastline, village/dock/path layout, terrain painting; `DEFAULT_SHAPE` lists the knobs a map can turn |
| `src/art.js` | All procedural textures (palms, huts, rocks, gulls, guns, FX) |
| `src/skins.js` | Loads hero frames, the egg and bunny-gunner cut-outs (`public/assets/egg.png`, `gunner.png`), builds recoloured rival skins |
| `src/world.js` | Scene building: water, vegetation, props, ambient life |
| `src/entities.js` | Player, enemies, weapon stats |
| `src/game.js` | Game loop, camera, bullets, waves, pickups, scoring |
| `src/hud.js` | HUD, minimap, banners, crosshair |
| `src/laugh.js` | Laugh sound for the 5th-kill laugh; the animation follows its playback position |
| `src/fx.js` | Particles, decals, damage numbers |
| `src/audio.js` | WebAudio-synthesised sound effects |
| `tools/extract-sprites.mjs` | Cuts the 2×2 character sheet into transparent PNG frames (`npm run sprites`) |
| `tools/extract-laugh-frames.mjs` | Cuts Naiwa out of every frame of the laughing clip into `laugh-frames/` (see the file header for the ffmpeg step); `--masks` uses BiRefNet alpha masks, `--cropped` takes upscaled crops, `--grade` matches the fur colour to `public/assets/hero_*.png` |
| `tools/build-laugh-sheets.mjs` | Packs `laugh-frames/` into the 15 fps hero-sized sprite sheets in `public/assets/laugh/` |
| `tools/realesrgan-kaggle/` | Kaggle GPU job: Real-ESRGAN 2× (x4plus / animevideov3) of the frames plus BiRefNet masks of the result (`kaggle kernels push -p tools/realesrgan-kaggle`) |
| `tools/birefnet-kaggle/` | Kaggle GPU job that runs BiRefNet on the frames and outputs `masks_general.zip` / `masks_matting.zip` (`kaggle kernels push -p tools/birefnet-kaggle`) |
