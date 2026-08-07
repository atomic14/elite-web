// Where the sky puts a ship when it appears.
//
// population.ts decides WHAT a system holds (test/world.test.ts) and
// spawning.ts decides where it goes. The second half had no test at all: every
// distance was a literal in one file, so a transposed or re-inlined one would
// have moved traders into the slot or the reception onto the witchpoint with
// nothing going red.
//
// Every check here reads the constant from `src/constants/` and measures what
// the REAL spawner did with it, over enough seeds that the edges of each band
// are actually reached. A probe written at the constant would move with the
// constant and pass on any code.

import * as THREE from 'three';
import { World } from '../src/game/world.ts';
import { seedWorld } from '../src/game/rng.ts';
import { launchStationDefence, spawnPopulation } from '../src/game/spawning.ts';
import { isHostileToPlayer, type NpcShip } from '../src/game/npc.ts';
import { slotNormal } from '../src/world/slot.ts';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import {
  ASTEROID_SCATTER, CORRIDOR_SPAN, CORRIDOR_START, HERMIT_SCATTER, HUNTER_SCATTER,
  PIRATE_SCATTER, POLICE_SCATTER, STATION_DEFENCE_JITTER, STATION_DEFENCE_MIN,
  STATION_DEFENCE_SPAN, STATION_DEFENCE_STACK, STATION_DEFENCE_STANDOFF, TRADER_SCATTER,
} from '../src/constants/spawn-placement.ts';
import { BANISHED } from '../src/constants/witchspace.ts';
import { PLAYER_INTEREST_RANGE } from '../src/constants/player-interest.ts';
import { MASS_LOCK_STATION } from '../src/constants/torus.ts';
import { SUN_HEAT_START } from '../src/constants/sun.ts';
import { g1 } from './fixtures.ts';
import { check, eq } from './harness.ts';

// --- a system's own traffic --------------------------------------------------

console.log('\nwhere a system puts its traffic');
{
  const PLAN = {
    traders: 4, police: 2, asteroids: 4, pirates: 6, hunter: true, hermit: true,
    generationShip: false,
    threat: { count: 6, tier: 1, organised: true, appeal: 0.5, fame: 0, challenged: false },
  } as Parameters<typeof spawnPopulation>[1];
  /** `scatter()` puts a ship between half and one and a half of the nominal. */
  const NEAR = 0.5, FAR = 1.5;
  /** a long route, so the reception's own scatter is a small share of it */
  const ROUTE = 400_000;

  const band: Record<string, { lo: number; hi: number }> = {};
  const along: Record<string, { lo: number; hi: number }> = {};
  const off: Record<string, number> = {};
  const sys = generateGalaxy(1)[7];
  const route = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const foot = new THREE.Vector3();
  for (let s = 0; s < 40; s++) {
    seedWorld(90_600 + s);
    const world = new World();
    world.build(sys);
    world.clearNpcs();
    const home = world.station.position;
    const player = home.clone().add(new THREE.Vector3(0, 0, ROUTE));
    spawnPopulation(world, PLAN, sys, player, false);
    route.copy(home).sub(player).normalize();
    for (const npc of world.npcs) {
      const d = npc.object.position.distanceTo(home);
      const b = band[npc.role] ?? (band[npc.role] = { lo: Infinity, hi: -Infinity });
      b.lo = Math.min(b.lo, d); b.hi = Math.max(b.hi, d);
      // where on the route the ship sits, and how far off its line
      const f = rel.copy(npc.object.position).sub(player).dot(route) / ROUTE;
      const a = along[npc.role] ?? (along[npc.role] = { lo: Infinity, hi: -Infinity });
      a.lo = Math.min(a.lo, f); a.hi = Math.max(a.hi, f);
      const perp = foot.copy(player).addScaledVector(route, f * ROUTE)
        .distanceTo(npc.object.position);
      off[npc.role] = Math.max(off[npc.role] ?? 0, perp);
    }
  }

  /** the measured spread of a role, against the nominal it was spawned from. */
  const scattered = (role: string, nominal: number, what: string) => {
    const b = band[role];
    check(`${what} (${Math.round(b.lo)}-${Math.round(b.hi)}, nominal ${nominal})`,
      b.lo >= nominal * NEAR - 1 && b.hi <= nominal * FAR + 1
      && b.lo < nominal * (NEAR + 0.15) && b.hi > nominal * (FAR - 0.15),
      `expected the band ${nominal * NEAR}-${nominal * FAR} to be reached and not exceeded`);
  };
  scattered('asteroid', ASTEROID_SCATTER, 'the rocks scatter wide, as scenery');
  scattered('hunter', HUNTER_SCATTER, '...a bounty hunter works the whole system');
  scattered('hermit', HERMIT_SCATTER, '...and the hermit hides at the far edge of the rocks');

  // A corridor role sits along the lane, between CORRIDOR_START and its end, and
  // off that line by no more than its own scatter.
  const slackFor = (scatterRange: number) => scatterRange * FAR / ROUTE;
  const onCorridor = (role: string, scatterRange: number, what: string) => {
    const a = along[role];
    const slack = slackFor(scatterRange);
    check(`${what} (${a.lo.toFixed(3)}-${a.hi.toFixed(3)} of the route, off ${Math.round(off[role])})`,
      a.lo > CORRIDOR_START - slack && a.lo < CORRIDOR_START + 0.05
      && a.hi < CORRIDOR_START + CORRIDOR_SPAN + slack
      && a.hi > CORRIDOR_START + CORRIDOR_SPAN - 0.05
      && off[role] <= scatterRange * FAR + 1);
  };
  onCorridor('pirate', PIRATE_SCATTER, 'the pirate reception is strung down the corridor');
  onCorridor('police', POLICE_SCATTER, '...and the police patrol the lane, not the slot');
  // ...so no police ship is ever cordoning the station itself.
  check(`the nearest police is well off the slot (${Math.round(band.police.lo)} out)`,
    band.police.lo > POLICE_SCATTER * FAR);

  // Traders are split: half already trading by the slot, half inbound down the
  // corridor — so a pirate meets honest traffic in open space, not only at port.
  check(`some traders are trading by the station (${Math.round(band.trader.lo)} out)`,
    band.trader.lo >= TRADER_SCATTER * NEAR - 1 && band.trader.lo < TRADER_SCATTER * FAR + 1);
  check(`...and some are inbound down the corridor (nearest ${along.trader.lo.toFixed(3)} in)`,
    along.trader.lo > CORRIDOR_START - slackFor(TRADER_SCATTER)
    && along.trader.lo < CORRIDOR_START + CORRIDOR_SPAN);

  check('...so no arrival pirate is ever waiting at the station itself',
    CORRIDOR_START + CORRIDOR_SPAN < 1);
}

