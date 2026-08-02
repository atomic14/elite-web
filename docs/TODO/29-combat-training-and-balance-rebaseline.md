# 29 — Rebaseline simulations, training and campaign combat

**Kind:** AI / balance · **Severity:** high · **Size:** large
**Depends on:** 25, 28

## Why

Exact geometry, a larger roster and source-scale damage will change encounter
outcomes even though firing cadence and AI policy remain Harmless systems.
Trainers, saved brains and campaign gates must use the runtime model rather
than retain a parallel normalized approximation.

## Implementation

1. Extend simulation inputs/reports with player hull ID, fitted laser, NPC
   design/profile ID, initial/final source-scale systems and schema version.
2. Normalize health only at the AI observation boundary from exact current and
   maximum values.
3. Make scenario generation sample the expanded valid roster and call runtime
   combat functions for every damage path.
4. Evaluate existing brains unchanged first and archive deterministic
   before/after reports. Retrain only after schema and scenario parity are
   proven.
5. Exercise all 15 player combat profiles and all 38 recommended NPC/object
   profiles in evaluation, while excluding non-combat objects from misleading
   win-rate aggregates.
6. Retrain solo, pack and defence brains as needed, with separate training and
   held-out seeds.
7. Recalculate acceptance thresholds from multi-seed distributions. Exact
   combat-oracle gates are immutable and cannot be weakened for AI balance.
8. Rebaseline campaign survivability, combat score and bounty pacing without
   adding the deferred player shipyard or blueprint-set selector.
9. Run browser play trials for hit readability, time-to-kill, warning cadence,
   docking risk and representative old/new hull encounters.

## Carried over from TODO 26 — the Constrictor is unkillable

Source-exact rules make the Navy mission unwinnable for almost every
commander, and this is the balance call this TODO exists to make.

The Constrictor halves player hit strength before its 3 points of defence
subtract. A beam laser hits for 7, halves to 3, and does **zero** — the
pack's own `hits-to-destroy` row for Cobra Mk III / beam / G:28 is `null`.
A pulse laser needs 115 hits, 27.6 seconds of unbroken fire. Only a military
laser kills it in reasonable time. But the campaign says 100% of commanders
buy a beam and 3% ever buy a military laser.

TODO 26 shipped the source rule unaltered and did not work around it. Decide
here: brief the player that the mission needs a military laser, adjust the
mission's reward or availability, or record a deliberate deviation. Do not
change the oracle — its rows are immutable.

## Reproducibility

Record commands, seeds, scenario counts, catalogue manifest hash, schema
version and brain artifact hashes. Reports must distinguish source-rule changes
from AI retraining effects.

## Acceptance

- Runtime and trainer import the same combat/profile functions.
- Simulations are deterministic for the same seed and configuration.
- All trained artifacts pass held-out structural and outcome gates.
- Campaign checks cover early, middle and late combat threat bands.
- A concise browser trial log records accepted balance deviations.

## Verify

Run simulator parity, training/evaluation, campaign and standard verification,
then complete and record the browser trials.
