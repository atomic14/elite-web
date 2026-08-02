// The keyboard, frame by frame.
//
// `engine/input.ts` is where a key press becomes something the game can read,
// and its whole contract is about FRAMES: what is held, what was tapped, and
// what happens to a tap nobody read. That last one had a bug worth a test file
// of its own — `pressed()` takes one tap and `endFrame()` threw the rest away,
// so a second tap of the same key inside one frame never arrived. Invisible at
// 60Hz with the window focused; the whole story in a throttled tab, where a
// second of keystrokes lands in one frame and a menu appears to ignore you.
//
// What is asserted here is the CARRY and its two bounds — interest and count —
// because a fix that carried taps without a bound would swap a lost press for a
// banked burst, which is the worse bug of the two. The interest bound has its
// own test below for a specific reason: the first attempt at this carried every
// unread tap, and the pause test in game.test.ts caught a P pressed at the
// station pausing the game a step after launch. A tap must never arrive
// somewhere that was not already asking for that key.
//
// No DOM: `new Input()` deliberately constructs without one (there are no
// listeners, so presses arrive via `injectPress`, exactly as a click does).
import { readFileSync } from 'node:fs';
import { Input } from '../src/engine/input.ts';
import { commandsFor } from '../src/game/controls.ts';
import { check, eq } from './harness.ts';

console.log('\nthe keyboard, frame by frame');

/** The busy frame this file is about: several taps of one key, then a read. */
const taps = (i: Input, code: string, n: number): void => {
  for (let k = 0; k < n; k++) i.injectPress(code);
};

/** Read one tap per frame for `frames` frames; return how many arrived. */
const readPerFrame = (i: Input, code: string, frames: number): number => {
  let got = 0;
  for (let f = 0; f < frames; f++) {
    if (i.pressed(code)) got += 1;
    i.endFrame();
  }
  return got;
};

// --- the acceptance case ----------------------------------------------------
{
  const i = new Input();
  taps(i, 'ArrowDown', 2);
  check('a tap read in a busy frame arrives', i.pressed('ArrowDown'));
  i.endFrame();
  check('...and the second one arrives on the FOLLOWING frame, not never',
    i.pressed('ArrowDown'));
  i.endFrame();
  check('...and then there are no more', !i.pressed('ArrowDown'));
}

// --- three arrows in one stalled frame move three rows ----------------------
//
// The measured symptom: unfocused window, rAF throttled, three arrow presses
// moved the trainer's selection ONE row. A menu reads one tap per frame, so
// this is what the fix is for.
{
  const i = new Input();
  taps(i, 'ArrowDown', 3);
  eq('three taps in one frame move a menu three rows, one per frame',
    readPerFrame(i, 'ArrowDown', 10), 3);
}

// --- the COUNT bound --------------------------------------------------------
{
  const i = new Input();
  taps(i, 'ArrowDown', 20);
  eq('a mash against a stalled loop banks a bounded queue, not all of it',
    readPerFrame(i, 'ArrowDown', 30), 4); // one read in the busy frame + 3 carried
}

// --- a HELD key banks nothing ----------------------------------------------
//
// The listener drops `e.repeat`, so a key held down through a stall is ONE tap
// however long the loop is stuck. Headless there are no listeners to hold a key
// against, so the rule is asserted where it lives: in the source.
{
  const i = new Input();
  i.injectPress('Space'); // one keydown, which is all a held key produces
  eq('a key held while the loop is stalled is worth exactly one tap',
    readPerFrame(i, 'Space', 20), 1);

  const src = readFileSync(new URL('../src/engine/input.ts', import.meta.url), 'utf8');
  check('...because auto-repeat never becomes a tap in the first place',
    /if \(e\.repeat\) return;/.test(src));
}

// --- the INTEREST bound: only a key being read keeps anything ---------------
//
// The rule that keeps a command from outliving the state that made it valid,
// and the reason the carry is safe at all: a frame that read nothing of a key
// clears it, exactly as endFrame() always did.
{
  const i = new Input();
  taps(i, 'KeyP', 4);
  i.endFrame();
  check('a tap nobody read is cleared at the end of the frame, as it always was',
    !i.pressed('KeyP'));
}
{
  const i = new Input();
  taps(i, 'KeyM', 2);
  check('the first tap of a command is read by the mode that binds it',
    i.pressed('KeyM'));
  i.endFrame();

  // the frame after: a screen is open, and it binds no M
  i.endFrame();
  check('...and the tap the new screen never asked for is gone',
    !i.pressed('KeyM'));
}

// --- the bounds do not leak between keys ------------------------------------
{
  const i = new Input();
  taps(i, 'ArrowUp', 3);
  taps(i, 'Enter', 1);
  check('a busy frame delivers each key', i.pressed('ArrowUp') && i.pressed('Enter'));
  i.endFrame();
  check('...and carries the unread arrows', i.pressed('ArrowUp'));
  check('...while the spent Enter does not come back', !i.pressed('Enter'));
}

// --- reads that consume EVERYTHING still consume everything -----------------
//
// The charts read with pressedCount and the naming screen with drainPresses;
// neither may leave a carried tap behind, or a cursor keeps moving after the
// key was drained.
{
  const i = new Input();
  taps(i, 'ArrowLeft', 5);
  eq('pressedCount takes the carried taps too', i.pressedCount('ArrowLeft'), 5);
  i.endFrame();
  eq('...and leaves nothing to carry', i.pressedCount('ArrowLeft'), 0);
}
{
  const i = new Input();
  taps(i, 'KeyA', 2);
  check('a busy frame is read once by a chain', i.pressed('KeyA'));
  i.endFrame();
  i.injectPress('KeyB');
  const drained = i.drainPresses();
  eq('drainPresses reports the carried tap before the fresh one',
    drained.join('|'), 'KeyA|KeyB');
  i.endFrame();
  eq('...and drains the carry with it', i.drainPresses().length, 0);
}

// --- through the command table ----------------------------------------------
//
// The chain in controls.ts stops at the first match, so a mashed key must reach
// the game as one command per frame — not two in one frame, and not one ever.
{
  const i = new Input();
  taps(i, 'KeyM', 2);
  eq('a double-tapped command fires once in the busy frame',
    commandsFor('docked', i).join('|'), 'openMarket');
  i.endFrame();
  eq('...and once more on the next, if that mode still binds it',
    commandsFor('docked', i).join('|'), 'openMarket');
  i.endFrame();
  eq('...and not a third time', commandsFor('docked', i).join('|'), '');
}
{
  const i = new Input();
  taps(i, 'KeyH', 2);
  eq('the shifted/plain pair still resolves the plain command',
    commandsFor('flight', i).join('|'), 'startHyperspace');
  i.endFrame();
  eq('...and the carried tap resolves the same way, not the shifted one',
    commandsFor('flight', i).join('|'), 'startHyperspace');
}
