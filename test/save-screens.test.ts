// The screens over the shelf: the save prompt, and the list it sits on top of.
//
// Split from test/saves.test.ts alongside the source split (docs/TODO/55). That
// file is about the key space — what a save is called, where it lands, what a
// failed write does. This one is about what a PLAYER can see and press, which
// is a different claim and one the item is entirely about:
//
//   * opening the commander file writes nothing, so looking is free;
//   * ENTER asks before it costs anything, names what it costs, and backs out;
//   * the sentence it says is the one the code will actually carry out.
//
// The last is the reason `loadCost` is a pure function with its own cases here
// rather than a template inside the renderer: the words are the rule, and a
// rule nothing can assert is a rule nobody has to keep.

import { newCommander, type CommanderData } from '../src/game/commander.ts';
import {
  fileId, loadCost, saveLabel, type LiveRun, type SaveSummary,
} from '../src/game/save-file.ts';
import { makeRecord, writeDockSave, writeSave } from '../src/game/storage.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import { SavesScreen, type SavesContext } from '../src/game/screens/saves.ts';
import { SavePromptScreen } from '../src/game/screens/save-naming.ts';
import type { Input } from '../src/engine/input.ts';
import { installLocation, installStore } from './save-fixtures.ts';
import { check, eq } from './harness.ts';

/** As much of a world as the storage layer looks at — see test/saves.test.ts. */
const stubWorld = (c: CommanderData, mode: 'docked' | 'flight' = 'docked'): WorldSnapshot =>
  ({ version: 1, mode, commander: c } as unknown as WorldSnapshot);

// --- what ENTER says it will do ----------------------------------------------
//
// `ENTER — LOAD` used to say nothing at all, and the act is not symmetrical:
// going back to an earlier save of the commander you are FLYING throws that
// commander's progress away, and loading somebody else's leaves them on the
// shelf exactly as you stand. The screen said neither, and the one it did not
// say is the one that costs a career (docs/TODO/55, finding 6).
//
// These are assertions about the WORDS. That is the point: the acceptance is
// that a reader can say what ENTER will do, so the sentence has to name the run
// being left, and it has to stop naming it when there is no run left to lose.

console.log('\nwhat the commander file says a load will cost');
{
  const row = (over: Partial<SaveSummary>): SaveSummary => ({
    id: 'x', name: 'LAVE RUN', kind: 'file', career: 'CHRIS', savedAt: 0,
    when: '13 HR AGO', place: 'LAVE', where: 'LAVE · DOCKED',
    commanderName: 'CHRIS', credits: 12_345, rating: 'HARMLESS', day: 5, ...over,
  });
  const live: LiveRun = {
    career: 'CHRIS', name: 'CHRIS', place: 'LAVE', credits: 5_000_000,
    rating: 'DEADLY', day: 300, over: false,
  };

  eq('a named save is called what you typed', saveLabel(row({})), 'LAVE RUN');
  eq('...and an autosave is called what it IS, not who it belongs to',
    saveLabel(row({ kind: 'dock' })), 'STATION AUTOSAVE');
  eq('...on both sides of a dock', saveLabel(row({ kind: 'fly' })), 'FLIGHT AUTOSAVE');

  const back = loadCost(row({}), live);
  check('going back over your own run names the run, what it is worth, and the remedy',
    back.grave && back.saveFirst
    && back.note.includes('CHRIS') && back.note.includes('DAY 300')
    && back.note.includes('500000.0 Cr') && back.note.includes('SAVE IT FIRST'));

  const across = loadCost(row({ career: 'BOB', name: 'SHAKEDOWN' }), live);
  check('...and picking somebody else costs nothing, and does not pretend it does',
    !across.grave && !across.saveFirst
    && across.note.includes('BOB') && across.note.includes('CHRIS')
    && !across.note.includes('LOST'));

  const wreck = loadCost(row({}), { ...live, over: true });
  check('...and a warning about losing a run is not shown over a wreck',
    !wreck.grave && !wreck.saveFirst && !wreck.note.includes('LOST')
    && wreck.note.includes('SHIP IS GONE'));
}

// --- the screens -------------------------------------------------------------

