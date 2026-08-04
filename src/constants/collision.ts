// Ships are solid: the commander's contact radius, and what a collision costs in
// speed. The overlap tests are `game/collisions.ts`; what a ram costs in DAMAGE
// is `IMPACT.ram` in `./impact.ts`.

/**
 * Speed retained after a collision — a ram should cost you your run.
 *
 * Three values for three kinds of contact rather than one rule written three
 * times: the station's already differs, which is what says the kind is what
 * decides it. The player's and an NPC's agree today and nothing requires them to.
 */
export const PLAYER_SPEED_KEPT = 0.3;
export const NPC_SPEED_KEPT = 0.3;
export const STATION_SPEED_KEPT = 0.4;

/**
 * The commander's own contact radius, in world units.
 *
 * Read by two rules, not one: the overlap test, and `tacticsFor`'s gate on
 * whether a pass clears both hulls.
 */
export const COMMANDER_HULL_RADIUS = 25;
