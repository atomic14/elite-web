// Where a save is kept. The ONLY file in the project that touches localStorage.
//
// Chris's framing, and it is the right one: the storage mechanism was an
// implementation detail leaking into something that would otherwise be pure.
// commander.ts describes a commander — a plain object of numbers and arrays
// that Node can build, the campaign simulator can run thousands of, and a test
// can assert against. Bolting getItem/setItem to it made the whole module
// browser-only by association.
//
// That leak had already caused a real bug: freshState() in state.ts called
// loadCommander(), so the state factory — whose entire purpose is being
// constructible without a browser — threw under node. The fix at the time was
// to pass the commander in. This is the same fix applied at the source.
//
// The `elite-web-*` key strings are load-bearing and are reproduced here
// VERBATIM: they are where every existing player's commander lives, and
// renaming one silently orphans every save (CLAUDE.md says so in bold). Moving
// the code does not move the data.

import { COMMODITIES } from '../galaxy/galaxy.ts';
import {
  newCommander, defaultEquipment, DEFAULT_NAME,
  type CommanderData,
} from './commander.ts';

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
