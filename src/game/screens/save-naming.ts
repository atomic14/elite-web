// Typing a name at the station: naming a SAVE, and renaming the COMMANDER.
//
// Two screens, one keyboard (`typed-name.ts`), and one thing worth keeping
// straight — they act on different nouns. A save's name IS its identity on the
// shelf, so typing one that exists replaces it; a commander's name is what the
// pilot is CALLED today, and deliberately does not move a single save.
//
// Split out of `saves.ts` in docs/TODO/55, which is a file about the list of
// saves and what you can do to it. The list took on a load confirmation there;
// naming was never the same subject, and "the list AND naming AND renaming" was
// the sort of header that means a file has stopped being about one thing.
//
// `SavesContext` is still `saves.ts`'s — it is the slice of the Game every
// screen over the shelf sees, and a second copy of it would be a second answer
// to what these screens may touch.

import { DEFAULT_NAME } from '../../constants/commander.ts';
import { namedSaveExists } from '../storage.ts';
import { normaliseSaveName } from '../save-file.ts';
import { typedName } from './typed-name.ts';
import type { SavesContext } from './saves.ts';
import { renderNaming, renderSavePrompt } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { Input } from '../../engine/input.ts';
import { sfx } from '../../audio.ts';

/**
 * Typing a name for a save. Elite-style: letters straight in, no DOM focus to
 * fight.
 *
 * The name IS the identity of a manual save, so typing one that exists REPLACES
 * it — and because the default offered is the commander's own name, a second
 * career would otherwise overwrite the first by pressing Enter twice. It asks
 * first (decision 4).
 */
export class SavePromptScreen implements Screen {
  readonly id = 'save-name' as const;
  private buffer = '';
  /** true until the player types: the offered default is replaced, not appended */
  private pristine = true;
  private confirming = false;

  private readonly ctx: () => SavesContext;

  constructor(ctx: () => SavesContext) {
    this.ctx = ctx;
  }

  open(): void {
    this.buffer = normaliseSaveName(this.ctx().commander.name) || DEFAULT_NAME;
    this.pristine = true;
    this.confirming = false;
    this.render();
  }

  render(): void {
    renderSavePrompt(this.buffer, this.confirming);
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (i.pressed('Escape')) {
      if (!this.confirming) return 'back';
      this.confirming = false;
      this.render();
      return 'stay';
    }
    if (this.confirming) {
      if (i.pressed('KeyY') || i.pressed('Enter')) return this.write(ctx);
      if (i.pressed('KeyN')) { this.confirming = false; this.render(); }
      return 'stay';
    }
    if (i.pressed('Enter')) {
      const name = normaliseSaveName(this.buffer);
      if (!name) {
        ctx.message('A SAVE NEEDS A NAME', 3);
        sfx.refused();
        return 'stay';
      }
      if (namedSaveExists(name)) {
        this.confirming = true;
        this.render();
        return 'stay';
      }
      return this.write(ctx);
    }
    const typed = typedName(this.buffer, this.pristine, i);
    if (typed) {
      this.buffer = typed.buffer;
      this.pristine = typed.pristine;
      this.render();
    }
    return 'stay';
  }

  private write(ctx: SavesContext): ScreenOutcome {
    const name = normaliseSaveName(this.buffer);
    const result = ctx.saveNamed(name);
    if (result === 'ok') {
      ctx.message(`SAVED AS ${name}`, 3);
      sfx.commanderNamed();
      return 'back';
    }
    ctx.message(result === 'full'
      ? 'NO ROOM FOR ANOTHER SAVE — DELETE ONE FIRST'
      : 'SAVE FAILED — STORAGE FULL. NOTHING WAS CHANGED', 5);
    sfx.refused();
    return 'back';
  }
}

/**
 * Renaming the COMMANDER, which is not the same act as naming a save.
 *
 * WHAT IT DOES, and it is stated on the screen rather than left to be found
 * out: it changes what you are CALLED — `CommanderData.name`, which is what the
 * status screen, the docked menu and the save prompt show — and it does NOT
 * move your saves. They stay filed under the name you were created with, which
 * is what `save:auto:<CAREER>:*` is keyed by (save-file.ts).
 *
 * That is a decision, not an omission (docs/TODO/56). Moving them would be a
 * write across five keys — the checkpoint, three flight slots and the boot
 * pointer — with a half-done state in the middle of it, and TODO 44's rule is
 * that nothing may be deleted on the strength of a write that failed. A rename
 * that half-succeeded would leave a commander addressable under two names or
 * under neither, so the cheap act stays cheap and the screen says what it did.
 *
 * Pushed on top of the file list rather than sitting beside it as a peer mode,
 * so cancelling is just `back` and the list underneath re-paints itself. It
 * owns its own buffer — nothing else has any business reading a half-typed
 * name.
 */
export class NamingScreen implements Screen {
  readonly id = 'naming' as const;
  private buffer = '';

  private readonly ctx: () => SavesContext;

  constructor(ctx: () => SavesContext) {
    this.ctx = ctx;
  }

  open(): void {
    // start blank: pre-filling looks helpful but there is no way to select
    // it, so typing a new name just appends to the old one
    this.buffer = '';
    this.render();
  }

  render(): void {
    const ctx = this.ctx();
    renderNaming(this.buffer, ctx.commander.name, ctx.career);
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (i.pressed('Escape')) return 'back';
    if (i.pressed('Enter')) {
      const name = normaliseSaveName(this.buffer) || DEFAULT_NAME;
      ctx.commander.name = name;
      ctx.checkpoint();
      // Both halves, because the second is the surprising one and a player who
      // has just renamed themselves is about to look at the list.
      ctx.message(`COMMANDER ${name} — SAVES STAY FILED UNDER ${ctx.career}`, 4);
      sfx.commanderNamed();
      return 'back';
    }
    const typed = typedName(this.buffer, false, i);
    if (typed) {
      this.buffer = typed.buffer;
      this.render();
    }
    return 'stay';
  }
}
