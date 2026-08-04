// What everything that is NOT a laser costs — the one Harmless rule for it.
//
// HARMLESS POLICY, stated as ours, and recorded as ours in docs/GAP-ANALYSIS.md.
// The Elite-A pack tabulates registered LASER hits and nothing else: 15,600
// player-to-NPC rows, 3,900 NPC-to-player rows, and not one number for a ram, a
// canister breaking on the hull, a Coriolis wall, a warhead or an energy bomb.
// So Harmless states a rule, and this file is its only home. Nothing here is an
// Elite-A fact and nothing here may be presented as one.
//
// THE RULE, in one sentence: an impact costs a FIXED WHOLE NUMBER OF SOURCE
// POINTS, stated separately for a ship's energy bank and for the commander's
// pools, and it is spent on whatever it hits without asking what that is.
//
// Two columns and not one, because the two banks are not comparable. A released
// ship carries 2 to 255 energy; the commander carries a 255-point facing shield
// in front of a 255-point bank. One number cannot mean the same thing to both,
// and the old model hid exactly that behind a normalized "fraction of a Cobra"
// that meant 98 points on one side of a collision and 255 on the other.
//
// Fixed points, and not a share of the target, because a hull's size is
// supposed to be worth something: a 44-point scrape is a third of a Sidewinder's
// bank and a sixth of an Anaconda's, which is what a big ship IS. A share would
// make a Worm and a Thargoid equally afraid of the same bump.
//
// THE ANCHORS. Every number below is calibrated from two ships, named here and
// re-derived from the catalogue by `test/damage-paths.test.ts` — so a re-import
// that moved the Cobra Mk III's bank fails the build instead of leaving these
// stale:
//
//   * the representative NPC is the Cobra Mk III, 98 points of released energy;
//   * the commander is the Cobra Mk III too, one 255-point shield face.
//
// A SEVERITY column would be a fourth opinion, so the severity is stated in the
// prose of each row and checked in the test. `energyBomb` has no commander
// column because the bomb has never hurt the ship that set it off, and
// `canisterOnHull`/`stationScrape` have no ship column because nothing but the
// commander can fly into a canister or fluff the slot. A null is "there is no
// such path", not "we did not decide": both spend functions in
// `game/impact-damage.ts` refuse it, and the type system refuses it first.

/**
 * Every non-laser way anything in this game can be hurt, in points.
 *
 * The list is CLOSED, and that is most of its value: the inventory in
 * docs/DAMAGE-PATHS.md has a row per entry, and a sixth way to hurt something
 * has to be added here before it can be applied anywhere. What turns a row into
 * a branded, spendable number is `game/impact-damage.ts`.
 */
export const IMPACT = {
  /**
   * Flying into something, either way round.
   *
   * 44 to a ship: 45% of the Cobra Mk III anchor's 98-point bank, so three
   * rams kill an unshielded one and a Sidewinder's 73 points buy it two.
   * 115 to the commander: the same 45%, of the 255-point shield face the
   * commander's pools are built on. Both are what a ram cost before the source
   * damage model landed, restated in the units it is now spent in — a ram was
   * the one secondary the pre-parity game had actually been played with.
   */
  ram: { name: 'ram', ship: 44, commander: 115 },
  /**
   * A canister breaking on a hull with no scoops fitted.
   *
   * 6% of the shield face: a nuisance, seventeen of them to strip it, and it
   * has to stay a nuisance because flying through a wreck's cargo is how you
   * find out you never bought the scoops.
   */
  canisterOnHull: { name: 'canister on the hull', ship: null, commander: 15 },
  /**
   * Bouncing off the Coriolis, or fluffing the slot.
   *
   * 90% of the shield face — nearly all of it, and none of the bank. Docking
   * badly should cost a shield and a minute of waiting for it back, not a
   * hull breach.
   */
  stationScrape: { name: 'station scrape', ship: null, commander: 230 },
  /**
   * A missile warhead reaching what it was homing on, ours or theirs.
   *
   * 250 points to anything: one byte's worth, less a margin. It flattens a
   * full 255-point shield face and leaves the bank alone; it destroys every
   * released build outright except the five heaviest of the 260 — the two
   * Anacondas at 252, the two Thargoid motherships at 253 and the `W:29` Dragon
   * at 255 — which survive one at full energy by a sliver. That is the warhead
   * the released catalogue implies, the heaviest things in the sky being the
   * only ones a missile does not simply delete, and it is the reason this is a
   * damage number rather than the "that ship is gone" it used to be.
   */
  warhead: { name: 'missile warhead', ship: 250, commander: 250 },
  /**
   * The energy bomb, on everything in range that is not a Thargoid.
   *
   * 255: the top of the byte scale, above every released bank, so everything
   * it catches is destroyed. The bomb has always been an "everything nearby is
   * gone" button and this keeps it one — but as a number spent through the
   * same function as every other hit, rather than a special case that skipped
   * the damage model.
   */
  energyBomb: { name: 'energy bomb', ship: 255, commander: null },
} as const;
