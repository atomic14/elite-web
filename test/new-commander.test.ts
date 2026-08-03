// Who a commander IS: the name they are asked for, and what a rename does to it.
//
// This is the enforcement half of docs/TODO/56. Identity used to be GENERATED —
// a fresh run took `freshCareerName()`, which appends a 2 — so the second pilot
// anyone flew was called JAMESON 2, which reads as a second save of JAMESON.
// Two claims replace it and both are asserted here against the real storage
// path, through a fake `localStorage`:
//
//   1. STARTING one asks, and takes the answer. The name typed at the prompt
//      crosses a `location.reload()` in the boot pointer and comes back as the
//      commander AND as the identity their autosaves are keyed by — with no
//      suffix invented for it anywhere. A name already flying is REFUSED, not
//      quietly made unique, because handing back BOB 2 is the same fault the
//      item is about.
//   2. RENAMING one changes what they are CALLED and does not move a save.
//      `CommanderData.name` is today's name; `SaveRecord.career` is who the
//      save belongs to, fixed at creation, because it is half of a storage key
//      and moving it is a five-key write with a half-done state in the middle
//      (docs/TODO/44). The screen says so, and that is asserted too.
//
// The identity's ONE HOME, and the Game-level reproductions of what happens
// when it gets a second, are test/career-identity.test.ts.

import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { seedWorld } from '../src/game/rng.ts';
import { newCommander, type CommanderData } from '../src/game/commander.ts';
import { commanderOf, dockId } from '../src/game/save-file.ts';
import {
  bootCareer, bootCommander, bootSave, listSaves, makeRecord, readSave, writeSave,
} from '../src/game/storage.ts';
import { NewCommanderScreen } from '../src/game/screens/new-commander.ts';
import type { SavesContext } from '../src/game/screens/saves.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import type { Input } from '../src/engine/input.ts';
import { installLocation, installStore } from './save-fixtures.ts';
import { check, eq } from './harness.ts';

/** A keyboard a test can type on: one tap per code, consumed on read. */
function taps(): { keys: string[]; input: Input; type: (s: string) => void } {
  const keys: string[] = [];
  const input = {
    pressed: (code: string) => {
      const i = keys.indexOf(code);
      if (i < 0) return false;
      keys.splice(i, 1);
      return true;
    },
    drainPresses: () => keys.splice(0, keys.length),
    held: () => false,
  } as unknown as Input;
  return {
    keys,
    input,
    type: (s: string) => {
      for (const ch of s) keys.push(ch === ' ' ? 'Space' : `Key${ch}`);
    },
  };
}

const stubWorld = (c: CommanderData): WorldSnapshot =>
  ({ version: 1, mode: 'docked', commander: c } as unknown as WorldSnapshot);

// --- 1. the prompt that names a new commander --------------------------------

