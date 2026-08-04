// The living galaxy's clocks: how fast the other 255 systems forget.
//
// Level 1 of the two-level simulation (galaxy/living.ts) stores only DELTAS
// off the 1984 baseline — price pressure, danger, gossip — and these three
// are the rates the deltas decay back at, per day. They are the memory of
// the galaxy: how long a shortage keeps prices up, how long a pirated route
// stays dangerous, how long word of your cargo travels ahead of you.
//
// The step arithmetic that spends them — what a convoy's arrival or loss
// adds, how government scales the recovery — is `LivingGalaxy.advance`, and
// its per-event deltas stay there as the shape of one function; `npm run
// campaign` pins the whole economy in aggregate.

/** How fast price pressure decays back toward the 1984 baseline, per day. */
export const PRESSURE_DECAY = 0.12;

/**
 * How fast talk about the player dies down, per day. Faster than
 * `DANGER_DECAY`: a system's reputation for piracy should outlast one convoy,
 * but nobody remembers one trader's cargo for a month.
 */
export const HEAT_DECAY = 0.06;

/**
 * How fast a system's reputation for piracy fades, per day — slowly, so
 * hotspots can build up along lawless trade routes. The base rate: `advance`
 * scales it by government, so a corporate state recovers up to four times as
 * fast as the lawless end of the ladder.
 */
export const DANGER_DECAY = 0.015;
