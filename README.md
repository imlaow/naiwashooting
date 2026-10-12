# Naiwa Island Showdown

A top-down 2D island shooter built with [PixiJS](https://pixijs.com) v8 and Vite.
The hero is Naiwa, whose sprite frames are cut from `mmexport1791681378822.jpg`.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

Add `?seed=1234` to the URL to generate a different island.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD / arrows | left thumb |
| Aim & shoot | mouse, hold left button | right thumb |
| Dash (i-frames) | Space / Shift | tap left side |
| Reload | R | automatic |
| Switch weapon | 1–4, wheel, Q (last) | — |
| Pause / mute | P or Esc / M | — |

## Gameplay

- You start on the beach by the dock. Waves of rivals land on the shores: red crabs that rush you, pink gunners, and purple shotgun heavies.
- Every 5th wave, **King Naiwa** shows up. He sprays bullets, fires rings of orbs, and summons crabs.
- Weapons are hidden around the island: a shotgun by a village hut, an SMG at the hilltop lookout tower, and a rifle on a remote beach. Enemies and crates also drop weapons, ammo and medkits.
- Shooting a red barrel makes it explode, and nearby barrels go off too.
- Shallow water slows you down. Kill enemies in quick succession to build a combo multiplier.

## Code map

| File | Purpose |
| --- | --- |
| `src/island.js` | Height map, coastline, village/dock/path layout, terrain painting |
| `src/art.js` | All procedural textures (palms, huts, rocks, crabs, guns, FX) |
| `src/skins.js` | Loads hero frames and builds recoloured rival skins |
| `src/world.js` | Scene building: water, vegetation, props, ambient life |
| `src/entities.js` | Player, enemies, weapon stats |
| `src/game.js` | Game loop, camera, bullets, waves, pickups, scoring |
| `src/hud.js` | HUD, minimap, banners, crosshair |
| `src/fx.js` | Particles, decals, damage numbers |
| `src/audio.js` | WebAudio-synthesised sound effects |
| `tools/extract-sprites.mjs` | Cuts the 2×2 character sheet into transparent PNG frames (`npm run sprites`) |
