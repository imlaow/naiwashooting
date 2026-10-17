// A scripted player for headless runs (tools/sim-headless.mjs) and the browser's debug bot
// teammates (?debug&bots=N). It reads the sim directly and returns a command for its player.
//
//   const bot = new Bot(sim, player.id, rand);   // rand: () => [0, 1), e.g. mulberry32(seed)
//   sim.step(STEP, { [player.id]: bot.command(STEP) });
//
// It moves, aims at the nearest enemy, shoots, dashes away from eggs, reloads, switches to its
// best gun and walks over pickups. In co-op it goes to a downed teammate and stands by them until
// they are back up, and when it is down itself it crawls towards the nearest teammate.
import { WEAPONS, idleCommand } from './entities.js';

export class Bot {
  constructor(sim, id, rand) {
    this.sim = sim;
    this.id = id;
    this.rand = rand;
    const P = this.player;
    this.stuckT = 0; this.detourT = 0; this.detour = 0;
    this.lastX = P.x; this.lastY = P.y; this.checkT = 1;
    // Co-op: pickups it gave up on, walked at from close by for 2 s without getting it (behind a
    // wall), so a team can't all stand at one and leave the last enemy alone. Off with one player,
    // so its runs stay comparable with traces recorded before co-op.
    this.skip = new Set(); this.pickT = 0;
  }

  get player() { return this.sim.players.get(this.id); }

  wants(p) {
    const P = this.player;
    if (this.skip.has(p.id)) return false;
    if (p.kind === 'health') return P.hp < P.maxHp && P.laughT < 0;
    if (p.kind === 'ammo') return Object.keys(P.arsenal).length > 1;
    return true;
  }

  // The best gun it has ammo for at this range.
  pickWeapon(dist) {
    const P = this.player;
    const has = (k) => P.arsenal[k] && P.arsenal[k].mag + P.arsenal[k].reserve > 0;
    if (dist < 260 && has('shotgun')) return 'shotgun';
    for (const k of ['rifle', 'smg', 'shotgun']) if (has(k)) return k;
    return 'pistol';
  }

  // The nearest teammate that is down (if it is up itself) or up (if it is down), within maxD.
  teammate(down, maxD) {
    const P = this.player;
    let best = null, bd = maxD;
    for (const o of this.sim.players.values()) {
      if (o === P || o.dead || o.down !== down) continue;
      const d = Math.hypot(o.x - P.x, o.y - P.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best && { p: best, d: bd };
  }

  command(dt) {
    const sim = this.sim, P = this.player;
    if (!P || P.dead) return null;
    let target = null, td = Infinity;
    for (const e of sim.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d < td) { td = d; target = e; }
    }
    const seen = target && sim.statics.clearLine(P.x, P.y, target.x, target.y, 6);
    const aim = target ? Math.atan2(target.y - P.y, target.x - P.x) : P.aim;
    if (P.down) {
      const mate = this.teammate(false, Infinity);
      const dx = mate ? mate.p.x - P.x : 0, dy = mate ? mate.p.y - P.y : 0, l = Math.hypot(dx, dy);
      return { ...idleCommand(aim), mx: l > 30 ? dx / l : 0, my: l > 30 ? dy / l : 0 };
    }
    let pick = null, pd = 700;
    for (const p of sim.pickups) {
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if (d < pd && this.wants(p)) { pd = d; pick = p; }
    }
    const mate = sim.players.size > 1 ? this.teammate(true, 900) : null;

    let dx = 0, dy = 0, dash = false;
    if (target && td < 200) {
      // Back off, sideways a little so it doesn't run into a wall in a straight line.
      dx = (P.x - target.x) / td - (target.y - P.y) / td * 0.5;
      dy = (P.y - target.y) / td + (target.x - P.x) / td * 0.5;
      dash = td < 90 && P.dashCd <= 0;
    } else if (mate) {
      if (mate.d > 30) { dx = mate.p.x - P.x; dy = mate.p.y - P.y; }
    } else if (pick) {
      dx = pick.x - P.x; dy = pick.y - P.y;
      this.pickT = pd < 80 && sim.players.size > 1 ? this.pickT + dt : 0;
      if (this.pickT > 2) { this.skip.add(pick.id); this.pickT = 0; }
    } else if (target && (!seen || td > 420)) {
      dx = target.x - P.x; dy = target.y - P.y;
    } else if (target) {
      dx = -(target.y - P.y); dy = target.x - P.x;
    }
    // Detour when it has been trying to move but hasn't got anywhere for a second.
    this.checkT -= dt;
    if (this.checkT <= 0) {
      const moved = Math.hypot(P.x - this.lastX, P.y - this.lastY);
      if ((dx || dy) && moved < 40) { this.detourT = 0.8 + this.rand(); this.detour = this.rand() * Math.PI * 2; }
      this.lastX = P.x; this.lastY = P.y; this.checkT = 1;
    }
    if (this.detourT > 0) { this.detourT -= dt; dx = Math.cos(this.detour); dy = Math.sin(this.detour); }
    const l = Math.hypot(dx, dy);
    if (l > 0) { dx /= l; dy /= l; }

    const slot = P.slot;
    const weapon = this.pickWeapon(target ? td : Infinity);
    return {
      ...idleCommand(aim),
      mx: dx, my: dy,
      fire: !!target && seen && td < 650,
      dash,
      reload: slot.mag === 0 || (!seen && slot.mag < WEAPONS[P.weapon].mag / 2),
      weapon: weapon !== P.weapon ? weapon : null,
    };
  }
}
