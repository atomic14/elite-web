// The threat lock: fight the ship you are fighting until another is clearly
// the bigger problem — and never change your mind twice in the same breath.
//
// Measured before it existed (the figures are beside the constants): a
// fresh-every-frame "nearest" flipped the fought ship up to 26.8 times a
// minute against a four-gang, teleporting the brain's bearing slots ~90
// degrees each flip, and a distance margin alone could not stop it. The rule
// is one home (game/threat-lock.ts) consumed by the combat computer, the
// armed trader and the training episode, so the trainer and the game cannot
// hold a target differently.

import { ThreatLock } from '../src/game/threat-lock.ts';
import {
  THREAT_MIN_HOLD, THREAT_SWITCH_MARGIN,
} from '../src/constants/threat-lock.ts';
import { check, eq } from './harness.ts';

console.log('\nthe threat lock');
{
  type T = { d: number };
  const a: T = { d: 100 };
  const b: T = { d: 100 };
  const dist = (t: T) => t.d;

  const lock = new ThreatLock<T>();
  eq('with nothing held, the nearest is locked at once',
    lock.pick(0, [a, b], dist), a);

  // a decisively nearer rival appears immediately: distance says switch,
  // but the hold says not yet
  b.d = 10;
  eq('a rival ten times nearer cannot steal a fresh lock',
    lock.pick(0.1, [a, b], dist), a);

  // hold the fight until just short of the minimum, then step past it —
  // the switch lands exactly when the hold expires, which pins the constant
  let heldFor = 0.1;
  let switchedAt = -1;
  for (let i = 0; i < 200; i++) {
    heldFor += 0.1;
    if (lock.pick(0.1, [a, b], dist) === b) { switchedAt = heldFor; break; }
  }
  check(`the lock breaks only once the hold expires (switched at ${switchedAt.toFixed(1)}s, `
    + `hold is ${THREAT_MIN_HOLD}s)`,
    switchedAt >= THREAT_MIN_HOLD && switchedAt < THREAT_MIN_HOLD + 0.11);

  // now b is held; bisect the distance test with the hold already satisfied,
  // and compare the threshold to the constant — a re-inlined margin goes red
  // however the constant moves
  const lock2 = new ThreatLock<T>();
  b.d = 100;
  a.d = 100;
  lock2.pick(THREAT_MIN_HOLD + 1, [b], dist); // lock b, hold satisfied
  let lo = 1;
  let hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    a.d = mid;
    const probe = new ThreatLock<T>();
    probe.pick(0, [b], dist);
    probe.pick(THREAT_MIN_HOLD + 1, [a, b], dist);
    if (probe.pick(0.1, [a, b], dist) === b) hi = mid; else lo = mid;
  }
  check(`past the hold, the lock still demands a real overtake `
    + `(held 100 falls at rival ${hi.toFixed(3)})`,
    Math.abs(hi - 100 / THREAT_SWITCH_MARGIN) < 0.01);

  // a held threat that died is replaced by the nearest, immediately
  const lock3 = new ThreatLock<T>();
  a.d = 100;
  b.d = 500;
  lock3.pick(0, [a, b], dist);
  eq('a dead lock is replaced at once, however far the survivor',
    lock3.pick(0.1, [b], dist), b);
  eq('and an empty sky is nobody', lock3.pick(0.1, [], dist), null);

  // clear() lets go entirely: the next pick starts from nothing
  const lock4 = new ThreatLock<T>();
  a.d = 100;
  b.d = 90;
  lock4.pick(0, [a], dist);
  lock4.clear();
  eq('after clear(), the next pick locks the nearest afresh',
    lock4.pick(0, [a, b], dist), b);
}

// --- the `committed` veto: don't drop a ship you are on the attack against ---
//
// The scripted co-pilot passes this: while it is ENGAGED (target roughly on the
// nose) no rival takes the lock however near, because a pilot lined up on a ship
// does not abandon the kill because another drifted closer (Chris, flying it).
// The veto only holds while engaged; a target that runs wide lets the ordinary
// distance rule hand over.
{
  type T = { d: number };
  const a: T = { d: 100 };
  const b: T = { d: 10 };
  const dist = (t: T) => t.d;

  // engaged: `committed` true for the held threat. Even past the hold and with a
  // rival ten times nearer, the lock holds. The veto is passed every frame, as
  // the co-pilot passes it.
  const onA = (t: T) => t === a;
  const engaged = new ThreatLock<T>();
  engaged.pick(0, [a], dist, onA); // lock a
  engaged.pick(THREAT_MIN_HOLD + 1, [a, b], dist, onA); // hold satisfied, b far nearer
  eq('an engaged co-pilot keeps its target through an overtake',
    engaged.pick(0.1, [a, b], dist, onA), a);

  // not engaged: same geometry, but `committed` false — the distance rule wins,
  // so it is the veto and not the hold doing the work above.
  const loose = new ThreatLock<T>();
  loose.pick(0, [a], dist);
  loose.pick(THREAT_MIN_HOLD + 1, [a, b], dist);
  eq('...but a target it is NOT engaged with is handed over on the overtake',
    loose.pick(0.1, [a, b], dist, () => false), b);

  // a committed target that DIES is still replaced at once — the veto only
  // guards the switch, never the "gone" replacement.
  const died = new ThreatLock<T>();
  died.pick(0, [a], dist, () => true);
  eq('a committed target that leaves the sky is still replaced',
    died.pick(0.1, [b], dist, () => true), b);
}
