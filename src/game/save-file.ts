// What a save IS: its name, the id it lives under, and the one line a player
// tells two of them apart by. PURE — no localStorage, no DOM, no clock.
//
// `storage.ts` owns WHERE a save lives and is still the only file that may
// touch localStorage. This owns WHAT one is, which is why the name rules, the
// id encoding and the list line can all be asserted under node.
//
// THE MODEL (docs/TODO/40): saving is a deliberate act, and the NAME IS THE
// IDENTITY of a manual save — saving under a name that already exists replaces
// it, so there is no rename, no duplicate and no hidden id. Autosaves are not
// named by the player at all: they live under a reserved `auto:` id shape that
// a typed name cannot reach, which is what makes "an autosave can never
// overwrite a named save" a property of the key space rather than a promise.

import type { CommanderData } from './commander.ts';
import { rating } from './rating.ts';
import type { WorldSnapshot } from './snapshot.ts';

/** Bump when the RECORD shape changes. Not the snapshot's version. */
export const SAVE_RECORD_VERSION = 1;

/**
 * Longest name a player may type.
 *
 * 16, because that is what the list column holds without wrapping and what
 * keeps an id short; the naming screen already refused anything but letters,
 * digits and space, and this is the same alphabet with a stated ceiling.
 */
export const MAX_SAVE_NAME = 16;

/**
 * How many in-flight autosaves are kept, PER CAREER.
 *
 * Three, at the 20-second autosave cadence, is the last minute of flying: far
 * enough back to step out of the fight you just lost, and no further, because
 * every extra slot buys another twenty seconds of the SAME engagement while
 * costing ~10 kB. The dock checkpoint is the real fallback (decision 3), and it
 * is deliberately not part of this ring (decision 2).
 *
 * Per career and never global: a global ring silently belongs to whoever flew
 * last, so keeping two careers would mean the second one's quiet cruise evicted
 * the first one's only way back.
 */
export const FLIGHT_RING = 3;

/**
 * How many NAMED saves a player may keep.
 *
 * A snapshot is about 10 kB against a few megabytes of localStorage, so this is
 * nowhere near the real limit — it is a guard rail so a stuck finger cannot
 * fill the store and start failing the AUTOSAVES, which are the saves nobody
 * asked for and everybody relies on. Reaching it refuses the write and says so;
 * nothing is ever deleted to make room.
 */
export const MAX_NAMED_SAVES = 20;

export type SaveKind = 'file' | 'dock' | 'fly';

/**
 * One save, as it is stored: one key, one JSON value, one `setItem`.
 *
 * Both halves in ONE record on purpose. The old scheme wrote the commander to
 * one key and the mid-flight world to another, so a save was two writes that
 * could half-succeed and two keys that could disagree. Here a save either
 * lands or does not.
 *
 * The commander lives INSIDE the world snapshot; `commander` at the top level
 * is only for a record that has no world — which today means a file imported
 * from the old bare-commander export (`save-transfer.ts`). `commanderOf` is the
 * one place that knows which is which.
 */
export interface SaveRecord {
  v: number;
  /** what the player sees. For an autosave it is the career's name. */
  name: string;
  /** which career's autosaves this belongs with */
  career: string;
  kind: SaveKind;
  /** epoch milliseconds, for "when" and for picking the oldest ring slot */
  savedAt: number;
  /** the whole world; null only for an imported commander-only save */
  world: WorldSnapshot | null;
  /** the commander alone, and ONLY when `world` is null */
  commander: CommanderData | null;
}

/** The commander a record describes, wherever it is kept. */
export function commanderOf(rec: SaveRecord): CommanderData | null {
  return rec.world?.commander ?? rec.commander ?? null;
}

// --- names ------------------------------------------------------------------

/**
 * A typed name, as it will be stored: upper case, letters/digits/space only,
 * single-spaced, trimmed, and no longer than `MAX_SAVE_NAME`.
 *
 * One home for it because the prompt, the importer and the id encoder all need
 * the same answer — a name that normalises two ways is two saves.
 */
export function normaliseSaveName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SAVE_NAME)
    .trim();
}

/**
 * `base`, or the first of `base 2`, `base 3`… that is not in `taken`.
 *
 * Deterministic, because an import runs it: everybody's commander is JAMESON,
 * so a file has to land beside the career you are playing rather than on it,
 * and re-importing the same file must count up rather than invent a name.
 */
export function uniqueSaveName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => normaliseSaveName(n)));
  const root = normaliseSaveName(base) || 'COMMANDER';
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const name = normaliseSaveName(root.slice(0, MAX_SAVE_NAME - suffix.length) + suffix);
    if (!used.has(name)) return name;
  }
  return root;
}

