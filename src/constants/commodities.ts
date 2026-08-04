// The career's classes of the 1984 commodity table: which rows count as
// ordinary goods, what a wreck spills, and what a mined rock yields.
//
// Every list is INDICES into `COMMODITIES` in galaxy/galaxy.ts — the table
// itself is DATA and stays there; these are Harmless's own groupings of its
// rows. For reference while reading: 0 Food, 1 Textiles, 4 Liquor/Wines,
// 8 Machinery, 9 Alloys, 11 Furs, 12 Minerals, 13 Gold, 14 Platinum. The
// law's grouping (`CONTRABAND`, constants/law.ts) is the same kind of thing
// and none of these overlap it: contraband is never ordinary.
//
// THE ORDINARY-GOODS DECISION, by meaning. The survey found "ordinary goods"
// written out three times and asked whether they were one rule. Two of them
// are: what a bulletin-board consignment is made of and what a generation
// ship is still shedding are both "unremarkable legal cargo", the same six
// rows, and both read `ORDINARY_GOODS` now. The third — what an ordinary
// wreck spills — is that list PLUS FURS, and whether the extra row is a
// deliberate flourish (furs read well as loot) or a drift nobody noticed is
// not recorded anywhere. So it stays its own constant at its shipped value,
// the relationship is pinned as a check (`test/combat.test.ts` holds
// WRECK_CARGO to ORDINARY_GOODS plus Furs exactly), and collapsing them is a
// behaviour change on docs/TODO/90-constants-cleanup.md's Open list: it would
// move what every wreck in the game drops.

/**
 * Ordinary goods — the unremarkable legal cargo plain trade is made of:
 * food, textiles, liquor, machinery, alloys, minerals.
 *
 * A contract's consignment is drawn from it (game/contracts.ts) and a
 * generation ship sheds it (game/spawning.ts). ORDER AND LENGTH ARE
 * LOAD-BEARING: both consumers index it with a seeded draw, so reordering
 * the list reorders every seeded outcome even though the set is unchanged.
 */
export const ORDINARY_GOODS: readonly number[] = [0, 1, 4, 8, 9, 12];

/**
 * Cargo an ordinary wreck spills: `ORDINARY_GOODS` plus furs — see the
 * decision in the header for why that is written as a seventh literal row
 * rather than an expression. Spent by `Combat.wreck`, drawn per canister.
 */
export const WRECK_CARGO: readonly number[] = [0, 1, 4, 8, 9, 11, 12];

/**
 * What a mined asteroid yields: minerals three draws in five, else gold or
 * platinum. A WEIGHTED draw written as repeated indices — `cargo.spawn`
 * picks uniformly, so the repetition is the distribution.
 *
 * Not the hermit's ore list (`HERMIT_ORE`, constants/hermit-market.ts): a
 * hermit also stocks Gem-Stones and prices by row name; what a rock pays and
 * what a miner sells are not one rule.
 */
export const ORE: readonly number[] = [12, 12, 12, 13, 14];
