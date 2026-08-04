// Where the sky puts a ship when it appears.
//
// Every one of these is a DISTANCE, and `population.ts` and `encounters.ts` are
// the two files that decide whether anything is placed at all — what a system
// holds when you arrive, and what turns up while you fly. This file is the third
// part of that split and the only one with a position in it.
//
// TWO SHAPES, AND THEY READ DIFFERENTLY:
//
//   * A `_SCATTER` is a NOMINAL radius. `scatter()` in game/spawning.ts puts a
//     ship at `range * (0.5 + random())` in a random direction, so a scatter of
//     1,800 lands somewhere between 900 and 2,700 out. The number below is the
//     middle of that band, not its edge.
//   * A `_RANGE` with a `_SPAN` beside it is the floor and the width of a flat
//     draw: `RANGE + random() * SPAN`. Here the number below IS the nearest a
//     ship can be.
//
// Where an authored exercise puts its opposition is `opposition-ring.ts` — the
// same job for a different plan, and deliberately not the same numbers, because
// a trainer's opening is chosen for what the pilot can see and a system's for
// where its traffic would actually be.

/**
 * How far from the station a trader on its run is loitering.
 *
 * Near enough that the station reads as the place they are all going, far
 * enough that they are not queued in the slot. This is where they START; a
 * trader with somewhere to be flies off under its own rules.
 */
export const TRADER_SCATTER = 1800;

/**
 * ...and the police, who sit closer in.
 *
 * The tightest of the six, and the reason is the job: a patrol is guarding the
 * station rather than travelling, so it should read as belonging to the
 * station. It also means a commander who launches into trouble is in reach of
 * the law immediately, which is what makes a high-government system feel
 * different to fly in rather than merely safer on paper.
 */
export const POLICE_SCATTER = 1200;

/**
 * ...and the rocks, which are scenery and therefore spread widest of the three
 * things a peaceful system holds.
 *
 * The same number as the station's mass-lock radius (`MASS_LOCK_STATION`,
 * torus.ts) and NOT the same rule: the rocks land between 2,500 and 7,500 out,
 * so the field straddles the lock rather than sitting outside it. Nothing
 * chooses it against the lock and nothing should.
 */
export const ASTEROID_SCATTER = 5000;

/**
 * ...and the bounty hunter, who is working the whole system rather than the
 * station.
 *
 * The same number as `PIRATE_HUNT_RANGE` and `HUNTER_RANGE` in `hunt-ranges.ts`
 * — a hunter starts about as far out as it can see — and that MAY be a real
 * relationship rather than a coincidence. It is not expressed, because nothing
 * anywhere states it and the two are different quantities: one is where a ship
 * begins, the other is how far it looks. If it is meant to hold, the thing to
 * write is a check that the hunter's start is within its own sight of the
 * traffic, not an equals sign here. `hunt-ranges.ts` records the third 6,000.
 */
export const HUNTER_SCATTER = 6000;

/**
 * ...and the rock hermit, hidden far enough out to be worth finding.
 *
 * Two and a half times the asteroid field's nominal radius: the hermit is
 * supposed to be at the far edge of the rocks rather than in the middle of
 * them, and a player who wants one has to go looking. Its trade offer opens at
 * 900 units (game/world-step.ts), so nobody stumbles into it.
 */
export const HERMIT_SCATTER = 14_000;

/**
 * The reception's spread down the corridor: where along the route from you to
 * the station the nearest pirate can be, as a fraction of that route...
 *
 * A FRACTION rather than a distance, so the ambush scales with the arrival
 * geometry. `WITCHPOINT_RADII` (planet.ts) decides how long the cruise in is,
 * and it has been changed twice; a reception written in absolute units would
 * have bunched at one end of the new corridor both times, silently.
 *
 * A tenth of the way in, so nobody is waiting on top of the witchpoint. The
 * first thing a player does on arrival is get their bearings, and being shot at
 * during it reads as unfair rather than as dangerous.
 */
export const CORRIDOR_START = 0.1;

/**
 * ...and how much of the route the rest of them are spread across.
 *
 * 0.1 + 0.75 leaves the last 15% clear, which is the approach to the station —
 * the same reasoning as `AMBUSH_STANDOFF` in `encounters.ts` reached for later
 * arrivals, in a different currency, and the two are not expressed in terms of
 * each other because a fraction of one route and an absolute standoff cannot be
 * one number.
 */
export const CORRIDOR_SPAN = 0.75;

/**
 * ...and how far off the corridor's line each of them sits.
 *
 * The reception is a spread rather than a firing line: a gang strung out along
 * one axis arrives in sequence and is fought one at a time, which is easier
 * than it should be. This is what makes an organised gang feel like a gang.
 */
export const PIRATE_SCATTER = 2500;

/**
 * How far out a fresh trader warps in.
 *
 * Deliberately much further than the traders that were already here
 * (`TRADER_SCATTER`): an arrival is meant to read as coming FROM somewhere, so
 * it appears at the edge of the sky and flies in. The witch-flash that marks it
 * is drawn at the same point.
 */
