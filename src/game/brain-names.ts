// Which named policy flies, what each one is LIKE, and the flags that change that.
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
//
// The CHARACTER of each brain is here for the same reason. A picker offering
// twelve filenames tells a playtester nothing about what he is about to fly
// against, and the answer was already measured — it was just in a doc. A
// character is one line of BEHAVIOUR with the number that shows it, it belongs
// beside the name rather than beside the weights, and `npm test` refuses a name
// the pickers offer with no line to go with it.
//
// And so is what each one is CALLED on the row, which is the half a sentence
// under the panel could not fix: a row whose value is `pirate-attack-t29` is
// asking a pilot to choose between build artefacts, however well the artefacts
// are explained underneath. The name is the character line compressed to two or
// three words — `HANGS BACK`, `CLOSES IN` — so it is never a separate claim that
// could go stale on its own, and it lives in the same table as the line it came
// from, so a brain cannot have one without the other.

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
 * Every name a PICKER may offer: the loaded set, plus `pirate-attack-g1`.
 *
 * Wider than `BrainName` by exactly one, and that one is the point — the weights
 * file exists and the trainer lists it, but brains.ts does not import it, so the
 * game cannot fly it and asking is refused on the record rather than silently
 * ignored. `combat-sim-scenarios.ts`'s `BrainId` IS this type; it was a second
 * copy of the union until the character table needed to cover both.
 */
export type NamedBrain = BrainName | 'pirate-attack-g1';

/**
 * The two values a picker offers that are not policies at all.
 *
 * "As shipped" is the career picker's way of saying no override at all; "as the
 * game flies" is the exercise picker's — leave every ship on whatever it would
 * be flying out there. They are here beside the names for one reason: a picker
 * offers them in the same list as the brains, so "every value on this row has a
 * name" has to be answerable for them too.
 */
export const AS_SHIPPED = 'as-shipped';
export const AS_THE_GAME_FLIES = 'live';

/** What a policy is called on a row, and what it is like to fight. */
export interface BrainProfile {
  /**
   * Two or three words saying how it FLIES — the row's value.
   *
   * The character line below, compressed: "hangs back and snipes" is `HANGS
   * BACK`. Never a version, a generation or a file stem, because those are the
   * thing this replaces. The weights file is still shown beside it, quieter, for
   * anyone cross-referencing docs/TRAINING-LOG.md.
   */
  name: string;
  /** the one line of behaviour, with the measured number that shows it */
  character: string;
}

/**
 * What each policy is CALLED and what it is LIKE in a fight — one line,
 * behaviour first, with the one measured number that shows it.
 *
 * **Every figure here is traceable and none of it is invented.** The flight
 * shapes (speed, median engagement range, attack runs, collisions per episode)
 * are `train/flight-probe.ts` over 30 held-out episodes against a target that
 * stops and turns; the damage shares are the 60-episode tournament in
 * `npm run evaluate`. Both tables are archived in
 * `train/logs/todo29/evaluate-after.txt` and read in docs/TRAINING-LOG.md,
 * run 19 — except `pirate-attack-g1`, which no archived probe covered and which
 * was measured for this table (docs/TRAINING-LOG.md, probe run for TODO 32,
 * `train/logs/todo32/flight-probe.txt`).
 *
 * A line describes behaviour, NOT provenance: "hangs back and snipes" is what a
 * pilot needs before he flies it, and "run 19's solo candidate" is not. Where a
 * number would have to be guessed it says so instead — the panel saying NEVER
 * PROBED is honest and useful, and a made-up figure is neither.
 *
 * The trainer's two pickers offer one more value each — AS THE GAME FLIES and
 * AS SHIPPED — which are not brains but sentinels; their lines live with the
 * rest of the panel's prose in `screens/combat-sim-notes.ts`.
 */
