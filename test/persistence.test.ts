// A restored world IS the world that was saved — through the real orchestrator.
//
// test/snapshot.test.ts proves `serialiseState`/`restoreState` round-trip a
// state object. That is the easy half. The hard half is that `restore()` is not
// declarative: putting a world back means REBUILDING it, and a rebuild spawns
// ships, re-enters witch-space and opens the station menu. Anything that
// rebuild does AFTER a field has been assigned can overwrite it, and no
// assertion about snapshot.ts can see that.
//
// That is precisely how docs/TODO/46 shipped. `restore()` assigned the market
// and the bulletin board out of the snapshot, then entered the docked mode,
// which reached `Station.dock`, which rolled both — so the two fields the
// snapshot's own comment calls the reason "save anywhere" is not an exploit
// were the two fields a save could not keep. test/state.test.ts passed
// throughout, because it greps persistence.ts for the field NAME, and the name
// is on both sides; the value is clobbered four lines later.
//
// So this asserts the property the grep cannot: capture, restore, capture
// again, and demand the two snapshots are the same bytes. Docked AND in flight,
// because docked was the broken one and flight is the control that says the
// harness would have noticed.
//
// The second half of the file is the same claim observed from the place it did
// damage. The combat trainer tears down through this exact path, on a seed the
// PLAYER picks — so entering the room and quitting after a second was a button
// that rerolled the day's work, and the next checkpoint wrote the new board
// down. It lives here rather than in test/combat-sim-career.test.ts for two
// reasons: it is a claim about the restore rather than about the exercise, and
// it needs a whole Game, which cannot be built once test/ui.test.ts has
// installed its partial `document`.
//
// Both halves need a real Game, so both are here. Everything is inside
// `withoutSaving`, and test/harness.ts has already moved the whole process into
// the harness namespace, so no key a player's career lives under is reachable.

import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

console.log('\nthe world comes back as it went in');

const SEED = 20_260_802;

/**
 * Fly a real Game for two seconds and hand back its snapshot round trip.
 *
 * `launch` is the control: docked, the world barely moves, so a docked-only
 * fixture proves much less than it looks — the same trap test/game.test.ts
 * fell into. Both modes run the same 120 steps.
 */
function roundTrip(launch: boolean): { before: Record<string, unknown>;
  after: Record<string, unknown>; differ: string[] } {
  return withoutSaving(() => {
    seedWorld(SEED);
    const g = new Game(() => headlessShell());
    if (launch) g.launch();
    for (let i = 0; i < 120; i++) g.update(1 / 60, i / 60);

    const before = g.captureSnapshot() as unknown as Record<string, unknown>;
    g.restoreSnapshot(structuredClone(before) as never);
    const after = g.captureSnapshot() as unknown as Record<string, unknown>;
    const differ = Object.keys(before)
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    return { before, after, differ };
  }).value;
}

{
  const flight = roundTrip(true);
  check('a snapshot taken in flight restores to itself, field for field',
    flight.differ.length === 0, flight.differ.join(', '));

  const docked = roundTrip(false);
  check('...and so does one taken at a station',
    docked.differ.length === 0, docked.differ.join(', '));

  // The two fields TODO 46 was about, named, so a regression says which rule
  // broke rather than only that something did. Both are `unknown[]` in the
  // snapshot, so a name in the diff list is the whole diagnosis.
  eq('the station\'s prices survive a reload — no reload-to-reroll',
    JSON.stringify(docked.after.market), JSON.stringify(docked.before.market));
  eq('...and so does the work on the bulletin board',
    JSON.stringify(docked.after.contractOffers),
    JSON.stringify(docked.before.contractOffers));

  // Not vacuous: the fixture has to have a market and a board to lose in the
  // first place. A station that stocked nothing would pass every line above.
  check('the docked fixture had a market and a board to lose',
    (docked.before.market as unknown[]).length > 0
    && (docked.before.contractOffers as unknown[]).length > 0);
}

// --- ...and the station you left is the station you come back to -------------
//
// The exploit, and the reason TODO 46 is filed as one rather than as a
// curiosity. The combat trainer's promise is that nothing which happens in it
// leaves it (docs/COMBAT-SIM.md); `teardown` keeps that promise by restoring
// the entry snapshot, which ends at `enterMode('docked')`, which reaches
// `Station.dock`. While every dock rolled, the room handed the station a new
// market and a new bulletin board on its way out — and the SEED is the
// player's, off the setup panel's SEED row, so it was rerollable on demand.
console.log('\nthe combat trainer leaves the station alone');
{
  const excursion = (seed: number) => withoutSaving(() => {
    seedWorld(SEED);
    const g = new Game(() => headlessShell());
    const market = JSON.stringify(g.state.market);
    const board = JSON.stringify(g.state.contractOffers);
    const began = g.startExercise(
      { mode: 'sparring', scenario: 'single-pirate', tier: 1, seed });
    for (let i = 0; i < 60; i++) g.update(1 / 60, i / 60);
    const records = g.endExercise() ?? [];
    return {
      // A real fight that really tore down: it started, it produced a record,
      // it is not still flying, and the sky it spawned is gone.
      ran: began && records.length >= 1
        && g.mode !== 'flight' && g.state.world.npcs.length === 0,
      market, board,
      marketAfter: JSON.stringify(g.state.market),
      boardAfter: JSON.stringify(g.state.contractOffers),
    };
  }).value;

  // Three seeds, because that is how the exploit was measured: three seeds,
  // three different boards. One seed could come back the same by luck.
  for (const seed of [1, 7, 4242]) {
    const x = excursion(seed);
    check(`seed ${seed}: the exercise really ran, and tore itself down`, x.ran);
    check(`seed ${seed}: the station's prices are the ones you docked with`,
      x.marketAfter === x.market, x.marketAfter.slice(0, 80));
    check(`seed ${seed}: ...and so is the work on the board`,
      x.boardAfter === x.board, x.boardAfter.slice(0, 80));
  }
  // Not vacuous: an empty board compares equal to an empty board.
  const one = excursion(1);
  check('the station had a market and a board for the exercise to disturb',
    one.market.length > 2 && one.board.length > 2);
}
