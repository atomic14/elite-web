// Which policy the game flies, by NAME — the rule, the pairing, and the row.
//
// `src/game/brain-names.ts` exists because one question was being answered in
// three places: `NpcShip.update` needs the WEIGHTS, the combat trainer's report
// needs the NAME, and the pickers need the LIST. They disagreed — the report
// hardcoded the shipped ids and ignored `BrainSelection` entirely, so a career
// flying `state.brains.sharp = 'pro'` was told it fought g3 while npc.ts flew
// g2. This file is what stops that coming back: the same selection is taken to
// the name rule and to the loader, and the two must land on the same policy.

import { readdirSync, readFileSync } from 'node:fs';
import { defenceBrain, brainByName } from '../src/game/brains.ts';
import {
  AS_SHIPPED, BRAINS, LIVE_BRAIN_IDS, SHIPPED_BRAINS,
  brainCharacter, brainName,
  defenceBrainNameFor, liveBrainId, liveBrainSelection, pirateBrainNameFor, selectionForBrain,
  type BrainName, type BrainSelection,
} from '../src/game/brain-names.ts';
import { liveBrainFor } from '../src/game/combat-sim-scenarios.ts';
import { PIRATE_CHOICES } from '../src/game/screens/combat-sim-setup.ts';
import { brainNote } from '../src/game/screens/combat-sim-notes.ts';
import { check } from './harness.ts';

// --- one rule, one home: the name, the weights and the report ----------------
//
// The trainer's report names the policy it flew, and it used to name it from a
// hardcoded list — so a career with `state.brains.sharp = 'pro'` was told it
// fought g3 while npc.ts flew g2. Both sides ask brain-names.ts now, and these
// are the checks that keep that true rather than merely arranged.

