// The law, as numbers: what is illegal, what a record costs at the dock, and
// how far the Galactic Government can see.
//
// The rules that spend these — the scan, the fine, the offence ladder — are
// game/law.ts, which is the one place your standing with the law is decided.

/**
 * The three legal statuses, in the order the number encodes them. The names
 * are what the status screen and the console print; the constants below are
 * what every rule compares against.
 */
export const LEGAL_NAMES = ['Clean', 'Offender', 'Fugitive'] as const;

export const CLEAN = 0;
export const OFFENDER = 1;
export const FUGITIVE = 2;

/**
 * Commodity indices the Galactic Government defines as illegal: slaves,
 * narcotics and firearms.
 *
 * THE ONE DEFINITION. It had four homes — an ILLEGAL_GOODS in commander.ts, a
 * CONTRABAND Set in contracts.ts, and the bare literals `idx === 3 || idx ===
 * 6 || idx === 10` in both screens/trade.ts and test/campaign.ts — kept in
 * step by hope; legalise a commodity and three of them kept smuggling.
 * game/law.ts consolidated them and this is that single home, moved whole.
 * Note these are indices into the same 1984 table as `commodities.ts`'s
 * lists, and none of the classes overlap: contraband is never ordinary.
 */
export const CONTRABAND: readonly number[] = [3, 6, 10];

/**
 * The fine for docking with a record, capped at what you can actually pay.
 * Tenths of a credit (invariant 8), so these are 25 Cr and 75 Cr.
 */
export const OFFENDER_FINE = 250;
export const FUGITIVE_FINE = 750;

/**
 * Stations keep "a small fleet of ships for their own defence, which they may
 * risk to assist a trader if they see him attacked" — misbehave within this
 * range of the slot and Vipers launch.
 *
 * The same number as `PLAYER_INTEREST_RANGE` and NOT the same rule: that one
 * is measured from the COMMANDER and decides who engages you; this one is
 * measured from the STATION and decides whether the law shows up.
 * `player-interest.ts` records the pair from its side. How many Vipers, and
 * where they appear, is `spawn-placement.ts`'s stack.
 */
export const DEFENCE_RANGE = 9000;

/**
 * How close a police ship must be to scan your hold.
 *
 * The same number the NPC's firing gate USED to be (2,600, before it was
 * raised to the player's reach — see npc-gun.ts's history), and not the same
 * rule: a scan is a sensor sweep, not a shot, and it stayed put when the gun
 * moved.
 */
export const SCAN_RANGE = 2600;
