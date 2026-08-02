# Combat training simulator — spec

> **Status: built and shipped** (`T` at any station). This is the spec it was
> built from, kept because the arguments in it — the one rule, the three
> enforcement layers, what NOT to do — are still the reasons the code is shaped
> the way it is. Read it in the past tense where it plans. The three console
> harnesses it proposes absorbing (`test/arena.js`, `test/gang-trial.js`,
> `test/combat-recorder.js`) were absorbed and deleted; the enforcement now
> lives in `src/game/combat-sim-safety.ts` and the scenarios in
> `src/game/combat-sim-scenarios.ts`.

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
   and by bots, and CLAUDE.md's "threat is not fun" records the cost — generation 1 and 2
   won every measurement and lost the only one that counted.

## The one rule

**Nothing that happens in the simulator leaves it.**

The load-bearing case, in Chris's words: **it must not advance you toward
E L I T E — that requires real kills.** Concretely, a simulator kill must not
touch either of:

- `commander.kills` — the body count on the status screen
- `commander.combatScore` — what `rating()` reads, and therefore the whole
  Harmless → E L I T E ladder

Those are two separate fields for a reason (`killValue()` weights a kill by
threat tier, so the rating counts difficulty and not bodies), and a simulator
that credited either would hollow out the only long-term progression the game
has. It is the one thing here that would be unforgivable to get wrong: a player
could grind the ladder in a training room, for free, at a station, with no risk.

Everything else is the same rule applied:

- no save writes — autosave suspended, the world blob untouched
- no credits, no bounty, no contract progress, no legal status
- no cargo or equipment lost to a hull breach
- missiles, fuel and E.C.M. charges restored on exit
- death ends the exercise, not the career: no escape pod, no run over

**This wants a test, not care.** `combat.ts`'s `destroy()` is what increments
both fields, and it is reached from four places. Assert that a full simulated
engagement — kills, deaths, breaches, bounties — leaves `kills`,
`combatScore`, `credits`, `legalStatus` and the save blob bit-identical.

### How it is enforced — CORRECTED after planning

My first draft said `StepHost` "is exactly the list of verbs that reach outside
the sky" and that refusing them was the mechanism. **That is false, and it is
false for the most common kill in the game.** Verified:

- `combat.ts:149` — `Combat.fire()` calls `this.destroy(commander, shot.ship)`
  **internally**. A laser kill never passes through `StepHost.destroyNpc`.
- `game.ts:428` — the energy bomb calls `Game.destroyNpc` from `runCommand`,
  not from the step.

A host that refused `destroyNpc` and nothing else would credit the career for
almost every simulated kill. So the layering is:

1. **Primary: swap `state.commander` for an exercise-only clone.** `Combat`
   takes the commander *per call, deliberately* — its own comment says so,
   because a held reference "would quietly start crediting bounties to a
   commander who no longer exists". Passing a different commander is an intended
   capability, and it is the only thing that covers the internal call. It also
   covers what the step writes directly and never asks about: `survivors`,
   `cargo` on scooping, `fuel`, `missiles` via `Ordnance.launch`.
2. **Second layer: the alternative `StepHost`** — 1 pass-through
   (`wreckNpc`), 4 redirects (`inFlight`, `applyPlayerDamage`, `destroyNpc`,
   `fireLaser`), 7 refusals (`raiseLegal`, `die`, `dock`,
   `completeHyperspace`, `completeRescue`, `openHermitTrade`, `autoSave`).
3. **Third layer: the entry snapshot.** `persistence.capture()` on entry,
   `restore()` on exit — which also puts the rng stream back exactly, since
   restore does that last.

**`die()` must never be reached, and this one is data loss rather than a leak.**
`game.ts:815` calls `clearWorld()` — deliberately, so "death is not optional if
you refresh". A simulated death reaching it would delete the player's real saved
world blob. That is the bug class that already cost a real commander during this
refactor.

## Scenarios

Selectable, named, each a data entry rather than a code path:

