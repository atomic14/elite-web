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

/**
 * A ship's state, serialised.
 *
 * NOT a hand-written field list any more. It is whatever `NpcState` contains,
 * walked generically — which is the whole reason the state was gathered into
 * one object. The list version was written twice and wrong twice: first it
 * forgot the trigger and trade clocks, then the pack station and the brain's
 * ramped rates, and both times two reloads agreed with each other but not with
 * the run they came from. Add a field to NpcState now and it is saved.
 */
export type NpcSnapshot = {
  role: string;
  seed: number;
  /** index into `npcs` of whatever it is hunting, or -1 */
  targetIndex: number;
  state: Record<string, unknown>;
};

/** Vectors and quaternions become arrays; everything else passes through. */
export function serialiseState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) {
      const p = v as { x: number; y: number; z: number; w?: number };
      out[k] = p.w === undefined ? [p.x, p.y, p.z] : [p.x, p.y, p.z, p.w];
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** ...and back, writing INTO the live vectors so aliasing to the mesh holds. */
export function restoreState(state: Record<string, unknown>, saved: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(saved)) {
    const target = state[k];
    if (Array.isArray(v) && target && typeof target === 'object' && 'x' in target) {
      const p = target as { x: number; y: number; z: number; w?: number };
      p.x = v[0] as number; p.y = v[1] as number; p.z = v[2] as number;
      if (v.length > 3) p.w = v[3] as number;
    } else {
      state[k] = v;
    }
  }
}

export interface MissileSnapshot {
  pos: [number, number, number];
  quat: [number, number, number, number];
  /** index into `npcs`, or -1 for a hostile missile homing on the player */
  targetIndex: number;
  life: number;
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
  /** the persistent commander, exactly as a station save holds it */
  commander: CommanderData;
  /** the level-1 galaxy sim, so prices and danger resume too */
  galaxyState: unknown;
  player: ShipSnapshot;
  systems: ShipSystems;
  npcs: NpcSnapshot[];
  canisters: CanisterSnapshot[];
  encounterTimers: EncounterTimers;
  /** every flight-session flag and timer, walked generically — see SessionState */
  session: Record<string, unknown>;
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
  /**
   * Missiles in flight — a save taken mid-launch keeps them coming.
   *
   * KNOWN GAP: with a missile in the air, a restored world does not replay its
   * original bit-for-bit, and two restores do not agree with each other
   * either. Everything else does. The missile path draws from the stream a
   * variable number of times somewhere (ECM rolls are the suspect) and has not
   * been tracked down. The consequence is a plausible but different
   * continuation, not corruption — and it only applies for the couple of
   * seconds a missile is alive. Worth fixing; not worth blocking on.
   */
  missiles: MissileSnapshot[];
  /**
   * The market and the work on offer.
   *
   * Not cosmetic and not optional: both are rolled fresh when a station is
   * entered, so a save that dropped them would let you reload to reroll
   * prices and contracts until you liked them. Persisting them is what makes
   * "save anywhere" a convenience rather than an exploit.
   */
  market: unknown[];
  hermitMarket: unknown[];
  contractOffers: unknown[];
  /** index into `npcs` of the missile-locked ship, or -1 */
  targetLock: number;
  /** where the chart cursor was left */
  chartCursor: [number, number];
  /**
   * The station's orientation.
   *
   * Simulation state that lives in the SCENE, which is the conflation this
   * architecture is working to remove — and it is not cosmetic: the slot
   * normal, the docking box and the bounce in npcsVsStation are all computed
   * from it, so a station rebuilt at its starting angle changes what every
   * ship near it does. It was the last thing keeping a restored world from
   * replaying its original.
   */
  stationQuat: [number, number, number, number];
}

export const v3 = (v: { x: number; y: number; z: number }): [number, number, number] =>
  [v.x, v.y, v.z];

export const q4 = (q: { x: number; y: number; z: number; w: number }):
[number, number, number, number] => [q.x, q.y, q.z, q.w];
