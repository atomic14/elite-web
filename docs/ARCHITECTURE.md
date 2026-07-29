# Architecture — a tour for new readers

## The portability test

Chris's, and it is better than "is this module leaky?" because it has an
answer rather than an opinion: **if we wanted a desktop build with the same
core engine, could we do it?**

`npm run portability` answers it. Today:

```
ports unchanged     10066 lines   63%   the game itself
platform             4288 lines   27%   renderer, HUD, screens, input, audio,
                                        storage — you EXPECT to rewrite these
contaminated         1626 lines   10%   game/game.ts, and nothing else
```

The third number is the one to drive down; it was 17% across three files
before `sun.ts` stopped needing a canvas and `storage.ts` took the
localStorage. `game.ts` is the last file where engine and shell are braided
— the fixed-timestep loop and step order in the same class as the render
stack, the Input, the Hud and the DOM screens.

A test suite will not catch that number regressing. This will.

## The north star

**One world state. A pure step that advances it. A renderer that only reads it.**

Everything else is a consequence, and each consequence is testable:

| property | what it buys | where it stands |
| --- | --- | --- |
| the snapshot IS the state | save anywhere, replay, test fixtures | mostly — see the gaps below |
| `step()` is seeded and fixed-dt | the same inputs give the same run | done |
| the renderer never writes state | you can delete it and still simulate | done for the HUD; `step()` still touches the DOM in four places |
| the world builds without a browser | training against the real step | **done** — `World.build()` runs under node |
| ...and STEPS without one | the trainer can use the real engine | **done** — `world-step.ts`, stepped headless by `npm test` |
| one rule, one home | the bug class that ate this codebase | mostly |
| every rule is unit-testable headless | 390 tests, no browser | done |
| nothing knows about its caller | modules compose in any order | done |

The recurring failure this is defending against is **one rule with two homes,
kept in step by hope**. It produced NPCs firing 5.4x too fast in training, four
copies of the chart metric, the player's damage model living in a comment, a
market that rerolled on reload, a galaxy that quietly diverged from itself
because its save rounded to three decimal places, and the contraband set
written out FIVE times as the bare literals `[3, 6, 10]`.

**The rule for what a module may know (Chris's framing — single
responsibility, and things should not need to know about each other):** a
module may depend on data, on leaf utilities, and on the `World` if it
genuinely lives in the sky. It may **not** depend on the shape of its caller.

The tell is a callback that reaches back out — `message()`, `add()`,
`remove()` — or a hand-rolled `SomethingContext` interface. Both mean the
module cannot be used, or tested, without something Game-shaped standing
behind it.

**Six of them are still there, all in `src/game/screens/`** — `TradeContext`
(three callbacks out, including `leaveHermit()`, a screen telling the Game to
change flight state), `SavesContext`, `ContractsContext`, `ChartContext`,
`StatusContext`, `DataContext`. An earlier version of this document claimed
there were none; that claim came from a grep that did not recurse into
`screens/`. `collisions.ts` also takes a `setPlayerSpeed` callback. The pattern
that replaced the others, and that these should follow:

> **A module decides and reports. The caller applies the consequences.**

`stepTrumbles` returns events and `trumbleMessage` phrases them. `checkJump`
returns a refusal and the Game decides a refusal is a beep. `Ordnance.arm()`
returns `'noMissiles'`; it has never heard of a HUD. This is why 20 ordnance
tests exist that could not be written at all a week ago — there was no way to
construct one without a Game.

Only `main.ts` imports `game.ts`. That arrow points one way and should stay
that way; if a module starts wanting the Game, the answer is a return value.

**The rule for what belongs in state:** anything that drives behaviour and is
not a constant. A value worked out at runtime — even once, even at spawn — is
state. AI state is game state: a human's brain survives a reload on its own,
an NPC's does not.

### Known gaps against it

- `game.ts` is 1625 lines, down from 3244. It is the orchestrator, and what
  is left is mostly orchestration: the fixed-timestep loop, the command
  switch, the docked/flight mode machine, and the consequences the modules
  report. The
  rules have moved to the ~30 files around it — and the **world step itself**
  is now `world-step.ts`: the five phases of flight, with the fourteen
  `hud.showMessage` calls inside them turned into returned `StepEvent`s. It
  runs under node with no Hud, no Input and no renderer (`npm test` flies 600
  steps of it and asserts the run replays byte-identically), which is what the
  trainer needs. What it cannot own it asks for through `StepHost` — eleven
  verbs and one question, all of them consequences that reach outside the sky
  (a bounty, a legal status, a save, a screen, the end of the run).