export const BRAINS: Readonly<Record<NamedBrain, BrainProfile>> = Object.freeze({
  // probe: speed 216, range 85/234/964, 0.20 rams · tournament: 12.0% of her
  // pools against a hauler, 5.3% against a commander who fights back
  'pirate-attack-g3': {
    name: 'CLOSES IN',
    character: 'CLOSES AND STAYS THERE — SPEED 216, MEDIAN RANGE 234, 0.20 COLLISIONS AN EPISODE. '
      + 'THE FIGHT THE GAME SHIPS.',
  },
  // probe: speed 144, range 393/1447/2905, 0.83 passes · tournament: a gang of
  // three takes 23.7% of her pools and kills her in 0% of episodes
  'pirate-pack-r4-selectonly': {
    name: 'HOLDS OFF',
    character: 'A GANG THAT WATCHES ITS FLEET AND HOLDS OFF — MEDIAN RANGE 1447 AT SPEED 144. '
      + 'THREE OF THEM TAKE 23.7% OF YOUR POOLS AND KILL NOBODY.',
  },
  // tournament, two shipped pirates on her tail: they hold her six 2.3s and she
  // shoots down 0.42 of them an episode
  'jameson-defend-g1': {
    name: 'TURNS AND FIGHTS',
    character: 'AN ARMED TRADER THAT TURNS AND FIGHTS — SHAKES TWO PIRATES OFF HER SIX IN 2.3s '
      + 'AND SHOOTS DOWN 0.42 OF THEM AN EPISODE.',
  },
  // probe: speed 104, range 102/754/1952, 2.23 rams · tournament: 25.3% of her
  // pools against a commander who fights back, to g3's 5.3%
  'pirate-attack-t29': {
    name: 'HANGS BACK',
    character: 'HANGS BACK AND SNIPES — SPEED 104, MEDIAN RANGE 754, 2.23 COLLISIONS AN EPISODE. '
      + 'TAKES 25.3% OF YOUR POOLS TO G3\'S 5.3%, AND READS AS A TURRET.',
  },
  // probe: range 198/1340/4505 · tournament: 53.1% and 18% kills, against the
  // shipped pack's 23.7% and none
  'pirate-pack-t29': {
    name: 'SNIPES AND CONNECTS',
    character: 'A GANG THAT SNIPES FROM 1340 AND CONNECTS — 53.1% OF YOUR POOLS AND 18% KILLS, '
      + 'AGAINST THE SHIPPED PACK\'S 23.7% AND NONE.',
  },
  // tournament, two shipped pirates on her tail: 13.5s on her six against
  // defend-g1's 2.3s, and 0.12 attackers downed against 0.42
  'jameson-defend-t29': {
    name: 'EVADES, SHOOTS BADLY',
    character: 'EVADES WELL, SHOOTS BADLY — LETS AN ATTACKER SIT ON HER SIX 13.5s TO '
      + 'DEFEND-G1\'S 2.3s, AND DOWNS 0.12 AN EPISODE TO ITS 0.42.',
  },
  // probe: speed 117, range 113/628/1762, 2.27 rams, 42.1% of her pools — the
  // same 42.1% t29 takes, which is why the two lines rhyme
  'pirate-attack-g2': {
    name: 'THE TURRET',
    character: 'THE TURRET THAT WAS ROLLED BACK — SPEED 117, MEDIAN RANGE 628, 2.27 COLLISIONS AN '
      + 'EPISODE. T29 IS THIS BRAIN AGAIN, TO THE DECIMAL.',
  },
  // probed for this table: speed 117, range 103/868/1994, 0.13 passes, 1.97 rams
  //
  // The one name that is not a flight shape, and deliberately: it flies like g2
  // (117, median 868), but what a pilot needs off the row is that picking it
  // gets him no fight at all.
  'pirate-attack-g1': {
    name: 'CANNOT BE FLOWN',
    character: 'GENERATION 1, AND THE GAME CANNOT FLY IT — NOT IN THE BUNDLE, SO AN EXERCISE '
      + 'REFUSES IT ON THE RECORD. PROBED: SPEED 117, MEDIAN RANGE 868.',
  },
  // probe: 0.93 completed close-and-break cycles an episode, the highest of any
  // brain measured (the shipped pack is next at 0.83); speed 182, range
  // 222/706/1740
  'pirate-attack-e1': {
    name: 'MAKES ATTACK RUNS',
    character: 'BREAKS OFF AND COMES BACK MORE THAN ANY OTHER — 0.93 ATTACK RUNS AN EPISODE AT '
      + 'SPEED 182, MEDIAN RANGE 706.',
  },
  // probe: speed 262, range 185/254/1166 · the 220-unit dead zone is RAM_GUARD
  // in brains.ts, and 220 is inside the range a human fights at (median 260)
  'pirate-attack-r2': {
    name: 'FAST, GUNS CUT OUT',
    character: 'THE GAME BEFORE ANY OF THIS — FASTEST AT SPEED 262 AND CLOSES TO 254, BUT ITS '
      + 'GUNS CUT OUT INSIDE 220 UNITS, WHICH IS WHERE A HUMAN FIGHTS.',
  },
  // tournament: 58% accuracy and 31.8s on a hauler's six, and it loses 0.93
  // ships an episode to a commander who fights back
  scripted: {
    name: 'THE OLD AIMBOT',
    character: 'THE PRE-NEUROEVOLUTION AIMBOT — 58% ACCURACY AND 31.8s ON A HAULER\'S SIX, BUT IT '
      + 'LOSES 0.93 SHIPS AN EPISODE TO A COMMANDER WHO SHOOTS BACK.',
  },
});

/**
 * What the two sentinels read as. What they MEAN is still the panel's own prose
 * (`screens/combat-sim-notes.ts`); neither has a character to state.
 */
const SENTINEL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [AS_THE_GAME_FLIES]: 'AS THE GAME FLIES',
  [AS_SHIPPED]: 'AS SHIPPED',
});

/**
 * What a picker VALUE reads as: two or three words about how it flies, or the
 * sentinel's own words. Undefined for a value no picker offers.
 *
 * Takes a plain string for the same reason `selectionForBrain` does — the two
 * pickers speak different unions and both ask this.
 */
export function brainName(brain: string): string | undefined {
  return BRAINS[brain as NamedBrain]?.name ?? SENTINEL_NAMES[brain];
}

/**
 * What a named brain is like in a fight, or undefined for a name no picker
 * offers. Takes a plain string for the same reason `selectionForBrain` does.
 */
export function brainCharacter(brain: string): string | undefined {
  return BRAINS[brain as NamedBrain]?.character;
}

/** Is this a policy with a weights file behind it, rather than a sentinel? */
export function isNamedBrain(brain: string): brain is NamedBrain {
  return brain in BRAINS;
}

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
