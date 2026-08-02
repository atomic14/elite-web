// Which named policy flies, and the flags that change that.
//
// One question asked in three places. `NpcShip.update` needs the WEIGHTS, the
// combat trainer's report needs the NAME, and both pickers need the LIST — and
// each used to answer it for itself: brains.ts held the rule, combat-sim-
// scenarios.ts held a hardcoded copy of the shipped ids, and combat-sim-safety.ts
// held the inverse table. So a career flying `state.brains.sharp = 'pro'` was
// reported by the trainer as flying g3, which is the exact failure CLAUDE.md
// names — one rule with two homes, kept in step by hope.
//
// The rule lives here now, in a file with no weights in it: names, flags, and
// the mapping between them. brains.ts turns a name into a loaded policy; this
// module imports nothing, which is what lets the trainer's pure rules module ask
// the same question without pulling 100 KB of JSON into its module graph.

/**
 * Every policy the game LOADS, by the stem of its weights file, plus the
 * pre-neuroevolution scripted AI.
 *
 * A name is not a promise that the file parsed — brains.ts loads defensively and
 * a mismatched file becomes null there. It is a promise that brains.ts imports
 * it, and `npm test` reads brains.ts to check that every name here does.
 */
export type BrainName =
  | 'pirate-attack-g3'
  | 'pirate-attack-g2'
  | 'pirate-attack-e1'
  | 'pirate-attack-r2'
  | 'pirate-attack-t29'
  | 'pirate-pack-r4-selectonly'
  | 'pirate-pack-t29'
  | 'jameson-defend-g1'
  | 'jameson-defend-t29'
  | 'scripted';

/**
 * Which brains fly, when the answer is not "the shipped ones".
 *
 * A field of `GameState`, passed down to the rule below — NOT five ambient
 * `window.__` flags, which is what this was. Brain selection is read from inside
 * `NpcShip.update`, so by this project's own rule (AI state is game state:
 * anything the step READS is state) it belongs in the state. As globals it cost
 * three separate things:
 *
 *   - a save made with a flag set, restored in a fresh tab, flew DIFFERENT
 *     brains than the run it came from — the flag is not in the snapshot and
 *     `globalThis` does not survive a reload
 *   - a test had to remember to clear up, or leak its choice into every test
 *     after it; the discipline held, but only by hand
 *   - the combat trainer needed a save-the-old-value/put-it-back dance around
 *     every exercise, and got it right, which is not the same as it being safe
 *
 * In the state all three go away: it is snapshotted with everything else, a test
 * passes the selection it wants as an argument, and the trainer's teardown is
 * the ordinary restore it already does.
 *
 * From a console, go through the one documented handle:
 * `__game.state.brains.legacy = 'pro'`. In the game, the LIVE BRAINS row on the
 * combat trainer's setup panel (`T` at any station) writes the same field.
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
  /** TODO 29's `pirate-attack-t29`: `true` for all, `'pro'` for tier >= 1 */
  t29?: boolean | 'pro';
  /** TODO 29's `pirate-pack-t29` flies the gangs; `true` also arms solo pirates */
  packT29?: boolean;
  /** TODO 29's `jameson-defend-t29` flies armed traders and player-assist ships */
  defendT29?: boolean;
}

/** The solo policy a pirate flies with no overrides. */
const SHIPPED_SOLO: BrainName = 'pirate-attack-g3';
/** The policy an organised gang flies with no overrides. */
const SHIPPED_PACK: BrainName = 'pirate-pack-r4-selectonly';
/** The policy an armed trader turns and fights with, with no overrides. */
const SHIPPED_DEFENCE: BrainName = 'jameson-defend-g1';

/**
 * No overrides: what the live game flies. Frozen, because it is a shared default
 * and a caller mutating it would move every other caller's brains.
 *
 * **THIS IS THE LINE THAT CHANGES THE SHIPPED DEFAULT.** Everything downstream
 * is derived from it — `pirateBrainFor`, `defenceBrain`, the trainer's
 * `liveBrainFor` and the three `SHIPPED_*_BRAIN` ids in the report — so
 * promoting TODO 29's candidates is:
 *
 *     export const SHIPPED_BRAINS: BrainSelection =
 *       Object.freeze({ t29: true, packT29: true, defendT29: true });
 *
 * and nothing else. It is deliberately still `{}`: all three candidates beat
 * their shipped counterparts on damage and read as the turret this project has
 * rolled back twice (docs/TRAINING-LOG.md, run 19). `npm test` asserts this
 * object is empty, so flipping it is a decision somebody has to take twice.
 */
export const SHIPPED_BRAINS: BrainSelection = Object.freeze({});

/**
 * The `true | 'pro'` shape, read once: `'pro'` arms professionals and gangs and
 * leaves the opportunists on the shipped brain, which is how a mixed reception
 * gets tested without making every pirate a different animal.
 */
export function appliesTo(flag: boolean | 'pro' | undefined, tier: number): boolean {
  if (!flag) return false;
  return flag === 'pro' ? tier >= 1 : true;
}

