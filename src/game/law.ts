// The law: what is illegal, what it costs you, and when the Vipers launch.
//
// The contraband set had FOUR homes — ILLEGAL_GOODS in commander.ts, a
// CONTRABAND Set in contracts.ts, and the bare literals `idx === 3 || idx === 6
// || idx === 10` in both screens/trade.ts and test/campaign.ts. Four copies of
// three magic numbers, kept in step by hope. Legalise a commodity and three of
// them keep smuggling.
//
// This is that single home. Everything about your standing with the Galactic
// Government is decided here and nowhere else.

/** 0 = Clean, 1 = Offender, 2 = Fugitive. */
export const LEGAL_NAMES = ['Clean', 'Offender', 'Fugitive'] as const;

export const CLEAN = 0;
export const OFFENDER = 1;
export const FUGITIVE = 2;

/**
 * Commodity indices the Galactic Government defines as illegal: slaves,
 * narcotics and firearms. The ONE definition — see the note above.
 */
export const CONTRABAND: readonly number[] = [3, 6, 10];

const CONTRABAND_SET = new Set(CONTRABAND);

/** Is this commodity illegal to carry? */
export function isContraband(commodity: number): boolean {
  return CONTRABAND_SET.has(commodity);
}

/** Tonnes of illegal cargo in a hold. */
export function contrabandTonnes(cargo: readonly number[]): number {
  return CONTRABAND.reduce((sum, i) => sum + (cargo[i] ?? 0), 0);
}

/** Anything at all to hide from a police scan? */
export function carryingContraband(cargo: readonly number[]): boolean {
  return contrabandTonnes(cargo) > 0;
}

/**
 * The fine for docking with a record, capped at what you can actually pay.
 * Tenths of a credit (invariant 5), so these are 25 Cr and 75 Cr.
 */
export const OFFENDER_FINE = 250;
export const FUGITIVE_FINE = 750;

export function fineFor(legalStatus: number, credits: number): number {
  if (legalStatus <= CLEAN) return 0;
  return Math.min(credits, legalStatus >= FUGITIVE ? FUGITIVE_FINE : OFFENDER_FINE);
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

/**
 * Stations keep "a small fleet of ships for their own defence, which they may
 * risk to assist a trader if they see him attacked" — misbehave within sight
 * of the slot and Vipers launch.
 */
export const DEFENCE_RANGE = 9000;
/** How close a police ship must be to scan your hold. */
export const SCAN_RANGE = 2600;
