// The commander file as a JSON file: what an export contains, and what an
// import becomes.
//
// `src/game/screens/save-transfer.ts` had ZERO test coverage when docs/TODO/43
// shipped through it, and that is not a coincidence: every line of it sat
// behind a file picker, so nothing could reach it. The rule is three
// synchronous functions now — `exportedSaveFile`, `adoptSaveFile`,
// `receiveSaveFile` — with the Blob, the anchor and the picker at the edge, and
// this file holds them to it.
//
// Two claims, and the second is the one that lost careers:
//
//   1. A file NEVER lands on top of something that is already here. Two
//      different sets are consulted, because there are two ways to collide: a
//      NAME collides with `save:file:<NAME>`, and a CAREER collides with
//      `save:auto:<CAREER>:dock` and the whole flight ring. Only the first was
//      checked, and everybody's commander is called JAMESON.
//   2. What the player sees — which save it became, what they were told, and
//      whether the page reloaded — is asserted from the bytes, not from a mock
//      of the module under test.
//
// The other half of TODO 43, career identity itself, is
// test/career-identity.test.ts: this file is the module, that one is the rule.

import { newCommander } from '../src/game/commander.ts';
import {
  MAX_NAMED_SAVES, commanderOf, dockId, fileId,
} from '../src/game/save-file.ts';
import {
  bootSave, listSaves, makeRecord, readSave, saveNamespace, writeDockSave,
  writeNamedSave,
} from '../src/game/storage.ts';
import {
  adoptSaveFile, exportedSaveFile, importSaveFile, receiveSaveFile,
} from '../src/game/screens/save-transfer.ts';
import type { SavesContext } from '../src/game/screens/saves.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import { autoKeys, installLocation, installStore, sameKeys } from './save-fixtures.ts';
import { check, eq } from './harness.ts';

/**
 * The narrowest DOM a file picker needs, so the REAL `importSaveFile` runs.
 *
 * One `createElement` and one `File`, which is the entire platform surface the
 * importer touches. NOTHING HERE IS AWAITED AT MODULE SCOPE, and that is not a
 * style choice: a sibling test file evaluates while an async module is
 * suspended, so a fake `localStorage`, `location` or `document` held across an
 * `await` is installed underneath somebody else's test. It cost a run.
 *
 * @returns the element the importer built, so the caller can see what it asked
 * the browser for, and the promise the picker's own handler is on.
 */
function pickFile(text: string | null, run: () => void): Record<string, unknown> {
  const el: Record<string, unknown> = {
    files: text === null ? [] : [{
      // A thenable that settles SYNCHRONOUSLY. The importer calls `.then(...)`
      // on it rather than awaiting, so the whole picker path — including the
      // failure branch — runs inside this call and nothing is left in flight.
      text: () => ({ then: (ok: (t: string) => void) => { ok(text); } }),
    }],
    click: () => { (el.onchange as () => void)(); },
  };
  const globals = globalThis as unknown as { document?: unknown };
  const had = 'document' in globals;
  const previous = globals.document;
  globals.document = { createElement: () => el };
  try {
    run();
  } finally {
    if (had) globals.document = previous;
    else delete globals.document;
  }
  return el;
}

/** A world snapshot that is only as real as the storage layer needs. */
const stubWorld = (
  commander: ReturnType<typeof newCommander>, extra: Record<string, unknown> = {},
): WorldSnapshot =>
  ({ version: 1, mode: 'docked', commander, ...extra } as unknown as WorldSnapshot);

// --- 1. what name, and what career ------------------------------------------

