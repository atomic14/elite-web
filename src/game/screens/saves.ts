// The commander file: the saves you made, the saves the game made, and the
// three screens over them.
//
// `storage.ts` owns where a save lives and `save-file.ts` owns what one is and
// what taking one costs. What lives here is the half above both: the list, the
// deliberate act of naming a save, and renaming a commander — plus the keyboard
// state machine for each, behind the Screen contract (invariant 13). Typing a
// name is `typed-name.ts`, saves that leave the browser as a file are
// `save-transfer.ts`, and STARTING a commander is `new-commander.ts`.
//
// Following the same discipline as NpcShip: these screens decide nothing about
// game state. They return an OUTCOME and the host applies it, so the mode
// machine stays in one place instead of being poked at from two.
//
// AND NOTHING HERE WRITES BECAUSE IT WAS LOOKED AT (docs/TODO/55). `open()`
// used to push a checkpoint so the list would include the run you were standing
// in; the run is a LINE ABOVE THE TABLE now, read out of state, because a
// screen that files a save for you the moment you press S is a screen you
// cannot open to check something.

import { generateGalaxy } from '../../galaxy/galaxy.ts';
import type { CommanderData } from '../commander.ts';
import { deleteSave, listSaves, setBootId } from '../storage.ts';
import {
  loadCost, newestFirst, saveLabel, summariseSave,
  type LiveRun, type SaveSummary,
} from '../save-file.ts';
import { rating } from '../rating.ts';
import type { WorldSnapshot } from '../snapshot.ts';
import { renderSaves } from '../../ui/screens.ts';
import type { Screen, ScreenOutcome } from '../../ui/screen-host.ts';
import type { StarSystem } from '../../galaxy/galaxy.ts';
import type { Input } from '../../engine/input.ts';
import { sfx } from '../../audio.ts';

/** The slice of the Game the screens over the shelf are allowed to see. */
export interface SavesContext {
  readonly commander: CommanderData;
  readonly systems: StarSystem[];
  /** which career's autosaves this session writes — see state.ts */
  readonly career: string;
  /**
   * The ship is destroyed. Read, never set: this screen is reachable over a
   * wreck (the game-over panel offers it), and three of its promises are only
   * true for a commander who still has a ship — a checkpoint that can be
   * written, a run that can be lost, and a name worth changing.
   */
  readonly dead: boolean;
  message(text: string, seconds: number): void;
  /** the whole world right now, for a save that is about to be written */
  capture(): WorldSnapshot;
  /**
   * Write the career's docked checkpoint before we leave it.
   * @returns whether the bytes landed — false for a full store, and false for a
   * dead commander, who has nothing to check-point.
   */
  checkpoint(): boolean;
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
 * The run in progress, for the line above the table.
 *
 * This is what `open()` used to buy by writing a checkpoint: the list showed
 * where you were because the act of looking had just filed it. Reading it out
 * of state costs nothing and cannot lose anything (docs/TODO/55).
 */
export function liveRun(ctx: SavesContext): LiveRun {
  const c = ctx.commander;
  return {
    career: ctx.career,
    name: c.name,
    place: systemNamer(ctx)(c.galaxy, c.systemIndex),
    credits: c.credits,
    rating: rating(c.combatScore ?? c.kills ?? 0).toUpperCase(),
    day: c.day ?? 0,
    over: ctx.dead,
  };
}

/** The commander file: everything on the shelf, and what you can do to it. */
export class SavesScreen implements Screen {
  readonly id = 'saves' as const;
  private selected = 0;
  private rows: SaveSummary[] = [];
  /** a delete waiting on a Y — deleting a save is not undoable */
  private pendingDelete: SaveSummary | null = null;
  /**
   * ...and a load waiting on a second Enter, for the same reason and a worse
   * one: a delete costs you a save you can see, and a load can cost you the run
   * you are in, which is not on the list at all (docs/TODO/55). The panel names
   * both sides before it happens and ESC backs out of it.
   */
  private pendingLoad: SaveSummary | null = null;

  private readonly ctx: () => SavesContext;

  constructor(ctx: () => SavesContext) {
    this.ctx = ctx;
  }

