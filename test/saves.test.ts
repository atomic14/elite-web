// Named saves: the name rules, the key space, the migration, and the way back
// from a death.
//
// This is the enforcement half of docs/TODO/40 and of CLAUDE.md invariant 3.
// Four claims are load-bearing and each is asserted against the REAL storage
// path, driven through a fake `localStorage` (node has none):
//
//   1. An autosave cannot overwrite a save the player named. Not "does not" —
//      CANNOT, because the two live under id shapes a typed name cannot reach.
//   2. Every pre-existing numbered slot survives with its commander AND its
//      world, and the migration is idempotent, recovers from being interrupted,
//      and never removes an old key it has not proved it copied.
//   3. A failed write changes nothing. One save is one key and one `setItem`,
//      so there is no half-written save to recover from.
//   4. A harness cannot address a player's save at all — `test/harness.ts` has
//      already switched this process into the harness namespace, one way.
//
// And the acceptance case the whole item exists for: fly out of a station, die,
// and take the offered save back to exactly the station you left.

import * as THREE from 'three';
import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { seedWorld } from '../src/game/rng.ts';
import { newCommander, type CommanderData } from '../src/game/commander.ts';
import {
  FLIGHT_RING, MAX_SAVE_NAME, commanderOf, describeAge, dockId, fileId, flightId,
  flightIds, normaliseSaveName, parseSaveId, uniqueSaveName,
} from '../src/game/save-file.ts';
import {
  bootSave, clearFlightSaves, harnessSaves, listSaves, makeRecord,
  migrateLegacySaves, namedSaves, readSave, saveNamespace, withoutSaving,
  writeDockSave, writeFlightSave, writeNamedSave, writeSave,
} from '../src/game/storage.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import {
  SavePromptScreen, SavesScreen, type SavesContext,
} from '../src/game/screens/saves.ts';
import type { Input } from '../src/engine/input.ts';
import { type FakeStore, installLocation, installStore } from './save-fixtures.ts';
import { check, eq } from './harness.ts';

/**
 * A world snapshot that is only as real as the storage layer needs.
 *
 * No `career` in it, because a world has none: which career a save belongs to
 * is the RECORD's, and every `makeRecord` call below passes it — see
 * test/career-identity.test.ts.
 */
const stubWorld = (c: CommanderData, mode: 'docked' | 'flight' = 'docked'): WorldSnapshot =>
  ({ version: 1, mode, commander: c } as unknown as WorldSnapshot);

// --- the name rules ----------------------------------------------------------

console.log('\nsave names and the ids they make');
{
  eq('a name is upper case, single-spaced and trimmed',
    normaliseSaveName('  chris   at  lave '), 'CHRIS AT LAVE');
  eq('...with anything outside the alphabet dropped',
    normaliseSaveName('c:h/r\\i*s?'), 'CHRIS');
  eq(`...and cut to ${MAX_SAVE_NAME}`,
    normaliseSaveName('ABCDEFGHIJKLMNOPQRSTUVWXYZ').length, MAX_SAVE_NAME);
  eq('an empty name stays empty, so the prompt can refuse it',
    normaliseSaveName('   %%%   '), '');

  eq('a free name is used as it stands', uniqueSaveName('JAMESON', []), 'JAMESON');
  eq('...and a taken one counts up', uniqueSaveName('JAMESON', ['JAMESON']), 'JAMESON 2');
  eq('...deterministically, which is what makes migration idempotent',
    uniqueSaveName('JAMESON', ['JAMESON', 'JAMESON 2']), 'JAMESON 3');
  check('...and it never grows past the limit',
    uniqueSaveName('ABCDEFGHIJKLMNOP', ['ABCDEFGHIJKLMNOP']).length <= MAX_SAVE_NAME);

  const spaced = 'CHRIS AT LAVE';
  eq('an id encodes a name reversibly', parseSaveId(fileId(spaced))?.name, spaced);
  eq('...and knows a docked checkpoint from a file', parseSaveId(dockId('X'))?.kind, 'dock');
  eq('...and a ring slot from both', parseSaveId(flightId('X', 2))?.index, 2);
  check('a key that is not a save is not read as one',
    parseSaveId('boot') === null && parseSaveId('keymap') === null);

  // THE claim: no typed name can produce an autosave's id. The alphabet has no
  // colon, so a name can never reach past its own segment.
  const attacks = ['X:dock', 'auto:X:dock', 'X%3Adock', '../X', 'X:fly:0'];
  check('no name a player can type collides with an autosave id',
    attacks.every((raw) => {
      const id = fileId(raw);
      return parseSaveId(id)?.kind === 'file'
        && id !== dockId('X') && !flightIds('X').includes(id);
    }));

  eq('when is rounded down, so "just now" cannot lie forward',
    describeAge(59_999), 'JUST NOW');
  eq('...in minutes', describeAge(4 * 60_000 + 30_000), '4 MIN AGO');
  eq('...then hours', describeAge(3 * 3_600_000), '3 HR AGO');
  eq('...then days', describeAge(50 * 3_600_000), '2 DAYS AGO');
}

