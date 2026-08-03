// The command layer: the discrete things the player asks for, as data.
//
// Flight already had this seam. `FlightDemand` (src/player.ts) is what a pair
// of hands WANTS — rates, throttle, trigger — and a keyboard, the combat
// computer or a test harness can each produce one, all flown by the same
// `PlayerShip.update`. Everything else the player can do was still a
// hand-written `else if` chain of `input.pressed(...)` inside game.ts, and that
// cost three things: the bindings were not readable as a list, nothing but a
// browser could ask for one, and the only way to check that M opens the market
// was to play it.
//
// So this is the same move for the discrete half. This file DECIDES what was
// asked for and reports `Command`s; game.ts's `runCommand` applies them. The
// tables below are the half of CLAUDE.md's KEY-BINDINGS INVARIANT that used to
// be code, and they are now the only home of a command key: what each one DOES
// is `command-help.ts` next door, welded to this file by `Record<Command, …>`,
// and the `?` panel, the manual page and the station menu are all RENDERED from
// the pair (`ui/key-help.ts`). `engine/keymap.ts` owns the flight axes; the
// README is prose, and `test/key-help.test.ts` holds it to this table.
//
// It reads an INPUT, not a browser: `CommandInput` is the two methods a
// binding needs, `engine/input.ts` satisfies it structurally, and a replay or
// an AI satisfies it with an object literal. That is why this file is in the
// purity block despite being "the keyboard".
//
// Three rules the old chains encoded, all load-bearing:
//
//  - **One command per frame from a chain.** `Input.pressed()` consumes a tap,
//    so an `else if` chain could only ever run one branch. The scan stops at
//    the first match for that reason — it is not an optimisation. A tap the
//    chain did not reach is not dropped at the end of the frame any more
//    (`engine/input.ts` carries it, briefly and boundedly), so it is offered
//    to the NEXT frame's table — which is how a mashed key reaches the game
//    twice instead of once, and why the tables below must stay per mode.
//  - **The view keys are independent.** The digit loop ran BEFORE the chain and
//    did not stop it, so 2 and G in the same frame still switches to the rear
//    view *and* opens the chart.
//  - **Shift is tested before the tap is consumed.** ⇧H is the galactic jump
//    and H the ordinary one; reading `pressed('KeyH')` first would eat the tap
//    on the shifted entry and then find nothing left for the plain one.

/**
 * Everything the player can ask for that is not flying the ship.
 *
 * Deliberately intents, not actions: `openMarket`, never `screens.open`. What
 * a command COSTS — a beep, a screen, a save, a jump — is the Game's business,
 * which is what lets this file be a table.
 */
export type Command =
  // --- the station menu ---------------------------------------------------
  | 'launch'
  | 'openMarket'
  | 'openContracts'
  | 'openEquip'
  | 'openBriefing'
  | 'openSaves'
  | 'openSystemData'
  | 'openCombatSim'
  | 'exportSave'
  | 'importSave'
  | 'toggleLayout'
  // --- putting a commander down --------------------------------------------
  | 'askNewGame'
  | 'newGame'
  | 'cancelNewGame'
  // --- shared between the menu and the cockpit ----------------------------
  | 'openChart'
  | 'openLocalChart'
  | 'openStatus'
  // --- the cockpit --------------------------------------------------------
  | 'view0' | 'view1' | 'view2' | 'view3'
  | 'armMissile'
  | 'launchMissile'
  | 'disarmMissile'
  | 'fireEcm'
  | 'detonateEnergyBomb'
  | 'toggleCombatComputer'
  | 'toggleDockingComputer'
  | 'toggleMouseFlight'
  | 'toggleTorus'
  | 'togglePause'
  | 'startHyperspace'
  | 'galacticJump'
  | 'distressBeacon'
  | 'jettison1'
  | 'jettison5'
  // --- the training simulator ---------------------------------------------
  | 'endExercise'
  // --- after the end ------------------------------------------------------
  | 'respawn'
  // --- whatever is on screen ----------------------------------------------
  | 'toggleHelp';

/**
 * Which set of bindings is live.
 *
 * `confirmNewGame` is a mode rather than a flag because that is what it is: the
 * put-this-commander-down confirmation swallows every other key, and saying so as a
 * table is both shorter and harder to get wrong than the early return it
 * replaced. The Game decides which mode it is in; the screen stack owns the
 * rest, so an open overlay never reaches this file at all.
 */
export type ControlMode = 'docked' | 'confirmNewGame' | 'flight' | 'simulator' | 'dead';

/**
 * The slice of `engine/input.ts` a binding needs.
 *
 * Two methods, structurally satisfied by `Input`. Nothing here knows what a
 * keydown is.
 */
