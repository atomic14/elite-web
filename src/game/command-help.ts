// What each command DOES, in the player's words. The captions to controls.ts.
//
// `controls.ts` owns which KEY asks for a command; this file owns the one line
// that says what the player gets, and `Record<Command, CommandHelp>` welds the
// two together: add a `Command` next door and this file does not compile until
// somebody has written down what it does. That is the whole point. Invariant 9
// used to be four hand-maintained lists, and what it cost was two live keys —
// the distress beacon, which hands GalCop your cargo, and ⇧Y, which dumps five
// tonnes — that appeared in NO help surface the game shipped.
//
// Nothing here is a rule and nothing branches on it. Three surfaces render it
// and none of them holds a copy:
//
//   the `?` panel      ui/key-help.ts paints it into play.html's hosts
//   the manual page    src/manual.ts renders the same tables
//   the station menu   ui/screens.ts builds its rows and keyline from it
//
// so a key that changes in `controls.ts` changes in all three, or the build
// fails. The README is the one surface still written by hand, because it is
// prose for people who have not launched the game — `test/key-help.test.ts`
// holds it to this table in both directions.

import type { Command } from './controls.ts';
import { TORUS_MULTIPLIER } from '../constants/torus.ts';

/**
 * Which table of the `?` guide a FLIGHT command belongs in.
 *
 * Only read for bindings in the cockpit — the other modes are one section
 * each, so a section is the mode. `test/key-help.test.ts` asserts every
 * cockpit command has one, which is the half a type cannot state.
 */
export type HelpSection = 'flight' | 'combat' | 'navigation';

export interface CommandHelp {
  /** One line. Lower case, no full stop — it is a table cell, not a sentence. */
  what: string;
  /** Which `?` table this appears in when it is bound in the cockpit. */
  section?: HelpSection;
  /**
   * The station menu's own words for it, when the command gets a MENU ROW.
   *
   * A row is a click target (`data-key`, invariant 13), so this is the label of
   * a control rather than a description of one — short and upper case.
   */
  menu?: string;
  /**
   * The same, for the keyline UNDER the menu: bound at the station, worth
   * advertising, but not a row you can arrow onto.
   */
  keyline?: string;
}

/**
 * Every command, with what it does.
 *
 * Exhaustive by type. The order is the order the `?` guide and the manual
 * read in, since both render from the binding tables rather than from this
 * one — this is a dictionary, not a layout.
 */
export const COMMAND_HELP: Record<Command, CommandHelp> = {
  // --- the station menu -----------------------------------------------------
  launch: { what: 'launch from the station', menu: 'LAUNCH' },
  openMarket: { what: 'market prices — buy and sell cargo', menu: 'MARKET PRICES' },
  openContracts: {
    what: 'contracts — cargo runs that pay a bonus, against a deadline',
    menu: 'CONTRACTS',
  },
  openEquip: { what: 'equip ship — fuel, missiles and upgrades', menu: 'EQUIP SHIP' },
  openBriefing: {
    what: "new pilot's briefing — six pages on what to actually do",
    menu: "NEW PILOT'S BRIEFING",
  },
  openSaves: {
    what: 'commander file — named saves and autosaves',
    keyline: 'COMMANDER FILE',
  },
  openSystemData: {
    what: 'data on the system you are standing on',
    menu: 'DATA ON SYSTEM',
  },
  openCombatSim: {
    what: 'combat training simulator — free, and nothing in it reaches your commander',
    menu: 'COMBAT TRAINING',
  },
  exportSave: { what: 'export a save file', keyline: 'EXPORT' },
  importSave: { what: 'import a save file', keyline: 'IMPORT' },
  toggleLayout: { what: 'switch keyboard layout: classic / modern', keyline: 'KEYBOARD LAYOUT' },

  // --- putting a commander down ----------------------------------------------
  askNewGame: { what: 'start a new commander (asks first)', keyline: 'NEW COMMANDER' },
  newGame: { what: 'yes — name a new commander and start again' },
  cancelNewGame: { what: 'keep flying this commander' },

  // --- shared between the menu and the cockpit -------------------------------
  openChart: { what: 'galactic chart', section: 'navigation', menu: 'GALACTIC CHART' },
  openLocalChart: { what: 'short range chart', section: 'navigation', menu: 'LOCAL CHART' },
  openStatus: { what: 'commander status', section: 'navigation', menu: 'COMMANDER STATUS' },

  // --- the cockpit ----------------------------------------------------------
  view0: { what: 'front view', section: 'flight' },
  view1: { what: 'rear view', section: 'flight' },
  view2: { what: 'left view', section: 'flight' },
  view3: { what: 'right view', section: 'flight' },
  armMissile: {
    what: 'arm a missile — it locks when a target enters your sights',
    section: 'combat',
  },
  launchMissile: { what: 'fire the armed missile', section: 'combat' },
  disarmMissile: { what: 'unarm the missile', section: 'combat' },
  fireEcm: { what: 'E.C.M. — destroys incoming missiles (if fitted)', section: 'combat' },
  detonateEnergyBomb: {
    what: 'energy bomb — destroys everything close by (if fitted)',
    section: 'combat',
  },
  toggleCombatComputer: {
    what: 'combat computer — the trained defence AI flies your ship (if fitted)',
    section: 'combat',
  },
  toggleDockingComputer: {
    what: 'docking computer — flies you in; press again, or touch the controls, to take over',
    section: 'navigation',
  },
  toggleMouseFlight: {
    what: 'mouse flight — a pointer-locked analogue stick, left button fires',
    section: 'flight',
  },
  toggleTorus: {
    // The one caption that carries a number, and it is the drive's own rather
    // than a digit: it read "8×" while the step wrote 7 and only agreed
    // because the step's 7 is one less than the total.
    what: `torus jump drive (${TORUS_MULTIPLIER}×; cuts out when something massive is near)`,
    section: 'flight',
  },
  togglePause: { what: 'pause', section: 'flight' },
  startHyperspace: { what: 'hyperspace jump to your target', section: 'navigation' },
  galacticJump: {
    what: 'galactic hyperdrive — one jump to the next galaxy (if fitted)',
    section: 'navigation',
  },
  distressBeacon: {
    what: 'distress beacon — GalCop tows you to the station AND TAKES YOUR CARGO',
    section: 'navigation',
  },
  jettison1: {
    what: 'jettison a tonne of cargo — pirates came for the goods, not for you',
    section: 'flight',
  },
  jettison5: { what: 'jettison five tonnes at once', section: 'flight' },

  // --- the training simulator ------------------------------------------------
  endExercise: { what: 'end the exercise — nothing in it reaches your commander' },

  // --- after the end ---------------------------------------------------------
  respawn: { what: 'back to the station autosave you launched from' },

  // --- whatever is on screen -------------------------------------------------
  toggleHelp: { what: 'this controls guide', keyline: 'CONTROLS GUIDE' },
};
