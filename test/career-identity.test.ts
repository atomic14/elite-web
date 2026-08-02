// Which career a session's automatic writes belong to — the one question
// `save:auto:<CAREER>:dock` and the flight ring are keyed by.
//
// This is the enforcement half of docs/TODO/43, which two reviewers found
// independently and which destroyed player data with no confirmation and no way
// back. It had TWO HOMES: `SaveRecord.career`, read at boot by `bootCareer()`,
// and `WorldSnapshot.career`, assigned over it by `restore()` one step later.
// The record is the home now — it is what the keys are built from — the
// snapshot carries none, and `state.career` is a read of the record with one
// writer.
//
// Four things are asserted, and the first two are the reproductions from the
// item, driven through the real `Game`:
//
//   1. IMPORTING A FILE. The importer goes to trouble to give the record a
//      career nothing else is using; `restore()` then took the career the file
//      was EXPORTED under. Everybody's is JAMESON, so a stranger's file landed
//      on your autosave group and your checkpoint became their day 0.
//   2. LOADING A NAMED SAVE. The commander file writes the career you are
//      leaving before it leaves (saves.ts) — and the boot's own `Station.dock`
//      wrote the save you had just loaded straight back over it. A day-300
//      career, one Enter, no confirmation, gone.
//   3. STARTING A NEW ONE, which is the THIRD way a career comes into
//      existence and the only one a player can ask for (docs/TODO/45). It
//      cleared the boot pointer, and a cleared pointer means "lost", which
//      `bootSave` answers with the newest record on the shelf — so NEW
//      COMMANDER resumed the career it had just promised to put down, name
//      included, and went on autosaving into the same keys.
//   4. ONE HOME, held by a source scan. A scan is blunt, so each one is paired
//      with a proof that it can still fail — the idiom is
//      test/damage-paths.test.ts:22, and docs/TODO/49 is the catalogue of what
//      happens without it.
//
// The module the file half of this goes through is test/save-transfer.test.ts.

import { readFileSync, readdirSync } from 'node:fs';

import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { seedWorld } from '../src/game/rng.ts';
import { DEFAULT_NAME, newCommander } from '../src/game/commander.ts';
import { MAX_NAMED_SAVES, commanderOf, dockId, fileId } from '../src/game/save-file.ts';
import {
  bootSave, listSaves, makeRecord, readSave, writeNamedSave,
} from '../src/game/storage.ts';
import { importSaveFile } from '../src/game/screens/save-transfer.ts';
import type { SavesContext } from '../src/game/screens/saves.ts';
import { autoKeys, installLocation, installStore, sameKeys } from './save-fixtures.ts';
import { check, eq } from './harness.ts';

/**
 * The narrowest DOM a file picker needs, so the REAL `importSaveFile` runs.
 *
 * NOTHING IS AWAITED AT MODULE SCOPE, and that is not a style choice: a sibling
 * test file evaluates while an async module is suspended, so a fake
 * `localStorage`, `location` or `document` held across an `await` is installed
 * underneath somebody else's test. It cost a run. The stand-in file's `text()`
 * is a thenable that settles synchronously, which the importer is happy with
 * because it calls `.then(...)` rather than awaiting.
 */