/** The two pack policies — the ones that observe their fleet, not just a target. */
export const PACK_BRAINS: readonly BrainName[] = ['pirate-pack-r4-selectonly', 'pirate-pack-t29'];

export function isPackBrain(name: BrainName): boolean {
  return PACK_BRAINS.includes(name);
}

/**
 * Which policy a pirate of this tier flies, BY NAME.
 *
 * CLAUDE.md's Training split stated once: opportunists and professionals fly the
 * solo brain, an organised gang flies the pack policy. Everything `sel` does on
 * top of that is an A/B override for playtesting.
 *
 * The pack decision comes first because it always did — a gang flies the pack
 * policy even when a solo override is set — and the order of the solo chain is
 * the order the flags were added, which is also their precedence.
 */
export function pirateBrainNameFor(
  tier: number, organised: boolean, sel: BrainSelection = SHIPPED_BRAINS,
): BrainName {
  if (sel.scripted) return 'scripted';
  if (organised || sel.pack || sel.packT29) {
    return sel.packT29 ? 'pirate-pack-t29' : SHIPPED_PACK;
  }
  if (appliesTo(sel.legacy, tier)) return 'pirate-attack-r2';
  if (appliesTo(sel.engine, tier)) return 'pirate-attack-e1';
  if (appliesTo(sel.sharp, tier)) return 'pirate-attack-g2';
  if (appliesTo(sel.t29, tier)) return 'pirate-attack-t29';
  return SHIPPED_SOLO;
}

/** Which policy an armed trader or a player-assist ship flies, BY NAME. */
export function defenceBrainNameFor(sel: BrainSelection = SHIPPED_BRAINS): BrainName {
  if (sel.scripted) return 'scripted';
  return sel.defendT29 ? 'jameson-defend-t29' : SHIPPED_DEFENCE;
}

/**
 * A named policy, as the selection that makes the whole game fly it.
 *
 * The inverse of the rule above, and the only terms the game can express an A/B
 * in: which policy a pirate flies is a decision per ROLE and per TIER, not per
 * ship, so "everybody flies e1" is a selection and "this one ship flies e1" is
 * not. The combat trainer's `ExerciseSpec.brain` sets one of these for the
 * duration of an exercise; the setup panel's LIVE BRAINS row sets one for the
 * career.
 *
 * `pirate-attack-g1` has no entry and never gets one — brains.ts does not import
 * it, so the game cannot fly it, and asking for it is refused rather than
 * silently ignored.
 */
const SELECTIONS: Partial<Record<BrainName, BrainSelection>> = {
  'pirate-attack-g3': {},
  'pirate-pack-r4-selectonly': { pack: true },
  'jameson-defend-g1': {},
  'pirate-attack-t29': { t29: true },
  'pirate-pack-t29': { packT29: true },
  'jameson-defend-t29': { defendT29: true },
  'pirate-attack-g2': { sharp: true },
  'pirate-attack-e1': { engine: true },
  'pirate-attack-r2': { legacy: true },
  scripted: { scripted: true },
};

/**
 * The selection a named brain flies under, or undefined if the game cannot fly it.
 *
 * Takes a plain string rather than a `BrainName` because the callers are the
 * combat trainer, whose `BrainId` list is deliberately wider than what the game
 * loads. A name this does not know is a name that cannot be flown, which is the
 * same answer either way.
 */
export function selectionForBrain(brain: string): BrainSelection | undefined {
  const sel = SELECTIONS[brain as BrainName];
  return sel ? { ...sel } : undefined;
}

/** "As shipped" — the pickable way to say "no override at all". */
export const AS_SHIPPED = 'as-shipped';

/** What the live picker offers: the shipped set, or one named policy for everybody. */
export type LiveBrainId = BrainName | typeof AS_SHIPPED;

/**
 * The live picker's list, in the order it should be shown: no override first,
 * then every policy a selection can name. Derived from the table, so wiring a
 * brain in is one entry rather than four.
 */
export const LIVE_BRAIN_IDS: readonly LiveBrainId[] = [
  AS_SHIPPED, ...(Object.keys(SELECTIONS) as BrainName[]),
];

/** The selection a live-picker choice means. A fresh object: `state.brains` is mutable. */
export function liveBrainSelection(id: LiveBrainId): BrainSelection {
  return id === AS_SHIPPED ? { ...SHIPPED_BRAINS } : (selectionForBrain(id) ?? { ...SHIPPED_BRAINS });
}

/**
 * Which live-picker choice a selection IS, or null when it is not one of them.
 *
 * Null is the honest answer for a combination only the console can make
 * (`{ sharp: 'pro' }`, say). The panel says so rather than showing a name the
 * game is not flying.
 */
export function liveBrainId(sel: BrainSelection): LiveBrainId | null {
  const wire = JSON.stringify(sel);
  if (wire === JSON.stringify(SHIPPED_BRAINS)) return AS_SHIPPED;
  for (const id of Object.keys(SELECTIONS) as BrainName[]) {
    if (JSON.stringify(SELECTIONS[id]) === wire) return id;
  }
  return null;
}
