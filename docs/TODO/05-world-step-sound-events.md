# 05 — `world-step.ts` calls the audio singleton directly

**Kind:** platform leak · **Severity:** medium · **Size:** medium

## What is wrong

The world step turned its HUD messages into returned events but kept eleven
direct calls into the audio singleton. So the deepest, most platform-free module
in the codebase imports a platform module — and only survives under node because
`audio.ts` swallows a constructor failure.

That is a load-bearing accident. The module is the one place where "decides and
reports" is most valuable, and sound is the one consequence it still performs
itself.

`autopilot.ts` already shows the right shape, so this is not a design question —
it is applying a pattern the codebase has already chosen.

## Evidence (read at `de9a668`)

Eleven calls in `src/game/world-step.ts`:

| line | call | occasion |
|---|---|---|
| 230 | `sfx.beep(300)` | torus drop-out |
| 250 | `sfx.stopDockingMusic()` | |
| 371 | `sfx.beep(600, 0.12)` | |
| 375 | `sfx.beep(950, 0.08)` | |
| 393 | `sfx.explosion()` | |
| 399 | `sfx.ecm()` | |
| 457 | `sfx.beep(320, 0.1)` | low energy |
| 482 | `sfx.beep(700 + (5 - now) * 100, 0.07)` | hyperspace countdown — a synth sweep computed inside the world step |
| 502 | `sfx.beep(500, 0.1)` | scooped |
| 576 | `sfx.beep(140, 0.5)` | |
| 598 | `sfx.enemyLaser()` | |

The pattern to copy, in `src/game/autopilot.ts`:

- `:14` — a header comment stating that returning sound events is what keeps the
  file free of the platform.
- `:40-42` — `| { kind: 'beep'; hz: number; seconds?: number }` and
  `| { kind: 'dockingMusic'; on: boolean }` on `AutopilotEvent`.
- `:47`, `:91-92`, `:119` — how they are emitted.
- `src/game/game.ts:1158-1168` — the `apply*` that plays them.

## The fix

Extend `StepEvent` with sound kinds and have `game.ts`'s existing
step-event `apply*` play them, exactly as it already does for autopilot events.

Two judgement calls:

- **Reuse `AutopilotEvent`'s sound kinds or add parallel ones?** Prefer a shared
  sound-event type both unions include, so `game.ts` has one place that turns a
  sound event into a call. Two near-identical `beep` kinds applied in two
  switches is a smaller version of the problem being fixed.
- **`:482`, the countdown sweep.** `700 + (5 - now) * 100` is audio design
  expressed as arithmetic in the simulation. Emit `{ kind: 'countdown', n }` and
  let `audio.ts` own the pitch. This overlaps with file 10; if you are doing 10
  soon, emit the named event here and let 10 add the named method.

## Verify

- `npm run lint && npm test` — `test/game.test.ts` asserts `game.ts` names no DOM
  API, and the world-step tests assert it is browser-free. Add or extend an
  assertion that `world-step.ts` does not import `audio.ts`, so this cannot
  regress.
- Fly it: `npm run dev`. Every one of the eleven sounds must still fire on the
  same occasion — torus drop-out, low energy, the countdown, ECM, the scoop.
  Silence is the failure mode a test will not catch.
- `npm run portability` — the contaminated bucket must stay at zero.
