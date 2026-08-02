// Docking and launching report platform work in its original order.

import * as THREE from 'three';
import { newCommander } from '../src/game/commander.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import {
  Station, type StationEvent, type StationHost,
} from '../src/game/station.ts';
import { freshState } from '../src/game/state.ts';
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
  // Decision 1: the docked checkpoint is written on docking AND immediately
  // before launch, and the second one is a CALL rather than an event precisely
  // so that it observes the station rather than the first second of the flight.
  check('launch writes the docked checkpoint before it moves the ship',
    x.checkpoints() === 1);
}

{
  const x = setup();
  const events = x.station.dock(true);
  eq('the docked base screen is a presentation outcome',
    x.station.showBaseScreen().map(label).join('|'), 'presentation:screen:docked');

  // docs/TODO/43. A BOOT HAS NOT DOCKED — nothing arrived, which is why none of
  // the theatre plays — and the world it is holding CAME OFF THE SHELF. Writing
  // it back put the save just loaded over `save:auto:<career>:dock`, so picking
  // a day-5 file out of the commander file destroyed the day-300 checkpoint the
  // screen had written to protect it, on one Enter with no confirmation.
  const kinds = events.map(label);
  check(`a boot writes no checkpoint — nothing arrived (${kinds.join('|')})`,
    !kinds.includes('persistence:checkpoint'));
  check('...nor drops the in-flight ring, for the same reason',
    !kinds.includes('persistence:forgetFlight'));
  // ...and the check is not vacuous: a real arrival still writes both.
  const real = setup().station.dock().map(label);
  check('...while a real arrival still writes both',
    real.includes('persistence:checkpoint') && real.includes('persistence:forgetFlight'));
}