// --- the shelf ---------------------------------------------------------------

console.log('\nthe save shelf');
{
  const { store, restore } = installStore();
  try {
    const c = { ...newCommander(), credits: 4321 };
    eq('a save round-trips through the real bytes',
      writeSave(fileId('CHRIS'), makeRecord('CHRIS', 'CHRIS', 'file', stubWorld(c)))
        && commanderOf(readSave(fileId('CHRIS'))!)?.credits, 4321);
    check('...and is enumerated', listSaves().length === 1 && namedSaves().length === 1);

    store.held.set('elite-web-harness-keymap', 'modern');
    store.held.set('unrelated', 'x');
    check('a key that is not a save is ignored by the scan', listSaves().length === 1);

    // --- the claim the whole key space exists for --------------------------
    const before = store.held.get(saveNamespace() + fileId('CHRIS'));
    writeDockSave('CHRIS', stubWorld({ ...newCommander(), credits: 1 }));
    for (let i = 0; i < FLIGHT_RING + 2; i++) {
      writeFlightSave('CHRIS', stubWorld({ ...newCommander(), credits: 100 + i }));
    }
    check('an autosave cannot overwrite a save with the same NAME',
      store.held.get(saveNamespace() + fileId('CHRIS')) === before);
    eq('...and the docked checkpoint survives a full ring of them',
      commanderOf(readSave(dockId('CHRIS'))!)?.credits, 1);
    const ring = flightIds('CHRIS').map((id) => readSave(id)).filter(Boolean);
    eq(`the in-flight ring holds exactly ${FLIGHT_RING}`, ring.length, FLIGHT_RING);
    check('...and it kept the newest, evicting the oldest',
      ring.map((r) => commanderOf(r!)!.credits).sort().join() === '102,103,104');

    // --- death drops the ring and leaves the way back ----------------------
    clearFlightSaves('CHRIS');
    check('death drops the ring but not the checkpoint',
      flightIds('CHRIS').every((id) => readSave(id) === null)
      && readSave(dockId('CHRIS')) !== null);
    eq('...and the boot pointer is aimed at the checkpoint, not left dangling',
      bootSave()?.id, dockId('CHRIS'));

    // --- capacity, and a write that fails ----------------------------------
    for (let i = 0; i < 3; i++) {
      writeNamedSave(`FULL ${i}`, 'CHRIS', stubWorld(newCommander()), 4);
    }
    eq('the cap refuses a NEW name once it is reached',
      writeNamedSave('ONE TOO MANY', 'CHRIS', stubWorld(newCommander()), 4), 'full');
    eq('...but replacing an existing name is always allowed',
      writeNamedSave('CHRIS', 'CHRIS', stubWorld({ ...newCommander(), credits: 9 }), 4), 'ok');

    const shelf = new Map(store.held);
    store.failFrom = store.writes + 1;
    eq('a full store refuses the write',
      writeNamedSave('CHRIS', 'CHRIS', stubWorld({ ...newCommander(), credits: 77 }), 9), 'failed');
    check('...and every existing save is byte-identical afterwards',
      [...shelf].every(([k, v]) => store.held.get(k) === v)
      && store.held.size === shelf.size);
    store.failFrom = Infinity;
    eq('...so the save it would have replaced is still the old one',
      commanderOf(readSave(fileId('CHRIS'))!)?.credits, 9);

    check('everything written is in the harness namespace and nothing else',
      harnessSaves()
      && [...store.held.keys()].filter((k) => k.startsWith('elite-web-save')).length === 0);
  } finally {
    restore();
  }
}

// --- migration ---------------------------------------------------------------

