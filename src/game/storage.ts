// Where a save is kept. The ONLY file in the project that touches localStorage.
//
// Chris's framing, and it is the right one: the storage mechanism was an
// implementation detail leaking into something that would otherwise be pure.
// `commander.ts` describes a commander, `save-file.ts` describes a save file,
// and this describes the shelf they sit on.
//
// THE KEY SPACE, and why it changed (docs/TODO/40). Saves used to be four
// numbered slots — `elite-web-commander:<slot>` plus `elite-web-world:<slot>`,
// picked by `elite-web-slot`. Every write, deliberate or automatic, went to the
// same pair, so the autosave and the save you meant to keep were the same
// thing: switching the pointer with a game still running let the next autosave
// write a scratch commander over a real one, with nothing left to restore from.
// That happened. Now:
//
//     <ns>save:file:<NAME>            a save the player named
//     <ns>save:auto:<CAREER>:dock     the docked checkpoint
//     <ns>save:auto:<CAREER>:fly:<n>  the in-flight ring
//     <ns>boot                        which of them the next boot resumes
//
// An autosave cannot overwrite a named save because it cannot ADDRESS one: the
// two live under different id shapes and the shapes are built here, from a name
// the player typed through `save-file.ts`'s alphabet. It is a property of the
// key space, not a rule anybody has to remember.
//
// `<ns>` is the namespace, and it is the second half of the same argument. It
// is `elite-web-` for a player and `elite-web-harness-` once `useHarnessSaves()`
// has been called — which is ONE WAY, for the life of the page. A test, a
// console harness or an agent that has switched cannot switch back, cannot
// compute a player's key (every key in the program is built from `ns` right
// here), and cannot leave a running tab autosaving into a career. Reload to
// play again. `withoutSaving()` is the other tool: it refuses writes for a span
// rather than redirecting them.
//
// The legacy key strings are still here, VERBATIM, because migration has to
// read them (see `migrateLegacySaves`). They are read once and removed once.

import { COMMODITIES } from '../galaxy/galaxy.ts';
import {
  newCommander, defaultEquipment, DEFAULT_NAME,
  type CommanderData,
} from './commander.ts';
import { migratedPlayerHullId } from './ship-identity.ts';
import { SNAPSHOT_VERSION, type WorldSnapshot } from './snapshot.ts';
import {
  SAVE_ID_PREFIX, SAVE_RECORD_VERSION, FLIGHT_RING,
  dockId, fileId, flightId, flightIds, parseSaveId, uniqueSaveName,
  commanderOf, normaliseSaveName,
  type SaveRecord,
} from './save-file.ts';

// --- the namespace ----------------------------------------------------------

const PLAYER_NS = 'elite-web-';
const HARNESS_NS = 'elite-web-harness-';

let ns = PLAYER_NS;

/**
 * Send every save this page writes or reads to the harness namespace, for good.
 *
 * There is deliberately NO way back. The failure this replaces was a harness
 * that put a pointer back and a tab that kept running: twenty seconds later the
 * autosave landed on a real career. A one-way switch cannot be forgotten, cannot
 * be unwound by a missing `finally`, and covers the running game as well as the
 * harness — the moment it is called, nothing on this page can write a player's
 * save. Reload the page to play your career again.
 */
export function useHarnessSaves(): void {
  ns = HARNESS_NS;
}

/** Which namespace is live. For a harness to print, and for tests to assert. */
export function saveNamespace(): string {
  return ns;
}

/** True once this page can no longer reach a player's saves. */
export function harnessSaves(): boolean {
  return ns === HARNESS_NS;
}

// --- writes, and the one thing allowed to refuse them ------------------------
//
// Every write and every removal goes through `writeItem`/`dropItem`, so that
// `withoutSaving()` can make a span of code INCAPABLE of touching a save rather
// than merely observed not to. It exists for the combat simulator
// (docs/COMBAT-SIM.md): restoring the entry snapshot ends at `Station.dock`,
// which writes a checkpoint, and if `restore()` were ever subtly wrong that
// write would persist the corruption over a good save. Failing safe first and
// verifying second is the only order that cannot lose a career.

let suspended = 0;
/** Keys a suspended write or removal would have touched. */
const refused: string[] = [];

/**
 * The store, or null when there is not one.
 *
 * Under node there is no `localStorage`, and every READ used to go straight at
 * it, which is how a headless `saveCommander` threw inside the read that
 * preceded the write being suppressed. Degrading to null rather than throwing is
 * the same bargain `world/corona-texture.ts` makes with `document`: the file
 * that knows about the platform is the file that copes with it being absent.
 */
