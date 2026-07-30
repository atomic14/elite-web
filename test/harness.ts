// The test harness: one `check`, one pair of counters, and the shared fixtures.
//
//   import { check, eq } from './harness.ts';
//
// There is no framework here and there never has been — `check(name, condition)`
// prints a line and counts it, and that is the whole of it. What is new is that
// it lives in its own file.
//
// WHY. `test/run.ts` reached 5,300 lines and is a recorded debt in
// `tools/sizes.mjs`, for the reason every kitchen-sink file in this project got
// there: it was the default place to put a test, so nobody ever decided. The
// cost was real and specific — three agents working on unrelated modules still
// collided in the same file, and one merge spliced a section inside another's
// block and left an unbalanced brace.
//
// So the split starts here, from the bottom: the counters and `check` come out
// FIRST, because until there is one `check` that every file can import, a second
// test file has to bring its own — and then `npm test` prints two totals, two
// exit codes, and neither is the answer.
//
// The rule for a new test file:
//
//   1. `import { check, eq } from './harness.ts'` — never redefine them.
//   2. Assert at module scope; importing the file runs the tests.
//   3. Add one import line to `test/run.ts`, which calls `summarise()` at the
//      end. One total, one exit code, however many files there are.
//
// Nothing game-specific belongs in here beyond a fixture two files genuinely
// share. A helper used by one file lives in that file.

import { commandsFor, type Command, type CommandInput, type ControlMode } from '../src/game/controls.ts';

/** Assertions that passed, and failed, across every imported test file. */
export let passed = 0;
export let failed = 0;

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/**
 * Print the total and exit non-zero if anything failed.
 *
 * Called once, from the end of `test/run.ts`. It is a function rather than
 * module-scope code so that the exit happens AFTER every imported test file has
 * run — an `import` is hoisted, so a file that exited on load would take the run
 * with it before run.ts's own body had started.
 */
export function summarise(): void {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

// --- shared fixtures --------------------------------------------------------

/**
 * A keyboard that has already been pressed. Taps are consumed, as `Input`'s are.
 *
 * The two-method `CommandInput` and nothing else: not `engine/input.ts`, not a
 * DOM event. controls.ts reads that interface precisely so a replay, an AI or a
 * test can ask for a command with an object literal.
 */
export function keys(down: string[], held: string[] = []): CommandInput {
  const taps = new Map<string, number>();
  for (const k of down) taps.set(k, (taps.get(k) ?? 0) + 1);
  return {
    pressed: (code) => {
      const n = taps.get(code) ?? 0;
      if (n <= 0) return false;
      taps.set(code, n - 1);
      return true;
    },
    held: (...codes) => codes.some((c) => held.includes(c)),
  };
}

/** What this mode's table makes of these keys. */
export function cmds(mode: ControlMode, down: string[], held: string[] = []): Command[] {
  return commandsFor(mode, keys(down, held));
}

/** `eq()` compares by identity; a command list has to be compared by value. */
export function eqc(name: string, actual: Command[], expected: Command[]): void {
  eq(name, actual.join('|'), expected.join('|'));
}
