// The rock hermit's market: what a miner is flush with, what they are
// desperate for, and what each costs at the tunnel.
//
// The hermit economy reads as the opposite of a station's — ore cheap and in
// quantity, supplies dear because nobody else delivers out here — and that is
// the whole trade: buy ore at the rock, sell it where the mining stopped. The
// rule that spends these is `hermitMarket` in game/contracts.ts; whether a
// hermit is in the system at all is `population.ts`'s `HERMIT_CHANCE`, and
// where it hides is `spawn-placement.ts`'s `HERMIT_SCATTER`.

/**
 * What a hermit is sitting on: whatever they dug up.
 *
 * Matched on the market row's own NAME, not its index, because `i === 12 ||
 * i === 13 || i === 14 || i === 15` is only readable to someone who has the
 * 1984 commodity table memorised — and `generateMarket` copies the name
 * straight off `COMMODITIES`, so a renamed row turns the discount off in a
 * way `test/economy.test.ts` catches. A related list at a different meaning:
 * `commodities.ts`'s `ORE` is what a MINED ROCK yields, drawn by index and
 * weighted, and it has no Gem-Stones — what a hermit stocks and what a rock
 * pays are not one rule.
 */
export const HERMIT_ORE: ReadonlySet<string> = new Set(['Minerals', 'Gold', 'Platinum', 'Gem-Stones']);

/** What a hermit has run out of: anything that has to be flown in. */
export const HERMIT_SUPPLIES: ReadonlySet<string> = new Set(['Food', 'Liquor/Wines', 'Machinery']);

/** Ore is a quarter off here, and there is plenty of it. */
export const HERMIT_ORE_PRICE = 0.75;

/** Bulk stock a rock miner is never short of, on top of the rolled quantity. */
export const HERMIT_ORE_GLUT = 20;

/** Supplies cost a third more: nobody else is delivering out here. */
export const HERMIT_SUPPLY_PRICE = 1.3;
