// The commander's ship as a set of numbers: energy, shields, laser heat,
// cabin temperature — how they regenerate, and what a hit costs.
//
// This is simulation, not presentation, and it had no home. It ran inline in
// updateFlight between the trader spawner and the police scan, and the damage
// model lived in applyPlayerDamage next to a call to flashDamage().
//
// Pulling it out matters more than the line count suggests, because this model
// was already being duplicated by prose. train/survivability.ts — the harness
// that answers "can a commander survive a gang" — carried the whole thing in a
// COMMENT ("fore/aft shield 1.0 each, absorbed first, by facing; energy max 4,
// overflow at 2 per point"), transcribed by hand, and every balance number
// this project has quoted rests on that transcription being right. It now
// imports the code instead.
//
// No three.js: a hit needs to know only whether it came from in front.

import { random } from './rng.ts';

/** Everything about the ship that a fight changes. */
export interface ShipSystems {
  /** 0..MAX_ENERGY — the last thing between you and an escape pod */
  energy: number;
  foreShield: number;
  aftShield: number;
  /** 0..1; the laser cuts out at 0.98 */
  laserTemp: number;
  laserCooldown: number;
  /** 0..1; 1.0 is fatal */
  cabinTemp: number;
}

export const MAX_ENERGY = 4;
export const MAX_SHIELD = 1;
/** Per second, per shield face, and only while energy is above 1. */
export const SHIELD_REGEN = 0.035;
export const ENERGY_REGEN = 0.1;
/** With an energy unit fitted. */
export const ENERGY_REGEN_BOOSTED = 0.2;
export const LASER_COOL_RATE = 0.22;
/**
 * Once shields are down, energy pays at TWO per point of damage. This is why a
 * commander soaks 3.0 raw damage from the front (1.0 shield + 4 energy / 2)
 * and 4.0 when manoeuvring so hits land on both faces.
 */
export const ENERGY_PER_DAMAGE = 2;
/** Chance a hit that reaches the hull wrecks cargo or a fitting. */
export const EQUIPMENT_DAMAGE_CHANCE = 0.25;

export function freshSystems(): ShipSystems {
  return {
    energy: MAX_ENERGY,
    foreShield: MAX_SHIELD,
    aftShield: MAX_SHIELD,
    laserTemp: 0,
    laserCooldown: 0,
    cabinTemp: 0,
  };
}

/**
 * How much raw damage this ship can absorb before energy reaches zero.
 *
 * `bothFaces` models a commander manoeuvring so hits land front and back,
 * which is worth a whole extra shield. Used by the balance harness, which
 * previously hard-coded 3.0 and 4.0 from a comment.
 */
export function durability(bothFaces = false): number {
  return (bothFaces ? MAX_SHIELD * 2 : MAX_SHIELD) + MAX_ENERGY / ENERGY_PER_DAMAGE;
}

export interface DamageResult {
  /** the hit got past the shields to the hull */
  reachedHull: boolean;
  /** and should therefore roll for wrecking a fitting */
  wreckedSomething: boolean;
  /** energy is gone */
  destroyed: boolean;
}

/**
 * Apply a hit. The facing shield takes it first; whatever is left comes out of
 * energy at ENERGY_PER_DAMAGE per point.
 *
 * @param fromFront the shot came from ahead — the caller works this out, since
 * only it knows the ship's orientation.
 * @param roll injectable randomness, so tests are deterministic.
 */
export function applyDamage(
  sys: ShipSystems,
  amount: number,
  fromFront: boolean,
  roll: () => number = random,
): DamageResult {
  let remaining = amount;
  if (fromFront) {
    const absorbed = Math.min(sys.foreShield, remaining);
    sys.foreShield -= absorbed;
    remaining -= absorbed;
  } else {
    const absorbed = Math.min(sys.aftShield, remaining);
    sys.aftShield -= absorbed;
    remaining -= absorbed;
  }
  let wreckedSomething = false;
  if (remaining > 0) {
    // shield was already down: energy takes it, and the hit may wreck cargo
    // or a fitting — "the ship's computer will keep you informed"
    sys.energy -= remaining * ENERGY_PER_DAMAGE;
    wreckedSomething = roll() < EQUIPMENT_DAMAGE_CHANCE;
  }
  return { reachedHull: remaining > 0, wreckedSomething, destroyed: sys.energy <= 0 };
}

export interface RegenOptions {
  /** an energy unit doubles the recharge rate */
  energyUnit: boolean;
}

/** One frame of recharge: energy always, shields only once energy is healthy. */
export function regenerate(sys: ShipSystems, dt: number, opts: RegenOptions): void {
  sys.laserCooldown -= dt;
  sys.laserTemp = Math.max(0, sys.laserTemp - LASER_COOL_RATE * dt);
  sys.energy = Math.min(MAX_ENERGY,
    sys.energy + (opts.energyUnit ? ENERGY_REGEN_BOOSTED : ENERGY_REGEN) * dt);
  // shields only recover once energy is above 1 — a beaten ship has to
  // disengage before it gets its shields back
  if (sys.energy > 1) {
    sys.foreShield = Math.min(MAX_SHIELD, sys.foreShield + SHIELD_REGEN * dt);
    sys.aftShield = Math.min(MAX_SHIELD, sys.aftShield + SHIELD_REGEN * dt);
  }
}

/** Distance at which the sun starts to be felt, and at which it is lethal. */
export const SUN_HEAT_START = 110_000; // cabin temp begins to climb
export const SUN_HEAT_MAX = 26_000;    // cabin temp reaches 1.0 (death follows)
/** Close enough to scoop fuel, if you have the scoops for it. */
export const SUN_SCOOP_RANGE = 80_000; // fuel scoops gather inside this
/** Tonnes of fuel — tenths of a LY — per second while scooping. */
export const SCOOP_RATE = 5;

/**
 * Cabin temperature follows distance from the sun, lagging behind it.
 *
 * Sun-skimming with scoops means riding the hot zone on purpose, so the lag is
 * the mechanic: it gives you time to pull out.
 *
 * @returns true if the cabin has reached a fatal temperature.
 */
export function updateCabinTemp(sys: ShipSystems, dt: number, sunDist: number): boolean {
  const target = Math.max(0, Math.min(1,
    (SUN_HEAT_START - sunDist) / (SUN_HEAT_START - SUN_HEAT_MAX)));
  sys.cabinTemp += (target - sys.cabinTemp) * Math.min(1, dt * 1.2);
  return sys.cabinTemp >= 0.99;
}

/** Fuel taken on this frame, in tenths of a LY. Zero when not scooping. */
export function scoopFuel(
  dt: number, sunDist: number, hasScoops: boolean, fuel: number, maxFuel: number,
): number {
  if (!hasScoops || fuel >= maxFuel || sunDist >= SUN_SCOOP_RANGE) return 0;
  return Math.min(maxFuel - fuel, SCOOP_RATE * dt);
}