console.log('\nstarting a commander asks for a name, and takes the answer');
{
  const { store, restore } = installStore();
  const loc = installLocation();
  try {
    const commander = { ...newCommander(), name: 'JAMESON' };
    const said: string[] = [];
    let checkpoints = 0;
    const ctx = () => ({
      commander,
      systems: [],
      career: 'JAMESON',
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(commander),
      checkpoint: () => { checkpoints += 1; },
      saveNamed: () => 'ok' as const,
    });
    const screen = new NewCommanderScreen(ctx as unknown as () => SavesContext);
    const { input, keys, type } = taps();

    // JAMESON is on the shelf, flying, with a checkpoint of their own.
    writeSave(dockId('JAMESON'),
      makeRecord('JAMESON', 'JAMESON', 'dock', stubWorld(commander)));

    // (a) an empty name is refused, and nothing is put down over it
    screen.open();
    keys.push('Enter');
    check('an unnamed commander is refused, and says why',
      screen.input(input) === 'stay' && loc.reloads() === 0 && checkpoints === 0
      && said.join().includes('A COMMANDER NEEDS A NAME'));

    // (b) a name already flying is refused — NOT made unique
    said.length = 0;
    screen.open();
    type('JAMESON');
    screen.input(input);
    keys.push('Enter');
    const refused = screen.input(input);
    check('a name already flying is refused rather than suffixed',
      refused === 'stay' && loc.reloads() === 0 && checkpoints === 0
      && said.join().includes('JAMESON IS ALREADY FLYING'));
    check('...and nothing on the shelf moved aside to make room for it: the '
      + 'next boot is still the commander who was already flying',
      listSaves().length === 1 && bootSave()?.id === dockId('JAMESON'));

    // (c) a free name is taken: the old commander is put down whole, and the
    //     pointer carries the new one across the reload
    said.length = 0;
    screen.open();
    type('BOWMAN');
    screen.input(input);
    keys.push('Enter');
    check('a free name is taken, and the page is asked to reload into it',
      screen.input(input) === 'stay' && loc.reloads() === 1);
    check('...having written the commander it is putting down first',
      checkpoints === 1);
    eq('...and the next boot resumes no save at all', bootSave(), null);
    const booted = bootCommander();
    eq('...it boots the commander that was NAMED', booted.name, 'BOWMAN');
    eq('...at Lave with 100.0 Cr, which is where a new one starts',
      `${booted.systemIndex}/${booted.credits}`, '7/1000');
    eq('...and their identity is that name, with no suffix invented for it',
      bootCareer(booted), 'BOWMAN');
    check('...while JAMESON is exactly where they were left',
      commanderOf(readSave(dockId('JAMESON'))!)?.name === 'JAMESON');

    // (d) the control: the same predicate, on a store that refuses the pointer.
    //     Without this, a screen that had stopped writing pointers at all would
    //     read as green in (a) and (b) and be caught by nothing.
    said.length = 0;
    const reloads = loc.reloads();
    store.failKeys = /-boot$/;
    screen.open();
    type('KELLY');
    screen.input(input);
    keys.push('Enter');
    const outcome = screen.input(input);
    store.failKeys = null;
    check('a pointer the store refuses is not reloaded on as though it landed',
      outcome === 'back' && loc.reloads() === reloads
      && said.join().includes('STORAGE FULL'));
    eq('...and the pointer still says what it said before the refusal',
      bootCommander().name, 'BOWMAN');
  } finally {
    loc.restore();
    restore();
  }
}

// --- 2. renaming ------------------------------------------------------------
//
// Driven through the real Game and the real screens, because the claim is about
// what the saves screen's R does to the shelf, and a hand-built context would
// be asserting about its own stub.

console.log('\nrenaming a commander changes what they are called, not where they are filed');
{
  const { restore } = installStore();
  const loc = installLocation();
  try {
    seedWorld(20_260_806);
    const g = new Game(() => headlessShell());
    const career = g.state.career;
    g.state.commander.credits = 42_000;
    g.enterDocked();

    let t = 1;
    const step = (): void => { g.update(1 / 60, t); t += 1 / 60; };
    for (let i = 0; i < 150; i++) step();    // let the docking tunnel finish

    const idsBefore = listSaves().map((s) => s.id).sort().join(' ');
    check('the commander being renamed has a checkpoint on the shelf',
      idsBefore.includes(dockId(career)));

    g.openSaves();
    step();
    g.input.injectPress('KeyR');
    step();
    eq('R opens the rename screen', g.mode, 'naming');
    for (const ch of 'BOWMAN') g.input.injectPress(`Key${ch}`);
    step();
    g.input.injectPress('Enter');
    step();

    eq('the commander is called what was typed', g.state.commander.name, 'BOWMAN');
    eq('...and is filed exactly where they were', g.state.career, career);
    check('...so no key was created under the new name',
      readSave(dockId('BOWMAN')) === null);
    eq('...and the shelf holds the same keys it held before the rename',
      listSaves().map((s) => s.id).sort().join(' '), idsBefore);
    check('...with the new name inside the save that was already theirs',
      commanderOf(readSave(dockId(career))!)?.name === 'BOWMAN');
    // The surprising half is the one that has to be said out loud.
    check('...and the player is told which name their saves stay under',
      g.state.session.messageText.includes(`SAVES STAY FILED UNDER ${career}`));
  } finally {
    loc.restore();
    restore();
  }
}
