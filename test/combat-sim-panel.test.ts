// The setup panel's SHAPE: three groups, one fence, and a height that holds.
//
// The fifth combat-trainer file, and the one about the panel as a thing to look
// at rather than a draft to build. It exists because the panel was thirteen rows
// in one flat column, every one the same weight — including the one row that is
// still set when you undock — so finding a setting meant reading rather than
// scanning, and a warning appearing mid-interaction moved the row out from under
// the cursor. What is here is the layout, the reserved heights, the way a long
// list is navigated and the keys the panel offers; what a row READS AS is a
// different question and is asserted in combat-sim-rows.test.ts.
//
// Everything here is pure: `setupCells()` and the notes are functions of a
// draft, so the shape can be asserted under node with no browser. The two rules
// worth keeping are that a group HEADING is never a row (the cursor and every
// `data-row` index the same list) and that the reserve is an upper bound on the
// notes for every draft, not just the one in front of you.

import { check, eq } from './harness.ts';
import { readFileSync } from 'node:fs';
import { newCommander } from '../src/game/commander.ts';
import {
  SCENARIOS, WAVE_SATURATION, WAVE_STEPS, waveOfStage,
} from '../src/game/combat-sim-scenarios.ts';
import {
  MODES, freshDraft, setupCells,
} from '../src/game/screens/combat-sim-setup.ts';
import {
  draftNotes, draftNotesReserve,
} from '../src/game/screens/combat-sim-notes.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- the panel has a shape --------------------------------------------------
//
// The groups are headings ON a row rather than entries in the list, because the
// cursor and every click index this list: a heading that could be selected
// would be a row that does nothing. The custom-opposition builder and the
// fenced career row are gone (the panel was too complex — Chris), so the shape
// is three plain groups.

console.log('\ncombat simulator — the panel has a shape');
{
  const d = freshDraft(newCommander());
  const headings = (): string[] => setupCells(d)
    .flatMap((c) => (c.heading ? [c.heading] : []));
  eq('the panel comes out in three groups',
    headings().join(' / '), 'THE FIGHT / WHO YOU FIGHT / YOUR SHIP');
  const opens = (h: string): string =>
    setupCells(d).find((c) => c.heading === h)!.label;
  eq('the fight group opens on the mode', opens('THE FIGHT'), 'MODE');
  eq('...who you fight opens on the row that says what the pirates fly',
    opens('WHO YOU FIGHT'), 'PIRATES FLY');
  eq('...and your ship on the laser', opens('YOUR SHIP'), 'YOUR LASER');

  // The order inside the fight group is unchanged, so muscle memory survives.
  eq('the fight group is still mode, fight, tier, seed',
    setupCells(d).slice(0, 4).map((c) => c.label).join(','),
    'MODE,FIGHT,THREAT TIER,SEED');

  // A heading is not a row. Every entry in the list is something the cursor can
  // land on and change — which is what makes `this.row` and `data-row` the same
  // index.
  check('every entry in the list is a row that does something',
    setupCells(d).every((c) => !!c.label && !!c.value && !!c.change));
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
      const notes = draftNotes(d);
      if (notes.length > reserve.length) over.push(`${mode}/${s}: too many`);
      notes.forEach((n, i) => {
        if (n.length > (reserve[i] ?? '').length) over.push(`${mode}/${s}[${i}]`);
        if (n.length === (reserve[i] ?? '').length) filled = true;
      });
    }
  }
  check('no draft says more than the reserve holds, slot for slot',
    over.length === 0, over.join(', '));
  check('...and the reserve is not padding: some draft fills every slot of it',
    filled);
}

// --- and a long list can be got to the end of -------------------------------
//
// Twelve brains and forty-odd hulls, one value per key press, with no way to see
// the list or tell that it had wrapped. The position says where you are; HOME
// and END are the way to either end without walking.