function store(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** @returns whether the bytes actually went anywhere. */
function writeItem(key: string, value: string): boolean {
  if (suspended > 0) { refused.push(key); return false; }
  const s = store();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    // quota, private browsing. setItem either lands or throws, so the previous
    // value of this key is still exactly where it was.
    return false;
  }
}

function dropItem(key: string): void {
  if (suspended > 0) { refused.push(key); return; }
  try { store()?.removeItem(key); } catch { /* storage unavailable */ }
}

/** A read. Null with no store, which every caller already handles. */
function readItem(key: string): string | null {
  try { return store()?.getItem(key) ?? null; } catch { return null; }
}

/**
 * Run `fn` with every save write and removal refused.
 *
 * @returns what `fn` returned, and the keys it tried to touch — so a caller that
 * suppressed a write it EXPECTED can assert the suppression was load-bearing
 * rather than vacuous. Re-entrant, and `finally`-safe.
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

// --- records ----------------------------------------------------------------

const BOOT_KEY = (): string => `${ns}boot`;

/** Read one save. Null when it is absent, corrupt, or not a save at all. */
export function readSave(id: string): SaveRecord | null {
  const raw = readItem(ns + id);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as SaveRecord;
    if (!rec || typeof rec !== 'object' || rec.v !== SAVE_RECORD_VERSION) return null;
    // Every commander that comes off the shelf goes through the same repairs,
    // wherever it was kept — see `repairCommander`.
    if (rec.world?.commander) rec.world.commander = repairCommander(rec.world.commander);
    if (rec.commander) rec.commander = repairCommander(rec.commander);
    return rec;
  } catch {
    return null;
  }
}

/**
 * Write one save, as ONE key and one `setItem`.
 *
 * @returns false when nothing was written — no store, writes refused, or the
 * store is full. A false is never partial: the record that was there before is
 * still there, byte for byte.
 */
export function writeSave(id: string, rec: SaveRecord): boolean {
  try {
    return writeItem(ns + id, JSON.stringify(rec));
  } catch {
    return false;   // a world that will not serialise must not take the tab down
  }
}

export function deleteSave(id: string): void {
  dropItem(ns + id);
}

/** Every save on the shelf, whatever career it belongs to. */
export function listSaves(): { id: string; record: SaveRecord }[] {
  const s = store();
  if (!s) return [];
  const out: { id: string; record: SaveRecord }[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(ns + SAVE_ID_PREFIX)) continue;
    const id = key.slice(ns.length);
    if (!parseSaveId(id)) continue;
    const record = readSave(id);
    if (record) out.push({ id, record });
  }
  return out;
}

/**
 * The last stamp handed out, so two saves in the same millisecond still order.
 *
 * Module-level and mutable, held to `rng.ts`'s bar: nothing branches on it, it
 * is not a rule, and losing it costs at most one tie. Without it the ring's
 * "overwrite the oldest" cannot tell three equal timestamps apart, and a test
 * that writes four saves in a millisecond evicts the same slot every time.
 */
let lastStamp = 0;

/**
 * Build a record. Here rather than at the call sites so `savedAt` has one
 * source and the version cannot be forgotten.
 */
export function makeRecord(
  name: string, career: string, kind: SaveRecord['kind'],
  world: WorldSnapshot | null, commander: CommanderData | null = null,
): SaveRecord {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return {
    v: SAVE_RECORD_VERSION,
    name, career, kind,
    savedAt: lastStamp,
    world,
    commander: world ? null : commander,
  };
}

// --- what the game asks for -------------------------------------------------

/** Store the docked checkpoint for `career` — on docking, and before launch. */
export function writeDockSave(career: string, world: WorldSnapshot): boolean {
  const ok = writeSave(dockId(career), makeRecord(career, career, 'dock', world));
  if (ok) setBootId(dockId(career));
  return ok;
}

/**
 * Store the next in-flight autosave for `career`.
 *
 * Round-robin over the OLDEST slot, derived from what is on the shelf rather
 * than from a counter, so a reload cannot restart the ring and bury the entry
 * it should have kept.
 */
export function writeFlightSave(career: string, world: WorldSnapshot): boolean {
  const ids = flightIds(career);
  let target = ids[0];
  let oldest = Infinity;
  for (const id of ids) {
    const rec = readSave(id);
    if (!rec) { target = id; oldest = -Infinity; break; }
    if (rec.savedAt < oldest) { oldest = rec.savedAt; target = id; }
  }
  const ok = writeSave(target, makeRecord(career, career, 'fly', world));
  if (ok) setBootId(target);
  return ok;
}

/**
 * Store a save the player named.
 *
 * @returns 'ok', 'full' when the cap is reached, or 'failed' when the store
 * refused the bytes. Nothing is deleted in any of the three cases.
 */
