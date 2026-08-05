// The galactic chart and the short-range chart.
//
// One class, two instances. They differ only in scale, in which render/draw
// pair they call, and in how a click maps to chart coordinates — everything
// else (the cursor, targeting, type-to-find, the market estimate) is identical,
// and was already written once and branched on `mode === 'local'` throughout.
//
// The most involved screen in the game, and the two contract additions it
// needed are both genuine: `tick(dt)` because the cursor moves while an arrow
// is HELD, where every other screen acts on discrete taps, and `clickAt`
// because a canvas has to turn pixels into its own coordinate space.
//
// Two sub-modes live here rather than on the stack. Type-to-find and the
// market estimate are not places you navigate to — they are states of the
// chart itself, they swallow the keyboard while active, and Escape leaves the
// sub-mode rather than the screen. Pushing them would make Escape ambiguous.

import type { ChartState } from '../chart-state.ts';
import {
  renderChart, drawChart, renderLocalChart, drawLocalChart, renderMarketEstimate,
  nearestSystem, chartCoordsFromClick, localCoordsFromClick,
} from '../../ui/screens.ts';
import type { Screen, ScreenOutcome, ScreenId } from '../../ui/screen-host.ts';
import type { CommanderData } from '../commander.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';
import { marketEstimate } from '../contracts.ts';
import { sfx } from '../../audio.ts';
import { LOCAL_SCALE, CHART_SPAN_X } from '../../constants/chart-metric.ts';

export interface ChartContext {
  readonly commander: CommanderData;
  readonly systems: StarSystem[];
  /** where you are now — the short-range chart centres on it */
  readonly system: StarSystem;
  /** cursor and hyperspace target, shared by both charts */
  readonly chart: ChartState;
  /** remember which system the data screen should read about */
  viewData(sys: StarSystem): void;
  /** the living galaxy's ±25% price pressure THERE, for the market estimate */
  priceMultiplier(systemIndex: number, commodity: number): number;
}

export class ChartScreen implements Screen {
  readonly id: ScreenId;
  private readonly local: boolean;
  private readonly ctx: () => ChartContext;
  /** typed prefix while type-to-find is active, or null when it is not */
  private find: string | null = null;
  /** the market-estimate panel is up, and owns Escape */
  private estimate = false;

  constructor(id: 'chart' | 'local', ctx: () => ChartContext) {
    this.id = id;
    this.local = id === 'local';
    this.ctx = ctx;
  }

  open(): void {
    const { chart, system } = this.ctx();
    this.find = null;
    this.estimate = false;
    chart.cursorX = system.x;
    chart.cursorY = system.y;
    this.render();
  }

  render(): void {
    const { systems, commander, chart } = this.ctx();
    if (this.local) renderLocalChart(systems, commander, chart);
    else renderChart(systems, commander, chart);
  }

  /** Repaint the canvas only, keeping the surrounding chrome. */
  private redraw(): void {
    const { systems, commander, chart } = this.ctx();
    if (this.local) drawLocalChart(systems, commander, chart);
    else drawChart(systems, commander, chart);
    if (this.find !== null) {
      const info = document.getElementById(this.local ? 'local-info' : 'chart-info');
      if (info) info.textContent = `FIND: ${this.find}_`;
    }
  }

  /** The system under the cursor, if any. */
  private underCursor(radius?: number): StarSystem | null {
    const { systems, chart } = this.ctx();
    return nearestSystem(systems, chart.cursorX, chart.cursorY, radius);
  }

  tick(dt: number, i: Input): void {
    if (this.find !== null || this.estimate) return;
    this.moveCursor(dt, i);
  }

