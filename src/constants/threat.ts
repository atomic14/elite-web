// Who is worth robbing, as numbers: what makes a commander look like a prize,
// what makes one look like trouble, and which tier of hull comes to collect.
//
// The rules that spend these are `pirateThreat`, `sourceThreatScore` and
// `hullThreatTier` in game/threat.ts, and `npm run campaign` is tuned against
// all of them — a change here is a balance change and the 33 balance rows are
// the measurement it has to answer to. The one threat number NOT here is
// `FAME_FULL`, which is the rating ladder's own Dangerous rung and waits in
// game/threat.ts for the ladder to have a home it can derive from.

/**
 * Share of receptions that are challengers, at full fame.
 *
 * Fame cuts both ways: a reputation scares off thieves looking for easy cargo
 * and simultaneously draws people who want to be the ones who killed you. That
 * draw is an OCCASIONAL CHALLENGE, not a permanent tax — folding fame straight
 * into the tier made 99% of receptions gangs once a commander hit Dangerous,
 * which is monotonous and erases the whole tier ladder. At Dangerous, about a
 * third of receptions are someone coming for the reputation rather than the
 * cargo. `test/economy.test.ts` bisects the challenge roll out of the real
 * `pirateThreat` and compares it to this.
 */
export const CHALLENGE_RATE = 0.35;

/**
 * Cargo value, in tenths of a credit, at which the prize term saturates.
 *
 * Saturating on purpose: the gap between 200 and 2,000 credits of cargo
 * matters; the gap between 20,000 and 40,000 does not. Keeping saturation high
 * preserves the gap between a good load and a fat one — the tier thresholds,
 * not the prize curve, set how often each tier appears.
 *
 * THE VALUE AND ITS OWN PROSE DISAGREE, AND THAT IS RECORDED RATHER THAN
 * RESOLVED. 25,000 tenths is 2,500 Cr, and the comment this constant carried
 * for its whole life said "1,600 Cr". The sweep quoted beside it was written
 * against the 1,600 reading too: "this makes gangs ~5% of receptions (2 per
 * career for a wealthy commander) while holding deaths per career at the 1.4
 * baseline. Lower it and gangs get commoner but the wealth curve collapses
 * (1,200 Cr -> 9% gangs but median net worth 2,242 Cr against 3,661)." Either
 * the constant moved from 16,000 and the prose did not follow, or the prose
 * was wrong when it was written — the survey could not establish which from
 * the history. 25,000 is what shipped, what the campaign's 33 rows are tuned
 * against, and what stays; choosing the other reading moves how often every
 * wealthy commander meets a gang, so it is a decision with a measurement
 * attached, not a refactor. See docs/TODO/90-constants-cleanup.md, Open.
 */
export const PRIZE_SATURATION = 25000;

/**
 * How dangerous one released build looks, from the pack's own numbers: the
 * weights on the three fields that decide whether a pirate is a nuisance or a
 * problem.
 *
 * Three fields, because three things matter: how much shooting it survives
 * (`maxEnergy`, weight 1 — the base the other two are scaled against), how much
 * of each hit it shrugs off (`perHitDefence` — the subtraction, so a point of
 * it is worth far more than a point of energy), and how hard it hits back
 * (`laserPower`). Speed is deliberately absent: a fast hull is harder to catch,
 * not harder to beat, and weighting it made the Sidewinder outrank the Cobra.
 *
 * The weights are Harmless's and the numbers they multiply are the source's.
 * `test/ship-roles.test.ts` solves both weights back out of the real
 * `sourceThreatScore` over the rostered builds and compares them to these.
 */
export const DEFENCE_WEIGHT = 12;
export const LASER_WEIGHT = 8;

/**
 * Score at or above which a hull is a professional's, then a gang's.
 *
 * The tier ladder over `sourceThreatScore`: below the first line a hull is an
 * opportunist's, at it a professional's, at the second a gang ringleader's.
 * `test/ship-roles.test.ts` bisects both thresholds out of the real
 * `tierForScore`, so a re-inlined literal in the ladder costs a red line.
 */
export const PROFESSIONAL_SCORE = 110;
export const GANG_SCORE = 160;

/**
 * Hulls held at a tier the score alone would not give them, and why.
 *
 * ONE entry, and it has to exist: the builds these two turn up in as PIRATES —
 * `V:17` and `W:19`, which is what `role-variants.ts` picks and therefore what
 * the scorer reads — are the same ship in every field that matters (energy 82,
 * defence 2, laser 5, weapon byte 40; score 146 each), so no classification
 * over source data can separate them. It was true of the recommended defaults
 * before TODO 29 and it is still true of the pirate builds after it.
 * The Sidewinder is the cheap hull an opportunist flies in every version of
 * this game and the Krait is what turns up when someone means it, and that
 * distinction is worth keeping. It is a curated exception, stated here rather
 * than smuggled in as a tie-break nobody would find.
 *
 * Keyed on the design-id string `hullThreatTier` is handed — plain strings, so
 * no type leaves this directory; `test/ship-roles.test.ts` pins the Sidewinder
 * as the one exception, so a key that stops matching goes red rather than
 * silently un-curating it.
 */
export const CURATED_TIER: Record<string, 0 | 1 | 2> = {
  'elite-a:design:17': 0, // Sidewinder — see above
};
