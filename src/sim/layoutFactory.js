// The factory's layout, in the same shape as islandLayout. Factory.plan() (factory.js) already
// places everything with its own seeded RNG; this adds the perimeter wall and gathers the
// colliders in the order they go into the StaticWorld. FactoryEnvironment draws what it lists.
import { WALL0, WALL1, WALL_T } from '../factory.js';

export function factoryLayout(fac) {
  const len = WALL1 - WALL0;
  const colliders = [
    { kind: 'rect', x: WALL0, y: WALL0, w: len, h: WALL_T },
    { kind: 'rect', x: WALL0, y: WALL1 - WALL_T, w: len, h: WALL_T },
    { kind: 'rect', x: WALL0, y: WALL0, w: WALL_T, h: len },
    { kind: 'rect', x: WALL1 - WALL_T, y: WALL0, w: WALL_T, h: len },
  ];
  for (const o of fac.objects) colliders.push({ ...o.foot });
  return {
    colliders,
    objects: fac.objects,
    props: fac.props.map(([kind, x, y]) => ({ kind, x, y })),
    weaponSpots: fac.weaponSpots,
  };
}
