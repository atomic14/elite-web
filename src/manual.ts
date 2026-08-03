// The manual page's only script: render the control tables from the game's
// own key tables.
//
// CLAUDE.md's key-bindings invariant asks for one home per binding, and for
// every surface that lists it to be rendered. A hand-written table here is the
// one nobody remembers — a page you read once and never open again — and
// this file HAD one: a COMMANDS array that had missed the combat computer, the
// energy bomb, the galactic jump, the distress beacon and ⇧Y, and that listed D
// as a flight key when it is bound at the station and nowhere else. So both
// tables are generated now: the flight axes from `allLayouts()`, the commands
// from `BINDINGS` and `COMMAND_HELP` via `ui/key-help.ts`, per mode, so the
// scope cannot be wrong either.

import { allLayouts, type Keymap, type LayoutName } from './engine/keymap.ts';
import { keyLabel, manualCommandsHtml } from './ui/key-help.ts';

const keys = (codes: string[]): string =>
  codes.map((c) => keyLabel(c)).map((k) => `<kbd>${k}</kbd>`).join(' <span class="or">or</span> ');

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
    ${manualCommandsHtml()}`;
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
