# 67 — Short attack runs are not flyable, so the rhythm is fixed at ~9s

**Kind:** combat feel · **Severity:** medium · **Size:** medium
**Depends on:** none

## Why

Chris, having flown the attack run: *"I think one thing I'm observing they fly
quite far before turning for another run."* Measured over 40 five-ship
engagements, the gap between one ship's merges was **9.4s median**, and it went
out to 1,135 units in between.

The obvious fix does not work, and `break-off.ts` records why in its
`EXTEND_RANGE_MIN` comment. Lowering the turn-back range shortens the gap a
little and then breaks the run:

```
band        450-900   700-1100   750-1250   800-1400   900 fixed
rammed         22.7        4.4        8.8        3.7         2.9
passes/ep      4.77       5.30       4.98       4.63        5.25
median apex     906       1126       1236       1331        1134
```

Below about 700 the ship arrives at the merge still pointed at the middle and
flies into it. So the shipped band is 700-1100: it destaggers a gang, which was
the other half of what Chris asked for, and leaves the runs the same LENGTH as
before.

## What is actually failing

**The entire 180 happens in the closing leg.** `extending` flies dead straight —
it steers for nothing at all — so when the phase flips, the closing leg has to
contain both the turn-around AND the run-in that settles the ship onto its
`PASS_MISS_DISTANCE` line. Below ~700 units there is not room for both.

A pilot does not fly straight for 900 units and then pivot. They fly a curve,
arriving already pointed with the whole remaining distance available as run-in.

## What is NOT the problem

- **Not the turn rate.** Slowing does not raise it — `steerToward` rotates by
  `turnRate * dt` and speed appears nowhere in it. `closingThrottle` already
  exploits what slowing DOES buy (radius, and the rate you must track).
- **Not tuning.** Five bands were measured; the floor is structural.
- **Not steering at the target during the extend.** Tried, and it cancels the
  extend outright: 0.90 passes an episode with the range spread collapsed to
  274/366/709, which is the turret shape the whole cycle exists to avoid.

## What to work out

- **A turn that keeps an outward component.** The naive version steers at the
  target and the ship simply comes back. What is wanted is an arc — still
  opening the range while rotating — so the run-out and the turn overlap
  instead of being sequential.
- **Where the arc starts.** A `CLEAR_RANGE` constant was drafted (340, being
  `BREAK_OFF_RANGE` plus half again) on the reasoning that turning before the
  ship has cleared puts it back through the target it just passed. That number
  was never tested against a working arc.
- **What it does to the pass counter.** `PASS_FAR` must stay below the shortest
  run the model can produce or the measurement goes blind — see
  `combat-sim-report.ts`, which records that this was nearly got wrong once.

## Watch out for

- **Rams are the failure mode**, and they are the thing Chris complained about
  in the first place. Any candidate is judged on contact damage first and gap
  second.
- **`EXTEND_RANGE_MIN` can come down only when this is done.** The two are one
  change; lowering the band alone has already been measured and it does not
  work.

## Acceptance

- Median merge-to-merge gap materially under 9.4s at contact damage no worse
  than the shipped 4.4 an episode.
- The range spread does not collapse — a shorter cycle that stops sweeping is a
  turret with a faster clock.
- `EXTEND_RANGE_MIN` can be lowered, and the doc comment's table is re-derived.

## Verify

The probe in the Why section: 40 five-ship engagements, merge-to-merge intervals
and apex distances, against the shipped numbers. Then fly it — the gap is a feel
question and 9.4s was reported by a human before it was measured.
