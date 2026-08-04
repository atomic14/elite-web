// What destruction leaves behind: whether the pilot got out, and what a mined
// rock pays.
//
// The rule that spends these is `Combat.wreck`/`Combat.destroy` in
// game/combat.ts. WHAT spills — the ordinary-goods list a wreck sheds, the
// ore list a rock yields — deliberately does not live here: both are commodity
// indices into the 1984 market table, the ordinary-goods list has three homes
// the career slice will unify, and moving one of the three now would leave the
// other two behind. See docs/TODO/90-constants-cleanup.md.

/**
 * How often the pilot punches out before the hull goes.
 *
 * Per role rather than one rate: wily traders bail out more than twice as
 * often as pirates and hunters, so a trade-lane kill usually leaves a capsule
 * in the wreckage and a fight with pirates usually does not. Both figures are
 * what shipped and nothing records how they were chosen; what can be said is
 * that the capsule is scoopable, so this rate is also how often a kill leaves
 * something worth slowing down for. `test/combat.test.ts` flies the real wreck
 * path over seeded kills and holds each role's measured rate against its entry
 * here.
 */
export const ESCAPE_CHANCE = { trader: 0.45, other: 0.2 } as const;

/**
 * Canisters of ore a mined asteroid yields: at least the first, plus a flat
 * draw over the span — `MINING_YIELD_MIN + randomInt(MINING_YIELD_SPAN)`, so
 * one to three cans.
 *
 * At least one ALWAYS: the mining laser's whole promise is that a destroyed
 * rock pays, and a rock that pays nothing reads as the fitting not working
 * rather than as bad luck. The span is what makes a field of rocks a gamble
 * worth flying rather than a fixed wage. Only a commander with the mining
 * laser fitted gets any of it (`Combat.destroy`).
 */
export const MINING_YIELD_MIN = 1;
export const MINING_YIELD_SPAN = 3;