- **The same shape three times over.** `persistence.ts` (capture, restore,
  autosave, resume) and `station.ts` (dock, launch, the menu between them) came
  out the same way: a module that decides and reports, one host object literal
  in `game.ts` naming the verbs it may ask for, and one small `apply*` switch.
  The save can now be taken and put back under node — `npm test` flies a world,
  captures it through JSON, restores into a fresh state and demands the
  restored world *continues* the run rather than merely resembling it, which is
  the property all four historical snapshot bugs broke.
- **The rule for what may be an event, and it is not style:** anything that
  DRAWS from the seeded rng must stay a direct call, made where it was made
  before. Deferring a draw moves it across a branch and silently changes every
  seeded outcome after it. That is why `StepHost` and `StationHost` are lists of
  verbs rather than richer return values — `populateSystem`, the Navy mission
  step and the market roll all draw. Messages draw nothing, so messages are
  events.
- `npc.ts` is 786 lines and holds behaviour and brain flight. The explosions,
  the ship roster and the brain selection have moved to `effects.ts`,
  `ship-specs.ts` and `brains.ts`.
- State is now `Game.state` (`state.ts`) — one object holding the galaxy, the
  commander, the world, the player, the session, the ship systems, the dock
  plan, the markets and the charts. `freshState(commander)` builds it under
  node with no canvas and no browser. Game keeps delegating accessors so
  `g.commander` still works at ~500 call sites. The station's quaternion is
  still snapshotted by hand.
- **Flight** now has an intent layer: `PlayerShip.update(dt, demand)` takes a
  `FlightDemand` (rates, throttle, trigger) and the pilots produce one —
  `engine/flight-controls.ts` from a keyboard, `combat-computer.ts` from the
  defence brain, a harness by writing four numbers down. `player.ts` no longer
  imports `Input`, and `game.ts` has one path: produce a demand, apply it.
- **...and so does the rest of the keyboard.** `controls.ts` is the same move
  for the discrete half: a binding TABLE over a two-method `CommandInput`,
  turning taps into `Command`s that `game.ts`'s `runCommand` applies in
  one-liners. "the player, an AI and a replay are not yet the same interface"
  was the gap this line used to record; they are now — `commandsFor()` plus
  `runCommand()` is the whole path, and `{ pressed, held }` is all a driver
  needs. It is in the purity block, and `npm test` asserts what keys do for
  the first time (the ⇧ modifiers, one command per frame, the confirmation
  swallowing everything). The docking computer is the remaining holdout on
  the flight side — it asks for a HEADING rather than a rate, and still steers
  on top.
- `Game`'s constructor calls `createRenderStack`, so a Game still needs a
  browser even though everything it simulates does not.


This document explains how the code fits together, the conventions that are
easy to trip over, and where to look when you want to change something.
Read the [README](../README.md) first for what the game *is*.

## The 30-second map

**This is an index, not an explanation.** One line per file: the question it
answers. If you need more than that, read the file — every one opens with a
header comment saying what it owns and what it deliberately does not. A file
that needs a paragraph here to make sense is a file with the wrong name, and
the fix belongs there rather than in this document.

