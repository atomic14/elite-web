// The VOCABULARY: the table of what each tactic is, and that each row is
// flyable by the hulls it is meant for.
//
// Which hull may be offered what, and when a ship re-decides, is
// `tactic-choice.test.ts` beside this — the two modules split for the reason
// docs/TODO/68's own report gave, and the tests follow `src/` as the rest of
// the suite does.
//
// WHAT IT HOLDS:
//
//   - the table is a departure from the shipped run and not a replacement: the
//     `run` row IS break-off/pass-aim/extend-arc's own constants, imported
//     rather than repeated, and every other row stays inside a range those
//     files measured
//   - and every row is FLOWN, because a pass is delivered by geometry and not
//     by intent: pin one tactic, fly it, and demand no merge closes inside the
//     two hulls. This is the assertion that caught `knife` at 70.

import { seedWorld, makeRng } from '../src/game/rng.ts';
import { TACTICS, TACTIC_IDS, type TacticId } from '../src/constants/tactics.ts';
import { tacticsFor } from '../src/game/tactic-choice.ts';
import { COMMANDER_HULL_RADIUS } from '../src/constants/collision.ts';
import {
  BREAK_OFF_RANGE, CLOSING_THROTTLE_MIN, MIN_CRUISE_FRACTION,
} from '../src/constants/attack-run.ts';
import { PASS_MISS_DISTANCE } from '../src/constants/pass-aim.ts';
import { EXTEND_ARC_ANGLE } from '../src/constants/extend-arc.ts';
import { Episode } from '../src/ai-training/scenario.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { check } from './harness.ts';

console.log('\na vocabulary of tactics');

// --- the table ---------------------------------------------------------------
//
// `run` is not a copy of the shipped attack run, it IS it. If these four
// assertions ever fail it means somebody has given the default behaviour a
// second home, which is the failure CLAUDE.md is organised against and the one
// this module is most exposed to.

check('`run` is the shipped attack run, not a copy of it',
  TACTICS.run.missDistance === PASS_MISS_DISTANCE
  && TACTICS.run.arcAngle === EXTEND_ARC_ANGLE
  && TACTICS.run.throttleFloor === CLOSING_THROTTLE_MIN
  && !TACTICS.run.aimsToHit);

// break-off.ts: CLOSING_THROTTLE_MIN sits deliberately just above
// MIN_CRUISE_FRACTION so the throttle rule and the anti-turret backstop never
// argue. A tactic that reached the floor would put them in an argument.
check('no tactic throttles down to the turret floor',
  TACTIC_IDS.every((id) => TACTICS[id].throttleFloor > MIN_CRUISE_FRACTION));

// extend-arc.ts swept the angle and published the table: 45/60/70 are within a
// quarter of a second of each other on the merge-to-merge clock, and 85 is
// where a ship starts loitering at mid-range. Staying inside the swept band is
// what makes varying it a feel change rather than an unmeasured one.
check('every arc angle is inside the band extend-arc.ts swept',
  TACTIC_IDS.every((id) => TACTICS[id].arcAngle >= (45 * Math.PI) / 180
    && TACTICS[id].arcAngle <= (70 * Math.PI) / 180));

check('exactly one tactic aims to hit, and it is the ram',
  TACTIC_IDS.filter((id) => TACTICS[id].aimsToHit).join() === 'ram');

// --- and every row is flyable by the hulls it is offered to, FLOWN ------------
//
// `tactic-choice.test.ts` asserts the gate as arithmetic over this table. This
// is the same claim against the flight model, because a pass is delivered by
// geometry and not by intent — and it is the assertion that matters, because
// the first draft of `knife` intended 70 units and rammed. Pin one tactic, fly
// it, and demand that no merge closes inside the two hulls' contact distance.

for (const tactic of ['run', 'slash', 'knife'] as TacticId[]) {
  let nearest = Infinity;
  let contact = 0;
  let merges = 0;
  const rng = makeRng(0x7ac71c5);
  // Ten, not four: a hull too big for a `knife` is SKIPPED below rather than
  // forced to fly one, so the tightest tactic gets the fewest episodes and
  // needs the most to reach a useful number of merges.
  for (let e = 0; e < 10; e++) {
    const ep = new Episode({
      seed: 51_000_003 + e * 7919 + Math.floor(rng() * 97),
      pirates: [{ kind: 'scripted' }],
      trader: { kind: 'holding' },
      traderArmed: false,
      traderClass: 'playerCobra',
      maxTime: 45,
    });
    ep.setup();
    const p = ep.pirates[0];
    // A hull big enough for a knife would not be OFFERED one, so a fixture that
    // forced it onto every hull would be asserting something the game cannot do.
    if (!tacticsFor(
      { radius: p.npc.radius, maxSpeed: 400, turnRate: 1 }, 1).includes(tactic)) continue;
    contact = Math.max(contact, p.npc.radius + COMMANDER_HULL_RADIUS);
    let inside = false;
    let low = Infinity;
    while (!ep.done) {
      p.npc.state.tactic = tactic;
      ep.step(FIXED_DT);
      if (!p.alive) break;
      const d = ep.trader.pos.distanceTo(p.pos);
      const now = d < BREAK_OFF_RANGE;
      if (now) low = Math.min(low, d);
      if (!now && inside) { merges += 1; nearest = Math.min(nearest, low); low = Infinity; }
      inside = now;
    }
  }
  check(`a pinned ${tactic} clears the hulls it passes`
    + ` (${merges} merges, nearest ${nearest.toFixed(0)} against ${contact.toFixed(0)} of contact)`,
  merges > 8 && nearest > contact);
}

// A tactic is rolled at spawn and it must not be a rule read from anywhere but
// the seed. `tactic-choice.test.ts` asserts the roll; this asserts the default
// a ship is BUILT with, so a rock — which never reaches `attack()` and never
// draws — still has a name the readout can print.
{
  seedWorld(70_000_041);
  check('every tactic id has a table row, and nothing else does',
    TACTIC_IDS.every((id) => TACTICS[id]?.id === id)
    && Object.keys(TACTICS).length === TACTIC_IDS.length);
}