| scenario | opposition |
| --- | --- |
| Lone bounty hunter | 1 hunter, drawn from the released bounty-hunter slot band |
| Single pirate | 1 pirate, tier selectable |
| Pirate pair | 2 pirates, same tier |
| Pirate gang | 3-4 organised pirates flying the pack policy |
| Police interdiction | 2 Vipers — what shooting a trader actually buys you |
| Thargoid ambush | 2-3 Thargoids plus Thargons, the witch-space fight |
| As they come | asks `pirateThreat()` (`game/threat.ts`) what the galaxy would send at your real mark right now, and sends that |

"As they come" matters most for balance: it is the only way to sample the fight
the live game would generate for a commander in your exact state, without flying
until one happens.

## Opponent selection and fit-out

Two levels, because the audiences differ:

- **Scenario picker** (a pilot): pick a scenario and a threat tier, launch.
- **Custom** (Chris, and the statistics): per opponent, choose the hull from the
  roster in `ship-specs.ts`, the count, the brain each flies (the picker's own
  list is `SIM_BRAINS` in `game/combat-sim-scenarios.ts`, derived from
  `game/brain-names.ts` and checked against the imports in `game/brains.ts` by
  `npm test`), and the fit — missiles, E.C.M.

Every brain row says where in its list it is (`5/12`), HOME and END go to either
end of a long list without walking there, and selecting a brain row prints what
that brain DOES in a fight — one line of behaviour with the measured number that
shows it, stated in `game/brain-names.ts` beside the name. The figures are the
flight probe and the evaluation tournament, archived under `train/logs/`; a name
the picker offers with no line to go with it fails `npm test`.

There is one row on the panel that is NOT about the exercise, and it is fenced
off at the foot of it, under a heading saying so: **LIVE BRAINS
(CAREER)** writes `state.brains`, so the policy you pick there is what the whole
galaxy flies once you leave the station, until you set it back to AS SHIPPED. It
is state, so it is in the save; it is a name, so the panel and the report agree
about it; and it is the reason live-play brain selection no longer needs a
developer console. Everything else on the panel dies with the exercise.

Your own ship: **fit-out override only, not hull.** Corrected after planning —
the player's hull is four hard-coded constants in `player.ts` (`MAX_SPEED`,
`ACCEL`, `MAX_PITCH`, `MAX_ROLL`) with no roster, and `FlightDemand.limits` can
cap speed and accel but not pitch or roll. Parameterising `PlayerShip` is a
feature of its own AND changes the world every pirate brain was fitted in, since
`scenario.ts` reads `PLAYER_FLIGHT` as its target. So v1 overrides lasers,
shields, E.C.M., missiles, energy unit and energy bomb — `state.cheat` made
legitimate and scoped — and the GAP-ANALYSIS entry says the hull is not
selectable.

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
- and, beside every hull NAME, the ids it resolves to — your `shipId` and each
  opponent's `designId`/`profileId` (`src/game/ship-identity.ts`), so a record
  still says what was flown after a shipyard or a re-hulling exists

- and how the OPPOSITION flew (TODO 34): their speed, the SPREAD of the ranges
  they held — p10, median, p90, because a brain that commits sweeps through the
  band and a turret collapses it onto one number the median alone cannot tell
  apart — and their completed attack runs, a closure inside `PASS_CLOSE` and a
  break back out past `PASS_FAR`. Those two thresholds live in
  `combat-sim-report.ts` beside `SIX_CONE`, with the same justification, and
  `train/flight-probe.ts` reads them from there rather than keeping its own.
  There is deliberately NO verdict, score or turret index attached: the report
  presents, the pilot judges, and inventing that metric is how this went wrong
  twice

Also absorb `test/arena.js`'s `envelope()` — the spec first omitted it and
should not have. It is the only measurement of the PLAYER's flight envelope
(speed, pitch, roll and engagement-range distributions), and
`scenario.ts`'s `playerCobra`/`playerCobraSlow` target hulls are fitted to it.
Delete `arena.js` without absorbing it and the trainer loses the one input that
makes its target move like a human.

Note `gang-trial.js` is only replaced for the human-flown question. It flies the
defence brain — a bot — and `npm run survivability` remains the bot answer.

