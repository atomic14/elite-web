// Two records held against each other — and the refusal when they may not be.
//
// The comparison is DERIVED (docs/TODO/35-compare-two-records.md): no new
// accumulation, no new sampling, just a pure function of two finished records.
// So it is stated here the way test/combat-sim-report.test.ts states its
// medians — records built by hand, and the answer written out independently.
//
// The half worth reading is the REFUSAL. Subtracting two numbers is always
// possible and only sometimes meaningful, and a difference column over two
// different fights is a number that looks like a finding. Each case below
// changes exactly one thing about the fight's identity and asserts that the
// comparison names it and stops differencing — including the two the task
// singles out, a different wave and a different opponent count.

import { readFileSync } from 'node:fs';
import {
  compareReports, comparisonJson, type CompareRow, type SimComparison,
} from '../src/game/combat-sim-compare.ts';
import {
  CombatSimRecorder, COMBAT_SIM_SCHEMA,
  type CombatSimReport, type ExerciseSetup, type FrameSample,
} from '../src/game/combat-sim-report.ts';
import { NO_OPENING } from '../src/game/combat-sim-opening.ts';
import { CombatSimScreen } from '../src/game/screens/combat-sim.ts';
import { AS_SHIPPED } from '../src/game/brain-names.ts';
import { newCommander } from '../src/game/commander.ts';
import { Input } from '../src/engine/input.ts';
import { check, eq } from './harness.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// One exercise, flown to order. Everything below is two of these with one thing
// changed, which is what an A/B is.
const setup = (over: Partial<ExerciseSetup> = {}): ExerciseSetup => ({
  seed: 90210,
  scenario: 'Pirate pair',
  mode: 'scenario',
  sampleHz: 10,
  opening: NO_OPENING,
  player: {
    shipId: 'elite-a:player:7',
    laser: 'beam', missiles: 4, ecm: true, energyUnit: true, energyBomb: false,
  },
  opponents: [{
    hull: 'Sidewinder',
    designId: 'elite-a:design:17', profileId: 'elite-a:variant:D:17',
    brain: 'pirate-attack-g3', role: 'pirate', tier: 1,
  }],
  ...over,
});

const frame = (over: Partial<FrameSample> = {}): FrameSample => ({
  speed: 60, pitch: 0, roll: 0, foreShield: 255, aftShield: 255, energy: 255,
  contacts: [], ...over,
});

/**
 * A record with numbers in it: `shots` discharges, `hits` of which landed, and
 * one opponent sitting at `dist` at `speed` for ten sampled frames.
 */
function flown(
  over: Partial<ExerciseSetup>,
  { shots = 10, hits = 3, dist = 500, speed = 200, taken = 0 } = {},
): CombatSimReport {
  const rec = new CombatSimRecorder(setup(over));
  for (let i = 0; i < shots; i++) {
    rec.playerShot(i < hits ? { opponent: 0, damage: 10 } : null);
  }
  for (let i = 0; i < 10; i++) {
    rec.frame(frame({ contacts: [{ opponent: 0, dist, speed, theirAim: 0.05, yourAim: 0.05, doing: 'closing' }] }));
  }
  if (taken) rec.taken(taken, 'laser', 0);
  return rec.report('quit');
}

/** Rows are found by LABEL, never by index — the trainer's own test rule. */
const row = (c: SimComparison, label: string): CompareRow =>
  c.groups.flatMap((g) => g.rows).find((r) => r.label === label)!;
const differing = (c: SimComparison): string[] => c.confounds.map((f) => f.field);

// --- the A/B it exists for ---------------------------------------------------