  /** Looking at the shelf. It writes NOTHING — see this file's header. */
  open(): void {
    this.selected = 0;
    this.pendingDelete = null;
    this.pendingLoad = null;
    this.render();
  }

  render(): void {
    const ctx = this.ctx();
    this.rows = saveRows(ctx);
    if (this.selected >= this.rows.length) this.selected = Math.max(0, this.rows.length - 1);
    const live = liveRun(ctx);
    renderSaves(this.rows, this.selected, live, {
      deleting: this.pendingDelete,
      loading: this.pendingLoad && { row: this.pendingLoad, cost: loadCost(this.pendingLoad, live) },
    });
  }

  select(row: number): void {
    // A confirmation is modal: the question names a row, so the row it names
    // must not move under it.
    if (this.pendingDelete || this.pendingLoad) return;
    this.selected = Math.max(0, Math.min(this.rows.length - 1, row));
    this.render();
  }

  input(i: Input): ScreenOutcome {
    const ctx = this.ctx();
    if (this.pendingDelete) return this.confirmDelete(i, ctx);
    if (this.pendingLoad) return this.confirmLoad(i, ctx);
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
    if (i.pressed('KeyS')) {
      // A wreck captures as a DOCKED world at the point of death, so saving one
      // and loading it back was a way to un-die. The panel does not offer S
      // over a wreck; this is the same answer for the key.
      if (ctx.dead) {
        ctx.message('YOUR SHIP IS GONE — THERE IS NOTHING LEFT TO SAVE', 4);
        sfx.refused();
        return 'stay';
      }
      return { open: 'save-name' };
    }
    if (i.pressed('KeyR')) {
      // Renaming writes a checkpoint to persist the new name, and a dead
      // commander has none to write, so the panel offers it only to the living.
      if (ctx.dead) return 'stay';
      return { open: 'naming' };
    }
    if (i.pressed('KeyD')) {
      const row = this.rows[this.selected];
      if (!row) return 'stay';
      if (row.kind === 'dock' && row.career === ctx.career) {
        ctx.message('THAT AUTOSAVE IS YOUR WAY BACK — IT CANNOT BE DELETED', 4);
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
      this.pendingLoad = row;
      this.render();
      return 'stay';
    }
    if (i.pressed('Escape')) return 'back';
    return 'stay';
  }

  private confirmDelete(i: Input, ctx: SavesContext): ScreenOutcome {
    if (i.pressed('KeyY')) {
      deleteSave(this.pendingDelete!.id);
      ctx.message(`DELETED ${saveLabel(this.pendingDelete!)}`, 3);
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

  /**
   * The second Enter. Every load in this file is a `location.reload()`, so the
   * whole act is: keep where we are, aim the boot pointer, and go.
   */
  private confirmLoad(i: Input, ctx: SavesContext): ScreenOutcome {
    const row = this.pendingLoad!;
    if (i.pressed('Escape') || i.pressed('KeyN')) {
      this.pendingLoad = null;
      this.render();
      return 'stay';
    }
    // The remedy the panel offers, and it stacks: the prompt returns here, and
    // the run has a name on it by the time the second Enter is pressed.
    if (i.pressed('KeyS') && !ctx.dead) return { open: 'save-name' };
    if (!i.pressed('Enter')) return 'stay';
    // Write the run we are leaving before we leave it. A commander who has just
    // been told "PUT DOWN AT LAVE AS YOU ARE NOW" must not have that quietly
    // fail: a refused checkpoint is the one case where loading really does cost
    // the run, so it refuses the load instead (docs/TODO/44's rule).
    if (!ctx.dead && !ctx.checkpoint()) {
      ctx.message('STORAGE FULL — COULD NOT KEEP THIS RUN, SO NOTHING WAS LOADED', 5);
      sfx.refused();
      this.pendingLoad = null;
      this.render();
      return 'stay';
    }
    if (!setBootId(row.id)) {
      // A refused pointer would reload into the NEWEST save rather than the
      // one that was picked, which is a load nobody asked for. Say so and
      // stay: the shelf is untouched either way.
      ctx.message('STORAGE FULL — COULD NOT SWITCH SAVES', 4);
      sfx.refused();
      this.pendingLoad = null;
      this.render();
      return 'stay';
    }
    location.reload();
    return 'stay';
  }
}
