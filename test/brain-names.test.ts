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
  AS_SHIPPED, AS_THE_GAME_FLIES, BRAINS, LIVE_BRAIN_IDS, SHIPPED_BRAINS,
  brainCharacter, brainName,
  defenceBrainNameFor, liveBrainId, liveBrainSelection, pirateBrainNameFor, selectionForBrain,
  type BrainName, type BrainSelection,
} from '../src/game/brain-names.ts';
import { liveBrainFor } from '../src/game/combat-sim-scenarios.ts';
import {
  BRAIN_CHOICES, defaultGroup, freshDraft, liveSelectionOf, setupCells, specFrom,
} from '../src/game/screens/combat-sim-setup.ts';
import {
  brainNote, careerNote, careerNoteReserve, draftNotes,
} from '../src/game/screens/combat-sim-notes.ts';
import { newCommander } from '../src/game/commander.ts';
import { check, eq } from './harness.ts';

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
        // Pirates have no loader path at all since 2026-08-05: the name rule
        // must answer 'scripted' for every tier under every selection, which
        // is the whole of "scripted flies the opposition".
        if (pirateBrainNameFor(tier, organised, sel) !== 'scripted') {
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
  // Every name is a defence-side pilot now; the pirate side is scripted
  // whatever the selection says.
  const badTrip = (Object.keys(BRAINS) as BrainName[]).filter((n) => {
    const sel = selectionForBrain(n);
    if (!sel) return true;
    return defenceBrainNameFor(sel) !== n;
  });
  check('every named brain is reachable through its own selection',
    badTrip.length === 0, badTrip.join(', '));

  // WHAT SHIPS, with no overrides: the scripted attack run for every pirate,
  // solo or ganged, and the trained defence policy for armed traders. The first
  // two changed when Chris asked for it after a session of flying them; the
  // third did not, because nothing has evaluated it against the run and an
  // armed trader's job — evade, survive, assist — is not a pirate's.
  check('a pirate flies the scripted attack run, alone or in a gang',
    pirateBrainNameFor(1, false) === 'scripted'
    && pirateBrainNameFor(1, true) === 'scripted');
  check('...and an armed trader turns and fights with the attack run now',
    defenceBrainNameFor() === 'attack-run');
  // There are no trained pirate alternatives to select any more: the weights
  // left the bundle on 2026-08-05 (scripted is the only opposition anywhere),
  // and the A/B control that remains is the one that turns the DEFENCE off.
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

console.log('\nevery brain the pickers offer has a name and a character');
{
  const offered = [...new Set<string>([...BRAIN_CHOICES, ...LIVE_BRAIN_IDS])];
  const silent = offered.filter((id) => !brainNote(id));
  check(`every value on both brain rows says what it does (${offered.length})`,
    silent.length === 0, silent.join(', '));
  const unnamed = offered.filter((id) => !brainName(id));
  check(`...and every one of them has a name to be picked BY (${offered.length})`,
    unnamed.length === 0, unnamed.join(', '));
  check('...and the character table covers the picker exactly, with nothing spare',
    Object.keys(BRAINS).every((id) => offered.includes(id)));

  // A name is the character line compressed, not a second way of writing the
  // file: no stem, no generation, and short enough to read at a glance.
  const bad = Object.entries(BRAINS).filter(([id, b]) =>
    !b.name || b.name !== b.name.toUpperCase() || b.name.length > 24
    || b.name.toLowerCase().includes(id) || /[a-z]/.test(b.name));
  check(`a name is words, never a file stem (${Object.keys(BRAINS).length})`,
    bad.length === 0, bad.map(([id]) => id).join(', '));

  // Behaviour, not provenance: a line is there to be read before a fight, and
  // "run 19's solo candidate" is not something a pilot can fly against.
  const noNumber = Object.entries(BRAINS).map(([id, b]) => [id, b.character] as const)
    .filter(([, line]) => !/\d/.test(line)).map(([id]) => id);
  check('...and each carries the measured number that shows it',
    noNumber.length === 0, noNumber.join(', '));

  // The two sentinels are not brains, so they are answered by the panel's own
  // prose — and the shipped one is DERIVED, so promoting a candidate moves it.
  check('"as the game flies" says where the answer comes from instead',
    /NOTHING IS SWAPPED OUT FOR THIS FIGHT/.test(brainNote(AS_THE_GAME_FLIES) ?? '')
    // in a pilot's words: not one of ours, and not a word that presupposes the
    // thing it is explaining
    && !/OVERRIDE|\bROLE\b|\bTIER\b/.test(brainNote(AS_THE_GAME_FLIES) ?? ''));
  check('...and "as shipped" names the three the shipped rule actually returns',
    LIVE_BRAIN_IDS.filter((id) => id !== AS_SHIPPED)
      .every((id) => !brainNote(AS_SHIPPED)!.includes(id.toUpperCase())
        || [pirateBrainNameFor(0, false), pirateBrainNameFor(0, true),
          defenceBrainNameFor()].includes(id as BrainName))
    && brainNote(AS_SHIPPED)!.includes(pirateBrainNameFor(0, false).toUpperCase()));

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

// --- the LIVE BRAINS row, which is the career's own selection ---------------
//
// The exercise brain row is one fight; this one is the galaxy until it is set
// back. It exists because live-play brain selection was reachable only from a
// developer console, which is not a thing to ask of a playtest.

console.log('\ncombat simulator — the live brain row');
{
const d = freshDraft(newCommander());
const row = () => setupCells(d).find((c) => c.label === 'COMBAT COMPUTER BRAINS')!;
eq('the panel offers it, and it starts at the shipped set',
  row().value, `(1 OF ${LIVE_BRAIN_IDS.length}) THE ORIGINAL`);
eq('...so the draft asks for no override', JSON.stringify(liveSelectionOf(d)), '{}');
// The fence is never an empty box: the reserved space is held whether or not
// there is a warning in it, so the calm case says the calm thing instead of
// leaving a hole. It is a STATUS, not a warning, and the two are painted apart.
eq('...and the fence says so rather than sitting empty',
  careerNote(d).text,
  'THE ORIGINAL — YOUR CAREER IS UNCHANGED. ANY OTHER VALUE HERE APPLIES OUT THERE TOO.');
eq('...as a status, not a warning', careerNote(d).warning, false);

// It is fenced off from the exercise settings and it is LAST, because it is the
// one row that is still set when you undock. A pilot reading it beside EXERCISE
// BRAIN read it as a second override for the same fight.
check('the row is fenced off from the exercise settings', row().fenced === true);
check('...under a heading that says it leaves the room',
  /STAYS SET AFTER YOU UNDOCK/.test(row().heading ?? ''));
eq('...and it is the last row on the panel',
  setupCells(d).at(-1)!.label, 'COMBAT COMPUTER BRAINS');
check('...so no exercise setting sits below it',
  setupCells(d).filter((c) => c.fenced).length === 1);

// step to a named value: one arrow key, and it is the whole galaxy. Since the
// trained pirate policies left the bundle (2026-08-05) the only stepped value
// that changes anything is the scripted A/B control, which also turns the
// armed traders' defence policy off.
d.live = 'scripted';
// On a combat-computer row, `scripted` means the co-pilot flies NOTHING —
// showing the attack run's behaviour there was gibberish for a pilot, so the
// row says what you actually get.
eq('a picked value reads back on the row as what the co-pilot does', row().value,
  `(${LIVE_BRAIN_IDS.indexOf('scripted') + 1} OF ${LIVE_BRAIN_IDS.length})`
  + ' NONE — FLY IT YOURSELF');
check('...and the file stem is in the note instead, not the value',
  (brainNote('scripted') ?? '').includes('SCRIPTED'));
eq('...and is the selection the game would fly',
  JSON.stringify(liveSelectionOf(d)), '{"scripted":true}');
check('...and the fenced note says it outlives the exercise',
  /COMBAT COMPUTER: YOUR CO-PILOT AND EVERY ARMED TRADER NOW FLIES NOTHING/
    .test(careerNote(d).text));
eq('...as a warning this time, painted apart from the calm case',
  careerNote(d).warning, true);
check('...in words the contextual help does not use, because it is forgettable',
  /CAREER|SAVED WITH THE COMMANDER/.test(careerNote(d).text)
  && !draftNotes(d).some((n) => /LIVE BRAINS/.test(n)));
check('...and the space it takes is reserved whether it is there or not',
  careerNoteReserve().length >= careerNote(d).text.length);

// ...and every "AS THE GAME FLIES" hint on the panel follows it, because the
// hint's whole job is to say what the opposition will actually be flying
d.groups.push(defaultGroup(1));
const hint = setupCells(d)
  .find((c) => c.label.replace(/&nbsp;/g, '') === 'THIS GROUP FLIES');
// Asserted on the RESOLUTION rather than on a substring of the value. The value
// used to carry `SAME AS OUTSIDE — HOLDS OFF (pirate-pack-r4-selectonly)`, so
// this could pass on the formatting; `cell.brain` is the thing the note and the
// spec are both built from, which is what the claim was always about.
check('a group left on "same as outside" names the LIVE brain, not the shipped one',
  !!hint && hint.brain === 'scripted');
eq('...and that is the brain the spec carries',
  specFrom(d, 1).custom![0].brain, 'scripted');

// a console-set combination the picker cannot name is SAID, not guessed — and
// so is a flag a save carries from before TODO 57 deleted the policy behind it
d.live = null;
eq('a selection only the console can make says so', row().value, 'SET FROM THE CONSOLE');
check('...in the fenced note too', /SET FROM THE CONSOLE/.test(careerNote(d).text));
eq('...and that is a warning as well', careerNote(d).warning, true);
check('...and it fits the reserved space',
  careerNoteReserve().length >= careerNote(d).text.length);
row().change!(1);
check('...and one arrow key takes it back', d.live !== null);
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
    // WHAT SHIPS IS THE SCRIPTED ATTACK RUN, for pirates of every tier and for
    // organised gangs alike — and since 2026-08-05 there is nothing else a
    // pirate COULD fly: the trained weights left the bundle, so the name rule
    // answers 'scripted' for every tier, and brains.ts has no pirate loader
    // for a stale path to fall back to.
    check('an opportunist flies the scripted attack run',
      pirateBrainNameFor(0, false) === 'scripted');
    check('...and so does a professional', pirateBrainNameFor(1, false) === 'scripted');
    check('...and so does an organised gang', pirateBrainNameFor(2, true) === 'scripted');
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
    // selection can summon a pirate brain any more.
    check('no selection can put a trained policy on anything',
      pirateBrainNameFor(2, true, { scripted: true }) === 'scripted'
      && (Object.keys(BRAINS) as BrainName[])
        .every((n) => n === 'scripted' || n === 'attack-run'));
  }
  // No defence weights fitted since 2026-08-05 — the shipped defence is the
  // scripted attack run, which the name rule returns.
  check('no defence brain is fitted — the shipped defence is the scripted run',
    defenceBrain() === null && defenceBrainNameFor() === 'attack-run');
}
