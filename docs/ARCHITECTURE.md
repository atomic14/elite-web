# Architecture — a tour for new readers

## The north star

**One world state. A pure step that advances it. A renderer that only reads it.**

Everything else is a consequence, and each consequence is testable:

| property | what it buys | where it stands |
| --- | --- | --- |
| the snapshot IS the state | save anywhere, replay, test fixtures | mostly — see the gaps below |
| `step()` is seeded and fixed-dt | the same inputs give the same run | done |
| the renderer never writes state | you can delete it and still simulate | partly |
| one rule, one home | the bug class that ate this codebase | mostly |
| every rule is unit-testable headless | 198 tests, no browser | done |

The recurring failure this is defending against is **one rule with two homes,
kept in step by hope**. It produced NPCs firing 5.4x too fast in training, four
copies of the chart metric, the player's damage model living in a comment, a
market that rerolled on reload, and a galaxy that quietly diverged from itself
because its save rounded to three decimal places.

**The rule for what belongs in state:** anything that drives behaviour and is
not a constant. A value worked out at runtime — even once, even at spawn — is
state. AI state is game state: a human's brain survives a reload on its own,
an NPC's does not.

### Known gaps against it

- `game.ts` is 2788 lines with 39 imports. It is the orchestrator, but it
  still implements docking, hyperspace, missions and missiles.
- `npc.ts` is 1223 lines and holds behaviour, brain flight, explosions and
  tracers — the next `game.ts`.
- State is in `NpcState` and `Game.session`, but ALSO in `PlayerShip`,
  `Game.sys`, `chart`, `market`, the entity arrays, and the station's
  quaternion. The snapshot gathers them by hand.
- `step()` reads the keyboard directly. There is no intent/command layer, so
  the player, an AI and a replay are not yet the same interface.
- `Game`'s constructor calls `createRenderStack`, so a Game still needs a
  browser even though everything it simulates does not.


This document explains how the code fits together, the conventions that are
easy to trip over, and where to look when you want to change something.
Read the [README](../README.md) first for what the game *is*.

## The 30-second map

```
index.html / viewer.html      two Vite pages: the game, and the AI combat viewer
src/
  main.ts                     boot: new Game(canvas)
  game/
    game.ts                   THE ORCHESTRATOR: owns the entities and the frame,
                              wires the parts below together, resolves consequences
    npc.ts                    NPC ships: scripted behaviours + trained-brain flight,
                              explosions, tracers
    commander.ts              persistent player state, equipment catalogue, saves
    contracts.ts              work on offer + market pressure (no game.ts import,
                              so the headless campaign runs the real rules)
    docking.ts                the slot approach, shared by traders and the
                              player's docking computer
    -- the world step, pure and unit-tested: --
    systems.ts                energy, shields, laser heat, cabin temperature,
                              and the damage model (imported by survivability.ts)
    collisions.ts             who is overlapping whom, and how to separate them
    gunnery.ts                which mount fires, heat/cooldown, the aim assist
    shot.ts                   what the shot hit: ray first, then the graze cone
    encounters.ts             what turns up and when: traders, pirate waves, drones
    population.ts             how busy a system is when you arrive
    npc-targeting.ts          who hunts whom among the NPCs
    combat-computer.ts        the defence brain flying the player's ship
    -- state and its persistence: --
    rng.ts                    THE seeded generator; Math.random is banned and
                              the ban is enforced by npm test
    snapshot.ts               the world as plain JSON — save anywhere, replay
    screens/                  one file per overlay, behind the Screen contract
  engine/render-stack.ts      the ONLY file that needs a GPU
  galaxy/galaxy.ts            the 1984 procedural universe + market model
  galaxy/goatsoup.ts          the original's recursive planet-description grammar
  galaxy/living.ts            level-1 sim: convoys, prices, danger and your
                              notoriety across all 256 systems
  world/                      per-system scenery: shader sun/planet, stations,
                              starfield, space dust
  ships/geometry.ts           every hull as vertex/edge/face tables; wireframe builder
  player.ts                   the player's flight model
  engine/input.ts             keyboard state (held/pressed/counts)
  hud/                        cockpit console (scanner, gauges) + tunnel effect
  ui/screens.ts               full-page DOM screens (market, charts, equip, status)
  sim/                        render-free combat simulator + neural policies
    core.ts                   own vec/quat math, ship physics, laser model
    policy.ts                 tiny MLP: observation -> discrete controls
    scenario.ts               Episode: pirates vs trader, shared by trainer & viewer
    brains/*.json             trained weights, committed
  viewer/main.ts              three.js viewer for sim episodes
test/
  run.ts                      invariant + sim unit tests (npm test)
  campaign.ts                 headless balance playtest (npm run campaign)
  playtest.js                 autonomous in-browser play agent (console)
train/
  evolve.ts                   neuroevolution trainer (Node, no deps)
  evaluate.ts                 held-out tournament — the validation gate
  logs/                       committed fitness curves for the documented runs
docs/                         you are here
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

**Still mixed up in game.ts**, and worth knowing before you go looking: the
flight loop, laser fire, spawning, docking, hyperspace and missions. The
direction of travel is that the world step becomes runnable without a
renderer — three.js maths works fine under node, so what blocks it is only
that `Game`'s constructor builds a renderer and DOM listeners.

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

`src/sim/` is a **render-free copy of the combat-relevant physics** (ship
classes, turn rates, the pulse-laser model) with its own tiny vec/quat
math — no three.js — so Node can run millions of ship-steps per minute for
training, and the browser viewer can replay identical episodes. **The
contract: if you change combat numbers in game/npc.ts or game.ts, mirror
them in sim/core.ts** (and ideally retrain). The policies' observation is
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
- **Saves**: one JSON blob in localStorage (`elite-web-commander`), written
  on every successful dock and on equipment purchase. Delete it for a fresh
  commander.
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
5. `sim/core.ts` → `sim/policy.ts` → `train/evolve.ts` — the AI stack
   (then docs/AI-TRAINING.md and docs/TRAINING-LOG.md for the results).