console.log('\na file from outside takes a name and a career this shelf gives it');
{
  const { store, restore } = installStore();
  try {
    const stranger = makeRecord('JAMESON', 'JAMESON', 'file',
      stubWorld({ ...newCommander(), credits: 1_000 }));

    check('rubbish is not a save', adoptSaveFile('not json at all') === null);
    check('...nor is a JSON object that carries no commander',
      adoptSaveFile(JSON.stringify({ name: 'X', hello: true })) === null);

    // the old export shape: a bare commander, no record around it
    const bare = adoptSaveFile(JSON.stringify({ ...newCommander(), name: 'ZAPHOD', credits: 7 }));
    eq('a pre-record export still imports', bare?.name, 'ZAPHOD');
    eq('...keeping its commander', commanderOf(readSave(bare!.id)!)?.credits, 7);

    // ...and a whole record, onto an empty-ish shelf
    const first = adoptSaveFile(JSON.stringify(stranger));
    eq('a record keeps the name it asks for when nothing is using it',
      first?.name, 'JAMESON');
    eq('...and its career is that name, because no career is using it either',
      readSave(first!.id)?.career, 'JAMESON');
    eq('...and the boot pointer moves to it, which is what makes the reload a load',
      bootSave()?.id, first!.id);

    // NAME collision: a second copy of the same file
    const second = adoptSaveFile(JSON.stringify(stranger));
    eq('a second copy cannot land on the first', second?.name, 'JAMESON 2');
    eq('...and the first is untouched',
      commanderOf(readSave(fileId('JAMESON'))!)?.credits, 1_000);

    // CAREER collision, and it is a DIFFERENT SET from the names — which is the
    // whole reason two sets are consulted. This career's only record is a save
    // the player NAMED, so its career appears in no record's `name` and a check
    // against names alone walks straight past it. The import would then be
    // handed the live career's key to write its checkpoint into.
    eq('a career whose only record is a save it named',
      writeNamedSave('MIDWAY', 'TRILLIAN',
        stubWorld({ ...newCommander(), credits: 500_000 }), MAX_NAMED_SAVES), 'ok');
    check('...really is invisible to the NAME set',
      listSaves().every((s) => s.record.name !== 'TRILLIAN')
      && listSaves().some((s) => s.record.career === 'TRILLIAN'));
    const third = adoptSaveFile(JSON.stringify(
      makeRecord('TRILLIAN', 'TRILLIAN', 'file', stubWorld(newCommander()))));
    eq('a name nothing is using is free to take', third?.name, 'TRILLIAN');
    check('...but the CAREER is not, because a career is using it',
      readSave(third!.id)?.career !== 'TRILLIAN');
    eq('...so it counts up instead', readSave(third!.id)?.career, 'TRILLIAN 2');
    check('...and its checkpoint therefore cannot address the live career\'s',
      dockId(readSave(third!.id)!.career) !== dockId('TRILLIAN'));

    // ...and where a career DOES have autosaves, they do not move
    writeDockSave('ZAPHOD', stubWorld({ ...newCommander(), credits: 500_000, day: 300 }));
    const before = autoKeys('ZAPHOD');
    adoptSaveFile(JSON.stringify(
      makeRecord('ZAPHOD', 'ZAPHOD', 'file', stubWorld(newCommander()))));
    check('an import leaves an existing career\'s autosave keys byte-identical',
      sameKeys(before, autoKeys('ZAPHOD')));

    // ...whatever the file claims. A record can say anything; it is not asked.
    const liar = adoptSaveFile(JSON.stringify(
      { ...makeRecord('HOTBLACK', 'TRILLIAN', 'file', stubWorld(newCommander())) }));
    eq('the career a file claims is discarded, not trusted',
      readSave(liar!.id)?.career, 'HOTBLACK');

    // a full store: refused, and nothing moves
    const shelf = new Map(store.held);
    store.failFrom = store.writes + 1;
    check('a full store refuses the import', adoptSaveFile(JSON.stringify(stranger)) === null);
    check('...and every existing save is byte-identical afterwards',
      store.held.size === shelf.size && [...shelf].every(([k, v]) => store.held.get(k) === v));
    store.failFrom = Infinity;

    check('nothing written could have been a player key',
      [...store.held.keys()].every((k) => k.startsWith(saveNamespace())));
  } finally {
    restore();
  }
}

// --- 2. the picker is wired to that rule ------------------------------------

console.log('\nthe file picker adds nothing to the rule');
{
  const { restore } = installStore();
  const loc = installLocation();
  try {
    const said: string[] = [];
    let failed = 0;
    const ctx = {
      career: 'JAMESON',
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(newCommander()),
    } as unknown as SavesContext;

    // What a player sees, driven with the bytes rather than a picker: which
    // save the file becomes, what they are told, and whether the page reloads.
    const file = JSON.stringify(makeRecord('ARTHUR', 'ARTHUR', 'file',
      stubWorld({ ...newCommander(), credits: 42 })));
    receiveSaveFile(ctx, file, () => { failed += 1; });
    check('a file is written, announced and booted into',
      commanderOf(readSave(fileId('ARTHUR'))!)?.credits === 42
      && said.join() === 'IMPORTED AS ARTHUR'
      && bootSave()?.id === fileId('ARTHUR')
      && loc.reloads() === 1 && failed === 0);

    said.length = 0;
    receiveSaveFile(ctx, '{"nonsense": 1}', () => { failed += 1; });
    check('a file that is not a save fails loudly and reloads nothing',
      failed === 1 && said.length === 0 && loc.reloads() === 1);

    // ...and the picker itself, which is the rest of it: it asks the browser
    // for one JSON file and hands what comes back to the rule above.
    said.length = 0;
    const second = JSON.stringify(makeRecord('ARTHUR', 'ARTHUR', 'file',
      stubWorld({ ...newCommander(), credits: 43 })));
    const el = pickFile(second, () => importSaveFile(ctx, () => { failed += 1; }));
    check('the picker asks for one JSON file',
      el.type === 'file' && el.accept === 'application/json');
    check('...and what comes back goes through the same rule',
      said.join() === 'IMPORTED AS ARTHUR 2'
      && commanderOf(readSave(fileId('ARTHUR 2'))!)?.credits === 43
      && loc.reloads() === 2 && failed === 1);

    said.length = 0;
    pickFile(null, () => importSaveFile(ctx, () => { failed += 1; }));
    check('a cancelled picker does nothing at all',
      failed === 1 && said.length === 0 && loc.reloads() === 2);

    // ...and the export it round-trips with
    writeDockSave('FORD PREFECT', stubWorld({ ...newCommander(), credits: 500_000 }));
    const out = exportedSaveFile({
      ...ctx, career: 'FORD PREFECT',
      capture: () => stubWorld({ ...newCommander(), credits: 99 }),
    } as unknown as SavesContext);
    eq('an export names the file after the career', out.fileName, 'harmless-save-ford-prefect.json');
    eq('...and carries the career it was taken from', JSON.parse(out.json).career, 'FORD PREFECT');
    const back = adoptSaveFile(out.json);
    check('...but importing it back is a NEW career, never the live one',
      readSave(back!.id)?.career !== 'FORD PREFECT');
    check('...whose checkpoint is still 500,000 Cr',
      commanderOf(readSave(dockId('FORD PREFECT'))!)?.credits === 500_000);
  } finally {
    loc.restore();
    restore();
  }
}

