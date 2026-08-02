// Work on offer at this station: pick one and sign for it.
//
// The rules live in game/contracts.ts so the headless campaign runs the same
// code the game does (CLAUDE.md invariant 10). This is only the screen.

import { renderContracts } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { Contract, CommanderData } from '../commander.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';

export interface ContractsContext {
  readonly commander: CommanderData;
  readonly system: StarSystem;
  readonly systems: StarSystem[];
  readonly offers: Contract[];
  /** sign for `offers[index]` — the Game owns what accepting means */
  accept(index: number): void;
}

export class ContractsScreen implements Screen {
  readonly id = 'contracts' as const;
  private readonly ctx: () => ContractsContext;
  /** @internal — game.ts mirrors this for the test harness */
  selected = 0;

  constructor(ctx: () => ContractsContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.selected = 0;
    this.render();
  }

  render(): void {
    const { system, systems, commander, offers } = this.ctx();
    renderContracts(system, systems, commander, offers, this.selected);
  }

  select(row: number): void {
    this.selected = row;
    this.render();
  }

  input(i: Input): ScreenOutcome {
    const { offers } = this.ctx();
    let redraw = false;
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.selected = Math.max(0, this.selected - 1);
      redraw = true;
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.selected = Math.min(offers.length - 1, this.selected + 1);
      redraw = true;
    }
    if (i.pressed('KeyA') || i.pressed('Enter')) {
      this.ctx().accept(this.selected);
      // accepting removes the offer, so the selection may now be past the end
      this.selected = Math.max(0, Math.min(this.selected, this.ctx().offers.length - 1));
      redraw = true;
    }
    if (i.pressed('Escape')) return 'back';
    if (redraw) this.render();
    return 'stay';
  }
}
