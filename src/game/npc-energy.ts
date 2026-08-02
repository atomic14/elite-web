// An NPC's energy bank: how big it is, what a player laser is worth against
// it, and how it comes back.
//
// The arithmetic is NOT here — it is `elite-a/combat-math.ts`, exhaustively
// proven against the pack's 15,600 rows, and this file must never restate a
// line of it. What this owns is the step between an id and that arithmetic:
// which numbers a given ship's exact released build supplies, what the two
// Harmless inventions get instead of source numbers, and which ships the
// contract says do not regenerate at all.
//
// So it is the one home for three decisions the callers used to make for
// themselves:
//
//   1. IMMUNITY AND THE CONSTRICTOR ARE THE TARGET'S OWN PROPERTIES. A station
//      shrugs off a laser and the Constrictor halves it BEFORE defence, and
//      both arrive as fields of the profile — never as `if (npc.role === ...)`
//      or `if (state.isMissionTarget)` at a call site. `Combat.fire` therefore
//      has no idea what it is shooting at, which is the point.
//   2. REGENERATION IS A PROPERTY OF THE DESIGN, not of the frame rate. It is
//      accumulated as whole sub-ticks (see ELITE_A_REGEN_TICKS_PER_SECOND), so
//      the same elapsed time gives the same points at 15, 60 and 144 Hz, and a
//      paused or backgrounded tab gets no catch-up burst.
//   3. EVERY NON-LASER SOURCE STILL SPEAKS THE OLD UNITS, and goes through
//      `legacyDamageToEnergy` until TODO 28 audits them. That conversion is
//      named, tested and grep-able precisely so the audit has a list.
//
// Energy is an INTEGER count of source points. There is no such thing as a
// fractional point in the released game, and letting one in is how the two
// unit systems would quietly merge again.

import {
  eliteADamageToNpc, eliteAEnergyAfterDamage, eliteAIsDestroyed, eliteARegenerate,
  ELITE_A_DEFAULT_REGEN_PER_SECOND,
  type EliteALaserTarget, type EliteARegenState,
} from './elite-a/combat-math.ts';
import { recommendedNpcProfile } from './elite-a/catalogue.ts';
import {
  HARMLESS_OVERLAYS, npcCombatProfileById, type NpcCombatProfileId,
} from './ship-identity.ts';

/**
 * Everything live combat needs to know about one ship's bank.
 *
 * `EliteALaserTarget` is the structural half the pure rule reads; the rate is
 * ours to supply because WHICH ships recover is a roster question rather than
 * an arithmetic one.
 */
export interface NpcEnergyPolicy extends EliteALaserTarget {
  readonly maxEnergy: number;
  readonly laserImmune: boolean;
  readonly playerLaserMultiplier: number;
  /** Energy points a second. 0 for stations, missiles, cargo and rocks. */
  readonly regenPerSecond: number;
}

/**
 * The designs the fidelity contract says do not recover: "stations, missiles,
 * cargo and rocks".
 *
 * Written as the pack's own design ids, because that phrase has to land on
 * something checkable. Stations 0-1, the escape pod, the alloy plate and the
 * canister 2-4, the three rocks 5-7, and the common missile 15. Everything else
 * is an AI ship with a working generator.
 */
const NON_REGENERATING_DESIGNS: ReadonlySet<number> =
  new Set([0, 1, 2, 3, 4, 5, 6, 7, 15]);

/**
 * The Cobra Mk III's released bank, and the anchor the compatibility bridge
 * below is scaled on. `SOURCE_DESIGN.cobraMk3` in ship-specs.ts is the same
 * number; `test/elite-a-live-combat.test.ts` holds the two together by name.
 */
const COBRA_MK_3_DESIGN = 10;

/**
 * What one pre-TODO-26 hull point is worth in source energy.
 *
 * DERIVED, not chosen: the roster's trader Cobra carried exactly 1.0 hull point
 * and the released Cobra Mk III carries 98 energy, so one old point is one
 * Cobra. Read off the catalogue rather than written down, so a re-import moves
 * it rather than leaving it stale.
 */
export const ENERGY_PER_LEGACY_HULL_POINT =
  recommendedNpcProfile(COBRA_MK_3_DESIGN).maxEnergy;

/**
 * What an asteroid used to be worth.
 *
 * Rocks are the one role with no roster row — their size is rolled from the
 * seed — so the hull points a pre-energy save was written against live here
 * rather than in `ship-specs.ts`. Migration data: nothing live reads it.
 */
export const LEGACY_ASTEROID_HULL_POINTS = 0.6;

/**
 * The old "certainly fatal" amount, from the energy bomb and a missile strike.
 *
 * A literal 99 in two orchestrators, and it stays a legacy number rather than
 * becoming an energy one because it is exactly the kind of thing TODO 28 has to
 * look at: it is not a damage figure, it is "this ship is gone".
 */
export const LEGACY_FATAL_DAMAGE = 99;

// --- the two Harmless inventions --------------------------------------------

/**
 * Explicit policy for the ships the pack has no record of.
 *
 * They are OURS, stated here as ours, and excluded from every claim of source
 * parity — the same separation `ship-identity.ts` keeps for their ids. Giving
 * them a released variant's numbers would put invented figures inside a matrix
 * the oracle is checked against.
 */
