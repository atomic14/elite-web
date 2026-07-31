# TODO — architecture review, 2026-07-30

One file per fix. Each is self-contained: a fresh session can open a single file,
make the change, verify it, and stop. Do them in numbered order — the order is
by (severity × how load-bearing), not by size.

Every `file:line` in these files was read and confirmed at review time against
commit `de9a668`. If a line has moved, the surrounding grep in the file's
**Evidence** section will still find it.

Full review output is in `.architecture-review/` (gitignored):
`report-2026-07-30.html`, `review.json` (deterministic findings),
`judgments.json` (the design read).

## Checklist

Progress: **16 / 16 complete**. Last verified after item 16: `npm run lint`,
`npm test`, `npm run sizes`, and `npm run campaign` — **1261 passed, 0 failed**.

- [x] 01 — [HUD roll/pitch bars normalise by stale flight caps](01-hud-flight-envelope-literals.md) — live defect, two homes · 2 lines
- [x] 02 — [The trainer re-implements the firing sequence](02-trainer-firing-sequence.md) — invariant 5 · medium
- [x] 03 — [Two modules choose the observation encoder, differently](03-observation-encoder-chooser.md) — two homes · small
- [x] 04 — [`ObservableShip` marshalling written twice, both cast](04-observable-ship-view.md) — wrong interface · small
- [x] 05 — [`world-step.ts` calls audio directly](05-world-step-sound-events.md) — platform leak · medium
- [x] 06 — [Hermit market pricing lives in the orchestrator](06-hermit-market-pricing.md) — invariant 10 · small
- [x] 07 — [`npc.attackers` is public with two external writers](07-npc-attackers-encapsulation.md) — leaky abstraction · small
- [x] 08 — [`NpcShip.update` takes a remembered world fact](08-npc-update-world-view.md) — sticky parameter · medium
- [x] 09 — [The pause key is read outside the bindings table](09-pause-command.md) — invariant 9 · small
- [x] 10 — [`sfx.beep(hz)` puts oscillator units in world code](10-audio-named-sounds.md) — wrong seam · medium
- [x] 11 — [~83 forwarding accessors are the orchestrator's interface](11-game-accessor-shim.md) — pass-through · large
- [x] 12 — [Console harnesses are load-bearing on production signatures](12-instrumentation-seam.md) — conjoined · medium
- [x] 13 — [Orphaned doc comments in `npc.ts` and `hud.ts`](13-comment-debt.md) — comment debt · small
- [x] 14 — [The HUD painter owns message lifetime](14-hud-frame-completeness.md) — temporal decomposition · medium
- [x] 15 — [Record accepted findings in the review baseline](15-review-baseline.md) — review hygiene · small
- [x] 16 — [Remove `NpcShip`'s duplicate state access paths](16-npc-state-accessor-shim.md) — pass-through · medium

## What is deliberately NOT filed

- **Most "shallow module" findings (33 of them).** The review's own calibration
  gate fired `metrics-too-harsh` — 4 of 4 blind judgments rated modules deeper
  than the density metric did, all in the same direction. This project's style,
  many small exported pure rule functions so tests and the headless campaign run
  the real code, reads as a wide interface to the metric and is correct here.
  `gunnery.ts` (a balance table) and `player.ts` (the fix for two-homes, not an
  instance of it) were explicitly judged justified-by-domain. See file 15.
- **The complexity hotspots** — `scenario.ts step()` CCN 35, `npc.ts update()`
  26, `trade.ts buyEquipment()` 27, and five more. These are metric-only: no
  judgment pass looked at them, so there is no design read behind them and no
  claim here that splitting them would improve anything. `world-step.ts`'s two
  hotspots were judged, and the verdict was that the branch count belongs to the
  problem, not the module.
- **The one import cycle** (`combat-sim.ts` ⇄ `combat-sim-safety.ts`). The back
  edge is `import type { ExerciseFit }` at `combat-sim-safety.ts:31`, erased at
  compile time. Nothing to fix; suppress it (file 15).
- **`game.ts` imports 59 modules.** That is what an orchestrator does. File 11
  is the real version of this complaint.
