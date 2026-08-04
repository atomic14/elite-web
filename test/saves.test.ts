// Named saves: the name rules, the key space, and the way back from a death.
//
// This is the enforcement half of docs/TODO/40 and of docs/INVARIANTS.md invariant 3.
// Three claims are load-bearing and each is asserted against the REAL storage
// path, driven through a fake `localStorage` (node has none):
//
//   1. An autosave cannot overwrite a save the player named. Not "does not" —
//      CANNOT, because the two live under id shapes a typed name cannot reach.
//   2. A failed write changes nothing. One save is one key and one `setItem`,
//      so there is no half-written save to recover from.
//   3. A harness cannot address a player's save at all — `test/harness.ts` has
//      already switched this process into the harness namespace, one way.
//
// And the acceptance case the whole item exists for: fly out of a station, die,
// and take the offered save back to exactly the station you left.
//
// There was a fourth, about migrating the four numbered slots. The migration is
// gone (docs/TODO/53) and so are its cases: nothing reads an old key, so there
// is nothing left to assert about one that could fail.

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
  bootCommander, bootSave, clearFlightSaves, harnessSaves, listSaves, makeRecord,
  namedSaves, readSave, saveNamespace,
  writeDockSave, writeFlightSave, writeNamedSave, writeSave,
} from '../src/game/storage.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import { installStore } from './save-fixtures.ts';
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
  eq('...deterministically, which is what makes re-importing a file idempotent',
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

// --- a store from before named saves -----------------------------------------
//
// There is no migration off the four numbered slots (docs/TODO/53), so this is
// what one of those stores is worth now: nothing, and it costs nothing to say
// so. The first save record below is BYTE-PERFECT — it would load — and the
// only reason it is not on the shelf is the shape of the key it is under.
//
// Both halves matter. A boot that read those keys fails the first three checks;
// a boot that tidied them away fails the fourth, and tidying is a destructive
// write with no read-back to prove itself, which is the shape docs/TODO/44 is
// about. Reintroducing `migrateLegacySaves` fails this block, which is the
// point of keeping it.

console.log('\na store holding nothing but the keys of the old scheme');
{
  const { store, restore } = installStore();
  try {
    const NS = saveNamespace();
    const legacy = new Map<string, string>([
      [`${NS}commander:1`, JSON.stringify(makeRecord('JAMESON', 'JAMESON', 'file',
        stubWorld({ ...newCommander(), credits: 987 })))],
      [`${NS}world:1`, '{"version":1,"mode":"flight"}'],
      [`${NS}commander`, JSON.stringify({ ...newCommander(), credits: 987 })],
      [`${NS}slot`, '1'],
    ]);
    for (const [k, v] of legacy) store.held.set(k, v);

    eq('none of it is a save', listSaves().length, 0);
    eq('...so there is nothing for the next boot to resume', bootSave(), null);
    eq('...and the commander that boots is a fresh one, not the slot\'s',
      bootCommander().credits, newCommander().credits);
    check('...and every old key is exactly as it was: a boot neither reads nor tidies',
      store.held.size === legacy.size
      && [...legacy].every(([k, v]) => store.held.get(k) === v));
  } finally {
    restore();
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
    check('a fresh career has a name of its own', career.length > 0);

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
    // a dead ship — and the way back is a save it is showing you. Opening one
    // writes nothing at all now (docs/TODO/55, and test/game.test.ts holds that
    // for every screen); this is the same claim against the REAL bytes, on the
    // one path where the write would have landed on the way back itself.
    const bytes = JSON.stringify(offer);
    g.openSaves();
    for (let i = 0; i < 3; i++) g.update(1 / 60, 4 + i / 60);
    eq('opening the commander file over a wreck leaves the way back untouched',
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