const HARMLESS_POLICY: Readonly<Record<string, NpcEnergyPolicy>> = {
  /**
   * The rock hermit is a STATION — you dock with it — so it takes the station
   * rule: immune to player lasers, and a hollowed asteroid has no generator.
   * 240 is what a Coriolis carries and is here only so the bank has a size;
   * nothing can spend it through a laser.
   */
  [HARMLESS_OVERLAYS.rockHermit.profileId]: {
    maxEnergy: 240, laserImmune: true, playerLaserMultiplier: 1, regenPerSecond: 0,
  },
  /**
   * The derelict generation ship is the largest hull in the sky and dead: 252
   * is the heaviest bank the released catalogue holds (the Anaconda's), which
   * makes it about fifty pulse hits — the endurance its 8 legacy hull points
   * bought — and its reactors have been cold for centuries, so it recovers
   * nothing.
   */
  [HARMLESS_OVERLAYS.generationShip.profileId]: {
    maxEnergy: 252, laserImmune: false, playerLaserMultiplier: 1, regenPerSecond: 0,
  },
};

// --- resolving one ship's policy ---------------------------------------------

const cache = new Map<NpcCombatProfileId, NpcEnergyPolicy>();

/**
 * The bank one exact build flies with. Resolved once per profile and shared —
 * every field is immutable, and a ship holds the answer rather than the id.
 */
export function npcEnergyPolicy(profileId: NpcCombatProfileId): NpcEnergyPolicy {
  const known = cache.get(profileId);
  if (known) return known;
  const own = HARMLESS_POLICY[profileId];
  const record = own ? null : npcCombatProfileById(profileId);
  const policy: NpcEnergyPolicy = own ?? (record!.source === 'elite-a'
    ? {
      maxEnergy: record!.profile.maxEnergy,
      laserImmune: record!.profile.laserImmune,
      playerLaserMultiplier: record!.profile.playerLaserMultiplier,
      regenPerSecond: NON_REGENERATING_DESIGNS.has(record!.profile.designId)
        ? 0 : ELITE_A_DEFAULT_REGEN_PER_SECOND,
    }
    // An overlay id with no policy above is a Harmless invention somebody added
    // without deciding what it is made of. That is a decision, not a default.
    : missingPolicy(profileId));
  cache.set(profileId, policy);
  return policy;
}

function missingPolicy(profileId: NpcCombatProfileId): never {
  throw new Error(`npc-energy: no energy policy for the Harmless profile ${profileId}`);
}

/** The bank a fresh ship of this build starts with. */
export function npcMaxEnergy(profileId: NpcCombatProfileId): number {
  return npcEnergyPolicy(profileId).maxEnergy;
}

// --- what a hit is worth -----------------------------------------------------

/**
 * Energy a registered player-laser hit of `hit` strength removes.
 *
 * The whole rule is the oracle's; immunity and the Constrictor's halving are
 * inside `policy`, which is why no caller of this ever names a ship.
 */
export function playerLaserDamage(policy: NpcEnergyPolicy, hit: number): number {
  return eliteADamageToNpc(hit, policy);
}

/** The bank after taking `damage`. Floored at zero so destruction reads exactly 0. */
export function energyAfterDamage(energy: number, damage: number): number {
  return eliteAEnergyAfterDamage(energy, damage);
}

/** Destroyed at zero — the released survival quirk is deliberately gone. */
export function isDestroyed(energy: number): boolean {
  return eliteAIsDestroyed(energy);
}

// --- coming back -------------------------------------------------------------

/**
 * Advance one ship's bank by a frame of elapsed time.
 *
 * Nothing is mutated: it returns the new value and the new sub-tick carry, and
 * the ship writes both into its own state. A negative or absurd `dt` — a paused
 * tab, a rewound clock — contributes nothing, so there is no catch-up burst.
 */
export function regeneratedEnergy(
  state: EliteARegenState, policy: NpcEnergyPolicy, dt: number,
): EliteARegenState {
  return eliteARegenerate(state, policy.maxEnergy, policy.regenPerSecond, dt);
}

// --- the TODO 28 bridge ------------------------------------------------------

/**
 * ONE named conversion from the old normalized hull scale into energy points.
 *
 * **This is the TODO 28 bridge.** Every non-laser way an NPC can be hurt still
 * speaks the old units — ramming, an NPC's own gun, a missile strike, the
 * energy bomb — and TODO 28 is where each of them gets a source-backed number
 * of its own. Until then they come through here, so the mixing is in one place
 * with one scale instead of spread over five call sites as literals.
 *
 * Rounded to a whole point and floored at one: an old amount that mattered must
 * not silently become no damage at all.
 */
export function legacyDamageToEnergy(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.max(1, Math.round(amount * ENERGY_PER_LEGACY_HULL_POINT));
}

// --- migrating a save written before energy ----------------------------------

/**
 * A saved ship's state, brought onto the energy scale.
 *
 * A world written before this phase carries `hp` on the old per-hull scale and
 * no `energy`; one written after carries the exact integer and round-trips
 * untouched. The migration keeps the FRACTION of the hull that was left and
 * spends it against the profile's own bank, so a ship reloaded at half health
 * comes back at half health rather than full or dead.
 *
 * Pure, and deliberately: restore must not draw from the rng or reroll what a
 * ship is (see `savedShipIdentity`).
 *
 * @param legacyMaxHullPoints the hull the save was written against, or
 * undefined when it cannot be resolved — in which case the ship comes back
 * whole, because a fraction of an unknown hull is not a fraction.
 */
export function migratedNpcState(
  saved: Record<string, unknown>, maxEnergy: number, legacyMaxHullPoints: number | undefined,
): Record<string, unknown> {
  if (saved.energy !== undefined) return saved;
  const { hp, ...rest } = saved;
  const fraction = typeof hp === 'number' && legacyMaxHullPoints
    ? Math.max(0, Math.min(1, hp / legacyMaxHullPoints)) : 1;
  // Round, then keep a living ship alive: a sliver of hull was not death, and
  // rounding it to zero would destroy ships on load.
  const energy = Math.round(fraction * maxEnergy);
  return { ...rest, energy: fraction > 0 ? Math.max(1, energy) : 0, regenCarry: 0 };
}