export const TRADER_ARRIVAL_RANGE = 22_000;

/**
 * How far from the commander a pirate wave warps in...
 *
 * THE SAME NUMBER AS `PLAYER_INTEREST_RANGE` (player-interest.ts), which is
 * where an NPC starts caring about you at all, and it is left as a literal
 * rather than expressed as that. The reading that a wave should arrive exactly
 * at the edge of notice is plausible and nobody has written it down; the survey
 * that found the pair says "almost certainly", which is not an argument for
 * asserting it. Expressing it would claim that moving where a hostile starts
 * closing should also move where a wave appears, and the two would then be
 * impossible to separate again.
 *
 * What can be said: at this range the wave is already interested in you the
 * frame it exists, so the announcement on the console is not ahead of the
 * fight. See docs/TODO/90-constants-cleanup.md.
 */
export const PIRATE_WAVE_RANGE = 9000;

/** ...and how much further out than that they may be. */
export const PIRATE_WAVE_RANGE_SPAN = 4000;

/**
 * How far from the commander a generation ship is crossing...
 *
 * Far out, and drawn wide, because the thing is enormous and meeting it head-on
 * would be a collision rather than a sighting. The Game announces it inside
 * 6,000, so at the near end of this band you are told about it almost at once
 * and at the far end you have to go and look.
 */
export const GENERATION_SHIP_RANGE = 14_000;

/** ...and the width of that band. */
export const GENERATION_SHIP_RANGE_SPAN = 8000;

/**
 * How far from a generation ship the cargo it is still shedding drifts.
 *
 * Close enough to read as coming off the hull rather than as an unrelated
 * find. What the canisters CONTAIN is `ORDINARY_GOODS` (commodities.ts);
 * how many is a draw that stays inline in game/spawning.ts.
 */
export const GENERATION_CARGO_SCATTER = 700;

/**
 * How far from the commander the Constrictor is hiding, when the mission says
 * this is the system...
 *
 * Nearer than any other authored arrival, and that is the point: the mission
 * leg is meant to become a fight quickly rather than a search. The player has
 * been told it is here.
 */
export const MISSION_TARGET_RANGE = 4000;

/** ...and the width of that band — the same again, so it can be twice as far. */
export const MISSION_TARGET_RANGE_SPAN = 4000;

/**
 * How far from its mother a Thargon drone appears.
 *
 * Almost on top of it, which is what makes a mothership read as the source of
 * the problem: the drones come off it visibly rather than materialising in open
 * space, and killing the mother is obviously the answer.
 */
export const THARGON_DEPLOY_RANGE = 150;

/**
 * The fewest Vipers the station launches when you have shot at something you
 * shouldn't...
 *
 * The count and the two numbers below are ONE rule — a short stack along the
 * slot normal, jittered — and they are here rather than with the station's own
 * constants because `launchStationDefence` is the thing that spends all four
 * and it is a spawn. WHETHER they launch is `DEFENCE_RANGE` (constants/law.ts).
 */
export const STATION_DEFENCE_MIN = 1;

/**
 * ...and the width of that draw: one or two of them.
 *
 * What shipped, and nothing records how it was chosen. What can be said for it
 * is that it is the smallest escalation there is — a second Viper doubles the
 * answer while leaving it survivable — and that the same launch can be
 * triggered again, so a player who keeps shooting keeps drawing from it.
 */
export const STATION_DEFENCE_SPAN = 2;

/**
 * How far out of the slot the first of them launches.
 *
 * Along the slot normal, so they come out of the station rather than appearing
 * beside it.
 */
export const STATION_DEFENCE_STANDOFF = 500;

/**
 * ...and how much further out each one after it starts, so a pair does not
 * arrive inside each other.
 *
 * Three times a Viper's contact radius of 18.75, which sounds ample and is not
 * quite, because of the jitter below.
 */
export const STATION_DEFENCE_STACK = 120;

/**
 * ...and the random nudge on each, so the second launch of an evening does not
 * look like the first.
 *
 * IT IS BIGGER THAN THE STACK SPACING CAN ABSORB. Each ship is displaced by a
 * full 80 units in an independent direction, so a pair separated by 120 along
 * the normal can end up anywhere from 0 to 280 apart. Simulated over a million
 * pairs: the closest was 1.2 units, and 1.16% of pairs land with their hulls
 * intersecting (inside 2 x a Viper's 18.75 contact radius). Flown for real
 * through `launchStationDefence` over 400 seeded launches, the closest pair
 * came out at 27 units, which is inside that. It has presumably never been
 * noticed because both ships are moving within a frame of launching.
 *
 * Left as it stands: shrinking the jitter or growing the stack changes where
 * every station-launched Viper in the game appears, which is a behaviour change
 * and not a tidy-up. `test/world.test.ts` asserts only that the positions
 * differ, which is a much weaker claim than "not spawned on each other" and now
 * says so.
 */
export const STATION_DEFENCE_JITTER = 80;
