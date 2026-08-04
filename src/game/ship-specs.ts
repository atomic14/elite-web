// The ship roster: which hulls fly which role, and how tough each one is.
//
// Pure data tables, in the spirit of the 1984 originals. They were 100 lines
// wedged into the middle of npc.ts between the hostility rules and the NpcShip
// class, which meant "what hp does a Krait have" was a question you answered
// by scrolling. Now it is a question you answer by opening the file called
// ship-specs.ts.
//
// EVERY NUMBER IN THIS FILE IS HARMLESS'S. The rows say colour, cruise, turn
// rate, bounty, racks and racks alone — presentation, motion and selection
// policy. Not one source combat field is copied in: energy, defence, laser
// power and the released bounty live in the catalogue and are reached through
// `profileId`, so re-importing the pack cannot leave a stale twin here. The one
// source number the rows DO consume is a released top speed, and it arrives
// converted (`cruise`), never copied.
//
// HOW TOUGH A SHIP IS LEFT THIS FILE IN TODO 26, and there is no trace of it
// here now. The old `hp` column survived as `legacyHullPoints` — scaffolding
// that decided nothing, kept so a save written before ships had energy could be
// rescaled. That save does not exist (Chris, 2026-08-04), so the migration and
// the column both went; a row's toughness is the released bank its `profileId`
// resolves to, and nothing else.
//
// Nothing here decides anything either: `ship-roles.ts` says which designs a
// role may fly at all, population.ts chooses how many, contracts.ts chooses the
// threat tier, spawning.ts puts them in the sky.

import { ACCEL_FRACTION } from '../constants/hull-motion.ts';
import { PLAYER_FLIGHT } from '../constants/player-flight.ts';
import { eliteADesign } from './elite-a/catalogue.ts';
import { hullThreatTier } from './threat.ts';
import { roleCombatProfileId } from './role-variants.ts';
import type { NpcRole } from './ship-roles.ts';
import {
  COBRA_MK_3_HULL_ID, eliteAShipIdentity, HARMLESS_OVERLAYS, playerHull, shipDesignIdOf,
  type HarmlessOverlay, type NpcCombatProfileId, type ShipDesignId, type ShipIdentity,
} from './ship-identity.ts';

/**
 * Which source design each roster hull IS, stated once.
 *
 * The mapping is written down rather than inferred because inferring it is the
 * failure ship-identity.ts exists to prevent: `spec.def === COBRA_MK3` makes
 * the geometry table the identity table, and a hull reused for two ships would
 * silently change what a ship is. These numbers are the pack's own design ids;
 * every one is validated by `eliteAShipIdentity` as the table below is built.
 */
const SOURCE_DESIGN = {
  shuttle: 8, transporter: 9, cobraMk3: 10, python: 11, boa: 12, anaconda: 13,
  worm: 14, viper: 16, sidewinder: 17, mamba: 18, krait: 19, adder: 20,
  gecko: 21, cobraMk1: 22, asp: 23, ferDeLance: 24, moray: 25, thargoid: 26,
  thargon: 27, constrictor: 28, dragon: 29, monitor: 30, ophidian: 31,
  ghavial: 32, bushmaster: 33, rattler: 34, iguana: 35, shuttleMk2: 36,
  chameleon: 37,
  /** The source roster's own rock — the one design whose mesh Harmless generates. */
  asteroid: 6,
} as const;

/**
 * The ids a roster row states: which design, and which exact build of it.
 *
 * THE ROLE IS AN ARGUMENT because the build depends on the job. A pirate flies
 * the hardest released build of its hull that the source ever filed as a pirate;
 * a trader flies the pack's recommended default. Both are exact released
 * variants of the same design — the rule, and why it is not a balance change,
 * is `game/role-variants.ts`.
 */
const flying = (role: NpcRole, sourceDesignId: number): ShipIdentity => {
  const designId = shipDesignIdOf(sourceDesignId);
  return { designId, profileId: roleCombatProfileId(role, designId) };
};

