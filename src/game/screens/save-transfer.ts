// Saves that leave the browser: the JSON file you can keep, mail, or attach to
// a bug report.
//
// Split from `screens/saves.ts` because it is a different thing from a screen —
// a Blob, an anchor and a file picker, none of which has any keys, any state or
// any outcome. What it shares with the list is the SavesContext, and that is
// the whole of the coupling.
//
// An exported file carries its NAME and its world, and an import never lands on
// top of an existing save: the name is made unique first and the player is told
// which name it took.
//
// AN IMPORT EITHER BECOMES A RECORD THIS BUILD CAN READ, OR IS REFUSED OUT
// LOUD. The file's payload — its world, its commander — is the only thing taken
// from it; every field that says what the RECORD is is minted here. That is
// docs/TODO/54, and both halves of it were the same spread: `v` came off a
// stranger's disk, and `readSave` refuses a record of another version, so a file
// from another build was written, pointed at, announced, and then did not
// exist.
//
// THE DOM IS AT THE EDGE, and deliberately so. `exportedSaveFile` says what a
// file contains, `adoptSaveFile` says what name and what CAREER it takes on
// this shelf, and `receiveSaveFile` says what the player is told — none of them
// touches a Blob, an anchor, a file picker or `location`, and all three are
// synchronous. That is not tidiness: this file had ZERO test coverage because
// every line of it sat behind a file picker, and docs/TODO/43 is what shipped
// through the hole.

import type { CommanderData } from '../commander.ts';
import {
  freshCareerName, listSaves, makeRecord, setBootId, writeSave,
} from '../storage.ts';
import {
  SAVE_RECORD_VERSION, commanderOf, fileId, uniqueSaveName, type SaveRecord,
} from '../save-file.ts';
import type { WorldSnapshot } from '../snapshot.ts';
import type { SavesContext } from './saves.ts';

/**
 * The current career, as the bytes of a file and the name to offer them under.
 *
 * A whole SAVE RECORD, name included, rather than a bare commander: an export
 * that lost its name would come back as an untitled blob, and one that lost its
 * world would put you somewhere you had never been. This build wrote the bare
 * shape once and no longer reads it back — see `readSaveFile`.
 */
export function exportedSaveFile(ctx: SavesContext): { fileName: string; json: string } {
  const record = makeRecord(ctx.career, ctx.career, 'file', ctx.capture());
  return {
    fileName: `harmless-save-${ctx.career.toLowerCase().replace(/\s+/g, '-')}.json`,
    json: JSON.stringify(record, null, 2),
  };
}

/** Write the current career out as a JSON file. */
export function exportSaveFile(ctx: SavesContext): void {
  const { fileName, json } = exportedSaveFile(ctx);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  ctx.message(`EXPORTED ${ctx.career}`, 3);
}

/** The lines a refused import says, so each of them has one home. */
const NOT_A_SAVE = 'IMPORT FAILED — NOT A SAVE FILE';
const WRONG_VERSION = 'IMPORT FAILED — SAVE FROM ANOTHER VERSION';
const STORE_FULL = 'IMPORT FAILED — STORAGE FULL. NOTHING WAS CHANGED';

/**
 * What a file CONTAINS: the name it asks for, and the career inside it.
 *
 * Deliberately NOT a `SaveRecord`. A record has a version and a `savedAt`, and
 * a parser that returned one would be handing its caller two fields that came
 * off a stranger's disk — which is exactly how both halves of docs/TODO/54
 * happened. What a file gets to say is what is in it; what the record IS gets
 * minted (see `adoptSaveFile`).
 */
interface SaveFileContents {
  /** the name it would LIKE — the shelf decides whether it may have it */
  name: string;
  world: WorldSnapshot | null;
  commander: CommanderData | null;
}

/**
 * A file that might be a save — its contents, or the line that refuses it.
 *
 * THE VERSION IS CHECKED HERE, where the bytes are still a file rather than a
 * record. `readSave` refuses anything whose `v` is not this build's, so a file
 * this build cannot READ is a file it must not WRITE: writing it puts bytes on
 * the shelf that `listSaves` cannot see, the file list cannot show and no
 * delete can reach, under a boot pointer aimed at nothing.
 *
 * A RECORD IS THE ONLY SHAPE. An earlier export was a bare `CommanderData` —
 * credits and a system index, no name, no version, no world — and this used to
 * accept one. Deleted 2026-08-04 with the rest of the legacy handling (Chris:
 * *"yes, clear them now"*): nobody has such a file, and reading a shape whose
 * only witness is our own history is the second home this cleanup is about. It
 * needs no refusal of its own, and gets `NOT_A_SAVE`: a bare commander is not a
 * save FILE, and `WRONG_VERSION` would be a lie about bytes that carry no `v`
 * to be wrong.
 */
function readSaveFile(parsed: unknown): SaveFileContents | { why: string } {
  const rec = parsed as Partial<SaveRecord>;
  if (!rec || typeof rec !== 'object') return { why: NOT_A_SAVE };
  // The record shape: a name, and a commander somewhere inside it.
  if (typeof rec.name === 'string' && (rec.world || rec.commander)) {
    if (rec.v !== SAVE_RECORD_VERSION) return { why: WRONG_VERSION };
    const whole = rec as SaveRecord;
    const commander = commanderOf(whole);
    // A world is kept only when it carries the commander, because that is what
    // the record shape means by a world (save-file.ts) and `makeRecord` holds
    // the two to it. Anything else is a commander and no world.
    if (commander) {
      return { name: whole.name, world: whole.world?.commander ? whole.world : null, commander };
    }
  }
  return { why: NOT_A_SAVE };
}

