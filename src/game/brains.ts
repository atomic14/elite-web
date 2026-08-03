// The trained brains, loaded — and the flight numbers that come with each.
//
// Three neuroevolution policies are in the bundle (docs/TRAINING-LOG.md), and
// the game flies all three. It was nine until TODO 57: six were experiments kept
// as evidence, and the evidence is in docs/TRAINING-LOG.md and train/logs/ where
// it does not have to be downloaded by everyone who opens the game. Loading them,
// the A/B flags that swap them, and the rule for who gets which were spread
// across three parts of npc.ts a hundred lines apart — the consts at the top, the
// flag helpers in the middle, and the actual choice buried inside a 60-line
// branch of update().
//
// The RULE — which name flies for whom, given a `BrainSelection` — is one file
// over in brain-names.ts, because the combat trainer needs to answer it too and
// must not import a megabyte of weights to do it. What is here is the weights,
// the name-to-policy lookup, and the two numbers (`guard`, `targetSpeed`) that
// are facts about a policy rather than about a name.
//
// Loading is defensive on purpose: a brain whose shape does not match the
// policy code returns null and the ship falls back to the shipped policy or to
// the scripted AI, rather than taking the game down.

import {
  observe, observePack, act, makeScratch, brainFromFile,
  type Brain, type BrainFile,
} from '../ai-training/policy.ts';
import {
  defenceBrainNameFor, isPackBrain, pirateBrainNameFor,
  SHIPPED_BRAINS, type BrainName, type BrainSelection,
} from './brain-names.ts';
// The break-off distance has ONE home, and it is neither this file nor npc.ts —
// it was a constant here and a literal there, and only one of them ever got
// fixed. See break-off.ts.
import { BRAIN_HANDOVER_RANGE } from './break-off.ts';
import pirateBrainFile from '../ai-training/brains/pirate-attack-g3.json' with { type: 'json' };
import packBrainFile from '../ai-training/brains/pirate-pack-r4-selectonly.json' with { type: 'json' };
import defendBrainFile from '../ai-training/brains/jameson-defend-g1.json' with { type: 'json' };

