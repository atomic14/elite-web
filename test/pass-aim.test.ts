// Where an attack run aims: beside the target, and ahead of it.
//
// Beside `game/pass-aim.ts` for the reason `break-off.test.ts` is beside
// `game/break-off.ts` — one file per module. The two were one section until
// docs/TODO/66 gave the aim point a lead and a stretch, at which point "how
// close does it get" and "where does it point" stopped being the same subject.
//
// Everything here is a claim about a PURE function, so none of it flies
// anything. What the rules are worth is measured, not asserted:
// `train/flight-probe.ts` for the one-on-one shape against a target that holds
// still, and `train/ram-probe.ts` for contact against one that moves.

import { leadTime, passMissDistance } from '../src/game/pass-aim.ts';
import {
  PASS_MISS_DISTANCE, MAX_LEAD_SECONDS, MAX_MISS_STRETCH,
} from '../src/constants/pass-aim.ts';
import { BREAK_OFF_RANGE } from '../src/constants/attack-run.ts';
import { check } from './harness.ts';

console.log('\nwhere the attack run aims');

// --- the run passes BESIDE the target --------------------------------------
//
// The miss distance is the difference between an attack run and a ram, and it
// was found the hard way: the first cut aimed the run at the target and then
// committed to that heading, which is a collision by construction. 60 episodes
// against a target that holds still, contact damage per episode:
//
//   the old 180-degree break-off      5.1   (but it never went in — a turret)
//   aimed AT the target             104.1   (20x worse — a ram every time)
//   aimed PASS_MISS_DISTANCE aside    2.2   (and 5.2 real passes an episode)

check('PASS_MISS_DISTANCE clears the biggest hull in the roster',
  // A pirate's contact radius is its own radius plus the commander's 25
  // (collisions.ts), which tops out at 55 for the largest hull that flies as
  // one. A run has to clear that to be a pass rather than a collision.
  PASS_MISS_DISTANCE > 55,
  `${PASS_MISS_DISTANCE} must clear the contact radius of the biggest hull`);

check('PASS_MISS_DISTANCE stays inside the break-off',
  // Wider than the break-off and the ship would be steering away from a target
  // it has not reached yet, which is the orbit this replaced.
  PASS_MISS_DISTANCE < BREAK_OFF_RANGE,
  `${PASS_MISS_DISTANCE} vs break-off ${BREAK_OFF_RANGE}`);

// --- and it aims where the target WILL be -----------------------------------
//
// The whole of docs/TODO/66: a run laid on where the target is now is stale by
// the time the two ships arrive, and the miss distance is spent on the target's
// own travel before the hulls meet.

check('leadTime is the time to the merge',
  // 600 units at a closing speed of 1200 is half a second, which is also the
  // cap — so pick a case that is unambiguously inside it.
  Math.abs(leadTime(300, 1200) - 0.25) < 1e-9,
  `got ${leadTime(300, 1200)}`);

check('leadTime never predicts past the cap',
  // Long range, slow closure: the merge is seconds away and the straight line
  // being extrapolated will not survive that long.
  leadTime(4000, 100) === MAX_LEAD_SECONDS,
  `got ${leadTime(4000, 100)} for a 40-second merge`);

check('a target that is opening the range still gets the cap, not a NaN', (() => {
  for (const closing of [0, -1, -400]) {
    if (leadTime(500, closing) !== MAX_LEAD_SECONDS) return false;
  }
  return true;
})());

check('leadTime is monotone in the closing speed — faster merge, shorter lead',
  (() => {
    let prev = -Infinity;
    for (let c = 2000; c >= 50; c -= 50) {
      const t = leadTime(600, c);
      if (t < prev - 1e-9) return false;
      prev = t;
    }
    return true;
  })());

// --- and by a distance it has the room to open ------------------------------

check('passMissDistance never narrows a pass', (() => {
  for (let d = 150; d <= 2000; d += 50) {
    for (const c of [-100, 0, 60, 240, 400, 900]) {
      if (passMissDistance(d, c, 240) < PASS_MISS_DISTANCE - 1e-9) return false;
    }
  }
  return true;
})());

check('passMissDistance never exceeds the stretch cap', (() => {
  for (let d = 1; d <= 2000; d += 7) {
    for (const c of [0, 240, 5000]) {
      const m = passMissDistance(d, c, 240);
      if (!(m <= PASS_MISS_DISTANCE * MAX_MISS_STRETCH + 1e-9)) return false;
      if (!Number.isFinite(m)) return false;
    }
  }
  return true;
})());

// The two corrections, each on its own. ROOM is a function of the range and
// nothing else; TRAVEL is a function of the closure and nothing else.
check('the room term opens as the range shortens',
  passMissDistance(BREAK_OFF_RANGE, 240, 240) > passMissDistance(2000, 240, 240),
  `${passMissDistance(BREAK_OFF_RANGE, 240, 240)} at the merge`
  + ` vs ${passMissDistance(2000, 240, 240)} out at 2000`);

check('...and it is barely anything at the far end of a run',
  // 1.01 at 900 units: the aim stays tight where the gun is actually firing.
  passMissDistance(900, 240, 240) < PASS_MISS_DISTANCE * 1.05,
  `${passMissDistance(900, 240, 240)}`);

check('the travel term opens with the closure',
  passMissDistance(600, 640, 240) > passMissDistance(600, 240, 240),
  `head-on ${passMissDistance(600, 640, 240)}`
  + ` vs a still target ${passMissDistance(600, 240, 240)}`);

check('a ship at rest is not asked to divide by zero',
  passMissDistance(600, 0, 0) === PASS_MISS_DISTANCE,
  `got ${passMissDistance(600, 0, 0)}`);

// The one property that says the static case cannot have regressed by
// arithmetic: at long range against a target that is not moving, this is the
// constant that shipped and nothing else.
check('far out, against a target that is not moving, nothing has changed',
  Math.abs(passMissDistance(2000, 240, 240) - PASS_MISS_DISTANCE) < 1,
  `got ${passMissDistance(2000, 240, 240)}`);
