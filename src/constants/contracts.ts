// The station bulletin board: how much work you may hold, and how far away a
// job may send you.
//
// The board itself — what a job pays, its deadline arithmetic, settlement —
// is game/contracts.ts, and its reward formula stays there as the shape of
// one function, pinned in aggregate by `npm run campaign`.

import { MAX_FUEL } from './commander.ts';

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
 * How far away, in tenths of a light year, a contract may send you: exactly
 * as far as a full tank reaches.
 *
 * AN EXPRESSION, by decision. The board shipped filtering at 68, two tenths
 * short of the tank's 70, with nothing recording whether the margin was
 * deliberate or a transcription that predated `MAX_FUEL` — every other
 * reading of "reachable on a full tank" was already the tank itself. Chris
 * resolved it 2026-08-05: the tank is the rule, so the board reads it, and
 * 86 system pairs in galaxy 1 alone that sat in (68, 70] became offerable.
 * `test/contracts.test.ts` holds the real offer generator to exactly this
 * bound, from both sides.
 */
export const CONTRACT_RANGE = MAX_FUEL;
