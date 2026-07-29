# Combat training simulator — spec

A station facility, reachable from the docked menu, that puts you in a fight
against opposition you choose, in a ship you choose, and hands you a report
afterwards. It is the real game — real flight model, real brains, real guns —
not a replay of a training episode.

Three audiences, and the design has to serve all three:

1. **A pilot** practising, and learning what a Fer-de-Lance does differently
   from a Sidewinder.
2. **Chris** playtesting combat balance without flying to find a fight.
3. **The trainer.** Every exercise exports a record, and those records are what
   tell us whether a brain that wins in `evolve.ts` also wins against a human.
   That loop has been missing: brains are currently judged only by other brains
   and by bots, and CLAUDE.md invariant 8 records the cost — generation 1 and 2
   won every measurement and lost the only one that counted.

## The one rule

**Nothing that happens in the simulator leaves it.** Every hazard is an
instance of that rule:

- no save writes — autosave suspended, the world blob untouched
- no credits, bounty, kill count, combat rating, contract progress, legal status
- no cargo or equipment lost to a hull breach
- missiles, fuel and E.C.M. charges restored on exit
- death ends the exercise, not the career: no escape pod, no run over

The seam already exists. `StepHost` in `world-step.ts` is exactly the list of
verbs that reach outside the sky — `destroyNpc`, `raiseLegal`, `die`, `dock`,
`autoSave`. The simulator is an alternative `StepHost` that refuses or redirects
them, plus a snapshot on entry restored on exit as belt and braces.
`persistence.ts` already captures and restores the whole world, so the belt is
nearly free.

## Scenarios

Selectable, named, each a data entry rather than a code path:

| scenario | opposition |
| --- | --- |
| Lone bounty hunter | 1 hunter — Fer-de-Lance or Asp |
| Single pirate | 1 pirate, tier selectable |
| Pirate pair | 2 pirates, same tier |
| Pirate gang | 3-4 organised pirates flying the pack policy |
| Police interdiction | 2 Vipers — what shooting a trader actually buys you |
| Thargoid ambush | 2-3 Thargoids plus Thargons, the witch-space fight |
| As they come | asks `pirateThreat()` what the galaxy would send at your real mark right now, and sends that |

"As they come" matters most for balance: it is the only way to sample the fight
the live game would generate for a commander in your exact state, without flying
until one happens.

## Opponent selection and fit-out

Two levels, because the audiences differ:

- **Scenario picker** (a pilot): pick a scenario and a threat tier, launch.
- **Custom** (Chris, and the statistics): per opponent, choose the hull from the
  roster in `ship-specs.ts`, the count, the brain each flies
  (`pirate-attack-e1`, `g3`, `r2`, the pack policy, or the scripted baseline),
  and the fit — missiles, E.C.M.

Your own ship defaults to what you actually fly, with an override to fit
anything from the catalogue **for the exercise only**. That is `window.__cheat`
made legitimate and scoped: the same capability, but it cannot leak into the
career because of the one rule above.

Picking the opponent's *brain* is what turns this into an A/B rig. Fly the same
scenario against `e1` and against `r2`, and the report answers which is more
fun — the question CLAUDE.md says the numbers cannot.

## The report, and the export

Absorb `test/combat-recorder.js`. It already measures the right things and
CLAUDE.md says to prefer it over bot-flown numbers; it should stop being a
console paste and become part of the game.

Per exercise: the seed, the scenario, both loadouts, then —

- your accuracy and theirs; shots fired and hits
- damage both ways, **by source** (laser / missile / ram / collision)
- time to first kill, time to last
- median and closest engagement range
- share of the fight each side spent lined up on the other
- time you spent on their six versus theirs on yours
- shield and energy low-water marks
- a per-opponent line: hull, brain, how long it lived, what it landed

**Export** as JSON — clipboard and downloadable file — plus an in-memory ring of
recent exercises on `window.__simLog`, so a console session or an agent can read
them without going through the DOM. The JSON is the deliverable: it is what gets
fed back into judging a training run.

## Why it is a good agent test

Deterministic from a seed, ends by itself, emits a structured report, drivable
from `window.__game`. It should replace `test/arena.js`, `test/gang-trial.js`
and `test/combat-recorder.js` — three harnesses that drift independently — with
one thing that is also a player feature.

## What NOT to do

- **Do not reuse `Episode`.** There the player is a target flown by a
  controller; here you are the commander in the real Game. Share the statistics
  layer, never the simulation.
- **Do not add a field beside `GameState`.** Simulator state is state.
- **Do not shift the career's rng stream** — enter on a fresh seed, restore on exit.
- Not a `window.__` handle: it is a screen, per the Screen contract. One file in
  `src/game/screens/`, one line in `ScreenId`, one registration.

## Open questions for Chris

1. Does it cost credits? Free is friendlier; a fee makes it a considered choice
   and is more 1984.
2. Every station, or gated on tech level / government?
3. Which key on the docked menu — this drags in invariant 6's four places.
4. Sparring mode as well as scored scenarios: one ship, endless, until you quit?

## Deliberate deviation

Not in the original; needs a `docs/GAP-ANALYSIS.md` entry saying so and why. The
original had no way to practise, and a game whose opponents are trained wants
one — so a player can learn the ships, and so the AI can be judged against a
human instead of only against other AI.
