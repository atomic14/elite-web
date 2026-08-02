// The manual page's only script: render the control tables from the game's
// own keymap.
//
// CLAUDE.md invariant 9 lists four places key bindings live and asks for them
// to be changed together. A hand-written table here would have made five, and
// the fifth is the one nobody remembers — a page you read once and never open
// again while developing. So it is generated from `allLayouts()`: change a
// binding in keymap.ts and this page changes with it, or it does not build.

import { allLayouts, type Keymap, type LayoutName } from './engine/keymap.ts';

/** Physical key codes are not what anybody calls these. */
const LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'SPACE',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

const label = (code: string): string =>
  LABELS[code] ?? (code.startsWith('Key') ? code.slice(3) : code);

const keys = (codes: string[]): string =>
  codes.map(label).map((k) => `<kbd>${k}</kbd>`).join(' <span class="or">or</span> ');

/** Flight rows, in the order they matter to someone learning. */
const FLIGHT: { of: keyof Keymap; what: string }[] = [
  { of: 'pitchDown', what: 'dive (nose down)' },
  { of: 'pitchUp', what: 'climb (nose up)' },
  { of: 'rollLeft', what: 'roll left' },
  { of: 'rollRight', what: 'roll right' },
  { of: 'accel', what: 'accelerate' },
  { of: 'decel', what: 'decelerate' },
  { of: 'fire', what: 'fire laser' },
];

/**
 * Commands are the same in both layouts, so they live here rather than in
 * keymap.ts — that module only owns the bindings that actually differ. Kept
 * beside the flight table so the page reads as one reference.
 */
const COMMANDS: [string, string][] = [
  ['J', 'torus drive (8× speed, cuts out near mass)'],
  ['H', 'hyperspace jump to your target'],
  ['E', 'E.C.M., destroys incoming missiles'],
  ['T', 'target missile'],
  ['M', 'fire missile'],
  ['U', 'unarm missile'],
  ['Y', 'jettison cargo'],
  ['C', 'docking computer'],
  ['N', 'short range chart'],
  ['G', 'galactic chart'],
  ['D', 'data on system'],
  ['I', 'commander status'],
  ['P', 'pause'],
  ['V', 'mouse flight'],
  ['1 2 3 4', 'views: front, rear, left, right'],
  ['?', 'controls guide'],
];

function table(name: LayoutName, map: Keymap): string {
  return `
    <div class="layout">
      <h3>${name === 'classic' ? 'Classic (1984, default)' : 'Modern (WASD)'}</h3>
      <table class="data">
        ${FLIGHT.map((r) => `<tr><td>${keys(map[r.of])}</td><td>${r.what}</td></tr>`).join('')}
      </table>
    </div>`;
}

const host = document.getElementById('controls-table');
if (host) {
  const layouts = allLayouts();
  host.innerHTML = `
    <div class="two">
      ${table('classic', layouts.classic)}
      ${table('modern', layouts.modern)}
    </div>
    <h3>Commands, the same in both layouts</h3>
    <table class="data cmd">
      ${COMMANDS.map(([k, what]) => `<tr><td><kbd>${k}</kbd></td><td>${what}</td></tr>`).join('')}
    </table>`;
}

// Highlight the section you're reading in the contents rail.
const links = [...document.querySelectorAll<HTMLAnchorElement>('#toc a[href^="#"]')];
const sections = links
  .map((a) => document.querySelector<HTMLElement>(a.getAttribute('href')!))
  .filter((s): s is HTMLElement => s !== null);

if (sections.length && 'IntersectionObserver' in window) {
  const seen = new Set<Element>();
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) seen.add(e.target);
      else seen.delete(e.target);
    }
    // topmost visible section wins
    const top = sections.find((s) => seen.has(s));
    for (const a of links) {
      a.classList.toggle('here', top !== undefined && a.getAttribute('href') === `#${top.id}`);
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const s of sections) observer.observe(s);
}
