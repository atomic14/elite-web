// The training simulator's front of house: T, the exercise's own table, and the
// draft the picker builds.
//
// The first file of the `test/run.ts` split (see test/harness.ts). It covers the
// half of stage 6 that a browser is not needed for, which is nearly all of it:
// the bindings are a table over a two-method input, and the setup panel is a
// pure function from a draft to a list of rows.
//
// The checks at the bottom used to be "the other two homes of a key binding",
// because an audit found 13 disagreements between the four places CLAUDE.md's
// key-bindings invariant listed — `B` for the distress beacon, which costs you
// your cargo, appeared in no help panel at all. Those homes are down to one
// each now (docs/TODO/50): the menu and the panel's rows are painted from
// `BINDINGS` + `COMMAND_HELP`, and `test/key-help.test.ts` asserts the general
// claim in both directions. What is left here is the trainer's own claim on
// those surfaces.

import { readFileSync } from 'node:fs';
import { hasShipDef, shipDisplayName } from '../src/ships/registry.ts';

import { check, eq, cmds, eqc } from './harness.ts';
import {
  BINDINGS, NOT_IN_THE_SIMULATOR, type Command, type ControlMode,
} from '../src/game/controls.ts';
import { newCommander, MAX_MISSILES } from '../src/game/commander.ts';
import {
  SCENARIOS, SIM_BRAINS, clampTier, liveBrainFor, simHulls, type BrainId,
} from '../src/game/combat-sim-scenarios.ts';
import {
  MODES, brainOverride, defaultGroup, fitFrom,
  freshDraft, freshSeed, nudgeOrHull, setupCells, specFrom,
} from '../src/game/screens/combat-sim-setup.ts';
import { AS_THE_GAME_FLIES } from '../src/game/brain-names.ts';
import { draftNotes } from '../src/game/screens/combat-sim-notes.ts';
import { dockedMenuHtml, guideSections, guideTableHtml } from '../src/ui/key-help.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- T, in the two homes that are code --------------------------------------

console.log('\ncombat simulator — the T key');
{
  eqc('T opens the simulator from the docked menu',
    cmds('docked', ['KeyT']), ['openCombatSim']);
  // The per-mode convention, and the reason T is free to mean two things: C is
  // contracts docked and the docking computer in flight, M is the market docked
  // and launch-missile in flight. This is the check that says adding T to the
  // station menu did not take the missile key off the cockpit.
  eqc('...and still arms a missile in flight', cmds('flight', ['KeyT']), ['armMissile']);
  eqc('...and in an exercise too, which is ordinary flight',
    cmds('simulator', ['KeyT']), ['armMissile']);
  eqc('T does nothing in the erase-your-career confirmation',
    cmds('confirmNewGame', ['KeyT']), []);
  eqc('...nor after you have been destroyed', cmds('dead', ['KeyT']), []);
}

// --- the simulator's table is flight, minus every way out --------------------

