// The character ladder: the name a disrepute score earns, and how a deed or a
// quiet week moves it.
//
// The rung thresholds are bisected out of the real `characterName` rather than
// restated, the same way economy.test.ts pins the fine and the combat ladder —
// a re-tuned threshold moves the test with the function, not against it. The
// deed hooks themselves (a hermit cracked, a trader murdered) are flown in
// combat.test.ts; this holds the arithmetic they spend.

import { check, eq } from './harness.ts';
import { characterName, afterDeed, afterDecay } from '../src/game/character.ts';
import {
  CHARACTER, DISREPUTE_DECAY, DISREPUTE_MAX, DISREPUTE_HERMIT_KILL,
} from '../src/constants/character.ts';

console.log('\ncharacter');
{
  eq('Honest is the top of the ladder — the best a name can be', CHARACTER[0][1], 'Honest');
  eq('an unmarked pilot is Honest', characterName(0), 'Honest');

  // every rung, off the real function, and the point just below it is a lower rung
  for (const [threshold, name] of CHARACTER) {
    eq(`${threshold} disrepute reads as ${name}`, characterName(threshold), name);
    if (threshold > 0) {
      check(`...and a point below it does not (${name})`, characterName(threshold - 1) !== name);
    }
  }
  eq('the worst rung holds at the ceiling',
    characterName(DISREPUTE_MAX), CHARACTER[CHARACTER.length - 1][1]);

  // a deed raises it, clamped both ends
  eq('a deed adds its weight', afterDeed(0, DISREPUTE_HERMIT_KILL), DISREPUTE_HERMIT_KILL);
  eq('...never below Honest', afterDeed(5, -100), 0);
  eq('...never past the ceiling', afterDeed(DISREPUTE_MAX, 100), DISREPUTE_MAX);
  eq('one hermit kill takes an Honest pilot to Dodgy',
    characterName(afterDeed(0, DISREPUTE_HERMIT_KILL)), 'Dodgy');

  // time erodes it — people forget, slowly
  eq('a day of honest flying fades it by the decay rate', afterDecay(50, 1), 50 - DISREPUTE_DECAY);
  eq('...never below Honest', afterDecay(1, 100), 0);
  eq('...a paused or rewound clock does nothing', afterDecay(50, 0), 50);
  eq('...and neither does a NaN span', afterDecay(50, NaN), 50);
  check('a hermit kill is a fortnight-plus of honest flying to fully shed — slow, as memories are',
    DISREPUTE_HERMIT_KILL / DISREPUTE_DECAY > 14);
}
