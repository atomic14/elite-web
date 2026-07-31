# 15 — Record the accepted findings in the review baseline

**Kind:** review hygiene · **Severity:** none — this is bookkeeping ·
**Size:** small

## Why

The deterministic half of the architecture review raised 33 "shallow module"
findings. Most are the metric misreading this project's deliberate style: many
small exported pure rule functions, so tests and the headless campaign run the
same code the game does.

The review's own calibration gate agrees. It reported
`metrics-too-harsh (4/4 blind calls in one direction)`: on every file where the
judge's blind read and the metric disagreed, the judge rated the module *deeper*
than the metric did. A one-directional skew like that means the thresholds are
mistuned for this codebase, not that four modules are broken.

Left unrecorded, those findings regenerate every run and bury the ones that matter.

## What is already done

`.architecture-review/baseline.json` currently suppresses two, with reasons:

- `gunnery.ts` — the combat balance table. 34 exports are named constants plus
  one-line pure functions over them; a wide flat surface is correct, and the
  alternative is the literals-in-`game.ts` arrangement that `gunnery.ts:108-121`
  was created to end.
- `player.ts` — exports `PLAYER_FLIGHT` and the envelope constants precisely so
  nothing copies them. It is the fix for one-rule-two-homes, not an instance of
  one. (See file 01, which is a case of something copying them anyway.)

## What to do

Walk the remaining shallow-module findings in `.architecture-review/review.json`
and, for each, decide one of three things:

- **Justified by domain** → add it to `baseline.json` with a one-line reason. The
  likely candidates, all the same pattern: `world.ts`, `law.ts`, `rng.ts`,
  `systems.ts`, `encounters.ts`, `jettison.ts`, `hyperspace.ts`,
  `navigation.ts`, and the small screen modules.
- **Real** → file it as a new numbered TODO here.
- **Genuinely unclear** → leave it unsuppressed. An open finding is cheaper than a
  wrong suppression.

Also suppress the one dependency cycle, `combat-sim.ts` ⇄
`combat-sim-safety.ts`: the back edge is `import type { ExerciseFit }` at
`combat-sim-safety.ts:31`, erased at compile time, so there is nothing to break.

Do **not** suppress a finding without a reason written next to it. The reason is
the whole value of the file — an unexplained suppression is indistinguishable from
hiding a problem.

## Optional: retune rather than suppress

The review suggests raising `T.shallowMinDensity` / `T.shallowMaxPublic` in the
skill's `analyze.mjs`, which would fix the class of false positive rather than
listing its members. Weigh it against the fact that those thresholds are shared
with every other project the skill reviews, so tuning them here makes scores
non-comparable elsewhere. Suppressing per-finding in this repo's baseline is the
more local, more honest option.

## Verify

Re-run the review and confirm the suppressed count rises, the findings count
falls, and no finding you meant to keep disappeared:

```sh
node <skill-dir>/scripts/score.mjs .architecture-review/analysis.json \
  --judgments .architecture-review/judgments.json \
  --baseline .architecture-review/baseline.json \
  --out .architecture-review/review.json
```

`health` will rise. That rise means "we stopped counting things we decided were
fine" — not "the code improved". Do not quote it as progress.
