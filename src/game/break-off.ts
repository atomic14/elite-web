// How close a hostile lets itself get before it turns away — and where a
// trained pilot hands the flying over.
//
// ONE distance, in ONE file, because it had two homes and they drifted. The
// number lived as a hardcoded `dist < 220` at the top of `NpcShip.attack` and
// again as `RAM_GUARD = 220` in brains.ts; the second was corrected and the
// first never was, which is exactly the failure CLAUDE.md is organised against
// — one rule with two homes, kept in step by hope. Both files import from here
// now, and `test/npc.test.ts` fails if the number reappears as a literal in
// either.
//
// STEERING AND FIRING ARE TWO DECISIONS. That is the other half of the bug and
// it is a design decision, not a refactor: `attack()` used to `return null` the
// moment it broke off, so breaking off and holding fire were one statement, and
// every police ship, bounty hunter, Thargoid and knife-range pirate went silent
// inside 220 units. Measured, a police ship nose-on to a stationary commander
// fired 16 times in 20 seconds from 240 out and ZERO at 210, 180 and 120 —
// which is Chris's "it feels almost like they stop shooting when they get
// close", because his recorded median engagement range is 260 and his 10th
// percentile 214.
//
// Nothing ever argued for the silence. A ship turning away that has you in its
// gate should shoot, so `attack()` steers away AND runs `npcTriggerPull`, which
// already applies the gate, the range and the cooldown. A ship that cannot get
// its nose on you still does not fire — that is the honest version of what the
// player is feeling, and it is one gate, not a second one.
//
// THE RULE IS THE SAME FOR EVERY HOSTILE. A pirate, a police ship, a bounty
// hunter and a Thargoid all reach `attack()` and all break off and shoot at the
// same distance. The only difference any of them gets is the one that was
// already there: a Thargoid's `THARGOID_FIRE_RATE` multiplier on the shared
// cooldown, stated in gunnery.ts as a fire rate rather than as a second range.

/**
 * A ship this close to what it is fighting stops closing and turns away.
 *
 * It does NOT stop shooting — see the header. This is a steering rule and
 * nothing else.
 *
 * 220 units, and it is the range the scripted chase has always broken off at.
 * The two hulls in a knife fight are around 68 units of radius before they
 * touch and a ship re-decides its heading at 10 Hz, so the margin here is
 * several decision ticks of turning room at closing speeds the game can
 * actually produce.
 */
export const BREAK_OFF_RANGE = 220;

/**
 * Range at which a trained pilot stops flying its own policy and hands the
 * ship over to the scripted break-off above.
 *
 * The simulator the pre-generation policies were fitted in had NO collision
 * model, so flying straight through the target was free and the optimal learnt
 * behaviour was to close to zero range and sit there shooting. In the game,
 * where ships are solid, that reads as deliberate ramming: the pirate slides
 * past you and kamikazes. Collisions were added to the simulator and then, with
 * the simulator's deletion, stopped being a model at all — episodes call
 * collisions.ts. The hand-over remains for brains fitted before either
 * (docs/TRAINING-LOG.md).
 *
 * The generation brains do not need it as wide: they destroy themselves in 1-9%
 * of engagements against 36-73% for the brain they replace, so they keep flying
 * their own policy until a collision is genuinely imminent.
 *
 * 150, and the number is arithmetic rather than taste. It was 90 for one wave
 * and both of Chris's arena fights had ships fly into him. A pirate re-decides
 * at 10 Hz, so a head-on closure — 300 for the pirate against the player's 400
 * — covers 70 units between decisions, and the two hulls are 68 units of radius
 * before they touch. A 90-unit guard leaves 22 units of margin: less than one
 * decision tick, so breaking off is not something the ship is physically able
 * to do. 150 gives it a tick to turn.
 *
 * It is no longer a dead zone for the gun. Handing over used to switch the guns
 * off, which is why this number had to clear the range a human fights at; it
 * still does, but `attack()` shoots now, so what is handed over is the flying
 * and only the flying.
 *
 * `pirate-attack-r2` is the exception and keeps the full `BREAK_OFF_RANGE`,
 * because it is the brain that kamikazes — see `pirateBrainFor`.
 */
export const BRAIN_HANDOVER_RANGE = 150;
