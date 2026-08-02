// The shell: screens, the key tables, the HUD, and the autopilots.
//
// A screen owns its rendering, its keys and its state in one file and returns an
// OUTCOME (invariant 13); the host acts on it. These tests are what let that be
// true without a browser — every screen here is driven as a pure function.

import * as THREE from 'three';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { defenceBrain } from '../src/game/brains.ts';
import { seedWorld } from '../src/game/rng.ts';
import { ScreenHost, type Screen, type ScreenOutcome } from '../src/ui/screen-host.ts';
import {
  globalCommands, BINDINGS, GLOBAL_BINDINGS, type ControlMode,
} from '../src/game/controls.ts';
import { renderDockedMenu } from '../src/ui/screens.ts';
import {
  Autopilot,
  DOCK_COMPUTER_RANGE,
  type AutopilotEvent,
} from '../src/game/autopilot.ts';
import { CombatComputer, CC_MAX_SPEED } from '../src/game/combat-computer.ts';
import { check, eq, cmds, eqc, keys } from './harness.ts';

// --- the screen contract ----------------------------------------------------

// Real unit tests, not source-regex ones: screen-host.ts touches the DOM only
// inside methods, so it imports cleanly under node. That is deliberate — the
// host is the piece several people will build screens against at once, so its
// behaviour needs to be pinned rather than described.

console.log('\nscreen host');
{
  // enough DOM for runMenuCursor to no-op
  (globalThis as unknown as { document: unknown }).document = {
    querySelectorAll: () => [],
  };

  const made: string[] = [];
  const fake = (id: string, out: ScreenOutcome = 'stay'): Screen => ({
    id: id as Screen['id'],
    open: () => made.push(`open:${id}`),
    render: () => made.push(`render:${id}`),
    input: () => out,
    select: (row: number) => made.push(`select:${id}:${row}`),
  });
  const noInput = { pressed: () => false, injectPress: () => {} } as unknown as Parameters<ScreenHost['update']>[0];

  {
    let base = 0;
    const h = new ScreenHost(() => { base += 1; });
    h.register(fake('market'));
    check('empty stack has no top', h.topId === null && h.depth === 0);
    h.open('market');
    check('open pushes and calls open()', h.topId === 'market' && h.depth === 1 && made.includes('open:market'));
    check('a registered screen is handled', h.handled);
    h.back();
    check('back pops to empty', h.depth === 0 && h.topId === null);
    check('showBase fires when the last screen closes', base === 1);
    h.back();
    check('back on an empty stack does not re-paint the base', base === 1);
  }

  {
    let base = 0;
    const h = new ScreenHost(() => { base += 1; });
    h.register(fake('saves'));
    h.register(fake('naming'));
    h.open('saves'); h.open('naming');
    check('screens stack', h.depth === 2 && h.topId === 'naming');
    h.back();
    check('back returns to the screen underneath', h.topId === 'saves' && h.depth === 1);
    check('the uncovered screen re-paints', made.includes('render:saves'));
    check('showBase does NOT fire while a screen remains', base === 0);
    h.exit();
    check('exit clears the stack and paints the base', h.depth === 0 && base === 1);
  }

  {
    // an id with no implementation: the stack still tracks it, but the caller
    // is told to handle it — this is what lets screens migrate one at a time
    const h = new ScreenHost(() => {});
    h.open('chart');
    check('an unmigrated id still occupies the stack', h.topId === 'chart' && h.depth === 1);
    check('but reports itself unhandled', !h.handled);
    check('update() returns false so the caller falls through', h.update(noInput) === false);
  }

  {
    const h = new ScreenHost(() => {});
    h.register(fake('market', { open: 'data' }));
    h.register(fake('data'));
    h.open('market');
    h.update(noInput);
    check('an { open } outcome pushes', h.topId === 'data' && h.depth === 2);
  }

  {
    const h = new ScreenHost(() => {});
    h.register(fake('market'));
    h.open('market');
    const row = { dataset: { row: '7' } } as unknown as HTMLElement;
    check('a data-row click reaches select()', h.click(row, noInput) && made.includes('select:market:7'));
    const key = { dataset: { key: 'KeyB' } } as unknown as HTMLElement;
    check('a data-key click is consumed as a keystroke', h.click(key, noInput));
  }
}

// --- the command layer ------------------------------------------------------

