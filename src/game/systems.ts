// The commander's ship as a set of numbers: energy, shields, laser heat,
// cabin temperature — how they regenerate, and what a hit costs.
//
// This is simulation, not presentation, and it had no home: it ran inline in
// updateFlight, and the damage model lived in applyPlayerDamage next to a call
// to flashDamage(). Pulling it out mattered more than the line count suggests,
// because the model was already duplicated by prose — train/survivability.ts
// carried the whole thing in a hand-transcribed COMMENT, and every balance
// number this project has quoted rested on that transcription. It imports the
// code instead.
//
// No three.js: a hit needs to know only whether it came from in front.
//
// THE BANKS ARE 255-POINT POOLS AND WHOLE NUMBERS (TODO 27), because a
// fractional point is not something a 6502 byte can express. Every way of
// hurting them arrives as `PlayerPoolPoints` (damage-units.ts), minted by the
// module that owns the rule and by nothing else: an NPC laser through
// `gunnery.ts`'s `npcLaserDamageToPlayer` (its power, less this hull's armour,
// once), and a ram, a canister, the Coriolis wall or a warhead through
// `constants/impact.ts`. TODO 28 deleted the conversion that stood here, and the
// normalized scale it converted from: there is no scale left to convert.
//
// RECHARGE IS HARMLESS POLICY, and the rates are `constants/recharge.ts` — the
// pack gives each hull an `energyRechargeRating` and no clock, so what a rating
// is worth in seconds is a browser-game decision. It accumulates in whole
// sub-ticks rather than a float sum so 15, 60 and 144 Hz agree, the same clock
// the NPC banks run on. What a hull is rated is the catalogue's, and dividing
// one rating by the Cobra's is the only piece of this that could not move into
// the constants directory: see ANCHOR_RECHARGE_RATING.
//
// THERE IS NO MIGRATION HERE ANY MORE. `migratedSystems` rescaled a save
// written before TODO 27 made the pools 255 points, and `LEGACY_MAX_ENERGY` and
// `LEGACY_MAX_SHIELD` were the divisors it did it with. Nobody outside this
// project has ever played it, so no such save exists and the whole path served
// nobody (Chris, 2026-08-04; the same answer docs/TODO/53 gave `migrateLegacySaves`).
// A snapshot's `systems` is a complete `ShipSystems` and is assigned straight
// across. `test/damage-paths.test.ts` fails if any of the names come back.

import { random } from './rng.ts';
import { LOW_ENERGY, MAX_ENERGY, MAX_SHIELD } from '../constants/pools.ts';
import {
  ENERGY_REGEN_FRACTION, ENERGY_UNIT_MULTIPLIER, SHIELD_REGEN,
} from '../constants/recharge.ts';
import { LASER_COOL_RATE } from '../constants/player-gun.ts';
import { CABIN_TEMP_FATAL, CABIN_TEMP_LAG, SCOOP_RATE, SUN_HEAT_MAX, SUN_HEAT_START,
  SUN_SCOOP_RANGE } from '../constants/sun.ts';
import { BREAKABLE, CARGO_LOSS_CHANCE, EQUIPMENT_DAMAGE_CHANCE }
  from '../constants/hull-breach.ts';
import type { Equipment } from './commander.ts';
import { eliteARegenTicks, eliteATicksPerPoint } from './elite-a/combat-math.ts';
import type { PlayerPoolPoints } from './damage-units.ts';
import { COBRA_MK_3_HULL_ID, playerHull, type PlayerHullId } from './ship-identity.ts';

/** Everything about the ship that a fight changes. */
export interface ShipSystems {
  /** 0..MAX_ENERGY, a whole number — the last thing between you and an escape pod */
  energy: number;
  foreShield: number;
  aftShield: number;
  /**
   * Recharge's sub-second remainders, as whole ticks — see
   * ELITE_A_REGEN_TICKS_PER_SECOND. State, because the step reads them: a flight
   * reloaded mid-tick that restarted its carry would recover at a different
   * moment from the run it came from. One per pool, because a full pool banks
   * nothing and a shared carry would throw away the others'.
   */
  foreShieldCarry: number;
  aftShieldCarry: number;
  energyCarry: number;
  /** 0..1; the gun cuts out at `LASER_CUTOUT` and cools at `LASER_COOL_RATE` */
  laserTemp: number;
  laserCooldown: number;
  /** 0..1; `CABIN_TEMP_FATAL` kills you */
  cabinTemp: number;
}

