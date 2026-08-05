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
// THE ORDINARY-GOODS DECISION, by meaning — settled. The survey found
// "ordinary goods" written out three times and asked whether they were one
// rule. They are ONE now (Chris, 2026-08-05): a bulletin-board consignment,
// a generation ship's shed cargo and an ordinary wreck's spill are all the
// same six rows of unremarkable legal cargo. The wreck's list had carried a
// seventh row — Furs — with no recorded reason; whether it was flavour or
// drift, nobody had chosen it, so the extra row went and every wreck now
// spills exactly the consignment class. `test/combat.test.ts` flies seeded
// wrecks and holds the spill to this list.

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
 * What a mined asteroid yields: minerals three draws in five, else gold or
 * platinum. A WEIGHTED draw written as repeated indices — `cargo.spawn`
 * picks uniformly, so the repetition is the distribution.
 *
 * Not the hermit's ore list (`HERMIT_ORE`, constants/hermit-market.ts): a
 * hermit also stocks Gem-Stones and prices by row name; what a rock pays and
 * what a miner sells are not one rule.
 */
export const ORE: readonly number[] = [12, 12, 12, 13, 14];