// Key handling was a hand-written `else if` chain of `input.pressed(...)`
// inside game.ts, which is to say it was untestable: the only way to ask "does
// M open the market" was to open a browser and press M. controls.ts turns the
// bindings into a table over a two-method input, so these are the first tests
// this project has ever had of what a key does.
//
// What they pin is the three rules the chain encoded implicitly, and each of
// them is a real bug if it goes: one command per frame, the view keys running
// independently of the rest, and shift being read before the tap is consumed.

console.log('\ncommand layer');
{
  // `keys`, `cmds` and `eqc` are in test/harness.ts: the simulator's own binding
  // tests need the same fake keyboard, and two of them would drift.

  // --- the bindings themselves, which are the point ---------------------------
  eqc('L launches', cmds('docked', ['KeyL']), ['launch']);
  eqc('M opens the market', cmds('docked', ['KeyM']), ['openMarket']);
  eqc('D reports the system you are standing on', cmds('docked', ['KeyD']), ['openSystemData']);
  eqc('T arms a missile', cmds('flight', ['KeyT']), ['armMissile']);
  eqc('J is the torus drive', cmds('flight', ['KeyJ']), ['toggleTorus']);
  eqc('P pauses in flight', cmds('flight', ['KeyP']), ['togglePause']);
  eqc('P also pauses the training simulator', cmds('simulator', ['KeyP']), ['togglePause']);
  eqc('P does nothing on the docked menu', cmds('docked', ['KeyP']), []);
  eqc('P does nothing on the new-game confirmation', cmds('confirmNewGame', ['KeyP']), []);
  eqc('P does nothing after destruction', cmds('dead', ['KeyP']), []);
  eqc('Enter is the only key that answers the game over screen',
    cmds('dead', ['Enter']), ['respawn']);
  eqc('...and nothing else does', cmds('dead', ['KeyL', 'KeyM', 'Space']), []);
  eqc('? is global, whatever the mode', globalCommands(keys(['Question'])), ['toggleHelp']);

  // --- shift, read before the tap is consumed ---------------------------------
  eqc('H jumps', cmds('flight', ['KeyH']), ['startHyperspace']);
  eqc('⇧H is the galactic jump', cmds('flight', ['KeyH'], ['ShiftLeft']), ['galacticJump']);
  eqc('...and the right-hand shift too', cmds('flight', ['KeyH'], ['ShiftRight']), ['galacticJump']);
  eqc('Y dumps one tonne', cmds('flight', ['KeyY']), ['jettison1']);
  eqc('⇧Y dumps five', cmds('flight', ['KeyY'], ['ShiftLeft']), ['jettison5']);
  // the failure this ordering exists to prevent: reading pressed('KeyH') on the
  // shifted entry first would eat the tap and leave the plain entry nothing
  check('an unshifted tap survives the shifted entry above it',
    cmds('flight', ['KeyH']).length === 1);

  // --- one command per frame ---------------------------------------------------
  eqc('two menu keys in one frame run the FIRST in table order, as the chain did',
    cmds('docked', ['KeyE', 'KeyL']), ['launch']);
  eqc('...and in the cockpit', cmds('flight', ['KeyJ', 'KeyT']), ['armMissile']);

  // --- the view keys are independent -------------------------------------------
  eqc('the four views are separate commands',
    cmds('flight', ['Digit1', 'Digit2', 'Digit3', 'Digit4']),
    ['view0', 'view1', 'view2', 'view3']);
  eqc('a view key does not swallow the rest of the frame',
    cmds('flight', ['Digit2', 'KeyG']), ['view1', 'openChart']);
  eqc('...and the view is applied BEFORE it, so the chart opens from the new view',
    cmds('flight', ['KeyG', 'Digit2']), ['view1', 'openChart']);

  // --- the confirmation swallows every other key --------------------------------
  eqc('Q asks before erasing a career', cmds('docked', ['KeyQ']), ['askNewGame']);
  eqc('Y confirms it', cmds('confirmNewGame', ['KeyY']), ['newGame']);
  eqc('X backs the commander up first', cmds('confirmNewGame', ['KeyX']), ['exportSave']);
  eqc('Escape backs out', cmds('confirmNewGame', ['Escape']), ['cancelNewGame']);
  eqc('...and so does Q, which is what asked', cmds('confirmNewGame', ['KeyQ']), ['cancelNewGame']);
  eqc('L does NOT launch you out of the confirmation',
    cmds('confirmNewGame', ['KeyL', 'KeyM', 'KeyE']), []);

  // --- the table is a key map, so it must not contain a collision ----------------
  //
  // Over `Object.keys(BINDINGS)` rather than a written-out list: the list was
  // written out, `simulator` was added, and a new mode was silently uncovered by
  // both checks below. A test that needs maintaining to keep working is the
  // failure it is guarding against.
  for (const mode of Object.keys(BINDINGS) as ControlMode[]) {
    const seen = new Set<string>();
    const clash = BINDINGS[mode].filter((b) => {
      const id = `${b.key}:${b.shift ?? '?'}`;
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    });
    check(`no two ${mode} bindings claim the same key and modifier`, clash.length === 0,
      clash.map((b) => b.key).join(','));
    // a plain entry ABOVE its shifted twin would consume the tap and lose the
    // modified command — the ⇧H bug, in table form
    for (let n = 0; n < BINDINGS[mode].length; n++) {
      const b = BINDINGS[mode][n];
      if (b.shift === undefined) continue;
      check(`${mode}: the shifted ${b.key} is listed above the plain one`,
        !BINDINGS[mode].slice(0, n).some((o) => o.key === b.key && o.shift === undefined));
    }
  }
}

