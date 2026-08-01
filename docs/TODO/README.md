# TODO — architecture review follow-ups, 2026-07-31

One file per fix. Each is self-contained so a fresh session can open one file,
make the change, verify it, and stop. Work through them in numbered order with
one sub-agent per item.

TODO 01–16 were completed and checkpointed in commit `0fc8627`; their files
were removed from the active queue and remain available in Git history.

## Checklist

Progress: **4 / 4 complete**. Last verified after item 20: `npm run build`,
`npm run campaign`, and `npm run portability` — **1293 passed, 0 failed**. The
new dependency-aware gate's fixtures pass and the live graph reports **0
contaminated files**. Its first honest run exposed 16; the follow-up boundary
cleanup removed those paths, so the zero is now graph-backed.

- [x] 17 — [NPC docking latch is missing from the snapshot](17-npc-dock-plan-snapshot.md) — missing behavior state · high · small
- [x] 18 — [`draw()` advances the cockpit beam lifetime](18-beam-timer-in-step.md) — temporal decomposition · medium · small
- [x] 19 — [Core rule modules still perform platform side effects](19-core-platform-side-effects.md) — platform leak · medium · large
- [x] 20 — [The portability gate does not follow imports](20-dependency-aware-portability.md) — tooling defect · medium · medium

## Review context

These four items came from a fresh read of the live worktree after TODO 16, not
from the stale `.architecture-review/analysis.json` generated against
`de9a668`. The old deterministic findings remain useful historical evidence,
but their `Game` and `NpcShip` surface counts do not describe current code.

Manual sound, Dodo-docking, and pasted browser-playtest checks still require a
browser and speakers; every item should record which of those was feasible.
