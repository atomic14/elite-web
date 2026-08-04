// Reading the world onto the dashboard.
//
// The single largest method left in game.ts (100 lines) was the one that
// turned "what is happening" into "what the HUD draws" — the compass rule, the
// condition light, the docking aid, the threat arrow, the target boxes, and
// twenty-odd gauge values. None of it decides anything.
//
// That makes it the clearest statement of the north star in the codebase:
// **the renderer only reads state**. It takes data and returns a picture; hand
// it a snapshot and you get the same dashboard back. There is no `Game` here
// and no callback out — the maths of *where a marker goes* lives in
// hud-model.ts, the painting lives in hud.ts, and this is the wiring between.

import * as THREE from 'three';
import {
  SCANNER_RANGE, type HudFrame, type HudState,
} from './hud.ts';
import {
  scannerContacts, projectMarker, shipIdUnderView, nearestHostile, dockingAid,
  screenTargets,
} from './hud-model.ts';
import { hostilesNear, type NpcShip } from '../game/npc.ts';
import type { CommanderData } from '../game/commander.ts';
import { ENERGY_BANKS, MAX_ENERGY, MAX_SHIELD } from '../constants/pools.ts';
import { energyLow, type ShipSystems } from '../game/systems.ts';
import type { World } from '../game/world.ts';
import type { Missile } from '../game/ordnance.ts';
import type { Canister } from '../game/cargo.ts';
import { MAX_FUEL } from '../game/commander.ts';

/** Closer than this to the sun, the compass switches to it for a sun-skim. */
export const SUNSKIM_COMPASS_RANGE = 130_000;
/** The station takes the compass within this many planet radii. */
export const STATION_COMPASS_RADII = 3;

/** Everything the dashboard reads. All data — nothing here is called back. */
export interface HudSources {
  readonly commander: CommanderData;
  readonly sys: ShipSystems;
  readonly world: World;
  readonly camera: THREE.Camera;
  readonly playerPos: THREE.Vector3;
  readonly playerQuat: THREE.Quaternion;
  readonly playerForward: THREE.Vector3;
  /** where the CURRENT view points — not the same as forward in rear view */
  readonly viewDir: THREE.Vector3;
  readonly speedFrac: number;
  readonly rollFrac: number;
  readonly pitchFrac: number;
  readonly view: number;
  readonly missiles: readonly Missile[];
  readonly canisters: readonly Canister[];
  readonly targetLock: NpcShip | null;
  readonly missileArmed: boolean;
  readonly inFlight: boolean;
  readonly witchspace: boolean;
  readonly assist: boolean;
  readonly ecmDetected: boolean;
  readonly messageText: string;
  readonly messageTimer: number;
  /**
   * The training exercise in progress, or null in career flight.
   *
   * Arrives finished from the exercise's own recorder — see
   * game/combat-sim-strip.ts. The dashboard does not decide whether there is an
   * exercise any more than it decides where the station is: it is handed one or
   * it is handed null.
   */
  readonly exercise: HudState['exercise'];
}

/** Scratch vectors, so a per-frame read allocates nothing. */
export interface HudScratch {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  q: THREE.Quaternion;
}

/**
 * What the compass needle points at.
 *
 * Three rules in priority order, and the first is the one worth knowing: in
 * witch-space there is no planet and no station, so the needle finds the
 * nearest Thargoid instead. Otherwise the sun wins while you are close enough
 * to skim it — you navigate the heat by compass — then the station once you
 * are inside three planet radii, then the planet.
 */
export function compassTarget(
  s: HudSources,
): THREE.Vector3 {
  if (s.witchspace) {
    const thargoid = s.world.npcs.find((n) =>
      n.state.alive && !n.state.inert && (n.role === 'thargoid' || n.role === 'thargon'));
    if (thargoid) return thargoid.object.position;
    return s.world.planetPos;
  }
  if (s.playerPos.distanceTo(s.world.sunPos) < SUNSKIM_COMPASS_RANGE) return s.world.sunPos;
  if (s.playerPos.distanceTo(s.world.station.position)
      < s.world.planetRadius * STATION_COMPASS_RADII) {
    return s.world.station.position;
  }
  return s.world.planetPos;
}

