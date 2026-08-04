import { COMMODITIES } from '../galaxy/galaxy.ts';
import type { GalaxyStateSave } from '../galaxy/living.ts';
import { COBRA_MK_3_HULL_ID, type PlayerHullId } from './ship-identity.ts';

// Commander Jameson: who you are, what you are carrying, and how you rank.
//
// PURE. No localStorage, no document, no window — it describes a commander as
// plain data, so Node can build one, the headless campaign can run thousands,
// and a test can assert against one. Reading and writing saves is storage.ts;
// what things cost is shop.ts.
//
// The header used to say "everything that persists between sessions", which
// sounds like a scope and is really a magnet: a price list is not a thing that
// persists, but it was filed here anyway, and the fuel price followed it in on
// the reasoning that every other price was here already.
//
// Imports carry explicit .ts extensions because Node loads this module
// directly for the headless campaign simulator (test/campaign.ts).

export const MAX_FUEL = 70; // tenths of a light year

/** The original's own commander, and still the default here. */
export const DEFAULT_NAME = 'JAMESON';
export const MAX_MISSILES = 4;

export type LaserType = 'pulse' | 'beam' | 'military';

export interface Equipment {
  largeBay: boolean;
  ecm: boolean;
  laser: LaserType;
  rearLaser: boolean;
  leftLaser: boolean;
  rightLaser: boolean;
  scoops: boolean;
  escapePod: boolean;
  energyUnit: boolean;
  dockingComputer: boolean;
  galacticDrive: boolean;
  energyBomb: boolean;
  miningLaser: boolean;
  combatComputer: boolean;
}

/** Trumbles: cute, cheap, and a catastrophe. Kept outside Equipment
 *  because they are a quantity, not a fitting. */

export function defaultEquipment(): Equipment {
  return {
    largeBay: false,
    ecm: false,
    laser: 'pulse',
    rearLaser: false,
    leftLaser: false,
    rightLaser: false,
    scoops: false,
    escapePod: false,
    energyUnit: false,
    dockingComputer: false,
    galacticDrive: false,
    energyBomb: false,
    miningLaser: false,
    combatComputer: false,
  };
}


/**
 * A job from a station's bulletin board. The original made you earn the
 * first mission with 16 kills; these are available from your first landing
 * so a new commander always has something to chase.
 */
export interface Contract {
  kind: 'cargo' | 'bounty' | 'courier';
  destination: number; // system index
  commodity: number; // cargo runs only
  qty: number;
  reward: number; // tenths of a credit
  deadlineDay: number;
  progress: number; // bounty kills so far
}

export interface MissionState {
  /** 0 none · 1 constrictor hunt · 2 constrictor done · 3 courier run · 4 all done */
  stage: number;
  targetIndex: number | null;
}

export function cargoCapacity(c: CommanderData): number {
  return c.equipment.largeBay ? 35 : 20;
}

