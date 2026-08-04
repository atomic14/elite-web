// Keeping wingmen out of each other's way: the curve, the direction, the two
// guards — and that the attack run still applies them.
//
// `game/separation.ts` was written, swept against a measured table in its own
// header, and wired into all three legs of the attack run, and NOTHING imported
// it. Gutting `separationFrom` so that it always answered "nobody near" — which
// deletes wingman avoidance from `closing`, `passing` and `extending` at once —
// left `npm test` green at 2982 passed, 0 failed (docs/TODO/76). That is what
// this file is for, and it needs both of its halves to be it.
//
// THE PURE HALF is most of it. The module takes positions rather than ships
// precisely so a test can put two hulls exactly where it wants them, so the
// whole rule is assertable without flying anything: 0 at the edge of the range,
// 1 at contact, a straight line between, the NEAREST mate rather than an
// average of several, and the two guards.
//
// THE FLYING HALF is here because a pure test cannot see a CALL SITE, and three
// call sites are what the mutation above actually deletes. Each of them is
// subtle in a different way — `passing` steers for nothing else at all,
// `extending` shares its scratch with the arc, `closing` bends the aim point —
// so each gets its own merge and its own control.
//
// It is in this file rather than in test/npc.test.ts because what it asserts is
// this module's rule reaching the flight, not a fact about NpcShip: one rule,
// one test file, the same reason `pass-aim` and `extend-arc` have theirs. (It
// would also have taken npc.test.ts through the 400-line ceiling, which is the
// same argument arriving from the other end.)

import * as THREE from 'three';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import { npcVsNpcs } from '../src/game/collisions.ts';
import { separationFrom } from '../src/game/separation.ts';
import { SEPARATION_RANGE } from '../src/constants/separation.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import type { AttackPhase } from '../src/game/break-off.ts';
import { check } from './harness.ts';

console.log('\nwingman separation');

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** One scratch vector for every call, exactly as a ship reuses its own. */
const out = new THREE.Vector3();
const fmt = (u: THREE.Vector3) =>
  `${u.x.toFixed(3)}, ${u.y.toFixed(3)}, ${u.z.toFixed(3)}`;

// --- how much it matters -----------------------------------------------------

const ME = v(0, 0, 0);
/** What a single mate `d` units away is worth. */
const urgency = (d: number) => separationFrom(ME, [v(d, 0, 0)], out);

check('an empty sky is nothing to avoid', separationFrom(ME, [], out) === 0,
  `got ${separationFrom(ME, [], out)}`);
check(`a mate exactly at SEPARATION_RANGE (${SEPARATION_RANGE}) does not count`,
  urgency(SEPARATION_RANGE) === 0, `got ${urgency(SEPARATION_RANGE)}`);
check('...and one a single unit inside it does',
  urgency(SEPARATION_RANGE - 1) > 0, `got ${urgency(SEPARATION_RANGE - 1)}`);
check('two hulls in the same place is full urgency', urgency(0) === 1,
  `got ${urgency(0)}`);
check('...and so is all but touching', urgency(0.01) > 0.999,
  `got ${urgency(0.01)}`);

// LINEAR IN BETWEEN, asserted as a constant slope rather than by writing
// `1 - d / SEPARATION_RANGE` back down. A check that restates the formula
// passes on whatever formula is there.
{
  const STEP = SEPARATION_RANGE / 20;
  const curve = Array.from({ length: 21 }, (_, i) => urgency(i * STEP));
  const slope = curve.slice(1).map((u, i) => u - curve[i]);
  check(`the curve is a straight line from ${curve[0]} at contact to ${curve[20]}`
    + ` at the edge (${slope[0].toFixed(4)} per ${STEP} units, all 20 steps)`,
  slope.every((s) => Math.abs(s - slope[0]) < 1e-12) && slope[0] < 0,
  `slopes ${slope.map((s) => s.toFixed(6)).join(' ')}`);
}

// --- which way to go ---------------------------------------------------------