/**
 * You are down to your last bank: the shields stop recovering (below), the step
 * flashes ENERGY LOW and the gauge's last segment goes red. ONE comparison, so
 * all three arrive at the same point count — TODO 38 claimed that and shipped
 * three (`>` here, `<` in the step, `<` on fractions in the painter), leaving 64
 * a dead band: shields frozen, console quiet. Inclusive because the shield
 * cut-off already was, and it is the one of the three a fight can feel.
 */
export function energyLow(energy: number): boolean {
  return energy <= LOW_ENERGY;
}

/**
 * The recharge rating `constants/recharge.ts`'s fractions were anchored on —
 * read from the catalogue rather than written as `1`, so a hull rated 2 (the
 * Fer-de-Lance) recovers twice as fast as the Cobra whatever the Cobra's own
 * rating becomes.
 *
 * THE ONE CONSTANT OF THIS FILE'S THAT DID NOT MOVE, and the reason is the same
 * one that kept `WORLD_SPEED_PER_SOURCE_SPEED` beside the roster: `playerHull`
 * reaches a released hull through `ship-identity.ts` and the Elite-A
 * catalogue's six generated tables, and `src/constants/` may not import
 * anything. Writing `1` there instead would put a pack number in a Harmless
 * file and break the derivation the comment above is about. It stays where both
 * halves are in scope — see docs/TODO/90-constants-cleanup.md.
 */
export const ANCHOR_RECHARGE_RATING =
  playerHull(COBRA_MK_3_HULL_ID).energyRechargeRating;

export function freshSystems(): ShipSystems {
  return {
    energy: MAX_ENERGY,
    foreShield: MAX_SHIELD,
    aftShield: MAX_SHIELD,
    foreShieldCarry: 0,
    aftShieldCarry: 0,
    energyCarry: 0,
    laserTemp: 0,
    laserCooldown: 0,
    cabinTemp: 0,
  };
}

/**
 * Everything a station's engineers put right: full pools and a cold laser. One
 * home for "what full is" — docking used to say it in three assignments of its
 * own, so growing the pools would have left it handing back a 1/1/4 ship.
 */
export function repairAtStation(sys: ShipSystems): void {
  const fresh = freshSystems();
  sys.energy = fresh.energy;
  sys.foreShield = fresh.foreShield;
  sys.aftShield = fresh.aftShield;
  sys.foreShieldCarry = 0;
  sys.aftShieldCarry = 0;
  sys.energyCarry = 0;
  sys.laserTemp = 0;
}

/**
 * How much damage this ship can absorb before energy reaches zero, in POOL
 * POINTS: one shield face (or both, for a commander manoeuvring so hits land
 * front and back) plus the whole energy bank. There is no longer a multiplier
 * on the way into energy — the released model subtracts a hit from the facing
 * shield and spills the remainder straight into the bank — so this is a plain
 * sum, read by the balance harness that used to hard-code 3.0 and 4.0.
 */
export function durability(bothFaces = false): number {
  return (bothFaces ? MAX_SHIELD * 2 : MAX_SHIELD) + MAX_ENERGY;
}

/**
 * HOW MUCH OF THIS SHIP IS LEFT, 0..1 — both faces and the bank, over
 * everything they can hold.
 *
 * ONE HOME, and that is the whole reason it is a function rather than three
 * additions at each call site. It is the number a defence policy observes
 * (`observeDefend` slot 14), and it is observed in two worlds: the trainer's
 * `TargetShip` and the game's combat computer. Written out twice it would drift
 * exactly once, and the policy would then be flown out of the distribution it
 * was fitted in without anything failing — which is the trap `combat-computer.
 * ts` already records twice, in the pinned 280 and 300 speeds (docs/TODO/71).
 */
export function poolsLeft(sys: ShipSystems): number {
  return (sys.foreShield + sys.aftShield + sys.energy) / durability(true);
}

/**
 * The ENERGY BANK alone, 0..1 — `observeDefend` slot 15, and the same argument
 * as above for it being here.
 *
 * Separate from `poolsLeft` because the bank is what the ship DIES at, what the
 * shields will not recover past (`energyLow`), and what the E.C.M. spends a
 * quarter of. A full pair of shields hides an empty one.
 */
