# 34 — Put the turret tell in the report

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

The report is already good: shots, hits, accuracy, lined-up share, in-range
share, mean aim error, time on each other's six, engagement seconds, mutual
range, shield and energy low-water marks, damage by source, and a row per
opponent.

What it cannot tell you is the single thing this project keeps getting wrong.
CLAUDE.md's warning is that a well-optimised pirate becomes a turret that hangs
in space and snipes, and that a brain winning every measurement can still be the
wrong brain. Three times now — g1, g2, and TODO 29's t29 — a brain has won on
damage and been rejected on feel. The evidence that settles it lives in
`train/flight-probe.ts`: how fast THEY flew, the spread of the ranges they chose,
and how often they actually made contact.

The report measures the player's envelope (`YOUR SPEED`, `YOUR PITCH / ROLL`)
and the mutual range, but nothing about how the opponent flew. So the one
judgement the trainer exists to support is the one it does not evidence.

## Implementation

- Add the opponent's flight envelope beside the player's: their speed
  (median / p90), and the range distribution they held rather than only the
  mutual median and closest — p10, median and p90 is what distinguishes a
  brain that commits from one that loiters.
- Add a count of PASSES: closing inside a stated range and opening out again.
  That is what an attack run looks like in data, and it is the difference
  between 0.20 contacts an episode and 2.23.
- One home for the definitions. `combat-sim-report.ts` already owns `SIX_CONE`
  and `SAMPLE_HZ` and states why each number is the measurement's own rather
  than a rule read from the game; a pass threshold belongs beside them with the
  same justification. `train/flight-probe.ts` must then READ those definitions
  rather than keeping its own, or the tool and the report will disagree about
  what a pass is.
- Do not add a verdict. The report presents; the pilot judges. A "turret score"
  would be this project inventing the metric that has already misled it twice.

## Acceptance

- The report shows how the opposition flew, not just how the player flew.
- `flight-probe.ts` and the in-game report produce the same figures for the same
  brain and seed, because they share the definitions.
- `COMBAT_SIM_SCHEMA` is not bumped — these are additions, and that file's own
  rule is to bump on meaning change, not on addition.
- Exported JSON carries the new fields.

## Verify

`npm run check`, then run the same brain through `train/flight-probe.ts` and
through an exercise at the same seed, and confirm the figures agree.
