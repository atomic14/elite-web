// The shop: what a purchase costs right now, and what you already own.
//
// The price list itself is constants/shop.ts. This is the arithmetic over it:
// nothing here reads or writes a save — it takes a commander and answers a
// question about money. (The rules lived in commander.ts once, so "what does
// fuel cost?" was answered by the file about who the player is; a price list
// is not something that persists between sessions.)

import type { CommanderData } from './commander.ts';
import { MAX_FUEL, MAX_MISSILES } from '../constants/commander.ts';
import { FUEL_PRICE } from '../constants/shop.ts';

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
