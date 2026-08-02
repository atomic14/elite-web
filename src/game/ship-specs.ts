// The ship roster: which hulls fly which role, and how tough each one is.
//
// Pure data tables, in the spirit of the 1984 originals. They were 100 lines
// wedged into the middle of npc.ts between the hostility rules and the NpcShip
// class, which meant "what hp does a Krait have" was a question you answered
// by scrolling. Now it is a question you answer by opening the file called
// ship-specs.ts.
//
// Nothing here decides anything: population.ts chooses how many, contracts.ts
// chooses the threat tier, spawning.ts puts them in the sky.

import {
  type ShipDef, COBRA_MK3, PYTHON, ANACONDA, ADDER, WORM, BOA, SHUTTLE,
  TRANSPORTER, SIDEWINDER, KRAIT, MAMBA, GECKO, MORAY, VIPER, FER_DE_LANCE,
  ASP, THARGOID, THARGON, GENERATION_SHIP, CONSTRICTOR,
} from '../ships/geometry.ts';
import {
  eliteAShipIdentity, HARMLESS_OVERLAYS,
  type HarmlessOverlay, type NpcCombatProfileId, type ShipDesignId, type ShipIdentity,
} from './ship-identity.ts';

/** What a ship is FOR. The roster is keyed on it, so it lives here. */
export type NpcRole =
  'trader' | 'pirate' | 'police' | 'hunter' | 'thargoid' | 'thargon' | 'asteroid' |
  'hermit' | 'generation';

/**
 * Which source design each roster hull IS, stated once.
 *
 * The mapping is written down rather than inferred because inferring it is the
 * failure ship-identity.ts exists to prevent: `spec.def === COBRA_MK3` makes
 * the geometry table the identity table, and a hull reused for two ships (or
 * replaced with the exact source mesh in a later TODO) would silently change
 * what a ship is. These numbers are the pack's own design ids; every one is
 * validated by `eliteAShipIdentity` as the table below is built.
 */
const SOURCE_DESIGN = {
  shuttle: 8, transporter: 9, cobraMk3: 10, python: 11, boa: 12, anaconda: 13,
  worm: 14, viper: 16, sidewinder: 17, mamba: 18, krait: 19, adder: 20,
  gecko: 21, asp: 23, ferDeLance: 24, moray: 25, thargoid: 26, thargon: 27,
  constrictor: 28,
  /** The source roster's own rock — Harmless generates the mesh, TODO 24 owns the geometry. */
  asteroid: 6,
} as const;

/** `{ designId, profileId }` for a roster hull, spread into its spec below. */
const flying = (sourceDesignId: number): ShipIdentity => eliteAShipIdentity(sourceDesignId);

/** The same, for one of the two Harmless inventions — the ids alone, not the note. */
const own = (o: HarmlessOverlay): ShipIdentity =>
  ({ designId: o.designId, profileId: o.profileId });

/**
 * What an asteroid is. The `asteroid` role has no `NpcSpec` — its size is
 * rolled from the seed rather than rostered — so its identity lives here beside
 * the roster instead of being invented in the NpcShip constructor.
 */
export const ASTEROID_IDENTITY: ShipIdentity = flying(SOURCE_DESIGN.asteroid);

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