```
play.html / index.html / viewer.html   the game, the landing page, the AI viewer
src/
  main.ts                   boot: new Game(canvas)
  player.ts                 the player's flight model — flies a FlightDemand,
                            and has never heard of a keyboard

  game/
    game.ts                 THE ORCHESTRATOR: the frame, input routing, the
                            mode machine, and every consequence modules report
    controls.ts             the key bindings as a table: an input in,
                            Commands out — a replay presses M the same way
    world-step.ts           one slice of the world, with nothing on screen:
                            the five phases of flight, reporting StepEvents
    station.ts              docking, launching, and the menu between them
    state.ts                GameState: everything the step may change, in one
                            object. freshState() builds it with no browser
    session.ts              SessionState: the flight flags and timers
    snapshot.ts             that state as plain JSON — save anywhere, replay
    persistence.ts          that JSON taken from a running world, and put back
    rng.ts                  THE seeded generator. Math.random is banned in
                            world code and npm test enforces it

    world.ts                the sky: the ships, the cargo, the effects, the scenery
    spawning.ts             putting a population plan into the sky
    population.ts           how busy a system is when you arrive
    encounters.ts           what turns up later: traders, pirate waves, drones
    npc.ts                  NPC ships: scripted behaviour + trained-brain flight
    npc-targeting.ts        who hunts whom among the NPCs
    ship-specs.ts           the roster: which hull flies which role, and its stats
    brains.ts               the five trained policies, and who flies which

    combat.ts               what happens when something is shot: bounties, kills,
                            wrecks, loot
    gunnery.ts              BOTH guns: the player's mounts, heat and aim assist,
                            and the NPC's hit rolls, damage and missile choice
    shot.ts                 what a shot passed through: ray first, then graze cone
    ordnance.ts             missiles in flight, the E.C.M., the energy bomb
    systems.ts              energy, shields, laser heat, cabin temp, damage model
    collisions.ts           who is overlapping whom, and how to separate them
    combat-computer.ts      the defence brain flying the PLAYER's ship
    autopilot.ts            is something else flying, and what does it want?

    law.ts                  contraband, fines, and how far your standing falls
    contracts.ts            work on offer, taking it, being paid for it,
                            market pressure, and pirate economics
    missions.ts             the Navy Constrictor arc (NOT the bulletin board)
    commander.ts            who you are: stats, cargo, rank — PURE, no browser
    shop.ts                 what things cost and what you may fit
    storage.ts              the ONLY file that touches localStorage
    cargo.ts                canisters and capsules adrift, and scooping them
    jettison.ts             dumping cargo, and whether it buys off the gang
    trumbles.ts             they breed, they eat the hold, heat drives them out

    hyperspace.ts           the jump: cost, refusal, mis-jump
    docking.ts              the slot approach, for traders and your computer
    effects.ts              explosions and tracers — seen, never simulated
    screens/                one file per overlay, behind the Screen contract

  galaxy/galaxy.ts          the 1984 procedural universe + market model
  galaxy/navigation.ts      chart distances and jump costs — the 1984 metric
  galaxy/living.ts          256 systems trading while you are elsewhere
  galaxy/goatsoup.ts        the original's planet-description grammar

  audio.ts                  every sound, behind one guarded AudioContext
  manual.ts                 the in-game manual's text and key tables

  hud/hud.ts                the cockpit console: a dumb painter
  hud/hud-model.ts          where a blip or marker GOES (the maths)
  hud/hud-binding.ts        reading the world onto the dashboard (the wiring)
  hud/tunnel.ts             the hyperspace tunnel
  ui/screens.ts             full-page DOM screens: market, charts, equip, status
  ui/screen-host.ts         the screen stack, and click-to-keystroke routing

  engine/render-stack.ts    the ONLY file that needs a GPU
  engine/input.ts           keyboard state (held/pressed/counts)
  engine/flight-controls.ts what the hands are asking for: keys -> FlightDemand
  engine/keymap.ts          flight bindings, both layouts
  ships/geometry.ts         every hull as vertex/edge/face tables
  world/                    per-system scenery: shader sun and planet, station

  ai-training/              render-free combat simulator + neural policies
    core.ts                 own vec/quat maths, ship physics, both weapon models
    policy.ts               tiny MLP: observation -> discrete controls
    scenario.ts             Episode: pirates vs trader, shared by trainer & viewer
    brains/*.json           trained weights, committed
  viewer/main.ts            three.js viewer for sim episodes

test/run.ts                 invariant + unit tests (npm test)
test/campaign.ts            headless balance playtest (npm run campaign)
test/playtest.js            autonomous in-browser play agent (console)
train/evolve.ts             neuroevolution trainer
train/evaluate.ts           held-out tournament — the validation gate
docs/                       you are here
```

## The five ideas that explain most of the code

### 1. The 1984 galaxy is generated, never stored

`src/galaxy/galaxy.ts` reimplements the original Elite algorithm: three
16-bit seed words advanced by a Fibonacci-style "twist" generate all 256
systems per galaxy — names (digraph table), economy, government, tech level,
population, and market prices. Galaxy 1 is byte-identical to the 1984
original (system 7 is Lave; run the game and check the Short Range Chart
against any Elite fan site). **Never edit generated values; everything
downstream derives from the seeds.** Per-system visuals (planet colour,
coastlines, sun bearing, station orbit) also derive from the seed, in
`world/system-scene.ts` and the planet shader.

### 2. Ships are 1984-style data tables with a Z-flip

