// Station bulletin-board contracts, and the living-galaxy price nudge.
//
// Pure functions, deliberately free of three.js and DOM so that both the
// game (src/game/game.ts) and the headless campaign simulator
// (test/campaign.ts) run the *same* rules — a balance test that mirrored
// the logic instead of calling it would be worthless.
//
// Erasable-TypeScript only: Node runs this directly via
// --experimental-strip-types.

import type { StarSystem, MarketEntry } from '../galaxy/galaxy';
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

/** How many pirates a system throws at an arriving ship. */
export function pirateCount(sys: StarSystem, danger: number, rng: () => number = Math.random): number {
  return Math.max(0, Math.round((7 - sys.government) / 2 + danger * 3 + rng() * 2 - 1));
}