export interface CommandInput {
  /** true once per tap, and CONSUMES it */
  pressed(code: string): boolean;
  /** live key state — used for modifiers, and never consumed */
  held(...codes: string[]): boolean;
}

export interface Binding {
  /** KeyboardEvent.code, or the 'Question' virtual code Input synthesises */
  key: string;
  /**
   * Require shift held (`true`) or ignore it (omitted). A shifted entry must
   * come FIRST for its key, since the plain one is the fallback.
   */
  shift?: boolean;
  /**
   * Read on its own: neither blocked by an earlier match nor blocking a later
   * one. Only the view keys, and only because the digit loop behaved that way.
   */
  independent?: boolean;
  command: Command;
}

/** Bindings that answer whatever is on screen, overlays included. */
export const GLOBAL_BINDINGS: readonly Binding[] = [
  // ? toggles the controls guide (plain / is the classic decelerate key)
  { key: 'Question', command: 'toggleHelp' },
];

/**
 * The cockpit's own table, named so the simulator can be stated as a
 * SUBTRACTION from it rather than as a second copy of it.
 *
 * A hand-written second list of flight keys would be exactly the failure this
 * project is organised against: adding a key to the cockpit and forgetting the
 * arena, or the reverse, and nothing to notice either.
 */
const FLIGHT_BINDINGS: readonly Binding[] = [
  { key: 'Digit1', independent: true, command: 'view0' },
  { key: 'Digit2', independent: true, command: 'view1' },
  { key: 'Digit3', independent: true, command: 'view2' },
  { key: 'Digit4', independent: true, command: 'view3' },
  { key: 'KeyP', command: 'togglePause' },
  { key: 'KeyG', command: 'openChart' },
  { key: 'KeyN', command: 'openLocalChart' },
  { key: 'KeyI', command: 'openStatus' },
  { key: 'KeyT', command: 'armMissile' },
  { key: 'KeyM', command: 'launchMissile' },
  { key: 'KeyU', command: 'disarmMissile' },
  { key: 'KeyE', command: 'fireEcm' },
  { key: 'KeyK', command: 'toggleCombatComputer' },
  { key: 'KeyV', command: 'toggleMouseFlight' },
  { key: 'Tab', command: 'detonateEnergyBomb' },
  { key: 'KeyC', command: 'toggleDockingComputer' },
  { key: 'KeyH', shift: true, command: 'galacticJump' },
  { key: 'KeyH', command: 'startHyperspace' },
  { key: 'KeyB', command: 'distressBeacon' },
  { key: 'KeyY', shift: true, command: 'jettison5' },
  { key: 'KeyY', command: 'jettison1' },
  { key: 'KeyJ', command: 'toggleTorus' },
];

/**
 * What a training exercise takes off you, and why each one.
 *
 * An arena you can leave is not an arena. Every command here would either end
 * the fight somewhere the report never mentions or spend something the exercise
 * has no business spending:
 *
 *  - `startHyperspace` / `galacticJump` — the exercise's `StepHost` refuses the
 *    arrival anyway, so the countdown would run and silently do nothing; the
 *    galactic drive additionally rebuilds the scene mid-fight.
 *  - `distressBeacon` — GalCop tows you out of the fight, for your cargo.
 *  - `jettison1` / `jettison5` — dumping cargo buys off a gang, and the clone's
 *    hold is deliberately EMPTY, so the key can only ever mislead.
 *  - `toggleDockingComputer` — it flies you at a station 77,000 units away and
 *    docking is the one transition that writes the save.
 *
 * Everything else the cockpit has is kept: the four views, the whole missile
 * cycle, the E.C.M., the energy bomb, the combat computer, mouse flight and the
 * torus drive. An exercise is meant to be the real ship.
 */
export const NOT_IN_THE_SIMULATOR: readonly Command[] = [
  'startHyperspace', 'galacticJump', 'distressBeacon', 'jettison1', 'jettison5',
  'toggleDockingComputer',
];

/**
 * The binding table. This IS the key map for commands — see CLAUDE.md's
 * key-bindings invariant, and `command-help.ts` for what each one does.
 */