`ships/geometry.ts` defines each hull as explicit `vertices`, `edges`, and
`faces` — the same style as the original BBC data, and **the same
convention: +Z is the nose** in the tables. three.js flies down **−Z**, so
`buildShip()` negates Z when building geometry. Hulls are symmetric, so this
mirror is invisible. Each ship is two overlapping objects: `LineSegments`
for the glowing edges, plus a matte-black `Mesh` of the faces with
`polygonOffset` pushing it just behind the lines — that's the classic
"hidden line" look, and it's why the renderer must **not** use a
logarithmic depth buffer (log-depth writes gl_FragDepth, which disables
polygon offset).

One scale rule: 1 unit ≈ 1 original Elite unit. The station is 320 across;
planets are ~4,500-6,500 radius; the sun sits ~320,000 out.

### 3. One orchestrator, many dumb parts — and one rule, one home

`game/game.ts` owns the entities and the frame. It does **not** own the rules.

The pattern everywhere is: **a module decides, the orchestrator applies.** An
NPC never damages anything itself — `NpcShip.update` returns a `FireEvent` and
the Game rolls the dice, draws the tracer, applies damage and handles the legal
consequences. `collisions.ts` separates overlapping ships and *reports the
pairs*; the Game bills them, because the price is not symmetric (your shields
absorb a ram, and two NPCs colliding must not credit you with a kill).
`encounters.ts` says a pirate wave is due; the Game spawns it. A `Screen`
returns `'back'`; the host pops the stack.

That split is what makes the rules testable without a browser, and it is the
answer to the recurring bug in this codebase: **one rule with two homes, kept
in step by hope.** That single failure mode produced NPCs firing 5.4x faster in
training than in the game (undetected for six training rounds), four separate
implementations of the chart distance metric, and the player's damage model
living in a *comment* in `train/survivability.ts` — the harness every balance
figure in this project is quoted from. Prefer deleting a duplicate to writing a
test that two copies still agree.

Screens (`ui/screens.ts`) are pure render functions over DOM, routed by
`ui/screen-host.ts`; the HUD (`hud/hud.ts`) is a dumb painter fed one state
object per frame, computed by `hud/hud-model.ts`.

**Still mixed up in game.ts**, and worth knowing before you go looking: laser
fire, spawning, and the hyperspace *transition*. The flight loop has moved to
`world-step.ts`, the save to `persistence.ts` and the docking/launch transitions
to `station.ts`, and all three run headless; what is left blocking a fully
browser-free `Game` is its constructor, which builds a renderer and DOM
listeners. The command keys are no longer part of that: `controls.ts` reads an
input interface, not a browser.

Two intentional oddities inside it:

- **Witch-space** reuses the normal system scene and simply teleports the
  planet, station and sun to ±1e8 — out of reach of every distance check —
  rather than introducing a nullable world type. Cheap, and every subsystem
  keeps working.
- **Docking** is evaluated in the station's local frame: the slot is a box
  on the local −Z face (`stationDockZ` differs between Coriolis and Dodo),
  plus a roll-alignment test against the slot's long axis.

### 4. NPCs: scripted behaviours with trained brains grafted on

`game/npc.ts` has a behaviour matrix (traders arrive/trade/depart, pirates
hunt in packs, police enforce, hunters stalk offenders, Thargons swarm).
Two roles fly with **trained neural policies** instead of the scripted
steering: pirates attacking the player (`pirate-attack-r2` brain) and armed
traders defending themselves (`jameson-defend` brain). `brainFly()` runs the
MLP at 10 Hz and integrates its discrete keyboard-style controls exactly
like the sim does. Set `window.__scriptedPirates = true` in the console to
A/B the old scripted AI.

### 5. The sim is the game's physics, twice

`src/ai-training/` is a **render-free copy of the combat-relevant physics** (ship
classes, turn rates, the pulse-laser model) with its own tiny vec/quat
math — no three.js — so Node can run millions of ship-steps per minute for
training, and the browser viewer can replay identical episodes. **The
contract: if you change combat numbers in game/npc.ts or game.ts, mirror
them in ai-training/core.ts** (and ideally retrain). The policies' observation is
ship-frame relative (`policy.ts` docstring) which is what makes them
position/orientation invariant.

### 6. Pirates are businesses, not a difficulty slider

