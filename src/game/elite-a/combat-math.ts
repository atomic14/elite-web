// The Elite-A combat oracle: what a registered hit is worth, and nothing else.
//
// One home for the released game's damage arithmetic. It is pure — no imports at
// all, so no ship, no world, no RNG, no renderer and no clock can reach it — and
// every rule below is reproduced against the pack's own matrices by
// `test/elite-a-oracle.test.ts`: 15,600 player-to-NPC rows, 3,900 NPC-to-player
// rows and 570 derived min/max ranges.
//
// It answers questions; it does not fire anything. Whether a shot hits at all,
// how often it may be fired, heat, the aim cone and who is even shooting stay
// with the game's own combat code. What arrives here is "a hit registered — how
// much is it worth", which is exactly what the pack tabulates.
//
// Two number kinds, deliberately:
//
//   * Registered-hit arithmetic is INTEGER. Laser bytes, defence, armour and
//     energy are 6502 bytes; a fractional hit is not a thing the source can
//     express. The one fractional step is the Constrictor's halving, and it is
//     floored back to an integer before defence subtracts.
//   * Regeneration is TIME, and time is a float. It is accumulated as an exact
//     integer count of sub-ticks rather than a running float sum, because a
//     float sum of `dt` does not give the same total at 15, 60 and 144 Hz — see
//     ELITE_A_REGEN_TICKS_PER_SECOND.
//
// The catalogue (`catalogue.ts`) supplies the numbers; this file supplies the
// rules. Neither does the other's job: there is no arithmetic there and no data
// table here, and the structural inputs below are satisfied by an
// `EliteACombatProfile` and an `EliteAPlayerHull` without either file importing
// the other.

/**
 * What a player laser needs to know about its target.
 *
 * Structural on purpose: an `EliteACombatProfile` is one of these. Defence is
 * NOT a field — it is `maxEnergy & 7`, and deriving it here is what stops the
 * rule having a second home in a stored column that could drift.
 */
export interface EliteALaserTarget {
  readonly maxEnergy: number;
  /** Stations. Player lasers never reduce their energy. */
  readonly laserImmune: boolean;
  /** Applied to hit strength BEFORE defence, then floored. 0.5 is Constrictor. */
  readonly playerLaserMultiplier: number;
}

/**
 * Which NPC-laser encoding to use.
 *
 * `clean` is the rule gameplay uses. `original` is the released game's
 * `weaponByte >> 1`, which reads the whole packed byte and so lets the missile
 * bits add up to 3 points of laser damage. It stays reproducible because the
 * pack tabulates it and a parity gate should be able to check it — it must
 * never be wired into live combat.
 */
export type EliteANpcLaserRule = 'clean' | 'original';

/**
 * An NPC's regenerating energy: the value, plus the sub-second remainder.
 *
 * `carryTicks` is an integer count of ELITE_A_REGEN_TICKS_PER_SECOND-ths of a
 * second that has not yet become a whole energy point. Energy itself only ever
 * moves in whole points, which is what the byte-sized original could express.
 */
export interface EliteARegenState {
  readonly energy: number;
  readonly carryTicks: number;
}

// --- player laser decoding --------------------------------------------------

/** The high bit of a fitted laser byte: continuous (beam) rather than pulse. */
export function eliteALaserIsContinuous(fittedLaserByte: number): boolean {
  return (fittedLaserByte & 0x80) !== 0;
}

/** The seven power bits. The continuous flag is not part of the strength. */
export function eliteALaserPower(fittedLaserByte: number): number {
  return fittedLaserByte & 0x7f;
}

/** Hit strength before the target's multiplier and defence: `power >> 1`. */
export function eliteAPlayerLaserHit(fittedLaserByte: number): number {
  return eliteALaserPower(fittedLaserByte) >> 1;
}

// --- what a player laser does to an NPC -------------------------------------

/** An NPC's per-hit defence. The whole rule: `maxEnergy & 7`. */
export function eliteANpcDefence(maxEnergy: number): number {
  return maxEnergy & 7;
}

/**
 * Hit strength once the target's own multiplier has been applied.
 *
 * Floored, and floored HERE — before defence — because the Constrictor's
 * halving is integer arithmetic in the source. A 7-point hit becomes 3, not
 * 3.5, so its 3 points of defence leave nothing.
 */
export function eliteAScaledPlayerHit(baseHit: number, target: EliteALaserTarget): number {
  if (target.laserImmune) return 0;
  return Math.floor(baseHit * target.playerLaserMultiplier);
}

/**
 * Energy a registered player hit of this strength removes. Never negative.
 *
 * Immunity needs no case of its own: a station's scaled hit is 0 and defence is
 * never negative, so the floor at zero already answers it.
 */
export function eliteADamageToNpc(baseHit: number, target: EliteALaserTarget): number {
  return Math.max(0,
    eliteAScaledPlayerHit(baseHit, target) - eliteANpcDefence(target.maxEnergy));
}

/** The same, straight from the fitted laser byte. */
export function eliteAPlayerLaserDamage(
  fittedLaserByte: number, target: EliteALaserTarget,
): number {
  return eliteADamageToNpc(eliteAPlayerLaserHit(fittedLaserByte), target);
}

/**
 * Registered hits to destroy a target from full energy, ignoring regeneration.
 *
 * `null` where it never dies: an immune station, or a laser whose damage the
 * target's defence cancels entirely. Ceiling division, because the last partial
 * hit still finishes the job.
 */
export function eliteAHitsToDestroy(
  fittedLaserByte: number, target: EliteALaserTarget,
): number | null {
  const damage = eliteAPlayerLaserDamage(fittedLaserByte, target);
  if (damage <= 0) return null;
  return Math.ceil(target.maxEnergy / damage);
}