console.log('\nmigrating the four numbered slots');
{
  const NS = saveNamespace();
  const legacyCommander = (slot: number): CommanderData => ({
    ...newCommander(), credits: 1000 * slot, kills: slot, day: slot,
  });
  /** A fixture written in the OLD key shape, exactly as a player's store had it. */
  const seedLegacy = (store: FakeStore, world?: unknown, pointer = '2') => {
    for (let slot = 1; slot <= 4; slot++) {
      store.held.set(`${NS}commander:${slot}`, JSON.stringify(legacyCommander(slot)));
    }
    if (world) store.held.set(`${NS}world:2`, JSON.stringify(world));
    store.held.set(`${NS}slot`, pointer);
  };

  // A REAL world snapshot, taken from a real Game, so "the world survives" is a
  // claim about the bytes a player actually has and not about a stub.
  const shell = headlessShell();
  seedWorld(4242);
  const probe = installStore();
  const realWorld = withoutSaving(() => {
    const g = new Game(() => shell);
    g.launch();
    for (let i = 0; i < 60; i++) g.update(1 / 60, i / 60);
    g.state.commander.credits = 2000;   // slot 2's, so the fixture is consistent
    g.state.commander.kills = 2;
    g.state.commander.day = 2;
    return g.captureSnapshot();
  }).value;
  probe.restore();

  {
    const { store, restore } = installStore();
    try {
      seedLegacy(store, realWorld);
      migrateLegacySaves();

      const saves = listSaves();
      eq('every pre-existing slot became a named save', saves.length, 4);
      eq('...disambiguated, because all four are JAMESON',
        saves.map((s) => s.record.name).sort().join(),
        'JAMESON,JAMESON 2,JAMESON 3,JAMESON 4');
      check('...each keeping its own commander',
        [1000, 2000, 3000, 4000].every((credits) =>
          saves.some((s) => commanderOf(s.record)?.credits === credits)));
      const withWorld = saves.find((s) => s.record.world);
      check('...and the slot that had a mid-flight world kept the WORLD too',
        !!withWorld && withWorld.record.world!.mode === 'flight'
        && withWorld.record.world!.npcs.length > 0
        && commanderOf(withWorld.record)?.credits === 2000);
      check('...so a player who never saw this build loses nothing',
        saves.every((s) => !!commanderOf(s.record)));

      eq('the slot that was being played is the one that boots',
        commanderOf(bootSave()!.record)?.credits, 2000);
      check('the old keys are gone — one home for a career, not two',
        ![...store.held.keys()].some((k) => /commander:\d|world:\d|-slot$/.test(k)));

      const idsBefore = saves.map((s) => s.id).sort().join();
      migrateLegacySaves();
      migrateLegacySaves();
      const after = listSaves();
      check('migration is idempotent: twice does not duplicate a save',
        after.length === 4 && after.map((s) => s.id).sort().join() === idsBefore);
    } finally {
      restore();
    }
  }

  // --- interrupted, and resumed -------------------------------------------
  {
    const { store, restore } = installStore();
    try {
      seedLegacy(store);
      // Every write refused: the store is exactly as full as a crash before the
      // first setItem would leave it.
      withoutSaving(() => migrateLegacySaves());
      check('a migration that could not write left every old key where it was',
        [1, 2, 3, 4].every((n) => store.held.has(`${NS}commander:${n}`))
        && listSaves().length === 0);

      // ...and a store that throws mid-way: some slots copied, some not.
      store.failFrom = store.writes + 3;
      migrateLegacySaves();
      store.failFrom = Infinity;
      const half = listSaves().length;
      check(`a half-migrated store keeps the slots it could not copy (${half} copied)`,
        half > 0 && half < 4
        && [1, 2, 3, 4].filter((n) => store.held.has(`${NS}commander:${n}`)).length === 4 - half);

      migrateLegacySaves();
      const done = listSaves();
      eq('...and running again finishes the job', done.length, 4);
      eq('...without duplicating what had already been copied',
        new Set(done.map((s) => s.record.from)).size, 4);
      check('...leaving no old key behind',
        ![...store.held.keys()].some((k) => /commander:\d|world:\d/.test(k)));
    } finally {
      restore();
    }
  }

  // --- a slot whose world is unreadable ------------------------------------
  {
    const { store, restore } = installStore();
    try {
      seedLegacy(store, { version: 999, commander: legacyCommander(2) });
      migrateLegacySaves();
      const two = listSaves().find((s) => s.record.from === 2);
      check('a world from an older format costs the slot its world, never its career',
        !!two && two.record.world === null && commanderOf(two.record)?.credits === 2000);
    } finally {
      restore();
    }
  }

  // --- the pointer that says which slot was being played --------------------
  {
    const { store, restore } = installStore();
    try {
      seedLegacy(store);                  // four slots, and slot 2 is being played
      store.failKeys = /-boot$/;          // ...and the store will not take the new pointer
      migrateLegacySaves();
      store.failKeys = null;
      eq('a refused boot pointer does not stop the slots crossing', listSaves().length, 4);
      eq('...but the old pointer stays until the one replacing it has landed',
        store.held.get(`${NS}slot`), '2');

      migrateLegacySaves();
      eq('...so the next boot still knows which slot was being played',
        commanderOf(bootSave()!.record)?.credits, 2000);
      check('...and only then is it gone', !store.held.has(`${NS}slot`));
    } finally {
      restore();
    }
  }

  // --- the pre-slots key, which is where all of this started ----------------
  {
    const { store, restore } = installStore();
    try {
      const bare = JSON.stringify({ ...newCommander(), credits: 777 });
      store.held.set(`${NS}commander`, bare);

      // A FULL STORE, and this key is the only copy of that commander there is.
      // It used to be read, written nowhere, and then deleted (docs/TODO/44).
      store.failKeys = /commander:1$/;
      migrateLegacySaves();
      store.failKeys = null;
      check('a refused write leaves the pre-slots commander exactly where it was',
        store.held.get(`${NS}commander`) === bare && listSaves().length === 0);

      migrateLegacySaves();
      eq('the pre-slots save still finds its way home',
        listSaves().map((s) => commanderOf(s.record)?.credits).join(), '777');
      check('...and only once it has is the old key gone',
        !store.held.has(`${NS}commander`));
    } finally {
      restore();
    }
  }
}

