// The scripted combat computer: a pursuit dogfighter flying YOUR ship.
//
// Added 2026-08-05, after the third trained-defence wall in a row (runs
// 20-21: turret, sprayer, pacifist — docs/TRAINING-LOG.md). It first flew the
// pirates' attack run and Chris found it let go of a target close up (the pass
// phase steers nowhere), so it diverged to pure pursuit — get on the six and
// hold guns on target. What these blocks pin is the co-pilot's own contract: it
// decides and reports (the Game flies the demand and shoots), its trigger is
// the player gun's real cone, its E.C.M. answers only a warhead that exists, and
// it PURSUES a crossing target rather than losing it.

import * as THREE from 'three';
import { ScriptedCoPilot } from '../src/game/scripted-co-pilot.ts';
import { hitCone } from '../src/game/gunnery.ts';
import { LASER_RANGE } from '../src/constants/player-gun.ts';
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
  check('with a hostile in range it flies', step.kind === 'fly');
  if (step.kind !== 'fly') throw new Error('unreachable');
  check('...asking to turn toward it (a real pitch or roll demand)',
    step.demand.pitchRate !== 0 || step.demand.rollRate !== 0
    || step.demand.throttle !== 0);
  check('...with a throttle inside −1..1',
    step.demand.throttle >= -1 && step.demand.throttle <= 1);

  // the trigger is the player gun's own cone and range — both sides of each
  const dist = pirate.object.position.distanceTo(state.player.position);
  const cone = hitCone(pirate.radius, dist);
  check('lined up inside the cone, it asks for the trigger', step.demand.fire);
  {
    // point the nose just outside the cone: the request must stop
    const off = new ScriptedCoPilot();
    state.player.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cone * 1.5);
    const miss = off.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    check('...and just outside it, it does not',
      miss.kind === 'fly' && !miss.demand.fire);
    state.player.quaternion.identity();
  }
  {
    // the same pirate, out past the laser: lined up is not enough
    const far = new ScriptedCoPilot();
    pirate.object.position.set(0, 0, -(LASER_RANGE + 500));
    const outOfRange = far.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    check('beyond the laser\'s range it holds fire',
      outOfRange.kind === 'fly' && !outOfRange.demand.fire);
    pirate.object.position.set(0, 0, -2000);
  }

  // the E.C.M. answers a warhead that exists, and only that
  {
    const quiet = new ScriptedCoPilot();
    const clear = quiet.step(1 / 60, state.player, state.world.npcs, legal, false, null);
    const loud = quiet.step(1 / 60, state.player, state.world.npcs, legal, false,
      { x: 0, y: 400, z: 0 });
    check('a clear sky gets no E.C.M.', clear.kind === 'fly' && !clear.ecm);
    check('...and a warhead in it always does', loud.kind === 'fly' && loud.ecm);
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

  // --- it PURSUES: get on a crossing target's six and hold it -----------------
  // The failure this replaced: the co-pilot flew the pirates' attack run, whose
  // pass phase steers nowhere on purpose, so a target crossing close up was
  // lost — "it lines up, shoots, then doesn't follow" (Chris, flying it). A
  // pursuit dogfighter keeps the nose on it. This flies a target straight
  // across the front, through the very `PlayerShip.update` the Game applies, and
  // asserts the co-pilot ends up pointing near it and closed to gun range —
  // which the attack run could not do.
  {
    const flier = new ScriptedCoPilot();
    const target = state.world.npcs[state.world.npcs.length - 1];
    target.state.speed = 150;
    const nose = new THREE.Vector3();
    const to = new THREE.Vector3();
    let onTargetLate = 0;
    let lateFrames = 0;
    const SECONDS = 20;
    for (let i = 0; i < 60 * SECONDS; i++) {
      // straight across the front, from left to right, a few hundred units ahead
      target.object.position.set(-900 + (i / 60) * 150, 0, -700);
      const s = flier.step(1 / 60, state.player, state.world.npcs, legal, false, null);
      if (s.kind !== 'fly') throw new Error('should be flying a live threat');
      state.player.update(1 / 60, s.demand);
      // measure only the second half, after it has had time to swing round
      if (i > 60 * (SECONDS / 2)) {
        lateFrames += 1;
        nose.set(0, 0, -1).applyQuaternion(state.player.quaternion);
        to.copy(target.object.position).sub(state.player.position);
        if (nose.angleTo(to) < 0.1) onTargetLate += 1; // within ~6 degrees
      }
    }
    const held = onTargetLate / lateFrames;
    check(`it holds a crossing target near the nose (${(held * 100).toFixed(0)}% of the late window)`,
      held > 0.6);
    const finalDist = target.object.position.distanceTo(state.player.position);
    check(`...and closes to gun range, not off in the distance (${finalDist.toFixed(0)} units)`,
      finalDist < LASER_RANGE);
  }
}