export function writeNamedSave(
  name: string, career: string, world: WorldSnapshot, cap: number,
): 'ok' | 'full' | 'failed' {
  const id = fileId(name);
  const replacing = readSave(id) !== null;
  if (!replacing && namedSaves().length >= cap) return 'full';
  return writeSave(id, makeRecord(normaliseSaveName(name), career, 'file', world))
    ? 'ok' : 'failed';
}

/** The named saves, for the cap, for the list, and for name collisions. */
export function namedSaves(): { id: string; record: SaveRecord }[] {
  return listSaves().filter((s) => s.record.kind === 'file');
}

/** Is there already a save under this name? */
export function namedSaveExists(name: string): boolean {
  return readSave(fileId(name)) !== null;
}

/**
 * Forget a career's in-flight ring.
 *
 * Two callers, both deliberate: docking, because the checkpoint you just wrote
 * supersedes the flight you just finished; and death, because keeping the last
 * twenty seconds of a lost fight would make dying optional if you reloaded.
 * Neither can reach the docked checkpoint or a named save.
 */
export function clearFlightSaves(career: string): void {
  for (const id of flightIds(career)) deleteSave(id);
  // The boot pointer may have been aimed at one of them. Aim it at the
  // checkpoint instead, rather than leaving it dangling for the fallback scan
  // to guess at — after a death that pointer IS the way back.
  if (readSave(dockId(career))) setBootId(dockId(career));
}

// --- which save the next boot resumes ---------------------------------------

export function setBootId(id: string): void {
  writeItem(BOOT_KEY(), id);
}

export function clearBootId(): void {
  dropItem(BOOT_KEY());
}

/**
 * The save this session continues.
 *
 * The pointer, when it names something that is still there. Otherwise the
 * newest record on the shelf, which is the best guess left after a pointer is
 * lost — and null when the shelf is empty, which is a new commander.
 */
export function bootSave(): { id: string; record: SaveRecord } | null {
  migrateLegacySaves();
  const id = readItem(BOOT_KEY());
  if (id) {
    const record = readSave(id);
    if (record) return { id, record };
  }
  const all = listSaves();
  if (!all.length) return null;
  return all.reduce((a, b) => (b.record.savedAt > a.record.savedAt ? b : a));
}

/**
 * The commander this session starts as — the boot save's, or a fresh one.
 *
 * The Game needs a commander before it has anything to capture a world from,
 * which is why this exists beside `bootSave()` rather than inside it.
 */
export function bootCommander(): CommanderData {
  return commanderOf(bootSave()?.record ?? ({} as SaveRecord)) ?? newCommander();
}

/**
 * Which career's autosaves this session writes.
 *
 * The boot save's career, or a name no existing career is using — so starting
 * a fresh commander can never adopt an old one's autosave group and evict its
 * docked checkpoint.
 */
export function bootCareer(commander: CommanderData): string {
  const boot = bootSave();
  if (boot) return boot.record.career || boot.record.name;
  return freshCareerName(commander.name);
}

/** A career name nothing on the shelf is using. */
export function freshCareerName(base: string): string {
  return uniqueSaveName(base || DEFAULT_NAME, listSaves().map((s) => s.record.career));
}

// --- migration --------------------------------------------------------------

/** The pre-slots key: one commander, no number after it. */
const LEGACY_BARE = (): string => `${ns}commander`;
const LEGACY_SLOT_KEY = (): string => `${ns}slot`;
const legacyCommanderKey = (slot: number): string => `${ns}commander:${slot}`;
const legacyWorldKey = (slot: number): string => `${ns}world:${slot}`;
/** How many numbered slots the old scheme had. */
const LEGACY_SLOTS = 4;

/**
 * Every commander that comes off the shelf, repaired the same way.
 *
 * Unchanged from the slot era: fields added since a save was written get their
 * defaults, and a hull id that is missing or unresolvable becomes the Cobra Mk
 * III every legacy career flew — never a failure to load.
 */
function repairCommander(stored: Partial<CommanderData>): CommanderData {
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
  // The rule is migratedPlayerHullId's, not this file's — persistence.ts
  // restores a commander out of a world save and has to make the same choice.
  parsed.shipId = migratedPlayerHullId(stored.shipId);
  if (typeof parsed.name !== 'string' || !parsed.name) parsed.name = DEFAULT_NAME;
  return parsed;
}

/** Has slot `n` already been migrated? Then the record says so. */
function recordFromSlot(n: number): { id: string; record: SaveRecord } | null {
  return listSaves().find((s) => s.record.from === n) ?? null;
}

