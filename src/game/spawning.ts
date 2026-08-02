// Turning a population plan into ships in the sky.
//
// population.ts decides WHAT a system holds; this puts it there. The split is
// worth the two files: the plan is pure and unit-tested against the rules that
// make a galaxy feel inhabited, and this half is nothing but placement — where
// a trader sits relative to the station, how a reception scatters along the
// corridor you are about to fly down.
//
// The combat-training arena is the same job with a different plan: where an
// exercise is safe to fight (arenaCentre) and where authored opposition goes
// (spawnOpposition). Which fight it is stays with the scenario table, exactly
// as which system this is stays with population.ts.
//
// Nothing here decides anything. Give it the same plan twice and you get the
// same sky twice.

import * as THREE from 'three';
import type { World } from './world.ts';
import type { PopulationPlan } from './population.ts';
import { steerQuatToward, type NpcShip } from './npc.ts';
import {
  pirateSpecForTier, CONSTRICTOR_SPEC, SPECS, type NpcSpec,
} from './ship-specs.ts';
import type { NpcRole } from './ship-roles.ts';
import { memberTier } from './threat.ts';
import { slotNormal } from '../world/slot.ts';
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
      npc.state.organised = plan.threat.organised;
      npc.state.threatTier = tier;
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
    // steerQuatToward, not lookAt: Object3D.lookAt aims +Z at its target and a
    // hull's nose is -Z (invariant 7), so `lookAt(home)` pointed the derelict
    // exactly AWAY from the station — dot(nose, bearing) = -1, measured. It has
    // been cruising away from the system it is drifting into since it shipped.
    steerQuatToward(generationShip.object.quaternion,
      _face.copy(home).sub(generationShip.object.position), Math.PI);
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
    missionTarget.state.isMissionTarget = true;
  }

  return { generationShip, missionTarget };
}

// --- the training arena ------------------------------------------------------
//
// An exercise needs somewhere to happen and someone to fight, and both are
// placement — so both live here rather than in the simulator that runs them.
// What the fight IS (which scenario, which tier, which hull) is a rule, and
// stays with the scenario table.

/**
 * Where the arena sits, as a multiple of the planet's radius.
 *
 * 16 is witchpoint distance — the same number `game.ts` arrives you at, though
 * deliberately NOT imported from there: game.ts cannot be loaded without a
 * browser and this file is in the purity block. It is anti-SUNWARD, which is
 * what makes one rule work in all 256 systems of every galaxy: the station
 * orbits at 2.4 radii on the sunward side (system-scene.ts leans `stationDir`
 * 35% into the sun direction), so putting the arena on the far side maximises
 * the distance to the only two things that can end an exercise by themselves.
 *
 * Measured across galaxies 1, 2 and 8 — 768 systems — the worst case is
 * 67,500 units of altitude (mass-lock wants 4,000, the ground is at 80),
 * 392,000 from the sun (SUN_KILL_DIST is 21,000 and SUN_HEAT_START 110,000, so
 * the cabin never warms at all) and 77,704 from the station, whose mass-lock
 * radius is 5,000 and whose docking box is 205 across. It scales with the
 * planet, so there is no system where the margins are thinner in proportion.
 *
 * The mistake to avoid is `test/gang-trial.js`'s hardcoded (90000, 40000,
 * 90000): a fixed offset is an absolute point in a system whose furniture
 * moves with the seed, and it only happens to be empty in the systems it was
 * tried in.
 */
const ARENA_RADII = 16;

/**
 * Somewhere an exercise can be fought without the world interrupting it.
 *
 * Every property that matters is a distance to something the seed placed, so
 * this reads the world rather than assuming a coordinate. See ARENA_RADII for
 * what is guaranteed and what it was measured against.
 */
export function arenaCentre(world: World): THREE.Vector3 {
  return world.sunPos.clone().sub(world.planetPos).normalize()
    .multiplyScalar(-world.planetRadius * ARENA_RADII)
    .add(world.planetPos);
}

/**
 * Which policy an opponent flies, in the only terms placement can express.
 *
 * `pirateBrainFor` (brains.ts) reads the threat tier and the `organised` flag,
 * and that flag is the one per-ship lever there is — CLAUDE.md's Training split.
 * Choosing a *named* brain per ship (r2 vs a generation attacker vs the
 * scripted baseline) is a global A/B flag today, so a caller that wants one
 * sets it around the exercise; there is no field on `NpcState` to put it in
 * and inventing one is not this file's business.
 */
