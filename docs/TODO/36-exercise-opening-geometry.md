# 36 — Start the exercise where the pilot can see it

**Kind:** UI/UX · **Severity:** medium · **Size:** small
**Depends on:** none

## Why

An exercise currently opens with the opponent off-screen. On a first launch the
only sign of it is a small target bracket at the edge of the view, partly under
the console, with the pilot already being shot at.

For an ambush in career flight that is correct and should stay. For a trainer it
throws away the most informative seconds of the fight: the approach is where a
brain shows whether it commits or loiters, and it happens before the pilot has
found it.

## Implementation

- Open a scenario with the opposition in view — ahead and at a stated range —
  unless the scenario is specifically about being jumped.
- State the opening geometry on the report, so a fight can be reproduced and so
  a scenario that deliberately starts behind the pilot is visibly deliberate.
- It is seeded state like everything else: the same seed must give the same
  opening.
- Do not change career spawning. This is the simulator's scenario setup, not
  `spawning.ts`.

## Acceptance

- A launched exercise starts with the opposition on screen, or is explicitly a
  scenario that does not.
- The same seed gives the same opening geometry before and after.
- Career encounter placement is untouched — a seeded career run is unchanged.

## Verify

`npm run check` plus a seeded-equivalence check on career spawning, then launch
each scenario and confirm what is on screen at t=0.
