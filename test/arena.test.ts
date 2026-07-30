// The player's flight envelope, and what a bot-flown fight is worth.
//
// This absorbed test/arena.js. It is the only measurement of how the PLAYER's ship
// actually moves — speed, pitch, roll and engagement-range distributions — and
// scenario.ts's playerCobra target hulls are fitted to it, so deleting it without
// absorbing it would have cost the trainer the one input that makes its target move
// like a human.

import * as THREE from 'three';
import { dockingOutcome } from '../src/game/docking.ts';
import { World } from '../src/game/world.ts';
import { massLocked, SUN_KILL_DIST } from '../src/game/world-step.ts';
import { arenaCentre, spawnOpposition, type OppositionUnit } from '../src/game/spawning.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { pirateBrainFor } from '../src/game/brains.ts';
import { seedWorld } from '../src/game/rng.ts';
import { isHostileToPlayer, NpcShip } from '../src/game/npc.ts';
import {
  SPECS,
  pirateSpecForTier,
  CONSTRICTOR_SPEC,
  type NpcSpec,
} from '../src/game/ship-specs.ts';
import { SUN_HEAT_START } from '../src/game/systems.ts';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import { check, eq } from './harness.ts';

// --- the combat-training arena -----------------------------------------------
//
// arenaCentre() has to be safe in EVERY system, and "safe" is four separate
// rules owned by four other files — mass lock, the docking box, the ground and
// the sun. A bad spot is not cosmetic: the exercise ends by itself in a way the
// player cannot understand, or it docks you mid-fight. So this builds a REAL
// World for all 256 systems of galaxy 1 (plus a spot check in galaxy 3, where
// the planet radii and station orbits are drawn from different seeds) and asks
// the real functions.
//
// The mistake it exists to prevent is test/gang-trial.js's hardcoded
// (90000, 40000, 90000): an absolute point in a system whose furniture moves
// with the seed.

