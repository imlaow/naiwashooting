// Checks the co-op rules of src/sim one by one, by setting up each situation by hand (bots rarely
// bleed out, so sim-headless.mjs alone doesn't cover everything). Prints one line per rule and
// exits with code 1 if any fails.
//
//   node tools/sim-rules.mjs
import { makeChoice, buildMap } from '../src/sim/maps.js';
import { Sim, STEP } from '../src/sim/sim.js';
import { REVIVE_SECONDS, BLEED_SECONDS } from '../src/sim/entities.js';
import { mulberry32 } from '../src/noise.js';

Math.random = mulberry32(5);
const { world, layout } = buildMap(makeChoice('factory', 'dairy'));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed++;
};

// A sim with n players and nothing else going on: no waves unless a check starts one.
function setup(n) {
  const sim = new Sim(world, layout);
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(sim.addPlayer());
  sim.state = 'hold';
  sim.takeEvents();
  return { sim, ps };
}
const run = (sim, sec, cmds = {}) => {
  const ev = [];
  for (let i = 0; i < Math.round(sec / STEP); i++) { sim.step(STEP, cmds); ev.push(...sim.takeEvents()); }
  return ev;
};
const types = (ev) => ev.map((e) => e.type);
const knockOut = (P) => { P.invuln = 0; P.laughT = -1; P.hurt(500, P.x + 10, P.y); };
// Ends the current wave right away: the next updateWaves sees an empty fight.
const clearWave = (sim) => { sim.state = 'fight'; sim.queue = []; for (const e of sim.enemies) e.dead = true; sim.enemies = []; };

