// A key is only bound once, and every surface that lists it renders from that.
//
// This is the enforcement half of CLAUDE.md invariant 9. A binding used to be
// written out by hand in six places and they disagreed: the combat computer,
// the energy bomb and the galactic jump were missing from the manual, the
// distress beacon — which hands GalCop your cargo — was in NO in-game help
// surface at all, ⇧Y was in none of them, and D was listed as a flight key when
// it is bound at the station and nowhere else.
//
// Three of those surfaces are generated now (`src/ui/key-help.ts`), so what is
// left to assert is the joins:
//
//   1. every binding, in every mode, lands in exactly one section of the `?`
//      guide — a key documented nowhere is a test failure, not a discovery
//   2. every section has a host in play.html to be painted into
//   3. every docked binding is either a menu row or on the keyline under it
//   4. the manual's tables are per MODE, so D cannot appear as a flight key
//   5. the README — the one surface still written by hand, because it is prose
//      for people who have not launched the game — lists exactly the keys the
//      table binds, in both directions
//
// The `what` of each command is welded by the type system rather than by a test:
// `COMMAND_HELP` is a `Record<Command, CommandHelp>`, so a command with nothing
// written down about it does not compile.

import { readFileSync } from 'node:fs';
import {
  BINDINGS, GLOBAL_BINDINGS, type Binding, type ControlMode,
} from '../src/game/controls.ts';
import { COMMAND_HELP } from '../src/game/command-help.ts';
import {
  ALL_BINDINGS, dockedMenuHtml, guideSections, guideTableHtml, keyLabel,
  manualCommandsHtml, paintCommandGuide,
} from '../src/ui/key-help.ts';
import { check, eq } from './harness.ts';

/** A binding's identity for these tests: the same key does the same thing. */
const id = (b: Binding): string => `${keyLabel(b.key, b.shift)} → ${b.command}`;
const sorted = (xs: string[]): string[] => [...new Set(xs)].sort();

console.log('\nthe ? guide documents every binding');
{
  const bound = sorted(ALL_BINDINGS.map(id));
  const documented = sorted(guideSections().flatMap((s) => s.bindings.map(id)));

  const missing = bound.filter((k) => !documented.includes(k));
  const invented = documented.filter((k) => !bound.includes(k));
  check(`every bound key is in a section of the guide (${bound.length} keys)`,
    missing.length === 0, missing.join(', '));
  check('...and the guide invents none', invented.length === 0, invented.join(', '));

  // The two directions above are one comparison, so this is the control that
  // says the comparison can fail at all: the same predicate, aimed at a table
  // of its own. Without it, a `guideSections()` that returned nothing and an
  // `ALL_BINDINGS` that collected nothing would both read as green.
  const fake: Binding[] = [{ key: 'KeyW', command: 'launch' }];
  check('...and that check is not vacuous',
    bound.length >= 40
    && fake.map(id).filter((k) => !documented.includes(k)).length === 1);

  // A cockpit binding with no `section` belongs to no table, so it would drop
  // out of the guide silently — the coverage check above catches it, and this
  // says which one and why.
  const sectionless = BINDINGS.flight.filter((b) => !COMMAND_HELP[b.command].section);
  check('every cockpit command says which table of the guide it belongs in',
    sectionless.length === 0, sectionless.map((b) => b.command).join(', '));

  // Each section's markup: one row per command, the keys that ask for it, and
  // what it does. Merged rows are the reason this is not a row count — ESC and
  // Q both end an exercise, and printing that twice reads as two rules.
  for (const section of guideSections()) {
    const html = guideTableHtml(section.bindings);
    const missingText = section.bindings
      .filter((b) => !html.includes(COMMAND_HELP[b.command].what));
    check(`${section.id} paints what each of its ${section.bindings.length} keys does`,
      section.bindings.length > 0 && missingText.length === 0,
      missingText.map((b) => b.command).join(', '));
  }

  const confirm = guideTableHtml(BINDINGS.confirmNewGame);
  check('two keys for one command are one row, not two',
    confirm.includes('<td>ESC / Q</td>'), confirm);

  // And the paint itself: each section's markup into its OWN host, which is the
  // step between "the guide is right" and "the panel shows it".
  const globals = globalThis as unknown as { document?: unknown };
  const previous = globals.document;
  const painted = new Map<string, string>();
  globals.document = {
    getElementById: (host: string) => ({
      set innerHTML(html: string) { painted.set(host, html); },
    }),
  };
  paintCommandGuide();
  const wrong = guideSections()
    .filter((s) => painted.get(s.id) !== guideTableHtml(s.bindings));
  check(`paintCommandGuide fills every host (${painted.size})`,
    wrong.length === 0, wrong.map((s) => s.id).join(', '));

  // With no document at all it is inert rather than fatal
  // (engine/inert-dom.ts), which is what lets a headless Game boot.
  delete globals.document;
  paintCommandGuide();
  globals.document = previous;
  check('...and painting it headlessly writes nothing and throws nothing',
    painted.size === guideSections().length);
}

console.log('\nthe ? panel has a host for every section');
{
  const play = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
  const homeless = guideSections().filter((s) => !play.includes(`id="${s.id}"`));
  check(`play.html hosts every generated section (${guideSections().length})`,
    homeless.length === 0, homeless.map((s) => s.id).join(', '));
  check('...and that check is not vacuous', !play.includes('id="help-nonesuch"')
    && play.includes('id="help-docked"'));
  // The four flight-axis rows are NOT generated — they change with the layout
  // and engine/keymap.ts rewrites them in place — so their ids have to survive.
  const axes = ['help-pitch', 'help-pitch-desc', 'help-roll', 'help-decel', 'help-fire'];
  const lost = axes.filter((axis) => !play.includes(`id="${axis}"`));
  check('...and the layout-dependent rows keymap.ts rewrites are still there',
    lost.length === 0, lost.join(', '));
}

