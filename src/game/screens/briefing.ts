// The mission briefing: several pages of text, read with left and right.

import { renderBriefing, BRIEFING_PAGES } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { Input } from '../../engine/input.ts';

export class BriefingScreen implements Screen {
  readonly id = 'briefing' as const;
  private page = 0;

  open(): void {
    this.page = 0;
    this.render();
  }

  render(): void {
    renderBriefing(this.page);
  }

  input(i: Input): ScreenOutcome {
    // Left/right rather than up/down: these are pages, and the menu cursor
    // owns up/down. Clamped, not wrapped — wrapping from the last page back
    // to the first reads as "you missed something".
    const last = BRIEFING_PAGES - 1;
    if (i.pressed('ArrowRight') || i.pressed('Enter')) {
      this.page = Math.min(last, this.page + 1);
      this.render();
    } else if (i.pressed('ArrowLeft')) {
      this.page = Math.max(0, this.page - 1);
      this.render();
    } else if (i.pressed('Escape') || i.pressed('KeyH')) {
      return 'back';
    }
    return 'stay';
  }
}
