// The key tables, rendered — the `?` panel, the manual page and the station
// menu, all from `BINDINGS` and `COMMAND_HELP` and from nothing else.
//
// This file exists to DELETE homes rather than to add one. Before it, a binding
// was written out by hand in six places: keymap.ts and controls.ts (which are
// the bindings), then play.html's `?` panel, the README, `manual.ts`'s own
// COMMANDS array and the docked menu in `ui/screens.ts` — four copies kept in
// step by hope, and they were not in step. Three of those four render from here
// now, so the only way to change what a key does without changing what the game
// TELLS you it does is to edit the README, which `test/key-help.test.ts` holds
// to the table in both directions.
//
// It renders and nothing else: strings in, strings out, one guarded paint at
// the end. No rule is read from it and nothing branches on what it returns.

import {
  BINDINGS, GLOBAL_BINDINGS, type Binding, type ControlMode,
} from '../game/controls.ts';
import { COMMAND_HELP, type HelpSection } from '../game/command-help.ts';
import { elementById } from '../engine/inert-dom.ts';

/** Physical key codes are not what anybody calls these. */
const LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'SPACE',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Tab: 'TAB',
  Escape: 'ESC',
  Enter: 'ENTER',
  // the virtual code Input synthesises for `?`, which is a shifted / on most
  // layouts and its own key on some
  Question: '?',
};

/** What to print for a `KeyboardEvent.code`, with the modifier the table wants. */
export function keyLabel(code: string, shift = false): string {
  const name = LABELS[code]
    ?? (code.startsWith('Key') ? code.slice(3)
      : code.startsWith('Digit') ? code.slice(5) : code);
  return shift ? `⇧${name}` : name;
}

/** One row of a rendered table: the keys that ask for a command, and what it does. */
export interface HelpRow {
  /** every key bound to this command in this table, in table order */
  keys: string[];
  what: string;
}

/**
 * Bindings to rows, merging the keys that ask for the SAME command.
 *
 * ESC and Q both cancel a new commander, and printing that as two rows saying
 * the same thing reads like two different things.
 */
export function helpRows(bindings: readonly Binding[]): HelpRow[] {
  const rows: HelpRow[] = [];
  const byCommand = new Map<string, HelpRow>();
  for (const b of bindings) {
    const found = byCommand.get(b.command);
    if (found) { found.keys.push(keyLabel(b.key, b.shift)); continue; }
    const row: HelpRow = { keys: [keyLabel(b.key, b.shift)], what: COMMAND_HELP[b.command].what };
    byCommand.set(b.command, row);
    rows.push(row);
  }
  return rows;
}

/** A section of the `?` guide: the element that holds it, and what goes in it. */
export interface GuideSection {
  /** the id of its host in play.html — a missing one is a section nobody sees */
  id: string;
  bindings: readonly Binding[];
}

const flightIn = (section: HelpSection): Binding[] =>
  BINDINGS.flight.filter((b) => COMMAND_HELP[b.command].section === section);

/**
 * The whole guide, as data.
 *
 * Every binding the game has is in exactly one of these, and
 * `test/key-help.test.ts` asserts precisely that — which is what makes "a key
 * that is not documented anywhere" a test failure rather than a discovery six
 * months later. The cockpit is three sections because a guide of twenty
 * undifferentiated rows is not a guide; every other mode is one.
 */
export function guideSections(): GuideSection[] {
  const inFlight = new Set<Binding>(BINDINGS.flight);
  return [
    { id: 'help-flight', bindings: flightIn('flight') },
    { id: 'help-combat', bindings: flightIn('combat') },
    { id: 'help-navigation', bindings: flightIn('navigation') },
    { id: 'help-docked', bindings: BINDINGS.docked },
    { id: 'help-confirm', bindings: BINDINGS.confirmNewGame },
    { id: 'help-dead', bindings: BINDINGS.dead },
    // what the SIMULATOR adds to the cockpit; what it takes away is
    // NOT_IN_THE_SIMULATOR, and the panel says so in prose beside this
    { id: 'help-simulator', bindings: BINDINGS.simulator.filter((b) => !inFlight.has(b)) },
    { id: 'help-anywhere', bindings: GLOBAL_BINDINGS },
  ];
}

