// Starting a new commander: asking who they are, and putting the last one down.
//
// Split from `screens/saves.ts` because it is a different act from filing a
// save. The commander file is about the shelf; this is about IDENTITY — the
// name typed here is what `save:auto:<CAREER>:*` is keyed by (save-file.ts), so
// it is the one name in the game that cannot be handed out twice.
//
// It used to be generated. A fresh run took `freshCareerName()`, which appends
// a 2 to the name already on the shelf, so a second commander was called
// JAMESON 2 — which reads as a second save of JAMESON rather than as a
// different pilot, and it looked like the game had named your character for
// you, because it had (docs/TODO/56). Now it is asked for, and a name already
// in use is REFUSED rather than quietly suffixed: appending a digit to a name
// somebody chose is the same fault one step further on.

import { normaliseSaveName } from '../save-file.ts';
import { bootNewCommander, commanderNameTaken } from '../storage.ts';
import { renderNewCommander } from '../../ui/screens.ts';
import { typedName } from './typed-name.ts';
import type { SavesContext } from './saves.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { Input } from '../../engine/input.ts';
import { sfx } from '../../audio.ts';

/**
 * Put the commander you are flying DOWN, and begin `name` beside them.
 *
 * Under numbered slots this deleted the slot you were in, because a slot was
 * the only place a commander could be. It is not any more — so this writes the
 * checkpoint of the one being set aside (it is one of the saves the panel
 * promises stays where it is), and then aims the next boot AWAY from the shelf
 * rather than at nothing.
 *
 * That distinction is the whole of docs/TODO/45. Clearing the pointer looks
 * like the same act and is not: a missing pointer means "lost", and `bootSave`
 * answers a lost pointer with the newest record on the shelf — which is the
 * commander you just asked to put down, name and all, so their autosaves went
 * on landing on the same keys and the confirm panel's "start again at Lave with
 * 100.0 Cr" was a lie. `bootNewCommander(name)` says "none of them, and here is
 * who to start instead", and the boot on the far side of the reload builds that
 * commander (storage.ts).
 *
 * @returns false when the store would not take the pointer — nothing has
 * changed and nothing has been lost, but the caller must not claim otherwise.
 */
export function startNewCommander(ctx: SavesContext, name: string): boolean {
  ctx.checkpoint();
  if (!bootNewCommander(name)) return false;
  location.reload();
  return true;
}

/**
 * The prompt that names a new commander. The third use of the same keyboard —
 * naming a save and renaming a pilot are the other two (saves.ts).
 *
 * Two things make it different from those. It starts BLANK and refuses an empty
 * name, because the only default it could offer is a suffix of a name somebody
 * else chose. And it refuses a name that is already flying, rather than taking
 * it: two commanders under one name would share an autosave group, and the
 * second one's first docking would evict the first one's way back.
 */
export class NewCommanderScreen implements Screen {
  readonly id = 'new-name' as const;
  private buffer = '';

  private readonly ctx: () => SavesContext;

  constructor(ctx: () => SavesContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.buffer = '';
    this.render();
  }

  render(): void {
    renderNewCommander(this.buffer, this.ctx().commander.name);
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (i.pressed('Escape')) return 'back';
    if (i.pressed('Enter')) return this.begin(ctx);
    const typed = typedName(this.buffer, false, i);
    if (typed) {
      this.buffer = typed.buffer;
      this.render();
    }
    return 'stay';
  }

  private begin(ctx: SavesContext): ScreenOutcome {
    const name = normaliseSaveName(this.buffer);
    if (!name) {
      ctx.message('A COMMANDER NEEDS A NAME', 3);
      sfx.refused();
      return 'stay';
    }
    if (commanderNameTaken(name)) {
      // Refused rather than made unique, which is the point of the whole item:
      // a game that silently answers BOB with BOB 2 has named the character.
      ctx.message(`${name} IS ALREADY FLYING — CHOOSE ANOTHER NAME`, 4);
      sfx.refused();
      return 'stay';
    }
    // The page is on its way out; whatever this returns is never painted.
    if (startNewCommander(ctx, name)) return 'stay';
    // ...unless the pointer never landed, in which case this session is still
    // the commander it was, and saying nothing would leave the player looking
    // at a confirmation that had just promised them Lave and 100.0 Cr.
    ctx.message('STORAGE FULL — YOU ARE STILL FLYING THIS COMMANDER', 5);
    sfx.refused();
    return 'back';
  }
}
