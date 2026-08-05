// What turns up while you are flying, and how long you wait for it.
//
// Three clocks — a trader arriving from deep space, a pirate wave in lawless
// space, a Thargon peeling off a mothership — plus the conditions that decide
// whether the clock striking produces anything. Together they are how dangerous
// every system in the galaxy FEELS, which is why they are named rather than
// left as literals inside one function: nothing else in the game decides so
// much from so few numbers.
//
// Who is here when you arrive is `population.ts`; where any of it is put is
// `spawn-placement.ts`. The rule that spends these is `stepEncounters` in
// game/encounters.ts, which reports what should appear and never places it.
//
// Every gap below is in SECONDS of flight, and every one is a base plus a
// jitter: a fixed cadence is audible after ten minutes, and a player who can
// count the beat between pirate waves stops treating them as a hazard.

/**
 * The gap between trader arrivals in a system with no economy to speak of...
 *
 * The ceiling of the range rather than the middle: productivity only ever
 * subtracts (`TRADER_GAP_BUSY_MAX`), so this is the slowest lane in the galaxy
 * and a rich system runs at half of it.
 */
export const TRADER_GAP = 100;

/** ...and the jitter on top, drawn flat, so the lane never runs to a metronome. */
export const TRADER_GAP_JITTER = 60;

/**
 * The most a busy economy can discount off `TRADER_GAP`.
 *
 * A GUARD RATHER THAN A LIVE RUNG, measured 2026-08-04 over all 2,048 systems
 * of the eight galaxies: productivity runs 768 to 56,320, median 11,520, so the
 * discount runs 0.6s to 46.9s and NO system in the game reaches this cap. What
 * it stops is a change elsewhere — a re-scaled productivity, a smaller
 * `PRODUCTIVITY_PER_SECOND` — turning one rich system into a continuous stream
 * of traders held back only by `MAX_TRADERS`.
 *
 * The live range is what matters for how the galaxy feels: a median system runs
 * its lane at about 90s + jitter and the richest at about 53s + jitter, so the
 * gap between the emptiest and the busiest place in the galaxy is roughly two
 * to one.
 */
export const TRADER_GAP_BUSY_MAX = 50;

/**
 * How much 1984 productivity buys one second off that gap.
 *
 * `productivity` is the source's own `((economy ^ 7) + 3) * (government + 4) *
 * population * 8` (galaxy/galaxy.ts), so this is the exchange rate between a
 * transcribed 1984 figure and a Harmless clock — the only place the two scales
 * meet, and the reason neither can be re-based without the other.
 */
export const PRODUCTIVITY_PER_SECOND = 1200;

/**
 * How long after a system's clocks are started the first trader may appear...
 *
 * Well short of the steady-state gap on purpose: the lane should look alive
 * before you have finished the cruise in from the witchpoint (about 28 seconds
 * clean — see `TORUS_MULTIPLIER`), and a system that takes two minutes to show
 * you its first arrival reads as empty. The clocks are restarted by
 * `freshTimers` on every hyperspace arrival, so this is the wait a player
 * actually experiences on landing in a new system.
 */
export const TRADER_GAP_FIRST = 20;

/** ...and its jitter, so two arrivals in the same system are not the same arrival. */
export const TRADER_GAP_FIRST_JITTER = 40;

/**
 * The gap between pirate waves in the most organised system that still breeds
 * them, and the first wave's countdown when you arrive.
 *
 * ONE NUMBER WITH TWO USES, and it was written out twice: `freshTimers` set the
 * first countdown to 60 and the reset computed `60 + government * 40 + ...`.
 * They are the same base — the first wave is simply the ladder's bottom rung
 * with no government term and no jitter — and nothing said so.
 */
export const PIRATE_WAVE_GAP = 60;

/**
 * ...and how much longer the wait grows for every step up the government
 * ladder.
 *
 * Piracy pressure scales with lawlessness, so an anarchy (0) waits the base
 * alone and a corporate state waits nearly five minutes — by which time
 * `LAWLESS_GOVERNMENT` has refused the wave anyway. The ladder still runs the
 * whole way up rather than stopping at the lawless line, because the timer is a
 * clock and not a gate: it keeps the refused systems from all becoming due at
 * once if that line ever moves.
 */
export const PIRATE_WAVE_GAP_PER_GOVERNMENT = 40;

/** ...and the jitter, wider than the trader lane's because an ambush should not be timeable. */
export const PIRATE_WAVE_GAP_JITTER = 90;

/**
 * Governments at or below this breed pirate waves at all.
 *
 * 3 is a dictatorship on the 1984 ladder, so waves stop at communist (4) and
 * above. It is the line between "space that is policed" and "space where you
 * are on your own", and it is the same line the player is asked to weigh when
 * a rich cargo is only worth carrying through an anarchy.
 */
export const LAWLESS_GOVERNMENT = 3;

/**
 * ...and governments at or below THIS send them two at a time.
 *
 * Anarchy (0) and feudal (1). Not the same rule as `policeFor`'s ladder in
 * game/population.ts, which puts the line between 0 and 1 — one patrol arrives
 * at feudal, and a second pirate does not stop until above it. The two lines
 * are a step apart deliberately: a feudal system has exactly one patrol and
 * pairs of pirates, which is what makes it the most dangerous place that still
 * has a police force.
 */
export const ANARCHY_GOVERNMENT = 1;

/**
 * A commander closer than this to the station is not worth ambushing.
 *
 * The station's own Vipers are the reason: jumping someone on the doorstep
 * starts a fight the pirate cannot finish, and it also removes the one place in
 * a system a player can reliably catch their breath. Well outside the station's
 * mass lock (5,000, `torus.ts`), so the safe zone is bigger than the zone where
 * the drive lets go — you are already clear of the ambush by the time you have
 * finished the approach.
 *
 * The same number as `npc.ts`'s unnamed 7,000 give-up range for an NPC hunting
 * another NPC, which is a different rule; see docs/TODO/90-constants-cleanup.md.
 */
export const AMBUSH_STANDOFF = 7000;

/**
 * How many drones one Thargoid mothership keeps in the sky.
 *
 * The same number as `MAX_TRADERS` and NOT the same rule — that one is how much
 * traffic a system carries, this is how much a single mothership can put in
 * front of you at once. The survey lists nine constants at 4 in this codebase
 * and only two of them are one rule.
 */
export const MAX_THARGONS = 4;

/**
 * Seconds between one drone and the next, and the wait for the first.
 *
 * A mothership keeps deploying while it lives, so this is the pressure that
 * makes killing the mother the actual objective: at 5 seconds it replaces a
 * drone faster than most commanders kill one, and the fight does not end until
 * the source does.
 */
export const THARGON_REDEPLOY = 5;
// The witch-space ambush used to set this same timer to 4 through a second
// constant (THARGON_AMBUSH_DELAY), a divergence with no recorded reason.
// Chris resolved it 2026-08-05: one timer, and every mis-jump's first drone
// now comes at the same 5 seconds the mothership always redeployed at.
