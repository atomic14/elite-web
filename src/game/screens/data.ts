// "Data on system": the entry from the 1984 manual, plus whatever the living
// galaxy has to say about the place today.
//
// Reachable from the docked menu, the galactic chart and the short-range
// chart, and Escape has to go back to whichever one you came from. That used
// to need a `dataReturn: 'docked' | 'chart' | 'local'` field on the Game, set
// on the way in and consulted on the way out — a one-deep return stack for a
// single screen. Pushing it on the real stack deletes the problem: `back`
// returns to whatever is underneath, whatever that happens to be.

import { renderSystemData } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';

export interface DataContext {
  /** the system being read about — not necessarily the one you are in */
  readonly subject: StarSystem;
  /** where you actually are, for the distance line */
  readonly here: StarSystem;
  readonly galaxy: number;
  /** the living galaxy's latest word on the subject, when it has one */
  headline(index: number): string | undefined;
}

export class DataScreen implements Screen {
  readonly id = 'data' as const;
  private readonly ctx: () => DataContext;

  constructor(ctx: () => DataContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.render();
  }

  render(): void {
    const { subject, here, galaxy, headline } = this.ctx();
    renderSystemData(subject, here, headline(subject.index), galaxy);
  }

  input(i: Input): ScreenOutcome {
    // D closes it as well as opening it, so the key is a toggle
    return i.pressed('Escape') || i.pressed('KeyD') ? 'back' : 'stay';
  }
}
