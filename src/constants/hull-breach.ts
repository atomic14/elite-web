// What a hit that gets past the shields costs you, beyond the points: how often
// it wrecks something, whether that something is cargo or a fitting, and which
// fittings can go.
//
// "The ship's computer will keep you informed." The rule that spends these is
// `breachLoss` in game/systems.ts; what the hit costs the BANK is `applyDamage`
// beside it, and this is the second, separate consequence of the same hit.

/**
 * Chance a hit that reaches the hull wrecks cargo or a fitting.
 *
 * A PROPERTY OF THE HIT, NOT OF HOW BIG IT WAS, and the pools growing is what
 * makes that worth stating. TODO 27 made a bank 255 points instead of 4, so the
 * number of POINTS arriving in a fight went up 64 times; a chance rolled per
 * point, or scaled by the amount of damage, would have multiplied how often
 * equipment breaks by nothing more than a unit conversion. `applyDamage` rolls
 * exactly once per penetrating hit and `test/systems.test.ts` counts the rolls.
 */
export const EQUIPMENT_DAMAGE_CHANCE = 0.25;

/**
 * Cargo is lost this often when there is any aboard — equipment is rarer.
 *
 * Only reached once `EQUIPMENT_DAMAGE_CHANCE` has already fired, and only when
 * the ship is carrying something: an empty hold loses a fitting outright, and a
 * ship with no fittings left loses cargo outright.
 */
export const CARGO_LOSS_CHANCE = 0.7;

/**
 * The fittings a hull breach can knock out, in the order they are offered.
 *
 * A table rather than seven `if (e.x) push(...)` lines, which is what this was
 * inside game.ts. Adding equipment meant remembering to add it here too; now
 * the only question is whether it belongs in the list — and the ones that are
 * absent are absent because a breach cannot take them: the hold, the escape
 * pod, the energy unit and the galactic drive have no "broken" state the game
 * models, and the front laser is what you are shooting with.
 *
 * No `readonly [keyof Equipment, string][]` annotation — this directory may not
 * import, so the union it would be checked against is out of reach. `as const`
 * plus `breachLoss`'s own `commander.equipment[key]` is the same exhaustiveness
 * check from the spending side: a key that is not a fitting is a compile error
 * where it is read, which is where LASER_PACING and TACTIC_WEIGHTS are checked
 * too.
 */
export const BREAKABLE = [
  ['ecm', 'E.C.M. SYSTEM'],
  ['scoops', 'FUEL SCOOPS'],
  ['rearLaser', 'REAR LASER'],
  ['leftLaser', 'LEFT LASER'],
  ['rightLaser', 'RIGHT LASER'],
  ['dockingComputer', 'DOCKING COMPUTER'],
  ['combatComputer', 'COMBAT COMPUTER'],
] as const;
