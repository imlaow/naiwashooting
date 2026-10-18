// The room state every client gets patched (@colyseus/schema): what the browser draws or shows in
// the HUD, plus what a player's own browser needs to predict its movement and gun (velocity,
// dash direction, gun cooldown, previous gun). Positions and timers are quantized to 1–2 bytes;
// timers that only count down are sent clamped at 0 so they stop changing. Drawn-only values the
// client can work out (an enemy's walk phase, a pickup's bob) stay off. Map layout never goes
// over the wire: the client rebuilds it from `map` ({ theme, id, seed }), and props are keyed by
// the id the sim gave them (1–n in layout order).
//
// Change anything here and bump PROTOCOL in src/sim/protocol.js.
import { schema, t } from '@colyseus/schema';

const pos = () => t.quantized({ min: -256, max: 3456 }); // the map is 3200 px; 0.06 px steps
const timer = (max, bits = 8) => t.quantized({ min: 0, max, bits });
const vel = () => t.quantized({ min: -1000, max: 1000, bits: 16 }); // 0.03 px/s steps

export const MapChoice = schema({
  theme: t.string(),
  id: t.string(),
  seed: t.uint32(),
}, 'MapChoice');

export const Slot = schema({
  mag: t.uint8(),
  reserve: t.int16(), // -1: unlimited (the pistol)
}, 'Slot');

export const PlayerState = schema({
  id: t.uint32(), // the sim's player id, which events refer to
  name: t.string(),
  colour: t.uint8(), // by join order: the skin, minimap dot, name tag and scoreboard row
  ping: t.uint16(), // the round trip the player's browser measured, ms
  away: t.boolean(), // lost the connection; the seat is held while it reconnects
  x: pos(), y: pos(),
  aim: t.angle(),
  hp: t.float32(),
  weapon: t.string(),
  lastWeapon: t.string(),
  arsenal: t.map(Slot),
  reloading: timer(2, 16),
  cooldown: timer(1, 16), // until the gun can fire again
  moving: t.boolean(),
  // Velocity, for the walk lean and so the owner's prediction can replay from it.
  vx: vel(), vy: vel(),
  dashT: timer(0.2),
  dashA: t.angle(), // the dash's direction
  dashCd: timer(1, 16),
  invuln: timer(2),
  laughT: t.quantized({ min: -1, max: 14 }), // a range of 15 keeps 0 (just started) exact
  down: t.boolean(),
  bleedT: timer(30, 16),
  reviveT: timer(3),
  dead: t.boolean(),
  kills: t.uint16(),
  combo: t.uint16(),
  comboT: timer(3),
  revives: t.uint16(),
  downs: t.uint16(),
}, 'PlayerState');

export const EnemyState = schema({
  type: t.string(),
  x: pos(), y: pos(),
  aim: t.angle(),
  hp: t.float32(),
  maxHp: t.uint16(),
  moving: t.boolean(),
  vx: t.quantized({ min: -1000, max: 1000, bits: 8 }),
  spawnT: timer(0.7),
}, 'EnemyState');

export const PickupState = schema({
  kind: t.string(),
  weapon: t.string(),
  x: pos(), y: pos(),
  fading: t.boolean(), // a dropped gun's last 4 s
}, 'PickupState');

export const PropState = schema({
  hp: t.uint8(),
}, 'PropState');

export const NaiwaState = schema({
  // The room: 'lobby' (waiting; phaseT counts down to the run once someone is here), 'run',
  // 'results' (phaseT counts down to the next map). `run` goes up with every new sim.
  phase: t.string().default('lobby'),
  phaseT: timer(30, 16),
  run: t.uint16().default(0),
  mode: t.string().default('coop'),
  map: MapChoice,
  // The sim: its state ('intro', 'fight', 'break', 'dead') and timer, team score and kills,
  // enemies still queued for the wave, King Naiwa's enemy id (0: none).
  state: t.string().default('intro'),
  stateT: timer(10, 16),
  wave: t.uint16(),
  score: t.uint32(),
  kills: t.uint32(),
  queued: t.uint16(),
  boss: t.uint32(),
  players: t.map(PlayerState), // by sessionId
  enemies: t.map(EnemyState), // by enemy id
  pickups: t.map(PickupState), // by pickup id
  props: t.map(PropState), // living crates and barrels, by prop id
}, 'NaiwaState');

// One command from a client: the sim's command (Player.update in src/sim/entities.js) with
// the gun as a number (protocol.js weaponCode) and the dash direction as two fields. The
// wire types already keep every number in range; NaiwaRoom's sanitizer does the rest.
export const Command = schema({
  mx: t.quantized({ min: -1, max: 1, bits: 8 }),
  my: t.quantized({ min: -1, max: 1, bits: 8 }),
  aim: t.angle(),
  fire: t.boolean(),
  dash: t.boolean(),
  dashX: t.quantized({ min: -1, max: 1, bits: 8 }),
  dashY: t.quantized({ min: -1, max: 1, bits: 8 }),
  reload: t.boolean(),
  weapon: t.uint8(),
  cycle: t.int8(),
  last: t.boolean(),
}, 'Command');
