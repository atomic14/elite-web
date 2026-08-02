// The setup panel's SHAPE: three groups, one fence, and a height that holds.
//
// The fifth combat-trainer file, and the only one about the panel as a thing to
// look at rather than a draft to build. It exists because the panel was thirteen
// rows in one flat column, every one the same weight — including the one row
// that is still set when you undock — so finding a setting meant reading rather
// than scanning, and a warning appearing mid-interaction moved the row out from
// under the cursor.
//
// Everything here is pure: `setupCells()` and the notes are functions of a
// draft, so the shape can be asserted under node with no browser. The two rules
// worth keeping are that a group HEADING is never a row (the cursor and every
// `data-row` index the same list) and that the reserve is an upper bound on the
// notes for every draft, not just the one in front of you.

import { check, eq } from './harness.ts';
import { readFileSync } from 'node:fs';
import { newCommander } from '../src/game/commander.ts';
import { SCENARIOS } from '../src/game/combat-sim-scenarios.ts';
import {
  MODES, defaultGroup, freshDraft, setupCells,
} from '../src/game/screens/combat-sim-setup.ts';
import {
  brainNote, brainNoteReserve, careerNote, careerNoteReserve, draftNotes, draftNotesReserve,
} from '../src/game/screens/combat-sim-notes.ts';
import { AS_SHIPPED, BRAIN_CHARACTER } from '../src/game/brain-names.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- the panel has a shape --------------------------------------------------
//
// Thirteen rows in one flat column, every one the same weight, and finding one
// meant reading rather than scanning. The groups are headings ON a row rather
// than entries in the list, because the cursor and every click index this list:
// a heading that could be selected would be a row that does nothing.

console.log('\ncombat simulator — the panel has a shape');
{
  const d = freshDraft(newCommander());
  const headings = (): string[] => setupCells(d)
    .flatMap((c) => (c.heading ? [c.heading] : []));
  eq('the panel comes out in three groups and a fence',
    headings().join(' / '),
    'THE FIGHT / WHO FLIES WHAT / YOUR SHIP / THIS ONE LEAVES THE ROOM');
  const opens = (h: string): string =>
    setupCells(d).find((c) => c.heading === h)!.label;
  eq('the fight group opens on the mode', opens('THE FIGHT'), 'MODE');
  eq('...who flies what opens on the exercise brain',
    opens('WHO FLIES WHAT'), 'EXERCISE BRAIN');
  eq('...and your ship on the laser', opens('YOUR SHIP'), 'YOUR LASER');

  // The order inside a group is unchanged, so muscle memory survives.
  eq('the fight group is still mode, fight, tier, seed',
    setupCells(d).slice(0, 4).map((c) => c.label).join(','),
    'MODE,FIGHT,THREAT TIER,SEED');
  eq('...and the exercise brain is followed by the opposition, as it was',
    setupCells(d).map((c) => c.label).join(',')
      .includes('EXERCISE BRAIN,OPPOSITION'), true);

  // A heading is not a row. Every entry in the list is something the cursor can
  // land on and change — which is what makes `this.row` and `data-row` the same
  // index — so a group heading has to travel WITH a row.
  check('every entry in the list is a row that does something',
    setupCells(d).every((c) => !!c.label && !!c.value && !!c.change));

  // Adding a group extends WHO FLIES WHAT: it must not land under YOUR SHIP, and
  // it must not push the fenced row up into the exercise settings.
  d.groups.push(defaultGroup(1));
  eq('a custom group still lands before YOUR SHIP',
    headings().join(' / '),
    'THE FIGHT / WHO FLIES WHAT / YOUR SHIP / THIS ONE LEAVES THE ROOM');
  eq('...and the fenced row stays last',
    setupCells(d).at(-1)!.label, 'LIVE BRAINS (CAREER)');
}

// --- and it does not change height while you use it -------------------------
//
// Measured live: a note appearing pushed every row below it down about 17px,
// mid-interaction, and the selected row moved out from under the cursor. The
// renderer paints `draftNotesReserve()` invisibly under the live notes, so the
// block is always as tall as its worst case — which only works if the reserve
// really is an upper bound for every draft.

