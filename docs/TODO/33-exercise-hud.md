# 33 — Tell the pilot they are in an exercise, and how it is going

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

Once an exercise launches, the only sign it is an exercise is a four-second
banner. After that the cockpit is the ordinary cockpit: no elapsed time, no time
remaining, no shots or hits, nothing.

That breaks the tool in its own terms. The trainer's purpose is judging how a
fight FEELS, and the numbers that would connect the feeling to the evidence
arrive only after it is over — by which point the pilot is recalling rather than
observing. It also means a pilot cannot tell a 45-second exercise that is nearly
up from one that has just begun, and cannot tell an exercise from real space if
the banner has faded.

## Implementation

- A small, permanently visible exercise strip while `combatSim.active`: that
  this is a simulation, elapsed and remaining seconds, and the live tallies the
  report already accumulates (shots, hits, accuracy, hits taken).
- Read-only, and it must not become a second home for anything. Everything on it
  already exists in `combat-sim-report.ts` while the exercise runs; the strip
  reads that, it does not recount. The HUD is a dumb painter (CLAUDE.md
  invariant 15) and stays one.
- Do not draw it in ordinary flight. `Game.mode` is derived, and the simulator
  is ordinary flight with a different `StepHost`; use the same condition the
  `simulator` key table uses rather than inventing a second test.
- Keep it out of the way of the sight and the scanner. The cockpit is crowded
  and the fight is the thing being watched.

## Acceptance

- The strip is visible for the whole exercise and never appears in career
  flight.
- Its numbers agree exactly with the report rendered afterwards, for the same
  exercise, with no separate accumulation.
- It costs nothing when the simulator is inactive.
- A headless test asserts the strip's model from a run exercise; the painter
  stays untested and inert without a DOM (`engine/inert-dom.ts`).

## Verify

`npm run check`, then fly an exercise and compare the strip's final numbers
against the report it produces.
