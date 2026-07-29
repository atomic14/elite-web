// The whole world, as plain data.
//
// This is what makes saving anywhere possible. Until now a commander could
// only be written down at a station, because the save WAS the commander —
// credits, cargo, equipment — and none of the world around them. Mid-flight
// there is a great deal more that matters: where you are, what is shooting at
// you, what your shields are down to, and which way the random stream was
// about to break.
//
// THE SHAPE IS DELIBERATE. Chris's observation: an NPC ship is not really a
// different kind of thing from the player's ship. Both are a transform, a
// speed, two turn rates and some durability; what differs is who flies them
// and what they carry. So `ShipSnapshot` is the common core, and the player
// and NPC snapshots are that plus their own concerns. The classes have not
// been merged — but the data says they should be, and this is the shape that
// merge would take.
//
// Everything here is JSON: no THREE objects, no class instances, no
// functions. That is the point — `structuredClone` gives you a save, a replay
// checkpoint and a test fixture from the same call.

import type { CommanderData } from './commander.ts';
import type { ShipSystems } from './systems.ts';
import type { EncounterTimers } from './encounters.ts';

/** Bump when the shape changes so stale snapshots are refused, not misread. */
export const SNAPSHOT_VERSION = 1;

/** The part every ship has, player or not. */
export interface ShipSnapshot {
  pos: [number, number, number];
  /** x, y, z, w */
  quat: [number, number, number, number];
  speed: number;
  pitchRate: number;
  rollRate: number;
}

export interface NpcSnapshot extends ShipSnapshot {
  role: string;
  /** the variant seed its hull and stats were generated from */
  seed: number;
  hp: number;
  alive: boolean;
  provoked: boolean;
  provokedByPlayer: boolean;
  satisfied: boolean;
  organised: boolean;
  threatTier: number;
  isMissionTarget: boolean;
  inert: boolean;
  docked: boolean;
  docking: boolean;
  missiles: number;
  /**
   * The per-ship timers. Leaving these out was the difference between a
   * snapshot that restores the world and one that restores a world: two
   * reloads agreed with each other but not with the run they came from,
   * because every restored ship had a fresh trigger and a fresh trade clock.
   */
  fireCooldown: number;
  tradeTimer: number;
  traderPhase: string;
  fleeing: boolean;
  fleeFrom: [number, number, number];
  /** index into `npcs` of whatever it is hunting, or -1 */
  targetIndex: number;
  /** its station in a gang, generated once at spawn from the seeded stream */
  packOffset: [number, number, number];
  waypoint: [number, number, number];
  waypointTimer: number;
  /** the brain's decision clock and its ramped turn rates */
  brainTimer: number;
  brainPitchRate: number;
  brainRollRate: number;
}

export interface CanisterSnapshot {
  pos: [number, number, number];
  velocity: [number, number, number];
  spinAxis: [number, number, number];
  kind: 'cargo' | 'capsule';
  commodity: number;
}

export interface WorldSnapshot {
  version: number;
  /** where the ship is: flight or docked. A snapshot of a menu is meaningless. */
  mode: 'flight' | 'docked';
  witchspace: boolean;
  /** the persistent commander, exactly as a station save holds it */
  commander: CommanderData;
  /** the level-1 galaxy sim, so prices and danger resume too */
  galaxyState: unknown;
  player: ShipSnapshot;
  systems: ShipSystems;
  npcs: NpcSnapshot[];
  canisters: CanisterSnapshot[];
  encounterTimers: EncounterTimers;
  /**
   * Generator state, not just the seed.
   *
   * Restoring the seed alone would rewind the stream to the moment you entered
   * the system, so the next pirate wave and every damage roll after a reload
   * would differ from the run you saved. The distinction between a snapshot
   * and an approximation.
   */
  rng: { seed: number; state: number };
  /** hyperspace target, so the chart still points where you were going */
  chartTarget: number | null;
  view: number;
}

export const v3 = (v: { x: number; y: number; z: number }): [number, number, number] =>
  [v.x, v.y, v.z];

export const q4 = (q: { x: number; y: number; z: number; w: number }):
[number, number, number, number] => [q.x, q.y, q.z, q.w];
