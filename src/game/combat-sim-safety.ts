// The three layers of "nothing that happens in the simulator leaves it".
//
// This is the safety-critical surface of the combat trainer, and it is a file
// rather than three passages scattered through a 900-line class because the
// argument only makes sense read as one thing. docs/COMBAT-SIM.md states it;
// test/combat-sim-career.test.ts proves it.
//
//   1. the COMMANDER CLONE — the layer that actually does the work. A laser
//      kill never passes through StepHost.destroyNpc at all: combat.ts calls
//      destroy() internally. `Combat` takes the commander per call precisely so
//      a different one can be handed in, and that is what covers the internal
//      call, the survivor counts, scooped cargo, fuel and missiles.
//   2. the alternative STEP HOST — below. 1 pass-through, 4 redirects, 7
//      refusals. It is the second layer, not the first, and believing otherwise
//      is what the spec had to correct.
//   3. the entry SNAPSHOT, taken by CombatSim.begin and restored by teardown,
//      which also puts the rng stream back.
//
// The load-bearing rule, in Chris's words: it must not advance you toward
// E L I T E — that requires real kills. A simulator that credited
// commander.kills or commander.combatScore would let a player grind the whole
// ladder in a training room, for free, at a station, with no risk.

import type { StepHost } from './world-step.ts';
import type { NpcShip } from './npc.ts';
import type { DamageSource } from './combat.ts';
import { type CommanderData, MAX_FUEL, MAX_MISSILES } from './commander.ts';
import { CLEAN } from './law.ts';
import type { BrainId } from './combat-sim-scenarios.ts';
import type { BrainSelection } from './brains.ts';
import type { ExerciseFit } from './combat-sim.ts';
import * as THREE from 'three';

/**
 * What the host needs from the running exercise: seven verbs, no Game.
 *
 * Naming them is the point. As a closure over `this` the host could reach
 * anything on a 68-member class; as an interface, the exercise's entire
 * influence over the world step is a list you can read in one screen.
 */
export interface ExerciseVerbs {
  fighting(): boolean;
  takeHit(amount: number, from: THREE.Vector3, source: DamageSource): void;
  destroyNpc(npc: NpcShip): void;
  wreckNpc(npc: NpcShip): void;
  pullTrigger(): void;
  die(reason: string): void;
  say(text: string, seconds: number): void;
}

/** Layer 2: what the world step may and may not do during an exercise. */
export function exerciseStepHost(x: ExerciseVerbs): StepHost {
  return {
      inFlight: () => x.fighting(),
      applyPlayerDamage: (amount, from, source) => x.takeHit(amount, from, source),
      destroyNpc: (npc) => x.destroyNpc(npc),
      wreckNpc: (npc) => x.wreckNpc(npc),
      fireLaser: () => x.pullTrigger(),
      // An offence in a training room is not an offence. It is also what
      // scrambles the station's defence Vipers, which would fly 77,000 units to
      // join a fight the scenario did not author.
      raiseLegal: () => {},
      die: (reason) => x.die(reason),
      // Unreachable from the arena and refused anyway: docking pays a fine,
      // writes the save, clears the world blob and opens the station menu.
      dock: () => {},
      completeHyperspace: () => {
        x.say('HYPERSPACE IS OFFLINE IN THE SIMULATOR', 3);
      },
      completeRescue: () => {},
      openHermitTrade: () => {},
      autoSave: () => {},
  };
}

/**
 * The A/B override, in the only terms the game can express it.
 *
 * Which named policy a pirate flies is a GLOBAL flag in brains.ts — there is no
 * per-ship field for it and inventing one is not this file's business
 * (spawning.ts says the same about `OppositionBrain`). So an exercise that names
 * a brain sets the flag for its duration and puts it back on the way out;
 * `teardown()` does that FIRST, because a career quietly flying the exercise's
 * brain is the one leak a player would never notice.
 *
 * The one brain with no entry — `pirate-attack-g1` — is not loaded by brains.ts,
 * so the game cannot fly it. Asking for it is refused rather than silently
 * ignored, because a report that says "g1" when the fight was against g3 is
 * worse than no report. `pirate-attack-e1` WAS in that position: the picker
 * offered it and the game could not load it, so every e1 exercise silently flew
 * g3 and said so in a warning. It is wired now.
 */
const BRAIN_SELECTION: Partial<Record<BrainId, BrainSelection>> = {
  'pirate-attack-g2': { sharp: true },
  'pirate-attack-e1': { engine: true },
  'pirate-attack-r2': { legacy: true },
  'pirate-pack-r4-selectonly': { pack: true },
  scripted: { scripted: true },
};


/** The selection a named brain flies under, or undefined if the game cannot load it. */
export function selectionForBrain(brain: BrainId): BrainSelection | undefined {
  return BRAIN_SELECTION[brain];
}

/**
 * Layer 1. The commander the exercise flies: a clone, with no cargo and no reputation.
 *
 * What is DROPPED matters as much as what is kept. No cargo, so a hull breach
 * cannot cost you a tonne you are carrying for a contract and a police scan
 * cannot read contraband; no contracts, so a simulated pirate cannot tick a
 * bounty job along; no legal status, so an exercise cannot make you a Fugitive.
 *
 * `kills` and `combatScore` are COPIED rather than zeroed, on purpose. They are
 * the two fields the whole rule is about, and copying them means the exercise
 * credits this clone exactly as the game credits you — so the difference between
 * the two objects afterwards is the proof, rather than an absence of evidence.
 */
export function exerciseCommander(career: CommanderData, fit: ExerciseFit = {}): CommanderData {
  const c = structuredClone(career);
  c.cargo = c.cargo.map(() => 0);
  c.survivors = 0;
  c.contracts = [];
  c.legalStatus = CLEAN;
  c.trumbles = 0;
  c.fuel = MAX_FUEL;
  c.equipment = { ...c.equipment, ...(fit.equipment ?? {}) };
  c.missiles = Math.max(0, Math.min(MAX_MISSILES, Math.round(fit.missiles ?? career.missiles)));
  return c;
}