export interface CommanderData {
  /** what this commander is called — Elite's own default was Jameson */
  name: string;
  /**
   * Which hull you are flying, as a `PlayerHullId` (ship-identity.ts).
   *
   * The ONE piece of player identity a later shipyard changes, which is why it
   * is saved as an id rather than as a copied stat block. It does not drive
   * flight yet: this phase records what you are in, and the TODOs that resolve
   * lasers and armour through it come after. A save that does not name one is
   * refused rather than given the Cobra — `requirePlayerHullId`, and the
   * migration that used to stand there went on 2026-08-04.
   */
  shipId: PlayerHullId;
  galaxy: number;
  systemIndex: number;
  credits: number; // in tenths of a credit, integer
  fuel: number; // tenths of a LY
  missiles: number;
  kills: number;
  /**
   * Combat reputation. Ships destroyed weighted by how hard they were:
   * a gang's Fer-de-Lance is worth five Sidewinders, because it is.
   * `kills` stays the literal body count for the status screen; this is what
   * the rating ladder reads.
   */
  combatScore: number;
  cargo: number[]; // quantity per commodity index
  /**
   * Pilots pulled out of escape capsules, awaiting delivery to a station.
   *
   * NOT cargo. This used to be `cargo[3] += 1`, and commodity 3 is SLAVES —
   * which law.ts lists as contraband. Rescuing a survivor therefore made you a
   * smuggler: the police scan flagged you and you went to Offender for a good
   * deed. They still take up a bay (see cargoTonnes) but they are not stock,
   * cannot be sold, and are nobody's business but yours.
   */
  survivors: number;
  equipment: Equipment;
  legalStatus: number; // 0 clean, 1 offender, 2 fugitive
  mission: MissionState;
  /** breeding stowaways; they eat cargo and hate heat */
  trumbles: number;
  /** elapsed days — advanced by hyperspace jumps, used for deadlines */
  day: number;
  /**
   * The furthest wave this commander has ever reached in the combat trainer.
   *
   * THE ONE THING AN EXERCISE IS ALLOWED TO LEAVE BEHIND, and it is here rather
   * than in the trainer because a run needs a result worth coming back to and a
   * result that dies with the tab is not one. It is state, so it is saved.
   *
   * It is deliberately NOT a rating, a kill or a credit, and nothing in the
   * career reads it: `rating()` reads `combatScore`, `markOf` reads the hold and
   * the reputation, and neither has heard of this. It is shown on the trainer's
   * own setup panel and nowhere else — the room's promise is that nothing that
   * happens in it leaves it, and a number the galaxy cannot see does not break
   * that promise. `test/combat-sim-career.test.ts` holds it to exactly that:
   * after a run of waves it is the ONLY field of the career that has moved.
   */
  furthestWave: number;
  contracts: Contract[];
  /** living-galaxy deltas (prices, danger, convoys in flight) */
  galaxyState?: GalaxyStateSave;
}

export function newCommander(): CommanderData {
  return {
    name: 'JAMESON',
    // Elite-A started you in an Adder; this phase deliberately does not, because
    // switching the starting hull is a balance change and not an identity one
    // (docs/TODO/ELITE-A-COMBAT-PLAN.md defers it).
    shipId: COBRA_MK_3_HULL_ID,
    galaxy: 1,
    systemIndex: 7, // Lave
    credits: 1000, // 100.0 Cr
    fuel: MAX_FUEL,
    missiles: 3,
    kills: 0,
    combatScore: 0,
    cargo: COMMODITIES.map(() => 0),
    survivors: 0,
    equipment: defaultEquipment(),
    legalStatus: 0,
    mission: { stage: 0, targetIndex: null },
    trumbles: 0,
    day: 0,
    furthestWave: 0,
    contracts: [],
  };
}

/**
 * A run of waves ended at `wave`. Keep it if it is the best there has been.
 *
 * A rule rather than a `Math.max` at the call site because there are two call
 * sites — the Game and the harness that proves the Game is right — and a
 * monotonic record written out twice is a record that eventually goes backwards.
 * It only ever grows: a bad run does not cost you a good one.
 *
 * @returns whether it moved, so the caller knows whether there is anything to save.
 */
export function recordFurthestWave(c: CommanderData, wave: number): boolean {
  const best = Math.max(0, Math.floor(wave));
  if (!(best > (c.furthestWave ?? 0))) return false;
  c.furthestWave = best;
  return true;
}

/**
 * What destroying a pirate of this threat tier is worth toward your rating.
 *
 * The original counted every kill the same, which meant the fastest route to
 * E L I T E was farming the weakest thing you could find — and made the
 * ladder's top a flat grind. Weighting by tier rewards taking on the fights
 * that are actually dangerous, which is the play the pirate economics are
 * built to offer. (Deliberate deviation; see docs/GAP-ANALYSIS.md.)
 */
export function killValue(tier: number): number {
  return tier >= 2 ? 5 : tier === 1 ? 2 : 1;
}

/** Tonnes currently used (kg/g commodities don't count against the hold). */
export function cargoTonnes(c: CommanderData): number {
  return c.cargo.reduce((sum, qty, i) => sum + (COMMODITIES[i].unit === 't' ? qty : 0), 0)
    + (c.survivors ?? 0);   // a rescued pilot takes up a bay
}

export function formatCredits(tenths: number): string {
  return `${(tenths / 10).toFixed(1)} Cr`;
}
