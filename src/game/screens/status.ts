// Commander status: what you are flying, carrying and wanted for.
//
// The simplest screen in the game, and a good one to read first if you are
// about to write another: it is the whole Screen contract and nothing else.

import { LEGAL_NAMES, type CommanderData } from '../commander.ts';
import { renderStatus } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';

export interface StatusContext {
  readonly commander: CommanderData;
  readonly systems: StarSystem[];
  /** the hyperspace target, shown as your next destination */
  readonly targetIndex: number | null;
}

export class StatusScreen implements Screen {
  readonly id = 'status' as const;
  private readonly ctx: () => StatusContext;

  constructor(ctx: () => StatusContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.render();
  }

  render(): void {
    const { systems, commander, targetIndex } = this.ctx();
    renderStatus(systems, commander, targetIndex, LEGAL_NAMES[commander.legalStatus]);
  }

  input(i: Input): ScreenOutcome {
    return i.pressed('Escape') ? 'back' : 'stay';
  }
}
