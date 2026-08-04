// The Navy mission, as numbers: what earns the briefing, how far away each
// leg is laid, and what the Navy pays.
//
// The five-stage machine that spends these is game/missions.ts. Money is in
// tenths of a credit (invariant 8) and distances in tenths of a light year,
// as everywhere else.

/**
 * Kills before the Navy considers you worth talking to.
 *
 * 16, as the original demanded — the one gate this game keeps from the 1984
 * mission structure, where everything else on the bulletin board was opened
 * up to a fresh commander on purpose (see game/contracts.ts).
 */
export const MISSION_KILL_THRESHOLD = 16;

/**
 * The Constrictor hides this far from where you are briefed, in tenths of a
 * light year — three to eight jumps' worth of hunt.
 *
 * Named MISSION_HUNT_RANGE rather than its old HUNT_RANGE because this
 * directory also holds `hunt-ranges.ts`, where a "hunt range" is how far a
 * predator looks for prey in world units; the two subjects must not read as
 * one.
 */
export const MISSION_HUNT_RANGE = { min: 30, max: 80 } as const;

/** The courier run is longer: the plans matter more than your convenience. */
export const MISSION_COURIER_RANGE = { min: 50, max: 90 } as const;

/**
 * What killing the Constrictor pays — 2,500 Cr, the same figure as the
 * threat model's prize saturation (`PRIZE_SATURATION`, 25,000 tenths) by
 * coincidence and not by rule: one is a Navy bounty, the other is where a
 * pirate stops caring how fat your hold is.
 */
export const CONSTRICTOR_BOUNTY = 25_000;

/** ...and what delivering the plans pays: 1,500 Cr. */
export const COURIER_PAYMENT = 15_000;
