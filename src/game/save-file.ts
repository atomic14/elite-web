// What a save IS: its name, the id it lives under, the one line a player tells
// two of them apart by, and what taking one COSTS. PURE — no localStorage, no
// DOM, no clock.
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

import { formatCredits, type CommanderData } from './commander.ts';
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
 * is only for a record that has no world. Nothing this build writes for itself
 * is in that state — every automatic and named save carries a world — so the
 * one producer left is an IMPORTED FILE whose record named a commander but no
 * world that owns one (`save-transfer.ts`), which is a shape a human with a
 * text editor can hand us and no save of ours can be. `commanderOf` is the one
 * place that knows which is which.
 */
export interface SaveRecord {
  v: number;
  /** what the player sees. For an autosave it is the commander's name. */
  name: string;
  /**
   * WHICH COMMANDER THIS SAVE BELONGS TO, and THE ONE HOME for that answer
   * (docs/TODO/43): the name they were created under, and the segment
   * `save:auto:<CAREER>:dock` and the flight ring are keyed by.
   * `GameState.career` is a read of this, and `WorldSnapshot` has no opinion.
   *
   * WHY IT IS NOT CALLED `commander`. That name is taken, one field down, by
   * this record's `CommanderData` — the character's stats — and the two are
   * different things a rename pulls apart. `CommanderData.name` is what the
   * pilot is called TODAY; this is who the save belongs to, fixed when they
   * were created, because it is half of a STORAGE KEY and a key that moves is a
   * multi-key write with a half-done state in the middle of it (docs/TODO/44).
   * So renaming a commander deliberately leaves this alone, and the rename
   * screen says so on the screen.
   *
   * "Career" is the word docs/INVARIANTS.md invariant 3 documents the key space under,
   * which is the whole reason it is still here. It carries no meaning to a
   * player and nothing a player reads says it (docs/TODO/56).
   */
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
    // Read straight, not defaulted. These two were `c.combatScore ?? c.kills ?? 0`
    // and `c.day ?? 0` — and the score fallback was a SECOND HOME for a rule
    // `repairCommander` already owns, on a commander that has been through it:
    // the only caller is `saveRows`, over `listSaves()`, and every record on that
    // path was repaired by `readSave`. Deleted 2026-08-04.
    rating: rating(c.combatScore).toUpperCase(),
    day: c.day,
  };
}

/**
 * What a row is CALLED on the list, and the only place a save's kind becomes
 * words.
 *
 * A named save is called what the player typed. An autosave is called what it
 * IS, because its stored `name` is the commander it belongs to — which the
 * COMMANDER column already says, so printing it twice told you nothing and left
 * "did I make this, or did the game?" to a KIND column that answered neither
 * (`SAVED` is an act, `STATION` is a place) and to a `●` footnote underneath
 * doing the same job a second way (docs/TODO/55).
 */
export function saveLabel(s: Pick<SaveSummary, 'kind' | 'name'>): string {
  if (s.kind === 'file') return s.name;
  return s.kind === 'dock' ? 'STATION AUTOSAVE' : 'FLIGHT AUTOSAVE';
}

/** Newest first — the order both halves of the list are shown in. */
export function newestFirst(a: SaveSummary, b: SaveSummary): number {
  return b.savedAt - a.savedAt;
}

// --- what taking one costs ---------------------------------------------------
//
// ONE HOME for the answer to "what does ENTER do to the run I am in", and it is
// here rather than in the screen because it is a claim about the SHELF: which
// keys the load is about to write, and whether the run being left has anywhere
// to land. The screen places the sentence; it does not decide it.
//
// `ENTER — LOAD` used to say nothing at all, and the act it named is not
// symmetrical — going back to an earlier save of the commander you are flying
// throws that commander's progress away, while loading somebody else's leaves
// them on the shelf exactly as you stand. The screen said neither.

/** The run in progress, as much of it as the shelf has to describe. */
export interface LiveRun {
  /** whose autosaves this session writes — `SaveRecord.career` for this session */
  career: string;
  /** what the pilot is called TODAY, which a rename moves and `career` does not */
  name: string;
  /** the system they are standing in */
  place: string;
  credits: number;
  /** combat rank, so the line above the table reads in the table's own columns */
  rating: string;
  day: number;
  /** the ship is destroyed: there is no run left to lose */
  over: boolean;
}

/** What ENTER on a row is about to do, said before it happens. */
export interface LoadCost {
  /** the sentence under the buttons */
  note: string;
  /** true when something a player would miss goes away */
  grave: boolean;
  /** whether "save it first" is a remedy worth offering here */
  saveFirst: boolean;
}

/**
 * The three ways a load can land, in the words the player is shown.
 *
 * 1. The ship is already gone — nothing is at risk, and saying so is what stops
 *    the warning below crying wolf on the one screen you reach by dying.
 * 2. The row belongs to the commander you are flying. This is the sharp one:
 *    the run is kept as that commander's station autosave only until the next
 *    launch writes over it, so the honest word is LOST and the remedy is a
 *    named save.
 * 3. The row belongs to somebody else. Nothing is lost — the load writes the
 *    current commander's station autosave on the way out (screens/saves.ts),
 *    which is why the screen may promise "as you are now" and mean it.
 */
export function loadCost(row: SaveSummary, live: LiveRun): LoadCost {
  if (live.over) {
    return {
      note: `YOUR SHIP IS GONE, SO NOTHING HERE IS AT RISK. THIS CARRIES ON AS ${row.career} `
        + `FROM DAY ${row.day} WITH ${formatCredits(row.credits)}.`,
      grave: false,
      saveFirst: false,
    };
  }
  if (row.career === live.career) {
    return {
      note: `LOADING ${saveLabel(row)} FLIES ${live.career} FROM DAY ${row.day} `
        + `WITH ${formatCredits(row.credits)} AGAIN. ANYTHING DONE SINCE — YOU ARE AT `
        + `DAY ${live.day} WITH ${formatCredits(live.credits)} — IS LOST UNLESS YOU SAVE IT FIRST.`,
      grave: true,
      saveFirst: true,
    };
  }
  return {
    note: `LOADING ${saveLabel(row)} FLIES ${row.career} INSTEAD. ${live.career} IS PUT DOWN AT `
      + `${live.place} AS YOU ARE NOW, STAYS ON THIS LIST, AND CAN BE LOADED BACK ANY TIME.`,
    grave: false,
    saveFirst: false,
  };
}
