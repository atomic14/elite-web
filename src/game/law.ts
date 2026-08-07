// The law: what a scan finds, what a record costs, and what an attack does to
// your standing.
//
// The contraband set had FOUR homes — ILLEGAL_GOODS in commander.ts, a
// CONTRABAND Set in contracts.ts, and the bare literals `idx === 3 || idx === 6
// || idx === 10` in both screens/trade.ts and test/campaign.ts. Four copies of
// three magic numbers, kept in step by hope. This file consolidated them, and
// the numbers themselves are constants/law.ts now; everything about your
// standing with the Galactic Government is still decided here and nowhere else.

import {
  CLEAN, CONTRABAND, FUGITIVE, FUGITIVE_FINE, OFFENDER, OFFENDER_FINE,
} from '../constants/law.ts';

/** Is this commodity illegal to carry? */
export function isContraband(commodity: number): boolean {
  return CONTRABAND.includes(commodity);
}

/** Tonnes of illegal cargo in a hold. */
export function contrabandTonnes(cargo: readonly number[]): number {
  return CONTRABAND.reduce((sum, i) => sum + (cargo[i] ?? 0), 0);
}

/** Anything at all to hide from a police scan? */
export function carryingContraband(cargo: readonly number[]): boolean {
  return contrabandTonnes(cargo) > 0;
}

/** The fine for docking with a record, capped at what you can actually pay. */
export function fineFor(legalStatus: number, credits: number): number {
  if (legalStatus <= CLEAN) return 0;
  return Math.min(credits, legalStatus >= FUGITIVE ? FUGITIVE_FINE : OFFENDER_FINE);
}

/**
 * Buying your name back at a station: what a commander is left with after
 * paying to clear a record, or `null` when there is nothing to clear.
 *
 * The station does not fine you at the door any more (station.ts) — this is the
 * optional half. The charge is `fineFor`, capped at what you can pay, so a broke
 * commander is not trapped as a Fugitive; the cost is the credits, not the
 * impossibility. The caller applies the result and sets the status Clean.
 */
export function recordCleared(
  legalStatus: number, credits: number,
): { paid: number; creditsLeft: number } | null {
  if (legalStatus <= CLEAN) return null;
  const paid = fineFor(legalStatus, credits);
  return { paid, creditsLeft: credits - paid };
}

/**
 * How far your standing falls for harming a given ship.
 *
 * Shooting at police, traders or bounty hunters is an offence; destroying one
 * makes you a fugitive. Pirates, thargoids and rocks are nobody's business but
 * your own — the galaxy is glad to see the back of them.
 */
export function offenceFor(role: string, destroyed: boolean): number {
  if (role !== 'police' && role !== 'trader' && role !== 'hunter') return CLEAN;
  return destroyed ? FUGITIVE : OFFENDER;
}
