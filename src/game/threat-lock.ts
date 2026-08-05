// Which threat a defending ship fights: the nearest — but committed to.
//
// Three places pick the threat a defence brain is flown against: the combat
// computer (your co-pilot), an armed trader under attack, and the training
// episode's target. All three used to take the nearest hostile from scratch
// every frame, with no memory — so with two attackers near-equidistant the
// "target" flipped identity up to 26.8 times a minute and the bearing the
// brain observes jumped ~90 degrees each time. No pilot flies like that: you
// fight the ship you are fighting until another is clearly the bigger problem,
// and you do not change your mind twice in the same breath.
//
// The rule needs BOTH tests. A distance margin alone barely helps — the
// scripted attack run extends the fought ship out to thousands of units while
// the next one dives to hundreds, so overtakes are decisive and even a 5x
// margin left 9 switches a minute (the sweep is beside the constants). The
// hold time is what turns a pick into a commitment.
//
// ONE rule, one home, used by all three — the fix lives outside the brain on
// purpose, so it serves whichever policy flies, the current brains included.

import {
  THREAT_MIN_HOLD, THREAT_SWITCH_MARGIN,
} from '../constants/threat-lock.ts';

/**
 * The threat to fight, held across frames.
 *
 * `pick` is called with the time since it was last asked, the live threats,
 * and a distance measure. The held threat is kept until (a) it dies or leaves
 * the list — replaced by the nearest at once — or (b) it has been held at
 * least `THREAT_MIN_HOLD` seconds AND a rival is nearer than its distance
 * divided by `THREAT_SWITCH_MARGIN`: an overtake, not a tie-break.
 *
 * The lock is NOT saved state. After a restore the first `pick` locks the
 * nearest hostile and commits to it — a defensible opening move from cold,
 * made once per reload; what the snapshot must never lose is the flight the
 * decision produces, and that (the ramped rates, the cached control) is saved.
 */
export class ThreatLock<T> {
  private held: T | null = null;
  private heldFor = 0;

  pick(dt: number, candidates: Iterable<T>, distOf: (t: T) => number): T | null {
    let nearest: T | null = null;
    let nearestD = Infinity;
    let stillThere = false;
    for (const c of candidates) {
      const d = distOf(c);
      if (d < nearestD) { nearestD = d; nearest = c; }
      if (c === this.held) stillThere = true;
    }
    if (!stillThere) {
      this.held = nearest;
      this.heldFor = 0;
      return this.held;
    }
    this.heldFor += dt;
    if (nearest !== this.held && this.held !== null
        && this.heldFor >= THREAT_MIN_HOLD
        && nearestD < distOf(this.held) / THREAT_SWITCH_MARGIN) {
      this.held = nearest;
      this.heldFor = 0;
    }
    return this.held;
  }

  /** Let go entirely — the next `pick` starts from nothing. */
  clear(): void {
    this.held = null;
    this.heldFor = 0;
  }
}
