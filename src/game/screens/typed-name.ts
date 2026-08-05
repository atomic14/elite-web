// One frame of typing a name, Elite-style: letters straight in, no DOM focus to
// fight, and no text field to select.
//
// ONE HOME, because THREE screens type a name — a save's and a rename
// (screens/saves.ts), and a new commander's (screens/new-commander.ts) — and
// the keys they accept have to be the alphabet `normaliseSaveName` keeps, or a
// name is one thing on the way in and another on the way out.
//
// It lived in `saves.ts` until docs/TODO/55, which is a file about the shelf:
// the keyboard belongs to whoever is typing, not to the list.

import { MAX_SAVE_NAME } from '../../constants/saves.ts';
import type { Input } from '../../engine/input.ts';

/**
 * @param pristine true while the buffer still holds an offered default, which
 * the first keystroke REPLACES rather than appends to: there is no way to
 * select text on these screens, so a pre-filled field would otherwise make
 * typing a new name mean typing it onto the end of the old one. A screen that
 * offers nothing passes false and can ignore the flag on the way back.
 * @returns the buffer after the frame, or null when nothing it accepts was
 * pressed — so a caller re-renders only when something changed.
 */
export function typedName(
  buffer: string, pristine: boolean, i: Input,
): { buffer: string; pristine: boolean } | null {
  let next = buffer;
  let fresh = pristine;
  let changed = false;
  if (i.pressed('Backspace')) {
    if (fresh) { next = ''; fresh = false; } else next = next.slice(0, -1);
    changed = true;
  }
  for (const code of i.drainPresses()) {
    const m = /^(?:Key([A-Z])|Digit([0-9])|Space)$/.exec(code);
    if (!m) continue;
    if (fresh) { next = ''; fresh = false; }
    if (next.length >= MAX_SAVE_NAME) break;
    next += code === 'Space' ? ' ' : (m[1] ?? m[2]);
    changed = true;
  }
  return changed ? { buffer: next, pristine: fresh } : null;
}
