# 66 — The pass aims where you were, not where you will be

**Kind:** combat bug · **Severity:** medium · **Size:** small
**Depends on:** none

## Why

The attack run added in `d563e3d` aims each run `PASS_MISS_DISTANCE` (110 units)
to one side of its target, so the ship goes past rather than through. Against a
target that holds still that works: contact damage fell from 104 points an
episode when the run aimed at the hull, to 2.2.

Against a target that MOVES it does not, and Chris's wave-10 record
(`seed1227898432`, 2026-08-03) is the measurement:

```
their damage    laser 359 (22.9%)   ram 460 (29.3%)   missile 750 (47.8%)
events          4 rams, two of them in the final second
```

Ramming is the second largest source of damage taken, and the flight model is
supposed to have removed it.

## What is actually failing

`passOffset()` is computed against `targetPos` — the target's position AT THAT
INSTANT — and the pass then commits to that heading, deliberately, because
steering during the merge is what caused the original collisions.

The commander closes at up to 400 and a pirate at ~240, so a head-on merge has a
closing speed near 640 and takes roughly half a second. In half a second the
commander moves ~200 units. The offset is 110. **The miss distance is smaller
than the target's own movement during the merge**, so a run that committed to a
clean pass arrives where the commander now is.

## What to work out

- **Lead the aim point**, the way the gun already does. `npcTriggerPull` gates
  on the angle to a target it can see moving; the same arithmetic gives a
  predicted position to offset from. The target's velocity is available — the
  commander's speed and heading are both on `PlayerShip`.
- **How far ahead.** Time-to-merge is `dist / closingSpeed`, which the ship
  already has both halves of. Predicting further than the merge is worse than
  not predicting: a target that turns makes a long extrapolation wrong.
- **Whether the miss distance should scale with closure** instead of, or as
  well as, leading. 110 was chosen against two hulls' radii (about 68), not
  against relative motion.
- **Do not steer during the pass to fix this.** It was tried and it is what the
  pass exists to prevent — see break-off.ts's account of the 104-point episode.

## Watch out for

- **Do not regress the static case.** 2.2 points an episode against a holding
  target is the number to hold; `train/flight-probe.ts` reports it as `rams`.
- **Wingman separation is a different rule** (`separation.ts`) and already leads
  nothing — it is a repulsion, not an intercept. Leave it alone.
- **This changes seeded outcomes.** Expected; determinism is not.

## Acceptance

- Contact damage against a MOVING target falls materially from the 460 points /
  4 events recorded above, measured over a comparable fight.
- Contact damage against a holding target stays at or below 2.2 an episode.
- The passes count does not fall — a ship that misses by so much that it never
  threatens has fixed the wrong thing.

## Verify

`npm run flight-probe` for the static case — the `rams` column, against a target
that holds still. It should not rise.

Then fly waves in the trainer and read `damageBySource.ram` in the exported
record. The fight this item is measured from is Chris's `seed1227898432` (wave
10, five ships): 460 ram points over 4 events out of 1,569 taken. A comparable
fight should show materially fewer. Exported records live wherever the trainer's
X — EXPORT FILE button put them; the JSON shape is `CombatSimReport` in
`src/game/combat-sim-report.ts`.
