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
// Section 3 is docs/TODO/54 and holds the shelf's own contract from the outside:
// EVERY RECORD ON THE SHELF IS READABLE BY `readSave`. `listSaves()` cannot be
// asked that question — it drops what it cannot read, so a record the shelf
// cannot see is invisible to the very function you would ask — so the bytes are
// the witness, and an import is what writes them.
//
// The other half of TODO 43, career identity itself, is
// test/career-identity.test.ts: this file is the module, that one is the rule.

import { newCommander } from '../src/game/commander.ts';
import {
  SAVE_ID_PREFIX, SAVE_RECORD_VERSION,
  commanderOf, dockId, fileId, parseSaveId,
} from '../src/game/save-file.ts';
import { MAX_NAMED_SAVES } from '../src/constants/saves.ts';
import {
  bootSave, listSaves, makeRecord, readSave, saveNamespace, writeDockSave,
  writeNamedSave,
} from '../src/game/storage.ts';
import {
  adoptSaveFile, exportedSaveFile, importSaveFile, receiveSaveFile,
  type AdoptedFile,
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

/**
 * What an import took, for the assertions that expect one to have worked.
 *
 * A refusal is turned into an id nothing is stored under rather than thrown, so
 * the check that follows FAILS and prints the reason — a throw at module scope
 * would take the whole run down at the first surprise.
 */
const took = (r: AdoptedFile): { id: string; name: string } =>
  (r.ok ? r : { id: `refused: ${r.why}`, name: `refused: ${r.why}` });

/**
 * Every save-shaped key in the store that `readSave` cannot read back.
 *
 * Not `listSaves()`: it silently drops exactly these, which is what let a
 * record be written, pointed at, announced, and then not exist (TODO 54).
 */
const unreadable = (held: Map<string, string>): string[] =>
  [...held.keys()]
    .filter((k) => k.startsWith(saveNamespace() + SAVE_ID_PREFIX))
    .map((k) => k.slice(saveNamespace().length))
    .filter((id) => parseSaveId(id) !== null && readSave(id) === null);

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

    check('rubbish is not a save', adoptSaveFile('not json at all').ok === false);
    check('...nor is a JSON object that carries no commander',
      adoptSaveFile(JSON.stringify({ name: 'X', hello: true })).ok === false);

    // THE OLD EXPORT SHAPE IS NOT A SAVE ANY MORE. A bare commander with no
    // record around it used to import, under the name it was carrying; that
    // tolerance went on 2026-08-04 with the rest of the legacy handling, and
    // this is what a player sees instead. It reuses `NOT_A_SAVE` rather than
    // adding a fourth line, because that is what such a file IS — bytes with no
    // name, no version and no world are not a save file, and the version
    // refusal would be a lie about a shape that carries no `v`.
    const bare = adoptSaveFile(
      JSON.stringify({ ...newCommander(), name: 'ZAPHOD', credits: 7 }));
    check('a pre-record export is no longer a save', bare.ok === false);
    eq('...refused as one of the three lines that already exist',
      bare.ok === false ? bare.why : '', 'IMPORT FAILED — NOT A SAVE FILE');
    check('...and nothing of it reaches the shelf',
      listSaves().every((s) => commanderOf(s.record)?.credits !== 7));

    // ...and a whole record, onto an empty-ish shelf
    const first = took(adoptSaveFile(JSON.stringify(stranger)));
    eq('a record keeps the name it asks for when nothing is using it',
      first.name, 'JAMESON');
    eq('...and its career is that name, because no career is using it either',
      readSave(first.id)?.career, 'JAMESON');

    // NAME collision: a second copy of the same file
    const second = took(adoptSaveFile(JSON.stringify(stranger)));
    eq('a second copy cannot land on the first', second.name, 'JAMESON 2');
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
    const third = took(adoptSaveFile(JSON.stringify(
      makeRecord('TRILLIAN', 'TRILLIAN', 'file', stubWorld(newCommander())))));
    eq('a name nothing is using is free to take', third.name, 'TRILLIAN');
    check('...but the CAREER is not, because a career is using it',
      readSave(third.id)?.career !== 'TRILLIAN');
    eq('...so it counts up instead', readSave(third.id)?.career, 'TRILLIAN 2');
    check('...and its checkpoint therefore cannot address the live career\'s',
      dockId(readSave(third.id)!.career) !== dockId('TRILLIAN'));

    // ...and where a career DOES have autosaves, they do not move
    writeDockSave('ZAPHOD', stubWorld({ ...newCommander(), credits: 500_000, day: 300 }));
    const before = autoKeys('ZAPHOD');
    adoptSaveFile(JSON.stringify(
      makeRecord('ZAPHOD', 'ZAPHOD', 'file', stubWorld(newCommander()))));
    check('an import leaves an existing career\'s autosave keys byte-identical',
      sameKeys(before, autoKeys('ZAPHOD')));

    // ...whatever the file claims. A record can say anything; it is not asked.
    const liar = took(adoptSaveFile(JSON.stringify(
      { ...makeRecord('HOTBLACK', 'TRILLIAN', 'file', stubWorld(newCommander())) })));
    eq('the career a file claims is discarded, not trusted',
      readSave(liar.id)?.career, 'HOTBLACK');

    // a full store: refused, and nothing moves
    const shelf = new Map(store.held);
    store.failFrom = store.writes + 1;
    const full = adoptSaveFile(JSON.stringify(stranger));
    check('a full store refuses the import, and says which refusal it was',
      !full.ok && full.why === 'IMPORT FAILED — STORAGE FULL. NOTHING WAS CHANGED');
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
    const refused: string[] = [];
    const ctx = {
      career: 'JAMESON',
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(newCommander()),
    } as unknown as SavesContext;

    // What a player sees, driven with the bytes rather than a picker: which
    // save the file becomes, what they are told, and whether the page reloads.
    const file = JSON.stringify(makeRecord('ARTHUR', 'ARTHUR', 'file',
      stubWorld({ ...newCommander(), credits: 42 })));
    receiveSaveFile(ctx, file, (why) => { refused.push(why); });
    check('a file is written, announced and booted into',
      commanderOf(readSave(fileId('ARTHUR'))!)?.credits === 42
      && said.join() === 'IMPORTED AS ARTHUR'
      && bootSave()?.id === fileId('ARTHUR')
      && loc.reloads() === 1 && refused.length === 0);

    said.length = 0;
    receiveSaveFile(ctx, '{"nonsense": 1}', (why) => { refused.push(why); });
    check('a file that is not a save fails loudly and reloads nothing',
      refused.length === 1 && said.length === 0 && loc.reloads() === 1);
    eq('...saying which of the refusals it was', refused[0],
      'IMPORT FAILED — NOT A SAVE FILE');

    // ...and the picker itself, which is the rest of it: it asks the browser
    // for one JSON file and hands what comes back to the rule above.
    said.length = 0;
    const second = JSON.stringify(makeRecord('ARTHUR', 'ARTHUR', 'file',
      stubWorld({ ...newCommander(), credits: 43 })));
    const el = pickFile(second, () =>
      importSaveFile(ctx, (why) => { refused.push(why); }));
    check('the picker asks for one JSON file',
      el.type === 'file' && el.accept === 'application/json');
    check('...and what comes back goes through the same rule',
      said.join() === 'IMPORTED AS ARTHUR 2'
      && commanderOf(readSave(fileId('ARTHUR 2'))!)?.credits === 43
      && loc.reloads() === 2 && refused.length === 1);

    said.length = 0;
    pickFile(null, () => importSaveFile(ctx, (why) => { refused.push(why); }));
    check('a cancelled picker does nothing at all',
      refused.length === 1 && said.length === 0 && loc.reloads() === 2);

    // ...and the export it round-trips with
    writeDockSave('FORD PREFECT', stubWorld({ ...newCommander(), credits: 500_000 }));
    const out = exportedSaveFile({
      ...ctx, career: 'FORD PREFECT',
      capture: () => stubWorld({ ...newCommander(), credits: 99 }),
    } as unknown as SavesContext);
    eq('an export names the file after the career', out.fileName, 'harmless-save-ford-prefect.json');
    eq('...and carries the career it was taken from', JSON.parse(out.json).career, 'FORD PREFECT');
    const back = took(adoptSaveFile(out.json));
    check('...but importing it back is a NEW career, never the live one',
      readSave(back.id)?.career !== 'FORD PREFECT');
    check('...whose checkpoint is still 500,000 Cr',
      commanderOf(readSave(dockId('FORD PREFECT'))!)?.credits === 500_000);
  } finally {
    loc.restore();
    restore();
  }
}

