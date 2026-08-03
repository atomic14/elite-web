// The orchestrator, driven for real.
//
// `game.ts` is the largest file in the project and had **zero** test coverage —
// not because the orchestrator needed a browser, but because four of its fields
// did: a render stack, an Input, a Hud and a TunnelEffect, each reaching for
// `document` in a field initializer. Eleven lines of DOM in 1,757 made the
// whole file unconstructible under node, so the step order, the mode machine
// and every `apply*` were exercised only by a human with a tab open.
//
// A `Shell` fixed that (engine/shell.ts). These tests build a real Game on the
// headless one and fly it, which is the difference between "the shell is
// separable" as a claim and as a fact: if a browser API creeps back into
// game.ts, this file stops running.
//
// It also guards the seam from the other side — `npm test` asserts that
// game.ts names no DOM type at all, because the compiler will not.

import { readFileSync } from 'node:fs';
import { Game } from '../src/game/game.ts';
import { handle } from '../src/game/console.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

console.log('\nthe game, headless');
{
  /**
   * Build and fly a Game with the save suspended — never touch a real slot.
   *
   * `launch` matters: docked, the world barely moves, so a trace taken from a
   * docked Game is short and identical whatever the seed. The first version of
   * the determinism check below did exactly that and passed for the wrong
   * reason until the not-vacuous guard caught it.
   */
  const fly = (frames: number, seed = 20_260_730, launch = false) => withoutSaving(() => {
    seedWorld(seed);
    const g = new Game(() => headlessShell());
    if (launch) g.launch();
    for (let i = 0; i < frames; i++) g.update(1 / 60, i / 60);
    return g;
  }).value;

  {
    const g = fly(0);
    check('a Game constructs with no DOM at all', !!g);
    eq('...and starts docked, as Elite always did', g.mode, 'docked');
    check('...with a commander who has the starting credits',
      g.state.commander.credits === 1000);
    check('...and a world built around a station', !!g.state.world.station);

    const h = handle('__game') as Record<string, unknown>;
    check('the console handle preserves legacy reads outside the Game class',
      'commander' in h
      && h.commander === g.state.commander && h.npcs === g.state.world.npcs);
    check('...while the canonical state aliases are getter-only',
      !Reflect.set(h, 'paused', true) && !g.state.session.paused);
    check('Game itself has no forwarding commander accessor',
      !Object.getOwnPropertyDescriptor(Game.prototype, 'commander'));
  }

  // --- the fixed-timestep loop actually advances the world ------------------
  {
    const g = fly(600);
    check('600 steps leave the mode machine somewhere valid',
      ['docked', 'flight', 'dead'].includes(g.mode));
    check('...and the galaxy has not been corrupted', g.state.systems.length === 256);
  }

  // --- visual effects age in the simulation, never in presentation ----------
  {
    const shell = headlessShell();
    const g = withoutSaving(() => new Game(() => shell)).value;

    g.state.session.beamTimer = 0.125;
    g.step(0.0625, 0);
    eq('a fixed step ages an active cockpit beam by exactly dt',
      g.state.session.beamTimer, 0.0625);
    g.step(0.1, 0.1);
    eq('...and clamps the expired timer at zero',
      g.state.session.beamTimer, 0);

    g.state.session.beamTimer = 0.08;
    const before = JSON.stringify(g.captureSnapshot());
    g.draw(1);
    g.draw(1);
    const after = JSON.stringify(g.captureSnapshot());
    check('repeated draws do not mutate serialized game state', after === before);
    check('...and beam visibility still follows beamTimer > 0',
      shell.view.beams.visible);

    g.state.session.beamTimer = 0;
    g.draw(1);
    check('...while an expired beam is hidden', !shell.view.beams.visible);
  }

  // --- launching, which is the transition the step order is built around ----
  {
    const g = fly(0);
    withoutSaving(() => g.launch());
    eq('launching puts you in flight', g.mode, 'flight');
    const start = g.state.player.position.clone();
    withoutSaving(() => { for (let i = 0; i < 300; i++) g.update(1 / 60, i / 60); });
    check('...and five seconds of flight actually moves the ship',
      g.state.player.position.distanceTo(start) > 100,
      `moved ${g.state.player.position.distanceTo(start).toFixed(0)}`);
    check('...with NPCs in the sky to move around', g.state.world.npcs.length > 0);
  }

  // --- pause is a command, but still freezes only flight -------------------
  {
    const g = fly(0);
    g.input.injectPress('KeyP');
    g.step(1 / 60, 0);
    check('P does not pause the docked menu', !g.state.session.paused);

    withoutSaving(() => g.launch());
    g.input.injectPress('KeyP');
    g.step(1 / 60, 1 / 60);
    check('P pauses flight through the command path', g.state.session.paused);

    const stopped = g.state.player.position.clone();
    for (let i = 0; i < 30; i++) g.step(1 / 60, (i + 2) / 60);
    check('a paused command-driven game does not advance the ship',
      g.state.player.position.equals(stopped));

    g.input.injectPress('KeyP');
    g.step(1 / 60, 32 / 60);
    check('the same command path resumes flight', !g.state.session.paused);
  }

  // --- determinism, through the WHOLE orchestrator --------------------------
  //
  // The seeded-rng tests below this one prove the stream repeats. This proves
  // the Game does — every apply*, the screen stack and the mode machine
  // included — which is the property training and the regression gate rest on
  // and which could never be asserted at this level before.
  {
    const trace = (g: Game) => JSON.stringify({
      pos: g.state.player.position.toArray().map((n) => n.toFixed(3)),
      npcs: g.state.world.npcs.map((n) => n.object.position.toArray().map((v) => v.toFixed(3))),
      credits: g.state.commander.credits,
      mode: g.mode,
    });
    const a = trace(fly(400, 4_242_424, true));
    const b = trace(fly(400, 4_242_424, true));
    check('the same seed flies the same 400 frames', a === b);
    check('...and the trace is not vacuously empty — a DOCKED game would be',
      a.length > 200);
    const c = trace(fly(400, 9_090_909, true));
    check('...while a different seed does not (the control)', a !== c);
  }

  // --- the seam, guarded from the other side -------------------------------
  //
  // TypeScript will not catch a `document` creeping back into game.ts, because
  // the DOM types are ambient. This will.
  {
    const src = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const found = ['document', 'window', 'requestAnimationFrame', 'HTMLElement',
      'HTMLCanvasElement', 'MouseEvent', 'localStorage']
      .filter((api) => new RegExp(`\\b${api}\\b`).test(src));
    check(`game.ts names no browser API${found.length ? ' — found ' + found.join(', ') : ''}`,
      found.length === 0,
      'the shell is the port surface; a DOM call here puts the orchestrator back in the contaminated bucket');
  }

  // --- every ScreenId is wired ---------------------------------------------
  //
  // `ScreenHost` carried a second shape for a whole migration: a nullable
  // screen in the stack, a `handled` getter, and an update() that could hand
  // the frame back. All of it was unreachable, and the comments describing it
  // were the last thing still claiming there were unmigrated screens. The
  // shape is gone and an unregistered id throws instead — which is only an
  // improvement if the Game registers all of them, so that is checked here
  // rather than asserted in a docstring.
  //
  // The ids come out of the TYPE, not a list in this file: adding a `ScreenId`
  // and forgetting the registration in game.ts has to fail somewhere, and this
  // is the somewhere.
  {
    const host = readFileSync(new URL('../src/ui/screen-host.ts', import.meta.url), 'utf8');
    const ids = [...(host.split('export type ScreenId =')[1] ?? '').split(';')[0]
      .matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    check(`the ScreenId union parses (${ids.length} ids)`, ids.length > 0);
    const g = withoutSaving(() => new Game(() => headlessShell())).value;
    const opening = withoutSaving(() => ids.filter((id) => {
      try { g.screens.open(id as never); return false; } catch { return true; }
    }));
    check(`the Game registers a Screen for every ScreenId (${opening.value.join(', ') || 'all wired'})`,
      opening.value.length === 0,
      'ScreenHost.open throws on an id with nothing registered, so a missing registration is a crash on first use');

    // --- and NO screen writes to the shelf because it was looked at ----------
    //
    // docs/TODO/55's first rule. `SavesScreen.open()` used to push a checkpoint
    // so the list would include the run you were standing in, which made LOOKING
    // AT YOUR SAVES move your way back — and it is the shape of mistake any
    // screen can make, so the claim is held for all of them at once rather than
    // for the one that made it.
    //
    // `withoutSaving` is what makes this real: the writes are refused, so the
    // keys come back as evidence instead of as bytes on the shelf.
    check(`opening a screen writes nothing (${opening.refused.join(', ') || 'nothing refused'})`,
      opening.refused.length === 0,
      'a screen that files a save the moment you open it is a screen you cannot open to check something');
  }
}

// --- three.js is not the browser -------------------------------------------

// The shell hides the platform, and the question this file exists to answer is
// which parts of the rendering stack that actually means. CLAUDE.md's answer:
// three.js may be imported by a rule module, because only `WebGLRenderer`
// needs a browser. That is a claim about a third-party library, and it is the
// kind that rots quietly — so it is asserted here rather than trusted.
//
// It is asserted at all because the opposite was concluded once. A knowledge
// graph of this repo showed 43 `src` files importing three, eleven of them in
// `game/` touching Object3D and Raycaster, and that reads like renderer
// contamination the portability gate is failing to measure. It is not: those
// classes are plain JavaScript, and a "shell" here is another implementation of
// engine/shell.ts, which three.js travels with.
{
  const THREE = await import('three');
  const o = new THREE.Object3D();
  o.position.set(1, 2, 3);
  o.updateMatrixWorld();
  eq('three.js Object3D constructs and transforms under node', o.position.x, 1);
  check('three.js Raycaster constructs under node',
    typeof new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1))
      .intersectObject === 'function');
  check('three.js BufferGeometry constructs under node',
    new THREE.BufferGeometry().attributes !== undefined);

  // The one class that genuinely is platform, and the reason the rest are not.
  // If this ever stops throwing, three.js has changed what it needs and the
  // paragraph in CLAUDE.md needs rereading.
  let renderer: unknown = null;
  let threw = false;
  try { renderer = new THREE.WebGLRenderer(); } catch { threw = true; }
  check('...but WebGLRenderer needs a browser, and that is what the shell hides',
    threw && renderer === null);
}