console.log('\ncombat simulator — the notes hold their own height');
{
  const reserve = draftNotesReserve();
  eq('the reserve has a slot for every note that can appear at once', reserve.length, 2);
  // Slot by slot, and by length: the panel is monospace at a fixed size, so a
  // slot that holds more characters than any draft can put in it holds more
  // lines too — which is the property the reservation actually needs.
  const over: string[] = [];
  let filled = false;
  const d = freshDraft(newCommander());
  for (const mode of MODES) {
    d.mode = mode;
    for (let s = 0; s < SCENARIOS.length; s++) {
      d.scenario = s;
      for (const groups of [0, 1, 2]) {
        d.groups = Array.from({ length: groups }, () => defaultGroup(1));
        if (groups === 2) {
          d.groups[0].brain = 'pirate-attack-r2';
          d.groups[1].brain = 'pirate-attack-g2';
        }
        const notes = draftNotes(d);
        if (notes.length > reserve.length) over.push(`${mode}/${s}/${groups}: too many`);
        notes.forEach((n, i) => {
          if (n.length > (reserve[i] ?? '').length) over.push(`${mode}/${s}/${groups}[${i}]`);
          if (n.length === (reserve[i] ?? '').length) filled = true;
        });
      }
    }
  }
  check('no draft says more than the reserve holds, slot for slot',
    over.length === 0, over.join(', '));
  check('...and the reserve is not padding: some draft fills every slot of it',
    filled);
  check('the career warning is NOT one of those notes — it has its own block',
    !draftNotes(d).some((n) => /THE WHOLE GALAXY FLIES/.test(n))
    && careerNote({ ...d, live: 'pirate-attack-t29' }).warning);

  // The fence holds its space either way, so it always has something in it: a
  // held box with a hole in it reads as a bug, not as a promise.
  check('the fence is never empty — the calm case says the calm thing',
    careerNote({ ...d, live: AS_SHIPPED }).text.length > 0
    && !careerNote({ ...d, live: AS_SHIPPED }).warning);
  check('...and it fits the space the warning reserves',
    careerNoteReserve().length >= careerNote({ ...d, live: AS_SHIPPED }).text.length);
  // Told apart without being read: the renderer picks the tone off `warning`.
  const screens = read('src/ui/screens.ts');
  check('the renderer paints a warning apart from a status',
    /careerNote\.warning \? 'note-warn' : 'note-calm'/.test(screens));
  check('...and the stylesheet gives the calm one a quiet green, not the red',
    /\.note-calm \{ color: var\(--hud-green\); opacity: 0\.5;/.test(read('src/style.css'))
    && /\.note-warn \{ color: var\(--hud-red\); \}/.test(read('src/style.css')));
}

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
    'EXERCISE BRAIN / BRAIN / LIVE BRAINS (CAREER)');
  check('...and each of them has something to say about it',
    cells.filter((c) => c.brain !== undefined).every((c) => !!brainNote(c.brain)));

  // A group left on "as the game flies" will fly a real policy, so the line
  // describes THAT one rather than the sentinel.
  check('a group on "as the game flies" describes the brain it resolves to',
    brainNote(cell('BRAIN').brain) === brainNote('pirate-attack-g3'));
  cell('BRAIN').change!(1);
  check('...and a picked one describes itself',
    brainNote(setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === 'BRAIN')!.brain)
      === brainNote(setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === 'BRAIN')!
        .value.replace(/^\d+\/\d+ /, '')));

  // Held open whether or not there is a line in it, like every other note block.
  const over = [...Object.keys(BRAIN_CHARACTER), 'live', AS_SHIPPED]
    .filter((id) => (brainNote(id) ?? '').length > brainNoteReserve().length);
  check('the reserve is an upper bound on every line it can hold',
    over.length === 0, over.join(', '));
  check('...and it is one of them, not padding',
    [...Object.keys(BRAIN_CHARACTER), 'live', AS_SHIPPED]
      .some((id) => brainNote(id) === brainNoteReserve()));
  const screens = read('src/ui/screens.ts');
  check('the renderer holds that space whether the line is there or not',
    /reservedNotes\(p\.brainNote \? \[p\.brainNote\] : \[\], \[p\.brainReserve\]/.test(screens));
}