// --- what an NPC laser does to the player ------------------------------------

/** Laser power, bits 3-5 of the packed weapon byte. */
export function eliteANpcLaserPower(weaponByte: number): number {
  return (weaponByte >> 3) & 7;
}

/** Missiles carried, bits 0-2. It has no bearing on the clean laser rule. */
export function eliteANpcMissileCount(weaponByte: number): number {
  return weaponByte & 7;
}

/** A ship with no laser-power bits cannot fire, whatever else the byte holds. */
export function eliteANpcCanFireLaser(weaponByte: number): boolean {
  return eliteANpcLaserPower(weaponByte) > 0;
}

/**
 * An NPC laser's hit strength before the player's armour.
 *
 * Both encodings check the laser bits first, which is why a Coriolis station
 * carrying six missiles (`weaponByte` 6) scores 0 under either rule rather than
 * 3 under the original one.
 */
export function eliteANpcLaserStrength(
  weaponByte: number, rule: EliteANpcLaserRule = 'clean',
): number {
  if (!eliteANpcCanFireLaser(weaponByte)) return 0;
  return rule === 'original' ? weaponByte >> 1 : eliteANpcLaserPower(weaponByte) << 2;
}

/**
 * Damage a registered NPC laser hit does to the player.
 *
 * `perHitShieldArmour` is the flyable hull's per-hit subtraction — the pack's
 * "shields" column, which is NOT the size of a shield bar. It comes off once
 * per hit and the result never goes below zero.
 */
export function eliteADamageToPlayer(
  weaponByte: number, perHitShieldArmour: number, rule: EliteANpcLaserRule = 'clean',
): number {
  return Math.max(0, eliteANpcLaserStrength(weaponByte, rule) - perHitShieldArmour);
}

// --- energy, destruction and regeneration ------------------------------------

/**
 * Destroyed at zero.
 *
 * The released game let a ship survive on exactly zero; the fidelity contract
 * deliberately drops that quirk, so `0` is dead here and the pack's own
 * hits-to-destroy table is computed the same way.
 */
export function eliteAIsDestroyed(energy: number): boolean {
  return energy <= 0;
}

/** Energy after a hit. Floored at zero so `isDestroyed` reads exactly zero. */
export function eliteAEnergyAfterDamage(energy: number, damage: number): number {
  return Math.max(0, energy - damage);
}

/**
 * Sub-ticks per second for regeneration timing.
 *
 * WHY AN INTEGER TICK AND NOT A FLOAT SUM. Regeneration has to give the same
 * total for the same elapsed time whatever the step size, or a 144 Hz machine
 * fights a different game from a 60 Hz one and a replay stops reproducing.
 * `acc += dt` cannot do that: 150 additions of 1/15 come to 9.999999999999984,
 * 600 of 1/60 to 10.000000000000076 and 1440 of 1/144 to 10.000000000000220 —
 * three different answers to "ten seconds", and each straddles the point where
 * a whole energy point is awarded.
 *
 * So the remainder is carried as an exact integer instead. Each step converts
 * its `dt` to a whole number of ticks and integer arithmetic does the rest;
 * energy only ever moves by whole points, so equal elapsed time gives a
 * bit-identical result rather than a nearly-identical one.
 *
 * 3600 is chosen because every frame rate that matters divides it exactly —
 * 15, 24, 25, 30, 50, 60, 72, 75, 90, 100, 120, 144, 240 and 360 — so the
 * conversion is lossless at all of them, not merely at ours.
 */
export const ELITE_A_REGEN_TICKS_PER_SECOND = 3600;

/**
 * The contract's starting rate for an ordinary AI ship: one point per second.
 *
 * WHICH ships regenerate is a roster question, not an arithmetic one — stations,
 * missiles, cargo and rocks do not — so it is settled where NPCs are built, by
 * passing a rate of 0. This constant is only the number the contract names.
 */
export const ELITE_A_DEFAULT_REGEN_PER_SECOND = 1;

/**
 * A frame's elapsed time as whole regeneration ticks.
 *
 * A negative or non-finite `dt` contributes nothing: time does not run
 * backwards for a paused tab, a rewound clock or a NaN.
 */
export function eliteARegenTicks(dt: number): number {
  if (!(dt > 0)) return 0;
  return Math.round(dt * ELITE_A_REGEN_TICKS_PER_SECOND);
}

/** How long one energy point takes, in ticks. A rate of 0 never regenerates. */
function ticksPerPoint(ratePerSecond: number): number {
  if (!(ratePerSecond > 0)) return 0;
  return Math.max(1, Math.round(ELITE_A_REGEN_TICKS_PER_SECOND / ratePerSecond));
}

/**
 * Advance an NPC's energy by one step of elapsed time.
 *
 * Returns a new state; nothing is mutated. A destroyed ship does not recover, a
 * full one banks nothing (the carry resets, so damage taken later does not come
 * straight back), and energy never passes `maxEnergy`.
 */
export function eliteARegenerate(
  state: EliteARegenState, maxEnergy: number, ratePerSecond: number, dt: number,
): EliteARegenState {
  const period = ticksPerPoint(ratePerSecond);
  if (period === 0 || eliteAIsDestroyed(state.energy)) return state;
  if (state.energy >= maxEnergy) {
    return state.energy === maxEnergy && state.carryTicks === 0
      ? state : { energy: maxEnergy, carryTicks: 0 };
  }
  const carried = state.carryTicks + eliteARegenTicks(dt);
  const points = Math.floor(carried / period);
  const energy = state.energy + points;
  if (energy >= maxEnergy) return { energy: maxEnergy, carryTicks: 0 };
  return { energy, carryTicks: carried - points * period };
}