console.log('\ncombat simulator — comparing two records');
{
  const a = flown({}, { shots: 10, hits: 3, dist: 500, speed: 200, taken: 20 });
  const b = flown({
    opponents: [{ ...setup().opponents[0], brain: 'scripted' }],
  }, { shots: 10, hits: 5, dist: 900, speed: 100, taken: 50 });
  const c = compareReports(a, b);

  eq('same seed, same fight, same ship — the pair is an A/B', c.comparable, true);
  eq('...with nothing to complain about', c.confounds.length, 0);
  eq('the brains are what changed, per opponent',
    c.brains.map((x) => `${x.hull}:${x.a}->${x.b}`).join(','),
    'SIDEWINDER:pirate-attack-g3->scripted');
  eq('...and it says they are not the same brain', c.brains[0].same, false);
  eq('...so it is not called a repeat', c.sameBrains, false);

  // The difference is THAT minus THIS, in the row's own unit, and the answer is
  // written out rather than recomputed from the records.
  eq('your accuracy, this and that', `${row(c, 'YOUR ACCURACY').a}/${row(c, 'YOUR ACCURACY').b}`,
    '30%/50%');
  eq('...differenced in percentage POINTS, not as a percentage of a percentage',
    row(c, 'YOUR ACCURACY').delta, '+20PP');
  eq('damage to you', row(c, 'DAMAGE TO YOU').delta, '+30.0');
  eq('the range they held', row(c, 'RANGE HELD (MEDIAN)').delta, '+400');
  eq('...and how fast they flew, which is the turret tell',
    row(c, 'THEIR SPEED (MEDIAN)').delta, '-100');
  eq('a row both records agree on says SAME rather than +0',
    row(c, 'YOUR SHOTS').delta, 'SAME');
  eq('...which is what makes the rows that DIVERGED the ones you see',
    row(c, 'YOUR SHOTS').a, '10');
  eq('an outcome is words, so there is no difference to take',
    row(c, 'OUTCOME').delta, null);
  eq('...but both are still stated', `${row(c, 'OUTCOME').a}/${row(c, 'OUTCOME').b}`,
    'QUIT/QUIT');
  eq('a statistic neither record measured differences to nothing',
    row(c, 'TIME TO LAST KILL').delta, '-');

  // The four groups, and what is deliberately not in them: this is a curated
  // reading, not a difference over every field on the record.
  eq('the reading is four groups',
    c.groups.map((g) => g.heading).join(' / '),
    'THE FIGHT / WHAT IT COST YOU / HOW YOU DID / HOW THEY FLEW');
  check('...and every row in them is a real field of the record',
    c.groups.every((g) => g.rows.length > 0)
    && c.groups.flatMap((g) => g.rows).length < 30);

  // Same setup twice is a legitimate thing to do — it is how you find out how
  // much of a difference is just the fight going differently — but it is not an
  // A/B, and saying so is not the same as refusing.
  const repeat = compareReports(a, flown({}, { hits: 6 }));
  eq('the same brains both times still compares', repeat.comparable, true);
  eq('...and says it is a repeat rather than an A/B', repeat.sameBrains, true);
}

// --- and the refusal ---------------------------------------------------------
//
// One changed field per case. Every one of these is a fight that is not the
// other fight, so a difference over it would be a fact about the setup wearing
// the clothes of a finding.

console.log('\ncombat simulator — a mismatched pair refuses');
{
  const base = flown({});
  const mismatch = (over: Partial<ExerciseSetup>): SimComparison =>
    compareReports(base, flown(over));

  const cases: [string, Partial<ExerciseSetup>, string, string][] = [
    ['a different seed is a different fight', { seed: 4242 }, 'SEED', '90210'],
    ['a different scenario', { scenario: 'Pirate gang' }, 'FIGHT', 'PIRATE PAIR'],
    ['a different mode', { mode: 'waves' }, 'MODE', 'SCENARIO'],
    ['a different WAVE of the same session', { wave: 3 }, 'WAVE', 'N/A'],
    ['a different laser on your own ship',
      { player: { ...setup().player, laser: 'pulse' } }, 'YOUR LASER', 'BEAM'],
    ['a different missile count',
      { player: { ...setup().player, missiles: 0 } }, 'YOUR MISSILES', '4'],
    ['a different hull under you',
      { player: { ...setup().player, shipId: 'elite-a:player:3' } },
      'YOUR HULL', 'elite-a:player:7'],
    ['more of them', {
      opponents: [setup().opponents[0], { ...setup().opponents[0] }],
    }, 'OPPONENTS', '1'],
    ['a different hull flying at you', {
      opponents: [{ ...setup().opponents[0], hull: 'Mamba', designId: 'elite-a:design:18' }],
    }, 'OPPONENT 1 HULL', 'SIDEWINDER (elite-a:design:17)'],
    ['a different BUILD of the same hull', {
      opponents: [{ ...setup().opponents[0], profileId: 'elite-a:variant:F:17' }],
    }, 'OPPONENT 1 BUILD', 'elite-a:variant:D:17'],
    ['a different threat tier', {
      opponents: [{ ...setup().opponents[0], tier: 2 }],
    }, 'OPPONENT 1 TIER', '1'],
    ['a different role', {
      opponents: [{ ...setup().opponents[0], role: 'police' }],
    }, 'OPPONENT 1 ROLE', 'pirate'],
  ];
  for (const [name, over, field, was] of cases) {
    const c = mismatch(over);
    eq(`${name} — refused`, c.comparable, false);
    eq(`...and the field is NAMED`, differing(c).includes(field), true);
    eq(`...with the value this record had`,
      c.confounds.find((f) => f.field === field)!.a, was);
    check('...and NO row carries a difference, so there is no column to misread',
      c.groups.flatMap((g) => g.rows).every((r) => r.delta === null));
  }

  // A record from before TODO 28 and one from after do not mean the same thing
  // by "damage" — the schema says so, and this is the only confound that is not
  // about the fight at all.
  const stale = { ...base, schema: COMBAT_SIM_SCHEMA - 1 };
  const c = compareReports(stale, base);
  eq('records either side of a schema change are not comparable', c.comparable, false);
  eq('...and it says which', differing(c).join(','), 'SCHEMA');

  // A count mismatch reports the count and stops. Four more lines per missing
  // ship would bury the one fact that matters.
  const counted = mismatch({ opponents: [setup().opponents[0], { ...setup().opponents[0] }] });
  eq('a count mismatch is reported once, not once per missing ship',
    differing(counted).join(','), 'OPPONENTS');
  eq('...and the brains still line up as far as they go',
    counted.brains.length, 2);
}

