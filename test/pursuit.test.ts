// The pursuit dogfighter's shipless decisions: hold gun range, and break off
// before ramming. Flown by both the combat computer (scripted-co-pilot.ts) and
// a pursuit pirate (npc.ts), so the rule is pinned here once.

import * as THREE from 'three';
import {
  pursuitSpeed, pursuitAim, freshPursuitBreak,
} from '../src/game/pursuit.ts';
import {
  PURSUIT_RANGE, PURSUIT_BREAK_RANGE, PURSUIT_CLEAR_RANGE,
} from '../src/constants/combat-computer.ts';
import { check } from './harness.ts';

console.log('\npursuit');

// --- the speed holds a gun-range standoff -----------------------------------
{
  const maxSpeed = 400;
  // beyond the hold range, dead ahead: close (want faster than the target)
  check('beyond the hold range it closes',
    pursuitSpeed(200, PURSUIT_RANGE + 400, 0, maxSpeed) > 200);
  // inside the hold range, dead ahead: back off (slower than the target)
  check('inside the hold range it opens',
    pursuitSpeed(200, PURSUIT_RANGE - 200, 0, maxSpeed) < 200);
  // at the hold range, dead ahead: match the target
  check('at the hold range it matches the target',
    Math.abs(pursuitSpeed(200, PURSUIT_RANGE, 0, maxSpeed) - 200) < 1);
  // a hard turn (nose 90 deg off) throttles back below the matched speed
  check('a hard turn throttles back',
    pursuitSpeed(200, PURSUIT_RANGE, Math.PI / 2, maxSpeed)
    < pursuitSpeed(200, PURSUIT_RANGE, 0, maxSpeed));
  // never above the chaser's own top speed
  check('never faster than the chaser can fly',
    pursuitSpeed(400, 9999, 0, maxSpeed) === maxSpeed);
}

// --- the break-off: chase far, turn away close, with hysteresis -------------
{
  const at = (z: number) => new THREE.Vector3(0, 0, z);
  const out = new THREE.Vector3();
  const pos = at(0);

  // far out: aim straight at the target (pure pursuit)
  {
    const brk = freshPursuitBreak();
    const target = at(-PURSUIT_CLEAR_RANGE - 100);
    const aim = pursuitAim(brk, pos, target, target.length(), out);
    check('far out it chases the target itself',
      !brk.breaking && aim.equals(target));
  }

  // inside the break range: commit to a break, and aim AWAY (nearer than the
  // target, on the chaser's side) rather than toward it
  {
    const brk = freshPursuitBreak();
    const target = at(-(PURSUIT_BREAK_RANGE - 40));
    const aim = pursuitAim(brk, pos, target, target.length(), out.clone()).clone();
    const distAimToTarget = aim.distanceTo(target);
    const distPosToTarget = pos.distanceTo(target);
    check('inside the break range it breaks off',
      brk.breaking === true);
    check('...aiming away from the target, not into it',
      distAimToTarget > distPosToTarget);
  }

  // hysteresis: once breaking, it keeps breaking between BREAK and CLEAR range,
  // and only resumes the chase once past CLEAR
  {
    const brk = freshPursuitBreak();
    const target = at(-(PURSUIT_BREAK_RANGE - 20));
    pursuitAim(brk, pos, target, target.length(), out); // enter break
    const mid = at(-((PURSUIT_BREAK_RANGE + PURSUIT_CLEAR_RANGE) / 2));
    pursuitAim(brk, pos, mid, mid.length(), out);
    check('it stays broken between the break and clear ranges', brk.breaking === true);
    const far = at(-(PURSUIT_CLEAR_RANGE + 50));
    const aim = pursuitAim(brk, pos, far, far.length(), out);
    check('...and resumes the chase past the clear range',
      !brk.breaking && aim.equals(far));
  }
}
