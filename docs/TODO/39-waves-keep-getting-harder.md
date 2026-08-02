# 39 — Make the wave ramp keep getting harder

**Kind:** gameplay · **Severity:** high · **Size:** medium
**Depends on:** 31, 34

## Why

`waves` mode already exists and already escalates. It is also the mode Chris
did not know was there, which TODO 31 and 32 address — but the ramp itself
stops.

Today it is count and tier only, and both top out:

```text
wave   1  2  3  4  5  6  7  8  9 10 11 12+
count  1  1  2  2  3  3  4  4  5  5  6  6
tier   0  0  0  1  1  1  2  2  2  2  2  2
```

From wave 11 every wave is the same fight. The saturation is deliberate and the
argument for it is good: a ramp that diverges makes the score a fact about
arithmetic — wave 40 is forty Fer-de-Lances and nobody learns anything from it —
where a ramp that stops means the late waves are all the same and surviving
three of them is a fact about flying. `npm test` asserts both properties.

Both things can be true. The ramp should keep getting harder without getting
bigger, and the axes it has never used are the ones the Elite-A phase just made
real: which released BUILD the opposition flies, what it is FITTED with, and
which roles show up at all. A wave-14 that is six professionals with missiles
and an E.C.M. is harder than wave 11 without being seven ships.

## Implementation

- Keep the count and tier ramp exactly as it is, including the saturation
  point and the two asserted properties. This adds axes; it does not raise the
  ceiling on the existing one.
- Escalate on axes that change the FIGHT rather than the arithmetic. Candidates,
  in the order they are worth trying: the exact variant flown (TODO 29 gave us
  `role-variants.ts` — a harder released build of the same hull is a real step
  and still 100% source data); opposition ordnance (missiles, then E.C.M.);
  role mix (a hunter among the pirates, then Thargoids and Thargons, which the
  scenario table already knows how to send).
- Every step must be a STATED rule with a reason, in `combat-sim-scenarios.ts`
  beside the existing ramp, and must be a pure function of the wave number. No
  new randomness that a seed cannot reproduce.
- The ramp must still saturate. Pick the new saturation point deliberately and
  say why; quote it in the report the way `WAVE_SATURATION` already is.
- The report and the wave banner should say what changed about this wave, or
  the escalation is invisible and the pilot cannot tell a hard wave from an
  unlucky one.
- A run needs a result worth coming back to: the furthest wave reached, kept
  with the commander. It is state, so it is saved; it is not a rating, a kill or
  a credit, so it must not leak into the career (the panel's own promise is that
  nothing in the room leaves it).

## Acceptance

- Waves keep getting harder past 11, and the difference is visible in the
  report rather than only in the outcome.
- The ramp still saturates, at a stated wave, for the stated reason.
- Every wave is a pure function of its number and the seed: the same seed gives
  the same run.
- The existing asserted properties — ramps, then saturates, never diverges —
  still hold, with their tests updated to the new shape rather than deleted.
- Nothing about a run reaches the career except the furthest wave reached, and
  a test asserts the rest of the promise still holds.

## Verify

`npm run check`, then fly waves past the old saturation point and confirm the
fight changes character rather than just growing.