export const BINDINGS: Record<ControlMode, readonly Binding[]> = {
  /**
   * The station menu: trade, outfit, take work, and leave.
   *
   * In MENU ORDER, and that is load-bearing rather than tidy: `ui/key-help.ts`
   * builds the menu's rows and the keyline under them straight from this list,
   * so the order here is the order on screen. Nothing else depends on it — no
   * two docked bindings share a key, so the first-match scan cannot see the
   * difference — which is why the rows can be arranged for a player.
   */
  docked: [
    { key: 'KeyL', command: 'launch' },
    { key: 'KeyM', command: 'openMarket' },
    { key: 'KeyC', command: 'openContracts' },
    { key: 'KeyE', command: 'openEquip' },
    { key: 'KeyN', command: 'openLocalChart' },
    { key: 'KeyG', command: 'openChart' },
    // The menu has advertised "D DATA ON SYSTEM" all along with nothing behind
    // it while docked — the only KeyD handlers were on the charts and the save
    // screen. Reports the system you are standing on.
    { key: 'KeyD', command: 'openSystemData' },
    { key: 'KeyI', command: 'openStatus' },
    // T for TRAINING. Free on this menu, and it arms a missile in FLIGHT —
    // which is the established per-mode convention, not a clash: C is contracts
    // docked and the docking computer in flight, M is the market docked and
    // launch-missile in flight. The tables are per mode.
    { key: 'KeyT', command: 'openCombatSim' },
    { key: 'KeyH', command: 'openBriefing' },
    // --- the keyline under the menu: bound here, but not rows you arrow onto -
    { key: 'KeyB', command: 'toggleLayout' },
    { key: 'KeyS', command: 'openSaves' },
    { key: 'KeyX', command: 'exportSave' },
    { key: 'KeyZ', command: 'importSave' },
    // Q, not a shifted N. ⇧N shared a key with the local chart, and cancelling
    // the confirm with N while still holding shift re-opened it on the very
    // next tap — you could get stuck in a loop you couldn't type your way out
    // of. A destructive action should not share a key with anything, modifier
    // or not.
    { key: 'KeyQ', command: 'askNewGame' },
  ],

  /** The confirmation swallows every other key — that is the whole point of it. */
  confirmNewGame: [
    { key: 'KeyY', command: 'newGame' },
    { key: 'KeyX', command: 'exportSave' },   // back it up first
    { key: 'Escape', command: 'cancelNewGame' },
    { key: 'KeyQ', command: 'cancelNewGame' },
  ],

  /** The cockpit: views, weapons, the ship's computers, and the charts. */
  flight: FLIGHT_BINDINGS,

  /**
   * The cockpit inside a training exercise: the same ship, minus every way out
   * of the arena, plus the two keys that end the exercise.
   *
   * Escape AND Q, deliberately. Escape is what every overlay in the game closes
   * with, so it is the key a hand reaches for; Q is the one that still works
   * when a keyboard's Escape is doing something the browser claimed.
   */
  simulator: [
    ...FLIGHT_BINDINGS.filter((b) => !NOT_IN_THE_SIMULATOR.includes(b.command)),
    { key: 'Escape', command: 'endExercise' },
    { key: 'KeyQ', command: 'endExercise' },
  ],

  /**
   * After you have been destroyed: take the way back, or go and pick one.
   *
   * Enter is the guarantee — this career's docked checkpoint, which is by
   * construction the station you launched from. S is the same key that opens
   * the commander file at the station, because it is the same screen and a hand
   * should not have to learn a second one for it.
   */
  dead: [
    { key: 'Enter', command: 'respawn' },
    { key: 'KeyS', command: 'openSaves' },
  ],
};

/**
 * Does this binding fire this frame?
 *
 * The modifier is checked FIRST, deliberately: `pressed()` consumes, so asking
 * about the key before the shift state would swallow ⇧H's tap on the plain-H
 * entry and lose the jump.
 */
function fires(b: Binding, i: CommandInput): boolean {
  if (b.shift !== undefined && b.shift !== i.held('ShiftLeft', 'ShiftRight')) return false;
  return i.pressed(b.key);
}

/** Scan a table: every independent binding, then at most one from the chain. */
function scan(table: readonly Binding[], i: CommandInput): Command[] {
  const out: Command[] = [];
  for (const b of table) {
    if (b.independent && fires(b, i)) out.push(b.command);
  }
  for (const b of table) {
    if (b.independent) continue;
    if (fires(b, i)) { out.push(b.command); break; }
  }
  return out;
}

/** What the player asked for regardless of what is on screen. */
export function globalCommands(i: CommandInput): Command[] {
  return scan(GLOBAL_BINDINGS, i);
}

/**
 * What the player asked for in this mode, in the order it must be applied.
 *
 * The order is the old chain's: views before everything, because pressing 2
 * and G together switched view and then opened the chart, and a replay that
 * reversed them would open the chart from the wrong view.
 */
export function commandsFor(mode: ControlMode, i: CommandInput): Command[] {
  return scan(BINDINGS[mode], i);
}