/**
 * Turn the four numbered slots into named saves, once, safely, and repeatably.
 *
 * THE ORDER IS THE SAFETY, and it is per slot: write the new record, READ IT
 * BACK and check it carries the same commander, and only then remove the old
 * keys. A crash, a refused write or a full store therefore leaves the old keys
 * exactly where they were, and the next boot tries again. A slot that has
 * already been migrated is recognised by `from`, so running twice cannot
 * produce a second copy — which is also why the disambiguated name has to be
 * derived deterministically rather than invented per run.
 *
 * The old keys ARE removed once the copy is proven, rather than kept as a
 * fallback: two homes for the same career is the failure this project is
 * organised against, and the proof-before-delete is the insurance instead.
 */
export function migrateLegacySaves(): void {
  const s = store();
  if (!s) return;
  // the pre-slots blob, exactly as before: it becomes slot 1 if slot 1 is free
  const bare = readItem(LEGACY_BARE());
  if (bare) {
    if (!readItem(legacyCommanderKey(1))) writeItem(legacyCommanderKey(1), bare);
    dropItem(LEGACY_BARE());
  }

  const pointer = Number(readItem(LEGACY_SLOT_KEY()));
  let bootFrom: number | null =
    Number.isInteger(pointer) && pointer >= 1 && pointer <= LEGACY_SLOTS ? pointer : null;

  for (let slot = 1; slot <= LEGACY_SLOTS; slot++) {
    const commanderRaw = readItem(legacyCommanderKey(slot));
    const worldRaw = readItem(legacyWorldKey(slot));
    if (!commanderRaw && !worldRaw) continue;

    let migrated = recordFromSlot(slot);
    if (!migrated) {
      const made = migrateOneSlot(slot, commanderRaw, worldRaw);
      if (!made) continue;   // refused or unreadable — leave the old keys alone
      migrated = made;
    }
    // proven present: only now do the originals go
    dropItem(legacyCommanderKey(slot));
    dropItem(legacyWorldKey(slot));
    if (bootFrom === null) bootFrom = slot;
    if (bootFrom === slot && !readItem(BOOT_KEY())) setBootId(migrated.id);
  }

  if (bootFrom !== null) {
    const target = recordFromSlot(bootFrom);
    if (target) setBootId(target.id);
    dropItem(LEGACY_SLOT_KEY());
  }
}

/**
 * One slot into one record, written and then PROVEN.
 *
 * @returns the record as it reads back, or null if it did not land.
 */
function migrateOneSlot(
  slot: number, commanderRaw: string | null, worldRaw: string | null,
): { id: string; record: SaveRecord } | null {
  let commander: CommanderData | null = null;
  try {
    if (commanderRaw) commander = repairCommander(JSON.parse(commanderRaw) as CommanderData);
  } catch { commander = null; }

  let world: WorldSnapshot | null = null;
  try {
    if (worldRaw) {
      const snap = JSON.parse(worldRaw) as WorldSnapshot;
      // A snapshot from a different format is not loadable and never was: the
      // commander beside it still is, so the slot keeps its career either way.
      if (snap && snap.version === SNAPSHOT_VERSION && snap.commander) {
        snap.commander = repairCommander(snap.commander);
        // The old boot refused a world whose commander was not the slot's, and
        // fell back to the station save. Same answer here.
        if (!commander || snap.commander.name === commander.name) world = snap;
      }
    }
  } catch { world = null; }

  if (!world && !commander) return null;
  const base = (world?.commander ?? commander)?.name ?? DEFAULT_NAME;
  const taken = listSaves().map((r) => r.record.name);
  const name = uniqueSaveName(base, taken);
  const record: SaveRecord = {
    ...makeRecord(name, name, 'file', world, commander),
    // Carries the slot it came from, which is what makes a second run a no-op.
    from: slot,
  };
  const id = fileId(name);
  if (!writeSave(id, record)) return null;
  const back = readSave(id);
  const kept = commanderOf(back ?? ({} as SaveRecord));
  const wanted = commanderOf(record);
  if (!back || !kept || !wanted) return null;
  if (kept.name !== wanted.name || kept.credits !== wanted.credits) return null;
  if (back.from !== slot) return null;
  return { id, record: back };
}

// --- what the console and the harnesses need ---------------------------------

/**
 * Every id a career occupies, for a harness that wants to clean up after
 * itself. Ids, never keys: the namespace is applied here and nowhere else.
 */
export function careerIds(career: string): string[] {
  return [dockId(career), ...Array.from({ length: FLIGHT_RING }, (_, i) => flightId(career, i))];
}

/** Wipe the harness namespace. Refuses point-blank outside it. */
export function clearHarnessSaves(): void {
  if (!harnessSaves()) return;
  for (const { id } of listSaves()) deleteSave(id);
  clearBootId();
}
