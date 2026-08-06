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
// under the panel could not fix: a row whose value is `pirate-pack-r4-selectonly`
// is asking a pilot to choose between build artefacts, however well the artefacts
// are explained underneath. The name is the character line compressed to two or
// three words — `HOLDS OFF`, `CLOSES IN` — so it is never a separate claim that
// could go stale on its own, and it lives in the same table as the line it came
// from, so a brain cannot have one without the other.

/**
 * Every policy the game LOADS, by the stem of its weights file, plus the
 * pre-neuroevolution scripted AI.
 *
 * Three weights files and one code path, and that is the whole list. It was ten
 * names over nine files until TODO 57: six of them were experiments kept as
 * evidence, the evidence is written down in docs/TRAINING-LOG.md, and a picker
 * offering ten policies of which three are the game was asking a playtester to
 * choose between build artefacts. `npm test` holds the weights directory to
 * exactly what brains.ts imports, so a name here without a file — or a file with
 * no name — fails rather than lingering.
 *
 * A name is not a promise that the file parsed — brains.ts loads defensively and
 * a mismatched file becomes null there. It is a promise that brains.ts imports
 * it, and `npm test` reads brains.ts to check that every name here does.
 */
export type BrainName =
  | 'attack-run'
  | 'pursuit'
  | 'scripted';

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
 * run 19. The rows for the policies this project measured and did not ship went
 * with their weights in TODO 57; the logs are still the record of what they did.
 *
 * A line describes behaviour, NOT provenance: "hangs back and snipes" is what a
 * pilot needs before he flies it, and "run 19's solo candidate" is not. Where a
 * number would have to be guessed it says so instead — the panel saying NEVER
 * PROBED is honest and useful, and a made-up figure is neither.
 *
 * The trainer's two pickers offer one more value each — SAME AS OUTSIDE and
 * THE ORIGINAL — which are not brains but sentinels; their lines live with the
 * rest of the panel's prose in `screens/combat-sim-notes.ts`.
 */
export const BRAINS: Readonly<Record<BrainName, BrainProfile>> = Object.freeze({
  // TWO entries, both code, and the shortness IS the record. The trained
  // defence line (`jameson-defend-*`) left the bundle on 2026-08-05, the same
  // day the trained pirates did and for the sharper reason: three retrains in
  // a row optimised their way out of fighting (a turret, a sprayer, a
  // pacifist — docs/TRAINING-LOG.md runs 20-21), and Chris judged the lot "no
  // good" against the run below. Every figure they ever measured is in the
  // log; train/evolve.ts can still breed one for research, and a future
  // candidate re-enters by having its weights imported in brains.ts and its
  // name added here — one row, both pickers.
  //
  // The attack run flying the DEFENCE slots: the commander's co-pilot, and an
  // armed trader turning to fight. Its measured figures are the scripted
  // row's below (the same code path — tournament: 58% accuracy, ~5 attack
  // runs a minute); its own trigger is the player gun's hit cone, so it
  // shoots only what it can hit.
  'attack-run': {
    name: 'FLIES ATTACK RUNS',
    character: 'YOUR SHIP FLIES THE SAME ATTACK RUN THE PIRATES FLY: CLOSE, FIRE THROUGH '
      + 'THE PASS, SWING OUT AND COME ROUND AGAIN — ABOUT 5 RUNS A MINUTE, SHOOTING ONLY '
      + 'WHEN LINED UP.',
  },
  // tournament: 58% accuracy and 31.8s on a hauler's six, and it loses 0.93
  // ships an episode to a commander who fights back
  scripted: {
    name: 'MAKES ATTACK RUNS',
    character: 'THE HAND-WRITTEN ATTACK RUN EVERY PIRATE FLIES: CLOSES, FIRES THROUGH THE '
      + 'PASS AND COMES ROUND AGAIN — ABOUT 5 RUNS A MINUTE. ON A COMBAT COMPUTER ROW '
      + 'THIS MEANS NO CO-PILOT AT ALL.',
  },
  // The pursuit dogfighter the combat computer flies, turned on the pirates —
  // the experiment that lets a player fly against opponents with his own
  // pilot. It does NOT joust: it gets on your six and stays, breaking off only
  // to avoid a collision. NOT PROBED in the tournament (it post-dates it), and
  // the character line says so rather than quoting a number it never measured.
  pursuit: {
    name: 'GETS ON YOUR SIX',
    character: 'THE COMBAT COMPUTER\'S OWN PILOT, FLOWN BY THE PIRATES: IT CHASES ONTO YOUR '
      + 'TAIL AND HOLDS THERE, VEERING OFF ONLY TO AVOID RAMMING — NOT THE ATTACK RUN\'S '
      + 'JOUST. NEVER PROBED (IT IS NEWER THAN THE TOURNAMENT).',
  },
});

