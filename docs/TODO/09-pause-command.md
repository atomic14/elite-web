# 09 — The pause key is read outside the bindings table

**Kind:** information leakage · **Severity:** medium (CLAUDE.md invariant 9) ·
**Size:** small

## What is wrong

Pause is read straight off `Input` inside the step, so one binding lives outside
the table that invariant 9 and `controls.ts` make the single home for command
keys. It is the only key in the game that works this way.

Consequences: a replay or an AI driver cannot pause, because pausing is not a
`Command`; the key is invisible to the test that asserts what keys do; and the
`?` panel and README document a binding that the bindings table does not contain.

## Evidence (read at `de9a668`)

- `src/game/game.ts:1263` — the whole of it, and the only `KeyP` in `src/`:
  ```ts
  if (this.mode === 'flight' && this.input.pressed('KeyP')) this.paused = !this.paused;
  ```
- Documented as a key anyway: `play.html:64`
  `<tr><td>P</td><td>pause</td></tr>` and `README.md:148` `| P | pause |`.
- Every other command reaches the Game as a `Command` through `controls.ts` —
  the union at `src/game/controls.ts:43-85` (which already has `toggleLayout`,
  `toggleTorus`, `toggleHelp`, …) and the `BINDINGS` rows at `:130`, `:153-154`.

## The fix

Add `togglePause` to the `Command` union in `src/game/controls.ts`, add the
`{ key: 'KeyP', command: 'togglePause' }` row to `BINDINGS` in the flight mode
group, and handle it in `game.ts`'s command switch alongside the other toggles.
Delete the `input.pressed('KeyP')` line.

Invariant 9 says key bindings live in four places and change together. Three are
already correct here (`keymap.ts` is not involved — this is a command key, not a
flight key; `play.html:64` and `README.md:148` already list it), so this fix is
the fourth catching up. Confirm the `?` panel row still matches after the change.

Watch the mode guard: the current line only pauses in `'flight'`. Put `KeyP` in
the same mode group the bindings table uses for flight commands so that guard is
expressed by the table rather than by an `if`.

## Verify

- `npm run lint && npm test` — if there is a test asserting the bindings table
  covers the documented keys, this should make it pass for P; if there is not,
  that test is worth having.
- Fly it: `npm run dev`, press P in flight (pauses), press it on a screen (should
  behave as it does today).
- Confirm a driver can now pause: from the console,
  `__game` plus the command path, or via `test/playtest.js`'s command list.