console.log('\nthe station menu advertises exactly what is bound there');
{
  const both = BINDINGS.docked.filter((b) => {
    const help = COMMAND_HELP[b.command];
    return (help.menu === undefined) === (help.keyline === undefined);
  });
  check('every docked command is a menu row or a keyline entry, never both or neither',
    both.length === 0, both.map((b) => b.command).join(', '));

  const menu = dockedMenuHtml();
  const rowKeys = [...menu.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  const wanted = BINDINGS.docked.filter((b) => COMMAND_HELP[b.command].menu).map((b) => b.key);
  eq('the rows are the docked bindings that have a row, in table order',
    rowKeys.join(','), wanted.join(','));

  const keyline = (menu.match(/<div class="keyline">([^<]*)</) ?? ['', ''])[1];
  const unadvertised = [...GLOBAL_BINDINGS, ...BINDINGS.docked]
    .filter((b) => COMMAND_HELP[b.command].keyline)
    .filter((b) => !keyline.includes(`${keyLabel(b.key, b.shift)} ${COMMAND_HELP[b.command].keyline}`));
  check(`the keyline carries the rest (${keyline})`,
    unadvertised.length === 0, unadvertised.map((b) => b.command).join(', '));
  check('...and neither of those is vacuous',
    rowKeys.length >= 8 && keyline.includes('? CONTROLS GUIDE'));
}

console.log('\nthe manual page is generated per mode');
{
  const html = manualCommandsHtml();
  const split = html.indexOf('Commands at the station');
  check('the manual has a flight table and a station table', split > 0);
  const inFlight = html.slice(0, split);
  const atStation = html.slice(split);

  const absent = (part: string, bindings: readonly Binding[]): Binding[] =>
    bindings.filter((b) => !part.includes(`<kbd>${keyLabel(b.key, b.shift)}</kbd>`));
  check('every cockpit key is in the flight table',
    absent(inFlight, [...BINDINGS.flight, ...GLOBAL_BINDINGS]).length === 0,
    absent(inFlight, BINDINGS.flight).map((b) => b.key).join(', '));
  check('every station key is in the station table',
    absent(atStation, BINDINGS.docked).length === 0,
    absent(atStation, BINDINGS.docked).map((b) => b.key).join(', '));

  // The bug the hand-written table had: D is bound on the station menu and
  // nowhere else, and it was printed as a flight command.
  check('D is a station key, and the flight table does not claim it',
    atStation.includes('<kbd>D</kbd>') && !inFlight.includes('<kbd>D</kbd>'));
  check('...and ⇧Y, which the old table missed entirely, is there',
    inFlight.includes('<kbd>⇧Y</kbd>'));
}

console.log('\nthe README lists exactly what is bound');
{
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  /** The first column of one README table, as the keys it names. */
  const advertised = (heading: string): string[] => {
    const from = readme.indexOf(heading);
    const rest = readme.slice(from + heading.length);
    const end = rest.indexOf('\n##');
    return sorted(rest.slice(0, end === -1 ? undefined : end)
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) => line.split('|')[1].replaceAll(/[*`]/g, '').trim())
      .filter((cell) => cell !== '' && !/^-+$/.test(cell) && cell !== 'Key')
      .flatMap((cell) => cell.split(/[\s/]+/))
      .filter(Boolean));
  };

  const table = (heading: string, bindings: readonly Binding[]): void => {
    const listed = advertised(heading);
    const want = sorted(bindings.map((b) => keyLabel(b.key, b.shift)));
    const missing = want.filter((k) => !listed.includes(k));
    const extra = listed.filter((k) => !want.includes(k));
    check(`README "${heading.trim()}" lists every key that is bound (${want.length})`,
      missing.length === 0, missing.join(', '));
    check(`README "${heading.trim()}" lists nothing that is not bound`,
      extra.length === 0, extra.join(', '));
  };

  table('### Commands (identical in both layouts)',
    [...BINDINGS.flight, ...GLOBAL_BINDINGS]);
  table('### Docked\n', BINDINGS.docked);

  // The control: the parser found a table, and the predicate says no when a
  // key is absent. A heading that stopped matching would leave two empty lists
  // and two passes, which is exactly how a vacuous guard reads.
  const flight = advertised('### Commands (identical in both layouts)');
  check('...and the README parser is reading a real table',
    flight.length >= 20 && flight.includes('TAB') && flight.includes('⇧H')
    && !flight.includes('D'));
}

console.log('\nthe modes the guide covers are the modes there are');
{
  // A new ControlMode with a table of its own would otherwise be documented
  // nowhere and nothing would say so: the coverage check at the top reads
  // `ALL_BINDINGS`, which walks `Object.keys(BINDINGS)`, so it grows on its
  // own — this is what makes sure it does.
  const modes = Object.keys(BINDINGS) as ControlMode[];
  const counted = modes.flatMap((m) => BINDINGS[m]).length + GLOBAL_BINDINGS.length;
  eq('ALL_BINDINGS walks every mode', ALL_BINDINGS.length, counted);
}
