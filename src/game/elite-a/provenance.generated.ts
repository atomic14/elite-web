// GENERATED FILE — DO NOT EDIT.
//
// The pack this catalogue came from, and what it contained.
//
// Written by `npm run generate:elite-a` from the vendored pack under
// reference/elite-a/source. To change it, change the importer or the pack,
// regenerate, and review the diff. `npm run generate:elite-a -- --check`
// fails if this file and the pack have drifted apart.
//
// source-hash: 85fece5618c1302dac6b2bbc5c6e78629d37fb5ac27769dddf24fb0b38b52ccb

/** SHA-256 over the vendored pack's per-file hashes — see reference/elite-a. */
export const ELITE_A_SOURCE_HASH = "85fece5618c1302dac6b2bbc5c6e78629d37fb5ac27769dddf24fb0b38b52ccb";

/** What the importer counted. A parity gate can assert these without the pack. */
export const ELITE_A_COUNTS = {
  playerHulls: 15,
  designs: 38,
  blueprintSets: 23,
  variants: 260,
  slotRows: 713,
  populatedSlots: 398,
  outgoingHitRows: 15600,
  incomingHitRows: 3900,
  rangeRows: 570,
} as const;

/** Bit position of each NEWB flag, solved from all 713 slot rows. */
export const ELITE_A_NEWB_BITS = {
  trader: 0,
  bountyHunter: 1,
  hostile: 2,
  pirate: 3,
  docking: 4,
  innocent: 5,
  cop: 6,
  escapePodFitted: 7,
} as const;