// --- ids --------------------------------------------------------------------
//
// An id is the part of a storage key AFTER the namespace prefix. Nothing
// outside storage.ts ever sees a whole key, which is what stops a harness
// addressing a player's save: the prefix is applied in exactly one place.

/** Every save id starts with this, so enumeration is a prefix scan. */
export const SAVE_ID_PREFIX = 'save:';

const enc = (name: string): string => encodeURIComponent(normaliseSaveName(name));
const dec = (part: string): string => {
  try { return decodeURIComponent(part); } catch { return part; }
};

/** A manual save, addressed by the name the player typed. */
export function fileId(name: string): string {
  return `${SAVE_ID_PREFIX}file:${enc(name)}`;
}

/** The docked checkpoint for a career — written on docking AND before launch. */
export function dockId(career: string): string {
  return `${SAVE_ID_PREFIX}auto:${enc(career)}:dock`;
}

/** One slot of a career's in-flight ring. */
export function flightId(career: string, index: number): string {
  return `${SAVE_ID_PREFIX}auto:${enc(career)}:fly:${index}`;
}

/** Every in-flight id for a career, in ring order. */
export function flightIds(career: string): string[] {
  return Array.from({ length: FLIGHT_RING }, (_, i) => flightId(career, i));
}

export interface ParsedId {
  kind: SaveKind;
  /** the file name, or the career an autosave belongs to */
  name: string;
  /** ring position, for `fly` only */
  index: number;
}

/**
 * Read an id back. Null for anything that is not one, so a scan over the whole
 * namespace can simply ignore what it does not recognise.
 */
export function parseSaveId(id: string): ParsedId | null {
  const file = /^save:file:([^:]*)$/.exec(id);
  if (file) return { kind: 'file', name: dec(file[1]), index: -1 };
  const dock = /^save:auto:([^:]*):dock$/.exec(id);
  if (dock) return { kind: 'dock', name: dec(dock[1]), index: -1 };
  const fly = /^save:auto:([^:]*):fly:(\d+)$/.exec(id);
  if (fly) return { kind: 'fly', name: dec(fly[1]), index: Number(fly[2]) };
  return null;
}

// --- the one line -----------------------------------------------------------

/** What a row of the save list says. The same shape for both halves of it. */
export interface SaveSummary {
  /** the id it is stored under — an opaque handle for load and delete */
  id: string;
  name: string;
  kind: SaveKind;
  career: string;
  savedAt: number;
  /** 'JUST NOW', '4 MIN AGO', '2 DAYS AGO' */
  when: string;
  /** the system you were in — 'LAVE' */
  place: string;
  /** 'LAVE · DOCKED' — where you were AND what you were doing */
  where: string;
  /** what a commander is called, which need not be the save's name */
  commanderName: string;
  credits: number;
  rating: string;
  day: number;
  /** true for the docked checkpoint: the one that is always safe to take */
  safe: boolean;
}

/** How long ago, in words. Rounded down, because "just now" must not lie forward. */
export function describeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} HR AGO`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 DAY AGO' : `${days} DAYS AGO`;
}

/**
 * One row.
 *
 * `systemName` is a callback rather than a systems array because a save may be
 * in another galaxy than the one being played, and resolving that is the
 * caller's business — this file generates nothing.
 */
export function summariseSave(
  id: string,
  rec: SaveRecord,
  now: number,
  systemName: (galaxy: number, index: number) => string,
): SaveSummary | null {
  const c = commanderOf(rec);
  if (!c) return null;
  const inFlight = rec.world?.mode === 'flight';
  const place = systemName(c.galaxy, c.systemIndex);
  return {
    id,
    name: rec.name,
    kind: rec.kind,
    career: rec.career,
    savedAt: rec.savedAt,
    // Clamped: `savedAt` is monotonic per process (storage.ts), so several
    // saves in one millisecond can carry a stamp a hair in the future, and
    // "JUST NOW" is the honest answer for that, not a dash.
    when: describeAge(Math.max(0, now - rec.savedAt)),
    place,
    where: `${place} · ${inFlight ? 'IN FLIGHT' : 'DOCKED'}`,
    commanderName: c.name,
    credits: c.credits,
    rating: rating(c.combatScore ?? c.kills ?? 0).toUpperCase(),
    day: c.day ?? 0,
    safe: rec.kind === 'dock',
  };
}

/** The label a row shows for what KIND of save it is. */
export function kindLabel(kind: SaveKind): string {
  return kind === 'file' ? 'SAVED' : kind === 'dock' ? 'STATION' : 'IN FLIGHT';
}

/** Newest first — the order both halves of the list are shown in. */
export function newestFirst(a: SaveSummary, b: SaveSummary): number {
  return b.savedAt - a.savedAt;
}