export type OppositionBrain =
  /** whatever the galaxy would give this role and tier */
  | 'auto'
  /** the pack policy — what an organised gang flies */
  | 'pack'
  /** the solo attack policy, even for a hull that arrived with a gang */
  | 'solo';

/** The fit-out overrides an exercise may hand an opponent. */
export interface OppositionFit {
  /** rack size, overriding the hull's */
  missiles?: number;
  /** carries E.C.M., rather than rolling the hull's `ecmChance` for it */
  ecm?: boolean;
}

/**
 * One line of authored opposition: a role, a hull, and how many of them.
 *
 * The hull can be said three ways because three callers want three of them,
 * and they are tried in this order: an explicit `hull` (what
 * `pirateSpecForTier` and `CONSTRICTOR_SPEC` hand you), a `variant` index into
 * the role's roster in `SPECS` (what a hull picker offers), or a pirate `tier`
 * (which also tells the brain what it is flying with). With none of them the
 * roster picks by seed, exactly as an ordinary spawn does.
 */
export interface OppositionUnit {
  role: NpcRole;
  /** how many, default 1 */
  count?: number;
  hull?: NpcSpec;
  variant?: number;
  /** pirate threat tier — sets `threatTier`, and picks the hull if `hull`/`variant` are absent */
  tier?: number;
  brain?: OppositionBrain;
  fit?: OppositionFit;
  /**
   * Treat the player as an enemy from the first frame.
   *
   * Pirates and Thargoids need nothing; police and bounty hunters attack a
   * clean commander only if provoked (`isHostileToPlayer`), so an authored
   * interdiction has to say that it was. It is the SCENARIO's claim, not ours.
   */
  hostile?: boolean;
}

/** How the ring is laid out. Everything optional; the defaults are a fair start. */
export interface OppositionPlacement {
  /** ring radius from the origin, in units */
  range?: number;
  /**
   * Where the player is looking. Given, the ring is a cone around it so
   * everything starts in front of you; omitted, it is a great circle and they
   * come from everywhere.
   */
  facing?: THREE.Vector3;
}

/**
 * The ring radius. Far enough to see them coming and close enough to be
 * fighting inside ten seconds: a pirate at 300 and a Cobra at 400 close this
 * in about five, and 9,000 is where an NPC starts caring about you at all
 * (`update()` in npc.ts).
 */
const OPPOSITION_RANGE = 3200;
/**
 * A ceiling on it, because the arena's safety margins are what a caller is
 * really trusting: the nearest hazard in any system is 67,500 units away, so
 * a ring inside this cannot put a ship in the planet or the station's box
 * however the numbers are passed in.
 */
const OPPOSITION_RANGE_MAX = 20_000;
/** Half-angle of the cone when the player's facing is known, radians. */
const OPPOSITION_CONE = 0.5;

const _axis = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _face = new THREE.Vector3();

/** Two unit vectors perpendicular to `axis` and to each other. */
function ringBasis(axis: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): void {
  u.set(0, 0, 1).cross(axis);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(axis);
  u.normalize();
  v.copy(axis).cross(u).normalize();
}

/** The hull for one opponent — see OppositionUnit for why there are three ways. */
function oppositionSpec(unit: OppositionUnit, seed: number): NpcSpec | undefined {
  if (unit.hull) return unit.hull;
  if (unit.variant !== undefined && unit.role !== 'asteroid') {
    const roster = SPECS[unit.role];
    return roster[Math.abs(Math.trunc(unit.variant)) % roster.length];
  }
  if (unit.tier !== undefined && unit.role === 'pirate') {
    return pirateSpecForTier(unit.tier, seed);
  }
  return undefined;
}

/**
 * Put authored opposition in the sky around `origin`, facing it.
 *
 * Deliberately NOT `spawnPopulation`: that builds a *system* — traders going
 * about their business, police, rocks, a hermit, maybe a generation ship — and
 * an arena wants none of it. What it shares is the idea of `scatter()`: the
 * ring is even, and everything on top of it is a draw from the world's seeded
 * stream, so the same seed gives the same sky.
 *
 * Returns the ships in the order asked for, which is the order a report will
 * want to list them in.
 */
