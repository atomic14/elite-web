// The screen router: which overlay is open, and who gets the keyboard.
//
// WHY THIS EXISTS
//
// Screen routing was a 232-line switch in game.ts over 13 modes, so adding a
// screen meant editing four places (the Mode union, the switch, an openX()
// method, and often the click handler) and every screen's keys lived in the
// same function as every other screen's. Nothing could be worked on in
// isolation.
//
// THE CONTRACT
//
// A screen owns its rendering, its keys and its own state, in one file, behind
// two required methods. It never sets the mode, never touches the Game, and
// never reaches for another screen: it returns an OUTCOME and the host acts on
// it. That is the same discipline NpcShip follows with FireEvent, and it is
// what makes a screen safe to develop — or review — on its own.
//
// FLIGHT IS NOT A SCREEN. The host handles overlays only. Flight is the game
// running; `Game` keeps it, along with the docked and dead base states. The
// mode you are in is the top of this stack, or the base state when it is
// empty.

// NO PARAMETER PROPERTIES in this file or in any screen. `npm test` runs
// under node's --experimental-strip-types, which rejects
// `constructor(private readonly x)` — Vite compiles it happily, so the failure
// only shows up in the test run. Assign fields explicitly instead; it is the
// price of screens being unit-testable outside a browser.

import type { Input } from '../engine/input';

/**
 * Every overlay in the game. One line per screen — deliberately the only
 * shared edit adding a screen requires, so two people adding two screens
 * conflict on one line rather than on a switch statement.
 */
export type ScreenId =
  | 'market' | 'equip' | 'contracts' | 'status' | 'data'
  | 'chart' | 'local' | 'saves' | 'naming' | 'briefing';

/** What a screen asks the host to do next. */
export type ScreenOutcome =
  /** nothing — stay where we are */
  | 'stay'
  /** pop: return to whoever opened this one */
  | 'back'
  /** pop everything: straight back to the base state */
  | 'exit'
  /** push a screen on top of this one; `back` will return here */
  | { open: ScreenId };

export interface Screen {
  readonly id: ScreenId;
  /** Became visible — set up state and paint. */
  open(): void;
  /** Re-paint from current data, without resetting state. */
  render(): void;
  /** One frame of keyboard. */
  input(i: Input): ScreenOutcome;
  /**
   * A row was clicked (`data-row`). List screens implement this; the host
   * routes the click here so selection has ONE implementation.
   *
   * It used to have two — a key path and a parallel click path in game.ts —
   * and they drifted: clicking a market row while trading at a rock hermit
   * re-rendered with the system's name because only the key path knew where
   * you were.
   */
  select?(row: number): void;
}

/**
 * Holds the stack, runs the menu cursor, turns clicks into input, and gives
 * one frame to whichever screen is on top.
 *
 * Screens not yet migrated are pushed as ids with no implementation. The stack
 * is still the single source of truth for *which* screen is open — only the
 * handling stays behind in game.ts until that screen moves. `handled` says
 * which case you are in.
 */
export class ScreenHost {
  private readonly registry = new Map<ScreenId, Screen>();
  private readonly stack: { id: ScreenId; screen: Screen | null }[] = [];
  /** cursor position for the generic menu handling, see runMenuCursor */
  private menuSelected = 0;

  /**
   * @param showBase repaint whatever is underneath the stack — the docked
   * menu, or the flight view. Called whenever the last screen closes.
   *
   * The host cannot know what the base state looks like, and the Game cannot
   * know when a screen decided to close, so the two meet here. Without it a
   * migrated screen popped correctly and left its own text on the display:
   * mode said `docked`, the screen still said MARKET.
   *
   * It must only paint. Touching the stack from here would recurse.
   */
  private readonly showBase: () => void;
  private readonly repaintLegacy: (id: ScreenId) => void;

  /**
   * @param showBase repaint whatever is underneath the stack.
   * @param repaintLegacy repaint a screen that has NOT migrated yet, when it
   * is uncovered. Migrated screens repaint themselves via `render()`; an
   * unmigrated one has no implementation to call, so without this it keeps
   * showing whatever was on top of it. Closing the data screen over the
   * galactic chart left "DATA ON QUTIRI" on a chart-mode display.
   *
   * Delete this parameter once every id in ScreenId has a Screen.
   */
  constructor(showBase: () => void, repaintLegacy: (id: ScreenId) => void = () => {}) {
    this.showBase = showBase;
    this.repaintLegacy = repaintLegacy;
  }

