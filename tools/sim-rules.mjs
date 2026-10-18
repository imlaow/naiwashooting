// Checks the co-op and PvP rules of src/sim one by one, by setting up each situation by hand (bots
// rarely bleed out, so sim-headless.mjs alone doesn't cover everything). Prints one line per rule
// and exits with code 1 if any fails.
//
//   node tools/sim-rules.mjs
import { makeChoice, buildMap } from '../src/sim/maps.js';
import { Sim, STEP, RESPAWN_SECONDS, SPAWN_PROTECT, PROP_RESPAWN, SPOT_RESPAWN } from '../src/sim/sim.js';
import { REVIVE_SECONDS, BLEED_SECONDS, PVP_LAUGH_SECONDS, LAUGH_SECONDS } from '../src/sim/entities.js';
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
  check('the scoreboard counts it: a down for the downed, a revive for the reviver', A.downs === 1 && B.revives === 1 && A.revives === 0 && B.downs === 0, `downs ${A.downs}/${B.downs}, revives ${A.revives}/${B.revives}`);

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
  const { sim: s3, ps: [D] } = setup(1);
  s3.state = 'fight'; s3.wave = 3;
  s3.removePlayer(D.id);
  const E = s3.addPlayer();
  check('a late joiner into a run everyone left ends it', E.dead && s3.state === 'dead' && types(s3.takeEvents()).includes('over'));
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

