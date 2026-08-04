// The shop: what things cost.
//
// Prices in tenths of a credit (invariant 8). The rules that spend them —
// what refuelling costs right now, whether you already own a thing, the
// trade-in arithmetic — are game/shop.ts and game/screens/trade.ts.
//
// The catalogue is Harmless's price list, stated as ours: most rows carry
// the 1984 outfitter's figures, and the ones that do not (the mining laser,
// the combat computer, the trumble) are this game's own additions.

import { LARGE_BAY_TONNES } from './commander.ts';

/**
 * What refuelling costs, in tenths of a credit per tenth of a LY.
 *
 * It lived as a bare `* 0.4` inside `equipRows` in ui/screens.ts — a pricing
 * rule in the render layer, in a codebase whose own CLAUDE.md says that layer
 * is pure rendering — and had been copied into test/campaign.ts,
 * train/jameson-autopilot.js and docs/GAP-ANALYSIS.md. Four homes, none of
 * them a shop. `test/economy.test.ts` still greps all four clean.
 *
 * Deliberately 2x the 1984 manual's implied 0.2 — see docs/GAP-ANALYSIS.md.
 */
export const FUEL_PRICE = 0.4;

/**
 * What a pulse laser costs, wherever it is mounted — and therefore what one
 * is worth as a trade-in.
 *
 * The fore pulse laser is the starting gun, so the shop has no row selling
 * one; the three side-mount rows below sell the same gun on another mount at
 * this price, and the laser upgrade path refunds the old gun at what it cost
 * (game/screens/trade.ts, "as per the manual"). Those were four bare 4000s
 * that happened to agree. The Large Cargo Bay is ALSO 4000 and is not this
 * rule — a coincidence of the price list, left as a literal in its row.
 */
export const PULSE_LASER_PRICE = 4000;

/**
 * The beam laser's price — named beside `PULSE_LASER_PRICE` because the
 * trade-in reads it too: upgrading beam-to-military refunds what the BEAM
 * cost. `test/trade.test.ts` holds both refunds against the catalogue.
 */
export const BEAM_LASER_PRICE = 10000;

/** One row of the outfitter's shelf. */
export interface EquipItem {
  id: string;
  name: string;
  price: number; // tenths of a credit
  minTL: number; // displayed tech level required
}

/**
 * The outfitter's shelf, in the order the screen lists it.
 *
 * The Large Cargo Bay's label interpolates `LARGE_BAY_TONNES` so the shelf
 * cannot advertise a bay the game does not fit (the survey's four-home cargo
 * capacity, unified in `commander.ts`).
 */
export const EQUIPMENT_CATALOGUE: EquipItem[] = [
  { id: 'missile', name: 'Missile', price: 300, minTL: 1 },
  { id: 'largeBay', name: `Large Cargo Bay (${LARGE_BAY_TONNES}t)`, price: 4000, minTL: 1 },
  { id: 'ecm', name: 'E.C.M. System', price: 6000, minTL: 2 },
  { id: 'rearLaser', name: 'Rear Pulse Laser', price: PULSE_LASER_PRICE, minTL: 3 },
  { id: 'leftLaser', name: 'Left Pulse Laser', price: PULSE_LASER_PRICE, minTL: 3 },
  { id: 'rightLaser', name: 'Right Pulse Laser', price: PULSE_LASER_PRICE, minTL: 3 },
  { id: 'beam', name: 'Beam Laser', price: BEAM_LASER_PRICE, minTL: 4 },
  { id: 'scoops', name: 'Fuel Scoops', price: 5250, minTL: 5 },
  { id: 'escapePod', name: 'Escape Pod', price: 10000, minTL: 6 },
  { id: 'energyBomb', name: 'Energy Bomb', price: 9000, minTL: 7 },
  { id: 'energyUnit', name: 'Extra Energy Unit', price: 15000, minTL: 8 },
  { id: 'dockingComputer', name: 'Docking Computer', price: 15000, minTL: 9 },
  { id: 'miningLaser', name: 'Mining Laser', price: 8000, minTL: 10 },
  { id: 'combatComputer', name: 'Combat Computer', price: 20000, minTL: 9 },
  { id: 'trumble', name: 'Trumble (adorable, harmless*)', price: 20, minTL: 1 },
  { id: 'military', name: 'Military Laser', price: 60000, minTL: 10 },
  { id: 'galacticDrive', name: 'Galactic Hyperdrive', price: 50000, minTL: 10 },
];
