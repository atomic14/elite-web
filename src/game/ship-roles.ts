// What a ship is FOR, and which released designs are ALLOWED to be it.
//
// `ship-specs.ts` says which hulls Harmless actually flies in each role. This
// says which hulls it may choose from, and the roster does not get a vote:
// Elite-A files every ship into one of 31 numbered blueprint slots, the same
// slot means the same job in all 23 released sets, and a design that never
// occupies a band is not a ship of that kind however much it looks like one.
//
//     6-8    mining        boulder, asteroid, splinter
//     9-10   shuttle, transporter
//     11-14  trader        (14 is the large carrier)
//     15     small child ship — what a mother ship launches
//     16     cop
//     17-24  pirate
//     25-28  bounty hunter
//     29-30  Thargoid, Thargon
//     31     the Constrictor, and nothing else
//
// Membership is read from what the sets DID, not from what the pack says a
// design may do (`eliteADesignsInSlotRange` in elite-a/catalogue.ts explains
// the difference). The Sidewinder is allowed in slots 19-24 and no released set
// ever put one there, so counting permissions would quietly widen every role.
//
// Harmless's roles are COARSER than the source's bands, so the mapping below is
// a decision and is written down as one. The one that matters: a Harmless
// `trader` covers the shuttle, transporter, trader and child bands, because
// Harmless has no separate role for a station shuttle or for the small craft a
// carrier launches, and both are civilian traffic here.
//
// That last band has a consequence worth stating. Slot 15 holds the Worm and
// the Sidewinder, so admitting it makes a Sidewinder a PERMITTED trader — and
// the alternative was to drop the band and with it the Worm, which has flown as
// civilian traffic here since long before the catalogue arrived and occupies no
// other civilian slot. Permission is not selection: the roster puts no
// Sidewinder in the trader list and `test/ship-roles.test.ts` says so. This
// module's job is to stop a hull being filed somewhere the source never filed
// it, not to make every choice for the roster.
//
// Two roles are OURS and have no band at all — the rock hermit and the
// generation ship. That emptiness is the point: a custom ship must not be able
// to wander into a released parity matrix, and `test/ship-roles.test.ts` holds
// it to that.

import { eliteADesignsInSlotRange } from './elite-a/catalogue.ts';
import { shipDesignIdOf, type ShipDesignId } from './ship-identity.ts';

/** What a ship is FOR. The roster is keyed on it. */
export type NpcRole =
  'trader' | 'pirate' | 'police' | 'hunter' | 'thargoid' | 'thargon' | 'asteroid' |
  'hermit' | 'generation';

/** One run of released blueprint slots that means one job. */
export type SourceSlotBand =
  'mining' | 'shuttle' | 'trader' | 'child' | 'police' | 'pirate' | 'hunter' |
  'thargoid' | 'thargon' | 'constrictor';

/** First and last slot of each band, inclusive. The source's own numbering. */
const BAND_SLOTS: Record<SourceSlotBand, readonly [number, number]> = {
  mining: [6, 8],
  // 9 is the shuttle slot and 10 the transporter; Harmless flies both as
  // station traffic, so they are one band here.
  shuttle: [9, 10],
  trader: [11, 14],
  child: [15, 15],
  police: [16, 16],
  pirate: [17, 24],
  hunter: [25, 28],
  thargoid: [29, 29],
  thargon: [30, 30],
  constrictor: [31, 31],
};

/**
 * Which source bands each coarse Harmless role draws from.
 *
 * `hermit` and `generation` are deliberately empty — see the header.
 */
const ROLE_BANDS: Record<NpcRole, readonly SourceSlotBand[]> = {
  trader: ['shuttle', 'trader', 'child'],
  pirate: ['pirate'],
  police: ['police'],
  hunter: ['hunter'],
  thargoid: ['thargoid'],
  thargon: ['thargon'],
  asteroid: ['mining'],
  hermit: [],
  generation: [],
};

const designsInBand = (band: SourceSlotBand): ShipDesignId[] =>
  eliteADesignsInSlotRange(...BAND_SLOTS[band]).map(shipDesignIdOf);

const idsFor = (bands: readonly SourceSlotBand[]): readonly ShipDesignId[] =>
  Object.freeze([...new Set(bands.flatMap(designsInBand))]);

const CANDIDATES: Record<NpcRole, readonly ShipDesignId[]> = {
  trader: idsFor(ROLE_BANDS.trader),
  pirate: idsFor(ROLE_BANDS.pirate),
  police: idsFor(ROLE_BANDS.police),
  hunter: idsFor(ROLE_BANDS.hunter),
  thargoid: idsFor(ROLE_BANDS.thargoid),
  thargon: idsFor(ROLE_BANDS.thargon),
  asteroid: idsFor(ROLE_BANDS.asteroid),
  hermit: idsFor(ROLE_BANDS.hermit),
  generation: idsFor(ROLE_BANDS.generation),
};

/** The bands a role draws from — empty for the two Harmless inventions. */
export function roleSourceBands(role: NpcRole): readonly SourceSlotBand[] {
  return ROLE_BANDS[role];
}

/** Every design a role MAY fly, in design order. Computed once at load. */
export function roleCandidateDesigns(role: NpcRole): readonly ShipDesignId[] {
  return CANDIDATES[role];
}

/** Is this design one the source ever filed under this role's job? */
export function roleAllowsDesign(role: NpcRole, designId: ShipDesignId): boolean {
  return CANDIDATES[role].includes(designId);
}

/**
 * The Navy's Constrictor — its own released slot, and nothing else's.
 *
 * It spawns with the `pirate` role because that is what it behaves like for
 * bounty, legality and police purposes, but slot 31 is not in the pirate band
 * and pretending it is would widen every ordinary pirate spawn to include it.
 * So it is named here instead, and `CONSTRICTOR_SPEC` is checked against this.
 */
export const MISSION_TARGET_DESIGNS: readonly ShipDesignId[] =
  idsFor(['constrictor']);
