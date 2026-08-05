// Threading the station slot: the letterbox, the approach that lines you up on
// it, and the cube that says you hit the hull instead.
//
// The rules that spend these are `game/docking.ts` — `planDocking` flies the
// approach for NPC traders and the player's docking computer alike, and
// `dockingOutcome` is the ONE answer to "are you docked, bounced, or clear"
// for everything with a hull. What a miss COSTS is the orchestrator's
// (`IMPACT.stationScrape`, and `BOUNCE_STANDOFF` in ./station.ts).
//
// WHICH WAY UP THE LETTERBOX IS. Both released stations put their slot on the
// front face as a rectangle that is TALLER THAN IT IS WIDE in station-local
// coordinates — 20x60 on the Coriolis, 32x64 on the Dodo — so the long axis a
// ship's wings must line up with is the station's local Y. Harmless drew a
// horizontal 96x20 for years and `game/docking.ts` was written the other way
// round; the exact hulls arrived with TODO 25 and the axes swapped with them.
// What did NOT change is how precisely you have to fly: the channel below is
// the same rectangle it always was, turned a quarter turn with the slot.

/**
 * How far out the approach gate sits, in multiples of the station half-width.
 *
 * A RATIO rather than a distance, deliberately: the gate scales with the hull,
 * so a Dodo's longer approach comes from its bigger box and not from a second
 * number. Five half-widths is 800 units at a Coriolis and 980 at a Dodo.
 */
export const GATE_HALF_WIDTHS = 5;

/**
 * Off-axis error we insist on before committing to the run in, in world units.
 *
 * Skipping the lateral test is the obvious mistake: a ship that reaches the
 * gate 150 units off-axis and then flies straight carries that error into the
 * hull instead of the slot. Once committed, `planDocking` tolerates twice this
 * — the phase latches, or the shrinking `along` would flip it back to 'gate'
 * and the ship would turn round and fly out again, an oscillation that never
 * docks and is exactly what the first version did. The same figure is the
 * lateral half of `arrived`, which is what NPC traders dock on.
 */
export const LINED_UP_LATERAL = 45;

/**
 * Bounding cube around the station, a little larger than the hull, as a margin
 * over the half-width in world units. Inside it you are either in the slot
 * channel or you have hit the hull.
 *
 * Measured against the widest point of both released hulls at the scene's
 * station scale: the Coriolis reaches 160 on every axis against a 160 slot
 * plane, and the Dodo's five tallest vertices reach 243 against a 196 one. 50
 * clears both, which is what "a little larger than the hull" has to mean if a
 * ship is not to slip past a vertex and be reported clear.
 */
export const HULL_BOX_MARGIN = 50;

/**
 * The same cube for every NPC — and it is the SAME RULE as the player's now,
 * by decision rather than luck (Chris, 2026-08-05).
 *
 * It shipped as a bare `+ 40` in `world-step.ts` with no comment, against the
 * player's measured 50 above: 196 + 40 = 236 while the Dodo's tallest
 * vertices are at 243, so NPC traffic flew through the Dodo's hull and was
 * reported clear. The Coriolis was covered either way (160 + 40 = 200), which
 * is why nobody had seen it — the Dodo only appears at `DODO_TECH_LEVEL`. 50
 * is the only measured value, so both cubes read it: the Dodo's face moved
 * 236 → 246 and the Coriolis's 200 → 210, and NPC traffic near a Dodo now
 * bounces where it silently clipped.
 */
export const NPC_HULL_BOX_MARGIN = HULL_BOX_MARGIN;

/**
 * The slot channel, as half-extents ACROSS the slot and ALONG it, in
 * station-local world units.
 *
 * The released slots are 20x60 (Coriolis) and 32x64 (Dodo), long axis vertical
 * in station-local coordinates. These are the same 52x124 tolerance Harmless
 * has always allowed, turned to match — not a re-tuning. Sized from the
 * narrower of the two so one rule covers both stations, and a ship that
 * threads the Coriolis threads the Dodo.
 */
export const SLOT_HALF_ACROSS = 26;
export const SLOT_HALF_ALONG = 62;

/** How far into the -Z face counts as being in the channel, in world units. */
export const SLOT_DEPTH = 60;

/**
 * Wings vs the slot's long axis, in radians — how badly you may be rolled and
 * still fit through the letterbox. A quarter turn's worth of tolerance either
 * side, and symmetric: a ship upside down in the slot still fits through it.
 */
export const ROLL_TOLERANCE = 0.65;
