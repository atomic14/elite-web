// The station bulletin board: how much work you may hold, and how far away a
// job may send you.
//
// The board itself — what a job pays, its deadline arithmetic, settlement —
// is game/contracts.ts, and its reward formula stays there as the shape of
// one function, pinned in aggregate by `npm run campaign`.

/**
 * The most work you may hold at once.
 *
 * Lived as a bare `>= 3` in game.ts and a bare `>= 2` in test/campaign.ts —
 * so the balance harness was playing a game with a smaller bulletin board
 * than the one that ships. (This justification sat orphaned in threat.ts, a
 * file that cannot see the constant, until the threat slice put it back
 * beside it.)
 */
export const MAX_CONTRACTS = 3;

/**
 * How far away, in tenths of a light year, a contract may send you.
 *
 * A DIVERGENCE, RECORDED RATHER THAN RESOLVED. Every other reading of
 * "reachable on a full tank" in the game is `MAX_FUEL` = 70 — the tank
 * itself, and the living galaxy's convoy range, which states "ships have a
 * 7 LY jump range" and reads MAX_FUEL for it. The board filters destinations
 * at 68, two tenths short, and nothing records whether that is a deliberate
 * margin (a job you can only just reach is a job one mis-jump fails) or a
 * transcription that predates the tank. Correcting it to MAX_FUEL widens the
 * bulletin board in every system, so it is a decision with a campaign run
 * attached, not a refactor — see docs/TODO/90-constants-cleanup.md, Open.
 * `test/contracts.test.ts` holds the real offer generator to exactly this
 * bound, from both sides.
 */
export const CONTRACT_RANGE = 68;
