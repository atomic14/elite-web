// Where a save is kept. The only file that may touch localStorage for a SAVE —
// `engine/keymap.ts` is the one carve-out, and it holds the single
// `elite-web-keymap` key, which is a display preference and not a career
// (docs/INVARIANTS.md invariant 3 states the same exception).
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
//     <ns>boot                        which of them the next boot resumes —
//                                     or `new:<NAME>`, meaning none of them and
//                                     here is who to start instead (TODO 45, 56)
//
// `<CAREER>` is WHICH COMMANDER A SAVE BELONGS TO — the name they were created
// under. The word is docs/INVARIANTS.md invariant 3's and it survives in the code for
// that reason alone; nothing a player reads says it (docs/TODO/56), and
// `SaveRecord.career` in save-file.ts is where the choice of word is argued.
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
// THE OLD KEYS ARE NOT SPELLED OUT HERE, and there is no migration off them
// (docs/TODO/53) — nobody was ever playing but us. A store left over from the
// slot era boots as a fresh commander, and structurally rather than by a check:
// `listSaves()` scans for `<ns>save:` and hands every id to `parseSaveId`, so a
// key of any other shape is not a save and cannot become one. No expression in
// the program can name `<ns>commander:1`. Whatever is still sitting in a
// browser under those keys stays there, unread — deleting it would be a
// destructive write with nothing to verify it against, which is the shape TODO
// 44 was about.