{
  separationFrom(ME, [v(50, 0, 0)], out);
  check(`the push points from the mate to me (${fmt(out)})`,
    out.x === -1 && out.y === 0 && out.z === 0);
}
{
  // Off all three axes, so "unit length" is a claim about something. A 60/80/0
  // offset is 100 units long, which is half of SEPARATION_RANGE.
  const u = separationFrom(v(10, 20, 30), [v(70, 100, 30)], out);
  check(`...as a unit vector whichever way it points (${fmt(out)})`,
    Math.abs(out.length() - 1) < 1e-12
    && Math.abs(out.x + 0.6) < 1e-12 && Math.abs(out.y + 0.8) < 1e-12
    && out.z === 0);
  check(`...and half the range out is half the urgency (${u})`, u === 0.5);
}
{
  // THE NEAREST, not the average. Steering away from a blend of several ships
  // aims at a gap that may not exist, and the one about to be hit is the one
  // that matters. The two far mates are placed so that an average would push
  // mostly along -Y, which the answer must contain none of.
  const near = v(30, 0, 0);
  const far = [v(0, 190, 0), v(0, 190, 0)];
  const alone = separationFrom(ME, [near], out);
  const aloneDir = out.clone();
  const farOnly = separationFrom(ME, far, out);
  check(`the far mates are inside the range and would have their own say`
    + ` (${farOnly.toFixed(3)} toward ${fmt(out)})`,
  farOnly > 0 && out.y < -0.99);
  const both = separationFrom(ME, [near, ...far], out);
  check(`...and are ignored anyway: the answer is the nearest mate's, unblended`
    + ` (${both.toFixed(3)} toward ${fmt(out)})`,
  both === alone && out.equals(aloneDir));
}

// --- the two guards ----------------------------------------------------------

{
  // `mates` may include the ship itself, so a caller does not have to know where
  // it sits in the fleet — and `npc.ts` hands in one it has not filtered.
  const me = v(0, 0, 120);
  const mate = v(0, 0, 60);
  check('a ship does not avoid itself', separationFrom(me, [me], out) === 0);
  const whole = separationFrom(me, [me, mate], out);
  check(`...so the whole fleet and the fleet-minus-me give the same answer (${whole})`,
    whole === separationFrom(me, [mate], out));
  // BY IDENTITY, not by coordinates: a DIFFERENT hull sitting exactly where we
  // are is the emergency this function exists for, not a self-reference to skip.
  check('...and another hull in our exact place is not us',
    separationFrom(me, [v(0, 0, 120)], out) === 1);
}

// Two hulls in the same place have no direction to separate along, and `me`
// minus `mate` is the zero vector. Normalising that gives three NaNs, and the
// caller scales them into an aim point that reaches `object.position` — one such
// frame and the ship is at no coordinates at all for the rest of the session.
// So the whole neighbourhood of zero is checked, not just zero: an epsilon with
// a gap under it would leave the NaN reachable.
for (const d of [0, 1e-12, 1e-8, 1e-4, 1e-3, 0.5]) {
  const u = separationFrom(v(5, 5, 5), [v(5 + d, 5, 5)], out);
  check(`hulls ${d} apart still separate along a real direction (${fmt(out)},`
    + ` urgency ${u.toFixed(6)})`,
  Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)
  && Math.abs(out.length() - 1) < 1e-9 && u > 0.99);
}

// --- and the attack run actually applies it ----------------------------------
//
// Two hostiles, one target, one leg of the run at a time, flown twice: once
// with each other in the fleet and once with the fleet empty, which is the same
// fixture with the push at zero. "They did not collide" is true of almost any
// pair of ships, so the control is what makes this mean anything — the claim is
// that the gap GROWS against it.

console.log('\nwingman separation in the attack run');

