// Station bulletin-board contracts, and the living-galaxy price nudge.
//
// Pure functions, deliberately free of three.js and DOM so that both the
// game (src/game/game.ts) and the headless campaign simulator
// (test/campaign.ts) run the *same* rules — a balance test that mirrored
// the logic instead of calling it would be worthless.
//
// Erasable-TypeScript only: Node runs this directly via
// --experimental-strip-types.

// .ts extension: this module is run directly by Node (--experimental-strip-types)
// for the campaign simulator, and COMMODITIES is a value import, not a type.
import { COMMODITIES, type StarSystem, type MarketEntry } from '../galaxy/galaxy.ts';
import type { Contract } from './commander';

/** Chart distance in tenths of a light-year (the original's metric). */
export function chartDistanceTenths(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return Math.round(4 * Math.sqrt(dx * dx + dy * dy));
}

/**
 * Work on offer at a station today. Deliberately more generous than the
 * original, which gated every mission behind a high combat rating: a new
 * commander should always have somewhere to be. Rewards were tuned against
 * the autonomous playtest agent's ledger (see docs/DEVLOG.md).
 */
export function generateContractOffers(
  sys: StarSystem,
  systems: StarSystem[],
  day: number,
  rng: () => number = Math.random,
): Contract[] {
  const reachable = systems.filter((s) => {
    const d = chartDistanceTenths(sys, s);
    return s.index !== sys.index && d > 0 && d <= 68;
  });
  if (!reachable.length) return [];

  const offers: Contract[] = [];
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const dest = reachable[Math.floor(rng() * reachable.length)];
    const dist = chartDistanceTenths(sys, dest);
    const roll = rng();
    if (roll < 0.55) {
      // cargo run: they supply the goods, you supply the nerve
      const commodity = [0, 1, 4, 8, 9, 12][Math.floor(rng() * 6)];
      const qty = 3 + Math.floor(rng() * 8);
      offers.push({
        kind: 'cargo',
        destination: dest.index,
        commodity,
        qty,
        reward: Math.round(qty * (22 + dist * 1.6) + 90),
        deadlineDay: day + 4 + Math.ceil(dist / 12),
        progress: 0,
      });
    } else if (roll < 0.8) {
      offers.push({
        kind: 'courier',
        destination: dest.index,
        commodity: 0,
        qty: 0,
        reward: Math.round(240 + dist * 6.0),
        deadlineDay: day + 3 + Math.ceil(dist / 16),
        progress: 0,
      });
    } else {
      const qty = 2 + Math.floor(rng() * 3);
      offers.push({
        kind: 'bounty',
        destination: dest.index,
        commodity: 0,
        qty,
        reward: Math.round(qty * 170 + dist * 4),
        deadlineDay: day + 6 + Math.ceil(dist / 10),
        progress: 0,
      });
    }
  }
  return offers;
}

/**
 * The 1984 market, nudged by the living galaxy: supply that actually
 * arrived makes goods cheaper here, cargo lost to pirates makes them
 * dearer. Baseline prices are untouched — this is a ±25% delta.
 */
export function applyMarketPressure(
  base: MarketEntry[],
  multiplier: (commodity: number) => number,
): MarketEntry[] {
  return base.map((m, i) => {
    const mult = multiplier(i);
    return {
      ...m,
      price: +(m.price * mult).toFixed(1),
      // scarcity shows in stock as well as price
      quantity: Math.max(0, Math.round(m.quantity * (2 - mult))),
    };
  });
}

/** How many pirates a system throws at an anonymous ship (no mark supplied). */
export function pirateCount(sys: StarSystem, danger: number, rng: () => number = Math.random): number {
  return Math.max(0, Math.round((7 - sys.government) / 2 + danger * 3 + rng() * 2 - 1));
}

// --- who's worth robbing ----------------------------------------------------
//
// Pirates are businesses. They weigh what you're visibly carrying against what
// you'd visibly cost them, and a poor Cobra full of food is not worth three
// Fer-de-Lances. Two rules keep this from becoming rubber-banding:
//
//   1. Only things a pirate can SEE count. Cargo (they scan, as police do),
//      hold size, fitted laser, reputation. Never your bank balance — a
//      commander who banks the money and flies clean has genuinely made
//      themselves a poor target, and that should be a real strategy.
//   2. Threat grows SUB-LINEARLY with the prize. Across a career the player's
//      combat power grows maybe tenfold; this should grow two- or threefold,
//      so upgrades are felt rather than cancelled out.

