// The commander file: the saves you made, the saves the game made, and the
// three screens over them.
//
// `storage.ts` owns where a save lives and `save-file.ts` owns what one is.
// What lives here is the half above both: the list, the deliberate act of
// naming a save, and renaming a commander — plus the keyboard state machine for
// each, behind the Screen contract (invariant 13). Saves that leave the browser
// as a file are `save-transfer.ts`.
//
// Following the same discipline as NpcShip: these screens decide nothing about
// game state. They return an OUTCOME and the host applies it, so the mode
// machine stays in one place instead of being poked at from two.

import { generateGalaxy } from '../../galaxy/galaxy.ts';
import { DEFAULT_NAME, type CommanderData } from '../commander.ts';
import {
  clearBootId, deleteSave, listSaves, namedSaveExists, setBootId,
} from '../storage.ts';
import {
  MAX_SAVE_NAME, newestFirst, normaliseSaveName, summariseSave,
  type SaveSummary,
} from '../save-file.ts';
import type { WorldSnapshot } from '../snapshot.ts';
import { renderSaves, renderNaming, renderSavePrompt } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';
import { sfx } from '../../audio.ts';

/** The slice of the Game these screens are allowed to see. */
export interface SavesContext {
  readonly commander: CommanderData;
  readonly systems: StarSystem[];
  /** which career's autosaves this session writes — see state.ts */
  readonly career: string;
  message(text: string, seconds: number): void;
  /** the whole world right now, for a save that is about to be written */
  capture(): WorldSnapshot;
  /** write the career's docked checkpoint before we leave it */
  checkpoint(): void;
  /** write a save the player named. The result is the reply, not an exception. */
  saveNamed(name: string): 'ok' | 'full' | 'failed';
}

/**
 * Which galaxy a save is in need not be the one being played, so the system
 * name is resolved per galaxy and cached for the length of one render.
 */
function systemNamer(ctx: SavesContext): (galaxy: number, index: number) => string {
  const cache = new Map<number, StarSystem[]>([[ctx.commander.galaxy, ctx.systems]]);
  return (galaxy, index) => {
    let systems = cache.get(galaxy);
    if (!systems) {
      systems = generateGalaxy(galaxy);
      cache.set(galaxy, systems);
    }
    return systems[index]?.name.toUpperCase() ?? '?';
  };
}

/** Every save on the shelf, as rows: named saves first, then autosaves. */
export function saveRows(ctx: SavesContext): SaveSummary[] {
  const name = systemNamer(ctx);
  const now = Date.now();
  const rows = listSaves()
    .map(({ id, record }) => summariseSave(id, record, now, name))
    .filter((s): s is SaveSummary => s !== null);
  const named = rows.filter((r) => r.kind === 'file').sort(newestFirst);
  // The docked checkpoint leads the autosaves because it is the one that is
  // always safe to take — decision 3.
  const auto = rows.filter((r) => r.kind !== 'file')
    .sort((a, b) => (a.kind === b.kind ? newestFirst(a, b) : a.kind === 'dock' ? -1 : 1));
  return [...named, ...auto];
}

/**
 * The way back after a death: this career's docked checkpoint.
 *
 * By construction the state you left the station in, because it is written on
 * docking AND immediately before launch (station.ts).
 */
export function checkpointSummary(ctx: SavesContext): SaveSummary | null {
  const rows = saveRows(ctx);
  return rows.find((r) => r.kind === 'dock' && r.career === ctx.career) ?? null;
}

/**
 * Start a fresh commander at Lave, WITHOUT erasing anything.
 *
 * Under numbered slots this deleted the slot you were in, because a slot was
 * the only place a career could be. It is not any more: clearing the boot
 * pointer starts a new career beside the saves you already have, and none of
 * them is touched. Reloads rather than resetting in place, for the reason
 * above.
 */
export function startNewCommander(): void {
  clearBootId();
  location.reload();
}

/** The commander file: everything on the shelf, and what you can do to it. */
export class SavesScreen implements Screen {
  readonly id = 'saves' as const;
  private selected = 0;
  private rows: SaveSummary[] = [];
  /** a delete waiting on a Y — deleting a save is not undoable */
  private pendingDelete: SaveSummary | null = null;

  private readonly ctx: () => SavesContext;