const rowsHtml = (rows: HelpRow[], key: (label: string) => string): string =>
  rows.map((r) => `<tr><td>${r.keys.map(key).join(' / ')}</td><td>${r.what}</td></tr>`).join('');

/** One `?`-panel table. Plain, because the panel's CSS styles bare cells. */
export const guideTableHtml = (bindings: readonly Binding[]): string =>
  `<table>${rowsHtml(helpRows(bindings), (k) => k)}</table>`;

/**
 * Paint every generated section of the `?` panel.
 *
 * Called once at boot — unlike the flight rows, which `refreshHelpPanel()`
 * rewrites whenever the layout is toggled, a command key is the same in both
 * layouts. A missing host is inert rather than fatal (engine/inert-dom.ts), so
 * this runs headlessly with no document at all.
 */
export function paintCommandGuide(): void {
  for (const section of guideSections()) {
    elementById(section.id).innerHTML = guideTableHtml(section.bindings);
  }
}

// --- the manual page --------------------------------------------------------

/**
 * The manual's command tables: the cockpit, then the station.
 *
 * The scope is the point. A hand-written table here listed D as a flight key
 * for months; it is bound on the station menu and nowhere else, and rendering
 * per MODE is what makes that impossible to get wrong.
 */
export function manualCommandsHtml(): string {
  const table = (bindings: readonly Binding[]): string =>
    `<table class="data cmd">${rowsHtml(helpRows(bindings), (k) => `<kbd>${k}</kbd>`)}</table>`;
  return `
    <h3>Commands in flight</h3>
    ${table([...BINDINGS.flight, ...GLOBAL_BINDINGS])}
    <h3>Commands at the station</h3>
    ${table(BINDINGS.docked)}`;
}

// --- the station menu -------------------------------------------------------

/**
 * The docked menu's rows and the keyline under them.
 *
 * `data-key` IS the click path (invariant 13), so a row naming a key the table
 * does not have is a dead control that looks alive — which the menu shipped for
 * months as "D DATA ON SYSTEM" with no KeyD binding while docked. Generating
 * the rows FROM the table is what retires that failure: there is no longer a
 * way to write one.
 *
 * A docked command is a row if it has a menu label and a keyline entry if it
 * has a keyline one; `test/key-help.test.ts` asserts every docked binding has
 * exactly one of the two, so nothing bound at the station is unadvertised.
 */
export function dockedMenuHtml(): string {
  const rows = BINDINGS.docked
    .filter((b) => COMMAND_HELP[b.command].menu)
    .map((b) => `<div data-key="${b.key}"><b>${keyLabel(b.key, b.shift)}</b> `
      + `${COMMAND_HELP[b.command].menu}</div>`)
    .join('\n      ');
  // The keyline is not clickable, so it carries no data-key: these are keys
  // that work here, not controls you can arrow onto. `?` comes first because it
  // is the one that explains all the others.
  const line = [...GLOBAL_BINDINGS, ...BINDINGS.docked]
    .filter((b) => COMMAND_HELP[b.command].keyline)
    .map((b) => `${keyLabel(b.key, b.shift)} ${COMMAND_HELP[b.command].keyline}`)
    .join(' &middot; ');
  return `<div class="menu">
      ${rows}
    </div>
    <div class="keyline">${line}</div>`;
}

/** Every mode's table, for the tests that ask "is this key written down anywhere?" */
export const ALL_BINDINGS: readonly Binding[] = [
  ...GLOBAL_BINDINGS,
  ...(Object.keys(BINDINGS) as ControlMode[]).flatMap((m) => BINDINGS[m]),
];