/**
 * What became of a file.
 *
 * A refusal carries THE LINE THE PLAYER IS TOLD, because the difference between
 * "that is not a save", "that save is from another build" and "there is no room
 * on the disk" is the only part of a refusal anybody can act on, and a single
 * IMPORT FAILED tells them none of it.
 */
export type AdoptedFile =
  | { ok: true; id: string; name: string }
  | { ok: false; why: string };

/**
 * Put a file on this shelf, under a name and a career that are ours to give.
 *
 * TWO things are made unique, against two different sets, and both matter:
 *
 *   - the NAME, against the names already on the shelf, so the file cannot land
 *     on top of a save you meant to keep. `save:file:<NAME>`.
 *   - the CAREER, against the careers already on the shelf, so the file cannot
 *     land on top of an autosave GROUP. `save:auto:<CAREER>:dock` and the
 *     flight ring. Everybody's commander is called JAMESON by default, so
 *     without this a friend's export shares your keys by coincidence — and the
 *     imported record's career is what `bootCareer()` reads one line into the
 *     next boot, so it is the career the session then autosaves into.
 *
 * The career the file claims is discarded, whatever it says: an imported record
 * cannot be allowed to name a career that already exists, because naming one is
 * the same act as writing to it.
 *
 * AND THE RECORD IS MINTED, NOT SPREAD. `makeRecord` is the one place a record
 * is built, so `v` is this build's by construction and `savedAt` is when the
 * import happened — which is the truth, and the truth matters twice: the flight
 * ring evicts by `savedAt`, and `bootSave()`'s fallback resumes the newest
 * record on the shelf. A spread let a file claim any age it liked, so an import
 * could arrive already older than everything or newer than everything, and it
 * carried `v` through as well (docs/TODO/54). Only the world and the commander
 * come from the file, because only they are the file's to give.
 *
 * @returns the id it took and the name to tell the player, or a refusal and the
 * line that says why. Nothing is ever overwritten in either case — a false from
 * `writeSave` is a full store, and a full store leaves every save
 * byte-identical.
 */
export function adoptSaveFile(text: string): AdoptedFile {
  let file: SaveFileContents | { why: string };
  try {
    file = readSaveFile(JSON.parse(text));
  } catch {
    return { ok: false, why: NOT_A_SAVE };
  }
  if ('why' in file) return { ok: false, why: file.why };
  const shelf = listSaves();
  const name = uniqueSaveName(file.name, shelf.map((s) => s.record.name));
  const record = makeRecord(name, freshCareerName(name), 'file', file.world, file.commander);
  const id = fileId(name);
  if (!writeSave(id, record)) return { ok: false, why: STORE_FULL };
  return { ok: true, id, name };
}

/**
 * A file has arrived: put it on the shelf and boot into it.
 *
 * It NEVER lands on top of an existing save — see `adoptSaveFile`, which is the
 * whole of that promise. Then the boot pointer moves to it and the page
 * reloads, which is how every load in this file works: a career leaves state
 * across the living galaxy, contracts, chart target and mission progress, and a
 * clean boot is far more trustworthy than zeroing all of it.
 *
 * THE POINTER IS MOVED HERE, beside the reload it authorises, and its refusal
 * is honoured the way `saves.ts` and `new-commander.ts` honour theirs (TODO
 * 44): a reload on a pointer that never landed resumes whatever `bootSave()`
 * falls back to — the career the player was already flying — under an
 * announcement that says they are now flying the file they just imported. The
 * record itself stays on the shelf, unpointed-at and loadable from the file
 * list, because deleting it would be a destructive write on the strength of a
 * write that failed, which is the shape TODO 44 was about.
 *
 * Takes the TEXT rather than the file, so everything a player can observe about
 * an import — which save it becomes, what they are told, and whether the page
 * reloads at all — is reachable without a file picker. `importSaveFile` below
 * is then only the picker, and the picker is the part that cannot be wrong in
 * an interesting way.
 */
export function receiveSaveFile(
  ctx: SavesContext, text: string, onFailure: (why: string) => void,
): void {
  const taken = adoptSaveFile(text);
  if (!taken.ok) { onFailure(taken.why); return; }
  if (!setBootId(taken.id)) {
    onFailure(`IMPORTED AS ${taken.name} — BUT COULD NOT SWITCH TO IT`);
    return;
  }
  ctx.message(`IMPORTED AS ${taken.name}`, 4);
  location.reload(); // boot cleanly from the imported save
}

/** Ask for a file, and hand what comes back to `receiveSaveFile`. */
export function importSaveFile(ctx: SavesContext, onFailure: (why: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(
      (text) => receiveSaveFile(ctx, text, onFailure),
      () => onFailure(NOT_A_SAVE),   // unreadable bytes are not a save either
    );
  };
  input.click();
}