// --- the menu is the third home of a binding, and it can lie -----------------

// A row that renders, highlights, accepts a click and does NOTHING.
//
// That is the failure this section exists for, and it is not hypothetical: the
// station menu advertised "D DATA ON SYSTEM" for months with no KeyD binding
// while docked, which src/game/controls.ts:218 still says out loud. `data-key`
// IS the click path — screen-host.ts turns it into a keystroke (invariant 13) —
// so a row naming a key the table does not have is a dead control that looks
// alive, and the cursor will happily park on it.
//
// The check that was here before, in test/combat-sim.test.ts, read
//
//   BINDINGS.docked.every((b) => !menu.includes(`data-key="${b.key}"`)
//     || b.key.startsWith('Key'))
//
// and could not fail: every key in the table starts with `Key`, so the second
// disjunct is always true. It also looked the harmless way round — from the
// table to the menu — and the direction that hurts is from the MENU to the
// table. So this goes menu-first, and is paired with a control below that aims
// the same predicate at a row known to be dead.

console.log('\nthe docked menu names keys the table has');
{
  const globals = globalThis as unknown as { document?: unknown };
  const previous = globals.document;
  const painted: string[] = [];
  globals.document = {
    getElementById: () => ({
      set innerHTML(html: string) { painted.push(html); },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    }),
    body: { classList: { add: () => {}, remove: () => {} } },
  };
  renderDockedMenu({ name: 'Lave', economy: 0, government: 5, techLevel: 4 } as never,
    newCommander());
  globals.document = previous;
  const menu = painted.join('');

  /** Every key the markup offers as a click, in order. */
  const rowKeys = (html: string): string[] =>
    [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  /** The predicate under test: which of those keys the table will not answer. */
  const dead = (html: string, table: readonly { key: string }[]): string[] =>
    rowKeys(html).filter((k) => !table.some((b) => b.key === k));

  check(`every row on the station menu names a docked binding (${rowKeys(menu).length} rows)`,
    dead(menu, BINDINGS.docked).length === 0, dead(menu, BINDINGS.docked).join(', '));
  // ...and the predicate can say no. It is aimed at a table of its own here, so
  // the control cannot be turned green or red by the live one — a changed
  // attribute name, or a renderer that quietly stopped painting, leaves an
  // empty list and an `ok`, which is exactly how the version this replaced
  // passed for its whole life.
  const oneRow = '<div data-key="KeyW"><b>W</b> A ROW</div>';
  check('...and the check is not vacuous', rowKeys(menu).length >= 8
    && dead(oneRow, [{ key: 'KeyW' }]).length === 0
    && dead(oneRow, [{ key: 'KeyL' }]).length === 1);

  // The keyline under the menu advertises six more keys without a `data-key`,
  // so they are not clickable and the scan above never sees them. They are
  // still a promise the table has to keep. `?` is the global help binding
  // rather than a docked one, which is why it is asked for separately.
  const keyline = (menu.match(/<div class="keyline">([^<]*)</) ?? ['', ''])[1];
  const advertised = [...keyline.matchAll(/(?:^|·|&middot;)\s*([A-Z?])\s/g)].map((m) => m[1]);
  const unanswered = advertised.filter((letter) => letter !== '?'
    && !BINDINGS.docked.some((b) => b.key === `Key${letter}`));
  check(`every letter the keyline promises is a docked binding (${advertised.join('')})`,
    unanswered.length === 0, unanswered.join(', '));
  check('...and that one is not vacuous either',
    advertised.length >= 5 && advertised.includes('?')
    && GLOBAL_BINDINGS.some((b) => b.key === 'Question'));
}

// --- the ship's autopilots --------------------------------------------------

// Both computers were methods of game.ts that talked straight to the HUD and
// the AudioContext, so "does the docking computer refuse out of range" was a
// question only a browser could answer. autopilot.ts reports events instead,
// which makes the refusals — the half of this that players actually meet —
// assertable under node.

console.log('\nautopilots');
{
  const rig = (fit: Partial<Record<'dockingComputer' | 'combatComputer', boolean>> = {}) => {
    seedWorld(99);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    Object.assign(state.commander.equipment, fit);
    // parked on the slot, so distance is not what is being tested
    state.player.position.copy(state.world.station.position);
    return { state, auto: new Autopilot(state, new CombatComputer()) };
  };
  const texts = (events: readonly AutopilotEvent[]): string[] =>
    events.flatMap((e) => (e.kind === 'message' ? [e.text] : []));

  {
    const { state, auto } = rig();
    eq('an unfitted docking computer refuses',
      texts(auto.toggleDocking())[0], 'NO DOCKING COMPUTER FITTED');
    check('...and does not engage', !state.session.dcEngaged);
    eq('an unfitted combat computer refuses',
      texts(auto.toggleCombat())[0], 'NO COMBAT COMPUTER FITTED');
    check('...and does not engage', !state.session.ccEngaged);
  }

  {
    const { state, auto } = rig({ dockingComputer: true });
    state.dockPlan.phase = 'run';
    const on = auto.toggleDocking();
    const phase: string = state.dockPlan.phase;
    check('the docking computer engages', state.session.dcEngaged);
    check('...and starts a fresh approach', phase === 'gate');
    check('...with the music on',
      on.some((e) => e.kind === 'dockingMusic' && e.on));
    const off = auto.toggleDocking();
    check('pressing it again hands the ship back', !state.session.dcEngaged);
    check('...and stops the music',
      off.some((e) => e.kind === 'dockingMusic' && !e.on));

    state.player.position.copy(state.world.station.position)
      .addScaledVector(new THREE.Vector3(1, 0, 0), DOCK_COMPUTER_RANGE + 1);
    eq('and it will not take the job from across the system',
      texts(auto.toggleDocking())[0], 'STATION OUT OF RANGE');
    check('...so it stays off', !state.session.dcEngaged);
  }

  {
    const { state, auto } = rig({ combatComputer: true });
    eq('the combat computer refuses an empty sky',
      texts(auto.toggleCombat())[0], 'NO HOSTILES — COMBAT COMPUTER IDLE');
    check('...and stays off', !state.session.ccEngaged);

    state.world.spawn('pirate',
      state.player.position.clone().add(new THREE.Vector3(0, 0, -1200)), 1);
    state.session.view = 2;
    auto.toggleCombat();
    check('with something hostile about, it engages', state.session.ccEngaged);
    check('...and swings to the front view, because it aims the front laser',
      state.session.view === 0);
    eq('pressing it again hands the ship back',
      texts(auto.toggleCombat())[0], 'COMBAT COMPUTER OFF');
    check('...and it is off', !state.session.ccEngaged);
  }

  {
    // the demand itself: the same FlightDemand a pair of hands produces
    const { state, auto } = rig({ combatComputer: true });
    state.world.spawn('pirate',
      state.player.position.clone().add(new THREE.Vector3(0, 0, -1200)), 1);
    auto.toggleCombat();
    const flying = auto.combatDemand(1 / 60, false, defenceBrain());
    check('it produces a demand, not a manoeuvre', flying.demand !== null);
    check('...at the cruise limits it was trained in',
      flying.demand?.limits?.maxSpeed === CC_MAX_SPEED);
    check('...and says nothing while it is working', flying.events.length === 0);

    const grabbed = auto.combatDemand(1 / 60, true, defenceBrain());
    check('touching the controls takes the ship straight back',
      grabbed.demand === null && !state.session.ccEngaged);
    eq('...and says so', texts(grabbed.events)[0], 'MANUAL OVERRIDE');

    // null brain = the weights failed to load; it must hand back, not fly blind
    state.session.ccEngaged = true;
    const noBrain = auto.combatDemand(1 / 60, false, null);
    check('no policy means no autopilot',
      noBrain.demand === null && !state.session.ccEngaged);
  }
}