// --- the pair is the finding, so the pair exports ---------------------------

console.log('\ncombat simulator — the pair exports');
{
  const a = flown({});
  const b = flown({ opponents: [{ ...setup().opponents[0], brain: 'scripted' }] });
  const json = JSON.parse(comparisonJson(compareReports(a, b))) as {
    schema: number; kind: string; comparable: boolean;
    confounds: unknown[]; sameBrains: boolean;
    rows: { group: string; label: string; delta: string | null }[];
    records: CombatSimReport[];
  };
  eq('the pair carries a schema, like every other export', json.schema, COMBAT_SIM_SCHEMA);
  eq('...and says what it is', json.kind, 'combat-sim-pair');
  eq('...and whether it was an A/B at all', json.comparable, true);
  eq('BOTH whole records go in it, so nothing is lost to the rounding',
    json.records.length, 2);
  eq('...this one first', json.records[0].opponents[0].brain, 'pirate-attack-g3');
  eq('...that one second', json.records[1].opponents[0].brain, 'scripted');
  check('...and the reading beside them, each line saying which group it is in',
    json.rows.length > 10 && json.rows.every((r) => !!r.group && !!r.label));

  const refused = JSON.parse(comparisonJson(compareReports(a, flown({ seed: 7 })))) as {
    comparable: boolean; confounds: { field: string }[];
    rows: { delta: string | null }[];
  };
  eq('a refused pair exports too — the refusal is data', refused.comparable, false);
  eq('...with the reason in it', refused.confounds[0].field, 'SEED');
  check('...and not one difference anywhere in the file',
    refused.rows.every((r) => r.delta === null));
}

// --- and it is reachable from the report, without leaving it ----------------
//
// The acceptance criterion, driven rather than read: the real screen, the real
// Input, and the HTML it actually paints. The DOM is a capture object — the same
// trick test/combat-sim.test.ts uses on the docked menu — so this runs under
// node with no browser.

