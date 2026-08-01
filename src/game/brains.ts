// The trained brains, and which ship flies which one.
//
// Five neuroevolution policies ship (docs/TRAINING-LOG.md). Loading them,
// the A/B flags that swap them, and the rule for who gets which were spread
// across three parts of npc.ts a hundred lines apart — the consts at the top,
// the flag helpers in the middle, and the actual choice buried inside a
// 60-line branch of update(). Invariant 8 in CLAUDE.md documents which brain
// ships for whom; this is now the file where that is true.
//
// Loading is defensive on purpose: a brain whose shape does not match the
// policy code returns null and the ship falls back to the scripted AI, rather
// than taking the game down.

import {
  observe, observePack, act, makeScratch, brainFromFile,
  type Brain, type BrainFile,
} from '../ai-training/policy.ts';
import pirateBrainFile from '../ai-training/brains/pirate-attack-g3.json' with { type: 'json' };
import packBrainFile from '../ai-training/brains/pirate-pack-r4-selectonly.json' with { type: 'json' };
import sharpBrainFile from '../ai-training/brains/pirate-attack-g2.json' with { type: 'json' };
import legacyBrainFile from '../ai-training/brains/pirate-attack-r2.json' with { type: 'json' };
import engineBrainFile from '../ai-training/brains/pirate-attack-e1.json' with { type: 'json' };
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

/**
 * Generation 2: trained against the gun a pirate actually carries, and against
 * a target that stops to knife-fight. Kept on a flag rather than shipped.
 *
 *   state.brains.sharp = true     every pirate flies it
 *   state.brains.sharp = 'pro'    only professionals and gangs (tier >= 1)
 *
 * It wins on every measurement and lost the only one that counts. Flown, it
 * hangs in space and pivots to shoot rather than making attack runs — the
 * behaviour is *correct*, which is the problem, because stopping really is
 * the optimal way to hold a firing line. Two pirates kill a fully shielded
 * commander 89-98% of the time.
 *
 * 'pro' is the configuration worth playtesting: opportunists stay fun, and
 * the ships that are supposed to frighten you are the ones that can.
 */
const SHARP_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(sharpBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

/**
 * The pre-generation brain, for an instant A/B in a live session.
 *
 *   state.brains.legacy = true    every pirate flies r2
 *
 * It gets the wide ram guard and the old constant target speed, so this is
 * the game exactly as it played before any of this work.
 */
const LEGACY_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(legacyBrainFile as unknown as BrainFile);
  } catch {
    return null;
  }
})();

/**
 * Which brains fly, when the answer is not "the shipped ones".
 *
 * A field of `GameState`, passed down to the choice below — NOT four ambient
 * `window.__` flags, which is what this was. Brain selection is read from
 * inside `NpcShip.update`, so by this project's own rule (AI state is game
 * state: anything the step READS is state) it belongs in the state. As globals
 * it cost three separate things:
 *
 *   - a save made with a flag set, restored in a fresh tab, flew DIFFERENT
 *     brains than the run it came from — the flag is not in the snapshot and
 *     `globalThis` does not survive a reload
 *   - a test had to remember to clear up, or leak its choice into every test
 *     after it; the discipline held, but only by hand
 *   - the combat trainer needed a save-the-old-value/put-it-back dance around
 *     every exercise, and got it right, which is not the same as it being safe
 *
 * In the state all three go away: it is snapshotted with everything else, a
 * test passes the selection it wants as an argument, and the trainer's
 * teardown is the ordinary restore it already does.
 *
 * From a console, go through the one documented handle:
 * `__game.state.brains.legacy = 'pro'`.
 */
export interface BrainSelection {
  /** fly NO brains — the pre-neuroevolution scripted AI, i.e. the A/B control */
  scripted?: boolean;
  /** pre-gun-fix `pirate-attack-r2`: `true` for all, `'pro'` for tier >= 1 */
  legacy?: boolean | 'pro';
  /** force the pack policy onto solo pirates as well as gangs */
  pack?: boolean;
  /** generation 2 `pirate-attack-g2`: `true` for all, `'pro'` for tier >= 1 */
  sharp?: boolean | 'pro';
  /** run 18's `pirate-attack-e1`, the first trained on the game engine */
  engine?: boolean | 'pro';
}

/**
 * No overrides: what the live game flies. Frozen, because it is a shared
 * default and a caller mutating it would move every other caller's brains.
 */
export const SHIPPED_BRAINS: BrainSelection = Object.freeze({});

/**
 * The `true | 'pro'` shape, read once: `'pro'` arms professionals and gangs and
 * leaves the opportunists on the shipped brain, which is how a mixed reception
 * gets tested without making every pirate a different animal.
 */
function appliesTo(flag: boolean | 'pro' | undefined, tier: number): boolean {
  if (!flag) return false;
  return flag === 'pro' ? tier >= 1 : true;
}

