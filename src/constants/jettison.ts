// Buying your way out of a fight: what a pirate asks for, and what a tonne is
// worth to everyone doing the asking.
//
// The rules that spend these — dump the most valuable thing first, accumulate
// the toll across an encounter — are game/jettison.ts. Pirates came for
// cargo, not for you; give them enough of it and the opportunists break off,
// which turns "I can't win this fight" from a death into a decision.

/**
 * A pirate wants this share of your arrival cargo value — an organised gang
 * considerably more than an opportunist who happened to be passing.
 */
export const OPPORTUNIST_SHARE = 0.12;
export const GANG_SHARE = 0.3;

/** ...but never less than this, so a near-empty hold is not a free pass. */
export const OPPORTUNIST_FLOOR = 400;
export const GANG_FLOOR = 1500;

/**
 * What the market values a tonne at: this times its 1984 base price, in
 * tenths of a credit (basePrice is the source's byte encoding; x0.4 gives
 * credits, so x4 gives tenths).
 *
 * ONE RULE THAT HAD TWO HOMES: the toll (`dumpCargo` prices what you throw
 * overboard by it) and the assessment (`markOf` in game/threat.ts prices what
 * a pirate's scanner reads by it) must agree about what a hold is worth, or a
 * bribe sized off one number answers an appetite sized off another. The old
 * comment here said markOf "uses the same multiplier" while threat.ts wrote
 * `* 4` out as a bare literal; both import this now, and
 * `test/economy.test.ts` solves the multiplier back out of the real `markOf`
 * and compares it to this constant.
 */
export const VALUE_PER_TONNE = 4;
