// The ship roster: which hulls fly which role, and how tough each one is.
//
// Pure data tables, in the spirit of the 1984 originals. They were 100 lines
// wedged into the middle of npc.ts between the hostility rules and the NpcShip
// class, which meant "what hp does a Krait have" was a question you answered
// by scrolling. Now it is a question you answer by opening the file called
// ship-specs.ts.
//
// EVERY NUMBER IN THIS FILE IS HARMLESS'S. The rows say colour, hull points,
// cruise, turn rate, bounty, racks and racks alone — presentation, motion and
// selection policy. Not one source combat field is copied in: energy, defence,
// laser power and the released bounty live in the catalogue and are reached
// through `profileId`, so re-importing the pack cannot leave a stale twin here.
// The one source number the rows DO consume is a released top speed, and it
// arrives converted (`cruise`), never copied.
//
// Nothing here decides anything either: `ship-roles.ts` says which designs a
// role may fly at all, population.ts chooses how many, contracts.ts chooses the
// threat tier, spawning.ts puts them in the sky.

import { PLAYER_FLIGHT } from '../player.ts';
import { eliteADesign } from './elite-a/catalogue.ts';
import { hullThreatTier } from './threat.ts';
import type { NpcRole } from './ship-roles.ts';
import {
  COBRA_MK_3_HULL_ID, eliteAShipIdentity, HARMLESS_OVERLAYS, playerHull,
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

/** The ids a roster row states: which design, and which exact build of it. */
const flying = (sourceDesignId: number): ShipIdentity =>
  eliteAShipIdentity(sourceDesignId);

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

/**
 * A hull's `turnRate` is one number; pitch and roll caps are multiples of it.
 *
 * Lived in ai-training/core.ts, which npc.ts imported — the game reaching into
 * the trainer for one of its own hull constants, and the last thing keeping
 * that file alive after the simulator merged into the engine. It is a property
 * of the roster, so it lives with the roster.
 *
 * These are deliberately UNCHANGED. Pirates being harder to track than the
 * player was fixed by making the *player* more agile (MAX_PITCH/MAX_ROLL in
 * player.ts), not by slowing everyone down. Cutting them to 1.15/2.0 was tried
 * and reverted: it left the pirate/trader agility *ratio* identical while
 * lowering absolute turn rates, and evasion needs absolute agility far more
 * than aggression does — the Jameson defence went from dying in 10% of 2v1
 * fights to 92%, i.e. no better than an unarmed scripted trader.
 */
export const TURN = { pitch: 1.4, roll: 2.4 };

/**
 * How hard a hull accelerates, as a fraction of its top speed.
 *
 * Every ship therefore reaches its cruise in about 1/ACCEL_FRACTION seconds,
 * and a Sidewinder gets to 300 no slower than a Worm gets to 200.
 *
 * This exists because `accel` was a number the game did not have. npc.ts
 * throttled EVERY brain-flown ship at a flat `BRAIN_ACCEL = 120` while the
 * training simulator gave each hull its own — 140 for a Sidewinder, 120 for a
 * pirate Cobra, 100 for a trader Cobra. So a Sidewinder was trained with 17%
 * more throttle authority than the game gave it and armed traders with 17%
 * less, and test/run.ts carried a TODO asking an owner to pick a side. Per-hull
 * accel is the right model; its absence was an omission.
 *
 * The fraction is not invented: the simulator's three hand-written accels are
 * 140/300, 120/260 and 100/220 — 0.467, 0.462 and 0.455. They were one rule all
 * along. 0.46 reproduces all three to within a rounding step, so no ship's
 * handling moves by more than 2% from the model the brains were fitted in.
 */
export const ACCEL_FRACTION = 0.46;

// --- the one source-speed conversion ----------------------------------------

/**
 * World units per second for one unit of released top speed.
 *
 * Anchored exactly the way the geometry is (ships/elite-a-hulls.ts): on the
 * Cobra Mk III. The released player Cobra tops out at 42 source units and the
 * Harmless player ship at 400, so one source unit is 400/42 ≈ 9.52 units/s.
 * Read from both tables rather than written down, so neither can drift away
 * from it quietly.
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
  hp: number;
  maxSpeed: number;
  /**
   * Radians/second of yaw authority — and OURS.
   *
   * The Harmless motion overlay, along with `accel`: the pack has a top speed
   * per design and nothing else, because the original's handling is a table of
   * per-frame rotation bytes for a 2 MHz 6502 and not a number this flight
   * model could take. So every turn rate below is a browser-game constant
   * chosen for feel, and no re-import can supply one.
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
    { ...flying(SOURCE_DESIGN.cobraMk3), color: 0xffffff, hp: 1.0, maxSpeed: 220, turnRate: 0.5, bounty: 0, ecmChance: 0.4, cargoDrop: 3, armed: true },
    { ...flying(SOURCE_DESIGN.python), color: 0xd9e8ff, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 0, ecmChance: 0.5, cargoDrop: 5, armed: true },
    { ...flying(SOURCE_DESIGN.anaconda), color: 0xcfe0d8, hp: 2.6, maxSpeed: 120, turnRate: 0.25, bounty: 0, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { ...flying(SOURCE_DESIGN.adder), color: 0xffe28a, hp: 0.5, maxSpeed: 260, turnRate: 0.8, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.worm), color: 0xbfd8bf, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.boa), color: 0xd8d8c0, hp: 2.2, maxSpeed: 140, turnRate: 0.3, bounty: 0, ecmChance: 0.6, cargoDrop: 5, armed: true },
    { ...flying(SOURCE_DESIGN.shuttle), color: 0xc8e8c8, hp: 0.45, maxSpeed: 180, turnRate: 0.7, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.transporter), color: 0xc0d0e0, hp: 0.6, maxSpeed: 160, turnRate: 0.5, bounty: 0, cargoDrop: 2 },
    // --- brought into the roster by TODO 25; cruise converted, turn ours -----
    { ...flying(SOURCE_DESIGN.cobraMk1), color: 0xe8e8ff, hp: 0.8, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 0, ecmChance: 0.3, cargoDrop: 2, armed: true },
    { ...flying(SOURCE_DESIGN.dragon), color: 0xcfd8e8, hp: 2.5, maxSpeed: cruise(SOURCE_DESIGN.dragon), turnRate: 0.22, bounty: 0, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { ...flying(SOURCE_DESIGN.monitor), color: 0xd0d0c8, hp: 1.6, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 0, ecmChance: 0.5, cargoDrop: 4, armed: true },
    { ...flying(SOURCE_DESIGN.ophidian), color: 0xdfe8ff, hp: 0.55, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.ghavial), color: 0xd8e0d0, hp: 1.4, maxSpeed: cruise(SOURCE_DESIGN.ghavial), turnRate: 0.35, bounty: 0, ecmChance: 0.4, cargoDrop: 4, armed: true },
    { ...flying(SOURCE_DESIGN.rattler), color: 0xe0d8c8, hp: 1.2, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 0, cargoDrop: 2, armed: true },
    { ...flying(SOURCE_DESIGN.iguana), color: 0xd8e8c8, hp: 0.9, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.shuttleMk2), color: 0xc8e8d8, hp: 0.45, maxSpeed: cruise(SOURCE_DESIGN.shuttleMk2), turnRate: 0.6, bounty: 0, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.chameleon), color: 0xd8d8e8, hp: 1.1, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 0, ecmChance: 0.4, cargoDrop: 3, armed: true },
  ],
  // The pirate roster is ALSO the threat-tier table — see PIRATE_TIERS below.
  // The first six are the mix that has always flown; the next four used to be
  // reachable only through a tier; the last seven are new.
  pirate: [
    { ...flying(SOURCE_DESIGN.sidewinder), color: 0xff9a5c, hp: 0.55, maxSpeed: 300, turnRate: 1.1, bounty: 50 },
    { ...flying(SOURCE_DESIGN.krait), color: 0xffb36c, hp: 0.7, maxSpeed: 290, turnRate: 1.0, bounty: 80 },
    { ...flying(SOURCE_DESIGN.mamba), color: 0xff8a4c, hp: 0.65, maxSpeed: 310, turnRate: 1.05, bounty: 70 },
    { ...flying(SOURCE_DESIGN.gecko), color: 0xffa050, hp: 0.6, maxSpeed: 290, turnRate: 1.0, bounty: 60 },
    { ...flying(SOURCE_DESIGN.moray), color: 0xff9a70, hp: 0.6, maxSpeed: 280, turnRate: 1.0, bounty: 65 },
    { ...flying(SOURCE_DESIGN.cobraMk3), color: 0xffc46c, hp: 1.1, maxSpeed: 260, turnRate: 0.8, bounty: 100, missiles: 1, cargoDrop: 2 },
    { ...flying(SOURCE_DESIGN.worm), color: 0xffbb80, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 40 },
    { ...flying(SOURCE_DESIGN.ferDeLance), color: 0xff7a4c, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 180, missiles: 1, ecmChance: 0.5, cargoDrop: 2 },
    { ...flying(SOURCE_DESIGN.asp), color: 0xff8f5c, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 150, missiles: 1, ecmChance: 0.3, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.python), color: 0xffa878, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 200, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
    // --- brought into the roster by TODO 25 ---------------------------------
    { ...flying(SOURCE_DESIGN.cobraMk1), color: 0xffb066, hp: 0.8, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 90, cargoDrop: 2 },
    { ...flying(SOURCE_DESIGN.ophidian), color: 0xffc07a, hp: 0.55, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 55 },
    { ...flying(SOURCE_DESIGN.bushmaster), color: 0xff8f5c, hp: 0.7, maxSpeed: cruise(SOURCE_DESIGN.bushmaster), turnRate: 1.1, bounty: 110, missiles: 1 },
    { ...flying(SOURCE_DESIGN.rattler), color: 0xffa060, hp: 1.2, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 120, cargoDrop: 1 },
    { ...flying(SOURCE_DESIGN.iguana), color: 0xffb078, hp: 0.9, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 110 },
    { ...flying(SOURCE_DESIGN.chameleon), color: 0xff9a80, hp: 1.1, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 190, missiles: 1, ecmChance: 0.4, cargoDrop: 2 },
    { ...flying(SOURCE_DESIGN.monitor), color: 0xff7a5c, hp: 1.6, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 220, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
  ],
  police: [
    { ...flying(SOURCE_DESIGN.viper), color: 0x9ad9ff, hp: 0.9, maxSpeed: 320, turnRate: 1.3, bounty: 0, ecmChance: 1 },
  ],
  hunter: [
    { ...flying(SOURCE_DESIGN.ferDeLance), color: 0xd8c8ff, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 0, ecmChance: 0.6 },
    { ...flying(SOURCE_DESIGN.asp), color: 0xc8d8ff, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 0, ecmChance: 0.4 },
    // --- brought into the roster by TODO 25 ---------------------------------
    { ...flying(SOURCE_DESIGN.cobraMk1), color: 0xc8c8ff, hp: 0.8, maxSpeed: cruise(SOURCE_DESIGN.cobraMk1), turnRate: 0.85, bounty: 0, ecmChance: 0.3 },
    { ...flying(SOURCE_DESIGN.monitor), color: 0xc0c8e0, hp: 1.6, maxSpeed: cruise(SOURCE_DESIGN.monitor), turnRate: 0.35, bounty: 0, ecmChance: 0.6 },
    { ...flying(SOURCE_DESIGN.ophidian), color: 0xd0c8ff, hp: 0.55, maxSpeed: cruise(SOURCE_DESIGN.ophidian), turnRate: 1.05, bounty: 0, ecmChance: 0.3 },
    { ...flying(SOURCE_DESIGN.ghavial), color: 0xc8d0e8, hp: 1.4, maxSpeed: cruise(SOURCE_DESIGN.ghavial), turnRate: 0.35, bounty: 0, ecmChance: 0.5 },
    { ...flying(SOURCE_DESIGN.bushmaster), color: 0xd8c0ff, hp: 0.7, maxSpeed: cruise(SOURCE_DESIGN.bushmaster), turnRate: 1.1, bounty: 0, ecmChance: 0.4 },
    { ...flying(SOURCE_DESIGN.rattler), color: 0xccc8f0, hp: 1.2, maxSpeed: cruise(SOURCE_DESIGN.rattler), turnRate: 0.95, bounty: 0, ecmChance: 0.4 },
    { ...flying(SOURCE_DESIGN.iguana), color: 0xd0d8f0, hp: 0.9, maxSpeed: cruise(SOURCE_DESIGN.iguana), turnRate: 1.0, bounty: 0, ecmChance: 0.35 },
    { ...flying(SOURCE_DESIGN.chameleon), color: 0xd4c8f8, hp: 1.1, maxSpeed: cruise(SOURCE_DESIGN.chameleon), turnRate: 0.9, bounty: 0, ecmChance: 0.45 },
  ],
  thargoid: [
    { ...flying(SOURCE_DESIGN.thargoid), color: 0x7cff9a, hp: 2.6, maxSpeed: 300, turnRate: 0.7, bounty: 500, ecmChance: 1 },
  ],
  thargon: [
    { ...flying(SOURCE_DESIGN.thargon), color: 0x9cffb0, hp: 0.2, maxSpeed: 350, turnRate: 1.8, bounty: 50 },
  ],
  // a hollowed asteroid trading post — inert, but you can dock with it. OURS,
  // not a source station, and its `harmless:` ids say so.
  hermit: [
    { ...own(HARMLESS_OVERLAYS.rockHermit), color: 0x9a9a8a, hp: 4, maxSpeed: 0, turnRate: 0, bounty: 0 },
  ],
  // derelict colony vessel: vast, slow, defenceless — also ours
  generation: [
    { ...own(HARMLESS_OVERLAYS.generationShip), color: 0xbfc8d8, hp: 8, maxSpeed: 25, turnRate: 0.05, bounty: 0, cargoDrop: 8 },
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
  ...flying(SOURCE_DESIGN.constrictor), color: 0xffd24d, hp: 3.2, maxSpeed: 370, turnRate: 1.2,
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
 */
const BY_ROLE_AND_DESIGN = new Map<string, NpcSpec>(
  [
    ...Object.entries(SPECS).flatMap(
      ([role, list]) => list.map((s) => [`${role} ${s.designId}`, s] as const)),
    [`pirate ${CONSTRICTOR_SPEC.designId}`, CONSTRICTOR_SPEC] as const,
  ],
);

export function specForDesign(
  role: NpcRole, designId: ShipDesignId | undefined,
): NpcSpec | undefined {
  return designId === undefined
    ? undefined : BY_ROLE_AND_DESIGN.get(`${role} ${designId}`);
}