console.log('\nwhich brain flies, by name');
{
  // Since 2026-08-05 EVERY name is a code pilot — the trained defence line
  // followed the trained pirates out of the bundle the same day
  // (docs/TRAINING-LOG.md runs 20-21) — so the old check inverts: no name has
  // weights behind it, deliberately.
  const withWeights = (Object.keys(BRAINS) as BrainName[])
    .filter((n) => brainByName(n) !== null);
  check(`no name has weights behind it — both pilots are code (${withWeights.join(', ') || 'none'})`,
    withWeights.length === 0);

  // THE pairing. For every selection the game can be put in, the policy
  // `NpcShip.update` would fly IS the policy the report names.
  const disagreed: string[] = [];
  for (const id of LIVE_BRAIN_IDS) {
    const sel = liveBrainSelection(id);
    for (const tier of [0, 1, 2]) {
      for (const organised of [false, true]) {
        // Pirates fly pursuit, EXCEPT the scripted selection, which reverts them
        // to the hand-written attack run. Both are code — no loader path — so the
        // check is on the NAME rule, and it must agree with the picker.
        const want = sel.scripted ? 'scripted' : 'pursuit';
        if (pirateBrainNameFor(tier, organised, sel) !== want) {
          disagreed.push(`${id}/${tier}/${organised}`);
        }
      }
      const defence = defenceBrainNameFor(sel);
      const wantDefence = defence === 'scripted' ? null : brainByName(defence);
      if (defenceBrain(sel) !== wantDefence) disagreed.push(`${id}/defence`);
    }
  }
  check(`the named brain is the flown brain, for every selection (${LIVE_BRAIN_IDS.length})`,
    disagreed.length === 0, disagreed.join(', '));

  // ...and the table that turns a name back into a selection round-trips,
  // which is what makes "fly the same fight against X" mean what it says.
  // `pursuit` round-trips through the PIRATE rule; the rest are defence-side.
  const roundTrips = (n: BrainName): boolean => {
    const sel = selectionForBrain(n);
    if (!sel) return false;
    return n === 'pursuit'
      ? pirateBrainNameFor(0, false, sel) === n
      : defenceBrainNameFor(sel) === n;
  };
  const badTrip = (Object.keys(BRAINS) as BrainName[]).filter((n) => !roundTrips(n));
  check('every named brain is reachable through its own selection',
    badTrip.length === 0, badTrip.join(', '));

  // WHAT SHIPS, with no overrides: the pursuit dogfighter for every pirate,
  // solo or ganged, and the attack-run co-pilot for armed traders. The pirates
  // moved to pursuit when Chris asked for it; the defence did not, because
  // nothing has evaluated pursuit there and an armed trader's job — evade,
  // survive, assist — is not a pirate's.
  check('a pirate flies the pursuit dogfighter, alone or in a gang',
    pirateBrainNameFor(1, false) === 'pursuit'
    && pirateBrainNameFor(1, true) === 'pursuit');
  check('...and an armed trader turns and fights with the attack run',
    defenceBrainNameFor() === 'attack-run');
  // The one A/B control left reverts the whole game to the hand-written attack
  // run: pirates onto it, and the DEFENCE co-pilot off (there are no trained
  // alternatives to select — the weights left the bundle on 2026-08-05).
  check('...and the one surviving override is the scripted control',
    pirateBrainNameFor(1, false, { scripted: true }) === 'scripted'
    && defenceBrainNameFor({ scripted: true }) === 'scripted');

  // the picker's row, both ways
  check('the live picker offers "as shipped" first, and it means no override',
    LIVE_BRAIN_IDS[0] === AS_SHIPPED
    && Object.keys(liveBrainSelection(AS_SHIPPED)).length === 0);
  // ...a picked name reads back as itself, and the one id that cannot is named
  // rather than waved through. The escape hatch here used to exempt
  // `pirate-attack-g3` as well, which round-trips perfectly well — so of five
  // ids only three were being tested and a regression in g3 had a place to hide
  // (docs/TODO/87). Asserted as the exact SET of failures, because `every(...)
  // || exempt` widens silently and a list of exact failures does not.
  //
  // The real exception is the SHIPPED defence (`attack-run` today): its
  // selection is `{}`, the same empty object AS_SHIPPED means, so the picker
  // reads it back as "as shipped". The collision is the defect and it is
  // docs/TODO/81's; the round trip is only where it shows.
  const noTrip = LIVE_BRAIN_IDS.filter((id) => liveBrainId(liveBrainSelection(id)) !== id);
  check(`a picked name reads back as itself, for every id but one (${noTrip.join(', ') || 'none'})`,
    noTrip.length === 1 && noTrip[0] === 'attack-run');
  check('...and that one only because its selection IS the empty as-shipped one',
    Object.keys(liveBrainSelection('attack-run')).length === 0
    && liveBrainId(liveBrainSelection('attack-run')) === AS_SHIPPED);
  // ...and a selection the picker cannot name says so rather than guessing. A
  // save made before TODO 57 deleted the six A/B flags is exactly this case: it
  // is not migrated, it must not throw, and the row offers to take it back.
  check('...and a flag no picker can name reads back as null, rather than throwing',
    liveBrainId({ sharp: 'pro' } as unknown as BrainSelection) === null
    && liveBrainId({ t29: true, packT29: true } as unknown as BrainSelection) === null);
  check('the picked selection is a COPY — state.brains is mutable',
    liveBrainSelection('scripted') !== liveBrainSelection('scripted')
    && !Object.isFrozen(liveBrainSelection(AS_SHIPPED)));
}

// --- and every name it offers is a NAME, and says what it DOES ---------------
//
// The pickers used to answer "which brain" with a filename, and PIRATE-ATTACK-T29
// tells a playtester nothing about what he is about to fly against. TODO 32 put a
// character line under the selected row and it was not enough — the row's VALUE
// was still the file, so the thing being chosen between still read as build
// artefacts. Every value either picker offers now has BOTH: two or three words
// saying how it flies, and the measured line the words were compressed from.
// They live in one table, so neither can be added without the other.

