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
import {
  COMMODITIES, generateMarket, type StarSystem, type MarketEntry,
} from '../galaxy/galaxy.ts';
import { random, randomInt } from './rng.ts';
import { distanceTenths } from '../galaxy/navigation.ts';
import {
  cargoCapacity, cargoTonnes, formatCredits,
  type CommanderData, type Contract,
} from './commander.ts';

/** Chart distance in tenths of a light-year (the original's metric). */
// Was a second copy of the chart metric. It now comes from the one owner, and
// keeps the old name so the campaign harness's imports still read naturally.
export { distanceTenths as chartDistanceTenths };
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
  rng: () => number = random,
): Contract[] {
  const reachable = systems.filter((s) => {
    const d = distanceTenths(sys, s);
    return s.index !== sys.index && d > 0 && d <= 68;
  });
  if (!reachable.length) return [];

  const offers: Contract[] = [];
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const dest = reachable[Math.floor(rng() * reachable.length)];
    const dist = distanceTenths(sys, dest);
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

/**
 * Prices for the system you are standing in.
 *
 * The 1984 baseline, then the living galaxy's ±25% delta on top: a world that
 * has been buying computers all week pays less for the next batch, and one
 * that has been shipping them out is dearer. Baseline prices are untouched.
 *
 * It lived in screens/trade.ts, which made the rule that decides what a station
 * charges a detail of the screen that draws it — and left station.ts having to
 * import a SCREEN to open a market. Invariant 7 says market rules live here.
 */
export function makeLocalMarket(
  system: StarSystem,
  priceMultiplier: (commodity: number) => number,
): MarketEntry[] {
  return applyMarketPressure(
    // seeded: an unseeded market seed means a reload rerolls prices, which is
    // exactly the save-scum this game now has to be robust to
    generateMarket(system, randomInt(256)),
    priceMultiplier);
}


// --- taking work, and being paid for it -------------------------------------
//
// These were `acceptContract` and `settleContracts`, two methods of game.ts —
// which is exactly what CLAUDE.md's invariant 7 forbids, and it had already
// cost something: test/campaign.ts carried its own transcription of the
// settlement, so the balance harness was scoring rules that only resembled the
// shipped ones. It calls these now.
//
// Same shape as missions.ts, which is the in-repo precedent: pure, mutates the
// commander, and RETURNS what happened. The Game announces and beeps, because
// a HUD and an AudioContext are not something a headless career simulator has.

/** What settling or accepting work did. */
export type ContractEvent =
  | { kind: 'paid'; contract: Contract }
  /** delivered here, on time — but the goods are no longer aboard */
  | { kind: 'incomplete'; contract: Contract }
  | { kind: 'expired'; contract: Contract }
  | { kind: 'accepted'; contract: Contract }
  | { kind: 'refused'; reason: 'tooMuchWork' | 'noHoldSpace' };

/** One line describing a job, for the board and the station menu. */
export function describeContract(k: Contract, systems: StarSystem[]): string {
  const dest = systems[k.destination].name.toUpperCase();
  if (k.kind === 'cargo') return `Deliver ${k.qty}t ${COMMODITIES[k.commodity].name} to ${dest}`;
  if (k.kind === 'courier') return `Carry sealed data to ${dest}`;
  return `Destroy ${k.qty} pirates around ${dest}`;
}

/**
 * Pay out anything delivered here, and drop anything overdue.
 *
 * Mutates the commander's cargo, credits and contract list; the surviving work
 * stays on it. A bounty job standing at its destination with the count unfilled
 * is NOT settled and NOT dropped — you can come back to it until the deadline,
 * which is the one branch a re-implementation is most likely to get wrong.
 */
export function settleContracts(c: CommanderData): ContractEvent[] {
  const events: ContractEvent[] = [];
  const kept: Contract[] = [];
  for (const k of c.contracts) {
    const here = k.destination === c.systemIndex;
    const late = c.day > k.deadlineDay;
    if (here && !late && (k.kind !== 'bounty' || k.progress >= k.qty)) {
      if (k.kind === 'cargo') {
        // the consignment must still be aboard
        if (c.cargo[k.commodity] < k.qty) {
          events.push({ kind: 'incomplete', contract: k });
          continue;
        }
        c.cargo[k.commodity] -= k.qty;
      }
      c.credits += k.reward;
      events.push({ kind: 'paid', contract: k });
      continue;
    }
    if (late) {
      events.push({ kind: 'expired', contract: k });
      continue;
    }
    kept.push(k);
  }
  c.contracts = kept;
  return events;
}

/**
 * Take the offer at `index` off the board.
 *
 * Mutates the commander (a cargo run loads the consignment on the spot) and
 * splices the accepted job out of `offers`. A refusal changes nothing at all,
 * which is what lets the caller treat it as a beep.
 */
export function acceptContract(
  c: CommanderData, offers: Contract[], index: number,
): ContractEvent[] {
  const k = offers[index];
  if (!k) return [];
  if (c.contracts.length >= MAX_CONTRACTS) {
    return [{ kind: 'refused', reason: 'tooMuchWork' }];
  }
  if (k.kind === 'cargo') {
    if (cargoTonnes(c) + k.qty > cargoCapacity(c)) {
      return [{ kind: 'refused', reason: 'noHoldSpace' }];
    }
    c.cargo[k.commodity] += k.qty;
  }
  c.contracts.push(k);
  offers.splice(index, 1);
  return [{ kind: 'accepted', contract: k }];
}

/**
 * What to put on the HUD, and what to beep, for one contract event.
 *
 * Phrasing lives beside the rule and away from the AudioContext, the same way
 * `trumbleMessage` and `ordnanceMessage` do. `beep.seconds` left off means the
 * sound's own default length.
 */
export interface ContractMessage {
  text: string;
  seconds: number;
  beep: { hz: number; seconds?: number } | null;
}

export function contractMessage(e: ContractEvent, systems: StarSystem[]): ContractMessage {
  switch (e.kind) {
    case 'paid':
      return {
        text: `CONTRACT PAID: ${formatCredits(e.contract.reward)}`,
        seconds: 5,
        beep: { hz: 1100, seconds: 0.15 },
      };
    case 'incomplete':
      return { text: 'CONSIGNMENT INCOMPLETE — CONTRACT VOID', seconds: 5, beep: null };
    case 'expired':
      return { text: 'CONTRACT EXPIRED', seconds: 4, beep: { hz: 220, seconds: 0.2 } };
    case 'accepted':
      return {
        text: `ACCEPTED: ${describeContract(e.contract, systems).toUpperCase()}`,
        seconds: 4,
        beep: { hz: 900, seconds: 0.1 },
      };
    case 'refused':
      return {
        text: e.reason === 'tooMuchWork'
          ? 'YOU ARE CARRYING ENOUGH WORK ALREADY'
          : 'NOT ENOUGH HOLD SPACE FOR THAT CONSIGNMENT',
        seconds: 3,
        beep: { hz: 220 },
      };
  }
}

export const MAX_CONTRACTS = 3;
