# 奶蛙枪战 (Naiwa Shootout)

A top-down 2D island shooter built with [PixiJS](https://pixijs.com) v8 and Vite.
The hero is Naiwa, whose sprite frames are cut from `mmexport1791681378822.jpg`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

Add `?seed=1234` to the URL to generate a different island.

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
| `src/island.js` | Height map, coastline, village/dock/path layout, terrain painting |
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
