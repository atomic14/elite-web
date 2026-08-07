// Your character, as a rule: the name a disrepute score earns, and how a deed or
// a quiet week moves it.
//
// The one home for the character reputation, the way `rating.ts` owns the combat
// ladder and `law.ts` owns your legal standing. The numbers are `constants/
// character.ts`; this is the arithmetic that reads and moves them. It touches no
// world state — a caller applies the result to the commander — so the trainer's
// clone and a headless campaign can ask the same questions the game does.

import {
  CHARACTER, DISREPUTE_DECAY, DISREPUTE_MAX,
} from '../constants/character.ts';

/**
 * What a disrepute score is CALLED — the highest rung of the ladder it clears.
 * Honest at 0, and the default for anything below the first threshold.
 */
export function characterName(disrepute: number): string {
  let name = CHARACTER[0][1];
  for (const [threshold, rung] of CHARACTER) {
    if (disrepute >= threshold) name = rung;
  }
  return name;
}

/**
 * A disrepute score after a deed of `delta` — never below Honest, never past
 * the ceiling, so neither a good week nor a bad career can run the bar away.
 */
export function afterDeed(disrepute: number, delta: number): number {
  return Math.max(0, Math.min(DISREPUTE_MAX, disrepute + delta));
}

/**
 * A disrepute score after `days` of the galaxy forgetting. Never below Honest;
 * a non-positive or non-finite span (a paused tab, a rewound clock) does
 * nothing.
 */
export function afterDecay(disrepute: number, days: number): number {
  if (!(days > 0)) return disrepute;
  return Math.max(0, disrepute - DISREPUTE_DECAY * days);
}
