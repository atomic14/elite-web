// How close you have to be before you are anybody's business.
//
// ONE distance, in ONE file, for the same reason `break-off.ts` exists: it had
// three homes and two of them were spelled differently. `npc.ts` declared
// `CONDITION_RED_RANGE = 9000` and then, 490 lines further down, decided
// whether a hostile turns on you with a bare `distPlayer < 9000`;
// `npc-targeting.ts` declared the same number again as `PLAYER_INTEREST_RANGE`.
// Three names, one rule, kept in step by hope — which is the failure this
// project is organised against, and is exactly the shape of the break-off bug
// in docs/TODO/42, where the constant got corrected and the literal did not.
//
// WHAT IT DECIDES, and why the three had to be one number rather than three
// that happen to agree:
//
//   * whether a hostile engages you at all (`NpcShip.update`)
//   * whether the condition light goes RED (`hostilesNear`, painted by
//     hud-binding.ts)
//   * whether a purchased combat computer takes the controls (autopilot.ts)
//   * whether a pirate stays on you rather than wandering off after a trader
//     (`assignNpcTargets`)
//
// So a widened copy lights the console red and flies your ship for you 3,000
// units before anything is actually hostile, and a narrowed one lets ships
// shoot you while the light stays yellow. Both are the SAME edit made in one
// of the three places.
//
// `test/npc.test.ts` fails if the literal reappears in either consumer.
//
// Not to be confused with `law.ts`'s `DEFENCE_RANGE`, which is also 9,000 and
// is a different rule entirely: that one is measured from the STATION and
// decides whether Vipers launch. Same number, different question — and it is
// named for its own question, which is why it is not imported from here.

/**
 * A hostile closer than this is engaged with you; further away it is scenery.
 *
 * 9,000 units. An NPC's laser reaches 3,500 (`NPC_LASER_RANGE`), so this is
 * comfortably the range at which a ship that has decided to come for you starts
 * closing rather than the range at which it can hurt you — which is what makes
 * it the honest trigger for the condition light: red means something is on its
 * way, not that it has already arrived.
 */
export const PLAYER_INTEREST_RANGE = 9000;
