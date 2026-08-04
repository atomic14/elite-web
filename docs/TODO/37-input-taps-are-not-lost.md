# 37 — Do not throw away a tap that arrived in a busy frame

**Kind:** correctness · **Severity:** medium · **Size:** small
**Depends on:** none

## Why

`Input.pressed(code)` consumes ONE tap, and `endFrame()` then clears the whole
tap map. So a second tap of the same key that arrives in the same frame is
discarded rather than delivered on the next one.

`engine/input.ts`'s own header says the opposite — *"multiple taps within one
frame are counted, not lost"* — and that is true only for `pressedCount()` and
`drainPresses()`. Every menu and every screen navigates with `pressed()`, so
every one of them loses the extra tap.

At 60 Hz with a focused window this is rare. It stops being rare exactly when
the frame is slow: a throttled background tab, a long repaint, a laptop under
load. The symptom is a menu that ignores some of your key presses, which reads
as the game being broken rather than busy — and it is most likely to happen
while walking a long settings list, which is the trainer's setup panel.

Measured while reviewing the trainer: with the window unfocused and rAF
throttled, three arrow presses moved the selection one row.

## Implementation

- Carry unconsumed taps into the next frame instead of clearing them, with a
  bound so a key held against a stalled loop cannot bank an unbounded queue and
  then spend it all at once when the frame rate recovers.
- The header comment becomes true, or it changes. Do not leave a comment
  describing behaviour the code does not have.
- Weigh it against the reason `endFrame()` exists: taps must not leak across
  frames in a way that lets a paused or backgrounded game accumulate input.
  Carrying one is not the same as accumulating a hundred; say which you chose
  and why, in the file.

## Acceptance

- Two taps of the same key inside one frame both arrive — the second on the
  following frame.
- A key held down while the loop is stalled does not bank more than the stated
  bound.
- No change to `held()`, to continuous flight controls, or to the ordering
  contract in `ui/screen-host.ts` (the menu cursor runs before the top screen
  and consumes; docs/INVARIANTS.md invariant 14).
- A headless test drives `Input` directly and asserts both properties.

## Verify

`npm run check`. Then, in a browser, walk the trainer's setup panel with the
window unfocused and confirm no press is lost.
