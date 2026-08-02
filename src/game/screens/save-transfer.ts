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

import { DEFAULT_NAME, type CommanderData } from '../commander.ts';
import { listSaves, makeRecord, setBootId, writeSave } from '../storage.ts';
import { commanderOf, fileId, uniqueSaveName, type SaveRecord } from '../save-file.ts';
import type { SavesContext } from './saves.ts';

/**
 * Write the current career out as a JSON file.
 *
 * A whole SAVE RECORD, name included, rather than a bare commander: an export
 * that lost its name would come back as an untitled blob, and one that lost its
 * world would put you somewhere you had never been. The old shape still
 * imports — see `importSaveFile`.
 */
export function exportSaveFile(ctx: SavesContext): void {
  const record = makeRecord(ctx.career, ctx.career, 'file', ctx.capture());
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `harmless-save-${ctx.career.toLowerCase().replace(/\s+/g, '-')}.json`;
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
 * Load a save from a JSON file.
 *
 * It NEVER lands on top of an existing save: the name is made unique first and
 * the player is told which name it took. Then the boot pointer moves to it and
 * the page reloads, which is how every load in this file works — a career
 * leaves state across the living galaxy, contracts, chart target and mission
 * progress, and a clean boot is far more trustworthy than zeroing all of it.
 */
export function importSaveFile(ctx: SavesContext, onFailure: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = readSaveFile(JSON.parse(await file.text()));
      if (!parsed) throw new Error('not a save file');
      const taken = listSaves().map((s) => s.record.name);
      const name = uniqueSaveName(parsed.name, taken);
      const record: SaveRecord = { ...parsed, name, career: name, kind: 'file' };
      const id = fileId(name);
      // A false is a full store, and a full store leaves every save intact.
      if (!writeSave(id, record)) throw new Error('could not be written');
      setBootId(id);
      ctx.message(`IMPORTED AS ${name}`, 4);
      location.reload(); // boot cleanly from the imported save
    } catch {
      onFailure();
    }
  };
  input.click();
}