{
  const { sim, ps: [A] } = setup(1);
  knockOut(A);
  const ev = types(sim.takeEvents());
  check('alone, HP 0 is death and the run is over', A.dead && !A.down && sim.state === 'dead' && ev.includes('died') && ev.includes('over'), ev.join(' '));
}
{
  const { sim, ps: [A, B] } = setup(2);
  knockOut(A);
  let ev = types(sim.takeEvents());
  check('co-op, HP 0 is downed, the run goes on', A.down && !A.dead && sim.state === 'hold' && ev.includes('downed') && !ev.includes('over'), ev.join(' '));
  const x0 = A.x;
  run(sim, 1, { [A.id]: { mx: 1, my: 0, aim: 0, fire: true } });
  check('downed crawls at 30 % speed and can\'t shoot', Math.abs(A.x - x0) < 265 * 0.3 * 1.05 && Math.abs(A.x - x0) > 30 && sim.bullets.length === 0, `moved ${(A.x - x0).toFixed(1)} px in 1 s`);
  B.x = A.x + 40; B.y = A.y;
  const evs = run(sim, REVIVE_SECONDS + 0.1);
  const rev = evs.find((e) => e.type === 'revived');
  check('a teammate within 60 px for 3 s revives with 30 HP and 1 s invulnerability', !A.down && A.hp === 30 && A.invuln > 0.8 && rev?.by === B.id, `hp ${A.hp}, invuln ${A.invuln.toFixed(2)}`);

  A.invuln = 0; knockOut(A); sim.takeEvents();
  run(sim, 1.5);
  const before = A.reviveT;
  B.invuln = 0; B.hurt(5, B.x + 10, B.y);
  check('the reviver taking damage interrupts the revive', before > 1.4 && A.reviveT === 0, `progress ${before.toFixed(2)} → ${A.reviveT}`);

  B.x = A.x + 400;
  ev = types(run(sim, BLEED_SECONDS + 0.5));
  check('downed with nobody near bleeds out after 30 s and is dead', A.dead && !A.down && ev.includes('died') && !ev.includes('over'), ev.join(' '));

  B.arsenal.smg = { mag: 36, reserve: 72 };
  A.weapon = 'smg'; clearWave(sim);
  ev = run(sim, STEP);
  const resp = ev.find((e) => e.type === 'respawned');
  check('the dead respawn at the dock with a pistol at the wave break', resp?.id === A.id && !A.dead && A.hp === A.maxHp && Object.keys(A.arsenal).join() === 'pistol' && Math.hypot(A.x - world.spawn.x, A.y - world.spawn.y) < 60, types(ev).join(' '));

  sim.state = 'hold'; A.invuln = B.invuln = 0;
  knockOut(A); knockOut(B);
  ev = types(sim.takeEvents());
  check('every player down: the run is over', sim.state === 'dead' && ev.includes('over'), ev.join(' '));
}
{
  const { sim, ps: [A, B] } = setup(2);
  sim.state = 'fight'; sim.wave = 3;
  const C = sim.addPlayer();
  check('a late joiner in wave 2+ waits (dead) for the wave break', C.dead && sim.players.size === 3);
  clearWave(sim);
  const ev = run(sim, STEP);
  check('… and enters at the dock then', !C.dead && ev.some((e) => e.type === 'respawned' && e.id === C.id && e.joined));
  const { sim: s2 } = setup(1);
  s2.state = 'fight'; s2.wave = 1;
  check('a joiner in wave 1 enters right away', !s2.addPlayer().dead);
  sim.removePlayer(B.id);
  check('removePlayer takes the player out', !sim.players.has(B.id) && sim.players.size === 2);
}
{
  const { sim, ps: [A, B] } = setup(2);
  B.x = A.x + 300; B.y = A.y;
  const e = sim.spawnEnemy('gunner', A.x + 150, A.y + 40);
  e.spawnT = 0;
  A.laughT = 0;
  run(sim, 0.5);
  check('enemies go for the teammate who isn\'t laughing', e.target === B);
  A.laughT = -1; B.invuln = 0; knockOut(B); sim.takeEvents();
  run(sim, 0.5);
  check('… and for the one who is up, not the downed one', e.target === A);
  A.laughT = 0;
  const shots = sim.bullets.length;
  run(sim, 1);
  check('with everyone laughing or down they mill around and hold fire', e.aim === e.wanderA && sim.bullets.length <= shots);
}
{
  const { sim, ps: [A, B] } = setup(2);
  B.x = A.x + 300;
  for (let i = 0; i < 5; i++) {
    const e = sim.spawnEnemy('egg', A.x + 600, A.y);
    e.hit(999, 0, 0, A.id);
  }
  check('each player laughs on their own 5th kill', A.kills === 5 && B.kills === 0 && A.laughT >= 0 && B.laughT < 0 && sim.kills === 5);
  const e = sim.spawnEnemy('egg', B.x + 600, B.y);
  e.hit(999, 0, 0, B.id);
  check('kills, combo and score: per player and for the team', B.kills === 1 && B.combo === 1 && A.combo === 5 && sim.kills === 6 && sim.score > 0);
}
{
  const { sim, ps: [A, B] } = setup(2);
  B.x = A.x + 20; A.hp = 50; B.hp = 50;
  sim.spawnPickup('health', A.x + 10, A.y);
  const ev = run(sim, 0.5).filter((e) => e.type === 'pickup');
  check('a pickup goes to the first player who touches it', ev.length === 1 && ev[0].id === A.id && A.hp > 50 && B.hp === 50);
  sim.fireBullet({ x: A.x, y: A.y, ang: 0, speed: 900, dmg: 50, life: 0.5, team: 'player', owner: A.id });
  B.invuln = 0;
  run(sim, 0.3);
  check('no friendly fire', B.hp === 50);
  B.arsenal.smg = { mag: 1, reserve: 0 }; B.arsenal.shotgun = { mag: 1, reserve: 0 };
  sim.pickups = [];
  for (let i = 0; i < 20; i++) sim.dropWeapon(0, 0, B);
  check('dropWeapon picks a gun the player lacks', sim.pickups.every((p) => p.weapon === 'rifle'));
}
{
  const { sim, ps } = setup(3);
  ps[1].x += 900; ps[2].y -= 700;
  for (const P of ps) if (!world.isWalkable(P.x, P.y)) { P.x = world.spawn.x; P.y = world.spawn.y; }
  let worst = Infinity;
  for (let i = 0; i < 200; i++) {
    const p = sim.spawnPoint('gunner');
    for (const P of ps) worst = Math.min(worst, Math.hypot(p.x - P.x, p.y - P.y));
  }
  check('spawns keep away from every player', worst >= 300, `closest ${worst.toFixed(0)} px`);
}
{
  const counts = (n) => {
    const { sim } = setup(n);
    sim.startWave(5);
    return { q: sim.queue.length, max: sim.maxAlive };
  };
  const one = counts(1), three = counts(3);
  const { sim } = setup(3);
  const boss = sim.spawnEnemy('boss', 0, 0);
  const { sim: s1 } = setup(1);
  const boss1 = s1.spawnEnemy('boss', 0, 0);
  check('co-op scaling: enemies × 1.5 per extra player, maxAlive +4, boss HP × 1.6', three.q - 1 === Math.round((one.q - 1) * 2) && three.max === one.max + 8 && boss.maxHp === Math.round(boss1.maxHp * 2.2),
    `queue ${one.q} → ${three.q}, maxAlive ${one.max} → ${three.max}, boss ${boss1.maxHp} → ${boss.maxHp}`);
}

console.log(failed ? `\n${failed} rule(s) failed` : '\nall rules hold');
if (failed) process.exitCode = 1;
