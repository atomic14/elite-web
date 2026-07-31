# 18 — `draw()` advances the cockpit beam lifetime

**Kind:** temporal decomposition · **Severity:** medium · **Size:** small

## What is wrong

`Game.draw()` says it changes nothing, but decrements
`state.session.beamTimer`. That makes canonical, snapshotted state advance once
per rendered frame instead of once per fixed simulation step. A headless
`step()` does not age the beam, repeated `draw()` calls do, and display cadence
can therefore change state.

This is the same ownership error removed from HUD messages in TODO 14.

## Evidence

- `src/game/game.ts`, `draw(dt)`: `this.state.session.beamTimer -= dt`.
- `applyCombat` sets `beamTimer = BEAM_FLASH` when the gun fires.
- The main loop can execute several fixed steps followed by one draw, so draw
  count and step count are deliberately not equivalent.

## The fix

Advance and clamp `beamTimer` in the fixed `Game.step()` path. `draw()` should
only set beam visibility from the current timer. Keep the visible duration and
save/reload semantics unchanged.

## Verify

- Add a test proving `step()` ages an active beam timer exactly by `dt`.
- Add a test proving `draw()` leaves serialized game/session state unchanged,
  including when called repeatedly without a step.
- Confirm beam visibility still follows `beamTimer > 0`.
- `npm run lint && npm test && npm run build`
- `git diff --check`
