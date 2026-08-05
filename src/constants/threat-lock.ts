// How hard a defending ship holds on to the threat it is already fighting.
//
// The rule that spends these is `game/threat-lock.ts`'s `ThreatLock`, used by
// the combat computer, the armed trader and the training episode — the three
// places that used to re-pick "the nearest threat" from scratch every frame
// with no memory at all. Both constants were chosen from the same measurement
// (2026-08-05, 40 episodes per gang size, jameson-defend-g2 flying): with no
// lock the target switched identity 11.2/20.4/26.8 times a minute against
// gangs of 2/3/4, with a ~90 degree bearing jump each switch.

/**
 * A rival threat must be this much NEARER than the one being fought before
 * the defender may switch to it.
 *
 * Sweeping this alone showed it is the weaker of the two tests: 1.2 gave
 * 22.9 switches/min at gang 4, and even 5.0 — a rival five times nearer —
 * still 9.2, because the scripted attack run's extend phase carries the
 * fought ship thousands of units out while the next diver closes to
 * hundreds, so overtakes are routinely enormous. 2.0 is kept as the sanity
 * test ("actually overtaken, not a tie"), and `THREAT_MIN_HOLD` does the
 * real committing.
 */
export const THREAT_SWITCH_MARGIN = 2.0;

/**
 * Seconds a threat is fought before the defender will even consider a rival.
 * A threat that dies or leaves is replaced at once regardless.
 *
 * Swept at margin 2.0, same 40-episode measurement: a hold of 3/5/8 seconds
 * gave 14.7/9.1/5.9 switches a minute against a four-gang (kills force some
 * of those — a dead threat is always replaced). 5 makes the fought ship
 * stable for ~50 consecutive 10Hz brain decisions at the worst, while not
 * gluing the defender to an extending ship for so long that the one shooting
 * her goes unanswered — the second-threat inputs cover the ship the lock is
 * deliberately not chasing.
 */
export const THREAT_MIN_HOLD = 5;