/** Slaves, Narcotics, Firearms — worth more to a pirate, and mark you as a smuggler. */
const CONTRABAND = new Set([3, 6, 10]);
/**
 * Cargo value (tenths of a credit) at which the prize term saturates — 1,600 Cr.
 * Tuned against the campaign sim: this makes gangs ~5% of receptions (2 per
 * career for a wealthy commander) while holding deaths per career at the 1.4
 * baseline. Lower it and gangs get commoner but the wealth curve collapses
 * (1,200 Cr → 9% gangs but median net worth 2,242 Cr against 3,661).
 */
const PRIZE_SATURATION = 25000;

/** Everything a pirate can observe about you. */
export interface Mark {
  /** what a cargo scanner reads, in tenths of a credit */
  cargoValue: number;
  /** tonnes of contraband aboard */
  contraband: number;
  /** hold capacity — a big bay looks like a fat prize even when empty */
  capacity: number;
  /** kills: your reputation arrives before you do */
  kills: number;
  laser: 'pulse' | 'beam' | 'military';
  /** 0..1 regional heat from your recent big or dirty sales nearby */
  notoriety: number;
}

/** Read a commander the way a pirate's scanner would. */
export function markOf(
  c: { cargo: number[]; kills: number; equipment: { laser: string; largeBay: boolean } },
  notoriety = 0,
): Mark {
  let cargoValue = 0;
  let contraband = 0;
  for (let i = 0; i < c.cargo.length && i < COMMODITIES.length; i++) {
    const q = c.cargo[i];
    if (!q) continue;
    // basePrice is the 1984 byte encoding; ×0.4 gives credits, ×4 gives tenths
    cargoValue += q * COMMODITIES[i].basePrice * 4;
    if (CONTRABAND.has(i)) contraband += q;
  }
  return {
    cargoValue,
    contraband,
    capacity: c.equipment.largeBay ? 35 : 20,
    kills: c.kills,
    laser: (c.equipment.laser as Mark['laser']) ?? 'pulse',
    notoriety,
  };
}

/**
 * Which tier of hull the Nth member of a group flies.
 *
 * A gang is not five Fer-de-Lances. It's one or two ringleaders who decided
 * you were worth organising for, plus hangers-on in whatever they could
 * afford — which is both more believable and what lets gangs be *common*
 * rather than an overwhelming rarity.
 *
 * Lives here rather than in npc.ts so the campaign simulator resolves each
 * attacker at the same strength the game spawns it at; npc.ts owns the hulls,
 * this owns the rule.
 */
export function memberTier(groupTier: number, memberIndex: number): number {
  const leaders = groupTier >= 2 ? 2 : 1;
  return memberIndex < leaders ? groupTier : Math.max(0, groupTier - 1);
}

export interface PirateThreat {
  count: number;
  /** 0 opportunists (Sidewinders, Kraits) · 1 professionals · 2 an organised gang */
  tier: 0 | 1 | 2;
  /** flies the coordinated pack policy and presses the attack */
  organised: boolean;
  /** 0..1 how attractive you looked — exposed for tuning and tests */
  appeal: number;
}

/**
 * What's waiting for you on the way in. `place` is the old rule (lawlessness
 * plus whatever the living galaxy has seen happen here lately); the mark
 * decides the *quality* of the reception more than the quantity.
 */
export function pirateThreat(
  sys: StarSystem,
  danger: number,
  mark: Mark,
  rng: () => number = Math.random,
): PirateThreat {
  const place = (7 - sys.government) / 2 + danger * 3;

  // Saturating: the gap between 200 and 2,000 credits of cargo matters; the
  // gap between 20,000 and 40,000 does not.
  const prize = Math.min(1, mark.cargoValue / PRIZE_SATURATION)
    + Math.min(0.25, mark.contraband * 0.05)
    + (mark.capacity > 20 ? 0.1 : 0);

  // What you look like you'd cost them.
  const deter = Math.min(0.5, mark.kills / 150)
    + (mark.laser === 'military' ? 0.3 : mark.laser === 'beam' ? 0.12 : 0);

  // Deterrence is weighted heavily: looking dangerous is the main lever the
  // player has against this system, and it should visibly work.
  const appeal = Math.max(0, Math.min(1, prize - 0.7 * deter + 0.6 * mark.notoriety));

  // Sub-linear: a fat commander draws about one extra attacker, not five.
  const count = Math.max(0, Math.round(place + appeal * 1.5 + rng() * 2 - 1));
  // Thresholds, not the prize curve, set how often each tier appears — keeping
  // saturation high preserves the gap between a good load and a fat one.
  const tier: 0 | 1 | 2 = appeal < 0.28 ? 0 : appeal < 0.5 ? 1 : 2;
  // A gang needs both a reason and the numbers to bother forming.
  const organised = tier === 2 && count >= 3 && rng() < 0.4 + 0.5 * appeal;
  return { count, tier, organised, appeal };
}