export function energyLeft(sys: ShipSystems): number {
  return sys.energy / MAX_ENERGY;
}

/**
 * Each shield FACE alone, 0..1 — `observeDefend` slots 27 and 28, and the same
 * one-home argument as the two above: the trainer's target and the game's
 * combat computer both observe these, and written out twice they drift once.
 *
 * The pair exists because `poolsLeft` hides the split: an attacker on your six
 * spends a different face from one head-on (`applyDamage`, `hitFromAhead`),
 * so "keep the good face toward him" is flyable only if the policy can see
 * which face is the good one.
 */
export function foreShieldLeft(sys: ShipSystems): number {
  return sys.foreShield / MAX_SHIELD;
}

export function aftShieldLeft(sys: ShipSystems): number {
  return sys.aftShield / MAX_SHIELD;
}

export interface DamageResult {
  /** the hit got past the shields to the hull */
  reachedHull: boolean;
  /** and should therefore roll for wrecking a fitting */
  wreckedSomething: boolean;
  /** THIS hit emptied the bank — deliberately not "the bank is empty" */
  destroyed: boolean;
}

/**
 * Apply a hit of `damage` WHOLE POOL POINTS. The facing shield takes it first;
 * whatever is left comes straight out of energy.
 *
 * ARMOUR IS NOT APPLIED HERE. The flyable hull's per-hit armour comes off an
 * NPC LASER hit and nothing else, so it is subtracted once where the shot is
 * resolved (`gunnery.ts` `npcLaserDamageToPlayer`) rather than on every path
 * into the banks — a ram is not a laser and does not meet armour.
 *
 * @param fromFront the shot came from ahead — the caller works this out, since
 * only it knows the ship's orientation.
 * @param roll injectable randomness, so tests are deterministic.
 */
export function applyDamage(
  sys: ShipSystems,
  damage: PlayerPoolPoints,
  fromFront: boolean,
  roll: () => number = random,
): DamageResult {
  // A plain number from here on: what is LEFT of a hit after a shield has eaten
  // some of it is a remainder, not a fresh damage figure, and typing it as one
  // would let `applyDamage(sys, remaining, ...)` compile somewhere else.
  let remaining: number = damage;
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
    // Shield was already down: energy takes it, and the hit may wreck cargo or
    // a fitting — "the ship's computer will keep you informed".
    //
    // ONE ROLL PER HIT, and that is the whole reason this line reads as it
    // does — see EQUIPMENT_DAMAGE_CHANCE for why the chance belongs to the hit
    // rather than to the number of points in it.
    sys.energy = Math.max(0, sys.energy - remaining);
    wreckedSomething = roll() < EQUIPMENT_DAMAGE_CHANCE;
  }
  // DESTROYED IS ABOUT THIS HIT. The absolute `sys.energy <= 0` agreed only
  // while a hit was the one way to empty the bank, and the E.C.M. is not one:
  // fired at exactly its cost it left the bank at 0 with the ship flying, and a
  // hit a full shield swallowed read as a kill (docs/DAMAGE-PATHS.md, row 18).
  return { reachedHull: remaining > 0, wreckedSomething,
    destroyed: remaining > 0 && sys.energy <= 0 };
}

export interface RegenOptions {
  /** which of the 15 flyable hulls: it carries the recharge rating */
  shipId: PlayerHullId;
  /** an energy unit doubles the recharge rate */
  energyUnit: boolean;
}

/**
 * Energy points a second for this hull and fit. HARMLESS POLICY — see
 * ENERGY_REGEN_FRACTION.
 *
 * The hull's recharge rating and the energy unit each appear EXACTLY ONCE, here
 * and nowhere else, so neither can be applied twice by a caller that also
 * "helpfully" doubled the rate.
 */
export function energyRegenPerSecond(shipId: PlayerHullId, energyUnit: boolean): number {
  return MAX_ENERGY * ENERGY_REGEN_FRACTION
    * (playerHull(shipId).energyRechargeRating / ANCHOR_RECHARGE_RATING)
    * (energyUnit ? ENERGY_UNIT_MULTIPLIER : 1);
}