/**
 * What the two sentinels read as. What they MEAN is still the panel's own prose
 * (`screens/combat-sim-notes.ts`); neither has a character to state.
 */
const SENTINEL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [AS_THE_GAME_FLIES]: 'SAME AS OUTSIDE',
  [AS_SHIPPED]: 'THE ORIGINAL',
});

/**
 * What a picker VALUE reads as: two or three words about how it flies, or the
 * sentinel's own words. Undefined for a value no picker offers.
 *
 * Takes a plain string for the same reason `selectionForBrain` does — the two
 * pickers speak different unions and both ask this.
 */
export function brainName(brain: string): string | undefined {
  return BRAINS[brain as BrainName]?.name ?? SENTINEL_NAMES[brain];
}

/**
 * What a named brain is like in a fight, or undefined for a name no picker
 * offers. Takes a plain string for the same reason `selectionForBrain` does.
 */
export function brainCharacter(brain: string): string | undefined {
  return BRAINS[brain as BrainName]?.character;
}

/** Is this a policy with a weights file behind it, rather than a sentinel? */
export function isNamedBrain(brain: string): brain is BrainName {
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
 * `__game.state.brains.pack = true`. In the game, the LIVE BRAINS row on the
 * combat trainer's setup panel (`T` at any station) writes the same field.
 *
 * **It is three flags now, and it used to be nine.** `legacy`, `sharp`,
 * `engine`, `t29`, `packT29` and `defendT29` each named one experiment's weights
 * file, and TODO 57 deleted the weights; `passes` named the restored solo
 * candidate `pirate-attack-e1`, and TODO 61 deleted that one too — a flag whose
 * policy is not in the bundle has nothing to select. An OLD SAVE may still carry
 * one, and that is deliberately not a migration (Chris, 2026-08-03) — an unknown
 * key rides along in the snapshot, nothing reads it, so the career flies the
 * shipped brains and the trainer's LIVE BRAINS row reports a selection it cannot
 * name and offers to take it back. `npm test` restores one and checks exactly
 * that.
 */
export interface BrainSelection {
  /**
   * Fly NO brains at all — the A/B control that turns the DEFENCE policy off
   * too, so an armed trader falls back to running.
   *
   * `pack` and `trained` selected the two trained pirate
   * policies, and Chris deleted those from the bundle on 2026-08-05: scripted
   * flies the opposition everywhere — the sky AND the trainer's rows — so a
   * flag whose policy is not in the bundle has nothing to select. An old save
   * carrying either rides along unread, exactly as `passes` and the six
   * TODO 57 flags do; the trainer's LIVE BRAINS row reports a selection it
   * cannot name and offers to take it back.
   */
  scripted?: boolean;
  /**
   * Fly the PURSUIT dogfighter as the pirates — the combat computer's own
   * pilot turned on the player, so a commander can fight opponents with his own
   * co-pilot's flying. An experiment, offered by the trainer's LIVE BRAINS row;
   * the default sky still flies the scripted attack run (`pirateBrainNameFor`).
   */
  pursuit?: boolean;
}

/**
 * THE OPPOSITION IS SCRIPTED — everywhere, and that is now the whole rule.
 *
 * Chris flew every option in the trainer — "the scripted one is actually
 * better" — and d563e3d made the three-phase attack run what ships for solo
 * pirates and organised gangs alike. On 2026-08-05 he went the rest of the
 * way: the two trained pirate policies (`pirate-attack-g3`,
 * `pirate-pack-r4-selectonly`) came OUT of the bundle entirely, TODO 57's
 * ship-only-what-ships applied to the rows that only ever existed to compare
 * against them. The neuroevolution is neither deleted nor wasted
 * (docs/TRAINING-LOG.md keeps every figure): it produced the finding the
 * flight model is built on — that stopping is the optimal way to hold a
 * firing line, hence `MIN_CRUISE_FRACTION` — and train/evolve.ts can still
 * breed a pirate for research; the game just never loads one.
 */
/**
 * The pilot an armed trader turns and fights with, and the combat computer
 * you buy, with no overrides: the SAME attack run the pirates fly, pointed
 * the other way (scripted-co-pilot.ts, and npc.ts's defence path).
 *
 * It was `jameson-defend-g2`, the last trained policy in the bundle, under a
 * long-standing rule that "there is no scripted equivalent for flying YOUR
 * ship". attack-run.ts made that rule false on 2026-08-05 — the run's
 * composition is shipless now — and the trained line's third consecutive
 * wall (docs/TRAINING-LOG.md runs 20-21) made the change worth making.
 */
const SHIPPED_DEFENCE: BrainName = 'attack-run';

/**
 * No overrides: what the live game flies. Frozen, because it is a shared default
 * and a caller mutating it would move every other caller's brains.
 *
 * **THIS IS THE LINE THAT CHANGES THE SHIPPED DEFAULT.** Everything downstream
 * is derived from it — `pirateBrainFor`, `defenceBrain`, the trainer's
 * `liveBrainFor` and the three `SHIPPED_*_BRAIN` ids in the report — so
 * promoting a future candidate is a flag here and the three constants above,
 * and nothing else. It is deliberately `{}`: what ships is what the shipped
 * three do, and `npm test` asserts this object is empty, so changing it is a
 * decision somebody has to take twice.
 */
export const SHIPPED_BRAINS: BrainSelection = Object.freeze({});

/**
 * Which policy a pirate of this tier flies, BY NAME: `scripted`, always.
 *
 * The function survives the answer becoming constant because it is the named
 * home of the rule CLAUDE.md points at — scripted flies the opposition — and
 * because the QUESTION still has a tier and an organisation in it: a caller
 * asking "what does an organised gang fly" should not have to know that today
 * every answer is the same. The parameters are kept so the rule can change
 * shape again without every call site moving.
 */
export function pirateBrainNameFor(
  _tier: number, _organised: boolean, sel: BrainSelection = SHIPPED_BRAINS,
): BrainName {
  return sel.pursuit ? 'pursuit' : 'scripted';
}

/** Which policy an armed trader or a player-assist ship flies, BY NAME. */
export function defenceBrainNameFor(sel: BrainSelection = SHIPPED_BRAINS): BrainName {
  return sel.scripted ? 'scripted' : SHIPPED_DEFENCE;
}

/**
 * A named policy, as the selection that makes the whole game fly it.
 *
 * The inverse of the rule above, and the only terms the game can express an A/B
 * in: which policy a pirate flies is a decision per ROLE, not per ship, so
 * "everybody flies the gang policy" is a selection and "this one ship flies it"
 * is not. The combat trainer's `ExerciseSpec.brain` sets one of these for the
 * duration of an exercise; the setup panel's LIVE BRAINS row sets one for the
 * career.
 *
 * Every name has an entry, and after TODO 57 that is the point: a policy either
 * picker offers is a policy the game can be put into. The list used to be wider
 * than what could fly — `pirate-attack-g1` was offered and then refused on the
 * record — and it was wider only because six experiments were in the bundle.
 */
const SELECTIONS: Partial<Record<BrainName, BrainSelection>> = {
  'attack-run': {},
  pursuit: { pursuit: true },
  scripted: { scripted: true },
};

/**
 * The selection a named brain flies under, or undefined if the game cannot fly it.
 *
 * Takes a plain string rather than a `BrainName` because the callers speak two
 * different unions and a saved career can hand over anything at all. A name this
 * does not know is a name that cannot be flown, which is the same answer either
 * way.
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
 * Null is the honest answer for a combination the picker cannot name — one the
 * console made, or one a save carries from before TODO 57 deleted the flag that
 * meant it. The panel says so rather than showing a name the game is not flying,
 * and arrowing the row takes it back.
 */
export function liveBrainId(sel: BrainSelection): LiveBrainId | null {
  const wire = JSON.stringify(sel);
  if (wire === JSON.stringify(SHIPPED_BRAINS)) return AS_SHIPPED;
  for (const id of Object.keys(SELECTIONS) as BrainName[]) {
    if (JSON.stringify(SELECTIONS[id]) === wire) return id;
  }
  return null;
}
