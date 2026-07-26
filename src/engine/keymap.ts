// Keyboard layouts. CLASSIC is the 1984 BBC original and the default:
//   < > (comma/period) roll · S dive / X climb · SPACE/slash speed · A fire
// MODERN is the WASD scheme for contemporary muscle memory.
// Arrow keys fly in both (flight-style: down pulls up). Command keys
// (T/M/U/E/J/C/K/H/N/G/I/P/TAB/1-4) are identical in both layouts.

export type LayoutName = 'classic' | 'modern';

export interface Keymap {
  rollLeft: string[];
  rollRight: string[];
  /** pull up / climb */
  pitchUp: string[];
  /** push down / dive */
  pitchDown: string[];
  accel: string[];
  decel: string[];
  fire: string[];
}

const LAYOUTS: Record<LayoutName, Keymap> = {
  classic: {
    rollLeft: ['Comma', 'ArrowLeft'],
    rollRight: ['Period', 'ArrowRight'],
    pitchUp: ['KeyX', 'ArrowDown'],
    pitchDown: ['KeyS', 'ArrowUp'],
    accel: ['Space'],
    decel: ['Slash'],
    fire: ['KeyA', 'KeyF'], // A is the 1984 trigger; F kept as a familiar alias
  },
  modern: {
    rollLeft: ['KeyA', 'ArrowLeft', 'Comma'],
    rollRight: ['KeyD', 'ArrowRight', 'Period'],
    pitchUp: ['KeyS', 'ArrowDown'],
    pitchDown: ['KeyW', 'ArrowUp'],
    accel: ['Space'],
    decel: ['KeyX', 'Slash'],
    fire: ['KeyF'],
  },
};

const STORAGE_KEY = 'elite-web-keymap';

let active: LayoutName = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'modern' ? 'modern' : 'classic';
  } catch {
    return 'classic';
  }
})();

export function keymap(): Keymap {
  return LAYOUTS[active];
}

export function layoutName(): LayoutName {
  return active;
}

export function toggleLayout(): LayoutName {
  active = active === 'classic' ? 'modern' : 'classic';
  try {
    localStorage.setItem(STORAGE_KEY, active);
  } catch { /* storage unavailable */ }
  refreshHelpPanel();
  return active;
}

/** Every key that counts as "manual flight input" (combat-computer override). */
export function manualFlightKeys(): string[] {
  const k = LAYOUTS[active];
  return [...k.rollLeft, ...k.rollRight, ...k.pitchUp, ...k.pitchDown];
}

/** Rewrite the `?` guide's flight rows to describe the active layout. */
export function refreshHelpPanel(): void {
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  if (active === 'classic') {
    set('help-pitch', 'S / X · ↑ / ↓');
    set('help-pitch-desc', 'dive / climb (1984 style)');
    set('help-roll', ', / . · ← / →');
    set('help-decel', 'SPACE · /');
    set('help-fire', 'A (or F)');
  } else {
    set('help-pitch', 'W / S · ↑ / ↓');
    set('help-pitch-desc', 'pitch (↓ pulls up)');
    set('help-roll', 'A / D · ← / → · , / .');
    set('help-decel', 'SPACE · X or /');
    set('help-fire', 'F');
  }
  set('help-layout', `ACTIVE LAYOUT: ${active.toUpperCase()} — toggle with B when docked`);
}