// --- and a long list can be got to the end of -------------------------------
//
// Twelve brains and forty-odd hulls, one value per key press, with no way to see
// the list or tell that it had wrapped. The position says where you are; HOME
// and END are the way to either end without walking.

console.log('\ncombat simulator — a long list is navigable');
{
  const d = freshDraft(newCommander());
  d.groups.push(defaultGroup(1));
  const cell = (label: string) =>
    setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === label)!;

  for (const label of ['EXERCISE BRAIN', 'BRAIN', 'GROUP 1 HULL', 'LIVE BRAINS (CAREER)']) {
    check(`${label} says where in the list it is`, /^\d+\/\d+ /.test(cell(label).value));
  }

  // Stepping through a full list and back returns to where it started — the
  // acceptance criterion, and the thing a wrapping list has to do.
  for (const label of ['EXERCISE BRAIN', 'BRAIN', 'GROUP 1 HULL', 'LIVE BRAINS (CAREER)']) {
    const was = cell(label).value;
    const len = Number(was.split('/')[1].split(' ')[0]);
    for (let n = 0; n < len; n++) cell(label).change!(1);
    eq(`${label} comes back round after a full lap`, cell(label).value, was);
    for (let n = 0; n < len; n++) cell(label).change!(-1);
    eq(`...and back the other way`, cell(label).value, was);
  }

  // ...and both ends are one key away.
  for (const label of ['EXERCISE BRAIN', 'BRAIN', 'GROUP 1 HULL', 'LIVE BRAINS (CAREER)']) {
    cell(label).jump!(1);
    const len = Number(cell(label).value.split('/')[1].split(' ')[0]);
    eq(`END is the last value of ${label}`, cell(label).value.split(' ')[0], `${len}/${len}`);
    cell(label).jump!(-1);
    eq(`...and HOME is the first`, cell(label).value.split(' ')[0], `1/${len}`);
  }
  check('a row over a number has no end to jump to, so it has no jump',
    !cell('SEED').jump && !cell('COUNT').jump && !cell('YOUR MISSILES').jump);

  // The key lives in all four homes CLAUDE.md names — here, the hint, the ?
  // panel and the README.
  check('the screen reads HOME and END',
    /i\.pressed\('Home'\)/.test(read('src/game/screens/combat-sim.ts'))
    && /i\.pressed\('End'\)/.test(read('src/game/screens/combat-sim.ts')));
  check('...the footer hint names them', /HOME\/END ENDS OF LIST/.test(read('src/ui/screens.ts')));
  check('...so does the ? panel', /HOME \/ END/.test(read('play.html')));
  check('...and so does the README', /\*\*HOME\/END\*\*/.test(read('README.md')));
}

// --- and the keys it offers are named ---------------------------------------
//
// `L — LAST REPORT` was a button that appeared once a report existed and was
// named nowhere else: not in the footer hint, not in the `?` panel, not in the
// README. CLAUDE.md's key-bindings invariant is that a key lives in four homes
// and they change together, and a key you can only discover by noticing a
// button is in none of them.

console.log('\ncombat simulator — the panel names its keys');
{
  const screens = read('src/ui/screens.ts');
  const panel = screens.slice(screens.indexOf('export function renderCombatSimSetup'));
  check('the footer hint names L, which opens the last report',
    /L LAST REPORT/.test(panel));
  check('...only when there is one, like the button beside it',
    /hasReport \? \['L LAST REPORT'\]/.test(panel));
  // The hint used to wrap mid-item — "· X" on one line, "REMOVE ·" on the next.
  // Each item is its own element now and the separator belongs to the item it
  // precedes, so a break can only happen between two of them.
  check('the hint is items, not one string, so it breaks between them',
    /class="keyline hints"/.test(panel) && /hints\.map/.test(panel));
  check('...and the stylesheet is what refuses to break inside one',
    /\.hints span \{ white-space: nowrap; \}/.test(read('src/style.css')));

  check('the ? help panel names L too', /<tr><td>L<\/td><td>the last report/
    .test(read('play.html')));
  check('...and so does the README', /\*\*L\*\* re-opens the last report/
    .test(read('README.md')));
}
