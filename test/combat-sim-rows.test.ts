// What a setup row READS AS: the answer to the question the row asks.
//
// The sixth combat-trainer file, and the only one about a row's VALUE rather
// than the panel's shape (combat-sim-panel.test.ts) or the draft the rows are
// built from (combat-sim.test.ts). It exists because the same fault has now been
// found twice in this column: a brain row read `PIRATE-ATTACK-T29`, which is a
// build artefact rather than a way to fly (TODO 41), and the missiles row read
// `HULL (0)`, which is a SETTING and the VALUE that setting gives welded into
// one string with nothing saying which half is which (TODO 69). Both times the
// row's value was an implementation detail on a screen where a pilot is choosing
// between options; both times the fix was wording, not behaviour.
//
// Everything here is pure — `setupCells()` and the notes are functions of a
// draft — so what a pilot would read is asserted under node with no browser. The
// standing rule the blocks below share: a row is read on its own, so anything it
// needs in order to be understood has to be IN it or in the one note underneath
// it, and nothing may be inferred from having watched it change.

import { check, eq } from './harness.ts';
import { readFileSync } from 'node:fs';
import { newCommander } from '../src/game/commander.ts';
import { simHulls } from '../src/game/combat-sim-scenarios.ts';
import { defaultGroup, freshDraft, setupCells } from '../src/game/screens/combat-sim-setup.ts';
import { brainNote, brainNoteReserve } from '../src/game/screens/combat-sim-notes.ts';
import {
  AS_SHIPPED, AS_THE_GAME_FLIES, BRAINS, brainName, isNamedBrain,
} from '../src/game/brain-names.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- a brain row says what the brain DOES ------------------------------------
//
// The row said PIRATE-ATTACK-T29 and nothing else, which is a filename. The line
// under the panel follows the CURSOR rather than the draft, so it gets its own
// reserved block: the help above it holds one slot for the mode and one for the
// fight, and a line that came and went with the cursor would land in either.