{
  const TARGET = new THREE.Vector3(0, 0, 0);
  const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3() };

  /** A merge that goes wrong, in one named leg of the attack run. */
  interface Leg {
    phase: AttackPhase;
    /** how far the pair starts from what it is attacking */
    range: number;
    /** how far apart they start — inside SEPARATION_RANGE, or there is nothing to see */
    gap: number;
    /** how hard each aims its run-out across the other; `extending` only */
    lateral: number;
    frames: number;
  }

  /** Fly one leg and report how close the two of them got. */
  const fly = (leg: Leg, mates: boolean) => {
    // Seeded, because NpcShip draws from the world stream when it is built. The
    // two arms have to differ in what fleet they can see and in nothing else.
    seedWorld(31_000_001);
    const half = leg.gap / 2;
    const a = new NpcShip('pirate', new THREE.Vector3(-half, 0, leg.range), 3);
    const b = new NpcShip('pirate', new THREE.Vector3(half, 0, leg.range), 3);
    const pair = [a, b];
    for (const s of pair) {
      s.state.attackPhase = leg.phase;
      const side = Math.sign(s.object.position.x);
      // `extending` is the run-out, so the pair points AWAY from the target,
      // each with a lateral component laid across the other's curve. That is
      // the two-ship version of what the call site is there for: several ships
      // curving back toward one target converge by construction.
      s.faceToward(leg.phase === 'extending'
        ? new THREE.Vector3(s.object.position.x - side * leg.lateral, 0, leg.range * 2)
        : TARGET);
    }
    const fleet = mates ? pair : [];
    let closest = Infinity;
    let contacts = 0;
    const legs = new Set<AttackPhase>();
    for (let i = 0; i < leg.frames; i++) {
      for (const s of pair) {
        // PINNED to the standard run every step, for test/npc.test.ts's reason:
        // two of the tactics deliberately aim a different width, so leaving the
        // roll in would measure the vocabulary and blame separation.ts.
        s.state.tactic = 'run';
        s.attack(
          FIXED_DT, TARGET, s.object.position.distanceTo(TARGET), true, undefined, fleet);
        legs.add(s.state.attackPhase);
      }
      closest = Math.min(closest, a.object.position.distanceTo(b.object.position));
      // The GAME's own rule for "those two touched" rather than a radius sum
      // written out again here, and it resolves the overlap exactly as the world
      // step does — so a pair that collides is shoved apart and flies on.
      contacts += npcVsNpcs(pair, scratch).length;
    }
    return { closest, contacts, legs: [...legs].join('+') };
  };

  // Each geometry is chosen so that the pair MERGES: with the push at zero these
  // two fly into one another, which is what stops the comparison being a
  // formality. Measured 2026-08-04, closest approach in units, fleet unseen ->
  // fleet seen, with one contact becoming none in every leg:
  //
  //   passing     49.4 -> 87.9
  //   closing     49.0 -> 87.6
  //   extending   45.4 -> 76.8
  //
  const LEGS: Leg[] = [
    // Inside BREAK_OFF_RANGE and nose-on. `passing` steers for nothing else at
    // all — the committed heading is the whole point of the phase — so the
    // nudge is the only thing in the game that can move these two apart.
    { phase: 'passing', range: 170, gap: 100, lateral: 0, frames: 42 },
    // Outside it, converging on one target from two sides. Here the push bends
    // the AIM POINT, so a gang picks different lines in.
    { phase: 'closing', range: 700, gap: 90, lateral: 0, frames: 100 },
    // Past the target, each curving back across the other's run-out.
    { phase: 'extending', range: 400, gap: 140, lateral: 60, frames: 60 },
  ];

  /**
   * How much wider the closest approach has to get before this counts.
   *
   * The three legs measure 38.5, 38.6 and 31.4 units of it, so 20 sits inside
   * every one of them — and nowhere near the 0.0 that deleting a call site
   * gives, because with the fleet unseen the two arms are the same run to the
   * last bit.
   */
  const WIDER = 20;

  for (const leg of LEGS) {
    const off = fly(leg, false);
    const on = fly(leg, true);
    check(`${leg.phase}: the fixture stays in the leg it is measuring`
      + ` (${off.legs} / ${on.legs})`,
    off.legs === leg.phase && on.legs === leg.phase);
    check(`${leg.phase}: with the push at zero the two of them collide`
      + ` (${off.contacts} contact${off.contacts === 1 ? '' : 's'},`
      + ` closest ${off.closest.toFixed(1)})`,
    off.contacts > 0);
    check(`${leg.phase}: ...and with wingman avoidance they never touch`
      + ` (${on.contacts} contacts, closest ${on.closest.toFixed(1)},`
      + ` ${(on.closest - off.closest).toFixed(1)} units wider)`,
    on.contacts === 0 && on.closest - off.closest > WIDER);
  }
}
