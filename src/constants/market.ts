// The 1984 market model, as the career reads it: the domain of the
// fluctuation byte.
//
// The model itself — base prices, gradients, masks — is galaxy/galaxy.ts's
// table, which is DATA and stays there (docs/TODO/90 rules it out by name).
// This file holds the one number about that model the career spends: how many
// values the fluctuation byte can take, which is what an exact mean has to
// average over and what a fresh quote has to roll under.

/**
 * Every value the market's fluctuation byte can take.
 *
 * A byte, so 256 — the original rolls one per visit and the price model adds
 * it under a mask. `marketEstimate` iterates all of them so its mean is exact
 * rather than sampled, and both fresh-market rolls (`makeLocalMarket`,
 * `hermitMarket`) draw a fluctuation below it; the file used to write the 256
 * out three times, twice as a bare `randomInt(256)`.
 */
export const FLUCTUATIONS = 256;