console.log('\nevery brain the picker offers has a name and a character');
{
  const offered = [...PIRATE_CHOICES];
  const silent = offered.filter((id) => !brainNote(id));
  check(`every value on the pirate-brain row says what it does (${offered.length})`,
    silent.length === 0, silent.join(', '));
  const unnamed = offered.filter((id) => !brainName(id));
  check(`...and every one of them has a name to be picked BY (${offered.length})`,
    unnamed.length === 0, unnamed.join(', '));

  // A name is the character line compressed, not a second way of writing the
  // file: no stem, no generation, and short enough to read at a glance.
  const bad = Object.entries(BRAINS).filter(([id, b]) =>
    !b.name || b.name !== b.name.toUpperCase() || b.name.length > 24
    || b.name.toLowerCase().includes(id) || /[a-z]/.test(b.name));
  check(`a name is words, never a file stem (${Object.keys(BRAINS).length})`,
    bad.length === 0, bad.map(([id]) => id).join(', '));

  // Behaviour, not provenance: a line is there to be read before a fight, and
  // "run 19's solo candidate" is not something a pilot can fly against. A line
  // carries the measured number that shows the behaviour — OR says NEVER PROBED,
  // the honest absence the profile comment blesses over a made-up figure (the
  // pursuit pilot post-dates the tournament and has none).
  const noNumber = Object.entries(BRAINS).map(([id, b]) => [id, b.character] as const)
    .filter(([, line]) => !/\d/.test(line) && !line.includes('NEVER PROBED')).map(([id]) => id);
  check('...and each carries the measured number that shows it (or says NEVER PROBED)',
    noNumber.length === 0, noNumber.join(', '));

  check('a name no picker offers has no line, rather than a made-up one',
    brainCharacter('pirate-attack-r14') === undefined && brainNote('') === null);
}

console.log('\nthe trainer names what the game flies');
{
  // THE pairing, stated as the trainer states it. `liveBrainFor` is what the
  // report quotes; `pirateBrainFor` is what the ship flies. They took the same
  // question to two different answers — the report ignored `BrainSelection`
  // entirely — so a career with `state.brains.sharp = 'pro'` was told it fought
  // g3 while npc.ts flew g2.
  const wrong: string[] = [];
  for (const id of LIVE_BRAIN_IDS) {
    const sel = liveBrainSelection(id);
    for (const tier of [0, 1, 2]) {
      for (const organised of [false, true]) {
        const named = liveBrainFor('pirate', organised, tier, sel) as BrainName;
        if (named !== pirateBrainNameFor(tier, organised, sel)) {
          wrong.push(`${id}/${tier}/${organised ? 'gang' : 'solo'}`);
        }
      }
    }
    const trader = liveBrainFor('trader', false, 1, sel) as BrainName;
    const wantTrader = trader === 'scripted' ? null : brainByName(trader);
    if (defenceBrain(sel) !== wantTrader) wrong.push(`${id}/trader`);
    if (liveBrainFor('police', false, 1, sel) !== 'scripted') wrong.push(`${id}/police`);
  }
  check(`the brain the report names is the brain the game flies (${LIVE_BRAIN_IDS.length}`
    + ' selections)', wrong.length === 0, wrong.join(', '));
  check('...including with the brains switched off entirely',
    liveBrainFor('pirate', false, 1, { scripted: true }) === 'scripted'
    && liveBrainFor('trader', false, 1, { scripted: true }) === 'scripted');
}

// --- which policy actually flies -------------------------------------------
//
// Moved here from `test/ai.test.ts` when that file crossed 400 lines. It is the
// better home rather than a spare one: every assertion below is about
// `brain-names.ts`'s own rules — what ships, what a flag selects, what a save
// from before TODO 57 does — and ai.test.ts is about the policies themselves.

