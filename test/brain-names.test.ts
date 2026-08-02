// Which policy the game flies, by NAME — the rule, the pairing, and the row.
//
// `src/game/brain-names.ts` exists because one question was being answered in
// three places: `NpcShip.update` needs the WEIGHTS, the combat trainer's report
// needs the NAME, and the pickers need the LIST. They disagreed — the report
// hardcoded the shipped ids and ignored `BrainSelection` entirely, so a career
// flying `state.brains.sharp = 'pro'` was told it fought g3 while npc.ts flew
// g2. This file is what stops that coming back: the same selection is taken to
// the name rule and to the loader, and the two must land on the same policy.

import {
  pirateBrainFor, defenceBrain, brainByName,
} from '../src/game/brains.ts';
import {
  AS_SHIPPED, LIVE_BRAIN_IDS, defenceBrainNameFor, liveBrainId, liveBrainSelection,
  pirateBrainNameFor, selectionForBrain, type BrainName,
} from '../src/game/brain-names.ts';
import { liveBrainFor } from '../src/game/combat-sim-scenarios.ts';
import {
  defaultGroup, freshDraft, liveSelectionOf, setupCells, specFrom,
} from '../src/game/screens/combat-sim-setup.ts';
import {
  careerNote, careerNoteReserve, draftNotes,
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
  const NAMED: BrainName[] = [
    'pirate-attack-g3', 'pirate-attack-g2', 'pirate-attack-e1', 'pirate-attack-r2',
    'pirate-attack-t29', 'pirate-pack-r4-selectonly', 'pirate-pack-t29',
    'jameson-defend-g1', 'jameson-defend-t29',
  ];
  const missing = NAMED.filter((n) => brainByName(n) === null);
  check(`every name the rule can return has weights behind it (${NAMED.length})`,
    missing.length === 0, missing.join(', '));
  check('...and the scripted AI deliberately has none', brainByName('scripted') === null);

  // THE pairing. For every selection the game can be put in, the policy
  // `NpcShip.update` would fly IS the policy the report names.
  const disagreed: string[] = [];
  for (const id of LIVE_BRAIN_IDS) {
    const sel = liveBrainSelection(id);
    for (const tier of [0, 1, 2]) {
      for (const organised of [false, true]) {
        const flown = pirateBrainFor(tier, organised, sel);
        const named = pirateBrainNameFor(tier, organised, sel);
        const want = named === 'scripted' ? null : brainByName(named);
        if ((flown?.brain ?? null) !== want) disagreed.push(`${id}/${tier}/${organised}`);
      }
      const defence = defenceBrainNameFor(sel);
      const wantDefence = defence === 'scripted' ? null : brainByName(defence);
      if (defenceBrain(sel) !== wantDefence) disagreed.push(`${id}/defence`);
    }
  }
  check(`the named brain is the flown brain, for every selection (${LIVE_BRAIN_IDS.length})`,
    disagreed.length === 0, disagreed.join(', '));

  // ...and the table that turns a name back into a selection round-trips, which
  // is what makes "fly the same fight against t29" mean what it says.
  const badTrip = NAMED.filter((n) => {
    const sel = selectionForBrain(n);
    if (!sel) return true;
    const pack = n.startsWith('pirate-pack');
    if (n.startsWith('jameson')) return defenceBrainNameFor(sel) !== n;
    return pirateBrainNameFor(1, pack, sel) !== n;
  });
  check('every named brain is reachable through its own selection',
    badTrip.length === 0, badTrip.join(', '));

  check('the TODO 29 candidates are loadable but NOT what the game flies',
    pirateBrainNameFor(1, false) === 'pirate-attack-g3'
    && pirateBrainNameFor(1, true) === 'pirate-pack-r4-selectonly'
    && defenceBrainNameFor() === 'jameson-defend-g1'
    && brainByName('pirate-attack-t29') !== null
    && brainByName('pirate-pack-t29') !== null
    && brainByName('jameson-defend-t29') !== null);

  // the picker's row, both ways
  check('the live picker offers "as shipped" first, and it means no override',
    LIVE_BRAIN_IDS[0] === AS_SHIPPED
    && Object.keys(liveBrainSelection(AS_SHIPPED)).length === 0);
  check('...a picked name reads back as itself',
    LIVE_BRAIN_IDS.every((id) => liveBrainId(liveBrainSelection(id)) === id
      || (id === 'pirate-attack-g3' || id === 'jameson-defend-g1')));
  check('...and a selection only the console could make reads back as null',
    liveBrainId({ sharp: 'pro' }) === null);
  check('the picked selection is a COPY — state.brains is mutable',
    liveBrainSelection('pirate-attack-t29') !== liveBrainSelection('pirate-attack-t29')
    && !Object.isFrozen(liveBrainSelection(AS_SHIPPED)));
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
        const flown = pirateBrainFor(tier, organised, sel)?.brain ?? null;
        const want = named === 'scripted' ? null : brainByName(named);
        if (flown !== want) wrong.push(`${id}/${tier}/${organised ? 'gang' : 'solo'}`);
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
const row = () => setupCells(d).find((c) => c.label === 'LIVE BRAINS (CAREER)')!;
eq('the panel offers it, and it starts at the shipped set', row().value, 'AS SHIPPED');
eq('...so the draft asks for no override', JSON.stringify(liveSelectionOf(d)), '{}');
// The fence is never an empty box: the reserved space is held whether or not
// there is a warning in it, so the calm case says the calm thing instead of
// leaving a hole. It is a STATUS, not a warning, and the two are painted apart.
eq('...and the fence says so rather than sitting empty',
  careerNote(d).text, 'AS SHIPPED — NOTHING HERE FOLLOWS YOU OUT.');
eq('...as a status, not a warning', careerNote(d).warning, false);

// It is fenced off from the exercise settings and it is LAST, because it is the
// one row that is still set when you undock. A pilot reading it beside EXERCISE
// BRAIN read it as a second override for the same fight.
check('the row is fenced off from the exercise settings', row().fenced === true);
check('...under a heading that says it leaves the room',
  /LEAVES THE ROOM/.test(row().heading ?? ''));
eq('...and it is the last row on the panel',
  setupCells(d).at(-1)!.label, 'LIVE BRAINS (CAREER)');
check('...so no exercise setting sits below it',
  setupCells(d).filter((c) => c.fenced).length === 1);

// step to a named policy: one arrow key, and it is the whole galaxy
d.live = 'pirate-attack-t29';
eq('a picked policy reads back on the row', row().value, 'PIRATE-ATTACK-T29');
eq('...and is the selection the game would fly',
  JSON.stringify(liveSelectionOf(d)), '{"t29":true}');
check('...and the fenced note says it outlives the exercise',
  /LIVE BRAINS: THE WHOLE GALAXY FLIES PIRATE-ATTACK-T29/.test(careerNote(d).text));
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
  .find((c) => c.label.replace(/&nbsp;/g, '') === 'BRAIN');
check('a group left on "as the game flies" names the LIVE brain, not the shipped one',
  !!hint && hint.value.includes('pirate-attack-t29'));
eq('...and that is the brain the spec carries',
  specFrom(d, 1).custom![0].brain, 'pirate-attack-t29');

// a console-set combination the picker cannot name is SAID, not guessed
d.live = null;
eq('a selection only the console can make says so', row().value, 'SET FROM THE CONSOLE');
check('...in the fenced note too', /SET FROM THE CONSOLE/.test(careerNote(d).text));
eq('...and that is a warning as well', careerNote(d).warning, true);
check('...and it fits the reserved space',
  careerNoteReserve().length >= careerNote(d).text.length);
row().change!(1);
check('...and one arrow key takes it back', d.live !== null);
}
