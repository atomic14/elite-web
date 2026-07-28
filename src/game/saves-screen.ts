// Commander files and the saves/naming screens.
//
// The first block lifted out of game.ts, and chosen first because it is the
// most genuinely independent thing in there: it touches no flight, no NPCs, no
// physics, no market and no contracts. It reads and writes commanders, and it
// runs two small screens.
//
// `commander.ts` already owns the storage itself (slots, keys, migration).
// What lived in game.ts was the half above it — file import/export, and the
// keyboard state machine for the slot list and the name entry.
//
// Following the same discipline as NpcShip: this module decides nothing about
// game state. It returns an OUTCOME and the Game applies it, so the mode
// machine stays in one place instead of being poked at from two.

import {
  saveCommander, deleteSlot, currentSlot, setCurrentSlot, readSlot,
  formatCredits, SAVE_SLOTS, DEFAULT_NAME,
  type CommanderData,
} from './commander';
import { renderSaves, renderNaming } from '../ui/screens';
import type { StarSystem } from '../galaxy/galaxy';
import type { Input } from '../engine/input';
import { sfx } from '../audio';

/** What the Game should do next. The screen never changes mode itself. */
export type SavesOutcome =
  /** nothing to do — stay on the current screen */
  | 'stay'
  /** show the slot list */
  | 'saves'
  /** show name entry */
  | 'naming'
  /** leave the saves screens entirely, back to the docked menu */
  | 'close';

/** The slice of the Game these screens are allowed to see. */
export interface SavesContext {
  readonly commander: CommanderData;
  readonly systems: StarSystem[];
  message(text: string, seconds: number): void;
}

/**
 * Write the current commander out as a JSON file.
 *
 * Named for the ship rather than the player so a folder of backups is
 * readable at a glance.
 */
export function exportCommanderFile(
  commander: CommanderData,
  systemName: string,
  message: (text: string, seconds: number) => void,
): void {
  const blob = new Blob([JSON.stringify(commander, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download =
    `elite-commander-${systemName.toLowerCase()}-${formatCredits(commander.credits).replace(' ', '')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  message('COMMANDER EXPORTED', 3);
}

/**
 * Load a commander from a JSON file, replacing the current save.
 *
 * Writes through `saveCommander(..., currentSlot())`. It once wrote to the
 * bare 'elite-web-commander' key, which is where saves lived BEFORE slots
 * existed, and the result was silent data loss twice over: slot 1 already
 * exists so the migration skipped the import, and then the next boot cleared
 * that legacy key. The imported commander vanished without a word. The keys
 * are load-bearing — see CLAUDE.md.
 */
export function importCommanderFile(onFailure: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<CommanderData>;
      if (typeof parsed.credits !== 'number' || typeof parsed.systemIndex !== 'number') {
        throw new Error('not a commander file');
      }
      saveCommander(parsed as CommanderData, currentSlot());
      location.reload(); // boot cleanly from the imported save
    } catch {
      onFailure();
    }
  };
  input.click();
}

/**
 * Throw the current commander away and boot a fresh one at Lave.
 *
 * Reloads rather than resetting in place: a career leaves state in the living
 * galaxy, contract offers, chart target and mission progress, and a clean boot
 * is far more trustworthy than trying to zero all of it by hand.
 *
 * `deleteSlot(currentSlot())`, NOT `removeItem('elite-web-commander')` — that
 * is the pre-slots key, so the old version deleted nothing and the reload
 * loaded the same commander straight back. You asked to start again and got
 * your old ship, cargo and equipment.
 */
export function startNewCommander(): void {
  deleteSlot(currentSlot());
  location.reload();
}

/** The slot list and the name-entry screen, and the little state they need. */
export class SavesScreen {
  private selected = 0;
  private nameBuffer = '';

  /** Save where we are, then show the list with the current slot highlighted. */
  open(ctx: SavesContext): void {
    saveCommander(ctx.commander); // so the slot you're on is up to date
    this.selected = currentSlot() - 1;
    this.render(ctx);
  }

  render(ctx: SavesContext): void {
    const slots = Array.from({ length: SAVE_SLOTS }, (_, i) => readSlot(i + 1));
    renderSaves(ctx.systems, slots, this.selected, currentSlot());
  }

  handleSlotInput(i: Input, ctx: SavesContext): SavesOutcome {
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.selected = (this.selected + SAVE_SLOTS - 1) % SAVE_SLOTS;
      this.render(ctx);
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.selected = (this.selected + 1) % SAVE_SLOTS;
      this.render(ctx);
    }
    if (i.pressed('KeyR')) {
      // start blank: pre-filling looks helpful but there is no way to select
      // it, so typing a new name just appends to the old one
      this.nameBuffer = '';
      renderNaming(this.nameBuffer, ctx.commander.name);
      return 'naming';
    }
    if (i.pressed('KeyD')) {
      const slot = this.selected + 1;
      if (slot === currentSlot()) {
        ctx.message('CANNOT DELETE THE COMMANDER YOU ARE FLYING', 3);
        sfx.beep(220);
      } else {
        deleteSlot(slot);
        this.render(ctx);
        sfx.beep(400, 0.1);
      }
      return 'stay';
    }
    if (i.pressed('Enter')) {
      const slot = this.selected + 1;
      if (slot === currentSlot()) return 'close';
      // Switch commanders by reloading: a career leaves state across the
      // living galaxy, contracts, chart target and mission progress, and a
      // clean boot is far more trustworthy than zeroing all of it by hand.
      saveCommander(ctx.commander);
      setCurrentSlot(slot);
      location.reload();
      return 'stay';
    }
    if (i.pressed('Escape')) return 'close';
    return 'stay';
  }

  /** Elite-style name entry: letters straight in, no DOM focus to fight. */
  handleNamingInput(i: Input, ctx: SavesContext): SavesOutcome {
    if (i.pressed('Escape')) {
      this.render(ctx);
      return 'saves';
    }
    if (i.pressed('Enter')) {
      const name = this.nameBuffer.trim() || DEFAULT_NAME;
      ctx.commander.name = name;
      saveCommander(ctx.commander);
      this.render(ctx);
      ctx.message(`COMMANDER ${name}`, 3);
      sfx.beep(700, 0.1);
      return 'saves';
    }
    let changed = false;
    if (i.pressed('Backspace')) {
      this.nameBuffer = this.nameBuffer.slice(0, -1);
      changed = true;
    }
    for (const code of i.drainPresses()) {
      const m = /^(?:Key([A-Z])|Digit([0-9])|Space)$/.exec(code);
      if (!m) continue;
      if (this.nameBuffer.length >= 12) break;
      this.nameBuffer += code === 'Space' ? ' ' : (m[1] ?? m[2]);
      changed = true;
    }
    if (changed) renderNaming(this.nameBuffer, ctx.commander.name);
    return 'stay';
  }
}
