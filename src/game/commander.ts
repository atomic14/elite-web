import { COMMODITIES } from '../galaxy/galaxy.ts';
import type { GalaxyStateSave } from '../galaxy/living.ts';

// Commander Jameson: who you are, what you are carrying, and how you rank.
//
// NOT the shop — what things cost is shop.ts. The header used to say
// "everything that persists between sessions", which sounds like a scope and
// is really a magnet: a price list is not a thing that persists, but it was
// filed here anyway, and the fuel price followed it in on the reasoning that
// every other price was here already.
//
// What IS still here and arguably should not be: the localStorage slot
// machinery (currentSlot/readSlot/saveWorld/loadCommander...). Those keys are
// load-bearing — CLAUDE.md is explicit that renaming one orphans every
// existing save — so they are staying in one place until moving them is worth
// the risk. Named here so the next reader knows it is a decision, not an
// oversight.
// Imports carry explicit .ts extensions because this module is also loaded
// directly by Node for the headless campaign simulator (test/campaign.ts). Saved to
// localStorage on every successful docking, classic "save at station" style.

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

const RATINGS: [number, string][] = [
  [0, 'Harmless'],
  [8, 'Mostly Harmless'],
  [16, 'Poor'],
  [32, 'Below Average'],
  [64, 'Average'],
  [128, 'Above Average'],
  [512, 'Competent'],
  [2560, 'Dangerous'],
  [6400, 'Deadly'],
  [25600, 'E L I T E'],
];

export interface CommanderData {
  /** what this commander is called — Elite's own default was Jameson */
  name: string;
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
   * the rating ladder reads. Absent in saves written before it existed.
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
  contracts: Contract[];
  /** living-galaxy deltas (prices, danger, convoys in flight) */
  galaxyState?: GalaxyStateSave;
}

const SAVE_KEY = 'elite-web-commander';

/**
 * Where a mid-flight world lives, per slot.
 *
 * A NEW key, deliberately. The `elite-web-commander:<slot>` keys are where
 * every existing player's career lives and must never be renamed or
 * repurposed (CLAUDE.md) — so the world sits beside the commander rather than
 * inside it, and a save written before this existed still loads, it just
 * starts you at the station as it always did.
 */
const WORLD_KEY = 'elite-web-world';
/** How many commanders you can keep on the go. */
export const SAVE_SLOTS = 4;
const slotKey = (slot: number): string => `${SAVE_KEY}:${slot}`;
const CURRENT_KEY = 'elite-web-slot';

/** Which slot is being played. Defaults to 1. */
export function currentSlot(): number {
  const n = Number(localStorage.getItem(CURRENT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= SAVE_SLOTS ? n : 1;
}

export function setCurrentSlot(slot: number): void {
  try {
    localStorage.setItem(CURRENT_KEY, String(slot));
  } catch { /* storage unavailable */ }
}

/** A slot's headline, for the load screen. null when the slot is empty. */
export interface SlotSummary {
  slot: number;
  name: string;
  systemIndex: number;
  credits: number;
  kills: number;
  combatScore: number;
  day: number;
}

export function readSlot(slot: number): SlotSummary | null {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CommanderData>;
    return {
      slot,
      name: c.name ?? DEFAULT_NAME,
      systemIndex: c.systemIndex ?? 7,
      credits: c.credits ?? 0,
      kills: c.kills ?? 0,
      combatScore: c.combatScore ?? c.kills ?? 0,
      day: c.day ?? 0,
    };
  } catch {
    return null;
  }
}

export function deleteSlot(slot: number): void {
  localStorage.removeItem(`${WORLD_KEY}:${slot}`);
  try {
    localStorage.removeItem(slotKey(slot));
  } catch { /* storage unavailable */ }
}

/**
 * Move a pre-slots save into slot 1. Cheap, and it means the commander you
 * were already playing doesn't get orphaned the moment slots appear.
 */
function migrateLegacySave(): void {
  try {
    const legacy = localStorage.getItem(SAVE_KEY);
    if (legacy && !localStorage.getItem(slotKey(1))) {
      localStorage.setItem(slotKey(1), legacy);
    }
    if (legacy) localStorage.removeItem(SAVE_KEY);
  } catch { /* storage unavailable */ }
}

export function newCommander(): CommanderData {
  return {
    name: 'JAMESON',
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
    contracts: [],
  };
}

/** Store a mid-flight world for `slot`. */
export function saveWorld(json: string, slot = currentSlot()): void {
  try {
    localStorage.setItem(`${WORLD_KEY}:${slot}`, json);
  } catch {
    // quota, private browsing — the commander save is what matters, and it
    // has already been written
  }
}

/** The mid-flight world for `slot`, if one was left behind. */
export function readWorld(slot = currentSlot()): string | null {
  return localStorage.getItem(`${WORLD_KEY}:${slot}`);
}

/** Forget it — on death, or on a clean dock where the station save is enough. */
export function clearWorld(slot = currentSlot()): void {
  localStorage.removeItem(`${WORLD_KEY}:${slot}`);
}

export function saveCommander(c: CommanderData, slot = currentSlot()): void {
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(c));
  } catch {
    // storage unavailable — play on without saves
  }
}

export function loadCommander(slot = currentSlot()): CommanderData {
  migrateLegacySave();
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return newCommander();
    const stored = JSON.parse(raw) as Partial<CommanderData>;
    const parsed = { ...newCommander(), ...stored };
    parsed.equipment = { ...defaultEquipment(), ...(stored.equipment ?? {}) };
    parsed.mission = { stage: 0, targetIndex: null, ...(stored.mission ?? {}) };
    if (!Array.isArray(parsed.contracts)) parsed.contracts = [];
    if (typeof parsed.day !== 'number') parsed.day = 0;
    if (typeof parsed.trumbles !== 'number') parsed.trumbles = 0;
    // saves written before survivors stopped being logged as slaves
    if (typeof parsed.survivors !== 'number') parsed.survivors = 0;
    if (!Array.isArray(parsed.cargo) || parsed.cargo.length !== COMMODITIES.length) {
      parsed.cargo = COMMODITIES.map(() => 0);
    }
    // saves from before weighted ratings: every past kill counts as one
    if (typeof parsed.combatScore !== 'number') parsed.combatScore = parsed.kills ?? 0;
    if (typeof parsed.name !== 'string' || !parsed.name) parsed.name = DEFAULT_NAME;
    return parsed;
  } catch {
    return newCommander();
  }
}

export function rating(combatScore: number): string {
  let r = RATINGS[0][1];
  for (const [threshold, name] of RATINGS) {
    if (combatScore >= threshold) r = name;
  }
  return r;
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