export interface NpcSpec {
  def: ShipDef | null; // null → asteroid
  /** which catalogue design this hull is — see ship-identity.ts, never inferred from `def` */
  designId: ShipDesignId;
  /** the exact released build it flies as, resolved from the recommended default */
  profileId: NpcCombatProfileId;
  color: number;
  hp: number;
  maxSpeed: number;
  turnRate: number;
  bounty: number; // tenths of a credit
  radius: number;
  /**
   * Units/s of thrust. Omitted means ACCEL_FRACTION of top speed, which is
   * what every hull wants unless it is deliberately sluggish or brisk — use
   * `shipAccel()` rather than reading this field.
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

export const SPECS: Record<Exclude<NpcRole, 'asteroid'>, NpcSpec[]> = {
  trader: [
    { def: COBRA_MK3, ...flying(SOURCE_DESIGN.cobraMk3), color: 0xffffff, hp: 1.0, maxSpeed: 220, turnRate: 0.5, bounty: 0, radius: 34, ecmChance: 0.4, cargoDrop: 3, armed: true },
    { def: PYTHON, ...flying(SOURCE_DESIGN.python), color: 0xd9e8ff, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 0, radius: 40, ecmChance: 0.5, cargoDrop: 5, armed: true },
    { def: ANACONDA, ...flying(SOURCE_DESIGN.anaconda), color: 0xcfe0d8, hp: 2.6, maxSpeed: 120, turnRate: 0.25, bounty: 0, radius: 55, ecmChance: 0.7, cargoDrop: 6, armed: true },
    { def: ADDER, ...flying(SOURCE_DESIGN.adder), color: 0xffe28a, hp: 0.5, maxSpeed: 260, turnRate: 0.8, bounty: 0, radius: 18, cargoDrop: 1 },
    { def: WORM, ...flying(SOURCE_DESIGN.worm), color: 0xbfd8bf, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 0, radius: 14, cargoDrop: 1 },
    { def: BOA, ...flying(SOURCE_DESIGN.boa), color: 0xd8d8c0, hp: 2.2, maxSpeed: 140, turnRate: 0.3, bounty: 0, radius: 44, ecmChance: 0.6, cargoDrop: 5, armed: true },
    { def: SHUTTLE, ...flying(SOURCE_DESIGN.shuttle), color: 0xc8e8c8, hp: 0.45, maxSpeed: 180, turnRate: 0.7, bounty: 0, radius: 14, cargoDrop: 1 },
    { def: TRANSPORTER, ...flying(SOURCE_DESIGN.transporter), color: 0xc0d0e0, hp: 0.6, maxSpeed: 160, turnRate: 0.5, bounty: 0, radius: 20, cargoDrop: 2 },
  ],
  pirate: [
    { def: SIDEWINDER, ...flying(SOURCE_DESIGN.sidewinder), color: 0xff9a5c, hp: 0.55, maxSpeed: 300, turnRate: 1.1, bounty: 50, radius: 18 },
    { def: KRAIT, ...flying(SOURCE_DESIGN.krait), color: 0xffb36c, hp: 0.7, maxSpeed: 290, turnRate: 1.0, bounty: 80, radius: 22 },
    { def: MAMBA, ...flying(SOURCE_DESIGN.mamba), color: 0xff8a4c, hp: 0.65, maxSpeed: 310, turnRate: 1.05, bounty: 70, radius: 24 },
    { def: GECKO, ...flying(SOURCE_DESIGN.gecko), color: 0xffa050, hp: 0.6, maxSpeed: 290, turnRate: 1.0, bounty: 60, radius: 20 },
    { def: MORAY, ...flying(SOURCE_DESIGN.moray), color: 0xff9a70, hp: 0.6, maxSpeed: 280, turnRate: 1.0, bounty: 65, radius: 18 },
    { def: COBRA_MK3, ...flying(SOURCE_DESIGN.cobraMk3), color: 0xffc46c, hp: 1.1, maxSpeed: 260, turnRate: 0.8, bounty: 100, radius: 34, missiles: 1, cargoDrop: 2 },
  ],
  police: [
    { def: VIPER, ...flying(SOURCE_DESIGN.viper), color: 0x9ad9ff, hp: 0.9, maxSpeed: 320, turnRate: 1.3, bounty: 0, radius: 20, ecmChance: 1 },
  ],
  hunter: [
    { def: FER_DE_LANCE, ...flying(SOURCE_DESIGN.ferDeLance), color: 0xd8c8ff, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 0, radius: 26, ecmChance: 0.6 },
    { def: ASP, ...flying(SOURCE_DESIGN.asp), color: 0xc8d8ff, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 0, radius: 22, ecmChance: 0.4 },
  ],
  thargoid: [
    { def: THARGOID, ...flying(SOURCE_DESIGN.thargoid), color: 0x7cff9a, hp: 2.6, maxSpeed: 300, turnRate: 0.7, bounty: 500, radius: 60, ecmChance: 1 },
  ],
  thargon: [
    { def: THARGON, ...flying(SOURCE_DESIGN.thargon), color: 0x9cffb0, hp: 0.2, maxSpeed: 350, turnRate: 1.8, bounty: 50, radius: 12 },
  ],
  // a hollowed asteroid trading post — inert, but you can dock with it. OURS,
  // not a source station, and its `harmless:` ids say so.
  hermit: [
    { def: null, ...own(HARMLESS_OVERLAYS.rockHermit), color: 0x9a9a8a, hp: 4, maxSpeed: 0, turnRate: 0, bounty: 0, radius: 120 },
  ],
  // derelict colony vessel: vast, slow, defenceless — also ours
  generation: [
    { def: GENERATION_SHIP, ...own(HARMLESS_OVERLAYS.generationShip), color: 0xbfc8d8, hp: 8, maxSpeed: 25, turnRate: 0.05, bounty: 0, radius: 340, cargoDrop: 8 },
  ],
};

/**
 * Pirate hulls by threat tier (see pirateThreat() in contracts.ts). Tier is
 * decided by how attractive a target the player looks — a poor Cobra full of
 * food draws opportunists in Sidewinders; a fat, notorious one draws a gang in
 * Fer-de-Lances. Passed to spawnNpc as a specOverride, so these stay ordinary
 * pirates for every other purpose (bounty, legality, police response).
 */
const PIRATE_TIERS: NpcSpec[][] = [
  // 0 — opportunists: cheap, fast, easily discouraged
  [
    { def: SIDEWINDER, ...flying(SOURCE_DESIGN.sidewinder), color: 0xff9a5c, hp: 0.55, maxSpeed: 300, turnRate: 1.1, bounty: 50, radius: 18 },
    { def: GECKO, ...flying(SOURCE_DESIGN.gecko), color: 0xffa050, hp: 0.6, maxSpeed: 290, turnRate: 1.0, bounty: 60, radius: 20 },
    { def: WORM, ...flying(SOURCE_DESIGN.worm), color: 0xffbb80, hp: 0.4, maxSpeed: 200, turnRate: 0.9, bounty: 40, radius: 14 },
  ],
  // 1 — professionals: the existing pirate mix
  [
    { def: KRAIT, ...flying(SOURCE_DESIGN.krait), color: 0xffb36c, hp: 0.7, maxSpeed: 290, turnRate: 1.0, bounty: 80, radius: 22 },
    { def: MAMBA, ...flying(SOURCE_DESIGN.mamba), color: 0xff8a4c, hp: 0.65, maxSpeed: 310, turnRate: 1.05, bounty: 70, radius: 24 },
    { def: MORAY, ...flying(SOURCE_DESIGN.moray), color: 0xff9a70, hp: 0.6, maxSpeed: 280, turnRate: 1.0, bounty: 65, radius: 18 },
    { def: COBRA_MK3, ...flying(SOURCE_DESIGN.cobraMk3), color: 0xffc46c, hp: 1.1, maxSpeed: 260, turnRate: 0.8, bounty: 100, radius: 34, missiles: 1, cargoDrop: 2 },
  ],
  // 2 — an organised gang: they brought the good ships, and missiles
  [
    { def: FER_DE_LANCE, ...flying(SOURCE_DESIGN.ferDeLance), color: 0xff7a4c, hp: 1.3, maxSpeed: 330, turnRate: 1.1, bounty: 180, radius: 26, missiles: 1, ecmChance: 0.5, cargoDrop: 2 },
    { def: ASP, ...flying(SOURCE_DESIGN.asp), color: 0xff8f5c, hp: 1.0, maxSpeed: 340, turnRate: 1.2, bounty: 150, radius: 22, missiles: 1, ecmChance: 0.3, cargoDrop: 1 },
    { def: PYTHON, ...flying(SOURCE_DESIGN.python), color: 0xffa878, hp: 1.8, maxSpeed: 160, turnRate: 0.35, bounty: 200, radius: 40, missiles: 2, ecmChance: 0.6, cargoDrop: 4 },
  ],
];

/** Pick a hull for a pirate of the given threat tier. */
export function pirateSpecForTier(tier: number, variantSeed: number): NpcSpec {
  const tiers = PIRATE_TIERS[Math.max(0, Math.min(PIRATE_TIERS.length - 1, tier))];
  return tiers[Math.abs(variantSeed) % tiers.length];
}

export const CONSTRICTOR_SPEC: NpcSpec = {
  def: CONSTRICTOR, ...flying(SOURCE_DESIGN.constrictor), color: 0xffd24d, hp: 3.2, maxSpeed: 370, turnRate: 1.2,
  bounty: 2500, radius: 24, missiles: 2, ecmChance: 1,
};