/** The same, for one of the two Harmless inventions — the ids alone, not the note. */
const own = (o: HarmlessOverlay): ShipIdentity =>
  ({ designId: o.designId, profileId: o.profileId });

/**
 * What an asteroid is. The `asteroid` role has no `NpcSpec` — its size is
 * rolled from the seed rather than rostered — so its identity lives here beside
 * the roster instead of being invented in the NpcShip constructor.
 *
 * The IDS only, deliberately: a rock is generated (`buildAsteroid`) at a size
 * drawn from its seed, so it is the one design whose mesh and radius do not
 * come from the registry. That is a Harmless deviation — the released asteroid
 * is one fixed 20-unit lump and rocks that all match are worse to fly among —
 * and it is stated here, and in docs/GAP-ANALYSIS.md, rather than being a
 * silent difference.
 */
export const ASTEROID_IDENTITY: ShipIdentity = eliteAShipIdentity(SOURCE_DESIGN.asteroid);

// --- the one source-speed conversion ----------------------------------------

/**
 * World units per second for one unit of released top speed.
 *
 * Anchored exactly the way the geometry is (ships/elite-a-hulls.ts): on the
 * Cobra Mk III. The released player Cobra tops out at 42 source units and the
 * Harmless player ship at 400, so one source unit is 400/42 ≈ 9.52 units/s.
 * Read from both tables rather than written down, so neither can drift away
 * from it quietly.
 *
 * IT IS NOT IN `src/constants/` and it is the one thing this slice left behind.
 * Half of it is `PLAYER_FLIGHT`, which is there; the other half is a released
 * hull, and reaching a released hull means `ship-identity.ts` -> `catalogue.ts`
 * -> six generated tables, which is a long way outside a directory that may not
 * import. Restating 42 as a literal would put a pack number in a Harmless file,
 * which is the one thing the header above forbids. So the expression stays here
 * where both halves are already in scope, and the cleanup list records why.
 */
export const WORLD_SPEED_PER_SOURCE_SPEED =
  PLAYER_FLIGHT.maxSpeed / playerHull(COBRA_MK_3_HULL_ID).maxSpeed;

/** A released top speed in world units/second. The only conversion there is. */
export function sourceSpeedToWorld(sourceSpeed: number): number {
  return Math.round(sourceSpeed * WORLD_SPEED_PER_SOURCE_SPEED);
}

/**
 * The cruise for a hull Harmless has never chosen one for.
 *
 * Used by the ten designs this phase brought into the roster and by nothing
 * else. The nineteen that were already flying keep the speeds they were tuned
 * and trained at: those numbers are the world the shipped brains were fitted
 * in, and re-deriving them would move every hull by up to 40% for no reason
 * connected to damage. So the conversion applies where there was nothing, and
 * the older tuning stands — which is why a Shuttle cruises at 180 and a Shuttle
 * Mk II, converted, at 86.
 */
const cruise = (sourceDesignId: number): number =>
  sourceSpeedToWorld(eliteADesign(sourceDesignId).maxSpeed);

export interface NpcSpec extends ShipIdentity {
  /** which catalogue design this hull is — see ship-identity.ts */
  designId: ShipDesignId;
  /** the exact released build it flies as, resolved from the recommended default */
  profileId: NpcCombatProfileId;
  color: number;
  // NO HULL POINTS. `legacyHullPoints` was here until 2026-08-04, ~1.0 for a
  // Cobra Mk III on the normalized scale TODO 26 replaced. Its own comment
  // claimed two readers and by then had only one — a training episode's target
  // stopped being normalized at TODO 27 and nobody updated the sentence — and
  // that one was the pre-energy save migration, which serves nobody. How tough
  // a ship is comes through `profileId`.
  maxSpeed: number;
  /**
   * Radians/second of yaw authority — and OURS.
   *
   * The Harmless motion overlay, along with `accel`: the pack has a top speed
   * per design and nothing else, because the original's handling is a table of
   * per-frame rotation bytes for a 2 MHz 6502 and not a number this flight
   * model could take. So every turn rate below is a browser-game constant
   * chosen for feel, and no re-import can supply one.
   *
   * This is the PER-HULL half and it is data. The multipliers every row shares
   * — `TURN` and `ACCEL_FRACTION` — are `constants/hull-motion.ts`.
   */
  turnRate: number;
  bounty: number; // tenths of a credit
  /**
   * Units/s of thrust. Omitted means ACCEL_FRACTION of top speed, which is
   * what every hull wants unless it is deliberately sluggish or brisk — use
   * `shipAccel()` rather than reading this field. Also part of the motion
   * overlay: the pack does not define it.
   */
  accel?: number;
  missiles?: number;
  ecmChance?: number;
  cargoDrop?: number; // max canisters dropped on destruction
  armed?: boolean; // fights back (with the Jameson defence brain) when attacked
}

