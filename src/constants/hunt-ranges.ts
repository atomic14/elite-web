// How far an NPC looks for another NPC to fight — the fights the player is not
// in. Who ends up hunting whom is `game/npc-targeting.ts`.
//
// Whether YOU are worth coming for is `player-interest.ts`'s 9,000, which is
// wider because it is where a ship starts closing rather than where it can shoot.
//
// Two of the three are 6,000 and they are not merged. `SCANNER_RANGE` in hud.ts
// is a third; "everything engages at scanner range" is a plausible rule that
// nothing states, and asserting it would couple a pirate's appetite to the
// console's draw distance. The console's own slice settles it.

/**
 * How far a pirate will look for a trader to rob. Appetite rather than eyesight:
 * how far a payday is worth flying for when no commander is in reach.
 */
export const PIRATE_HUNT_RANGE = 6000;

/**
 * Police sweep a little wider — they are looking for trouble on purpose. The one
 * of the three that differs, which is why these are per-role and not one shared
 * sight radius.
 */
export const POLICE_HUNT_RANGE = 6500;

/**
 * How far a bounty hunter will look for a pirate to collect on. Separate from
 * `PIRATE_HUNT_RANGE` so that changing how the law ranges does not also make
 * every pirate in the galaxy greedier.
 */
export const HUNTER_RANGE = 6000;
