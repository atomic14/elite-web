// The scripted combat computer: the pirates' attack run flying YOUR ship.
//
// Added 2026-08-05, after the third trained-defence wall in a row (runs
// 20-21: turret, sprayer, pacifist — docs/TRAINING-LOG.md). What these blocks
// pin is the co-pilot's own contract: it decides and reports (the Game slews
// and shoots), its trigger is the player gun's real cone, its E.C.M. answers
// only a warhead that exists, and the run it flies actually CYCLES — close,
// pass, extend — rather than orbiting one phase forever.

import * as THREE from 'three';
import { ScriptedCoPilot } from '../src/game/scripted-co-pilot.ts';
import { steerQuatToward, approach } from '../src/game/npc.ts';
import { hitCone } from '../src/game/gunnery.ts';
import { LASER_RANGE } from '../src/constants/player-gun.ts';
import { PLAYER_FLIGHT } from '../src/constants/player-flight.ts';
import {
  defenceBrainNameFor, LIVE_BRAIN_IDS, brainName,
} from '../src/game/brain-names.ts';
import { defenceBrain } from '../src/game/brains.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

console.log('\nscripted combat computer');

// --- the selection can name it, and it is code rather than weights ----------
{
  eq('the attack run IS the shipped defence — no flag needed',
    defenceBrainNameFor({}), 'attack-run');
  eq('..."no brains at all" still means none',
    defenceBrainNameFor({ scripted: true }), 'scripted');
  check('it loads no weights — the pilot is code',
    defenceBrain({}) === null);
  check('the live picker offers it', LIVE_BRAIN_IDS.includes('attack-run'));
  check('...under a name that says what it does',
    (brainName('attack-run') ?? '').includes('ATTACK RUNS'));
}

// --- one seeded sky, one pirate, and the co-pilot's contract ----------------
{
  seedWorld(4242);
  const state = freshState(newCommander());
  state.world.build(state.systems[state.commander.systemIndex]);
  state.player.position.set(0, 0, 0);
  state.player.quaternion.identity();
  state.player.speed = 200;
  state.world.spawn('pirate',
    new THREE.Vector3(0, 0, -2000), 1);
  const pirate = state.world.npcs[state.world.npcs.length - 1];
  const legal = state.commander.legalStatus;

  const cp = new ScriptedCoPilot();
  const step = cp.step(1 / 60, state.player, state.world.npcs, legal, false, null);
  check('with a hostile in range it steers', step.kind === 'steer');
  if (step.kind !== 'steer') throw new Error('unreachable');
  check('...toward a real point in the sky', step.point !== null);
  check('...at a speed inside the ship\'s own envelope',
    step.speed > 0 && step.speed <= PLAYER_FLIGHT.maxSpeed);

  // the trigger is the player gun's own cone and range — both sides of each
  const dist = pirate.object.position.distanceTo(state.player.position);
  const cone = hitCone(pirate.radius, dist);
  check('lined up inside the cone, it asks for the trigger', step.fire);
  {
    // yaw the nose just outside the cone: the request must stop
    const off = new ScriptedCoPilot();
    state.player.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cone * 1.5);
    const miss = off.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    check('...and just outside it, it does not',
      miss.kind === 'steer' && !miss.fire);
    state.player.quaternion.identity();
  }
  {
    // the same pirate, out past the laser: lined up is not enough
    const far = new ScriptedCoPilot();
    pirate.object.position.set(0, 0, -(LASER_RANGE + 500));
    const outOfRange = far.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    check('beyond the laser\'s range it holds fire',
      outOfRange.kind === 'steer' && !outOfRange.fire);
    pirate.object.position.set(0, 0, -2000);
  }

  // the E.C.M. answers a warhead that exists, and only that
  {
    const quiet = new ScriptedCoPilot();
    const clear = quiet.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    const loud = quiet.step(1 / 60, state.player, state.world.npcs, legal, false,
      { x: 0, y: 400, z: 0 });
    check('a clear sky gets no E.C.M.', clear.kind === 'steer' && !clear.ecm);
    check('...and a warhead in it always does', loud.kind === 'steer' && loud.ecm);
  }

  // hands and an empty sky both give the ship back, in the co-pilot's words
  {
    const hands = cp.step(1 / 60, state.player, state.world.npcs, legal, true, null);
    check('touching the controls hands back',
      hands.kind === 'disengage' && hands.reason === 'MANUAL OVERRIDE');
    const alone = new ScriptedCoPilot();
    const empty = alone.step(1 / 60, state.player, [], legal, false, null);
    check('an empty sky disengages',
      empty.kind === 'disengage' && empty.reason.includes('AREA CLEAR'));
  }

  // --- and the run CYCLES: fly the contract the Game applies ----------------
  // The test integrates exactly what game.ts's pilotDemand applies — slew at
  // the ship's own pitch cap, approach the asked speed, advance — against a
  // pirate holding station. Passes must complete: 'passing' and 'extending'
  // both reached, more than once, inside a minute of flying.
  {
    const flier = new ScriptedCoPilot();
    const phases = new Set<string>();
    let passesSeen = 0;
    let lastPhase = '';
    const fwd = new THREE.Vector3();
    const to = new THREE.Vector3();
    for (let i = 0; i < 60 * 60; i++) {
      const s = flier.step(1 / 60, state.player, state.world.npcs, legal, false, null);
      if (s.kind !== 'steer') break;
      if (s.point) {
        steerQuatToward(state.player.quaternion,
          to.copy(s.point).sub(state.player.position), PLAYER_FLIGHT.maxPitch / 60);
      }
      state.player.speed = approach(state.player.speed, s.speed, PLAYER_FLIGHT.accel / 60);
      fwd.set(0, 0, -1).applyQuaternion(state.player.quaternion);
      state.player.position.addScaledVector(fwd, state.player.speed / 60);
      const phase = (flier as unknown as { run: { attackPhase: string } }).run.attackPhase;
      phases.add(phase);
      if (phase === 'extending' && lastPhase !== 'extending') passesSeen += 1;
      lastPhase = phase;
    }
    check(`the run cycles all three phases (${[...phases].join(', ')})`,
      phases.has('closing') && phases.has('passing') && phases.has('extending'));
    check(`...and completes more than one pass in a minute (${passesSeen})`,
      passesSeen >= 2);
  }
}
