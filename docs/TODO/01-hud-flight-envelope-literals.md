# 01 — HUD roll/pitch bars normalise by stale flight caps

**Kind:** information leakage / one rule, two homes · **Severity:** live defect,
visible on screen · **Size:** two lines

## What is wrong

`buildHudFrame` divides the player's roll and pitch rates by hard-coded `2.0`
and `1.1`. Those were the flight caps *before* they were raised. The real caps
are in `player.ts`, which exports `PLAYER_FLIGHT` precisely so no other module
has to copy them.

Because `hud.ts` does not clamp, a full-rate roll drives the pointer to
`50 + (2.5 / 2.0) * 45 = 106.25%` — off the end of its own bar.

## Evidence (read at `de9a668`)

- `src/game/game.ts:1724-1725`
  ```ts
  rollFrac: this.player.rollRate / 2.0,
  pitchFrac: this.player.pitchRate / 1.1,
  ```
- `src/player.ts:64-65` — `const MAX_ROLL = 2.5;` / `const MAX_PITCH = 1.45;`
  The comment above them records that they were "Raised from 1.1/2.0".
- `src/player.ts:90-94` — `export const PLAYER_FLIGHT = { ... maxRoll: MAX_ROLL,
  maxPitch: MAX_PITCH ... }`, and `player.ts:101` says in as many words that a
  harness copying the caps is the failure mode this export prevents.
- `src/hud/hud.ts:163-164` — `left = ${50 + state.rollFrac * 45}%`, no clamp.
- Every other consumer already reads the real values:
  `src/engine/flight-controls.ts:60-61`, `src/ai-training/scenario.ts:170-171`.

## The fix

In `src/game/game.ts`, divide by `PLAYER_FLIGHT.maxRoll` and
`PLAYER_FLIGHT.maxPitch` (`PLAYER_FLIGHT` may already be imported — check).

Decide separately whether `hud.ts:163-164` should clamp to ±1. Argument for: a
painter that trusts its input to be in range and has no defence is where the next
version of this bug shows up silently. The `HudState` comment at `hud.ts:36-37`
already declares the contract as `-1..1`, so clamping enforces a documented
promise rather than inventing one.

## Verify

- `npm run lint && npm test`
- Fly it: `npm run dev`, hold a full roll, and confirm the pointer stops at the
  end of the bar instead of overshooting it.
- Grep for other survivors of the old envelope: `grep -rn "1\.1\|2\.0" src/hud
  src/game/game.ts` — check each hit is not a turn rate.

## Notes

The number-of-homes problem is the point, not the 6% overshoot. Fixing the
literals without routing through `PLAYER_FLIGHT` leaves the defect in place for
the next cap change.
