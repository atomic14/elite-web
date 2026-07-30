// State: that all of it is saved, that it repeats, and that none of it is ambient.
//
// The bug class this project has shipped five times: a snapshot that forgot a
// field, so two reloads agreed with each other but not with the run they came
// from. A name-presence grep passes through every one of those, so the round-trip
// test flies the state dirty first and compares values.
// 
// The ambient-globals ban is here for the same reason — a rule read from a
// `window.__` flag is a field that is not in the snapshot (invariant 12).

import { readFileSync, readdirSync } from 'node:fs';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld, random } from '../src/game/rng.ts';
import { check } from './harness.ts';

// --- anything that drives behaviour is state ------------------------------

// Chris's rule, and the one this whole refactor turned on: "anything that
// drives behaviour in the system that is not a constant" belongs in the state
// object, so it is persisted. A game constant may live outside it; a value
// worked out at runtime may not.
//
// The signature of a violation is a field initialised FROM THE DICE that sits
// outside the state literal — it cannot be re-derived on restore, because by
// then the stream is somewhere else entirely. Four of these were found by
// hand, one at a time, each costing a round of "two reloads agree with each
// other but not with the run they came from": packOffset, docksHere,
// tumbleAxis and the E.C.M. roll.

console.log('\nbehaviour-driving values are state');
{
  const npcSrc = readFileSync(new URL('../src/game/npc.ts', import.meta.url), 'utf8');
  const cls = npcSrc.slice(npcSrc.indexOf('export class NpcShip'));
  // field declarations at class level (two-space indent), not inside a method
  const fieldDecls = [...cls.matchAll(/^ {2}(?:private |readonly |protected )*([a-zA-Z_]+)\s*(?::[^=\n]+)?=\s*([^\n;]+);/gm)];
  const fromDice = fieldDecls.filter(([, , init]) =>
    /random\(\)|randomDirection\(|Math\.random/.test(init));
  check(`no NpcShip field is rolled outside state${fromDice.length ? ' — ' + fromDice.map((m) => m[1]).join(', ') : ''}`,
    fromDice.length === 0);

  const gameSrc = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  const gcls = gameSrc.slice(gameSrc.indexOf('export class Game'));
  const gFields = [...gcls.matchAll(/^ {2}(?:private |readonly |protected )*([a-zA-Z_]+)\s*(?::[^=\n]+)?=\s*([^\n;]+);/gm)];
  const gDice = gFields.filter(([, , init]) => /random\(\)|randomDirection\(|Math\.random/.test(init));
  check(`no Game field is rolled outside state${gDice.length ? ' — ' + gDice.map((m) => m[1]).join(', ') : ''}`,
    gDice.length === 0);

  // and the state objects must actually be reachable for a generic walk
  check('NpcState is one object', /readonly state: NpcState;/.test(npcSrc));
  // Structural, not a regex over source. The previous version asserted the
  // literal text `readonly session: SessionState = {` inside game.ts, and
  // broke the moment the state moved to state.ts — the third scraping check
  // to break that way in this refactor. Build the state and look at it.
  {
    const st = freshState(newCommander());
    check('the game state is one object a walk can reach',
      typeof st === 'object' && st !== null);
    check('...with the flight session inside it',
      typeof st.session === 'object' && 'torusEngaged' in st.session);
    check('...and the ship systems, the dock plan and the charts',
      !!st.sys && !!st.dockPlan && !!st.chart && !!st.world && !!st.player);
    // the snapshot walks these generically, so they must be plain data
    check('...and the session is flat, so serialiseState can walk it',
      Object.values(st.session).every((v) => typeof v !== 'object'));

    // THE check this file was missing. The capture is a hand-written list, not
    // a generic walk — a comment in game.ts claimed otherwise and was wrong.
    // Three GameState fields (dockPlan, lastThreat, ecmDetectedTimer) were
    // silently unsaved, which is the fifth time this project has shipped a
    // snapshot that forgot a field. Naming them here means the sixth is a
    // failing test rather than a bug report.
    //
    // It reads persistence.ts now: the two methods left game.ts, and that is
    // the point of them leaving — the save is a module with a name rather than
    // two private methods only a grep could find.
    const src = readFileSync(new URL('../src/game/persistence.ts', import.meta.url), 'utf8');
    const capture = src.slice(src.indexOf('capture(): WorldSnapshot {'),
      src.indexOf('restore(snap'));
    const restore = src.slice(src.indexOf('restore(snap'),
      src.indexOf('autoSave(): void'));
    // `world` and `player` are objects the snapshot saves piecewise under
    // other names; every other field must appear by name on BOTH sides.
    const piecewise = new Set(['world', 'player']);
    for (const key of Object.keys(st)) {
      if (piecewise.has(key)) continue;
      check(`snapshot saves state.${key}`, capture.includes(key));
      check(`...and restores state.${key}`, restore.includes(key));
    }
  }
}

// --- one source of randomness ----------------------------------------------

// A fixed timestep buys repeatable PHYSICS. It buys nothing at all while the
// world reaches for Math.random(), which is why both had to land together: an
// unrepeatable run cannot be replayed, regression tested, or trained against.
//
// game/rng.ts is the world's only source of chance. This check is what stops
// the next Math.random() from quietly punching a hole in it.

console.log('\nseeded world');
{
  // Widened twice. It began as game/*.ts only and missed the market seed in
  // screens/trade.ts (an unseeded seed, so a reload rerolled prices) and the
  // living galaxy's default rng. It also only looked for Math.random and
  // .randomDirection(), and missed THREE's Quaternion.random() — so every ship
  // in the galaxy faced a direction the seed knew nothing about.
  // Every world file, GLOBBED — not a hand-kept list.
  //
  // The list this replaced named 19 files, listed population.ts twice (the
  // tell), and omitted combat.ts, cargo.ts, effects.ts, spawning.ts,
  // ordnance.ts and world.ts. A `Math.random()` in spawning.ts — which decides
  // what you meet on arrival — passed CI. A list that must be maintained by
  // hand to guard against forgetting things is the thing it is guarding
  // against.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const WORLD = ['game/', 'galaxy/', 'world/', 'hud/', 'engine/']
    .flatMap((d) => walk(new URL(`../src/${d}`, import.meta.url)));

  /**
   * Files allowed an unseeded stream, each for a stated reason.
   *
   * NOT a convenience list — anything added here must be genuinely outside the
   * world: something whose output no simulation reads, so it cannot change
   * what happens next.
   */
  const EXEMPT: Record<string, string> = {
    'rng.ts': 'defines the seeded generator; seeds from Math.random only when unseeded',
    'starfield.ts': 'the backdrop, drawn once and never read by the simulation',
  };

  const offenders: string[] = [];
  for (const url of WORLD) {
    const name = url.pathname.split('/').pop()!;
    if (EXEMPT[name]) continue;
    const raw = readFileSync(url, 'utf8');
    const src = raw.replace(/^\s*(\/\/|\*).*$/gm, '');   // drop comment lines
    const short = url.pathname.slice(url.pathname.indexOf('/src/') + 5);
    // `Math.random` WITHOUT parens too: a default parameter of
    // `rng: () => number = Math.random` is an unseeded stream hiding behind an
    // injectable-looking signature, and the parenthesised check missed five.
    if (/Math\.random\b/.test(src)) offenders.push(short);
    // ...and the bracketed form, which reads as a deliberate dodge
    if (/Math\s*\[\s*['"`]random/.test(src)) offenders.push(`${short} (Math['random'])`);
    // ...and destructuring it out of Math, which leaves no `Math.` at the call
    if (/\{[^}]*\brandom\b[^}]*\}\s*=\s*Math\b/.test(src)) {
      offenders.push(`${short} (destructured from Math)`);
    }
    // three.js has its own generators, and they all reach for Math.random
    if (/\.randomDirection\(\)/.test(src)) offenders.push(`${short} (THREE randomDirection)`);
    // Any `x.random()` — THREE's Quaternion.random() and friends.
    //
    // This check was DEAD for its whole life. It read
    // `/\.random\(\)/.test(src.replace(/\brandom\(\)/g, ''))`, and `\b`
    // matches between the `.` and the `r`, so the replace ate the very text
    // the regex was hunting. An audit smuggled `new THREE.Quaternion().random()`
    // into NpcShip's constructor and all 355 checks passed. The seeded
    // `random()` has no dot before it, so no replace was ever needed.
    if (/\.random\(\)/.test(src)) offenders.push(`${short} (a THREE .random())`);
  }
  check(`world code uses the seeded rng only${offenders.length ? ' — found in ' + offenders.join(', ') : ''}`,
    offenders.length === 0);

  // and the rng itself must actually be deterministic
  seedWorld(1234);
  const a = [random(), random(), random()];
  seedWorld(1234);
  const b = [random(), random(), random()];
  check('the same seed gives the same stream', JSON.stringify(a) === JSON.stringify(b));
  seedWorld(5678);
  const c = [random(), random(), random()];
  check('a different seed gives a different one', JSON.stringify(a) !== JSON.stringify(c));
  check('...and it is a real distribution, not a constant',
    new Set(a).size === 3 && a.every((n) => n >= 0 && n < 1));
}

// --- no ambient globals -----------------------------------------------------
//
// The same shape as the ban above, and for the same reason: `Math.random` was a
// second source of chance, and a `window.__` flag is a second source of RULES.
// Five of them existed — `__scriptedPirates`, `__legacyPirates`, `__packBrain`,
// `__sharpPirates`, `__cheat` — read from inside NpcShip.update and the equip
// screen to decide which brain flew and what could be fitted.
//
// Each cost the same three things, and none of them was hypothetical:
//
//   1. the flag is not in the snapshot, and `globalThis` does not survive a
//      reload, so a save made with one set came back flying something else —
//      in a project whose headline property is that the world repeats
//   2. a test could only set it and remember to clear up; the discipline held
//      by hand, across 5,000 lines, which is not the same as being safe
//   3. the combat trainer needed a save-the-old/put-it-back dance around every
//      exercise, run FIRST in teardown, guarding a hazard instead of removing
//      it. Making the selection state deleted the dance.
//
// They are `GameState.brains` and `GameState.cheat` now. What is still allowed
// is a HANDLE — something the game WRITES so a console can reach in, which no
// rule reads and which branches on nothing — and those go through
// game/console.ts so this check has one exemption instead of an argument.

console.log('\nno ambient globals');
{
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const SEAM = 'game/console.ts';
  const offenders: string[] = [];
  for (const url of walk(new URL('../src/', import.meta.url))) {
    const short = url.pathname.slice(url.pathname.indexOf('/src/') + 5);
    if (short === SEAM) continue;
    // Strip `//`, ` *` AND a one-line `/** ... */` — that last form is not
    // pedantry: two stale references to the deleted flags were sitting in
    // exactly it, and the first version of this check walked straight past them.
    const src = readFileSync(url, 'utf8')
      .replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/globalThis/.test(src)) offenders.push(`${short} (globalThis)`);
    // the older spelling of the same thing, and the one the flags actually used
    if (/window\s*\.\s*__/.test(src)) offenders.push(`${short} (window.__)`);
  }
  check(`only ${SEAM} touches globalThis`
    + `${offenders.length ? ' — found in ' + offenders.join(', ') : ''}`,
    offenders.length === 0);

  // ...and the seam is real rather than an empty file the check walks past
  const seam = readFileSync(new URL(`../src/${SEAM}`, import.meta.url), 'utf8');
  check('...and the seam publishes and reads back through one function each',
    /export function publish\(/.test(seam) && /export function handle\(/.test(seam));

  // The five that are gone stay gone, by name: a grep for the NAME catches a
  // reintroduction that spells its access differently to dodge the check above.
  for (const flag of ['__scriptedPirates', '__legacyPirates', '__packBrain',
    '__sharpPirates', '__cheat']) {
    const found = walk(new URL('../src/', import.meta.url)).filter((url) => {
      const src = readFileSync(url, 'utf8')
        .replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return src.includes(flag);
    });
    check(`${flag} is gone from src/`, found.length === 0,
      found.map((u) => u.pathname).join(', '));
  }

  // and the replacements are where the rules can find them
  check('brain selection is a field of the state, and it is saved',
    'brains' in freshState(newCommander()) && 'cheat' in freshState(newCommander()));
}