console.log('\ncombat arena');
{
  seedWorld(0xa4e_11a);
  const scratch = {
    v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3(),
  };
  // one state, its world rebuilt per system: massLocked() is a rule over the
  // whole state, so the only honest way to ask it is to put the player there
  const state = freshState(newCommander());
  const worst = { alt: Infinity, sun: Infinity, station: Infinity };
  const where = { alt: '', sun: '', station: '' };
  let locked = 0, notClear = 0, systems = 0;

  for (const galaxy of [1, 3]) {
    for (const sys of generateGalaxy(galaxy)) {
      systems += 1;
      state.world.build(sys);
      const world = state.world;
      const centre = arenaCentre(world);
      state.player.position.copy(centre);

      const alt = centre.distanceTo(world.planetPos) - world.planetRadius;
      const sun = centre.distanceTo(world.sunPos);
      const station = centre.distanceTo(world.station.position);
      const at = `${galaxy}:${sys.name}`;
      if (alt < worst.alt) { worst.alt = alt; where.alt = at; }
      if (sun < worst.sun) { worst.sun = sun; where.sun = at; }
      if (station < worst.station) { worst.station = station; where.station = at; }

      if (massLocked(state)) locked += 1;
      if (dockingOutcome(centre, state.player.quaternion, world.station,
        world.stationDockZ, scratch) !== 'clear') notClear += 1;
    }
  }

  check(`the arena is never mass-locked (${systems} systems)`, locked === 0,
    `${locked} systems refuse the torus drive`);
  check('...and never inside the station\'s docking box', notClear === 0,
    `${notClear} systems dock you mid-fight`);
  check(`...comfortably above the planet (worst ${Math.round(worst.alt)} at ${where.alt})`,
    worst.alt > 20_000, 'mass lock starts at 4,000 and the ground at 80');
  check(`...clear of the station (worst ${Math.round(worst.station)} at ${where.station})`,
    worst.station > 20_000, 'the station mass-locks at 5,000');
  check(`...and so far from the sun the cabin never warms (worst ${Math.round(worst.sun)} at ${where.sun})`,
    worst.sun > SUN_HEAT_START && worst.sun > SUN_KILL_DIST * 10);

  // The player arrives pointing SOMEWHERE, and an exercise is fought in front
  // of the commander, so both spawn geometries have to hold.
  const arena = (): { world: World; origin: THREE.Vector3 } => {
    const world = new World();
    world.build(generateGalaxy(1)[7]);
    return { world, origin: arenaCentre(world) };
  };

  const GANG: readonly OppositionUnit[] = [
    { role: 'pirate', count: 1, tier: 2, brain: 'pack' },
    { role: 'pirate', count: 3, tier: 1, brain: 'pack' },
  ];

  {
    const { world, origin } = arena();
    seedWorld(4242);
    const ships = spawnOpposition(world, GANG, origin);
    eq('spawnOpposition produces exactly the count asked for', ships.length, 4);
    check('...and only those ships — it does not build a system',
      world.npcs.length === 4 && world.npcs.every((n) => n.role === 'pirate'));
    check('...with the tiers it was given',
      ships.map((n) => n.threatTier).join() === '2,1,1,1');
    check('...flying the pack policy, which is the `organised` flag',
      ships.every((n) => n.organised) &&
      ships.every((n) => pirateBrainFor(n.threatTier, n.organised)?.pack === true));

    // hulls come from the roster for that tier and nowhere else
    const tierHulls = (tier: number): NpcSpec[] =>
      [0, 1, 2, 3].map((k) => pirateSpecForTier(tier, k));
    const fromRoster = (n: NpcShip, tier: number) => tierHulls(tier).some((s) =>
      s.radius === n.radius && s.hp === n.maxHp);
    check('...and hulls from the tier roster',
      fromRoster(ships[0], 2) && ships.slice(1).every((n) => fromRoster(n, 1)));

    // the safety properties, for the ships as well as the centre
    check('...none of them in the planet',
      ships.every((n) => n.object.position.distanceTo(world.planetPos)
        - world.planetRadius > 20_000));
    check('...none of them in the station\'s safety zone',
      ships.every((n) => n.object.position.distanceTo(world.station.position) > 20_000));
    check('...none of them inside the docking box',
      ships.every((n) => dockingOutcome(n.object.position, n.object.quaternion,
        world.station, world.stationDockZ, scratch) === 'clear'));
    // and near enough that the fight starts: 9,000 is where an NPC begins to
    // care about the player at all (npc.ts update()).
    check('...all of them close enough to engage',
      ships.every((n) => n.object.position.distanceTo(origin) < 9000));
    // pointed at you — the constructor's orientation is random, which is right
    // for a system and wrong for a duel
    const nose = new THREE.Vector3();
    check('...and pointing at the commander, not at a random corner of space',
      ships.every((n) => {
        nose.set(0, 0, -1).applyQuaternion(n.object.quaternion);
        return nose.dot(scratch.v.copy(origin).sub(n.object.position).normalize()) > 0.99;
      }));
    // spread out, not stacked: the closest pair must clear both hulls
    let closest = Infinity;
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        closest = Math.min(closest,
          ships[i].object.position.distanceTo(ships[j].object.position)
            - ships[i].radius - ships[j].radius);
      }
    }
    check(`...and not stacked on each other (closest pair ${Math.round(closest)} apart)`,
      closest > 200);
  }

  // Same seed, same sky — the property every replay, report and A/B depends on.
  {
    const fleet = (seed: number) => {
      const { world, origin } = arena();
      seedWorld(seed);
      return spawnOpposition(world, GANG, origin).map((n) => [
        n.role, n.maxHp, n.radius, n.hasEcm, n.missiles,
        ...n.object.position.toArray(), ...n.object.quaternion.toArray(),
      ].join(','));
    };
    const a = fleet(99), b = fleet(99), c = fleet(100);
    check('spawnOpposition is deterministic from the seed', a.join('|') === b.join('|'));
    check('...and a different seed is a different sky', a.join('|') !== c.join('|'));
  }

  // A cone in front of the commander, when the session says where they look.
  {
    const { world, origin } = arena();
    seedWorld(7);
    const facing = new THREE.Vector3(0, 0, -1);
    const ships = spawnOpposition(world, [{ role: 'hunter', count: 3 }], origin, { facing });
    const rel = new THREE.Vector3();
    check('a known facing puts every opponent in front of the commander',
      ships.every((n) => {
        rel.copy(n.object.position).sub(origin).normalize();
        return rel.dot(facing) > Math.cos(1.0);
      }));
    check('...out of the role\'s own roster',
      ships.every((n) => SPECS.hunter.some((s) => s.radius === n.radius && s.hp === n.maxHp)));
  }

  // The three ways to say which hull, and the fit-out overrides.
  {
    const { world, origin } = arena();
    seedWorld(11);
    const ships = spawnOpposition(world, [
      { role: 'police', count: 2, hostile: true, fit: { missiles: 3, ecm: false } },
      { role: 'pirate', count: 1, hull: CONSTRICTOR_SPEC },
      { role: 'trader', count: 1, variant: 2, fit: { ecm: true } },
    ], origin);
    eq('an explicit hull is used as given', ships[2].maxHp, CONSTRICTOR_SPEC.hp);
    eq('a variant index picks that roster entry', ships[3].maxHp, SPECS.trader[2].hp);
    check('a Viper is a Viper', ships[0].maxHp === SPECS.police[0].hp);
    check('the fit overrides the rack', ships[0].missiles === 3 && ships[1].missiles === 3);
    check('...and E.C.M., in both directions',
      !ships[0].hasEcm && !ships[1].hasEcm && ships[3].hasEcm);
    // Police ignore a clean commander unless provoked — an authored
    // interdiction has to say it was, or two Vipers fly past and nothing happens.
    check('`hostile` is what makes an authored interdiction fight at all',
      ships.slice(0, 2).every((n) => isHostileToPlayer(n, 0)));
    check('...and it is not the default',
      !isHostileToPlayer(ships[3], 0) && !ships[3].provokedByPlayer);
  }
}