export function spawnOpposition(
  world: World,
  opposition: readonly OppositionUnit[],
  origin: THREE.Vector3,
  placement: OppositionPlacement = {},
): NpcShip[] {
  const counts = opposition.map((u) => Math.max(1, Math.round(u.count ?? 1)));
  const total = counts.reduce((a, b) => a + b, 0);
  const range = Math.max(1, Math.min(placement.range ?? OPPOSITION_RANGE, OPPOSITION_RANGE_MAX));
  // A cone in front of the commander, or the whole sky.
  const axis = placement.facing
    ? _axis.copy(placement.facing).normalize()
    : randomDirection(_axis);
  const spread = placement.facing ? OPPOSITION_CONE : Math.PI / 2;
  ringBasis(axis, _u, _v);
  // The ring's rotation, so two exercises with one opponent do not both put it
  // in the same corner of the canopy.
  const phase = random() * Math.PI * 2;
  // Hull variety comes off the stream too — a fixed seed here would mean every
  // gang of Sidewinders was the same gang of Sidewinders.
  const roster = randomInt(1 << 20);

  const ships: NpcShip[] = [];
  let i = 0;
  opposition.forEach((unit, u) => {
    for (let k = 0; k < counts[u]; k++, i++) {
      const seed = roster + i;
      const angle = phase + (i / total) * Math.PI * 2;
      const off = spread * (0.55 + random() * 0.9);
      const dir = _dir.copy(axis).multiplyScalar(Math.cos(off))
        .addScaledVector(_u, Math.cos(angle) * Math.sin(off))
        .addScaledVector(_v, Math.sin(angle) * Math.sin(off));
      const pos = origin.clone().addScaledVector(dir, range * (0.85 + random() * 0.3));

      const npc = world.spawn(unit.role, pos, seed, oppositionSpec(unit, seed));
      // Pointed at you, not at a random corner of space: the constructor gives
      // every ship a random orientation, which is right for a system and wrong
      // for a duel. `state.quat` IS the mesh's quaternion, so this is the state.
      //
      // steerQuatToward, NOT `object.lookAt(origin)`. Object3D.lookAt points
      // +Z at its target for anything that is not a camera, and a hull's nose
      // is -Z (invariant 7, and `advance()` flies along -Z) — so lookAt spawns
      // the whole gang flying away from you. Verified: the dot product of the
      // nose against the bearing to the player comes out at exactly -1.
      steerQuatToward(npc.object.quaternion, _face.copy(origin).sub(pos), Math.PI);
      if (unit.tier !== undefined) npc.state.threatTier = unit.tier;
      if (unit.brain === 'pack') npc.state.organised = true;
      else if (unit.brain === 'solo') npc.state.organised = false;
      if (unit.hostile) {
        npc.state.provoked = true;
        npc.state.provokedByPlayer = true;
      }
      if (unit.fit?.missiles !== undefined) npc.state.missiles = Math.max(0, unit.fit.missiles);
      // Written through the state on purpose: `hasEcm` has a private setter
      // because in the galaxy it is a die roll against the hull's ecmChance at
      // warp-in, and only an authored exercise gets to say otherwise.
      if (unit.fit?.ecm !== undefined) npc.state.hasEcm = unit.fit.ecm;
      ships.push(npc);
    }
  });
  return ships;
}

/** A fresh trader warps in at the system edge and heads for the station. */
export function spawnArrivingTrader(world: World, range: number): void {
  const pos = world.station.position.clone()
    .add(randomDirection(new THREE.Vector3()).multiplyScalar(range));
  const trader = world.spawn('trader', pos, randomInt(100));
  trader.state.traderPhase = 'arriving';
  // the witch-flash that says something just came out of hyperspace
  world.effects.explosion(pos.clone(), 0x9adfff, { count: 10, speed: 120, duration: 0.7 });
}

/**
 * Vipers off the slot, launched because you shot at something you shouldn't.
 *
 * The rule the station enforces, and it was written inline in `game.ts` where
 * it could not be tested: one or two of them, stacked along the slot normal so
 * they do not arrive on top of each other, jittered so a second call does not
 * look like the first, and PROVOKED — launched specifically for you, so unlike
 * ordinary police they are already your business.
 *
 * Returns the ships so the caller can say the line and make the noise.
 */
export function launchStationDefence(world: World, tmp: THREE.Vector3): NpcShip[] {
  const station = world.station;
  const slotN = slotNormal(station, tmp);
  const count = 1 + randomInt(2);
  const out: NpcShip[] = [];
  for (let i = 0; i < count; i++) {
    const pos = station.position.clone()
      .addScaledVector(slotN, 500 + i * 120)
      .add(randomDirection(new THREE.Vector3()).multiplyScalar(80));
    const viper = world.spawn('police', pos, i);
    viper.state.provoked = true;
    viper.state.provokedByPlayer = true;
    out.push(viper);
  }
  return out;
}
