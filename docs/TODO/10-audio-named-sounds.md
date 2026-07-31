# 10 — `sfx.beep(hz)` puts oscillator units in world code

**Kind:** configuration overload / wrong seam · **Severity:** low, but broad ·
**Size:** medium

## What is wrong

Every other sound in `audio.ts` is named for the event that causes it. `beep`
instead takes frequency, duration and gain — so game rules end up choosing hertz
and envelope times, and the module that exists to own sound design does not own
it for the most common case.

The clearest instance is a synth sweep computed inside the world step.

## Evidence (read at `de9a668`)

- `src/audio.ts:113-115` — `beep(freq, duration, gain)`, against the named verbs
  around it: `laser`, `hit`, `explosion`, `dock`, `hyperspace`, `ecm`, `bomb`.
- Callers in the world step: `src/game/world-step.ts:230` `sfx.beep(300)` (torus
  drop-out), `:457` `sfx.beep(320, 0.1)` (low energy), `:502` `sfx.beep(500, 0.1)`
  (scooped), `:576` `sfx.beep(140, 0.5)`, and
  `:482` `sfx.beep(700 + (5 - now) * 100, 0.07)` — the hyperspace countdown,
  i.e. a pitch sweep expressed as arithmetic in the simulation.
- Roughly 25 further `sfx.*` calls in `game.ts`, most of them beeps — e.g.
  `game.ts:828` and `:981` both `sfx.beep(220)` for a refusal, and
  `game.ts:954` `sfx.beep(m.beep.hz, m.beep.seconds)` where a beep's *pitch* has
  been threaded through a message struct.
- `src/game/autopilot.ts:47` — `const REFUSED: AutopilotEvent = { kind: 'beep', hz: 220 };`
  The same 220 Hz "no" now has at least three homes.

## The fix

Name the remaining sounds and give them methods on `audio.ts`: `warning()`,
`scooped()`, `countdown(n)`, `refused()`, and whatever `:371`, `:375`, `:576`
turn out to be — read each call's surroundings to name it for its occasion, not
its pitch. Then `audio.ts` owns pitch and envelope, which is the only reason the
module exists.

Keep `beep(freq, ...)` if something genuinely needs a raw tone, but it should end
up with no callers in `src/game/`.

Note `game.ts:954`'s `m.beep.hz` — that is a message struct carrying audio
parameters. Once the sounds are named, the struct should carry a sound *name*
instead.

## Verify

- `npm run lint && npm test`
- **Listen to it.** This is a change no test can judge: `npm run dev`, then
  trigger each renamed sound — drop out of torus, run the energy low, scoop a
  canister, start a hyperspace countdown, get a refusal. Each must sound as it
  does today unless you deliberately improved it, in which case say so.
- `grep -rn "sfx.beep" src/game src/hud` should come back empty.

## Notes

Overlaps with file 05, which removes `world-step.ts`'s direct audio calls
entirely. If 05 is done first, five of these callers become event kinds and this
file is about naming those kinds well plus cleaning up `game.ts`'s twenty-odd.
Doing 05 first is the better order.
