# Architecture — a tour for new readers

This document explains how the code fits together, the conventions that are
easy to trip over, and where to look when you want to change something.
Read the [README](../README.md) first for what the game *is*.

## The 30-second map

```
index.html / viewer.html      two Vite pages: the game, and the AI combat viewer
src/
  main.ts                     boot: new Game(canvas)
  game/
    game.ts                   THE ORCHESTRATOR: modes, input routing, combat
                              resolution, docking, hyperspace, missions, HUD feed
    npc.ts                    NPC ships: scripted behaviours + trained-brain flight,
                              explosions, tracers
    commander.ts              persistent player state, equipment catalogue, saves
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

### 3. One orchestrator, many dumb parts

`game/game.ts` is deliberately the only "smart" file. It owns the mode
machine (`docked | flight | market | chart | local | equip | status | dead`),
routes input per mode, steps the world, and resolves everything the NPCs
*ask* to do (an NPC never damages anything itself — `NpcShip.update` returns
a `FireEvent` and the Game rolls the dice, draws the tracer, applies damage,
handles bounties/legal consequences). Screens (`ui/screens.ts`) are pure
render functions over DOM; the HUD (`hud/hud.ts`) is a dumb painter fed one
state object per frame. If you're looking for "where does X actually
happen", the answer is almost always game.ts.

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
  fns), `window.__scriptedPirates` (disable brains), `window.__packBrain`
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
