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
// `impact-damage.ts`. TODO 28 deleted the conversion that stood here, and the
// normalized scale it converted from: there is no scale left to convert.
//
// RECHARGE IS HARMLESS POLICY, stated as ours: the pack gives each hull an
// `energyRechargeRating` and no clock, and what a rating is worth in seconds is
// a browser-game decision — "exactly what the Cobra Mk III already did", see
// ENERGY_REGEN_FRACTION. It accumulates in whole sub-ticks rather than a float
// sum so 15, 60 and 144 Hz agree, the same clock the NPC banks run on.

import { random } from './rng.ts';
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
  /** 0..1; the laser cuts out at 0.98 */
  laserTemp: number;
  laserCooldown: number;
  /** 0..1; 1.0 is fatal */
  cabinTemp: number;
}

/** The released capacity of every flyable hull's energy bank and each shield. */
export const MAX_ENERGY = 255;
export const MAX_SHIELD = 255;

/**
 * What the banks held before TODO 27, and the divisors a legacy save is
 * migrated against. Migration data: nothing live reads them.
 */
export const LEGACY_MAX_ENERGY = 4;
export const LEGACY_MAX_SHIELD = 1;

/**
 * How many BANKS the console reads the energy pool as, and where the last of
 * them begins. Four, as the original's console did: TODO 27 made energy one
 * 255-point pool, but a player still flies by "how many banks left", so the
 * console draws this many segments (hud.ts, via the frame) and `energyLow`
 * below is the last of them emptying — change ENERGY_BANKS and the gauge, the
 * warning and the shield cut-off move together. LOW_ENERGY is a point COUNT.
 */
export const ENERGY_BANKS = 4;
export const LOW_ENERGY = Math.round(MAX_ENERGY / ENERGY_BANKS);

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
 * The fraction of a full pool the Cobra Mk III recovers each second — HARMLESS
 * POLICY, and the anchor for the whole recharge model. These are the
 * pre-TODO-27 rates as fractions (0.1 of a 4-point bank a second, 0.035 of a
 * 1.0 shield), so a Cobra flies exactly the recharge it flew before the pools
 * grew. Not recovered source arithmetic: the pack gives a RATING and no clock.
 */
export const ENERGY_REGEN_FRACTION = 0.1 / LEGACY_MAX_ENERGY;
export const SHIELD_REGEN_FRACTION = 0.035 / LEGACY_MAX_SHIELD;
/** An energy unit doubles the bank's recharge, exactly as it always did. */
export const ENERGY_UNIT_MULTIPLIER = 2;

/** Shield points a second, per face, and only while energy is above LOW_ENERGY. */
export const SHIELD_REGEN = MAX_SHIELD * SHIELD_REGEN_FRACTION;

/**
 * The recharge rating the fractions above were anchored on — read from the
 * catalogue rather than written as `1`, so a hull rated 2 (the Fer-de-Lance)
 * recovers twice as fast as the Cobra whatever the Cobra's own rating becomes.
 */
export const ANCHOR_RECHARGE_RATING =
  playerHull(COBRA_MK_3_HULL_ID).energyRechargeRating;

export const LASER_COOL_RATE = 0.22;
/** Chance a hit that reaches the hull wrecks cargo or a fitting. */
export const EQUIPMENT_DAMAGE_CHANCE = 0.25;

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
    // does. The chance is a property of the HIT, not of how big it was: making
    // the pools 255 times larger multiplies the number of POINTS arriving, and
    // a roll per point (or a chance scaled by the amount) would have multiplied
    // how often equipment breaks by the unit conversion.
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
 * A saved ship's systems, brought onto the 255-point scale.
 *
 * A world written before TODO 27 carries the pools on their former 1/1/4 maxima
 * and no carries; one written after round-trips untouched. The migration keeps
 * the FRACTION of each pool that was left, so a flight reloaded on half a
 * shield comes back on half a shield rather than full or flat. Pure, and
 * deliberately: restoring must not draw from the rng.
 */
export function migratedSystems(saved: Partial<ShipSystems>): ShipSystems {
  const fresh = freshSystems();
  const scaled = (value: unknown, legacyMax: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return max;
    return Math.max(0, Math.min(max, Math.round((value / legacyMax) * max)));
  };
  // The carries are the marker: they exist in every save written since TODO 27
  // and in none written before it, so a pool on the new scale is never rescaled
  // a second time.
  if (typeof saved.energyCarry === 'number') {
    return { ...fresh, ...saved } as ShipSystems;
  }
  return {
    ...fresh,
    ...saved,
    energy: scaled(saved.energy, LEGACY_MAX_ENERGY, MAX_ENERGY),
    foreShield: scaled(saved.foreShield, LEGACY_MAX_SHIELD, MAX_SHIELD),
    aftShield: scaled(saved.aftShield, LEGACY_MAX_SHIELD, MAX_SHIELD),
    foreShieldCarry: 0,
    aftShieldCarry: 0,
    energyCarry: 0,
  };
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


// --- what a hull hit costs you ---------------------------------------------

/**
 * The fittings a hull breach can knock out, in the order they are offered.
 *
 * A table rather than seven `if (e.x) push(...)` lines, which is what this was
 * inside game.ts. Adding equipment meant remembering to add it here too; now
 * the only question is whether it belongs in the list.
 */
const BREAKABLE: readonly (readonly [keyof Equipment, string])[] = [
  ['ecm', 'E.C.M. SYSTEM'],
  ['scoops', 'FUEL SCOOPS'],
  ['rearLaser', 'REAR LASER'],
  ['leftLaser', 'LEFT LASER'],
  ['rightLaser', 'RIGHT LASER'],
  ['dockingComputer', 'DOCKING COMPUTER'],
  ['combatComputer', 'COMBAT COMPUTER'],
];

/** Cargo is lost this often when there is any aboard — equipment is rarer. */
export const CARGO_LOSS_CHANCE = 0.7;

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
