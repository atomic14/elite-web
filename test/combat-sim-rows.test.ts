// What a setup row READS AS: the answer to the question the row asks.
//
// The one file about a row's VALUE rather than the panel's shape
// (combat-sim-panel.test.ts) or the draft the rows are built from
// (combat-sim.test.ts). It exists because the same fault was found twice in the
// brain column: a row read `PIRATE-ATTACK-T29`, a build artefact rather than a
// way to fly (TODO 41). The fix was wording, not behaviour, and this pins it.
//
// The custom-opposition builder and its per-group rows are gone (the panel was
// too complex — Chris), so the only brain row left is PIRATES FLY. Everything
// here is pure — `setupCells()` and the notes are functions of a draft — so
// what a pilot would read is asserted under node with no browser.

import { check, eq } from './harness.ts';
import { readFileSync } from 'node:fs';
import { newCommander } from '../src/game/commander.ts';
import {
  PIRATE_CHOICES, freshDraft, setupCells,
} from '../src/game/screens/combat-sim-setup.ts';
import { brainNote, brainNoteReserve } from '../src/game/screens/combat-sim-notes.ts';
import { brainName, isNamedBrain } from '../src/game/brain-names.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- the PIRATES FLY row says what the pirates DO ----------------------------
//
// The line under the row follows the CURSOR rather than the draft, so it gets
// its own reserved block: the help above holds one slot for the mode and one
// for the fight, and a line that came and went with the cursor would land in
// either.

console.log('\ncombat simulator — the pirate-brain row says what it does');
{
  const d = freshDraft(newCommander());
  const cells = setupCells(d);
  const pirates = () => setupCells(d)
    .find((c) => c.label.replace(/&nbsp;/g, '') === 'PIRATES FLY')!;

  // Exactly one row names a brain — the line is contextual help for THIS row,
  // not a fourth line of the fight's help.
  const named = cells.filter((c) => c.brain !== undefined).map((c) => c.label.trim());
  eq('one row carries a brain, and nothing else does', named.join(' / '), 'PIRATES FLY');
  check('...and it has something to say about it', !!brainNote(pirates().brain));

  // THE row's value is the NAME, not the file — the fault this file exists for.
  const primary = (v: string): string => v.replace(/<span class="stem">.*?<\/span>/, '').trim();
  for (const choice of PIRATE_CHOICES) {
    while (pirates().brain !== choice) pirates().change!(1);
    check(`${choice} reads as its name, not a filename`,
      !/[a-z]/.test(primary(pirates().value)));
    check(`...the name it was given (${brainName(choice)})`,
      primary(pirates().value).includes(brainName(choice)!));
    check(`...the file stem is out of the value entirely (${choice})`,
      !pirates().value.includes(choice));
    check('...but reachable at the end of the note',
      (brainNote(pirates().brain) ?? '').includes(choice.toUpperCase()));
  }

  check('the file stem is quietened by the stylesheet rather than left out',
    /#screen \.stem \{ opacity: 0\.45;/.test(read('src/style.css')));

  // Held open whether or not there is a line in it, like every note block.
  const over = PIRATE_CHOICES.filter((id) => (brainNote(id) ?? '').length > brainNoteReserve().length);
  check('the reserve is an upper bound on every line it can hold', over.length === 0);
  check('...and it is one of them, not padding',
    PIRATE_CHOICES.some((id) => brainNote(id) === brainNoteReserve()));
  check('every pirate choice is a real named brain',
    PIRATE_CHOICES.every(isNamedBrain));
  check('the renderer holds that space whether the line is there or not',
    /reservedNotes\(p\.brainNote \? \[p\.brainNote\] : \[\], \[p\.brainReserve\]/
      .test(read('src/ui/screens.ts')));
}
