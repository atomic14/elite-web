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
//   3. WHAT ONE SHIP'S GUN IS WORTH AGAINST ANOTHER'S BANK —
//      `npcCrossfireDamage`.
//      The pack tabulates the two player-facing directions and not this one, so
//      it is composed from the two source rules that DO apply: the firing
//      build's own laser strength, and the target's own defence. See below for
//      what it deliberately does NOT apply.
//
// Energy is an INTEGER count of source points, and it is a BRANDED one
// (damage-units.ts) so a number from any other scale cannot be spent as one.
// There is no such thing as a fractional point in the released game; letting one
// in is how two unit systems quietly merge.
//
// EVERY NON-LASER SOURCE — a ram, a warhead, the energy bomb — is
// `constants/impact.ts`, which states its numbers in these same points. There is
// no conversion function here and there must never be one again: the two
// TODO 26/27 bridges (`legacyDamageToEnergy` and its player twin) existed
// because five call sites spoke a normalized scale, and TODO 28 deleted the
// scale rather than the symptom.

import {
  eliteADamageToNpc, eliteAEnergyAfterDamage, eliteAIsDestroyed, eliteANpcDefence,
  eliteANpcLaserStrength, eliteARegenerate, ELITE_A_DEFAULT_REGEN_PER_SECOND,
  type EliteALaserTarget, type EliteARegenState,
} from './elite-a/combat-math.ts';
import { npcEnergyPoints, type NpcEnergyPoints } from './damage-units.ts';
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
 * The Cobra Mk III's design id, and the bank every Harmless impact number is
 * anchored on (`constants/impact.ts`). `SOURCE_DESIGN.cobraMk3` in ship-specs.ts is
 * the same number; `test/damage-paths.test.ts` holds the two together by name
 * and re-derives the anchor from the catalogue.
 */
export const COBRA_MK_3_DESIGN = 10;

/** The representative NPC's released bank — 98 points. */
export const ANCHOR_NPC_MAX_ENERGY =
  recommendedNpcProfile(COBRA_MK_3_DESIGN).maxEnergy;

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
   * is the Anaconda's bank, the heaviest hull on the trader roster — NOT the
   * heaviest in the released catalogue, which is the `W:29` Dragon at 255
   * (`constants/impact.ts` names all five above 250). It stands in for the
   * endurance its 8 legacy hull points bought, and its reactors have been cold
   * for centuries, so it recovers nothing. How many shots that is depends on
   * the hull you are flying as much as the laser fitted to it — an Anaconda's
   * military laser is a 63-point hit where a Cobra Mk III's is 12
   * (`playerLaserHit`) — so no count is written down here.
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
export function playerLaserDamage(policy: NpcEnergyPolicy, hit: number): NpcEnergyPoints {
  return npcEnergyPoints(eliteADamageToNpc(hit, policy));
}

/**
 * Energy one ship's registered laser hit removes from ANOTHER ship's bank.
 *
 * The direction the pack does not tabulate, so it is COMPOSED from the two
 * source rules that each half of it does have: the firing build's own laser
 * strength (`laserPower << 2`, the clean rule the game already fires at the
 * commander with) less the target's own per-hit defence (`maxEnergy & 7`, the
 * rule the commander's own laser already meets). Both come out of
 * `elite-a/combat-math.ts` — there is no third arithmetic here, which is the
 * point: a crossfire kill and a player kill now agree about what a Krait's gun
 * is worth against an Adder.
 *
 * IT IS NOT A PLAYER LASER, and two properties that ride on the player's shot
 * deliberately do not apply. `playerLaserMultiplier` is the Constrictor's
 * halving — a mission ship the Navy hardened against the commander's guns, not
 * a general toughness — and `laserImmune` is a station shrugging off the
 * commander. Applying either here would let a pirate's stray bolt be halved by
 * a flag that describes a different weapon. See `test/damage-paths.test.ts`,
 * which asserts both.
 *
 * @param attackerWeaponByte the FIRING ship's packed byte (`npcWeaponByte`)
 * @param target the ship being hit — its own bank, and nothing else's
 */
export function npcCrossfireDamage(
  attackerWeaponByte: number, target: NpcEnergyPolicy,
): NpcEnergyPoints {
  return npcEnergyPoints(Math.max(0,
    eliteANpcLaserStrength(attackerWeaponByte) - eliteANpcDefence(target.maxEnergy)));
}

/** The bank after taking `damage`. Floored at zero so destruction reads exactly 0. */
export function energyAfterDamage(energy: number, damage: NpcEnergyPoints): number {
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

// --- what used to be here ----------------------------------------------------
//
// `migratedNpcState` rebuilt a bank from a save written before ships had one,
// when a ship's toughness was `hp` on a normalized per-hull scale and
// `LEGACY_ASTEROID_HULL_POINTS` was a rock's share of it. It is deleted, with
// the whole pre-energy scale: nobody outside this project has ever played it,
// so there is no such save anywhere and the conversion served nobody (Chris,
// 2026-08-04 — the same answer docs/TODO/53 gave `migrateLegacySaves`).
// `World.restoreNpcs` hands a snapshot's state straight to `restoreState` now.
// `test/damage-paths.test.ts` fails if either name comes back.