console.log('\ncombat simulator — the simulator binding table');
{
  const commandsIn = (mode: ControlMode): Command[] =>
    BINDINGS[mode].map((b) => b.command);
  const sim = commandsIn('simulator');

  // An arena you can leave is not an arena. Each of these is asserted by NAME
  // rather than by iterating NOT_IN_THE_SIMULATOR, which would only prove the
  // filter runs over its own list.
  for (const escape of [
    'startHyperspace', 'galacticJump', 'distressBeacon', 'jettison1', 'jettison5',
    'toggleDockingComputer',
  ] as const) {
    check(`the simulator has no ${escape}`, !sim.includes(escape));
    check(`...and the cockpit still does (the control)`,
      commandsIn('flight').includes(escape));
  }
  eq('...and that is exactly the list controls.ts states',
    [...NOT_IN_THE_SIMULATOR].sort().join(','),
    ['distressBeacon', 'galacticJump', 'jettison1', 'jettison5', 'startHyperspace',
      'toggleDockingComputer'].sort().join(','));

  // Everything else is kept: an exercise is meant to be the real ship.
  for (const kept of [
    'view0', 'view1', 'view2', 'view3',
    'armMissile', 'launchMissile', 'disarmMissile',
    'fireEcm', 'detonateEnergyBomb', 'toggleCombatComputer',
    'toggleMouseFlight', 'toggleTorus',
  ] as const) {
    check(`the simulator keeps ${kept}`, sim.includes(kept));
  }
  check('the four views are still independent, so 2 and E work in one frame',
    BINDINGS.simulator.filter((b) => b.independent).length === 4);
  eqc('a view key does not swallow the frame in an exercise',
    cmds('simulator', ['Digit2', 'KeyE']), ['view1', 'fireEcm']);

  eqc('Escape ends the exercise', cmds('simulator', ['Escape']), ['endExercise']);
  eqc('...and so does Q, for a keyboard whose Escape the browser claimed',
    cmds('simulator', ['KeyQ']), ['endExercise']);
  eqc('H is inert in an exercise rather than starting a countdown to nowhere',
    cmds('simulator', ['KeyH']), []);
  eqc('...⇧H too', cmds('simulator', ['KeyH'], ['ShiftLeft']), []);
  eqc('Y cannot jettison a hold the clone does not have',
    cmds('simulator', ['KeyY']), []);

  // The table is a key map, so a collision is a lost command. Over every mode,
  // because a mode was added and the written-out list in run.ts did not know.
  for (const mode of Object.keys(BINDINGS) as ControlMode[]) {
    const seen = new Set<string>();
    const clash = BINDINGS[mode].filter((b) => {
      const id = `${b.key}:${b.shift ?? '?'}`;
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
    check(`no two ${mode} bindings claim the same key and modifier`,
      clash.length === 0, clash.map((b) => b.key).join(','));
  }
  // These two used to grep game.ts for `case '<command>'`, because a `switch`
  // with a missing case falls through and the key silently does nothing. The
  // dispatch is a `Record<Command, () => void>` now, so the COMPILER refuses a
  // command with no entry and the grep is redundant — but a grep for the entry
  // still earns its keep by catching the reverse: an entry that exists and is
  // wired to nothing.
  const gameSrc = read('src/game/game.ts');
  const wired = (c: string): boolean =>
    new RegExp(`^\\s*${c}: \\(\\) => \\S`, 'm').test(gameSrc);
  check('every simulator command is wired to something in game.ts',
    sim.concat('endExercise').every(wired),
    sim.concat('endExercise').filter((c) => !wired(c)).join(', '));
  check('...and so is openCombatSim', wired('openCombatSim'));
}

// --- how a player is told the trainer is there -------------------------------

console.log('\ncombat simulator — what the help surfaces say about it');
{
  // These used to be "the other two homes of a key binding", read out of
  // play.html and the menu markup by hand. Two of those homes are gone
  // (docs/TODO/50): the menu and the panel rows are PAINTED from the binding
  // table by ui/key-help.ts, and test/key-help.test.ts asserts that generally,
  // in both directions. What is left here is the trainer's own claim on those
  // surfaces — that T is offered, and that it says what it opens.
  const menu = dockedMenuHtml();
  check('the docked menu offers T', menu.includes('data-key="KeyT"'));
  check('...labelled as the combat trainer', /KeyT"><b>T<\/b> COMBAT TRAINING/.test(menu));
  check('...and the table really answers it', BINDINGS.docked
    .some((b) => b.key === 'KeyT' && b.command === 'openCombatSim'));

  const help = read('play.html');
  check('play.html mentions the simulator', /COMBAT SIMULATOR/i.test(help));
  check('...and hosts the rows for the keys it adds', help.includes('id="help-simulator"'));
  check('...with a T row in the DOCKED table',
    /<tr><td>T<\/td><td>combat training simulator/.test(guideTableHtml(BINDINGS.docked)));
  const exercise = guideSections().find((s) => s.id === 'help-simulator');
  check('...and the exercise\'s own keys, including how to get out of it',
    exercise !== undefined
    && /ESC \/ Q<\/td><td>end the exercise/.test(guideTableHtml(exercise.bindings)));

  // The README, which is still written by hand.
  const readme = read('README.md');
  check('the README table has a T row', /\|\s\*\*T\*\*\s\|/.test(readme));
  check('...saying what it opens', /combat training simulator/i.test(readme));
  check('...and that nothing in it reaches the career',
    /nothing that happens in it leaves it/i.test(readme));
}

// --- the draft the picker builds --------------------------------------------

console.log('\ncombat simulator — the setup draft');
{
  const draft = freshDraft(newCommander());
  eq('a fresh draft is a single pirate, scored', draft.mode, 'scenario');
  eq('...at the tier the balance figures are quoted at', draft.tier, 1);
  eq('...on a random seed, so two launches are two fights', draft.seed, null);
  eq('...against the scenario table rather than a hand-built fight',
    draft.groups.length, 0);
  eq('...flying whatever the live game flies', draft.brain, AS_THE_GAME_FLIES);
  eq('...and it starts from the ship you actually own',
    draft.fit.laser, newCommander().equipment.laser);
  // FIT ONLY, and the list is exact so a hull, a bay or a galactic drive cannot
  // arrive here by being added to `Equipment`. `combatComputer` is the newest
  // and belongs for the same reason the rest do: it changes how the FIGHT goes,
  // and it is the one brain the game flies on your behalf rather than at you —
  // fit it, launch, press K, and the trained defence policy is watchable
  // instead of only measurable.
  eq('the fit-out is FIT ONLY — the hull is not offered',
    Object.keys(fitFrom(draft).equipment ?? {}).sort().join(','),
    'combatComputer,ecm,energyBomb,energyUnit,laser,rearLaser');

  // Every row round-trips: a cell reads the draft, and its change() writes it.
  const cells = setupCells(draft);
  check('every row has a label and a reading', cells.every((c) => !!c.label && !!c.value));
  check('...and every row can be changed', cells.every((c) => !!c.change));
  const before = cells.map((c) => c.value).join('|');
  for (const c of cells) c.change!(1);
  check('...and changing all of them changes what the panel says',
    setupCells(draft).map((c) => c.value).join('|') !== before);

  // the modes, and the fights
  const d2 = freshDraft(newCommander());
  const modeRow = setupCells(d2)[0];
  const seen = new Set<string>();
  for (let n = 0; n < MODES.length; n++) {
    seen.add(d2.mode);
    setupCells(d2)[0].change!(1);
  }
  eq('the mode row cycles all three modes', seen.size, MODES.length);
  eq('...and comes back round', d2.mode, freshDraft(newCommander()).mode);
  eq('the mode row is the first one', modeRow.label, 'MODE');

  const d3 = freshDraft(newCommander());
  for (let n = 0; n < SCENARIOS.length; n++) setupCells(d3)[1].change!(1);
  eq('the fight row cycles every scenario and returns',
    d3.scenario, freshDraft(newCommander()).scenario);
  check('every scenario in the table is reachable, so none is dead data',
    SCENARIOS.length === 7 && SCENARIOS.every((s) => !!s.name && !!s.blurb));

  const d4 = freshDraft(newCommander());
  setupCells(d4)[2].change!(5);
  eq('the threat tier clamps at the top', d4.tier, clampTier(99));
  setupCells(d4)[2].change!(-9);
  eq('...and at the bottom', d4.tier, 0);

  // the seed: blank means random, and the last one is shown so it can be flown
  // again — docs/COMBAT-SIM.md asks for exactly that
  const d5 = freshDraft(newCommander());
  check('a blank seed reads as RANDOM', setupCells(d5)[3].value.startsWith('RANDOM'));
  d5.lastSeed = 4242;
  check('...and quotes the last one once there is one',
    setupCells(d5)[3].value.includes('4242'));
  setupCells(d5)[3].change!(1);
  eq('...which an arrow key adopts, so the same fight can be flown again',
    d5.seed, 4242);
  setupCells(d5)[3].change!(1);
  eq('...and then nudged', d5.seed, 4243);
  eq('the spec quotes the seed it was given', specFrom(d5, 99).seed, 99);
  check('a rolled seed is a positive integer, not a float or a clock',
    Number.isInteger(freshSeed()) && freshSeed() > 0);
  check('...and it does not come from the world rng, which the career owns',
    !read('src/game/screens/combat-sim-setup.ts').includes("from '../rng.ts'"));
}

// --- the custom picker ------------------------------------------------------

console.log('\ncombat simulator — the custom picker');
{
  const d = freshDraft(newCommander());
  // By LABEL, not by row index — setupCells' own comment is that a cell owns
  // its label, its reading and what an arrow does to it, so nothing switches on
  // a position. A test that counts rows breaks the moment one is inserted, and
  // says nothing true when it does.
  const cell = (label: string) =>
    setupCells(d).find((c) => c.label.replace(/&nbsp;/g, '') === label)!;
  const rows = setupCells(d).length;
  cell('OPPOSITION').change!(1);
  eq('the opposition row builds a group', d.groups.length, 1);
  eq('...seven rows of it', setupCells(d).length - rows, 7);
  cell('OPPOSITION').change!(-1);
  eq('...and drops the lot again', d.groups.length, 0);

  d.groups.push(defaultGroup(2));
  const hulls = simHulls();
  check('the hull roster is the whole roster that can fight',
    hulls.length > 8 && hulls.every((h) => hasShipDef(h.spec.designId)));
  check('...including the Constrictor, which a career meets once',
    hulls.some((h) => h.name === 'Constrictor'));
  check('the group row names its hull and its role',
    /\(pirate\)$/.test(cell('GROUP 1 HULL').value));
  for (let n = 0; n < hulls.length; n++) cell('GROUP 1 HULL').change!(1);
  eq('every hull is reachable and the list wraps', d.groups[0].hull, defaultGroup(2).hull);

  cell('COUNT').change!(3);
  eq('the count goes up', d.groups[0].count, 4);
  cell('COUNT').change!(-99);
  eq('...and never below one ship, which would be no fight', d.groups[0].count, 1);

  cell('ORGANISED — THEY FLY AS A GANG').change!(1);
  eq('a group can be made organised, which is the pack-policy lever',
    d.groups[0].organised, true);

  // fit: "whatever the hull carries" is a real value, not a zero
  const g = d.groups[0];
  eq('a group carries the hull\'s own missiles until told otherwise', g.missiles, null);
  check('...and says so', cell('MISSILES').value.startsWith('HULL'));
  cell('MISSILES').change!(1);
  eq('...then takes a number', g.missiles, 0);
  cell('MISSILES').change!(-1);
  eq('...and goes back to the hull past the end of the range', g.missiles, null);
  eq('nudgeOrHull walks off the top back to the hull', nudgeOrHull(8, 1, 0, 8), null);
  eq('...and off the bottom too', nudgeOrHull(0, -1, 0, 8), null);
  eq('...and enters the range from the right end', nudgeOrHull(null, -1, 0, 8), 8);

  cell('E.C.M.').change!(1);
  eq('E.C.M. is a chance, entered as a percentage', g.ecm, 0);

  const spec = specFrom(d, 7);
  check('the spec carries the custom opposition', (spec.custom ?? []).length === 1);
  eq('...with the hull pinned, which is what makes it custom',
    shipDisplayName(spec.custom![0].hull!.designId), simHulls()[g.hull].name);
  eq('...and the role that hull actually flies', spec.custom![0].role, simHulls()[g.hull].role);
  eq('...and the seed left to nextOpposition, which re-seeds per round',
    spec.custom![0].seed, 0);
}

// --- the brain override, which is the A/B rig ------------------------------

console.log('\ncombat simulator — the brain override');
{
  const d = freshDraft(newCommander());
  eq('no override by default: an exercise measures the game as shipped',
    brainOverride(d), null);
  eq('...so the spec carries no brain', specFrom(d, 1).brain, undefined);

  d.brain = 'scripted';
  eq('the exercise brain row is the override', brainOverride(d), 'scripted');
  eq('...and it reaches the spec', specFrom(d, 1).brain, 'scripted');
  check('every brain the picker offers is one the report can name',
    SIM_BRAINS.every((b) => typeof b === 'string' && b.length > 0));

  // The honest bit. Which policy a pirate flies is a GLOBAL flag in brains.ts,
  // so a per-group choice can only be honoured when every group agrees — and
  // when they do not the panel must SAY so rather than let the report disagree
  // with the picker.
  const mixed = freshDraft(newCommander());
  mixed.groups.push(defaultGroup(1), defaultGroup(1));
  mixed.groups[0].brain = 'pirate-attack-g3';
  mixed.groups[1].brain = 'scripted';
  eq('two groups asking for two brains cannot both fly', brainOverride(mixed), null);
  check('...and the panel says why',
    draftNotes(mixed).some((n) => /MIXED BRAINS CANNOT FLY/.test(n)));
  mixed.groups[1].brain = 'pirate-attack-g3';
  eq('...where two groups that agree do fly it', brainOverride(mixed), 'pirate-attack-g3');
  check('...and the complaint goes away',
    !draftNotes(mixed).some((n) => /MIXED BRAINS/.test(n)));

  const one = freshDraft(newCommander());
  one.groups.push(defaultGroup(1));
  eq('a group left on "as the game flies" asks for nothing',
    brainOverride(one), null);
  eq('...which for a lone pirate is the scripted attack run, what ships',
    liveBrainFor('pirate', false, 1) as BrainId, 'scripted');
  check('the notes always describe the mode', draftNotes(one).length >= 1);
}

// --- the fit-out override ---------------------------------------------------

console.log('\ncombat simulator — your own fit-out');
{
  const d = freshDraft(newCommander());
  const laserRow = setupCells(d).findIndex((c) => c.label === 'YOUR LASER');
  check('the fit-out rows come last, after the opposition', laserRow > 0);
  setupCells(d)[laserRow].change!(1);
  eq('the laser can be lent', d.fit.laser, 'beam');
  setupCells(d)[laserRow].change!(1);
  eq('...all the way up', d.fit.laser, 'military');
  eq('...and it reaches the fit', fitFrom(d).equipment?.laser, 'military');

  const missileRow = setupCells(d).findIndex((c) => c.label === 'YOUR MISSILES');
  setupCells(d)[missileRow].change!(99);
  eq('missiles cap at the rack size', d.fit.missiles, MAX_MISSILES);
  setupCells(d)[missileRow].change!(-99);
  eq('...and floor at none, which is a fight worth practising', d.fit.missiles, 0);
  eq('...and it reaches the fit', fitFrom(d).missiles, 0);

  for (const label of ['YOUR REAR LASER', 'YOUR E.C.M.', 'YOUR ENERGY UNIT',
    'YOUR ENERGY BOMB']) {
    const row = setupCells(d).find((c) => c.label === label)!;
    const was = row.value;
    row.change!(1);
    check(`${label} toggles`, setupCells(d).find((c) => c.label === label)!.value !== was);
  }
}

// --- the setup half stays browser-free -------------------------------------

console.log('\ncombat simulator — purity');
{
  // The draft is the half worth testing, and every assertion above runs under
  // node because of this. The screen itself is allowed the DOM: it paints, reads
  // a keyboard and downloads a file.
  for (const file of ['combat-sim-setup.ts', 'combat-sim-notes.ts']) {
    const src = read(`src/game/screens/${file}`)
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${file} does not reach for the browser`,
      !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
    check('...and does not reach for Math.random either, which src/game bans',
      !/Math\.random\b/.test(src));
  }
}