console.log('\ncombat simulator — a long list is navigable');
{
  const d = freshDraft(newCommander());
  const cell = (label: string) =>
    setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === label)!;

  const rows = ['PIRATES FLY'];
  for (const label of rows) {
    check(`${label} says where in the list it is`,
      /^\(\d+ OF \d+\) /.test(cell(label).value));
  }

  // How many options a row offers, read off its `(n OF m)` prefix.
  const listLength = (v: string) => Number(/^\(\d+ OF (\d+)\)/.exec(v)?.[1] ?? 0);
  const at = (v: string) => Number(/^\((\d+) OF/.exec(v)?.[1] ?? 0);

  // Stepping through a full list and back returns to where it started — the
  // acceptance criterion, and the thing a wrapping list has to do.
  for (const label of rows) {
    const was = cell(label).value;
    const len = listLength(was);
    for (let n = 0; n < len; n++) cell(label).change!(1);
    eq(`${label} comes back round after a full lap`, cell(label).value, was);
    for (let n = 0; n < len; n++) cell(label).change!(-1);
    eq(`...and back the other way`, cell(label).value, was);
  }

  // ...and both ends are one key away.
  for (const label of rows) {
    cell(label).jump!(1);
    const len = listLength(cell(label).value);
    eq(`END is the last value of ${label}`, at(cell(label).value), len);
    cell(label).jump!(-1);
    eq(`...and HOME is the first`, at(cell(label).value), 1);
  }
  check('a row over a number has no end to jump to, so it has no jump',
    !cell('SEED').jump && !cell('YOUR MISSILES').jump);

  // HOME and END are the SCREEN's own keys rather than `BINDINGS` commands, so
  // nothing generates the places they are written down (docs/TODO/50 covers the
  // ones that are). These are the four: the screen, the hint, the ? panel and
  // the README.
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
// README. It is a screen key rather than a `BINDINGS` command, so it is written
// down by hand in each of those — CLAUDE.md's key-bindings invariant asks for
// one home and generated surfaces, and a screen key cannot have that yet, so
// these checks are what stands in for it.

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

// --- the waves mode says what it will do to you, and how you did last time ---
//
// TODO 39: the ramp keeps escalating past wave 11, so the panel has to say so
// before you launch — a pilot deciding whether to fly one needs to know that it
// has a top and that the top is not simply more ships. And a run needs a result
// worth coming back to, which is the furthest wave the commander has ever
// reached: state, saved with the commander, and shown HERE and nowhere else.

console.log('\ncombat simulator — the waves mode says where it stops');
{
  const c = newCommander();
  const d = freshDraft(c);
  d.mode = 'waves';
  const note = () => draftNotes(d).join(' ');

  check('a commander who has never flown one is told so',
    /NOT FLOWN ONE YET/.test(note()) && c.furthestWave === 0);

  d.furthestWave = 13;
  check('...and one who has sees their best', /YOUR FURTHEST: WAVE 13/.test(note()));
  eq('the draft reads the best off the COMMANDER rather than keeping its own',
    freshDraft({ ...c, furthestWave: 9 }).furthestWave, 9);

  // Derived from the step table, not typed out: a second copy of "missiles at
  // 12" is a second copy that goes wrong the day the cadence moves.
  const said = note();
  check(`every step is named with the wave it arrives at `
    + `(${WAVE_STEPS.map((s) => s.name).join(', ')})`,
  WAVE_STEPS.every((s, i) => said.includes(`${s.name} AT ${waveOfStage(i + 1)}`)));
  check(`...and so is where it stops (${WAVE_SATURATION})`,
    said.includes(`NO HARDER FROM ${WAVE_SATURATION} ON`));
  check('the other two modes say none of it — nothing escalates in them',
    !/NO HARDER FROM/.test(draftNotes({ ...d, mode: 'sparring' }).join(' '))
    && !/FURTHEST/.test(draftNotes({ ...d, mode: 'scenario' }).join(' ')));

  // ...and the report says it afterwards, which is the other half: an
  // escalation the pilot can only infer from losing is not a visible one.
  const report = read('src/ui/screens.ts');
  check('the report paints the escalation the record carries',
    /r\.escalation \? escalation\(r\.escalation\) : ''/.test(report)
    && /SATURATES AT \$\{e\.saturatesAt\}/.test(report)
    && /NEW THIS WAVE/.test(report));
  check('...and the cockpit strip carries it while the wave is being flown',
    /strip\.escalation/.test(read('src/hud/hud.ts')));
}