function pickFile(text: string, run: () => void): void {
  const el: Record<string, unknown> = {
    files: [{ text: () => ({ then: (ok: (t: string) => void) => { ok(text); } }) }],
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
}

// --- 1. importing a stranger's file -----------------------------------------

console.log('\nimporting a file cannot reach a career that already exists');
{
  const { restore } = installStore();
  const loc = installLocation();
  try {
    seedWorld(20_260_803);
    const mine = new Game(() => headlessShell());
    const career = mine.state.career;
    mine.state.commander.credits = 500_000;
    mine.state.commander.day = 300;
    mine.enterDocked();
    const before = autoKeys(career);
    check('a career worth losing, with a checkpoint on the shelf',
      commanderOf(readSave(dockId(career))!)?.credits === 500_000);

    // A stranger's export, as hostile as one can be: their commander is called
    // JAMESON too, so their record's career IS mine, and the world inside it
    // carries the pre-TODO-43 `career` key as well.
    const theirs = mine.captureSnapshot();
    theirs.commander = { ...newCommander(), credits: 1_000, day: 0 };
    (theirs as unknown as Record<string, unknown>).career = career;
    const file = JSON.stringify(makeRecord(career, career, 'file', theirs));

    const ctx = {
      commander: mine.state.commander, systems: mine.state.systems, career,
      message: () => {}, capture: () => mine.captureSnapshot(),
      checkpoint: () => {}, saveNamed: () => 'ok' as const,
    } as unknown as SavesContext;
    pickFile(file, () => importSaveFile(ctx, () => {}));
    check('the import was taken', loc.reloads() === 1);

    // ...and the page reloads into it
    seedWorld(20_260_803);
    const after = new Game(() => headlessShell());
    check('the imported session is flying the imported commander',
      after.state.commander.credits === 1_000);
    check('...on a career of its own, not the one that was already here',
      after.state.career !== career && after.state.career.length > 0);
    // one dock, which is what any imported career does the moment it arrives
    after.enterDocked();
    check('...so my autosave keys are byte-identical after it has flown',
      sameKeys(before, autoKeys(career)));
    check('...and its own checkpoint went where it belongs',
      commanderOf(readSave(dockId(after.state.career))!)?.credits === 1_000);
  } finally {
    loc.restore();
    restore();
  }
}

// --- 2. loading a named save ------------------------------------------------

console.log('\nloading a named save leaves the checkpoint it came from');
{
  const { restore } = installStore();
  const loc = installLocation();
  try {
    seedWorld(20_260_804);
    const g = new Game(() => headlessShell());
    const career = g.state.career;

    // day 5, saved under a name
    g.state.commander.credits = 1_000;
    g.state.commander.day = 5;
    g.enterDocked();
    eq('the day-5 save is written',
      writeNamedSave('OLD', career, g.captureSnapshot(), MAX_NAMED_SAVES), 'ok');

    // ...and the career flown on to day 300
    g.state.commander.credits = 500_000;
    g.state.commander.day = 300;
    g.enterDocked();
    check('the checkpoint is the day-300 one',
      commanderOf(readSave(dockId(career))!)?.day === 300);

    // the player picks OLD in the commander file and presses Enter
    let t = 1;
    const step = (): void => { g.update(1 / 60, t); t += 1 / 60; };
    for (let i = 0; i < 150; i++) step();   // let the docking tunnel finish
    g.openSaves();
    step();
    eq('the commander file is open', g.mode, 'saves');
    g.input.injectPress('Enter');
    step();
    eq('...and Enter aims the next boot at the save that was picked',
      bootSave()?.id, fileId('OLD'));
    check('...having asked for a reload', loc.reloads() === 1);

    // The screen writes the career it is leaving before it leaves (saves.ts),
    // and THAT is the state the load must not eat. It was eaten: the boot's own
    // dock landed on the same key one step later.
    const guarded = autoKeys(career);
    eq('the screen protected the day-300 run on its way out',
      commanderOf(readSave(dockId(career))!)?.credits, 500_000);

    // ...and the page reloads
    seedWorld(20_260_804);
    const back = new Game(() => headlessShell());
    eq('the reload is at day 5, which is what was asked for',
      back.state.commander.day, 5);
    eq('...on the career the save belongs to, which is where its autosaves go',
      back.state.career, career);
    check('...and EVERY autosave key of that career is byte-identical to the '
      + 'moment before the load', sameKeys(guarded, autoKeys(career)));
    eq('...so the day-300 run is still on the shelf, and still the way back',
      commanderOf(readSave(dockId(career))!)?.credits, 500_000);
  } finally {
    loc.restore();
    restore();
  }
}

// --- 3. starting a new commander --------------------------------------------

console.log('\nNEW COMMANDER starts a career, and puts the old one down whole');
{
  const { store, restore } = installStore();
  const loc = installLocation();
  try {
    seedWorld(20_260_805);
    const g = new Game(() => headlessShell());
    const career = g.state.career;
    g.state.commander.name = 'CHRIS';
    g.state.commander.credits = 999_999;
    g.state.commander.kills = 42;
    g.enterDocked();
    eq('a career worth keeping, with a save of its own on the shelf',
      writeNamedSave('KEEP ME', career, g.captureSnapshot(), MAX_NAMED_SAVES), 'ok');

    g.newCommanderGame();
    check('the page reloads, which is how every load in the commander file works',
      loc.reloads() === 1);
    // ...and this is the state the panel promises stays where it is: the career
    // being set aside checkpoints on its way out, so the shelf holds the run
    // exactly as it was left.
    const before = autoKeys(career);
    const kept = JSON.stringify(readSave(fileId('KEEP ME')));
    eq('...having written the career it is putting down',
      commanderOf(readSave(dockId(career))!)?.credits, 999_999);

    seedWorld(20_260_805);
    const fresh = new Game(() => headlessShell());
    const c = fresh.state.commander;
    check('the reload is a NEW COMMANDER: Lave, 100.0 Cr, no kills, no name of yours',
      c.credits === 1_000 && c.kills === 0 && c.systemIndex === 7
      && c.name === DEFAULT_NAME);
    check('...on a career no save on the shelf is using',
      fresh.state.career !== career
      && listSaves().every((s) => s.record.career !== fresh.state.career));

    fresh.enterDocked();
    check('...so once it has docked, every autosave key of the old career is '
      + 'byte-identical', sameKeys(before, autoKeys(career)));
    eq('...and the save that was named is untouched',
      JSON.stringify(readSave(fileId('KEEP ME'))), kept);
    check('...while the new career has a checkpoint of its own',
      commanderOf(readSave(dockId(fresh.state.career))!)?.credits === 1_000);

    // A store that will not take the pointer has not put anything down, and
    // reloading anyway would drop the player back into the career they were
    // just promised they were leaving.
    store.failKeys = /-boot$/;
    const reloads = loc.reloads();
    fresh.newCommanderGame();
    store.failKeys = null;
    check('a pointer the store refuses is not reloaded on as though it had landed',
      loc.reloads() === reloads
      && bootSave()?.record.career === fresh.state.career);
    check('...and the player is told, rather than left with the panel\'s promise',
      fresh.state.session.messageText.includes('STORAGE FULL'));
  } finally {
    loc.restore();
    restore();
  }
}

// --- 4. one home ------------------------------------------------------------

// The idiom is test/npc.test.ts:285 — a value that had two homes, banned by
// name from the file that must not restate it. Here it is a FIELD: which career
// a session's automatic writes address. `SaveRecord.career` is the home, because
// the record is what `save:auto:<CAREER>:*` is keyed by; `GameState.career` is
// `bootCareer()`'s read of it and has exactly one writer; and `WorldSnapshot`
// has no opinion at all. It used to, and the assignment in `restore()` beat the
// record by one step.

console.log('\ncareer identity has one home');
{
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  /** Source with every comment gone: the prose here names what it deleted. */
  const code = (url: URL): string => readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const files = walk(new URL('../src/', import.meta.url));
  const short = (u: URL): string => u.pathname.slice(u.pathname.indexOf('/src/') + 5);

  // (a) THE HOME IS THE RECORD, and the keys really are built from it.
  const saveFile = code(new URL('../src/game/save-file.ts', import.meta.url));
  check('save-file.ts declares the career a record belongs to',
    /interface SaveRecord[\s\S]*?\bcareer: string;/.test(saveFile));
  check('...and every autosave id is built from that career, not from a name',
    /export function dockId\(career: string\)/.test(saveFile)
    && /export function flightId\(career: string/.test(saveFile));

  // (b) THE SNAPSHOT HAS NO OPINION. A world is a place and a moment.
  const snapshot = code(new URL('../src/game/snapshot.ts', import.meta.url));
  check('snapshot.ts declares no career of its own', !/\bcareer\b/.test(snapshot));
  check('...and the scan is looking at a real file, not an empty string',
    snapshot.length > 2_000 && /interface WorldSnapshot \{/.test(snapshot));
  // ...and it would see one. The exact line this replaced, as it was written.
  check('...and would catch the field coming back',
    /\bcareer\b/.test('  career?: string;'));

  // (c) ONE WRITER. A PROPERTY assignment, deliberately: `const career = ...`
  //     inside a render function is a local, not a home, and a scan that
  //     flagged it would be turned off within a week.
  const ASSIGN = /[\w.$]+\.career\s*=(?!=)/g;
  //     The combat trainer's `this.career` is the COMMANDER an exercise
  //     borrowed the cockpit from — the same word, a different thing, and not a
  //     career name at all. Exempt by DECLARATION rather than by filename, so
  //     the exemption stops applying the moment it stops being that type.
  const combatSim = code(new URL('../src/game/combat-sim.ts', import.meta.url));
  check('the combat trainer\'s `career` is a commander, not a career name',
    /private career: CommanderData \| null/.test(combatSim));
  const writers: string[] = [];
  let assignments = 0;
  for (const url of files) {
    for (const m of code(url).matchAll(ASSIGN)) {
      assignments += 1;
      const line = m[0].trim();
      if (short(url) === 'game/game.ts' && line === 'this.state.career =') continue;
      if (short(url) === 'game/combat-sim.ts' && line === 'this.career =') continue;
      writers.push(`${short(url)}: ${line}`);
    }
  }
  check('nothing assigns a career but the boot that reads it off the record',
    writers.length === 0, writers.join(' · '));
  check(`...and the scan found the ones it allows, and no more (${assignments})`,
    assignments === 3);
  // ...and it would still catch the line that caused this, verbatim.
  check('...and the deleted assignment would still be caught',
    new RegExp(ASSIGN.source).test('    if (snap.career) s.career = snap.career;'));

  // (d) THE READ SIDE. `restore()` must not go looking for one either.
  const persistence = code(new URL('../src/game/persistence.ts', import.meta.url));
  check('persistence.ts never reads a career off a snapshot',
    !/snap\.career/.test(persistence));
  check('...while still writing every save through the session\'s one',
    /this\.career/.test(persistence) && /return this\.state\.career;/.test(persistence));
}