// ---------- PvP ----------
const RULES = { mode: 'pvp', killLimit: 25, timeLimit: 600 };
function pvp(n, rules = RULES) {
  const sim = new Sim(world, layout, rules);
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(sim.addPlayer());
  for (const P of ps) P.invuln = 0;
  sim.takeEvents();
  return { sim, ps };
}
// Open, dry ground with a clear shot `gap` px to the right.
function openPair(sim, gap) {
  for (let i = 0; i < 20000; i++) {
    const x = 100 + Math.random() * 3000, y = 100 + Math.random() * 3000;
    if (sim.openSpot(x, y) && sim.openSpot(x + gap, y) && !world.isWading(x, y) && !world.isWading(x + gap, y) && sim.statics.clearLine(x, y, x + gap, y, 30)) return { x, y };
  }
  throw new Error('no open ground on the map');
}
// A stands on open ground with B `gap` px to its right, neither protected.
function face(sim, A, B, gap = 100) {
  const { x, y } = openPair(sim, gap);
  A.x = x; A.y = y; B.x = x + gap; B.y = y;
  A.vx = A.vy = B.vx = B.vy = 0; A.invuln = B.invuln = 0;
}
// A pistol bullet from just in front of A, towards B (to the right).
const shoot = (sim, A, dmg = 20) => sim.fireBullet({ x: A.x + 24, y: A.y, ang: 0, speed: 980, dmg, life: 0.5, team: 'player', owner: A.id, knock: 140 });
const kill = (sim, A, B) => { B.invuln = 0; B.hp = 1; shoot(sim, A); return run(sim, 0.2); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
{
  const { sim } = pvp(2);
  const ev = types(run(sim, 20));
  check('pvp: no waves and no enemies; the round clock runs', sim.wave === 0 && !sim.enemies.length && sim.state === 'pvp' && !ev.includes('wave') && Math.abs(sim.roundT - 580) < 0.01, `state ${sim.state}, ${sim.roundT.toFixed(2)} s left`);
}
{
  const { sim, ps: [A, B] } = pvp(2);
  face(sim, A, B);
  shoot(sim, A); run(sim, STEP); shoot(sim, A);
  run(sim, 0.3);
  check('pvp: a player\'s bullets hit other players, with no hit i-frames (two in a row both count)', B.hp === 60 && A.hp === 100, `B ${B.hp}`);
  sim.fireBullet({ x: A.x - 30, y: A.y, ang: 0, speed: 980, dmg: 20, life: 0.5, team: 'player', owner: A.id });
  run(sim, 0.2);
  check('… not the player who fired them', A.hp === 100);
  face(sim, A, B);
  B.dashT = 0.17; B.dashDir = { x: 0, y: 1 }; B.invuln = 0;
  const hp = B.hp;
  shoot(sim, A); run(sim, 0.05);
  check('… and a dashing player dodges them', B.hp === hp);
}
{
  const { sim, ps: [A, B] } = pvp(2);
  face(sim, A, B);
  B.giveWeapon('smg');
  const ev = kill(sim, A, B);
  const died = ev.find((e) => e.type === 'died');
  check('pvp: HP 0 is death, not down; the killer gets the kill, the victim a death', B.dead && !B.down && died?.by === A.id && A.kills === 1 && B.downs === 1 && sim.kills === 1 && B.respawnT > RESPAWN_SECONDS - 0.3, types(ev).join(' '));
  run(sim, RESPAWN_SECONDS - 0.4);
  const still = B.dead;
  const ev2 = run(sim, 0.3).filter((e) => e.type === 'respawned');
  check('pvp: back after 3 s with a pistol only, full HP and 1.5 s of protection', still && !B.dead && ev2[0]?.id === B.id && Object.keys(B.arsenal).join() === 'pistol' && B.hp === 100 && B.invuln > SPAWN_PROTECT - 0.2, `invuln ${B.invuln.toFixed(2)}, ${Math.round(dist(A, B))} px from the killer`);
  // Bring A over to B's new spot: protected, then not.
  const bx = B.x, by = B.y;
  A.x = bx - 100; A.y = by;
  const clear = sim.statics.clearLine(A.x, A.y, bx, by, 30) && world.isWalkable(A.x, A.y);
  if (clear) {
    shoot(sim, A); run(sim, 0.2);
    const during = B.hp;
    run(sim, SPAWN_PROTECT);
    A.x = B.x - 100; A.y = B.y; shoot(sim, A); run(sim, 0.2);
    check('pvp: spawn protection: no damage for 1.5 s, then hits count again', during === 100 && B.hp === 80, `${during} → ${B.hp}`);
  } else {
    face(sim, A, B); B.invuln = SPAWN_PROTECT;
    shoot(sim, A); run(sim, 0.2);
    const during = B.hp;
    run(sim, SPAWN_PROTECT); face(sim, A, B); B.invuln = Math.max(0, B.invuln); shoot(sim, A); run(sim, 0.2);
    check('pvp: spawn protection: no damage for 1.5 s, then hits count again', during === 100 && B.hp === 80, `${during} → ${B.hp}`);
  }
}
{
  const { sim, ps: [A, B, C] } = pvp(3);
  A.x = 700; A.y = 700; B.x = 2400; B.y = 2400;
  for (const P of [A, B]) if (!world.isWalkable(P.x, P.y)) { const o = openPair(sim, 0); P.x = o.x; P.y = o.y; }
  const near = (p) => Math.min(dist(p, A), dist(p, B));
  // Random open ground, for comparison.
  let worst = Infinity, mean = 0, base = 0, n = 0;
  for (let i = 0; i < 100; i++) {
    const p = sim.pvpSpawn();
    worst = Math.min(worst, near(p)); mean += near(p) / 100;
  }
  for (let i = 0; i < 4000 && n < 100; i++) {
    const p = { x: 40 + Math.random() * 3120, y: 40 + Math.random() * 3120 };
    if (sim.openSpot(p.x, p.y) && !world.isWading(p.x, p.y)) { base += near(p); n++; }
  }
  base /= n;
  // B dead: spawns only keep away from A, so they come nearer to where B lies.
  C.dead = true; C.respawnT = 99;
  let alive = 0, dead = 0;
  for (let i = 0; i < 100; i++) alive += dist(sim.pvpSpawn(), B) / 100;
  B.dead = true; B.respawnT = 99;
  for (let i = 0; i < 100; i++) dead += dist(sim.pvpSpawn(), B) / 100;
  check('pvp: spawns far from every living player', worst >= 500 && mean > base * 1.3, `closest ${worst.toFixed(0)} px, mean ${mean.toFixed(0)} px against ${base.toFixed(0)} for any open spot`);
  check('… the dead don\'t count', dead < alive * 0.9, `mean distance to a player ${alive.toFixed(0)} px alive, ${dead.toFixed(0)} px dead`);
}
{
  const { sim, ps: [A, B] } = pvp(2);
  face(sim, A, B);
  A.kills = 4;
  const ev = types(kill(sim, A, B));
  check('pvp: the 5th kill laughs', A.laughT >= 0 && ev.includes('laugh'), ev.join(' '));
  B.dead = false; B.hp = 100; B.respawnT = 0; face(sim, B, A);
  shoot(sim, B); run(sim, 0.2);
  sim.explode(A.x, A.y, 130, 80, B.id);
  const mine = () => sim.bullets.filter((b) => b.owner === A.id).length;
  run(sim, 0.5, { [A.id]: { mx: 0, my: 0, aim: 0, fire: true } });
  check('pvp laugh: untouchable (bullets and explosions) and unable to shoot', A.hp === 100 && mine() === 0 && sim.events.length === 0, `hp ${A.hp}, ${mine()} bullets`);
  const end = run(sim, PVP_LAUGH_SECONDS - 0.5 + 0.1).find((e) => e.type === 'laughEnd');
  check('pvp laugh: lasts 4 s', end?.id === A.id && A.laughT < 0);
  run(sim, 0.3, { [A.id]: { mx: 0, my: 0, aim: 0, fire: true } });
  check('… then the gun works again', mine() > 0);
  const { sim: co, ps: [D] } = setup(1);
  D.laughT = 0;
  run(co, PVP_LAUGH_SECONDS + 0.5, { [D.id]: { mx: 0, my: 0, aim: 0, fire: true } });
  check('co-op laugh unchanged: 12 s, and he can shoot', D.laughT > PVP_LAUGH_SECONDS && LAUGH_SECONDS === 12 && D.slot.mag < 12);
}
{
  const { sim, ps: [A, B, C] } = pvp(3);
  const barrels = sim.props.filter((p) => p.kind === 'barrel');
  const [b1, b2] = barrels;
  A.x = b1.x + 400; A.y = b1.y; B.x = b1.x + 40; B.y = b1.y; C.x = b1.x - 40; C.y = b1.y;
  for (const P of [A, B, C]) P.invuln = 0;
  B.hp = 5; C.hp = 100;
  sim.damageProp(b1, 999, A.id);
  let ev = sim.takeEvents();
  const died = ev.find((e) => e.type === 'died');
  check('pvp: explosions hurt everyone near; the barrel\'s kill goes to whoever set it off', B.dead && died?.by === A.id && A.kills === 1 && C.hp < 100 && A.hp === 100, `C ${C.hp.toFixed(0)}`);
  A.x = b2.x + 30; A.y = b2.y; A.hp = 5; A.invuln = 0;
  sim.damageProp(b2, 999, A.id);
  ev = sim.takeEvents();
  check('… their own barrel kills them with no kill for anyone', A.dead && ev.find((e) => e.type === 'died')?.by === null && A.kills === 1 && A.downs === 1);
  // Everyone dead at once is not the end of a round.
  C.hp = 1; C.invuln = 0;
  sim.explode(C.x, C.y, 130, 80, null);
  ev = types(sim.takeEvents());
  check('pvp: everyone dead at once doesn\'t end the round; they all come back', [A, B, C].every((P) => P.dead) && sim.state === 'pvp' && !ev.includes('over'));
  run(sim, RESPAWN_SECONDS + 0.1);
  check('… (3 s later)', [A, B, C].every((P) => !P.dead));
}
{
  const { sim, ps: [A] } = pvp(1);
  const crate = sim.props.find((p) => p.kind === 'crate'), id = crate.id;
  A.x = crate.x + 500; A.y = crate.y;
  sim.damageProp(crate, 999, A.id);
  run(sim, PROP_RESPAWN - 0.5);
  const gone = !sim.props.some((p) => p.id === id);
  A.x = crate.x; A.y = crate.y - 12;
  run(sim, 1);
  const blocked = !sim.props.some((p) => p.id === id);
  A.x = crate.x + 500;
  run(sim, 1.1);
  const back = sim.props.find((p) => p.id === id);
  check('pvp: crates and barrels come back 30 s after breaking (not onto a player), same id, full HP', gone && blocked && back?.hp === 45 && back.x === crate.x && sim.statics.pointHit(crate.x, crate.y - 12)?.owner === back);
  const { sim: co, ps: [D] } = setup(1);
  const c2 = co.props.find((p) => p.kind === 'crate');
  co.damageProp(c2, 999, D.id);
  run(co, PROP_RESPAWN + 2);
  check('… not in co-op', !co.props.some((p) => p.id === c2.id));
}
{
  const { sim, ps: [A] } = pvp(1);
  const spot = sim.pickups.find((p) => p.spot);
  A.x = spot.x; A.y = spot.y;
  run(sim, 0.6);
  const taken = !sim.pickups.some((p) => p.spot && p.x === spot.x && p.y === spot.y);
  A.x += 600;
  run(sim, SPOT_RESPAWN - 1);
  const early = sim.pickups.some((p) => p.x === spot.x && p.y === spot.y);
  run(sim, 1.1);
  const back = sim.pickups.find((p) => p.spot && p.x === spot.x && p.y === spot.y);
  check('pvp: weapon spots come back 20 s after being taken', taken && !early && back?.weapon === spot.weapon && A.arsenal[spot.weapon]);
  const { sim: co, ps: [D] } = setup(1);
  const s2 = co.pickups.find((p) => p.spot);
  D.x = s2.x; D.y = s2.y;
  run(co, 0.6); D.x += 600; run(co, SPOT_RESPAWN + 1);
  check('… not in co-op', !co.pickups.some((p) => p.x === s2.x && p.y === s2.y));
}
{
  const { sim, ps: [A, B] } = pvp(2, { ...RULES, killLimit: 2 });
  face(sim, A, B);
  kill(sim, A, B);
  run(sim, RESPAWN_SECONDS);
  face(sim, A, B);
  const ev = kill(sim, A, B);
  const over = ev.find((e) => e.type === 'over');
  check('pvp: the round ends at killLimit, won by the player who got there', sim.state === 'over' && over?.winner === A.id && over.why === 'kills' && sim.winner === A.id);
  B.dead = false; B.hp = 100; face(sim, A, B);
  const shots = run(sim, 0.3, { [A.id]: { mx: 0, my: 0, aim: 0, fire: true } }).filter((e) => e.type === 'shot').length;
  check('… after it, guns still fire but nobody is hurt', B.hp === 100 && shots > 0, `${shots} shots`);
  B.hp = 0; B.dead = true; B.respawnT = 1;
  run(sim, 4);
  const C = sim.addPlayer();
  run(sim, 4);
  check('… and nobody comes back in (the dead and anyone joining wait for the next map)', B.dead && C.dead && sim.state === 'over');
}
{
  const round = (kd) => {
    const { sim, ps } = pvp(kd.length, { ...RULES, timeLimit: 30 });
    ps.forEach((P, i) => { P.kills = kd[i][0]; P.downs = kd[i][1]; });
    const ev = run(sim, 30.1).filter((e) => e.type === 'over');
    return { sim, ps, ev };
  };
  const r1 = round([[3, 1], [2, 0]]), r2 = round([[2, 1], [2, 0]]), r3 = round([[2, 1], [2, 1]]);
  check('pvp: the round ends at timeLimit; most kills wins, then fewest deaths, level is a draw',
    r1.ev.length === 1 && r1.ev[0].why === 'time' && r1.ev[0].winner === r1.ps[0].id && r2.ev[0]?.winner === r2.ps[1].id && r3.ev[0]?.winner === null && r3.sim.state === 'over');
}
{
  const { sim, ps: [A, B] } = pvp(2);
  run(sim, 5);
  sim.takeEvents();
  const C = sim.addPlayer();
  const ev = sim.takeEvents().find((e) => e.type === 'respawned');
  check('pvp: a late joiner enters at once, protected, away from the others', !C.dead && ev?.joined && C.invuln === SPAWN_PROTECT && Math.min(dist(C, A), dist(C, B)) > 300, `${Math.round(Math.min(dist(C, A), dist(C, B)))} px away`);
  face(sim, A, B);
  B.hp = 10;
  shoot(sim, A);
  sim.removePlayer(A.id);
  const died = run(sim, 0.2).find((e) => e.type === 'died');
  check('pvp: a player who left still hits with the bullets they fired; nobody gets that kill', B.dead && died?.by === null && sim.kills === 0);
}

console.log(failed ? `\n${failed} rule(s) failed` : '\nall rules hold');
if (failed) process.exitCode = 1;
