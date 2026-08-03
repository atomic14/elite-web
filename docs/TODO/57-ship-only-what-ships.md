# 57 — Ship only what ships

**Kind:** simplification / UI · **Severity:** medium · **Size:** large
**Depends on:** none

## Why

Chris, 2026-08-03: *"we should clean up all the experiments that aren't
shipping — so we can just show the combat AI that we actually ship."*

There are **34 brain files** on disk. The game imports 9. **Three ship**:

```text
pirate-attack-g3            the solo pirate
pirate-pack-r4-selectonly   an organised gang
jameson-defend-g1           an armed trader, and player assist
```

Everything else is an experiment kept as evidence — and the evidence has
served its purpose. The measurements are recorded in `docs/TRAINING-LOG.md`
and `train/logs/`, which stay.

One of the experiments is also a live defect: `src/viewer/main.ts:19` imports
`pirate-pack.json`, a round-one policy, and the scenario labelled *"Pack of 3
vs armed trader"* flies it. The shipped gang is `pirate-pack-r4-selectonly`.
So the viewer currently shows a pack we do not ship, under a label implying we
do. Its solo scenarios were corrected in TODO 52; its pack scenarios were not.

And `/viewer` opens on the design gallery with a combat scenario dropdown
underneath it, so the combat viewer reads as deleted when it is one keypress
away. Same discoverability trap as the waves mode.

## Chris's two decisions (implement these)

1. **Delete the lot** — the viewer's experimental scenarios, the trainer's
   brain picker down to what ships, and the 31 non-shipped brain files.
2. **Split the viewer into two pages**: `/viewer` is the combat viewer only,
   `/gallery` is the 38 hulls only. Each opens on one thing and needs no mode
   key. A new entry in `vite.config.ts` — a page that is not an entry does not
   build.

## What to work out

- **`scripted` is not an experiment**, it is a code path — the
  pre-neuroevolution AI that `state.brains.scripted` still selects and that
  tests use as a control. Decide whether it stays offered; my read is that it
  should, because "what the game did before any of this" is a comparison
  against what ships rather than a rival to it. Say what you chose.
- **`BrainSelection` shrinks.** Flags for `legacy`, `sharp`, `engine`, `t29`,
  `packT29` and `defendT29` have nothing left to select. Removing them is the
  point of this item — but they are STATE (invariant 12) and they are
  snapshotted, so a save carrying one must still load. No migration is needed
  (Chris, 2026-08-03), but it must not throw.
- **`docs/TRAINING-LOG.md` is append-only history** and cites runs by name.
  Do not rewrite it. Add one dated note saying the weights for those runs were
  deleted here and that the figures stand as the record of what was measured.
- The trainer's brain picker exists because TODO 32 and 34 built it into an
  A/B rig, and that rig is what caught `t29` being a turret. After this, a
  future candidate is compared by putting its file back and adding a row.
  Leave `train/flight-probe.ts` and `train/evaluate.ts` able to do that.

## Acceptance

- `src/ai-training/brains/` holds exactly the three shipped files.
- Nothing in `src/` imports a brain that is not one of them.
- `/viewer` is the combat viewer and opens on it; `/gallery` is the hulls and
  opens on them; both are entries in `vite.config.ts`; neither shows the
  other's controls.
- Every scenario the viewer offers flies a brain we ship, or a stated control.
- A test fails if a brain file appears that nothing ships, or if a shipped
  brain is missing.
- `npm run campaign` and the `test/ai.test.ts` gates are unmoved — the shipped
  brains do not change, so nothing about the game's difficulty should.
- The bundle shrinks; report by how much.

## Verify

`npm run check`, `npm run build`, then open both pages and confirm each shows
one thing and flies what it says it flies.
