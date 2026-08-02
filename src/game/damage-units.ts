// What a damage number IS — the two units a fight is spent in, and the only
// way to make one.
//
// Combat runs on two WHOLE-NUMBER scales and they are not interchangeable:
//
//   NpcEnergyPoints   points off a ship's released energy bank — 8 for a
//                     canister, 98 for a Cobra Mk III, 253 for a Thargoid.
//   PlayerPoolPoints  points off the commander's 255-point facing shield and
//                     255-point energy bank (game/systems.ts).
//
// They ARE both source-scale bytes, which is exactly why nothing stopped one
// being spent as the other: `takeDamage(115)` and `applyPlayerDamage(44)` both
// type-checked and both meant something wrong. Before TODO 28 there was a third
// scale as well — a normalized "fraction of a Cobra" that a ram, a canister, a
// warhead and an NPC's own gun all still spoke, crossed by two conversion
// functions that could turn ANY float into either unit. That is gone: every
// live damage number is now stated in the unit it is spent in.
//
// So the units are BRANDED. A bare `number` is not assignable to either, one is
// not assignable to the other, and the two constructors below refuse anything
// that is not a whole non-negative count — which makes an old fractional
// literal a compile error AND a runtime error rather than a quiet 0.45 points.
// Both brands erase completely, so this costs nothing at runtime beyond the
// integer check.
//
// WHO MAY MINT is the other half of the rule, and the type system cannot say
// it: `test/damage-paths.test.ts` holds the list of files allowed to call these
// constructors, and every one of them is a module that owns a damage rule
// (gunnery.ts, npc-energy.ts, impact-damage.ts). A call site that mints its own
// points has invented a damage rule wherever it happens to stand.

/** Points off a ship's released energy bank. See `game/npc-energy.ts`. */
export type NpcEnergyPoints = number & { readonly __unit: 'elite-a npc energy points' };

/** Points off the commander's shield face and energy bank. See `game/systems.ts`. */
export type PlayerPoolPoints = number & { readonly __unit: 'harmless player pool points' };

function whole(amount: number, unit: string): number {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(
      `damage-units: ${amount} is not a whole non-negative count of ${unit}`);
  }
  return amount;
}

/**
 * Mint energy points. Whole and non-negative, because a 6502 byte cannot hold
 * anything else and a fraction here is the old normalized scale leaking back.
 */
export function npcEnergyPoints(amount: number): NpcEnergyPoints {
  return whole(amount, 'npc energy points') as NpcEnergyPoints;
}

/** Mint player pool points. Same rule, other bank. */
export function playerPoolPoints(amount: number): PlayerPoolPoints {
  return whole(amount, 'player pool points') as PlayerPoolPoints;
}
