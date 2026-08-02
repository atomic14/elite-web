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
//
// WHAT A SNAPSHOT DELIBERATELY DOES NOT SAY IS WHOSE IT IS (docs/TODO/43). A
// world is a place and a moment; which CAREER's autosave group it belongs to is
// the shelf's question, and the shelf answers it in `SaveRecord.career`
// (save-file.ts), which is what `save:auto:<CAREER>:*` is keyed by. This file
// carried a `career` too, and `restore()` assigned it over the one the boot
// record had already decided — one step after boot, silently. Importing a
// stranger's file therefore pointed your autosaves at whatever career THEY
// exported under, and everybody's default is JAMESON. One home: the record.

import type { CommanderData } from './commander.ts';
import type { ShipSystems } from './systems.ts';
import type { EncounterTimers } from './encounters.ts';
import type { BrainSelection } from './brain-names.ts';

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
  /**
   * What it IS — see ship-identity.ts. Immutable, so it is beside the state
   * rather than in it, and OPTIONAL because a world written before this phase
   * has neither: `savedShipIdentity` returns undefined for those and the ship
   * comes back on its design's recommended variant, deterministically, from the
   * role, seed and hull the save already carried.
   */
  designId?: string;
  profileId?: string;
  /** index into `npcs` of whatever it is hunting, or -1 */
  targetIndex: number;
  state: Record<string, unknown>;
};

/**
 * Recursively turn vectors and quaternions into arrays.
 *
 * State used to be flat apart from replaceable decision records, so walking
 * only its top level happened to be enough. `NpcState.dockPlan` is the first
 * nested state with live vector identities: recurse so it remains plain JSON
 * without making the snapshot codec know its field names.
 */
function serialiseValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
    const p = value as { x: number; y: number; z: number; w?: number };
    return p.w === undefined ? [p.x, p.y, p.z] : [p.x, p.y, p.z, p.w];
  }
  if (Array.isArray(value)) return value.map(serialiseValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => [key, serialiseValue(nested)]),
    );
  }
  return value;
}

export function serialiseState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) out[k] = serialiseValue(v);
  return out;
}

/**
 * Restore one value, recursing into existing objects where possible.
 *
 * Writing through existing objects is what preserves the mesh transform and
 * docking plan's scratch-vector identities. A missing target (for example a
 * nullable cached brain decision) is still replaced as before.
 */
function restoreValue(target: unknown, saved: unknown): unknown {
  if (Array.isArray(saved)
    && target && typeof target === 'object' && 'x' in target && 'y' in target && 'z' in target) {
    const p = target as { x: number; y: number; z: number; w?: number };
    p.x = saved[0] as number; p.y = saved[1] as number; p.z = saved[2] as number;
    if (saved.length > 3) p.w = saved[3] as number;
    return target;
  }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)
    && target && typeof target === 'object' && !Array.isArray(target)) {
    const targetRecord = target as Record<string, unknown>;
    for (const [key, nested] of Object.entries(saved as Record<string, unknown>)) {
      targetRecord[key] = restoreValue(targetRecord[key], nested);
    }
    return target;
  }
  return saved;
}

/** ...and back, writing INTO live vectors and nested reusable objects. */
export function restoreState(state: Record<string, unknown>, saved: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(saved)) state[k] = restoreValue(state[k], v);
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
  /**
   * What is left of its released bank (TODO 28). Optional because a world
   * written before canisters had one carries no such field, and a canister that
   * has been shot at but not destroyed is not a state those saves could reach —
   * so its absence means "whole", not "unknown". An ADDITION, which is why
   * SNAPSHOT_VERSION does not move: a reader that ignores unknown keys survives.
   */
  energy?: number;
}

export interface WorldSnapshot {
  version: number;
  /** where the ship is: flight or docked. A snapshot of a menu is meaningless. */
  mode: 'flight' | 'docked';
  /** the persistent commander, exactly as a station save holds it */
  commander: CommanderData;
  // NO `career` HERE, and that is the rule rather than an omission — see the
  // header. A world knows where it is, not whose autosave group it is in.
  // Saves written before TODO 43 still carry the key; nothing reads it.
  /** the level-1 galaxy sim, so prices and danger resume too */
  galaxyState: unknown;
  player: ShipSnapshot;
  systems: ShipSystems;
  npcs: NpcSnapshot[];
  canisters: CanisterSnapshot[];
  encounterTimers: EncounterTimers;
  /** the docking computer's approach, mid-manoeuvre — the `phase` latch matters */
  dockPlan: Record<string, unknown>;
  /** the player's autopilot mid-thought — see AutopilotState */
  combatComputer: Record<string, unknown>;
  /** the reception this system laid on */
  lastThreat: Record<string, unknown> | null;
  ecmDetectedTimer: number;
  /** which brains the NPCs fly — see BrainSelection; state, so it is saved */
  brains: BrainSelection;
  /** the playtest fit-anything override — see GameState.cheat */
  cheat: boolean;
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
  /** missiles in flight — a save taken mid-launch keeps them coming */
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
  /**
   * Whether a missile is armed. A live behaviour gate — updateLock() returns
   * immediately when it is false — so a reload used to silently cool the
   * pylon and the lock you were a second from getting never happened.
   */
  missileArmed: boolean;
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
