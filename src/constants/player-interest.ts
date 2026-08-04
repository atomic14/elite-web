// How close you have to be before you are anybody's business.
//
// One distance with four readers, and it used to have three homes under two
// names: whether a hostile engages you (`NpcShip.update`), whether the condition
// light goes red (`hostilesNear`), whether a bought combat computer takes the
// controls (autopilot.ts), and whether a pirate stays on you rather than
// wandering off after a trader (`assignNpcTargets`). A widened copy flies your
// ship for you before anything is hostile; a narrowed one lets ships shoot you
// while the light stays yellow. `test/npc.test.ts` fails if the literal
// reappears in a consumer.
//
// Not `law.ts`'s `DEFENCE_RANGE`, which is also 9,000 and is measured from the
// STATION to decide whether Vipers launch.

/**
 * A hostile closer than this is engaged with you; further away it is scenery.
 *
 * An NPC's laser reaches 3,500, so this is the range at which a ship that has
 * decided to come for you starts closing rather than the range it can hurt you
 * from — red means something is on its way, not that it has arrived.
 */
export const PLAYER_INTEREST_RANGE = 9000;
