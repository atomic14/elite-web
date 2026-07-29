// Turning a population plan into ships in the sky.
//
// population.ts decides WHAT a system holds; this puts it there. The split is
// worth the two files: the plan is pure and unit-tested against the rules that
// make a galaxy feel inhabited, and this half is nothing but placement — where
// a trader sits relative to the station, how a reception scatters along the
// corridor you are about to fly down.
//
// Nothing here decides anything. Give it the same plan twice and you get the
// same sky twice.

import * as THREE from 'three';
import type { World } from './world.ts';
import type { PopulationPlan } from './population.ts';
import type { NpcShip } from './npc.ts';
import { pirateSpecForTier, CONSTRICTOR_SPEC } from './ship-specs.ts';
import { memberTier } from './contracts.ts';
import { random, randomInt, randomDirection } from './rng.ts';
import type { StarSystem } from '../galaxy/galaxy.ts';

/** Traders loiter this far from the station; police a little closer. */
const TRADER_SCATTER = 1800;
const POLICE_SCATTER = 1200;
const ASTEROID_SCATTER = 5000;
const HUNTER_SCATTER = 6000;
const HERMIT_SCATTER = 14_000;
/** A reception spreads across this much of the witchpoint→station corridor. */
const CORRIDOR_START = 0.1;
const CORRIDOR_SPAN = 0.75;
const PIRATE_SCATTER = 2500;

/** A random offset of up to `range`, biased outward. */
function scatter(range: number): THREE.Vector3 {
  return randomDirection(new THREE.Vector3()).multiplyScalar(range * (0.5 + random()));
}

export interface SpawnResult {
  /** the generation ship, if one crossed — the Game announces it */
  generationShip: NpcShip | null;
  /** the Constrictor, if this is where it was hiding */
  missionTarget: NpcShip | null;
}

/**
 * Build `plan` into `world`.
 *
 * @param playerPos where the commander is — the reception is scattered along
 * the corridor between them and the station, not dumped on top of them.
 */
export function spawnPopulation(
  world: World,
  plan: PopulationPlan,
  sys: StarSystem,
  playerPos: THREE.Vector3,
  missionTargetHere: boolean,
): SpawnResult {
  const home = world.station.position;

  for (let i = 0; i < plan.traders; i++) {
    world.spawn('trader', home.clone().add(scatter(TRADER_SCATTER)), i + sys.index);
  }
  for (let i = 0; i < plan.police; i++) {
    world.spawn('police', home.clone().add(scatter(POLICE_SCATTER)), i);
  }
  for (let i = 0; i < plan.asteroids; i++) {
    world.spawn('asteroid', home.clone().add(scatter(ASTEROID_SCATTER)), sys.seed[0] + i * 37);
  }

  if (plan.threat && plan.pirates > 0) {
    const toStation = home.clone().sub(playerPos);
    const routeLen = toStation.length();
    const route = toStation.normalize();
    for (let i = 0; i < plan.pirates; i++) {
      const along = routeLen * (CORRIDOR_START + random() * CORRIDOR_SPAN);
      const pos = playerPos.clone().addScaledVector(route, along).add(scatter(PIRATE_SCATTER));
      // ringleaders first, then the hangers-on they brought
      const seed = i + sys.index * 3;
      const tier = memberTier(plan.threat.tier, i);
      const npc = world.spawn('pirate', pos, seed, pirateSpecForTier(tier, seed));
      npc.organised = plan.threat.organised;
      npc.threatTier = tier;
    }
  }

  if (plan.hunter) {
    world.spawn('hunter', home.clone().add(scatter(HUNTER_SCATTER)), sys.index);
  }
  if (plan.hermit) {
    world.spawn('hermit',
      home.clone().add(scatter(HERMIT_SCATTER).addScaledVector(scatter(1), 2)), sys.index);
  }

  let generationShip: NpcShip | null = null;
  if (plan.generationShip) {
    const pos = playerPos.clone()
      .add(randomDirection(new THREE.Vector3()).multiplyScalar(14_000 + random() * 8000));
    generationShip = world.spawn('generation', pos, 0);
    generationShip.object.lookAt(home);
    // still shedding cargo after centuries
    world.cargo.spawn(
      pos.clone().add(randomDirection(new THREE.Vector3()).multiplyScalar(700)),
      3 + randomInt(4), [0, 1, 4, 8, 9, 12]);
  }

  let missionTarget: NpcShip | null = null;
  if (missionTargetHere) {
    const pos = playerPos.clone()
      .add(randomDirection(new THREE.Vector3()).multiplyScalar(4000 + random() * 4000));
    missionTarget = world.spawn('pirate', pos, 0, CONSTRICTOR_SPEC);
    missionTarget.isMissionTarget = true;
  }

  return { generationShip, missionTarget };
}

/** A fresh trader warps in at the system edge and heads for the station. */
export function spawnArrivingTrader(world: World, range: number): void {
  const pos = world.station.position.clone()
    .add(randomDirection(new THREE.Vector3()).multiplyScalar(range));
  const trader = world.spawn('trader', pos, randomInt(100));
  trader.traderPhase = 'arriving';
  // the witch-flash that says something just came out of hyperspace
  world.effects.explosion(pos.clone(), 0x9adfff, { count: 10, speed: 120, duration: 0.7 });
}
