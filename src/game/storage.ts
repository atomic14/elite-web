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
import { migratedPlayerHullId } from './ship-identity.ts';

const SAVE_KEY = 'elite-web-commander';

// --- writes, and the one thing allowed to refuse them ------------------------
//
// Every write and every removal below goes through `writeItem`/`dropItem`, so
// that `withoutSaving()` can make a span of code INCAPABLE of touching a save
// rather than merely observed not to.
//
// It exists for the combat simulator (docs/COMBAT-SIM.md). Restoring the entry
// snapshot on the way out of an exercise ends at `Station.dock`, which calls
// `saveCommander` — and in the happy path those bytes are identical to what is
// already there, but if `restore()` were ever subtly wrong that write would
// persist the corruption OVER a good save. So the exercise suppresses the write
// and then checks the bytes: failing safe first and verifying second is the only
// order that cannot lose a career.
//
// `dropItem` is guarded for the same reason, and it is the more dangerous half —
// `clearWorld()` DELETES the mid-flight world, which is data loss rather than a
// leak.

let suspended = 0;
/** Keys a suspended write or removal would have touched. */
const refused: string[] = [];

/**
 * The store, or null when there is not one.
 *
 * Under node there is no `localStorage`, and every READ used to go straight at
 * it. `withoutSaving` guarded the writes and not the reads, so a headless call
 * to `saveCommander` threw inside `currentSlot()` — before it ever reached the
 * write that was being suppressed. That is why the outfitter, the one code path
 * that moves a player's money, had no tests: the first honest attempt to write
 * one crashed in the save layer.
 *
 * Degrading to null rather than throwing is the same bargain
 * `world/corona-texture.ts` makes with `document`: the file that knows about the platform is the
 * file that copes with it being absent.
 */
function store(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function writeItem(key: string, value: string): void {
  if (suspended > 0) { refused.push(key); return; }
  store()?.setItem(key, value);
}

function dropItem(key: string): void {
  if (suspended > 0) { refused.push(key); return; }
  store()?.removeItem(key);
}

/** A read. Null with no store, which every caller already handles. */
function readItem(key: string): string | null {
  return store()?.getItem(key) ?? null;
}

/**
 * Run `fn` with every save write and removal refused.
 *
 * @returns what `fn` returned, and the keys it tried to touch — so a caller that
 * suppressed a write it EXPECTED can assert the suppression was load-bearing
 * rather than vacuous. Re-entrant, and `finally`-safe: a throw inside `fn` still
 * puts writing back.
 */
export function withoutSaving<T>(fn: () => T): { value: T; refused: string[] } {
  const mark = refused.length;
  suspended += 1;
  try {
    return { value: fn(), refused: refused.slice(mark) };
  } finally {
    suspended -= 1;
    refused.length = mark;
  }
}

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
  const n = Number(readItem(CURRENT_KEY));
  return Number.isInteger(n) && n >= 1 && n <= SAVE_SLOTS ? n : 1;
}

/**
 * Every localStorage key a slot occupies.
 *
 * Exported for the console harnesses, which wipe the save to start a fresh
 * commander and put the real one back afterwards. test/playtest.js was writing
 * the key out by hand as the pre-slots `elite-web-commander` — a key nothing
 * has read since slots arrived — so its run neither started fresh (respawn()
 * reloads the slot, and got the player's own commander) nor restored anything,
 * while every dock along the way overwrote the real save. The keys themselves
 * do not move; only the knowledge of them does.
 */
export function slotKeys(slot = currentSlot()): { commander: string; world: string } {
  return { commander: slotKey(slot), world: `${WORLD_KEY}:${slot}` };
}

export function setCurrentSlot(slot: number): void {
  try {
    writeItem(CURRENT_KEY, String(slot));
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
    const raw = readItem(slotKey(slot));
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
  dropItem(`${WORLD_KEY}:${slot}`);
  try {
    dropItem(slotKey(slot));
  } catch { /* storage unavailable */ }
}

/**
 * Move a pre-slots save into slot 1. Cheap, and it means the commander you
 * were already playing doesn't get orphaned the moment slots appear.
 */
function migrateLegacySave(): void {
  try {
    const legacy = readItem(SAVE_KEY);
    if (legacy && !readItem(slotKey(1))) {
      writeItem(slotKey(1), legacy);
    }
    if (legacy) dropItem(SAVE_KEY);
  } catch { /* storage unavailable */ }
}

/** Store a mid-flight world for `slot`. */
export function saveWorld(json: string, slot = currentSlot()): void {
  try {
    writeItem(`${WORLD_KEY}:${slot}`, json);
  } catch {
    // quota, private browsing — the commander save is what matters, and it
    // has already been written
  }
}

/** The mid-flight world for `slot`, if one was left behind. */
export function readWorld(slot = currentSlot()): string | null {
  return readItem(`${WORLD_KEY}:${slot}`);
}

/** Forget it — on death, or on a clean dock where the station save is enough. */
export function clearWorld(slot = currentSlot()): void {
  dropItem(`${WORLD_KEY}:${slot}`);
}

export function saveCommander(c: CommanderData, slot = currentSlot()): void {
  try {
    writeItem(slotKey(slot), JSON.stringify(c));
  } catch {
    // storage unavailable — play on without saves
  }
}

export function loadCommander(slot = currentSlot()): CommanderData {
  migrateLegacySave();
  try {
    const raw = readItem(slotKey(slot));
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
    // ...and before the combat trainer's waves mode kept a best
    if (typeof parsed.furthestWave !== 'number') parsed.furthestWave = 0;
    if (!Array.isArray(parsed.cargo) || parsed.cargo.length !== COMMODITIES.length) {
      parsed.cargo = COMMODITIES.map(() => 0);
    }
    // saves from before weighted ratings: every past kill counts as one
    if (typeof parsed.combatScore !== 'number') parsed.combatScore = parsed.kills ?? 0;
    // ...and from before ships had ids: every one of them flew a Cobra Mk III.
    // The rule is migratedPlayerHullId's, not this file's — persistence.ts
    // restores a commander out of a world save and has to make the same choice.
    parsed.shipId = migratedPlayerHullId(stored.shipId);
    if (typeof parsed.name !== 'string' || !parsed.name) parsed.name = DEFAULT_NAME;
    return parsed;
  } catch {
    return newCommander();
  }
}
