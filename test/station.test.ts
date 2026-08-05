// Docking and launching report platform work in its original order.

import * as THREE from 'three';
import { newCommander } from '../src/game/commander.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import {
  Station, type StationEvent, type StationHost,
} from '../src/game/station.ts';
import { freshState } from '../src/game/state.ts';
import { LAUNCH_STANDOFF, LAUNCH_SPEED } from '../src/constants/station.ts';
import { slotNormal } from '../src/world/slot.ts';
import { random, seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

console.log('\nstation consequences');

function label(e: StationEvent): string {
  if (e.kind === 'sound') return `sound:${e.name}`;
  if (e.kind === 'dockingMusic') return `music:${e.on}`;
  if (e.kind === 'countdown') return `countdown:${e.n}`;
  if (e.kind === 'message') return `message:${e.text}`;
  if (e.kind === 'persistence') return `persistence:${e.action}`;
  if (e.action === 'screen') return `presentation:screen:${e.screen}`;
  if (e.action === 'tunnel') return `presentation:tunnel:${e.way}`;
  return `presentation:${e.action}`;
}

function setup() {
  const state = freshState(newCommander());
  state.world.build(state.systems[state.commander.systemIndex]);
  let mode: 'docked' | 'flight' | 'dead' = 'flight';
  let populated = 0;
  let checkpoints = 0;
  const host: StationHost = {
    baseMode: () => mode,
    setBaseMode: (next) => { mode = next; },
    lookAlong: (dir) => {
      // The real host turns the player. This keeps the rule test headless while
      // proving the synchronous state operation still happens.
      state.player.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.normalize());
    },
    populateSystem: () => { populated += 1; },
    checkpoint: () => { checkpoints += 1; },
    settleContracts: () => [
      { kind: 'sound', name: 'contractPaid' },
      { kind: 'message', text: 'CONTRACT SETTLED', seconds: 4 },
    ],
    resetContractSelection: () => {},
  };
  return {
    state,
    station: new Station(state, new Ordnance(state.world), host),
    mode: () => mode,
    populated: () => populated,
    checkpoints: () => checkpoints,
  };
}

{
  const x = setup();
  seedWorld(190_019);
  const events = x.station.dock();
  eq('dock reports platform consequences in their former applied order',
    events.map(label).join('|'), [
      'music:false',
      'persistence:forgetFlight',
      'presentation:releaseMouseFlight',
      'sound:contractPaid',
      'persistence:checkpoint',
      'music:false',
      'sound:dock',
      'sound:tunnel',
      'presentation:tunnel:in',
      'presentation:screen:docked',
      'message:CONTRACT SETTLED',
    ].join('|'));
  check('dock still changes the core mode synchronously', x.mode() === 'docked');
  // A fixture over the next value catches moving any mission, market or offer
  // draw across a branch: every later seeded outcome would otherwise move too.
  eq('dock preserves the seeded draw position', random().toFixed(12), '0.643952403218');
}

{
  const x = setup();
  const events = x.station.launch();
  eq('launch reports screen, sounds and tunnel in their former order',
    events.map(label).join('|'), [
      'presentation:screen:hidden',
      'sound:launch',
      'sound:tunnel',
      'presentation:tunnel:out',
      `message:LEAVING ${x.state.systems[x.state.commander.systemIndex].name.toUpperCase()} STATION`,
    ].join('|'));
  check('launch population remains a synchronous seeded host operation',
    x.populated() === 1 && x.mode() === 'flight');
  // Where the bay puts you — constants/station.ts, measured off the real slot
  // normal rather than restated. 450 and 120, and the trio it belongs to
  // (bounce 420, backdrop 900) is pinned in docking.test.ts and world.test.ts.
  const away = x.state.player.position.clone().sub(x.state.world.station.position);
  check(`launch stands you LAUNCH_STANDOFF off the slot (${away.length().toFixed(3)})`,
    Math.abs(away.length() - LAUNCH_STANDOFF) < 1e-6);
  check('...straight out along the slot normal',
    away.normalize().dot(slotNormal(x.state.world.station)) > 0.999999);
  check(`...moving at LAUNCH_SPEED (${x.state.player.speed})`,
    x.state.player.speed === LAUNCH_SPEED);
  // Decision 1: the docked checkpoint is written on docking AND immediately
  // before launch, and the second one is a CALL rather than an event precisely
  // so that it observes the station rather than the first second of the flight.
  check('launch writes the docked checkpoint before it moves the ship',
    x.checkpoints() === 1);
}