/** Does the mount for the current view actually have a gun in it? */
export function hasLaserInView(commander: CommanderData, view: number): boolean {
  const e = commander.equipment;
  return view === 0
    || (view === 1 && !!e.rearLaser)
    || (view === 2 && !!e.leftLaser)
    || (view === 3 && !!e.rightLaser);
}

/** One frame of dashboard, read from the world. Writes nothing. */
export function buildHudFrame(s: HudSources, scratch: HudScratch): HudFrame {
  const { world, commander, playerPos } = s;
  const legal = commander.legalStatus;

  const altitude = playerPos.distanceTo(world.planetPos) - world.planetRadius;

  let dockAid: HudState['dockAid'] = null;
  let slotMarker: HudState['slotMarker'] = null;
  if (s.inFlight && !s.witchspace) {
    ({ dockAid, slotMarker } = dockingAid(
      world.station, world.stationDockZ, playerPos, s.playerQuat, s.playerForward,
      s.camera, { a: scratch.a, b: scratch.b, q: scratch.q }));
  }

  // the off-screen arrow to the nearest thing that wants you dead
  let threatMarker: HudState['threatMarker'] = null;
  if (s.inFlight && !s.witchspace) {
    const found = nearestHostile(world.npcs, playerPos, legal);
    if (found) {
      threatMarker = {
        ...projectMarker(found.npc.object.position, playerPos, s.playerForward,
          s.camera, scratch.b),
        count: found.count,
      };
    }
  }

  const targets = s.inFlight
    ? screenTargets(world.npcs, playerPos, s.viewDir, s.camera, legal,
      s.targetLock, scratch.a)
    : [];

  return {
    messageText: s.messageText,
    messageTimer: s.messageTimer,
    playerPos: s.playerPos,
    playerQuat: s.playerQuat,
    contacts: scannerContacts(
      world.station.position, world.npcs, s.missiles, s.canisters, legal),
    targets,
    compassTarget: compassTarget(s),
    speedFrac: s.speedFrac,
    rollFrac: s.rollFrac,
    pitchFrac: s.pitchFrac,
    // NORMALIZED at the boundary, like the target bracket's `hp` in
    // hud-model.ts: the banks are whole 255-point pools and the console paints
    // bars, so the division happens once, here, and no painter divides by a
    // maximum it fetched for itself.
    foreShield: s.sys.foreShield / MAX_SHIELD,
    aftShield: s.sys.aftShield / MAX_SHIELD,
    energyFrac: s.sys.energy / MAX_ENERGY,
    // The gauge's shape and its one reading, from the rules that own them: how
    // many banks the pool reads as, and whether this is the last of them. The
    // ANSWER travels, not a threshold for the painter to compare against — that
    // comparison was a third opinion about the boundary, and it disagreed with
    // the other two at exactly 64 (TODO 48).
    energyBanks: ENERGY_BANKS,
    energyLow: energyLow(s.sys.energy),
    fuelFrac: commander.fuel / MAX_FUEL,
    laserTemp: s.sys.laserTemp,
    altitudeFrac: altitude / (world.planetRadius * 2),
    cabinTemp: s.sys.cabinTemp,
    missiles: commander.missiles,
    locked: s.targetLock !== null,
    condition: !s.inFlight ? 'GREEN'
      : hostilesNear(world.npcs, playerPos, legal) ? 'RED' : 'YELLOW',
    credits: commander.credits,
    view: s.view,
    hasLaser: hasLaserInView(commander, s.view),
    shipId: s.inFlight
      ? shipIdUnderView(world.npcs, playerPos, s.viewDir, scratch.c) : '',
    dockAid,
    slotMarker,
    threatMarker,
    assist: s.assist,
    armed: s.missileArmed,
    stationInRange: s.inFlight && !s.witchspace
      && playerPos.distanceTo(world.station.position) < SCANNER_RANGE,
    ecmDetected: s.ecmDetected,
    exercise: s.exercise,
  };
}