`pirateThreat()` in `game/contracts.ts` decides your reception from a **mark**
— what a pirate can observe (cargo value, contraband, hold size, fitted laser,
kills, regional notoriety). It returns a count, a *tier* and whether they're *organised* (which flies the
coordinated pack brain). The tier describes the *group*, not every ship in it:
`memberTier()` gives the first one or two members the full tier and drops the
rest a rung, so a gang is ringleaders plus hangers-on. npc.ts owns the hulls
(`pirateSpecForTier`), contracts.ts owns the rule — so the campaign simulator
resolves each attacker at the strength the game actually spawns. Two rules keep it from rubber-banding: only visible
things count — never credits in the bank — and threat grows sub-linearly with
the prize, so the player outgrows the galaxy slowly rather than never.

Reputation is deliberately two-sided. It lowers `appeal` (thieves want easy
cargo, not a fight) but rolls a separate *challenge*: at Dangerous, ~35% of
receptions are an organised group who came for the name. Folding fame straight
into the tier instead made 99% of late-game receptions gangs, which erased the
ladder — it has to roll, not accumulate.

Because it lives in contracts.ts, `npm run campaign` scores the same function
the game uses; it reports the tier mix and whether threat actually tracks
wealth. The escape valve is `jettisonCargo()`: pirates came for cargo, so
dumping enough of it satisfies them (`NpcShip.satisfied`, which
`isHostileToPlayer` respects).

### 7. The galaxy keeps trading while you're elsewhere

`galaxy/living.ts` is a **level-1 simulation**: convoys between systems are
*records*, not objects, advanced in whole days whenever the player's clock
moves (a jump costs days). Convoys depart in proportion to productivity,
are lost to piracy in proportion to lawlessness, and on arrival nudge the
destination's prices. Systems accumulate `danger`, which raises pirate
spawns when you're there — so hotspots emerge along genuinely dangerous
routes rather than being scripted.

The 1984 seeded galaxy remains the **baseline**: this layer stores only
deltas (±25% price pressure, danger, convoys in flight), lives in the
commander's save as `galaxyState`, and decays back toward baseline when
trade stops. Level 2 is the existing NPC spawning: `populateSystem` asks
the living galaxy what's arriving and materialises those convoys as real
ships.

## Conventions & gotchas checklist

- **Money** is integer *tenths of a credit* everywhere (`1000` = 100.0 Cr).
  `formatCredits()` renders it. **Fuel** is tenths of a light-year (max 70).
- **Forward is −Z**; pitch rotates about local X, roll about local Z; "nose
  up" = rotate +X. The player and every ship use rate-ramped "keyboard
  analogue" steering (see `player.ts`).
- **Distances on the chart**: `4·sqrt(dx² + (dy/2)²)` in tenths of a LY —
  the original's asymmetric formula; chart Y is drawn half-scale.
- **Saves**: TWO JSON blobs in localStorage, and confusing them is a real bug
  class. `elite-web-commander:<slot>` is who you are — written on every
  successful dock and on equipment purchase. `elite-web-world:<slot>` is the
  whole sky — a `WorldSnapshot` written by `autoSave()` every 20 seconds of
  flight and replayed by `resumeSavedWorld()` at boot, which is what lets you
  close the tab mid-fight. Docking and dying clear the world blob. Delete both
  for a fresh commander.
- **Debug handles** (deliberate, documented): `window.__game` (the Game
  instance — used by the autopilot test harness, see
  docs/JAMESON-TRIALS.md), `window.__policyKit` (trained brains + inference
  fns), `window.__scriptedPirates` (disable brains), `window.__cheat`
  (buy any equipment free, any tech level), `window.__packBrain`
  (switch pirates to the 18-input pack brain — off by default, and see
  docs/TRAINING-LOG.md for why).
- **Determinism**: the galaxy and sim are seeded (mulberry32); gameplay
  spawns/market fluctuations intentionally use `Math.random()`. Training
  episode *seeds* are deterministic per generation; mutation noise is drawn
  from a seeded RNG, so a full training rerun follows the same trajectory on
  the same CLI args.
- The **help panel** (`?` in-game) is hand-maintained in index.html — update
  it when you touch key bindings, along with the README table.

## Where to start reading, in order

1. `galaxy/galaxy.ts` — self-contained, delightful, 250 lines.
2. `ships/geometry.ts` — the data-as-art bit.
3. `player.ts` then `game/npc.ts` — flight, then behaviours.
4. `game/game.ts` — top to bottom once, with the mode machine in mind.
5. `ai-training/core.ts` → `ai-training/policy.ts` → `train/evolve.ts` — the AI stack
   (then docs/AI-TRAINING.md and docs/TRAINING-LOG.md for the results).