/**
 * Run 18's brain: the first one trained on the game engine itself, after the
 * separate combat simulator was deleted (docs/TRAINING-LOG.md, run 18).
 *
 *   state.brains.engine = true     every pirate flies it
 *   state.brains.engine = 'pro'    only professionals and gangs (tier >= 1)
 *
 * Loadable but NOT shipped, and the reason is the whole methodology here.
 * It took a 100% validation kill rate — which is exactly the profile of
 * generation 1 and generation 2, both of which won every measurement and lost
 * the only one that counted, because a well-optimised pirate is a turret that
 * hangs in space and snipes. Shipping this on its score would be making the
 * same mistake a third time with better numbers.
 *
 * So it is here to be FLOWN — `T` at any station, pick it as the opposition,
 * and compare it against g3 in the same scenario from the same seed. That
 * comparison is the thing the trainer exists for, and until this was wired the
 * trainer offered e1 in its picker and could not load it.
 */
const ENGINE_BRAIN: Brain | null = (() => {
  try {
    return brainFromFile(engineBrainFile as unknown as BrainFile);
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
 * Range at which trained pilots hand back to the scripted break-off.
 *
 * The simulator the pre-generation policies were trained in had NO collision
 * model, so flying straight through the target was free and the optimal
 * learned behaviour was to close to zero range and sit there shooting. In the
 * game, where ships are solid, that reads as deliberate ramming: the pirate
 * slides past you and kamikazes.
 *
 * Collisions were added to the simulator and then, with the simulator's
 * deletion, stopped being a model at all — episodes call collisions.ts. The
 * guard remains for brains fitted before either (docs/TRAINING-LOG.md).
 */
const RAM_GUARD = 220;

/**
 * Knife-range guard for a brain that does not ram.
 *
 * RAM_GUARD hands control to attack(), which steers away and returns no fire
 * event, so a pirate inside 220 units has its guns switched off. That was the
 * right trade when the brains kamikazed.
 *
 * It is the wrong trade against a human. Chris's recorded flying: median
 * engagement range 260 units, 10th percentile 214, median speed 66 with the
 * pitch held at 1.36 of a possible 1.45. He turns on the spot at knife range
 * while pirates come past at 290-310, so every pass crosses the dead zone and
 * three tier-1 ships managed ZERO shots in 33 seconds.
 *
 * The generation-1 brains do not need the guard: they destroy themselves in
 * 1-9% of engagements, against 36-73% for the brain they replace. So they get
 * the tight guard — it shrinks to the point where a collision is actually
 * imminent, and the ship keeps its guns until then.
 *
 * This matters more than it looks. Fixing the gun would have achieved nothing
 * if pirates still went silent inside 220 units, because 220 units is where
 * Chris fights.
 *
 * 150, and the number is arithmetic rather than taste. It was 90 for one
 * wave and both of Chris's arena fights had ships fly into him. A pirate
 * re-decides at 10 Hz, so a head-on closure — 300 for the pirate against the
 * player's 400 — covers 70 units between decisions, and the two hulls are 68
 * units of radius before they touch. A 90-unit guard leaves 22 units of
 * margin: less than one decision tick, so breaking off is not something the
 * ship is physically able to do. 150 gives it a tick to turn, and still
 * clears the range Chris actually fights at (median 260, 10th percentile
 * 214), which is the dead zone the wide guard created.
 *
 * The sim cannot catch this: it has no ram guard, so its 1-9% collision rate
 * says nothing about what the guard should be.
 */
const RAM_GUARD_NO_RAM = 150;

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
  /** it stops flying the brain and breaks off inside this range */
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
 * This is invariant 8's split, stated once: opportunists and professionals fly
 * the solo brain, an organised gang flies the pack policy. Everything `sel`
 * does on top of that is an A/B override for playtesting — see BrainSelection.
 */
export function pirateBrainFor(
  tier: number, organised: boolean, sel: BrainSelection = SHIPPED_BRAINS,
): BrainChoice | null {
  if (!PIRATE_BRAIN || sel.scripted) return null;

  const legacy = !!LEGACY_BRAIN && appliesTo(sel.legacy, tier);
  const pack = !!PACK_BRAIN && (organised || !!sel.pack);
  const sharp = !!SHARP_BRAIN && appliesTo(sel.sharp, tier);
  const engine = !!ENGINE_BRAIN && appliesTo(sel.engine, tier);
  const solo = legacy ? LEGACY_BRAIN!
    : engine ? ENGINE_BRAIN!
      : sharp ? SHARP_BRAIN! : PIRATE_BRAIN;

  return {
    brain: pack ? PACK_BRAIN! : solo,
    pack,
    // r2 kamikazes and needs the wide guard; the generation brains do not,
    // and keep their guns down to knife range.
    guard: legacy ? RAM_GUARD : RAM_GUARD_NO_RAM,
    targetSpeed: legacy ? () => 300 : (a) => Math.max(TARGET_SPEED_FLOOR, a),
  };
}

/** An armed trader or a player-assist ship flies the defence policy. */
export function defenceBrain(sel: BrainSelection = SHIPPED_BRAINS): Brain | null {
  return sel.scripted ? null : DEFEND_BRAIN;
}