  constructor(ctx: () => SavesContext) {
    this.ctx = ctx;
  }

  /** Write where we are, so the list includes the run you are looking at. */
  open(): void {
    this.ctx().checkpoint();
    this.selected = 0;
    this.pendingDelete = null;
    this.render();
  }

  render(): void {
    const ctx = this.ctx();
    this.rows = saveRows(ctx);
    if (this.selected >= this.rows.length) this.selected = Math.max(0, this.rows.length - 1);
    renderSaves(this.rows, this.selected, ctx.career, this.pendingDelete?.name ?? null);
  }

  select(row: number): void {
    this.selected = Math.max(0, Math.min(this.rows.length - 1, row));
    this.render();
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (this.pendingDelete) return this.confirmDelete(i, ctx);
    const n = this.rows.length;
    // Arrows only. Every other list screen also takes W/S, and this is the one
    // screen where S means something else — it SAVES.
    if (n > 0 && i.pressed('ArrowUp')) {
      this.selected = (this.selected + n - 1) % n;
      this.render();
    }
    if (n > 0 && i.pressed('ArrowDown')) {
      this.selected = (this.selected + 1) % n;
      this.render();
    }
    if (i.pressed('KeyS')) return { open: 'save-name' };
    if (i.pressed('KeyR')) return { open: 'naming' };
    if (i.pressed('KeyD')) {
      const row = this.rows[this.selected];
      if (!row) return 'stay';
      if (row.kind === 'dock' && row.career === ctx.career) {
        ctx.message('THAT IS THE STATION YOU CAN ALWAYS GET BACK TO', 4);
        sfx.refused();
        return 'stay';
      }
      this.pendingDelete = row;
      this.render();
      return 'stay';
    }
    if (i.pressed('Enter')) {
      const row = this.rows[this.selected];
      if (!row) return 'back';
      // Write the career we are leaving before we leave it, then boot the one
      // that was picked. Every load in this file is a reload.
      ctx.checkpoint();
      setBootId(row.id);
      location.reload();
      return 'stay';
    }
    if (i.pressed('Escape')) return 'back';
    return 'stay';
  }

  private confirmDelete(i: Input, ctx: SavesContext): ScreenOutcome {
    if (i.pressed('KeyY')) {
      deleteSave(this.pendingDelete!.id);
      ctx.message(`DELETED ${this.pendingDelete!.name}`, 3);
      sfx.commanderDeleted();
      this.pendingDelete = null;
      this.render();
      return 'stay';
    }
    if (i.pressed('Escape') || i.pressed('KeyN')) {
      this.pendingDelete = null;
      this.render();
    }
    return 'stay';
  }
}

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
    let changed = false;
    if (i.pressed('Backspace')) {
      if (this.pristine) { this.buffer = ''; this.pristine = false; }
      else this.buffer = this.buffer.slice(0, -1);
      changed = true;
    }
    for (const code of i.drainPresses()) {
      const m = /^(?:Key([A-Z])|Digit([0-9])|Space)$/.exec(code);
      if (!m) continue;
      if (this.pristine) { this.buffer = ''; this.pristine = false; }
      if (this.buffer.length >= MAX_SAVE_NAME) break;
      this.buffer += code === 'Space' ? ' ' : (m[1] ?? m[2]);
      changed = true;
    }
    if (changed) this.render();
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
    renderNaming(this.buffer, this.ctx().commander.name);
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (i.pressed('Escape')) return 'back';
    if (i.pressed('Enter')) {
      const name = normaliseSaveName(this.buffer) || DEFAULT_NAME;
      ctx.commander.name = name;
      ctx.checkpoint();
      ctx.message(`COMMANDER ${name}`, 3);
      sfx.commanderNamed();
      return 'back';
    }
    let changed = false;
    if (i.pressed('Backspace')) {
      this.buffer = this.buffer.slice(0, -1);
      changed = true;
    }
    for (const code of i.drainPresses()) {
      const m = /^(?:Key([A-Z])|Digit([0-9])|Space)$/.exec(code);
      if (!m) continue;
      if (this.buffer.length >= MAX_SAVE_NAME) break;
      this.buffer += code === 'Space' ? ' ' : (m[1] ?? m[2]);
      changed = true;
    }
    if (changed) this.render();
    return 'stay';
  }
}