console.log('\ncombat simulator — a brain row says what it does');
{
  const d = freshDraft(newCommander());
  d.groups.push(defaultGroup(1));
  const cells = setupCells(d);
  const cell = (label: string) =>
    cells.find((c) => c.label.replace(/&nbsp;/g, '') === label)!;

  // Every row that names a brain offers one, and no other row does — the line
  // is contextual help for THIS row, not a fourth line of the fight's help.
  const named = cells.filter((c) => c.brain !== undefined).map((c) => c.label.trim());
  eq('the three brain rows carry a brain, and nothing else does',
    named.map((l) => l.replace(/&nbsp;/g, '')).join(' / '),
    'COMBAT COMPUTER BRAIN (THIS FIGHT) / THIS GROUP FLIES / COMBAT COMPUTER BRAINS');
  check('...and each of them has something to say about it',
    cells.filter((c) => c.brain !== undefined).every((c) => !!brainNote(c.brain)));

  // A group left on "as the game flies" will fly a real policy, so the line
  // describes THAT one rather than the sentinel.
  check('a group on "as the game flies" describes the brain it resolves to',
    brainNote(cell('THIS GROUP FLIES').brain) === brainNote('scripted'));
  cell('THIS GROUP FLIES').change!(1);
  const picked = setupCells(d)
    .find((c) => c.label.replace(/&nbsp;/g, '') === 'THIS GROUP FLIES')!;
  // Read off `brain`, not scraped out of the value with a regex: the value used
  // to end in `(pirate-attack-g3)` and the stem is in the note now, so a test
  // that parses the display was testing the formatting.
  check('...and a picked one describes itself',
    brainNote(picked.brain) === brainNote(picked.brain!));

  // THE row's value is the NAME, not the file. A sentence under the row could
  // not fix a row whose value was `pirate-attack-t29`: the thing being chosen
  // between still read as build artefacts. The stem is still there — second, and
  // in a face the stylesheet quietens — for anyone reading the training log.
  const primary = (v: string): string => v.replace(/<span class="stem">.*?<\/span>/, '').trim();
  const filenames = setupCells(d).filter((c) => c.brain !== undefined)
    .filter((c) => /[a-z]/.test(primary(c.value)));
  check('no brain row reads as a filename first', filenames.length === 0,
    filenames.map((c) => c.value).join(', '));
  check('...it reads as the name the brain was given',
    setupCells(d).filter((c) => c.brain !== undefined)
      .every((c) => primary(c.value).includes(brainName(c.brain!)!)));
  // ...and the file is NOT in the value at all. It was appended in a quieter
  // face, which still put a build artefact in the column a pilot reads to make
  // the choice; it is at the end of the note now.
  check('...and the file stem is out of the value entirely',
    setupCells(d).filter((c) => c.brain !== undefined && isNamedBrain(c.brain))
      .every((c) => !c.value.includes(c.brain!)));
  check('...but still reachable, at the end of the note',
    setupCells(d).filter((c) => c.brain !== undefined && isNamedBrain(c.brain))
      .every((c) => (brainNote(c.brain) ?? '').includes(c.brain!.toUpperCase())));
  check('...quietened by the stylesheet rather than by being left out',
    /#screen \.stem \{ opacity: 0\.45;/.test(read('src/style.css')));

  // Held open whether or not there is a line in it, like every other note block.
  const over = [...Object.keys(BRAINS), AS_THE_GAME_FLIES, AS_SHIPPED]
    .filter((id) => (brainNote(id) ?? '').length > brainNoteReserve().length);
  check('the reserve is an upper bound on every line it can hold',
    over.length === 0, over.join(', '));
  check('...and it is one of them, not padding',
    [...Object.keys(BRAINS), AS_THE_GAME_FLIES, AS_SHIPPED]
      .some((id) => brainNote(id) === brainNoteReserve()));
  const screens = read('src/ui/screens.ts');
  check('the renderer holds that space whether the line is there or not',
    /reservedNotes\(p\.brainNote \? \[p\.brainNote\] : \[\], \[p\.brainReserve\]/.test(screens));
}

// --- a delegated row says what it is doing, not just what that gives ---------
//
// TODO 69. `MISSILES → HULL (0)` was the row's MODE ("leave it to the hull") and
// the VALUE that mode currently gives, in one string, with nothing saying which
// half was which — and on a hull that carries none it read like a broken
// interpolation. `null` is a real state and stays, because "whatever this hull
// carries" is not "zero" and it stays right when the hull row above changes, so
// the wording changed instead: the mode is words, the number after it is a
// consequence, and a value that was SET is a bare number. That last is what
// makes arrowing off `null` and back a VISIBLE return rather than a silent one.

console.log('\ncombat simulator — a delegated row says what it is doing');
{
  const hulls = simHulls();
  const d = freshDraft(newCommander());
  d.groups.push(defaultGroup(1));
  const g = d.groups[0];
  const rows = ['MISSILES', 'E.C.M.'];
  const cell = (label: string) =>
    setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === label)!;
  const reading = (): string => rows.map((r) => cell(r).value).join(' / ');
  const pirate = (name: string): number =>
    hulls.findIndex((h) => h.role === 'pirate' && h.name === name);

  // A Python carries two missiles and a 60% e.c.m. chance; a Krait carries
  // neither (src/game/ship-specs.ts). Those are the two readings the old
  // wording could not tell apart from a setting.
  g.hull = pirate('Python');
  eq('a delegated row names the mode, then what the hull gives',
    reading(), 'FROM THE HULL — 2 / FROM THE HULL — 60%');
  g.hull = pirate('Krait');
  const delegated = reading();
  eq('...and a hull that carries none says NONE rather than 0',
    delegated, 'FROM THE HULL — NONE / FROM THE HULL — NONE');

  // The acceptance criterion: a reader who has never seen the panel can tell a
  // row that was set from a row that was left alone, with nothing else to go on.
  g.missiles = 0; g.ecm = 0;
  const zero = reading();
  eq('a value that was SET is a bare number', zero, '0 / 0%');
  check('...so a delegated none and an explicit zero cannot be read for each other',
    zero !== delegated);
  g.missiles = 2; g.ecm = 0.6;
  eq('...and a set non-zero says only itself', reading(), '2 / 60%');

  // Arrowing off `null` steps into an explicit number and back — `nudgeOrHull`'s
  // step, unchanged. What is asserted here is that the RETURN shows.
  g.missiles = null; g.ecm = null;
  for (const r of rows) cell(r).change!(1);
  eq('one RIGHT off the delegated state is an explicit zero', reading(), zero);
  for (const r of rows) cell(r).change!(-1);
  eq('...and one LEFT comes visibly back to the hull\'s own', reading(), delegated);
  check('...as the draft\'s null, not as a number that happens to match',
    g.missiles === null && g.ecm === null);
  for (const r of rows) cell(r).change!(-1);
  eq('...and LEFT off it the other way is the top of the range',
    reading(), '8 / 100%');

  // Every hull in the roster, because the reading is the HULL's: none of them
  // may read `HULL (n)`, and none may be wider than the column the panel already
  // paints — a row that wrapped or truncated would be worse than the bug.
  const width = (v: string): number => v.replace(/&nbsp;/g, ' ').length;
  g.hull = pirate('Python'); g.missiles = null; g.ecm = null;
  const column = Math.max(...setupCells(d)
    .filter((c) => !rows.includes(c.label.replace(/&nbsp;/g, '')))
    .map((c) => width(c.value)));
  const bad: string[] = [];
  let longest = 0;
  for (let h = 0; h < hulls.length; h++) {
    g.hull = h;
    for (const c of setupCells(d)) {
      if (/HULL \(/.test(c.value)) bad.push(`${hulls[h].name}: ${c.value}`);
    }
    for (const r of rows) {
      longest = Math.max(longest, width(cell(r).value));
      if (width(cell(r).value) > column) bad.push(`${hulls[h].name}: ${cell(r).value}`);
    }
  }
  check(`no hull reads HULL (n), and the widest delegated reading (${longest})`
    + ` fits the column the panel already paints (${column})`,
  bad.length === 0, bad.join(', '));
}
