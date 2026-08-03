# 60 — The playtest agent strands itself after two or three legs

**Kind:** verification · **Severity:** medium · **Size:** medium
**Depends on:** none

## Why

`test/playtest.js` is one of the four things CLAUDE.md names under Verification:
*"`test/playtest.js` plays the real game and asserts invariants."* It does not
currently get far enough to do that. Asked for forty legs it completes two or
three, then reports the same three violations and gives up:

```text
failed to dock within step budget (day 6)
failed to dock within step budget (day 6)
stranded — abandoning run (day 6)
```

Three separate runs, two on `main` and one on `b75bcb9` — the commit before any
of TODO 58 or 59 — produced that identical shape:

| run | commit | legs | deaths | credits at the end | violations |
|---|---|---|---|---|---|
| 1 | `main` | 2 | 0 | 1.6 Cr | 3 |
| 2 | `main` | 3 | 2 | 32 Cr | 3 |
| 3 | `b75bcb9` | 3 | 1 | 14 Cr | 3 |

**This is not a regression from the description or encyclopaedia work** — the
baseline run is what establishes that, and it is the reason to trust the rest of
the sweep. It is pre-existing, and it means the harness has been unable to do
its job for at least as long as that.

## What is actually failing

`flyToStationAndDock` gives up after **20,000 steps** of approach without
reaching `docked`. The commander then has no cash and no cargo, so the next leg
has nothing to trade with and the run is abandoned as stranded. The two are one
failure: the strand is downstream of the dock.

The harness already knows this region is difficult and carries two mitigations —
a `blockaded` latch, for pirates loitering in the station's lap holding the
approach at a standstill, and a `fightingTooLong` cap, because the defence
policy evades superbly and shoots badly so an engagement need not ever end. Both
of those are about not being *stopped*. Neither addresses simply not arriving.

## What is NOT the problem

Worth writing down, because each of these was checked and would otherwise be
the first guess:

- **Not the game's rules.** `npm test` is 2748 passing, the campaign passes its
  balance checks, and `npm run elite-a` passes all 478.
- **Not `g.world.station` being unavailable.** It has a position throughout;
  an early probe here used `g.station`, which is the ship-systems object and
  has no `position` at all. That was a bad probe, not a finding.
- **Not fuel.** The strand follows the failed dock rather than causing it.

## What to work out

- **Instrument the give-up.** At the moment the budget runs out, record the
  distance to the station, the distance to the gate, `finalRun`, `blockaded`,
  `holdSteps`, `combatSteps` and the nearest hostile. One line at that point
  would separate the candidates below, and none of them can be separated
  without it.
- **The three candidates**, in the order they are worth testing: the final-run
  approach oscillates and never converges (`finalRun` is set when within 60 of
  the gate and cleared if the ship ends up 150 further from the station than it
  started — a cycle between those two is invisible to the step budget); or the
  collision hold at 320 keeps re-triggering below the `blockaded` threshold
  because `holdSteps` resets to 0 on every step that clears; or the ship is
  simply never getting close, and the fault is upstream in the torus/gate leg.
- **Decide what a failure to dock should DO.** Right now it is a violation and
  the run continues into a strand, which turns one fault into three and buries
  the first. A dock that fails is a legitimate outcome for a bot; the run
  should either retry from a station save or end cleanly saying so.
- **The step budget may simply be too small** for an anarchy with a blockade.
  Test that first — it is the cheapest of these to rule out, and if raising it
  fixes a forty-leg run then everything above is a smaller problem than it
  looks.

## Watch out for

- **`useHarnessSaves()` before anything flies.** The harness calls it first
  already; any new probe must too, or a scratch commander autosaves over a real
  one. That is not hypothetical — it has happened once in this project.
- Run it against **both** `main` and a pre-change commit whenever it is
  touched. Having a baseline is what made this finding safe to interpret, and
  it cost one worktree.

## Acceptance

- A forty-leg run completes, or ends with a stated reason that is not a
  cascade of three violations from one cause.
- The give-up path records enough to say which of the candidates it was.
- Whatever the fix is, the harness reports a failed dock distinctly from a
  strand — one fault, one line.

## Verify

Serve the game, paste `test/playtest.js` into the console, and
`await __playtest.run({ legs: 40 })`. It is a browser harness and does not run
under node: pasting it into `node` fails at `window is not defined`, which is
expected and not a bug.