  register(screen: Screen): void {
    this.registry.set(screen.id, screen);
  }

  /** The screen on top, or null when the base state is showing. */
  get top(): { id: ScreenId; screen: Screen | null } | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  get topId(): ScreenId | null {
    return this.top?.id ?? null;
  }

  /** True when the top screen implements the contract (vs. legacy handling). */
  get handled(): boolean {
    return this.top?.screen != null;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Push a screen. `back` from it returns to whatever is underneath. */
  open(id: ScreenId): void {
    const screen = this.registry.get(id) ?? null;
    this.stack.push({ id, screen });
    this.menuSelected = 0;
    screen?.open();
  }

  /**
   * Replace the whole stack with one screen.
   *
   * For the places that jump sideways rather than deeper — opening the chart
   * from the docked menu should not leave a trail to walk back through.
   */
  replace(id: ScreenId): void {
    this.stack.length = 0;
    this.open(id);
  }

  /** Pop one. @returns true if a screen is still open. */
  back(): boolean {
    // nothing open: do NOT repaint the base. Escape at the docked menu reaches
    // here every frame it is held, and re-rendering the menu underneath it
    // each time is both wasted work and a way to lose cursor state.
    if (!this.stack.length) return false;
    this.stack.pop();
    this.menuSelected = 0;
    const top = this.top;
    if (!top) this.showBase();
    else if (top.screen) top.screen.render();   // uncovered — re-paint itself
    else this.repaintLegacy(top.id);            // ...or ask the Game to
    return this.stack.length > 0;
  }

  /** Pop everything, back to the base state. */
  exit(): void {
    const had = this.stack.length > 0;
    this.stack.length = 0;
    this.menuSelected = 0;
    if (had) this.showBase();
  }

  /** Re-paint the top screen, after data changed underneath it. */
  render(): void {
    this.top?.screen?.render();
  }

  /**
   * One frame for the top screen.
   *
   * @returns false when the top screen has no implementation yet, so the
   * caller should fall through to its own handling.
   */
  update(i: Input): boolean {
    this.runMenuCursor(i);
    const top = this.top;
    if (!top?.screen) return false;
    this.apply(top.screen.input(i));
    return true;
  }

  private apply(outcome: ScreenOutcome): void {
    if (outcome === 'stay') return;
    if (outcome === 'back') this.back();
    else if (outcome === 'exit') this.exit();
    else this.open(outcome.open);
  }

  /**
   * Arrow keys and Enter drive any menu on screen, so every menu gets cursor
   * navigation without per-screen wiring: Enter injects the selected row's
   * shortcut, which is the key the screen already handles.
   *
   * ORDERING CONTRACT, and it is load-bearing: `Input.pressed()` CONSUMES the
   * tap, so anything running before the top screen can silently eat a key the
   * screen needed. This is safe only because it touches nothing unless a
   * `.menu` with shortcuts is actually on screen, and even then only arrows
   * and Enter. Do not widen it — add keys to the screen instead.
   */
  private runMenuCursor(i: Input): void {
    const items = [...document.querySelectorAll<HTMLElement>('#screen .menu div[data-key]')];
    if (!items.length) return;
    const down = i.pressed('ArrowDown');
    const up = i.pressed('ArrowUp');
    if (down || up) {
      this.menuSelected = (this.menuSelected + (down ? 1 : -1) + items.length) % items.length;
    }
    if (this.menuSelected >= items.length) this.menuSelected = 0;
    // re-applied every frame rather than only on movement: these screens
    // re-render on all sorts of events and would otherwise lose the highlight
    items.forEach((el, n) => el.classList.toggle('sel', n === this.menuSelected));
    if (i.pressed('Enter')) {
      const key = items[this.menuSelected].dataset.key;
      if (key) i.injectPress(key);
    }
  }

  /**
   * Route a click on the screen overlay.
   *
   * `data-key` becomes a keystroke, so a click and the shortcut printed beside
   * it take exactly the same path through the screen. `data-row` goes to
   * `select()`. Either way a screen implements ONE input surface.
   *
   * @returns true if the click was consumed.
   */
  click(el: HTMLElement, i: Input): boolean {
    const key = el.dataset.key;
    if (key !== undefined) {
      i.injectPress(key);
      return true;
    }
    const row = el.dataset.row;
    if (row !== undefined) {
      const screen = this.top?.screen;
      if (screen?.select) {
        screen.select(Number(row));
        return true;
      }
    }
    return false;
  }
}