/**
 * One pool, advanced by a frame's worth of ticks. Integer arithmetic on
 * purpose: a float `acc += dt` gives three different answers to "ten seconds"
 * at 15, 60 and 144 Hz, each straddling the moment a whole point is awarded
 * (see ELITE_A_REGEN_TICKS_PER_SECOND). A full pool banks nothing, so a hit
 * taken later does not come straight back.
 */
function recharge(
  value: number, carry: number, max: number, ratePerSecond: number, ticks: number,
): [number, number] {
  const period = eliteATicksPerPoint(ratePerSecond);
  if (period === 0 || value >= max) return [Math.min(value, max), 0];
  const carried = carry + ticks;
  const points = Math.floor(carried / period);
  const next = value + points;
  if (next >= max) return [max, 0];
  return [next, carried - points * period];
}

/** One frame of recharge: energy always, shields only once energy is healthy. */
export function regenerate(sys: ShipSystems, dt: number, opts: RegenOptions): void {
  sys.laserCooldown -= dt;
  sys.laserTemp = Math.max(0, sys.laserTemp - LASER_COOL_RATE * dt);
  const ticks = eliteARegenTicks(dt);
  [sys.energy, sys.energyCarry] = recharge(sys.energy, sys.energyCarry, MAX_ENERGY,
    energyRegenPerSecond(opts.shipId, opts.energyUnit), ticks);
  // shields only recover once energy is out of its last bank: a beaten ship has
  // to disengage, and `energyLow` makes that the moment the console says so
  if (!energyLow(sys.energy)) {
    [sys.foreShield, sys.foreShieldCarry] =
      recharge(sys.foreShield, sys.foreShieldCarry, MAX_SHIELD, SHIELD_REGEN, ticks);
    [sys.aftShield, sys.aftShieldCarry] =
      recharge(sys.aftShield, sys.aftShieldCarry, MAX_SHIELD, SHIELD_REGEN, ticks);
  }
}

/**
 * Cabin temperature follows distance from the sun, lagging behind it.
 *
 * Sun-skimming with scoops means riding the hot zone on purpose, so the lag is
 * the mechanic: it gives you time to pull out. The ladder of distances this
 * walks, and what each rung buys, is `constants/sun.ts`.
 *
 * @returns true if the cabin has reached a fatal temperature.
 */
export function updateCabinTemp(sys: ShipSystems, dt: number, sunDist: number): boolean {
  const target = Math.max(0, Math.min(1,
    (SUN_HEAT_START - sunDist) / (SUN_HEAT_START - SUN_HEAT_MAX)));
  sys.cabinTemp += (target - sys.cabinTemp) * Math.min(1, dt * CABIN_TEMP_LAG);
  return sys.cabinTemp >= CABIN_TEMP_FATAL;
}

/** Fuel taken on this frame, in tenths of a LY. Zero when not scooping. */
export function scoopFuel(
  dt: number, sunDist: number, hasScoops: boolean, fuel: number, maxFuel: number,
): number {
  if (!hasScoops || fuel >= maxFuel || sunDist >= SUN_SCOOP_RANGE) return 0;
  return Math.min(maxFuel - fuel, SCOOP_RATE * dt);
}


// --- what a hull hit costs you ---------------------------------------------

export type BreachLoss =
  | { kind: 'cargo'; commodity: number }
  | { kind: 'equipment'; key: keyof Equipment; name: string }
  | { kind: 'nothing' };

/**
 * A hull hit destroys a tonne of cargo, or knocks out a fitting.
 *
 * Mutates the commander. Returns what was lost so the Game can announce it —
 * and so the caller knows to disengage the combat computer if that was what
 * went.
 */
export function breachLoss(
  commander: { cargo: number[]; equipment: Equipment },
  rng: () => number,
): BreachLoss {
  const carried: number[] = [];
  commander.cargo.forEach((qty, i) => { if (qty > 0) carried.push(i); });
  const fittings = BREAKABLE.filter(([key]) => commander.equipment[key]);

  if (carried.length && (!fittings.length || rng() < CARGO_LOSS_CHANCE)) {
    const commodity = carried[Math.floor(rng() * carried.length)];
    commander.cargo[commodity] -= 1;
    return { kind: 'cargo', commodity };
  }
  if (fittings.length) {
    const [key, name] = fittings[Math.floor(rng() * fittings.length)];
    (commander.equipment as unknown as Record<string, boolean>)[key] = false;
    return { kind: 'equipment', key, name };
  }
  return { kind: 'nothing' };
}