console.log('\ncombat simulator — the compare panel, driven');
{
  const painted: string[] = [];
  const globals = globalThis as unknown as { document?: unknown };
  const had = 'document' in globals;
  const previous = globals.document;
  globals.document = {
    getElementById: () => ({
      set innerHTML(html: string) { painted.push(html); },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    }),
    body: { classList: { add: () => {}, remove: () => {} } },
  };

  const said: string[] = [];
  const reports: CombatSimReport[] = [
    flown({}, { hits: 3 }),
    flown({ opponents: [{ ...setup().opponents[0], brain: 'scripted' }] }, { hits: 7 }),
  ];
  const screen = new CombatSimScreen(() => ({
    commander: newCommander(),
    reports,
    begin: () => true,
    message: (text: string) => said.push(text),
    liveBrain: AS_SHIPPED,
    selectLiveBrain: () => {},
  }));
  const press = (code: string): void => {
    const i = new Input();
    i.injectPress(code);
    screen.input(i);
  };
  const last = (): string => painted[painted.length - 1] ?? '';

  screen.showReport();
  screen.open();
  check('the report panel opens on the newest record', /SIMULATION REPORT/.test(last()));
  check('...and offers the comparison now that there are two',
    /ENTER COMPARE TWO/.test(last()));

  press('Enter');
  check('ENTER opens the pair without leaving the report',
    /COMPARE &mdash; RECORD 2 AND 1/.test(last()));
  check('...with the newest as THIS and the one before it as THAT',
    /THIS: RECORD 2/.test(last()) && /THAT: RECORD 1/.test(last()));
  check('...naming what flew in each', /scripted/.test(last())
    && /pirate-attack-g3/.test(last()));
  check('...and a difference column, because it is a real A/B',
    /<th class="num">&Delta;<\/th>/.test(last()));
  check('...over the same fight, so YOUR ACCURACY diverges and YOUR SHOTS does not',
    /YOUR ACCURACY/.test(last()) && /-40PP/.test(last()) && /class="num same">SAME/.test(last()));

  press('ArrowRight');
  check('the arrows walk THAT and skip THIS, so a two-record ring holds still',
    /THIS: RECORD 2/.test(last()) && /THAT: RECORD 1/.test(last()));
  press('KeyC');
  check('C copies the PAIR', said.includes('PAIR TO CLIPBOARD'));
  press('Escape');
  check('ESC comes back to the record it was opened from',
    /SIMULATION REPORT/.test(last()));

  // A mismatched pair, through the same door: the view states the difference in
  // the setup and paints no difference column at all.
  reports.push(flown({ seed: 4242 }));
  press('ArrowRight');
  press('Enter');
  check('a pair on two seeds says so, in the first thing you read',
    /NOT AN A\/B/.test(last()) && /IN 1 RESPECT/.test(last()));
  check('...naming the field and both values', /SEED<\/td>\s*<td class="num">4242/.test(last()));
  check('...and there is no difference column to misread',
    !/<th class="num">&Delta;<\/th>/.test(last()));
  check('...while both records are still shown side by side',
    /THIS: RECORD 3/.test(last()) && /THAT: RECORD 2/.test(last()));

  // One record cannot be a pair, and the screen says so out loud rather than
  // opening a view of a record against itself.
  const alone = new CombatSimScreen(() => ({
    commander: newCommander(),
    reports: [reports[0]],
    begin: () => true,
    message: (text: string) => said.push(text),
    liveBrain: AS_SHIPPED,
    selectLiveBrain: () => {},
  }));
  alone.showReport();
  alone.open();
  const i = new Input();
  i.injectPress('Enter');
  alone.input(i);
  check('one record refuses, and says why', said.includes('NEED TWO RECORDS TO COMPARE'));
  check('...and stays on the report', /SIMULATION REPORT/.test(last()));

  if (had) globals.document = previous;
  else delete globals.document;
}

// --- the keys, and where they live ------------------------------------------
//
// No new binding: ENTER is the launch key on the setup panel and was free on
// the report panel, and ←/→ already walks the ring. It is written down anyway,
// in the two homes a screen's own keys have (CLAUDE.md's key-bindings
// invariant) plus the screen's own hint line.

console.log('\ncombat simulator — reaching the comparison');
{
  const screen = read('src/game/screens/combat-sim.ts');
  const screens = read('src/ui/screens.ts');
  check('ENTER on the report panel opens the pair',
    /if \(i\.pressed\('Enter'\)\) \{\n\s*if \(n < 2\) return this\.refuse/.test(screen));
  check('...and refuses honestly when there is only one record',
    /NEED TWO RECORDS TO COMPARE/.test(screen));
  check('...and ESC or ENTER comes back to the record you opened it from',
    /i\.pressed\('Escape'\) \|\| i\.pressed\('Enter'\)/.test(screen));
  check('the arrows walk THAT and leave THIS pinned',
    /while \(this\.other === this\.record && n > 1\)/.test(screen));
  check('C and X take the PAIR', /comparisonJson\(this\.pair\(\)\)/.test(screen));
  check('the comparison is derived on demand and kept nowhere',
    /private pair\(\): SimComparison \{/.test(screen)
    && !/private compare(d|Cache)/.test(screen));

  const panel = screens.slice(screens.indexOf('export function renderCombatSimCompare'));
  check('the compare panel names its keys in its own hint line',
    /THE OTHER RECORD/.test(panel) && /C COPY PAIR/.test(panel)
    && /X EXPORT PAIR/.test(panel) && /ESC BACK/.test(panel));
  check('...and says which way round the difference goes',
    /IS THAT MINUS THIS/.test(panel));
  check('the report panel says the pair is there, once there are two records',
    /total > 1 \? '&middot; ENTER COMPARE TWO' : ''/.test(screens));
  check('the difference column is not PAINTED on a mismatched pair',
    /c\.comparable \? '<th class="num">&Delta;<\/th>' : ''/.test(panel)
    && /r\.delta === null \? '' :/.test(panel));

  check('the ? help panel names ENTER on the report', /report: compare two records/
    .test(read('play.html')));
  check('...and so does the README',
    /\*\*ENTER\*\* holds two of them side by side/.test(read('README.md')));

  // Pure, like the rest of the trainer's model layer: the comparison is
  // asserted under node with no browser, which is only true while it stays out
  // of the DOM.
  const src = read('src/game/combat-sim-compare.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  check('the comparison does not reach for the browser',
    !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
  check('...and adds no accumulation: it imports the record and nothing else',
    (src.match(/^import /gm) ?? []).length === 1);
}