import { COMMODITIES } from '../galaxy/galaxy.ts';
import {
  newCommander, defaultEquipment, DEFAULT_NAME,
  type CommanderData,
} from './commander.ts';
import { requirePlayerHullId } from './ship-identity.ts';
import type { WorldSnapshot } from './snapshot.ts';
import {
  SAVE_ID_PREFIX, SAVE_RECORD_VERSION,
  dockId, fileId, flightIds, parseSaveId, uniqueSaveName,
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
    // wherever it was kept — see `repairCommander`. It REFUSES a commander
    // flying a hull it cannot resolve, and the refusal arrives here as a throw,
    // which the catch below turns into the same null a bad `v` gets.
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

/**
 * The pointer's other value: START A NEW COMMANDER, and who they are.
 *
 * `bootSave()` falls back to the newest record on the shelf when the pointer is
 * MISSING, because a lost pointer is a pointer whose save is still the one you
 * were playing. Setting a commander aside is the opposite intent and the key
 * space could not say it, so clearing the pointer resumed the very run it meant
 * to put down — name included, so its autosaves kept landing on the same keys
 * (docs/TODO/45). "None of them" is now a thing the pointer can say.
 *
 * IT CARRIES THE NAME because there is nowhere else to put it: a new commander
 * is chosen on one side of a `location.reload()` and created on the other, and
 * the store is the only thing that survives that (docs/TODO/56). This is the
 * name's home for exactly one boot — `bootCommander()` reads it, the first
 * checkpoint writes it into a record, and `SaveRecord.career` is the home from
 * then on. It is not a second home for identity; it is the only way identity
 * reaches its first record.
 *
 * Telling it from a save id is STRUCTURAL rather than a comparison: every save
 * id starts `save:` (`SAVE_ID_PREFIX`), so a pointer that does not is a new
 * commander whatever else it says — a bare `new` from the build before this one
 * included, which resumes as an unnamed fresh commander rather than as the run
 * it was asked to put down. The name needs no encoding for the same kind of
 * reason the ids do: `normaliseSaveName` leaves only `A-Z 0-9 space`, so it
 * cannot contain the colon it is written after.
 */
const NEW_COMMANDER = 'new';

/**
 * The name the next boot's fresh commander was given, or null when no new
 * commander is pending. `''` when one is pending with no name, which is a bare
 * `new` pointer and means "a fresh commander, called whatever the default is".
 */
function pendingCommanderName(): string | null {
  const id = readItem(BOOT_KEY());
  if (id === null || id.startsWith(SAVE_ID_PREFIX)) return null;
  const colon = id.indexOf(':');
  return colon < 0 ? '' : normaliseSaveName(id.slice(colon + 1));
}

/** @returns whether the pointer actually moved. */
export function setBootId(id: string): boolean {
  return writeItem(BOOT_KEY(), id);
}

export function clearBootId(): void {
  dropItem(BOOT_KEY());
}

/**
 * Put every save on the shelf DOWN: the next boot starts `name`.
 *
 * Nothing is written and nothing is removed — a commander is set aside by
 * aiming the pointer away from them, which is why this cannot cost anybody a
 * save. The name goes with it because the boot on the other side of the reload
 * has no other way to learn it.
 *
 * @returns false when the store would not take the pointer, so the caller can
 * say so rather than reload into the commander it promised to leave.
 */
export function bootNewCommander(name: string): boolean {
  return writeItem(BOOT_KEY(), `${NEW_COMMANDER}:${normaliseSaveName(name)}`);
}

/**
 * The save this session continues.
 *
 * The pointer, when it names something that is still there — or nothing at all
 * when it names no save, which is what asking for a new commander leaves it
 * saying. Otherwise the newest record on the shelf, which is the best guess
 * left after a pointer is LOST, and null when the shelf is empty, which is a
 * new commander too.
 */
export function bootSave(): { id: string; record: SaveRecord } | null {
  const id = readItem(BOOT_KEY());
  if (id !== null && !id.startsWith(SAVE_ID_PREFIX)) return null;
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
 *
 * A fresh one is called whatever the player typed at the prompt that asked for
 * it (docs/TODO/56). A FIRST-EVER boot has no pointer at all and so has nobody
 * to ask: that one is Commander Jameson, as it has been since 1984.
 */
export function bootCommander(): CommanderData {
  const boot = bootSave();
  if (boot) return commanderOf(boot.record) ?? newCommander();
  const c = newCommander();
  const chosen = pendingCommanderName();
  if (chosen) c.name = chosen;
  return c;
}

/**
 * Which commander's autosaves this session writes. THE ONE HOME FOR THE ANSWER.
 *
 * The boot save's, or — for a commander who has no save yet — their own name,
 * which the prompt that created them has already refused to hand out twice
 * (`commanderNameTaken`, docs/TODO/56). `freshCareerName` is the belt to that
 * braces: it can never adopt an existing commander's autosave group and evict
 * their docked checkpoint, whatever the name arrived as.
 *
 * That promise held for exactly one step, because `WorldSnapshot` carried a
 * career too and `restore()` assigned it over this one (docs/TODO/43). The
 * snapshot has none now: the RECORD decides, because the record is what the
 * `save:auto:<CAREER>:*` keys are built from, and `state.career` is a read of
 * it rather than a second copy.
 */
export function bootCareer(commander: CommanderData): string {
  const boot = bootSave();
  if (boot) return boot.record.career || boot.record.name;
  return freshCareerName(commander.name);
}

/**
 * `base`, or the first free name after it, so no two commanders share a key.
 *
 * IT IS NO LONGER HOW A SECOND COMMANDER GETS NAMED. It was: a fresh run took
 * the last one's name and appended a 2, so a player who had never typed a name
 * ended up flying JAMESON 2 — which reads as a second save of JAMESON rather
 * than as a different pilot (docs/TODO/56). A name is asked for now, and one
 * already in use is refused rather than suffixed.
 *
 * What is left for it is the case that has no player at the keyboard: an
 * IMPORTED file (`adoptSaveFile`), whose commander is somebody else's JAMESON
 * and must land beside yours rather than on it. Re-importing the same file has
 * to count up rather than invent a name, which is what `uniqueSaveName` is for.
 */
export function freshCareerName(base: string): string {
  return uniqueSaveName(base || DEFAULT_NAME, listSaves().map((s) => s.record.career));
}

/**
 * Is a commander of this name already on the shelf?
 *
 * What the new-commander prompt asks before it takes a name. An identity is a
 * STORAGE KEY — `save:auto:<CAREER>:dock` and the flight ring — so two
 * commanders of one name would share an autosave group and the second one's
 * first docking would evict the first one's way back.
 *
 * Asked against every record's `career` rather than its `name`, because that is
 * the field the keys are built from: a named save called LAVE RUN belongs to a
 * commander and is not one, and its name lives in a different id shape.
 */
export function commanderNameTaken(name: string): boolean {
  const wanted = normaliseSaveName(name);
  return listSaves().some((s) => normaliseSaveName(s.record.career) === wanted);
}

// --- what comes off the shelf, repaired --------------------------------------

/**
 * Every commander that comes off the shelf, repaired the same way.
 *
 * IT IS NOT A SAVE MIGRATION, whatever its history says, and the distinction
 * decided whether it survived the 2026-08-04 legacy cull. Nothing this build
 * writes needs repairing: `capture()` clones a whole `CommanderData`, so every
 * field is there and every field has its type. What arrives incomplete is an
 * IMPORTED FILE — `adoptSaveFile` takes the commander straight out of a
 * stranger's JSON and writes it to the shelf unexamined, so the next `readSave`
 * is the first and only look anything gives it. A hand-edited file with a
 * ten-entry `cargo`, an `equipment` of `{}` or a `day` of `"soon"` reaches this
 * function, and everything below is what stops it reaching the trade screen.
 * A repair of a RECORD's contents; nothing to do with the key it was found
 * under.
 *
 * The top-level spread is what supplies an ABSENT field, so each guard below is
 * only ever reached by a field that is present and the wrong type. The
 * `combatScore` line was written as a migration — *"every past kill counts as
 * one"* — and never was one: `newCommander()` gained `combatScore: 0` in the
 * same commit (04561f0), so the spread had already answered and a career saved
 * before weighted ratings came back UNRATED rather than re-scored. It is kept
 * for what it can still do, which is repair a spoiled score from the body count
 * beside it.
 *
 * THE HULL IS NOT REPAIRED, IT IS REQUIRED. A missing or unresolvable `shipId`
 * used to become the Cobra Mk III (`migratedPlayerHullId`, deleted 2026-08-04):
 * a career written before ships had ids flew one, and an id we cannot resolve
 * was treated the same way so that a load could never fail. Chris: an
 * unreadable save is old junk. So it throws, and the throw lands where every
 * other refusal in this file lands — inside `readSave`'s `try`, which makes the
 * record read as nothing at all, exactly as a bad `v` or an unparseable key
 * does. A shelf with only such records boots a fresh commander; it never puts
 * an error in front of a player.
 */
function repairCommander(stored: Partial<CommanderData>): CommanderData {
  const parsed = { ...newCommander(), ...stored };
  parsed.equipment = { ...defaultEquipment(), ...(stored.equipment ?? {}) };
  parsed.mission = { stage: 0, targetIndex: null, ...(stored.mission ?? {}) };
  if (!Array.isArray(parsed.contracts)) parsed.contracts = [];
  if (typeof parsed.day !== 'number') parsed.day = 0;
  if (typeof parsed.trumbles !== 'number') parsed.trumbles = 0;
  if (typeof parsed.survivors !== 'number') parsed.survivors = 0;
  if (typeof parsed.furthestWave !== 'number') parsed.furthestWave = 0;
  // The LENGTH matters as much as the type: every screen that touches the hold
  // indexes it by commodity, so a short array is a hold with missing shelves.
  if (!Array.isArray(parsed.cargo) || parsed.cargo.length !== COMMODITIES.length) {
    parsed.cargo = COMMODITIES.map(() => 0);
  }
  // ...and the score falls back to the body count beside it — see above.
  if (typeof parsed.combatScore !== 'number') parsed.combatScore = parsed.kills ?? 0;
  // `stored`, not `parsed`: the spread above has already filled in a fresh
  // commander's Cobra, so asking `parsed` would accept a record that never said
  // what it was flying and quietly reinstate half the deleted migration.
  parsed.shipId = requirePlayerHullId(stored.shipId);
  if (typeof parsed.name !== 'string' || !parsed.name) parsed.name = DEFAULT_NAME;
  return parsed;
}

// --- what the console and the harnesses need ---------------------------------

/** Wipe the harness namespace. Refuses point-blank outside it. */
export function clearHarnessSaves(): void {
  if (!harnessSaves()) return;
  for (const { id } of listSaves()) deleteSave(id);
  clearBootId();
}
