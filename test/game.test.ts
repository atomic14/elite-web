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
}