// The neuroevolution-trained pirate brain (see docs/TRAINING-LOG.md).
//
// Generation 3, and the first one aimed at how the game FEELS rather than at
// how lethal it is.
//
// Generation 1 and 2 won every measurement and lost the only one that counts:
// Chris played them and asked for the old brain back. The cause is structural
// and it was his own observation — stopping lets you pivot and hold a firing
// line, because you stop translating past the target. It is true, the sim
// models it faithfully, so evolution finds it, and a well-optimised pirate is
// a turret that hangs in space and snipes.
//
// So g3 is trained where that move does not exist: pirate hulls carry a
// a speed floor (MIN_CRUISE_FRACTION) and cannot throttle below 43% of top speed,
// and the fitness pays for time spent ON THE TARGET'S SIX rather than for
// damage by any route. Measured against a target that stops to fight:
//
//   brain  speed  lined up  on your six  range  shots/engagement
//   r2      235      38%         2%       822        0.6
//   g2      133      96%         1%      1135        7.3   <- the turret
//   g3      220      27%        10%       543        4.5
//
// It flies at r2's speed, closes 280 units nearer, works onto your six five
// times as often and shoots seven times as much, while a gang of three still
// only kills a shielded commander 1% of the time. r2's 0.6 shots is also the
// answer to "they point right at me and never fire": it is aligned 38% of the
// time but was trained when firing needed a 0.027 rad cone, so it learned
// never to trust a loose line.
//
// Pirates fly with it at a 10 Hz decision rate; `state.brains.scripted = true`
// compares it against the old scripted AI (see BrainSelection).
const PIRATE_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(pirateBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

export const DEFEND_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(defendBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

/**
 * The pack-trained brain: 18 inputs (solo 14 + the nearest packmate's bearing
 * and distance). This is round 4's `pirate-pack-r4-selectonly`, the first pack
 * policy to take 100% of held-out episodes against all three test traders
 * (docs/TRAINING-LOG.md, run 7).
 *
 * It is **still not the default**, but no longer because it's worse — it beats
 * the shipped solo trio outright, including 100% vs 41% against a trader that
 * shoots back. It kills a player-like target in 1.5-2.9s where the shipped
 * trio takes 10.8-11.7s, and whether Elite's pirates should be 4-7x more
 * lethal is a game-design decision, not a tournament one.
 *
 * Set `state.brains.pack = true` to fly it and judge for yourself.
 */
const PACK_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(packBrainFile as unknown as BrainFile);
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
const LOADED: Record<BrainName, Brain | null> = {
  'pirate-attack-g3': PIRATE_BRAIN,
  'pirate-pack-r4-selectonly': PACK_BRAIN,
  'jameson-defend-g1': DEFEND_BRAIN,
  // the pre-neuroevolution AI is code, not weights
  scripted: null,
};

/** The weights behind a name, or null if the game cannot fly it. */
export function brainByName(name: BrainName): Brain | null {
  return LOADED[name];
}

/**
 * Floor under the target speed handed to the brains. See the call site in
 * update() — below roughly 150 the attack policies stop throttling forward,
 * and a commander who slows to fight gets pirates that hang in space.
 */
const TARGET_SPEED_FLOOR = 150;

/**
 * Pure value behind the optional console handle used by training harnesses.
 * The platform decides whether and where to publish it.
 */
export function policyKit(): Record<string, unknown> {
  return {
    act, observe, observePack, makeScratch,
    pirateBrain: PIRATE_BRAIN, packBrain: PACK_BRAIN, defendBrain: DEFEND_BRAIN,
  };
}


/** Which brain a pirate flies, and the two numbers that go with it. */
export interface BrainChoice {
  brain: Brain;
  /** the pack policy sees its fleet; the solo ones do not */
  pack: boolean;
  /**
   * Inside this range it stops flying the brain and hands over to the scripted
   * break-off — the FLYING only. `attack()` keeps the gun (break-off.ts).
   */
  guard: number;
  /**
   * What the brain is told the target's speed is.
   *
   * This was hardcoded to 300 for years because observe() feeds
   * `target.speed/400` to the network and the brains had only seen a freighter
   * near 220. Generation 1 was trained across 90, 220 and 400 speed hulls plus
   * two runners, so passing the real speed looked safe. It was not: Chris
   * flies at a median of 66 and stops dead to turn, and pirates went inert —
   * "they now sit still spinning", then "they just sit there". Measured in the
   * sim, the attacker throttles forward on 19% of frames against a stationary
   * target and 84% against one at 220.
   *
   * Adding a stationary knife-fighter to the training pool (g2) moved that
   * from 19% to 43%, which is better and still not flying. The input is the
   * problem, not the fit: a bare speed scalar carries no direction, tells a
   * pirate almost nothing it cannot see from the geometry, and the policy has
   * latched onto it anyway.
   *
   * So: real speed where the brain is competent, floored where it is not. The
   * floor is a lie, but a bounded one that preserves the variation that
   * actually matters — a target running at 400 still reads differently from
   * one turning at 200. Deleting the input entirely is the honest fix and
   * costs a retrain of every brain.
   */
  targetSpeed: (actual: number) => number;
}

/**
 * The brain for a pirate of this tier, or null to fly the scripted AI.
 *
 * CLAUDE.md's Training split — opportunists and professionals fly the solo
 * brain, an organised gang flies the pack policy — is stated in brain-names.ts,
 * because the trainer's report has to read it too. This asks that rule for a
 * name and turns the name into weights. Everything `sel` does on top is an A/B
 * override for playtesting; see `BrainSelection`.
 */
export function pirateBrainFor(
  tier: number, organised: boolean, sel: BrainSelection = SHIPPED_BRAINS,
): BrainChoice | null {
  if (!PIRATE_BRAIN || sel.scripted) return null;

  // The name first, so the ship and the combat trainer's report are reading one
  // rule (brain-names.ts). A name whose file did not parse falls back to the
  // shipped solo policy — and takes `pack` with it, because feeding 18 pack
  // observations to a 14-input solo net is worse than flying the wrong brain.
  const name = pirateBrainNameFor(tier, organised, sel);
  const loaded = LOADED[name];

  return {
    brain: loaded ?? PIRATE_BRAIN,
    pack: !!loaded && isPackBrain(name),
    // Every shipped policy keeps flying its own line to knife range and hands
    // over at BRAIN_HANDOVER_RANGE. The one that did NOT was `pirate-attack-r2`,
    // which kamikazes and needed the full BREAK_OFF_RANGE plus a constant target
    // speed of 300; it went with the rest of the unshipped weights in TODO 57,
    // and the branch went with it rather than sitting here unreachable. Neither
    // handover has ever given up the GUN — see break-off.ts.
    guard: BRAIN_HANDOVER_RANGE,
    targetSpeed: (a) => Math.max(TARGET_SPEED_FLOOR, a),
  };
}

/** An armed trader or a player-assist ship flies the defence policy. */
export function defenceBrain(sel: BrainSelection = SHIPPED_BRAINS): Brain | null {
  const name = defenceBrainNameFor(sel);
  return name === 'scripted' ? null : (LOADED[name] ?? DEFEND_BRAIN);
}