console.log('\nbrain selection');
{
  // No setup and no teardown: the selection is an ARGUMENT now, so a case
  // cannot leak into the next one. It used to be four `window.__` globals with
  // a clear() after every block — which worked, and only by hand.
  {
    // WHAT SHIPS IS THE PURSUIT DOGFIGHTER, for pirates of every tier and for
    // organised gangs alike — the shipped opposition since Chris asked for it.
    // The `scripted` selection reverts them to the attack run; with no override
    // the name rule answers 'pursuit' for every tier.
    check('an opportunist flies the pursuit dogfighter',
      pirateBrainNameFor(0, false) === 'pursuit');
    check('...and so does a professional', pirateBrainNameFor(1, false) === 'pursuit');
    check('...and so does an organised gang', pirateBrainNameFor(2, true) === 'pursuit');
  }
  {
    // docs/TODO/91's acceptance, kept after the pirate policies were deleted:
    // no correction the trainer does not apply survives anywhere.
    // ...and not just on this object: docs/TODO/91's acceptance is that
    // NEITHER side applies a correction the other does not, proven by scan.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e: import('node:fs').Dirent) => (e.isDirectory() ? walk(`${dir}/${e.name}`)
        : /\.(ts|js)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const offenders = [...walk(new URL('../src', import.meta.url).pathname),
      ...walk(new URL('../train', import.meta.url).pathname)]
      .filter((p) => {
        const src = readFileSync(p, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
        return src.includes('TARGET_SPEED_FLOOR') || /Math\.max\(150,/.test(src);
      });
    check('no file in src/ or train/ clamps a target speed any more',
      offenders.length === 0, offenders.join(', '));
  }
  {
    // No loaded defence brain to turn off any more: the trained line left the
    // bundle on 2026-08-05, so `defenceBrain` is null whatever the selection.
    // The NAME rule carries the choice now.
    check('the bundle holds no defence weights, whatever the selection',
      defenceBrain({ scripted: true }) === null && defenceBrain() === null);
    check('...and the name rule still splits scripted from the shipped run',
      defenceBrainNameFor({ scripted: true }) === 'scripted'
      && defenceBrainNameFor() === 'attack-run');
  }
  {
    // A SAVE FROM BEFORE TODO 57 OR TODO 61 still loads, and flies the shipped
    // brains.
    //
    // `state.brains` is snapshotted, so a career made when `legacy`, `sharp`,
    // `engine`, `t29`, `packT29` or `defendT29` existed — or when `passes`
    // selected the `pirate-attack-e1` candidate TODO 61 deleted — can hand one
    // back on restore. Deliberately not migrated (Chris, 2026-08-03): the flag
    // names a policy that is not in the bundle, nothing reads it, and it must
    // not throw. The trainer's LIVE BRAINS row says the selection cannot be
    // named and arrowing it takes it back — the row block above holds that end.
    //
    // `passes` is asserted alongside the six and not instead of them, because
    // it is the case the shape of the rule could still have got wrong: it was
    // the ONLY deleted flag read by `pirateBrainNameFor` itself, on the solo
    // line, so a botched deletion shows up here as a solo pirate flying
    // something other than the scripted run.
    const stale = { legacy: 'pro', t29: true } as unknown as BrainSelection;
    const deletedCandidate = { passes: true } as unknown as BrainSelection;
    // ...and the two 2026-08-05 deletions join the list: `pack` and `trained`
    // selected the trained pirate policies whose weights left the bundle.
    const deletedPirates = { pack: true, trained: true } as unknown as BrainSelection;
    for (const [what, sel] of [['a deleted A/B flag', stale],
      ['the deleted candidate flag', deletedCandidate],
      ['the deleted pirate-policy flags', deletedPirates]] as const) {
      check(`a save carrying ${what} still loads and flies what ships`,
        pirateBrainNameFor(1, false, sel) === pirateBrainNameFor(1, false)
        && pirateBrainNameFor(2, true, sel) === pirateBrainNameFor(2, true)
        && defenceBrain(sel) === defenceBrain());
      check('...and the picker says it cannot name the selection, rather than throwing',
        liveBrainId(sel) === null);
    }
  }
  {
    // The default is the shipped game, and it is frozen — a caller that
    // mutated it would move every other caller's brains.
    check('the shipped default carries no overrides',
      Object.keys(SHIPPED_BRAINS).length === 0 && Object.isFrozen(SHIPPED_BRAINS));
    check('an unspecified selection flies what the live game flies',
      pirateBrainNameFor(1, false) === pirateBrainNameFor(1, false, {})
      && defenceBrain() === defenceBrain({}));
    // On 2026-08-05 "ship the scripted run" DID become "delete the trained
    // pirate policies" — by decision, not drift. The assertion flips: no
    // selection can summon a WEIGHTS-backed pirate brain any more. `pursuit`
    // (added later) is a third CODE pilot, not a trained one.
    check('no selection can put a trained policy on anything',
      pirateBrainNameFor(2, true, { scripted: true }) === 'scripted'
      && (Object.keys(BRAINS) as BrainName[])
        .every((n) => n === 'scripted' || n === 'attack-run' || n === 'pursuit'));
  }
  // No defence weights fitted since 2026-08-05 — the shipped defence is the
  // scripted attack run, which the name rule returns.
  check('no defence brain is fitted — the shipped defence is the scripted run',
    defenceBrain() === null && defenceBrainNameFor() === 'attack-run');
}
