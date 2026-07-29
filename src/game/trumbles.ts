// Trumbles: they breed, they eat the hold, and heat drives them out.
//
// Elite's joke about buying something adorable at a station. They double every
// twenty seconds and eat a share of whatever you are carrying, and the only
// cure is a sun-skim — the same manoeuvre that refuels you, which is the neat
// bit: the fix costs you the trip you were on.
//
// Pure over the commander plus the cabin temperature. It returns what
// happened; the Game says it out loud.

import type { CommanderData } from './commander.ts';
import { COMMODITIES } from '../galaxy/galaxy.ts';
import { random } from './rng.ts';

/**
 * Cabin heat that drives them out.
 *
 * Lived in commander.ts, which is about what persists between sessions — a
 * temperature threshold read once a frame by this file is neither persistent
 * nor the commander's. It is the only number in the rule that is not here.
 */
export const TRUMBLE_PURGE_TEMP = 0.55;

/** Seconds between broods. */
export const BREED_INTERVAL = 20;
/** They multiply by this, plus one, every brood. */
export const BREED_RATE = 1.6;
/** No more than this many, or the hold report becomes a novel. */
export const MAX_TRUMBLES = 999;
/** One tonne eaten per this many trumbles, per brood. */
export const APPETITE_DIVISOR = 8;
/** Below this many, they are not worth mentioning. */
const NOTICEABLE = 4;

export type TrumbleEvent =
  | { kind: 'purged' }
  | { kind: 'fleeing'; left: number }
  | { kind: 'ate'; commodity: number; tonnes: number; total: number }
  | { kind: 'breeding'; total: number };

/**
 * One frame of infestation.
 *
 * @param timer countdown to the next brood, owned by the caller so it
 * survives across frames — and so it is in the save.
 * @returns the new timer, and anything worth announcing.
 */
export function stepTrumbles(
  commander: CommanderData,
  dt: number,
  cabinTemp: number,
  timer: number,
  rng: () => number = random,
): { timer: number; events: TrumbleEvent[] } {
  const events: TrumbleEvent[] = [];
  if (commander.trumbles <= 0) return { timer, events };

  // heat drives them out — a sun-skim is the cure
  if (cabinTemp > TRUMBLE_PURGE_TEMP) {
    const before = commander.trumbles;
    commander.trumbles = Math.max(0, commander.trumbles - Math.ceil(commander.trumbles * dt));
    if (commander.trumbles === 0) events.push({ kind: 'purged' });
    else if (before !== commander.trumbles) {
      events.push({ kind: 'fleeing', left: commander.trumbles });
    }
    return { timer: 0, events };
  }

  const next = timer - dt;
  if (next > 0) return { timer: next, events };

  commander.trumbles = Math.min(MAX_TRUMBLES, Math.round(commander.trumbles * BREED_RATE) + 1);

  // they are always hungry
  const carried = commander.cargo
    .map((qty, i) => ({ qty, i }))
    .filter((x) => x.qty > 0);
  const appetite = Math.floor(commander.trumbles / APPETITE_DIVISOR);
  if (appetite > 0 && carried.length) {
    const pick = carried[Math.floor(rng() * carried.length)];
    const eaten = Math.min(pick.qty, appetite);
    commander.cargo[pick.i] -= eaten;
    events.push({
      kind: 'ate', commodity: pick.i, tonnes: eaten, total: commander.trumbles,
    });
  } else if (commander.trumbles > NOTICEABLE) {
    events.push({ kind: 'breeding', total: commander.trumbles });
  }
  return { timer: BREED_INTERVAL, events };
}

/** The line for a trumble event, so the wording lives with the rule. */
export function trumbleMessage(e: TrumbleEvent): string {
  switch (e.kind) {
    case 'purged': return 'THE LAST TRUMBLE FLEES THE HEAT. PEACE AT LAST.';
    case 'fleeing': return `TRUMBLES FLEEING THE HEAT — ${e.left} LEFT`;
    case 'ate': return `TRUMBLES (${e.total}) ATE ${e.tonnes}${COMMODITIES[e.commodity].unit} `
      + `${COMMODITIES[e.commodity].name.toUpperCase()}`;
    case 'breeding': return `TRUMBLES ABOARD: ${e.total}`;
  }
}
