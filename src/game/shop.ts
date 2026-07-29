// The shop: what things cost, and what you are allowed to fit.
//
// This is a price list, and a price list is not something that persists
// between sessions — which is what commander.ts is for. It lived there anyway,
// so "what does fuel cost?" was answered by the file about who the player is,
// and FUEL_PRICE ended up there by the same reasoning ("every other price is
// here") rather than by anyone deciding it belonged.
//
// Nothing here reads or writes a save. It takes a commander and answers a
// question about money: what a thing costs, whether you already own it, and
// how big your hold is once you have bought the bays.

import { MAX_FUEL, MAX_MISSILES, type CommanderData } from './commander.ts';

/**
 * What refuelling costs, in tenths of a credit per tenth of a LY.
 *
 * It lived as a bare
 * `* 0.4` inside `equipRows` in ui/screens.ts — a pricing rule in the render
 * layer, in a codebase whose own CLAUDE.md says that layer is pure rendering —
 * and had been copied into test/campaign.ts, train/jameson-autopilot.js and
 * docs/GAP-ANALYSIS.md. Four homes, none of them a shop.
 *
 * Deliberately 2x the 1984 manual's implied 0.2 — see docs/GAP-ANALYSIS.md.
 */
export const FUEL_PRICE = 0.4;

/** Tenths of a LY needed to fill the tank. */
export function fuelNeeded(c: { fuel: number }): number {
  return MAX_FUEL - c.fuel;
}

/** What filling the tank costs right now, in tenths of a credit. */
export function refuelCost(c: { fuel: number }): number {
  return Math.round(fuelNeeded(c) * FUEL_PRICE);
}

/** Everything a screen has to say about buying fuel. Money in tenths of a
 *  credit, fuel in tenths of a LY, as everywhere else. */
export interface FuelQuote {
  /** the shelf price: one light year, in tenths of a credit */
  perLightYear: number;
  /** tenths of a LY the tank is short */
  needed: number;
  /** tenths of a credit to fill it */
  cost: number;
  /** nothing to sell you */
  full: boolean;
}

/**
 * The refuelling quote, for any screen that wants to show it.
 *
 * Exists because the price is now quoted in two places — the outfitters and the
 * market — and the per-LIGHT-YEAR figure a shopper reads is a unit conversion
 * of `FUEL_PRICE` (which is per tenth of a LY). That conversion is a pricing
 * rule, so it lives here rather than being spelled `* 10` in the renderer: this
 * is the same file whose comment above records what happened the last time a
 * fuel sum was written in the render layer.
 */
export function fuelQuote(c: { fuel: number }): FuelQuote {
  const needed = fuelNeeded(c);
  return {
    perLightYear: Math.round(FUEL_PRICE * 10),
    needed,
    cost: refuelCost(c),
    full: needed <= 0,
  };
}

export interface EquipItem {
  id: string;
  name: string;
  price: number; // tenths of a credit
  minTL: number; // displayed tech level required
}

export const EQUIPMENT_CATALOGUE: EquipItem[] = [
  { id: 'missile', name: 'Missile', price: 300, minTL: 1 },
  { id: 'largeBay', name: 'Large Cargo Bay (35t)', price: 4000, minTL: 1 },
  { id: 'ecm', name: 'E.C.M. System', price: 6000, minTL: 2 },
  { id: 'rearLaser', name: 'Rear Pulse Laser', price: 4000, minTL: 3 },
  { id: 'leftLaser', name: 'Left Pulse Laser', price: 4000, minTL: 3 },
  { id: 'rightLaser', name: 'Right Pulse Laser', price: 4000, minTL: 3 },
  { id: 'beam', name: 'Beam Laser', price: 10000, minTL: 4 },
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

export function equipmentOwned(id: string, c: CommanderData): boolean {
  const e = c.equipment;
  switch (id) {
    case 'missile': return c.missiles >= MAX_MISSILES;
    case 'largeBay': return e.largeBay;
    case 'ecm': return e.ecm;
    case 'rearLaser': return e.rearLaser;
    case 'leftLaser': return e.leftLaser;
    case 'rightLaser': return e.rightLaser;
    case 'beam': return e.laser !== 'pulse';
    case 'scoops': return e.scoops;
    case 'escapePod': return e.escapePod;
    case 'energyBomb': return e.energyBomb;
    case 'energyUnit': return e.energyUnit;
    case 'dockingComputer': return e.dockingComputer;
    case 'miningLaser': return e.miningLaser;
    case 'combatComputer': return e.combatComputer;
    case 'trumble': return c.trumbles > 0;
    case 'military': return e.laser === 'military';
    case 'galacticDrive': return e.galacticDrive;
    default: return false;
  }
}
