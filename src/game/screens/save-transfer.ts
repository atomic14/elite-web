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
// THE DOM IS AT THE EDGE, and deliberately so. `exportedSaveFile` says what a
// file contains, `adoptSaveFile` says what name and what CAREER it takes on
// this shelf, and `receiveSaveFile` says what the player is told — none of them
// touches a Blob, an anchor, a file picker or `location`, and all three are
// synchronous. That is not tidiness: this file had ZERO test coverage because
// every line of it sat behind a file picker, and docs/TODO/43 is what shipped
// through the hole.

import { DEFAULT_NAME, type CommanderData } from '../commander.ts';
import {
  freshCareerName, listSaves, makeRecord, setBootId, writeSave,
} from '../storage.ts';
import { commanderOf, fileId, uniqueSaveName, type SaveRecord } from '../save-file.ts';
import type { SavesContext } from './saves.ts';

/**
 * The current career, as the bytes of a file and the name to offer them under.
 *
 * A whole SAVE RECORD, name included, rather than a bare commander: an export
 * that lost its name would come back as an untitled blob, and one that lost its
 * world would put you somewhere you had never been. The old shape still
 * imports — see `adoptSaveFile`.
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

/** A file that might be a save. Null when it is not one. */
function readSaveFile(parsed: unknown): SaveRecord | null {
  const rec = parsed as Partial<SaveRecord> & Partial<CommanderData>;
  if (!rec || typeof rec !== 'object') return null;
  // The record shape: a name, and a commander somewhere inside it.
  if (typeof rec.name === 'string' && (rec.world || rec.commander)) {
    const whole = rec as SaveRecord;
    if (commanderOf(whole)) return whole;
  }
  // ...or the old export, which was a bare commander and nothing else.
  if (typeof rec.credits === 'number' && typeof rec.systemIndex === 'number') {
    const c = parsed as CommanderData;
    return makeRecord(c.name || DEFAULT_NAME, c.name || DEFAULT_NAME, 'file', null, c);
  }
  return null;
}

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
 * @returns the id it took and the name to tell the player, or null if the file
 * was not a save or the store would not hold it. Nothing is ever overwritten in
 * either case — a false from `writeSave` is a full store, and a full store
 * leaves every save byte-identical.
 */
export function adoptSaveFile(text: string): { id: string; name: string } | null {
  let parsed: SaveRecord | null = null;
  try {
    parsed = readSaveFile(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed) return null;
  const shelf = listSaves();
  const name = uniqueSaveName(parsed.name, shelf.map((s) => s.record.name));
  const record: SaveRecord = {
    ...parsed, name, career: freshCareerName(name), kind: 'file',
  };
  const id = fileId(name);
  if (!writeSave(id, record)) return null;
  setBootId(id);
  return { id, name };
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
 * Takes the TEXT rather than the file, so everything a player can observe about
 * an import — which save it becomes, what they are told, and whether the page
 * reloads at all — is reachable without a file picker. `importSaveFile` below
 * is then only the picker, and the picker is the part that cannot be wrong in
 * an interesting way.
 */
export function receiveSaveFile(
  ctx: SavesContext, text: string, onFailure: () => void,
): void {
  const taken = adoptSaveFile(text);
  if (!taken) { onFailure(); return; }
  ctx.message(`IMPORTED AS ${taken.name}`, 4);
  location.reload(); // boot cleanly from the imported save
}

/** Ask for a file, and hand what comes back to `receiveSaveFile`. */
export function importSaveFile(ctx: SavesContext, onFailure: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(
      (text) => receiveSaveFile(ctx, text, onFailure),
      () => onFailure(),
    );
  };
  input.click();
}