  input(i: Input): ScreenOutcome {
    if (this.estimate) {
      if (i.pressed('Escape') || i.pressed('KeyM')) {
        this.estimate = false;
        this.render();
      }
      return 'stay';
    }
    if (this.find !== null) {
      this.typeToFind(i);
      return 'stay';
    }
    if (i.pressed('KeyM')) {
      const near = this.underCursor();
      if (near) {
        this.estimate = true;
        const ctx = this.ctx();
        // contracts.ts owns what the estimate IS; this screen only asks for it
        renderMarketEstimate(
          near,
          marketEstimate(near, (c) => ctx.priceMultiplier(near.index, c)),
          ctx.commander);
      }
      return 'stay';
    }
    if (i.pressed('KeyD')) {
      const near = this.underCursor();
      if (!near) return 'stay';
      this.ctx().viewData(near);
      // pushed ON TOP: Escape from the data screen comes back to this chart,
      // with its cursor and target where they were
      return { open: 'data' };
    }
    if (i.pressed('KeyF')) {
      this.find = '';
      this.redraw();
      return 'stay';
    }
    if (i.pressed('Enter')) {
      const near = this.underCursor();
      if (near) {
        this.ctx().chart.targetIndex = near.index;
        sfx.chartTargetSelected();
        this.redraw();
      }
    }
    if (i.pressed('Escape')) return 'back';
    return 'stay';
  }

  clickAt(target: HTMLElement, e: MouseEvent): boolean {
    if (this.estimate || this.find !== null) return false;
    if (!(target instanceof HTMLCanvasElement)) return false;
    const { chart, system, systems } = this.ctx();

    const coords = this.local
      ? localCoordsFromClick(target, e.clientX, e.clientY, system)
      : chartCoordsFromClick(target, e.clientX, e.clientY);
    chart.cursorX = Math.max(0, Math.min(255, coords.x));
    chart.cursorY = Math.max(0, Math.min(255, coords.y));

    // snap radius of ~28 screen px on either chart, so clicking a star targets
    // it while clicking empty sky just moves the cursor
    const pxPerUnit = this.local ? LOCAL_SCALE : target.width / CHART_SPAN_X;
    const near = nearestSystem(systems, chart.cursorX, chart.cursorY, 28 / pxPerUnit);
    if (near) {
      chart.cursorX = near.x;
      chart.cursorY = near.y;
      chart.targetIndex = near.index;
      sfx.chartTargetSelected();
    }
    this.redraw();
    return true;
  }

  /** Discrete step per tap, plus continuous motion while a key is held. */
  private moveCursor(dt: number, i: Input): void {
    const { chart } = this.ctx();
    // the local chart is ~13x zoomed, so the cursor moves proportionally finer
    const tapStep = this.local ? 1 : 3;
    const speed = (this.local ? 12 : 55) * dt;
    let moved = false;
    const taps = {
      left: i.pressedCount('ArrowLeft'),
      right: i.pressedCount('ArrowRight'),
      up: i.pressedCount('ArrowUp'),
      down: i.pressedCount('ArrowDown'),
    };
    if (taps.left) { chart.cursorX -= tapStep * taps.left; moved = true; }
    if (taps.right) { chart.cursorX += tapStep * taps.right; moved = true; }
    if (taps.up) { chart.cursorY -= 2 * tapStep * taps.up; moved = true; }
    if (taps.down) { chart.cursorY += 2 * tapStep * taps.down; moved = true; }
    if (i.held('ArrowLeft', 'KeyA')) { chart.cursorX -= speed; moved = true; }
    if (i.held('ArrowRight', 'KeyD')) { chart.cursorX += speed; moved = true; }
    if (i.held('ArrowUp', 'KeyW')) { chart.cursorY -= speed * 2; moved = true; }
    if (i.held('ArrowDown', 'KeyS')) { chart.cursorY += speed * 2; moved = true; }
    if (moved) {
      chart.cursorX = Math.max(0, Math.min(255, chart.cursorX));
      chart.cursorY = Math.max(0, Math.min(255, chart.cursorY));
      this.redraw();
    }
  }

  /** Letters filter, the cursor jumps to the first match. */
  private typeToFind(i: Input): void {
    const { systems, chart } = this.ctx();
    let changed = false;
    for (const code of i.drainPresses()) {
      if (code.startsWith('Key')) {
        this.find += code.slice(3);
        changed = true;
      } else if (code === 'Backspace') {
        this.find = this.find!.slice(0, -1);
        changed = true;
      } else if (code === 'Enter' || code === 'Escape') {
        this.find = null;
        this.redraw();
        return;
      }
    }
    if (changed && this.find) {
      const match = systems.find((s) => s.name.toUpperCase().startsWith(this.find!.toUpperCase()));
      if (match) {
        chart.cursorX = match.x;
        chart.cursorY = match.y;
      }
    }
    if (changed) this.redraw();
  }
}
