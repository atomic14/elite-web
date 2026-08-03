# 61 — Promote or delete the attack-run candidate

**Kind:** decision · **Severity:** medium · **Size:** small
**Depends on:** none

## Why

Three source files already cite "TODO 61" for this and the file was never
written — `combat-sim-scenarios.ts`, `brains.ts` and `brain-names.ts` all name
it, and `test/ai.test.ts` explains the candidate machinery in terms of it. A
number cited by four places and backed by none is the sort of thing that reads
as a missing file rather than a missing decision, so here is the decision.

`pirate-attack-e1` was restored from `15330cb` to be compared against the
shipped solo policy. It is offered by both pickers, has a `BrainSelection`
(`passes`), a character line and a name (MAKES RUNS), and its weights sit in
`src/ai-training/brains/`.

**The ground under it has moved.** It was a candidate to replace
`pirate-attack-g3` as the solo pirate policy. Since `d563e3d` neither is: what
ships is the scripted attack run, for solo pirates and organised gangs alike.
So `e1` is now a candidate for a job that no longer exists, and it is being kept
by inertia rather than by an argument.

## What is actually at stake

`npm test` asserts the weights directory is exactly what `brains.ts` imports.
That guard is the reason this cannot be left alone forever, and it is working as
designed — CLAUDE.md: *"The guard reports the extra file until it is promoted or
removed — that is the decision it forces."* Every training run that produces a
new brain has to answer this question before the suite is green again.

## What to work out

Three honest options, and the evidence for each is already recorded:

- **Delete it.** It was a candidate for a role the scripted run now fills, and
  TODO 57's precedent is to delete what nothing flies — 31 files went that way.
  Removing it is `brain-names.ts`'s `CANDIDATE_SOLO`, its `BRAINS` row, its
  `SELECTIONS` entry, the `passes` flag, `SIM_BRAINS`, the `brains.ts` import
  and the file. `docs/TRAINING-LOG.md` keeps what it measured.
- **Keep it as a named alternative**, the way `pirate-attack-g3` is kept — a
  policy the trainer can fly for comparison but that the game never picks. This
  is the status quo made deliberate, and it costs one `trained`-style flag so
  the selection is not a flag with no default behind it.
- **Fly it first.** `e1` has never been played by a human — it was measured in
  the probe and never put on the setup panel's exercise row for a real fight.
  One session with THE OPPOSITION FLIES set to MAKES RUNS answers it.

## Watch out for

- **Both pickers, or neither.** Adding `e1` to the career row and not to
  `SIM_BRAINS` was a real bug for two commits: the candidate could only be flown
  from the fenced row that changes the whole career, which is the one thing a
  scoped A/B must not touch. Whatever is decided, the two lists move together.
- **`SIM_BRAINS` is named, not derived** (see its comment). Deleting `e1`
  means deleting its row there too; it will not fall out on its own.

## Acceptance

- Either `pirate-attack-e1` is gone from the bundle and every reference to it,
  or it is documented as a permanent alternative with a stated reason.
- `npm test`'s weights-directory guard passes without an exemption.
- The four "TODO 61" citations in the source read true.

## Verify

`npm test` — the guard is the acceptance test. Then `ls
src/ai-training/brains/` and confirm every file is one `brains.ts` imports.