{
  const x = setup();
  x.station.dock('fresh');
  eq('the docked base screen is a presentation outcome',
    x.station.showBaseScreen().map(label).join('|'), 'presentation:screen:docked');

  // docs/TODO/43. A BOOT HAS NOT DOCKED — nothing arrived, which is why none of
  // the theatre plays — and the world it is holding CAME OFF THE SHELF. Writing
  // it back put the save just loaded over `save:auto:<career>:dock`, so picking
  // a day-5 file out of the commander file destroyed the day-300 checkpoint the
  // screen had written to protect it, on one Enter with no confirmation.
  //
  // BOTH load paths, because 43's argument is about arriving and neither of
  // them did: a boot with nothing to resume, and a world put back from a
  // snapshot (docs/TODO/46 split them apart for a different reason).
  for (const arrival of ['fresh', 'resumed'] as const) {
    const kinds = setup().station.dock(arrival).map(label);
    check(`a ${arrival} dock writes no checkpoint — nothing arrived (${kinds.join('|')})`,
      !kinds.includes('persistence:checkpoint'));
    check('...nor drops the in-flight ring, for the same reason',
      !kinds.includes('persistence:forgetFlight'));
  }
  // ...and the check is not vacuous: a real arrival still writes both.
  const real = setup().station.dock().map(label);
  check('...while a real arrival still writes both',
    real.includes('persistence:checkpoint') && real.includes('persistence:forgetFlight'));
}

// --- docs/TODO/46: a restore beats the dock that follows it -----------------
//
// `Persistence.restore` assigns the market and the bulletin board out of the
// snapshot and THEN enters the docked mode, which reaches this method. While
// every dock rolled, the roll landed on top of the restore — so a reload
// rerolled prices and work until you liked them, and the combat trainer, which
// tears down through the same path on a seed the player picks, turned that into
// a reroll button. `DockArrival` is the fact the restore has and the dock did
// not.
{
  const stocked = () => {
    const x = setup();
    seedWorld(4_601);
    x.station.dock();               // arrive once, so there is a board to keep
    return x;
  };

  const x = stocked();
  const market = JSON.stringify(x.state.market);
  const board = JSON.stringify(x.state.contractOffers);
  check('the fixture has something to lose', market.length > 2 && board.length > 2);

  x.station.dock('resumed');
  eq('a resumed dock leaves the market the restore just put back',
    JSON.stringify(x.state.market), market);
  eq('...and the bulletin board with it', JSON.stringify(x.state.contractOffers), board);

  // Not vacuous in the direction that matters: arriving is still a new day at
  // a new station, and it still rolls.
  const y = stocked();
  y.station.dock();
  check('...while actually arriving still rolls a fresh board',
    JSON.stringify(y.state.contractOffers) !== board
    && JSON.stringify(y.state.market) !== market);

  // And a boot with nothing to resume is the third case: `freshState` leaves
  // both EMPTY, so a station that did not stock them would open on nothing.
  const z = setup();
  eq('a fresh state starts with no market at all', z.state.market.length, 0);
  seedWorld(4_601);
  z.station.dock('fresh');
  check('a fresh boot stocks the station it has no snapshot for',
    z.state.market.length > 0 && z.state.contractOffers.length > 0);
}

// The draw fixture above covers an arrival. A `fresh` dock makes the same four
// draws in the same order — it is the same code path — and a `resumed` one
// makes two fewer, which is safe ONLY because `Persistence.restore` assigns
// `snap.rng` on the line after the one that gets here. Pin both readings, so
// that moving a draw across the new branch is a failing test rather than a
// silently different galaxy.
{
  const x = setup();
  seedWorld(190_019);
  x.station.dock('fresh');
  eq('a fresh dock draws exactly what an arrival draws',
    random().toFixed(12), '0.643952403218');

  const y = setup();
  seedWorld(190_019);
  y.station.dock('resumed');
  const resumed = random().toFixed(12);
  check('a resumed dock skips the two rolls it would have overwritten',
    resumed !== '0.643952403218', resumed);
}
