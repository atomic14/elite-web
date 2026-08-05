// The trained brain, loaded — ONE policy, the defence.
//
// It was three until 2026-08-05 (and nine until TODO 57): the two trained
// pirate policies came out of the bundle when Chris made scripted the only
// opposition anywhere — the sky and the trainer's rows alike — so the game
// loads exactly the policy that flies on the player's side: the armed
// trader's pilot, which is also the combat computer. docs/TRAINING-LOG.md
// keeps every figure the deleted weights ever measured.
//
// The RULE — which name flies for whom, given a `BrainSelection` — is one file
// over in brain-names.ts, because the combat trainer needs to answer it too and
// must not import a megabyte of weights to do it. What is here is the weights,
// the name-to-policy lookup, and the number (`guard`) that
// are facts about a policy rather than about a name.
//
// Loading is defensive on purpose: a brain whose shape does not match the
// policy code returns null and the ship falls back to the shipped policy or to
// the scripted AI, rather than taking the game down.

import {
  act, makeScratch, brainFromFile, type Brain, type BrainFile,
} from '../ai-training/policy.ts';
import {
  observe, observePack, observeDefend, observeFor,
} from '../ai-training/observation.ts';
import { energyLeft, poolsLeft } from './systems.ts';
import {
  defenceBrainNameFor,
  SHIPPED_BRAINS, type BrainName, type BrainSelection,
} from './brain-names.ts';
import defendBrainFile from '../ai-training/brains/jameson-defend-g2.json' with { type: 'json' };
import defendCandidateFile from '../ai-training/brains/jameson-defend-t91.json' with { type: 'json' };

export const DEFEND_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(defendBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

/**
 * Every policy, by name — the lookup that makes the trainer's report honest.
 *
 * brain-names.ts decides WHICH name flies and cannot know whether the file
 * behind it parsed; this is the other half. `npm test` asserts that every name
 * the rule can return has a non-null entry here, and that the weights directory
 * holds exactly the files imported above — so "the report says the gang policy"
 * and "the ship flies the gang policy" cannot come apart, and a policy nothing
 * ships cannot quietly reappear in the bundle.
 */
/** The TODO 91 candidate, in the bundle for stage 3's flying and nothing else. */
const DEFEND_CANDIDATE: Brain | null = (() => {
  try {
    return brainFromFile(defendCandidateFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

const LOADED: Record<BrainName, Brain | null> = {
  'jameson-defend-g2': DEFEND_BRAIN,
  'jameson-defend-t91': DEFEND_CANDIDATE,
  // the two code pilots — the attack run and the pre-neuroevolution AI —
  // are code, not weights
  'attack-run': null,
  scripted: null,
};

/** The weights behind a name, or null if the game cannot fly it. */
export function brainByName(name: BrainName): Brain | null {
  return LOADED[name];
}

/**
 * Pure value behind the optional console handle used by training harnesses.
 * The platform decides whether and where to publish it.
 */
export function policyKit(): Record<string, unknown> {
  return {
    act, observe, observePack, makeScratch,
    // `observeFor` is what a harness should actually call: it picks the encoder
    // off the brain's own input count, so a console script cannot be left
    // feeding fourteen numbers to a policy that reads seventeen — which is
    // silent, and reads as "the defender has no ship left" (docs/TODO/71).
    // `poolsLeft` and `energyLeft` are here for the same reason: those two
    // slots must be filled from `systems.ts`'s expressions, not a harness's
    // arithmetic.
    observeDefend, observeFor, poolsLeft, energyLeft,
    defendBrain: DEFEND_BRAIN,
  };
}


// There is no `pirateBrainFor` and no `BrainChoice` any more: the pirates a
// player meets fly the scripted attack run, and since 2026-08-05 there are no
// trained pirate weights in the bundle for an override to select
// (brain-names.ts has the decision). What is left here is the one policy the
// game loads — the defence brain, for armed traders and the combat computer.

/**
 * An armed trader or a player-assist ship flies the defence policy — or
 * nothing loadable, when the selection names a CODE pilot: `scripted` (no
 * defence at all) and `attack-run` (the scripted run; npc.ts and the Game
 * fly it directly) both return null here, because null means "no weights",
 * and which code path replaces them is the caller's question, asked of
 * `defenceBrainNameFor`.
 */
export function defenceBrain(sel: BrainSelection = SHIPPED_BRAINS): Brain | null {
  const name = defenceBrainNameFor(sel);
  // the code pilots BY NAME, not by their null entry — a weights file that
  // failed to parse is also null in LOADED, and that one still falls back to
  // the shipped brain rather than grounding the trader
  if (name === 'scripted' || name === 'attack-run') return null;
  return LOADED[name] ?? DEFEND_BRAIN;
}
