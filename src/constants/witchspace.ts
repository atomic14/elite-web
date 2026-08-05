// Mis-jump limbo: where the scenery goes, and what is waiting for you there.
//
// Witch-space is nowhere. There is no planet, no station and no sun, and the
// only things in it are Thargoids. Rather than make the whole world nullable
// for a state the player reaches on nine jumps in a hundred, the system scene is
// reused and its furniture is thrown out of reach of every distance check.
//
// What it COSTS to get out is `jump.ts`'s `WITCHSPACE_ESCAPE_COST`, and how
// often you land here is that file's two mis-jump chances. This file is only the
// place itself. The drones the mothership then deploys are `encounters.ts`.

/**
 * Where the planet, the station and the sun are put while you are in
 * witch-space.
 *
 * A SENTINEL, not a distance: it is used as a coordinate on each axis, so the
 * furniture ends up around 1.4e8 units out. Every check that asks how far you
 * are from something — mass lock, the sun's heat ladder, the docking box, the
 * compass — takes its natural answer and reads "not here", so no subsystem needs
 * a witch-space branch. That is the whole design, and it is cheaper than a
 * nullable world type.
 *
 * Big enough to leave no doubt and small enough to stay exact in a double, which
 * is what stops a distance comparison behaving strangely at the edge.
 */
export const BANISHED = 1e8;

/**
 * How fast you are travelling the moment you arrive in witch-space.
 *
 * Half the commander's top speed, and slower than an ordinary hyperspace
 * arrival (250): you have come out of a failed jump rather than a good one, and
 * the ambush opens immediately, so arriving at cruise would mean flying into the
 * Thargoids before the console has finished saying so.
 */
export const WITCHSPACE_ENTRY_SPEED = 200;

/**
 * The fewest Thargoids waiting...
 *
 * Never one. A single Thargoid is a duel and this is an ambush — the point of a
 * mis-jump is that it is the worst thing that can happen to a jump, and being
 * outnumbered from the first frame is what makes it read that way.
 */
export const THARGOID_AMBUSH_MIN = 2;

/** ...and the chance of a third. */
export const THARGOID_AMBUSH_EXTRA_CHANCE = 0.3;

/**
 * How far out they are waiting...
 *
 * Well inside `PLAYER_INTEREST_RANGE`, so they are already coming for you when
 * the screen finishes fading in.
 *
 * It is also exactly `NPC_LASER_RANGE` (npc-gun.ts) — the nearest Thargoid
 * starts at the outer edge of its own gun and cannot shoot before you have the
 * controls — and that is left as a coincidence rather than expressed. Nothing
 * anywhere states it, and the two would then be impossible to separate: the
 * ambush's opening distance is a question about what a player can survive, and
 * the NPC laser's reach is a question about the fight everywhere in the game.
 */
export const THARGOID_AMBUSH_RANGE = 3500;

/** ...and the width of that band, so they do not all arrive at one distance. */
export const THARGOID_AMBUSH_RANGE_SPAN = 2500;

/**
 * Seconds before the console first suggests the distress beacon, once you are
 * stranded — in witch-space with less fuel than `WITCHSPACE_ESCAPE_COST` and
 * no beacon running.
 *
 * Two different numbers for two different rules, not a divergence (the survey
 * flagged the pair): the FIRST hint comes quickly, because a player who does
 * not know the B key is stuck in an empty sky with no way out, and every
 * REPEAT after it comes slowly, because the reminder is for someone busy
 * fighting Thargoids, not a metronome. The timer starts at the first value in
 * every fresh session and only counts down while actually stranded.
 */
export const STRANDED_HINT_FIRST = 2;

/** ...and seconds between repeats of the same hint thereafter. */
export const STRANDED_HINT_REPEAT = 8;