**Version the JSON from day one** (`schema`, as `SNAPSHOT_VERSION` does). It
is an interface with an external consumer; the first shape change would
otherwise silently break whatever reads `__simLog`. It is at **2**: TODO 28
changed what the damage figures MEAN — a warhead is 250 pool points where it was
332, and a crossfire hit is the firing build's own gun rather than a flat 11 —
so records exported before it cannot be compared with records after it. See
docs/DAMAGE-PATHS.md.

**Export** as JSON — clipboard and downloadable file — plus an in-memory ring of
recent exercises on `window.__simLog`, so a console session or an agent can read
them without going through the DOM. The JSON is the deliverable: it is what gets
fed back into judging a training run.

**Two records, side by side** (TODO 35). The method above is an A/B — same seed,
same scenario, two brains — and doing it by memory across two screens was the
one part of it the tool did not help with. `←/→` walks the ring; ENTER holds the
record you are on against another one, as this / that / difference, and `C` /
`X` take the PAIR because the pair is the finding.

It is `combat-sim-compare.ts`, it is derived from two finished records, and it
adds no accumulation and no sampling. The load-bearing half is the REFUSAL: two
records on different seeds, scenarios, modes, waves, player fit-outs, opponent
counts, hulls, builds, tiers or roles — or from either side of a `schema`
change — are not an A/B, so it names exactly which fields differ, with both
values, and paints no difference column at all. Different BRAINS is the point;
different anything else is a confound. Matching brains are not refused but are
called what they are: a repeat of one fight, not a comparison of two. And there
is no verdict, no score and no colour by sign — the same refusal as the turret
index, for the same reason.

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
- Not a `window.__` handle. **But the exercise itself cannot be a screen** —
  corrected after planning. `Game.mode` is derived (`screens.topId ??
  baseMode`) and `updateFlight()` runs only when `mode === 'flight'`, so while
  any screen is on the stack **the world does not step**. The screen is the
  front of house — pick a scenario, launch, read the report — and the fight is
  ordinary `flight` with a different `StepHost` behind it.
- **Teardown must be deferred.** `applyPlayerDamage` is called from inside
  `stepNpcs`/`applyOrdnance`, so restoring the world there would rebuild the
  scene and teleport the player mid-frame while the step is still iterating.
  `finish()` records the outcome and flips a phase; `inFlight()` goes false so
  the frame unwinds; `updateFlight` restores after the step returns.
- **Turn off ambient traffic.** `stepEncounters` keeps spawning traders and
  pirate waves otherwise — `gang-trial.js` hit exactly this and reported "4 of
  3 alive". Push `state.encounterTimers` out on entry; they are already in
  `GameState` and come back with the snapshot, so no new state.

## Settled

1. **Free.** No credit cost — it should never be a reason not to practise.
2. **Every station.** No tech-level or government gate.
3. **`T` — COMBAT TRAINING** on the docked menu. Free there (docked uses
   B C D E G H I L M N Q S X Z). `T` also arms a missile in FLIGHT, which is
   fine and is the established convention: `C` is contracts docked and the
   docking computer in flight, `M` is the market docked and launch-missile in
   flight. The tables are per-mode.

   **The four-homes invariant applies** (CLAUDE.md's key-bindings rule — cite it by name, not number: the numbering has moved once already): a key lives in four places that must change
   together — `src/engine/keymap.ts`, the binding table in
   `src/game/controls.ts`, the `?` help panel in `play.html`, and the README
   table. An audit found 13 existing disagreements, including `B` for the
   distress beacon, which costs you cargo and is in no help panel. Add `T` to
   all four, and add its screen's own keys to the panel too.
4. **Three modes**, not one:
   - **Scenario** — a named fight, scored, ends by itself. The unit of export.
   - **Sparring** — one opponent, endless, respawning, until you quit. For
     learning a hull's behaviour rather than winning.
   - **Waves** — escalating, endless, until you die. Scored on waves survived,
     and the mode that answers "how many can I actually take?" — which is the
     question `npm run survivability` currently answers with a bot.

   All three export; waves and sparring emit a record per wave / per kill so a
   long session is still usable data rather than one summary line.

## Deliberate deviation

Not in the original; needs a `docs/GAP-ANALYSIS.md` entry saying so and why. The
original had no way to practise, and a game whose opponents are trained wants
one — so a player can learn the ships, and so the AI can be judged against a
human instead of only against other AI.