// --- the station's own Vipers ------------------------------------------------

// They are launched AT you, so they must read hostile. That used to be a regex
// over game.ts looking for `provokedByPlayer = true`, because the rule was
// written inline in a file that needs a canvas to build; it is
// `launchStationDefence` now, so the check can fly it. The regex would have
// passed on a line that never ran.

console.log('\nstation defence');
{
  seedWorld(5_150_515);
  const world = new World();
  world.build(g1[7]);
  const before = world.npcs.length;
  const vipers = launchStationDefence(world, new THREE.Vector3());
  check(`the station launches Vipers (${vipers.length})`, vipers.length >= 1);
  check('...which are actually in the sky', world.npcs.length === before + vipers.length);
  check('...all of them police', vipers.every((v: NpcShip) => v.role === 'police'));
  check('station defence vipers still come for you',
    vipers.every((v: NpcShip) => isHostileToPlayer(v, 0)));

  // The count and the stack, bisected out of many launches rather than written
  // down: the constants say one or two of them, 500 out along the slot normal,
  // 120 apart, each nudged by 80 in a random direction. Measuring the extremes
  // of the projection onto the normal pins all four against each other.
  const tmp = new THREE.Vector3();
  const slotN = slotNormal(world.station, tmp).clone();
  const rung: { lo: number; hi: number }[] = [];
  let fewest = Infinity, most = 0, closest = Infinity;
  for (let s = 0; s < 400; s++) {
    seedWorld(515_000 + s);
    world.clearNpcs();
    const out = launchStationDefence(world, tmp);
    fewest = Math.min(fewest, out.length); most = Math.max(most, out.length);
    out.forEach((v, i) => {
      const p = v.object.position.clone().sub(world.station.position).dot(slotN);
      const r = rung[i] ?? (rung[i] = { lo: Infinity, hi: -Infinity });
      r.lo = Math.min(r.lo, p); r.hi = Math.max(r.hi, p);
    });
    if (out.length === 2) {
      closest = Math.min(closest,
        out[0].object.position.distanceTo(out[1].object.position));
    }
  }
  eq('...never fewer than STATION_DEFENCE_MIN of them', fewest, STATION_DEFENCE_MIN);
  eq('...and never more than the span allows',
    most, STATION_DEFENCE_MIN + STATION_DEFENCE_SPAN - 1);
  eq('the stack has exactly that many rungs', rung.length, most);
  rung.forEach((r, i) => {
    const nominal = STATION_DEFENCE_STANDOFF + i * STATION_DEFENCE_STACK;
    check(`rung ${i} launches at ${nominal} along the slot normal, jittered `
      + `(measured ${Math.round(r.lo)}-${Math.round(r.hi)})`,
    r.lo >= nominal - STATION_DEFENCE_JITTER - 1
      && r.hi <= nominal + STATION_DEFENCE_JITTER + 1
      && r.lo < nominal - STATION_DEFENCE_JITTER * 0.8
      && r.hi > nominal + STATION_DEFENCE_JITTER * 0.8);
  });
  // NOT "they never land on each other" — the jitter is larger than the stack
  // spacing can absorb and about one pair in a hundred launches with hulls
  // intersecting. See STATION_DEFENCE_JITTER; fixing it is a behaviour change.
  check(`a pair is stacked down the slot, though the jitter can still bring them `
    + `into contact (closest of 400 launches: ${Math.round(closest)})`,
  closest > 0 && closest <= STATION_DEFENCE_STACK + 2 * STATION_DEFENCE_JITTER);
}

// --- witch-space is nowhere --------------------------------------------------

console.log('\nwitch-space');
{
  seedWorld(1_984_000);
  const world = new World();
  world.build(g1[7]);
  world.banishScenery();
  const origin = new THREE.Vector3();
  // BANISHED's whole design is that no subsystem needs a witch-space branch:
  // every distance check takes its natural answer and reads "not here". So the
  // claim is against the ranges those checks use, not against a round number.
  const furthest = Math.max(MASS_LOCK_STATION, SUN_HEAT_START, PLAYER_INTEREST_RANGE);
  for (const [what, pos] of [['the station', world.station.position],
    ['the planet', world.planetPos], ['the sun', world.sunPos]] as const) {
    check(`${what} is banished past every range the simulation asks about`,
      pos.distanceTo(origin) > furthest * 100, `${Math.round(pos.distanceTo(origin))}`);
  }
  check('...and it is still an exact double, so a distance comparison cannot go strange',
    Number.isSafeInteger(BANISHED) && BANISHED * BANISHED < Number.MAX_SAFE_INTEGER * 1e16);
}