console.log('\nthe save prompt, and the list it sits on top of');
{
  const { store, restore } = installStore();
  const loc = installLocation();
  try {
    const taps: string[] = [];
    const input = {
      pressed: (code: string) => {
        const i = taps.indexOf(code);
        if (i < 0) return false;
        taps.splice(i, 1);
        return true;
      },
      drainPresses: () => taps.splice(0, taps.length),
      held: () => false,
    } as unknown as Input;

    const commander = { ...newCommander(), name: 'CHRIS' };
    let saved: string[] = [];
    let said: string[] = [];
    let dead = false;
    let checkpoints = 0;
    const ctx = () => ({
      commander,
      systems: [],
      career: 'CHRIS',
      dead,
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(commander),
      // The REAL write, so a store that refuses it is a refused checkpoint here
      // too — persistence.ts does exactly this, and a stub that always said yes
      // would make the guard below untestable.
      checkpoint: () => {
        checkpoints += 1;
        return !dead && writeDockSave('CHRIS', stubWorld(commander));
      },
      saveNamed: (name: string) => { saved.push(name); return 'ok' as const; },
    });

    const prompt = new SavePromptScreen(ctx as unknown as () => SavesContext);
    prompt.open();
    taps.push('Enter');
    eq('the prompt defaults to the commander name and saves it',
      prompt.input(input) === 'back' ? saved.join() : 'stayed', 'CHRIS');

    // ...and typing REPLACES the default rather than appending to it
    saved = []; said = [];
    prompt.open();
    taps.push('KeyA', 'KeyB');
    prompt.input(input);
    taps.push('Enter');
    prompt.input(input);
    eq('typing replaces the offered default', saved.join(), 'AB');

    // ...and a name that exists asks first (decision 4)
    saved = []; said = [];
    writeSave(fileId('CHRIS'), makeRecord('CHRIS', 'CHRIS', 'file', stubWorld(commander)));
    prompt.open();
    taps.push('Enter');
    check('a name that already exists is not written on the first Enter',
      prompt.input(input) === 'stay' && saved.length === 0);
    taps.push('KeyY');
    check('...and is written once it is confirmed',
      prompt.input(input) === 'back' && saved.join() === 'CHRIS');

    saved = [];
    prompt.open();
    taps.push('Enter');
    prompt.input(input);
    taps.push('Escape');
    check('...or left alone if it is not',
      prompt.input(input) === 'stay' && saved.length === 0);

    // --- and the list, whose Enter is a RELOAD ------------------------------
    //
    // Aiming the boot pointer is the whole of a load, so a refused pointer
    // would reload into the newest save on the shelf instead of the one that
    // was picked — a load nobody asked for, off the back of an unchecked write.
    said = [];
    const list = new SavesScreen(ctx as unknown as () => SavesContext);

    // OPENING IT WRITES NOTHING (docs/TODO/55). It used to push a checkpoint so
    // the list would show the run you were standing in; that run is a line
    // above the table now, read out of state. `test/game.test.ts` holds the
    // same claim for every screen at once, through the real store.
    checkpoints = 0;
    const shelfAtOpen = new Map(store.held);
    list.open();
    check('looking at the commander file writes nothing at all',
      checkpoints === 0
      && store.held.size === shelfAtOpen.size
      && [...shelfAtOpen].every(([k, v]) => store.held.get(k) === v));

    // ...and Enter ASKS before it costs you anything, and can be backed out of
    said = [];
    taps.push('Enter');
    check('the first Enter only asks',
      list.input(input) === 'stay' && loc.reloads() === 0 && checkpoints === 0);
    taps.push('Escape');
    check('...and Escape backs out of the question without leaving the list',
      list.input(input) === 'stay' && loc.reloads() === 0 && checkpoints === 0);

    // ...and the remedy the panel offers is reachable from inside the question
    taps.push('Enter');
    list.input(input);
    taps.push('KeyS');
    eq('S from the question opens the save prompt, and the question survives it',
      JSON.stringify(list.input(input)), JSON.stringify({ open: 'save-name' }));

    store.failKeys = /-boot$/;
    taps.push('Enter');
    const outcome = list.input(input);
    store.failKeys = null;
    check('a save the store cannot aim the boot at is not loaded, and says so',
      outcome === 'stay' && loc.reloads() === 0 && said.join().includes('STORAGE FULL'));

    // The run being left is written before the boot pointer moves, so a store
    // that will not take it must refuse the load rather than lose the run: the
    // panel has just promised the commander stays on the shelf as they stand.
    said = [];
    taps.push('Enter'); list.input(input);
    store.failKeys = /:dock$/;
    taps.push('Enter');
    const refused = list.input(input);
    store.failKeys = null;
    check('a run the store cannot keep is not traded for a load, and says so',
      refused === 'stay' && loc.reloads() === 0
      && said.join().includes('COULD NOT KEEP THIS RUN'));

    // ...and the whole way through, S over a wreck is refused: a dead ship
    // captures as a DOCKED world where it died, so saving one and loading it
    // back is a way to un-die.
    said = [];
    dead = true;
    taps.push('KeyS');
    check('there is nothing left to save once the ship is gone',
      list.input(input) === 'stay' && said.join().includes('NOTHING LEFT TO SAVE'));
    dead = false;

    // Finally the load itself, so nothing above is passing on a stuck screen.
    const before = checkpoints;
    taps.push('Enter'); list.input(input);
    taps.push('Enter');
    check('two Enters load the picked save, keeping the run on the way out',
      list.input(input) === 'stay' && loc.reloads() === 1 && checkpoints === before + 1);
  } finally {
    loc.restore();
    restore();
  }
}
