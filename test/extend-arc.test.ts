// The run-OUT is a curve: what the rule promises, and that a ship really flies it.
//
// Beside `game/extend-arc.ts` for the reason `pass-aim.test.ts` is beside
// `game/pass-aim.ts` — one file per module.
//
// Two halves, and the second one exists because of how docs/TODO/67 nearly
// went wrong. The pure rule was right and the ship flew straight anyway: the
// arc was built in the plane of the ship's own heading, the ramp asks for a
// dead-radial heading at the start of every run-out, and a dead-radial heading
// has no such plane. Every assertion about the constants passed while the
// median heading error at the turn-back stayed at 179 degrees — no arc at all.
// So the flown half is not decoration; it is the only thing that can tell a
// curve from an intention.

import { Episode } from '../src/ai-training/scenario.ts';
import {
  CLEAR_RANGE, EXTEND_ARC_ANGLE, extendArcAngle,
} from '../src/game/extend-arc.ts';
import { BREAK_OFF_RANGE, EXTEND_RANGE_MIN, EXTEND_RANGE_MAX } from '../src/game/break-off.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { check } from './harness.ts';

console.log('\nthe curve an attack run runs out on');

// --- the rule ---------------------------------------------------------------

const deg = (rad: number): number => (rad * 180) / Math.PI;

// THE PROPERTY THE PHASE MACHINE DEPENDS ON. A ship flying `psi` off the
// outward radial opens the range at `v cos(psi)`, so anything at or past 90
// degrees stops opening it — and `nextAttackPhase` waits on a range it would
// then never reach. The curve would become an orbit, which is the turret this
// whole cycle exists to avoid.
check('the arc never points inward, so a run-out always terminates',
  EXTEND_ARC_ANGLE < Math.PI / 2 - 1e-9,
  `${deg(EXTEND_ARC_ANGLE).toFixed(0)} degrees off the radial`);

check('...and the ramp cannot exceed it, at any range or any rolled run', (() => {
  for (let ext = EXTEND_RANGE_MIN; ext <= EXTEND_RANGE_MAX; ext += 25) {
    for (let d = 0; d <= ext + 600; d += 25) {
      const psi = extendArcAngle(d, ext);
      if (psi < 0 || psi > EXTEND_ARC_ANGLE + 1e-9) return false;
    }
  }
  return true;
})());

// Turning before the ship has cleared puts it back through the target it has
// just passed, so the curve starts behind the merge and not at it.
check('a ship that has not cleared the target is not turning yet',
  extendArcAngle(BREAK_OFF_RANGE, 850) === 0 && extendArcAngle(CLEAR_RANGE, 850) === 0,
  `${extendArcAngle(BREAK_OFF_RANGE, 850)} at the break-off`);

check('CLEAR_RANGE clears the break-off it is measured from',
  CLEAR_RANGE > BREAK_OFF_RANGE,
  `${CLEAR_RANGE} vs ${BREAK_OFF_RANGE}`);

check('the arc is hardest over exactly where the ship turns back',
  Math.abs(extendArcAngle(850, 850) - EXTEND_ARC_ANGLE) < 1e-9
  && Math.abs(extendArcAngle(2000, 850) - EXTEND_ARC_ANGLE) < 1e-9,
  `${deg(extendArcAngle(850, 850)).toFixed(1)} at the turn-back`);

check('...and tightens all the way out to it, never in steps', (() => {
  let prev = -1;
  for (let d = CLEAR_RANGE; d <= 850; d += 5) {
    const psi = extendArcAngle(d, 850);
    if (psi < prev - 1e-9) return false;
    prev = psi;
  }
  return true;
})());

// A SHIP'S OWN ROLL, not the band's: the whole point of the ramp is that a ship
// which rolled a short run curves harder for it, which is what makes the short
// end of the band flyable rather than merely permitted.
check('a short run curves harder than a long one at the same range',
  extendArcAngle(500, EXTEND_RANGE_MIN) > extendArcAngle(500, EXTEND_RANGE_MAX),
  `${deg(extendArcAngle(500, EXTEND_RANGE_MIN)).toFixed(0)} against`
  + ` ${deg(extendArcAngle(500, EXTEND_RANGE_MAX)).toFixed(0)} degrees at 500 units`);

check('a rolled range inside the clearance still gets an angle rather than a NaN',
  Number.isFinite(extendArcAngle(400, CLEAR_RANGE - 100))
  && extendArcAngle(400, CLEAR_RANGE - 100) === EXTEND_ARC_ANGLE);

// --- and a ship actually flies it -------------------------------------------
//
// One scripted pirate against a target that holds, which is `flight-probe.ts`'s
// fixture, sampled at the moment the phase machine hands the run back to the
// closing leg. With a straight run-out that angle is a full reversal; with the
// curve it is `180 - psi`, less whatever the ship has not managed to hold.

{
  const flips: number[] = [];
  for (let e = 0; e < 6; e++) {
    const ep = new Episode({
      seed: 30_000_007 + e * 7919,
      pirates: [{ kind: 'scripted' }],
      trader: { kind: 'holding' },
      traderArmed: false,
      traderClass: 'playerCobra',
      maxTime: 60,
    });
    ep.setup();
    const p = ep.pirates[0];
    let was = p.npc.state.attackPhase;
    while (!ep.done) {
      ep.step(FIXED_DT);
      if (!p.alive) break;
      const phase = p.npc.state.attackPhase;
      if (phase === 'closing' && was === 'extending') {
        flips.push(deg(p.npc.facing(ep.trader.pos)));
      }
      was = phase;
    }
  }
  const sorted = [...flips].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 180;
  check(`the run-out comes round before the phase flips (${flips.length} turn-backs,`
    + ` median ${median.toFixed(0)} degrees off the target)`,
  flips.length > 10 && median < 160,
  'a straight run-out reads 175-179 here; that is the regression this catches');
}
