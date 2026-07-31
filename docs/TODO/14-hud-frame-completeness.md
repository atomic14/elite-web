# 14 — The HUD painter owns message lifetime, and takes half its frame loosely

**Kind:** temporal decomposition · **Severity:** low · **Size:** medium

## What is wrong

Two related things, both about the painter holding what it should be handed.

1. **The painter owns the message's lifetime.** `hud.ts` keeps a private timer and
   decrements it during `render`, so *how long a warning stays on screen* is
   behaviour held outside `GameState`. It is therefore not in the snapshot, and a
   save/reload changes it.
2. **The render interface is split in two.** `render` takes four frame values as
   loose positional arguments that are not in the 28-field `HudState` that
   `buildHudFrame` already assembles — so "the frame" has two definitions.

CLAUDE.md says the HUD is a dumb painter. It is close, and these are the two
places where it is not.

## Evidence (read at `de9a668`)

- `src/hud/hud.ts:122` — `private messageTimer = 0;`
- `src/hud/hud.ts:159-160` — decremented inside `render`.
- `src/hud/hud.ts:139-142` — `showMessage(text, seconds)`, called from
  `game.ts`'s `apply*` switches.
- `src/hud/hud.ts:151-158` —
  `render(dt, state, playerPos, playerQuat, contacts, compassTarget)`.
- `src/game/game.ts:1714-1739` — `buildHudFrame`, which already assembles the
  28-field `HudState` and is where the other four values would naturally go.

## The fix

Fold the message and its remaining time into the frame that `buildHudFrame`
computes, and fold `playerPos` / `playerQuat` / `contacts` / `compassTarget` into
it too, so `render(dt, frame)` is the whole interface and the painter holds
nothing.

That moves the message timer into state. Two consequences to handle deliberately:

- It becomes a `GameState` field, so it must appear by name in both capture and
  restore in `persistence.ts` — the snapshot test enforces this. Consider whether
  it belongs in `state.session` instead, which is walked generically and would
  save it for free.
- Whether a reloaded save should still show a half-expired warning is a real
  question. "Restore may differ from an unbroken run in ways a player cannot
  observe or exploit" covers either answer; pick one and note it.

Watch the cost of `contacts`: if it is a per-frame array the painter currently
receives by reference, keep it that way inside the frame struct rather than
copying it every frame.

## Verify

- `npm run lint && npm test` — the snapshot field-by-name test is the gate.
- Fly it: warnings must still appear and expire at the same rate, the compass
  must still point, and the docking aid must still line up. A frame value dropped
  during the move shows up as a dead HUD element, not as a test failure.

## Notes

Lowest priority of the design fixes. It is the kind of change that is easy to do
badly under time pressure and buys correctness rather than visible improvement —
if the session is short, do file 13 instead.