/** How hard this hull can throttle, units/s. See ACCEL_FRACTION. */
export function shipAccel(spec: NpcSpec): number {
  return spec.accel ?? spec.maxSpeed * ACCEL_FRACTION;
}

/**
 * The roster.
 *
 * Which designs each role MAY contain is `ship-roles.ts`'s answer, read off the
 * released blueprint slots, and `test/ship-roles.test.ts` holds every row below
 * to it — so a hull cannot be filed as a trader because it looked like one.
 * Which of the permitted designs a role actually flies is a choice, and this is
 * where it is made.
 */
export const SPECS: Record<Exclude<NpcRole, 'asteroid'>, NpcSpec[]> = {
  trader: [
    { ...flying('trader', SOURCE_DESIGN.cobraMk3), color: 0xffffff, maxSpeed: 220, turnRate: 0.5, bounty: 0, ecmChance: 0.4, cargoDrop: 3, armed: true },
    { ...flying('trader', SOURCE_DESIGN.python), color: 0xd9e8ff, maxSpeed: 160, turnRate: 0.35, bounty: 0, ecmChance: 0.5, cargoDrop: 5, armed: true },
    { ...flying('trader', SOURCE_DESIGN.anaconda), color: 0xcfe0d8, maxSpeed: 120, turnRate: 0.25, bounty: 0, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { ...flying('trader', SOURCE_DESIGN.adder), color: 0xffe28a, maxSpeed: 260, turnRate: 0.8, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.worm), color: 0xbfd8bf, maxSpeed: 200, turnRate: 0.9, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.boa), color: 0xd8d8c0, maxSpeed: 140, turnRate: 0.3, bounty: 0, ecmChance: 0.6, cargoDrop: 5, armed: true },
    { ...flying('trader', SOURCE_DESIGN.shuttle), color: 0xc8e8c8, maxSpeed: 180, turnRate: 0.7, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.transporter), color: 0xc0d0e0, maxSpeed: 160, turnRate: 0.5, bounty: 0, cargoDrop: 2 },
    // --- brought into the roster by TODO 25; cruise converted, turn ours -----
    { ...flying('trader', SOURCE_DESIGN.cobraMk1), color: 0xe8e8ff, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 0, ecmChance: 0.3, cargoDrop: 2, armed: true },
    { ...flying('trader', SOURCE_DESIGN.dragon), color: 0xcfd8e8, maxSpeed: cruise(SOURCE_DESIGN.dragon), turnRate: 0.22, bounty: 0, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { ...flying('trader', SOURCE_DESIGN.monitor), color: 0xd0d0c8, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 0, ecmChance: 0.5, cargoDrop: 4, armed: true },
    { ...flying('trader', SOURCE_DESIGN.ophidian), color: 0xdfe8ff, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.ghavial), color: 0xd8e0d0, maxSpeed: cruise(SOURCE_DESIGN.ghavial), turnRate: 0.35, bounty: 0, ecmChance: 0.4, cargoDrop: 4, armed: true },
    { ...flying('trader', SOURCE_DESIGN.rattler), color: 0xe0d8c8, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 0, cargoDrop: 2, armed: true },
    { ...flying('trader', SOURCE_DESIGN.iguana), color: 0xd8e8c8, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.shuttleMk2), color: 0xc8e8d8, maxSpeed: cruise(SOURCE_DESIGN.shuttleMk2), turnRate: 0.6, bounty: 0, cargoDrop: 1 },
    { ...flying('trader', SOURCE_DESIGN.chameleon), color: 0xd8d8e8, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 0, ecmChance: 0.4, cargoDrop: 3, armed: true },
  ],
  // The pirate roster is ALSO the threat-tier table — see PIRATE_TIERS below.
  // The first six are the mix that has always flown; the next four used to be
  // reachable only through a tier; the last seven are new.
  pirate: [
    { ...flying('pirate', SOURCE_DESIGN.sidewinder), color: 0xff9a5c, maxSpeed: 300, turnRate: 1.1, bounty: 50 },
    { ...flying('pirate', SOURCE_DESIGN.krait), color: 0xffb36c, maxSpeed: 290, turnRate: 1.0, bounty: 80 },
    { ...flying('pirate', SOURCE_DESIGN.mamba), color: 0xff8a4c, maxSpeed: 310, turnRate: 1.05, bounty: 70 },
    { ...flying('pirate', SOURCE_DESIGN.gecko), color: 0xffa050, maxSpeed: 290, turnRate: 1.0, bounty: 60 },
    { ...flying('pirate', SOURCE_DESIGN.moray), color: 0xff9a70, maxSpeed: 280, turnRate: 1.0, bounty: 65 },
    { ...flying('pirate', SOURCE_DESIGN.cobraMk3), color: 0xffc46c, maxSpeed: 260, turnRate: 0.8, bounty: 100, missiles: 1, cargoDrop: 2 },
    { ...flying('pirate', SOURCE_DESIGN.worm), color: 0xffbb80, maxSpeed: 200, turnRate: 0.9, bounty: 40 },
    { ...flying('pirate', SOURCE_DESIGN.ferDeLance), color: 0xff7a4c, maxSpeed: 330, turnRate: 1.1, bounty: 180, missiles: 1, ecmChance: 0.5, cargoDrop: 2 },
    // THE ASP MK II IS NOT HERE, and it is the one deliberate omission in the
    // roster. All three of its released builds — I:23, N:23 and T:23 — carry
    // the same packed byte, and under the clean rule that byte is worth four
    // points before armour. The SMALLEST per-hit armour among the fifteen
    // flyable hulls is four (the Adder), so an Asp does exactly ZERO to every
    // ship the commander can fly; armour comes off each hit before the shield
    // sees it, so a pack of them accumulates nothing either. It chased, it shot,
    // and it could never win.
    //
    // No selection fixes it: `role-variants.ts` picks the hardest build the
    // source ever filed as a pirate, and every Asp build is that same byte. The
    // alternatives were to invent a figure the pack does not contain, or to
    // adopt the released `>> 1` diagnostic encoding — which the fidelity
    // contract forbids, because it lets the missile bits add to a laser hit. So
    // the ship keeps its catalogue record, its geometry and its identity, and
    // is simply not rostered as something whose job is to shoot you.
    // `test/ship-roles.test.ts` asserts that no combat role flies a build which
    // cannot hurt a Cobra Mk III, which is what keeps this decided.
    { ...flying('pirate', SOURCE_DESIGN.python), color: 0xffa878, maxSpeed: 160, turnRate: 0.35, bounty: 200, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
    // --- brought into the roster by TODO 25 ---------------------------------
    { ...flying('pirate', SOURCE_DESIGN.cobraMk1), color: 0xffb066, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 90, cargoDrop: 2 },
    { ...flying('pirate', SOURCE_DESIGN.ophidian), color: 0xffc07a, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 55 },
    { ...flying('pirate', SOURCE_DESIGN.bushmaster), color: 0xff8f5c, maxSpeed: cruise(SOURCE_DESIGN.bushmaster), turnRate: 1.1, bounty: 110, missiles: 1 },
    { ...flying('pirate', SOURCE_DESIGN.rattler), color: 0xffa060, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 120, cargoDrop: 1 },
    { ...flying('pirate', SOURCE_DESIGN.iguana), color: 0xffb078, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 110 },
    { ...flying('pirate', SOURCE_DESIGN.chameleon), color: 0xff9a80, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 190, missiles: 1, ecmChance: 0.4, cargoDrop: 2 },
    { ...flying('pirate', SOURCE_DESIGN.monitor), color: 0xff7a5c, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 220, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
  ],
  police: [
    { ...flying('police', SOURCE_DESIGN.viper), color: 0x9ad9ff, maxSpeed: 320, turnRate: 1.3, bounty: 0, ecmChance: 1 },
  ],
  hunter: [
    { ...flying('hunter', SOURCE_DESIGN.ferDeLance), color: 0xd8c8ff, maxSpeed: 330, turnRate: 1.1, bounty: 0, ecmChance: 0.6 },
    // The Asp Mk II is not a bounty hunter here either — same reason, stated
    // once in the pirate list above.
    // --- brought into the roster by TODO 25 ---------------------------------
    { ...flying('hunter', SOURCE_DESIGN.cobraMk1), color: 0xc8c8ff, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 0, ecmChance: 0.3 },
    { ...flying('hunter', SOURCE_DESIGN.monitor), color: 0xc0c8e0, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 0, ecmChance: 0.6 },
    { ...flying('hunter', SOURCE_DESIGN.ophidian), color: 0xd0c8ff, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 0, ecmChance: 0.3 },
    { ...flying('hunter', SOURCE_DESIGN.ghavial), color: 0xc8d0e8, maxSpeed: cruise(SOURCE_DESIGN.ghavial), turnRate: 0.35, bounty: 0, ecmChance: 0.5 },
    { ...flying('hunter', SOURCE_DESIGN.bushmaster), color: 0xd8c0ff, maxSpeed: cruise(SOURCE_DESIGN.bushmaster), turnRate: 1.1, bounty: 0, ecmChance: 0.4 },
    { ...flying('hunter', SOURCE_DESIGN.rattler), color: 0xccc8f0, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 0, ecmChance: 0.4 },
    { ...flying('hunter', SOURCE_DESIGN.iguana), color: 0xd0d8f0, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 0, ecmChance: 0.35 },
    { ...flying('hunter', SOURCE_DESIGN.chameleon), color: 0xd4c8f8, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 0, ecmChance: 0.45 },
  ],
  thargoid: [
    { ...flying('thargoid', SOURCE_DESIGN.thargoid), color: 0x7cff9a, maxSpeed: 300, turnRate: 0.7, bounty: 500, ecmChance: 1 },
  ],
  thargon: [
    { ...flying('thargon', SOURCE_DESIGN.thargon), color: 0x9cffb0, maxSpeed: 350, turnRate: 1.8, bounty: 50 },
  ],
  // a hollowed asteroid trading post — inert, but you can dock with it. OURS,
  // not a source station, and its `harmless:` ids say so.
  hermit: [
    { ...own(HARMLESS_OVERLAYS.rockHermit), color: 0x9a9a8a, maxSpeed: 0, turnRate: 0, bounty: 0 },
  ],
  // derelict colony vessel: vast, slow, defenceless — also ours
  generation: [
    { ...own(HARMLESS_OVERLAYS.generationShip), color: 0xbfc8d8, maxSpeed: 25, turnRate: 0.05, bounty: 0, cargoDrop: 8 },
  ],
};

/**
 * Pirate hulls by threat tier (see pirateThreat() in threat.ts). Tier is
 * decided by how attractive a target the player looks — a poor Cobra full of
 * food draws opportunists in Sidewinders; a fat, notorious one draws a gang in
 * Fer-de-Lances. Passed to spawnNpc as a specOverride, so these stay ordinary
 * pirates for every other purpose (bounty, legality, police response).
 *
 * DERIVED, not written. This was three hand-typed lists that repeated the
 * pirate roster in a different order and, between them, a fourth opinion about
 * how tough each hull was. The tier is `hullThreatTier` now — energy, defence
 * and laser power off the exact released build — so a hull moves tier only when
 * the pack says it got tougher, and every entry keeps the presentation its one
 * roster row states. Order within a tier is roster order, which is why every
 * seed that picked a hull before this phase still picks the same one.
 */
export const PIRATE_TIERS: NpcSpec[][] = [0, 1, 2].map(
  (tier) => SPECS.pirate.filter((s) => hullThreatTier(s.designId, s.profileId) === tier));

/** Pick a hull for a pirate of the given threat tier. */
export function pirateSpecForTier(tier: number, variantSeed: number): NpcSpec {
  const tiers = PIRATE_TIERS[Math.max(0, Math.min(PIRATE_TIERS.length - 1, tier))];
  return tiers[Math.abs(variantSeed) % tiers.length];
}

export const CONSTRICTOR_SPEC: NpcSpec = {
  // `pirate` is the role it flies with, and its released slot 31 is in no
  // pirate band — so `role-variants.ts` leaves it on the pack's recommended
  // build, `G:28`, which is the only one there is.
  ...flying('pirate', SOURCE_DESIGN.constrictor), color: 0xffd24d, maxSpeed: 370, turnRate: 1.2,
  bounty: 2500, missiles: 2, ecmChance: 1,
};

/**
 * The roster row for a design a ship ALREADY knows it is.
 *
 * Restoring a save is the caller (persistence.ts). A snapshot carries the
 * ship's `designId`, and rebuilding it from a tier table instead meant a pirate
 * spawned outside the tier tables — the combat trainer's hull picker offers
 * exactly that — came back on a different hull while keeping its saved
 * identity, so the two disagreed for the rest of the session. Looking the row
 * up by design cannot disagree with it.
 *
 * The Constrictor is included under `pirate` because that is the role it flies
 * with; it is not in `SPECS.pirate` for the reason `ship-roles.ts` gives.
 *
 * `KEY_SEP` joins the two halves of a key, and it is written as an ESCAPE. It
 * used to be a raw NUL byte in the source, which made this file `data` to
 * file(1) — and both `grep -r` and ripgrep skip a binary file in silence, so
 * the roster was invisible to every repo-wide search anybody ran over it. The
 * key's bytes are unchanged; only the way the source spells them is, and
 * test/ship-roles.test.ts fails if a raw one comes back.
 */
const KEY_SEP = '\u0000';

const BY_ROLE_AND_DESIGN = new Map<string, NpcSpec>(
  [
    ...Object.entries(SPECS).flatMap(
      ([role, list]) => list.map((s) => [`${role}${KEY_SEP}${s.designId}`, s] as const)),
    [`pirate${KEY_SEP}${CONSTRICTOR_SPEC.designId}`, CONSTRICTOR_SPEC] as const,
  ],
);

/**
 * The roster row a ship of this role and seed flies — the rule the NpcShip
 * constructor applies, as a function.
 *
 * It has one caller now — `NpcShip`'s constructor. It was extracted because
 * restoring a pre-energy save needed the same answer and had to ask the same
 * question or it would divide by the wrong hull; that migration is gone, and
 * the extraction is kept because the rule reads better named than inlined.
 *
 * `null` for a rock: its size is rolled from the seed, so it has no row.
 */
export function rosterSpec(
  role: NpcRole, variantSeed: number, override?: NpcSpec,
): NpcSpec | null {
  if (role === 'asteroid') return null;
  return override ?? SPECS[role][variantSeed % SPECS[role].length];
}

export function specForDesign(
  role: NpcRole, designId: ShipDesignId | undefined,
): NpcSpec | undefined {
  return designId === undefined
    ? undefined : BY_ROLE_AND_DESIGN.get(`${role}${KEY_SEP}${designId}`);
}