// --- the acceptance case -----------------------------------------------------

console.log('\nfly out of a station, die, and take the way back');
{
  const { store, restore } = installStore();
  try {
    seedWorld(20_260_802);
    const g = new Game(() => headlessShell());
    const career = g.state.career;
    check('a fresh career is named, and it is not a numbered slot', career.length > 0);

    g.state.commander.credits = 54_321;
    g.state.commander.missiles = 2;
    const home = g.state.commander.systemIndex;
    g.enterDocked();                        // dock: half of the checkpoint
    const docked = readSave(dockId(career));
    check('docking writes the checkpoint', !!docked && docked.world?.mode === 'docked');

    g.launch();                             // ...and again, before leaving
    const atLaunch = readSave(dockId(career))!;
    check('launching writes it again, so it IS the state you left in',
      commanderOf(atLaunch)?.credits === 54_321
      && atLaunch.world?.mode === 'docked'
      && atLaunch.savedAt >= docked!.savedAt);

    // fly, and autosave, and spend something so the checkpoint is demonstrably
    // not just "wherever you are now"
    g.state.session.autoSaveTimer = 0.2;
    for (let i = 0; i < 120; i++) g.update(1 / 60, i / 60);
    g.state.commander.credits = 11;
    check('flying fills the in-flight ring',
      flightIds(career).some((id) => readSave(id) !== null));
    check('...without touching the checkpoint',
      commanderOf(readSave(dockId(career))!)?.credits === 54_321);

    // straight into the planet: deterministic, and it is a real death path
    g.state.player.position.copy(g.state.world.planetPos);
    g.update(1 / 60, 3);
    eq('the ship is destroyed', g.mode, 'dead');
    check('death drops the in-flight ring — dying is not optional if you reload',
      flightIds(career).every((id) => readSave(id) === null));

    const offer = readSave(dockId(career));
    check('...and the docked checkpoint is still there to be offered', !!offer);

    // The death screen offers the commander file, so a screen CAN be open over
    // a dead ship — and opening one writes a checkpoint. It must still know the
    // run is over, or the wreck would be written over the way back.
    const bytes = JSON.stringify(offer);
    g.openSaves();
    for (let i = 0; i < 3; i++) g.update(1 / 60, 4 + i / 60);
    eq('opening the commander file over a wreck writes no checkpoint',
      JSON.stringify(readSave(dockId(career))), bytes);
    g.screens.back();
    eq('...and closing it leaves the game-over panel, not empty space', g.mode, 'dead');

    g.respawn();
    eq('taking it puts the commander back at a station', g.mode, 'docked');
    eq('...at the station they launched from', g.state.commander.systemIndex, home);
    eq('...with what they left with', g.state.commander.credits, 54_321);
    eq('...including the missiles on the rails', g.state.commander.missiles, 2);
    check('...and parked outside the slot, not inside the planet',
      g.state.player.position.distanceTo(new THREE.Vector3()) > 0
      && g.state.player.position.distanceTo(g.state.world.planetPos)
        > g.state.world.planetRadius);

    check('nothing in any of that could have been a player key',
      [...store.held.keys()].every((k) => k.startsWith(saveNamespace())));
  } finally {
    restore();
  }
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
    const ctx = () => ({
      commander,
      systems: [],
      career: 'CHRIS',
      message: (t: string) => { said.push(t); },
      capture: () => stubWorld(commander),
      checkpoint: () => {},
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
    list.open();
    store.failKeys = /-boot$/;
    taps.push('Enter');
    const outcome = list.input(input);
    store.failKeys = null;
    check('a save the store cannot aim the boot at is not loaded, and says so',
      outcome === 'stay' && loc.reloads() === 0 && said.join().includes('STORAGE FULL'));
  } finally {
    loc.restore();
    restore();
  }
}