// --- 3. an import becomes a record this shelf can read, or it does not happen -

console.log('\nan import either becomes a readable record or is refused out loud');
{
  const { store, restore } = installStore();
  const loc = installLocation();
  try {
    const said: string[] = [];
    const refused: string[] = [];
    const ctx = {
      career: 'JAMESON',
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(newCommander()),
    } as unknown as SavesContext;

    // the career being flown, with the boot pointer aimed at its checkpoint
    writeDockSave('JAMESON', stubWorld({ ...newCommander(), day: 300, credits: 500_000 }));

    // A FILE FROM ANOTHER BUILD. `readSave` refuses a record whose version is
    // not this one's, so writing it would leave bytes no list can show and no
    // delete can reach, under a pointer aimed at nothing (docs/TODO/54).
    const shelf = new Map(store.held);
    const future = JSON.stringify({
      ...makeRecord('BRIAN', 'BRIAN', 'file', stubWorld({ ...newCommander(), credits: 42 })),
      v: SAVE_RECORD_VERSION + 1,
    });
    receiveSaveFile(ctx, future, (why) => { refused.push(why); });
    eq('a save from a version this build cannot read is refused, and says why',
      refused[0], 'IMPORT FAILED — SAVE FROM ANOTHER VERSION');
    check('...nothing is announced and nothing reloads',
      said.length === 0 && loc.reloads() === 0);
    check('...and not one byte is written',
      store.held.size === shelf.size && [...shelf].every(([k, v]) => store.held.get(k) === v));

    // ...and the same file as one this build CAN read.
    const good = JSON.stringify(makeRecord('ZAPHOD', 'ZAPHOD', 'file',
      stubWorld({ ...newCommander(), credits: 42 })));
    receiveSaveFile(ctx, good, (why) => { refused.push(why); });
    const id = fileId('ZAPHOD');
    check('a file this build can read becomes a record it can read BACK',
      readSave(id) !== null && listSaves().some((s) => s.id === id));
    check('...announced, pointed at and reloaded into',
      said.join() === 'IMPORTED AS ZAPHOD'
      && bootSave()?.id === id && loc.reloads() === 1 && refused.length === 1);

    // THE SHELF'S OWN CONTRACT, asked of the bytes rather than of `listSaves()`,
    // which drops exactly what this is looking for.
    eq('every record on the shelf is readable by readSave', unreadable(store.held).join(), '');

    // MINTED, NOT SPREAD. `savedAt` decides which flight-ring slot is evicted
    // and which record a lost pointer falls back to, so it is not a file's to
    // choose — and a spread passed through whatever else came with it.
    const ancient = {
      ...makeRecord('MARVIN', 'MARVIN', 'file', stubWorld(newCommander())),
      savedAt: 1, junk: 'brain the size of a planet',
    };
    const minted = readSave(took(adoptSaveFile(JSON.stringify(ancient))).id)!;
    check('an imported record is stamped when it was imported, not when the file says',
      minted.savedAt > 1);
    check('...and carries nothing else the file was carrying', !('junk' in minted));
    // `v` is not asserted here on purpose: no accepted file can carry another
    // one, so the check could not be made to fail, and a guard that cannot fail
    // is the shape docs/TODO/49 was about. The version is guarded above, where
    // a file that has the wrong one is refused.

    // A REFUSED BOOT POINTER IS NOT RELOADED ON (TODO 44's third call site).
    said.length = 0;
    store.failKeys = /boot$/;   // the record write is fine; the pointer is not
    receiveSaveFile(ctx, JSON.stringify(makeRecord('TRICIA', 'TRICIA', 'file',
      stubWorld({ ...newCommander(), credits: 7 }))), (why) => { refused.push(why); });
    store.failKeys = null;
    // The pointer did not move, so a reload would have landed back on ZAPHOD
    // under an announcement that said TRICIA. That is the whole defect: the
    // reload count and the announcement are what it is asserted by.
    check('a refused boot pointer is not announced and not reloaded on',
      said.length === 0 && loc.reloads() === 1);
    eq('...the player is told what actually happened instead',
      refused[refused.length - 1], 'IMPORTED AS TRICIA — BUT COULD NOT SWITCH TO IT');
    check('...and the record stays on the shelf, not deleted on a write that failed',
      readSave(fileId('TRICIA')) !== null);
  } finally {
    loc.restore();
    restore();
  }
}

