# Architecture — a tour for new readers

## The portability test

Chris's, and it is better than "is this module leaky?" because it has an
answer rather than an opinion: **if we wanted a desktop build with the same
core engine, could we do it?**

`npm run portability` answers it. Run it — these are the shape, not a
guarantee, and they move with every file added (2026-08-02):

```
ports unchanged     19017 lines   72%   the reusable rules and simulation
platform             7327 lines   28%   composition root, renderer, HUD,
                                        screens, input, audio and storage
contaminated            0 lines    0%   no core runtime path reaches platform
```

The portable share GREW through the Elite-A phase rather than shrinking: the
generated catalogue, the combat oracle, the identities and the roster are all
pure data and pure rules, so they land on the left-hand side.

The third number is the one to drive down. The gate now follows relative
runtime imports transitively (while ignoring erased type-only edges), so the
old `0` is no longer false assurance from checking each file in isolation.
Every contaminated line includes the dependency chain that reaches a platform
module and makes `npm run portability` fail. Its first honest run found 16
files. Console publication, persistence, hostility, flight bindings and the
canvas corona now point outward through explicit seams instead. `game.ts` is
declared as the platform composition root: no reusable module imports it (the
gate asserts that only `main.ts` does), and it constructs the Input, HUD and
screens that apply the core modules' reported outcomes.

A test suite will not catch that number regressing. This will.

## The north star

**One world state. A pure step that advances it. A renderer that only reads it.**

Everything else is a consequence, and each consequence is testable:

| property | what it buys | where it stands |
| --- | --- | --- |
| the snapshot IS the state | save anywhere, replay, test fixtures | mostly — see the gaps below |
| `step()` is seeded and fixed-dt | the same inputs give the same run | done |
| the renderer never writes state | you can delete it and still simulate | **done** — the step reports presentation effects to the platform composition root |
| the world builds without a browser | training against the real step | **done** — `World.build()` runs under node |
| ...and STEPS without one | the trainer can use the real engine | **done** — `world-step.ts`, stepped headless by `npm test` |
| one rule, one home | the bug class that ate this codebase | mostly |
| every rule is unit-testable headless | 1,767 assertions, no browser | done |
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

- `game.ts` is 1722 lines, down from 3244. It is the orchestrator, and what
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
  (a bounty, a legal status, a save, a screen, the end of the run). One of them
  carries a fact only the step has: `applyPlayerDamage` names its
  `DamageSource`, because what hurt you is known statically at each of the five
  places it bills you and can only be guessed at afterwards from the size of
  the number.
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
- `npc.ts` is 1051 lines and holds behaviour and brain flight. The explosions,
  the ship roster and the brain selection have moved to `effects.ts`,
  `ship-specs.ts` and `brains.ts`.
- State is now `Game.state` (`state.ts`) — one object holding the galaxy, the
  commander, the world, the player, the session, the ship systems, the dock
  plan, the markets and the charts. `freshState(commander)` builds it under
  node with no canvas and no browser. Game code uses that canonical object
  directly. The console-only `legacyHandles()` view keeps getter conveniences
  such as `g.commander` for old untyped harnesses without adding a second
  writable path to the Game class. The station's quaternion is still
  snapshotted by hand.
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
play.html                 the game — and the ? help panel, hand-maintained
index.html                the landing page: no game bundle
viewer.html               the AI combat viewer
manual.html / novella.html   the long-form text pages
src/
  main.ts                   boot: new Game((scene) => browserShell(canvas, scene))
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
    console.ts              the ONLY file allowed to touch globalThis: it
                            publishes __game, __policyKit and __simLog and
                            reads nothing back
    game-handles.ts         the read-only console view those handles expose
    views.ts                the four cockpit windows, and which way each faces
    chart-state.ts          where the chart cursor is, and what is targeted —
                            saved state, so it is a field of GameState
    sounds.ts               what a rule module asks to be HEARD, without
                            knowing how a sound is made
    instrumentation.ts      optional outside-in observation of a live game

    world.ts                the sky: the ships, the cargo, the effects, the scenery
    spawning.ts             putting a population plan into the sky, and
                            authored opposition into an arena
    population.ts           how busy a system is when you arrive
    encounters.ts           what turns up later: traders, pirate waves, drones
    npc.ts                  NPC ships: scripted behaviour + trained-brain flight
    npc-targeting.ts        who hunts whom among the NPCs
    ship-specs.ts           the roster: which hull flies which role, and its
                            stats — all of them Harmless's, none copied from
                            the pack
    ship-roles.ts           what a ship is FOR, and which released designs the
                            blueprint slots allow to be it
    role-variants.ts        which released BUILD of that design the job flies —
                            a combat role takes the hardest variant the source
                            itself filed under that job, everything else the
                            pack's recommended default
    ship-identity.ts        the three ids — player hull, design, exact variant —
                            what they resolve to, what a save without one
                            becomes, and the two Harmless-only overlays
    npc-energy.ts           an NPC's bank: the exact released max, immunity, the
                            Constrictor's halving, regeneration, and what one
                            ship's gun is worth against another's bank
    damage-units.ts         the two branded damage units, and the only way to
                            make one — see docs/DAMAGE-PATHS.md
    impact-damage.ts        the ONE Harmless rule for everything that is not a
                            laser: a ram, a canister, the Coriolis wall, a
                            warhead, the energy bomb
    brains.ts               the nine trained policies, loaded — and the two
                            flight numbers that come with each
    brain-names.ts          WHICH policy flies, by name, given a
                            BrainSelection — the rule the ship, the
                            trainer's report and both pickers all read,
                            plus the one-line CHARACTER of each

    combat.ts               what happens when something is shot: bounties, kills,
                            wrecks, loot — plus the player's own trigger and
                            hull taken over a GameState (firePlayerLaser,
                            damagePlayer), and DamageSource, the five things
                            that can hurt the commander
    gunnery.ts              BOTH guns: the player's mounts, their cadence and
                            heat, the exact hit each hull's fitted laser
                            scores, aim assist — and the NPC's trigger, hit
                            rolls, missile choice, and what its exact released
                            build's laser costs the commander's hull
    shot.ts                 what a shot passed through: ray first, then graze cone
    ordnance.ts             missiles in flight, the E.C.M., the energy bomb
    systems.ts              the commander's three 255-point banks, what a hit
                            costs them, how they recharge (Harmless policy on
                            the oracle's tick clock), laser heat, cabin temp,
                            and the save migration
    collisions.ts           who is overlapping whom, and how to separate them
    combat-computer.ts      the defence brain flying the PLAYER's ship
    autopilot.ts            is something else flying, and what does it want?

    combat-sim.ts           the training exercise: a real fight that costs
                            nothing — the commander swap, the entry snapshot,
                            its own StepHost
    combat-sim-scenarios.ts who it sends at you, and when it stops sending
    combat-sim-opening.ts   where an exercise is fought and where the two sides
                            start it: the arena centre, the per-scenario arc,
                            range and cone, and the geometry the record quotes
    combat-sim-report.ts    what happened, counted — how you flew, how THEY
                            flew, and the JSON that exports
    combat-sim-strip.ts     how it is going, WHILE it is going: the cockpit
                            strip's model, read off the round's own recorder
    combat-sim-compare.ts   two records held against each other — and what may
                            NOT be differenced: a confound is named, not shown
                            as a result
    combat-sim-safety.ts    the three layers of "nothing that happens in the
                            simulator leaves it"

    law.ts                  contraband, fines, and how far your standing falls
    contracts.ts            work on offer, taking it, being paid for it,
                            market pressure and hermit prices
    threat.ts               who is worth robbing: what a pirate can SEE, the
                            tier it brings, and whether it organised
    missions.ts             the Navy Constrictor arc (NOT the bulletin board)
    commander.ts            who you are: stats, cargo, rank — PURE, no browser
    shop.ts                 what things cost and what you may fit
    storage.ts              the ONLY file that touches localStorage
    cargo.ts                canisters and capsules adrift, scooping them, and
                            what a laser hit does to one (their released banks)
    jettison.ts             dumping cargo, and whether it buys off the gang
    trumbles.ts             they breed, they eat the hold, heat drives them out

    hyperspace.ts           the jump: cost, refusal, mis-jump
    docking.ts              the slot approach, for traders and your computer
    effects.ts              explosions and tracers — seen, never simulated
    screens/                one file per overlay, behind the Screen contract
      trade.ts              the market and the outfitters: buy, sell, fit
      chart.ts              the galactic chart and the short-range chart
      contracts.ts          work on offer here: pick one and sign for it
      status.ts             what you are flying, carrying and wanted for
      data.ts               the 1984 manual entry, plus today's local news
      saves.ts              commander files, and the saves/naming screens
      briefing.ts           a mission, several pages, read with left and right
      combat-sim.ts         the trainer's front of house: pick a fight, read the
                            report, hold two records against each other
      combat-sim-setup.ts   what the pilot picked, and the rows that show it
      combat-sim-notes.ts   what the panel says under the rows, and the tallest
                            it can ever say it — the reserve that stops a note
                            appearing from shifting the row under the cursor

    elite-a/                the released-Elite-A reference catalogue, and the
                            rules that read it. Everything ending .generated.ts
                            comes from reference/elite-a/source via the importer
                            and is never edited by hand
      types.ts              the catalogue's shape — hand-written
      catalogue.ts          the way in: lookups by id, merged combat profiles,
                            and recommendedNpcProfile(designId)
      combat-math.ts        the combat oracle: laser decoding, defence, armour,
                            hits-to-destroy, destruction and regeneration. Pure,
                            imports nothing, and reproduces all 20,070 rows the
                            pack supplies (test/elite-a-oracle.test.ts)
      designs.generated.ts  the 38 designs and the header they all share
      variants.generated.ts the 260 exact S.A-S.W builds — what differs
      geometry.generated.ts one hull per design, deduplicated
      slots.generated.ts    the 713 blueprint-slot assignments + NEWB bytes
      player-hulls.generated.ts   the 15 flyable hulls
      provenance.generated.ts     the pack's hash, counts and NEWB bit layout

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

  engine/shell.ts           THE PLATFORM SEAM: everything the game needs from
                            the machine it runs on, in seven members
  engine/browser-shell.ts   that seam, against a browser — every DOM and
                            window API the game uses is in this one file
  engine/inert-dom.ts       a DOM element that accepts every write and does
                            none of them, so a painter with no DOM is inert
  engine/render-stack.ts    the ONLY file that needs a GPU
  engine/input.ts           keyboard state (held/pressed/counts), and the
                            bounded carry that keeps a busy frame's second tap
  engine/flight-controls.ts what the hands are asking for: keys -> FlightDemand
  engine/keymap.ts          flight bindings, both layouts
  ships/geometry.ts         the ShipDef contract and the two mesh builders
  ships/elite-a-hulls.ts    the 38 released hulls, at the one world scale
  ships/elite-a-faces.ts    closed polygons, rebuilt from source face adjacency
  ships/harmless-hulls.ts   the shapes that are OURS: the generation ship
  ships/station-hulls.ts    the two released stations, at the one scale that is
                            not sourceGeometryToWorld — and why
  ships/registry.ts         design id -> hull, name and target radius; the only
                            way in
  world/system-scene.ts     per-system scenery, assembled from the seed
  world/sun.ts              the shader star; world/planet.ts the shader planet
  world/corona-texture.ts   the sun's optional corona, the one canvas here
  world/starfield.ts        distant stars, far enough out to have no parallax
  world/slot.ts             which way the station's docking slot faces

  ai-training/              neural policies + the scenarios they train in
    policy.ts               tiny MLP: observation -> discrete controls
    scenario.ts             Episode: pirates vs trader, on the REAL engine —
                            shared by trainer, tournament and viewer
    brains/*.json           trained weights, committed
  viewer/main.ts            three.js viewer for episodes
  viewer/gallery.ts         all 38 released designs, labelled, with radii

test/harness.ts             check(), the counters and the shared fixtures
test/*.test.ts              invariant + unit tests, one file per subsystem
test/ship-roles.test.ts     the roster's gate: role bands, the whole catalogue,
                            the tiers, and hulls surviving a reload
test/role-variants.test.ts  the selection policy's gate — every build is a real
                            released row, the choice is deterministic and draws
                            no rng, and no combat role flies a gun that cannot
                            hurt a Cobra Mk III
test/systems.test.ts        the commander's banks, the damage model and the
                            recharge — the numbers every balance claim rests on
test/elite-a-live-defence.test.ts
                            the LIVE incoming path over all 3,900 NPC-to-player
                            rows, and the diagnostic that stays test-only
test/run.ts                 the index: imports them all, one total (npm test)
test/elite-a.ts             the SECOND index: the Elite-A alignment gate
                            (npm run elite-a) — the same files, named as one
                            claim, with no assertion of its own
test/harness.ts             check/eq and the counters
test/fixtures.ts            data two or more test files share
test/combat-sim.test.ts     the training simulator's screen, keys and draft
test/campaign.ts            headless balance playtest (npm run campaign)
test/playtest.js            autonomous in-browser play agent (console)
test/fixtures/elite-a/      the 15,600 / 3,900 / 570 combat-oracle rows —
                            generated, and never imported by src/
train/evolve.ts             neuroevolution trainer
train/evaluate.ts           held-out tournament — the validation gate
train/flight-probe.ts       is it flying, or is it a turret? the SHAPE of a
                            brain's fight, not its score — measured by the
                            game's own CombatSimRecorder, so the tool and the
                            in-game report cannot disagree about what a pass is
train/jameson-autopilot.js  the browser-console economy harness behind
                            docs/JAMESON-TRIALS.md
train/profile-sweep.ts      the catalogue rather than the policies: all 15
                            flyable hulls as the target, all 38 designs'
                            recommended profiles, non-combat objects excluded
                            from the aggregates
train/survivability.ts      how a fight against a real gang ends, in the
                            commander's own pool points
tools/import-elite-a.mjs    npm run generate:elite-a — reads the vendored pack,
                            verifies its hashes, writes the catalogue; --check
                            is the CI drift gate
tools/elite-a/              build (what the game learns), fixtures (what the
                            tests read), emit (what it looks like on disk)
tools/portability.mjs       npm run portability — how much of src would move
tools/sizes.mjs             npm run sizes — the 400-line ceiling and its
                            allowlist, each entry with a stated reason
tools/coverage.mjs          npm run coverage — what the tests never touch
reference/elite-a/          the vendored pack, verbatim, plus its manifest
docs/                       you are here
docs/ELITE-A.md             the reference catalogue: its provenance hash, the
                            three ids, the geometry chain, the save schema,
                            what is EXACT vs recreated vs ours, what is
                            deferred, and what a future shipyard must do
docs/DAMAGE-PATHS.md        EVERY way anything can be hurt: source, target,
                            unit, owner, and whether the number is the released
                            game's or ours. Held to the code by
                            test/damage-paths.test.ts — start there before
                            touching a damage number.
docs/COMBAT-SIM.md          the docked combat trainer's spec, and the one rule
                            it exists to keep: nothing that happens in it leaves
docs/BROWSER-TRIALS.md      the measurements a bot cannot take — what to fly,
                            and what to send back
docs/GAP-ANALYSIS.md        feature parity with 1984, and every deliberate
                            deviation from it
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

### 2. Ships are 1984-style data tables, turned to face −Z

A hull is explicit `vertices`, `edges` and `faces`, the same style as the
original BBC data and **the same convention: +Z is the nose**. three.js flies
down **−Z**, so `buildShip()` turns the def by a **half turn about Y** —
negating x and z. That used to be a Z mirror alone, which is identical for a
left/right symmetric hull and a mirror image for anything else; eight of the
38 released designs are asymmetric, so it is a rotation now.

The hulls themselves are **generated, not written**. `ships/elite-a-hulls.ts`
converts the released tables in `game/elite-a/geometry.generated.ts`, and
`sourceGeometryToWorld()` is the one conversion: **one world unit is four
source units**, anchored so the Cobra Mk III keeps the size it always had.
The same conversion produces the **target radius** every ray test and
collision uses, so hit registration matches the released ships rather than a
hand-tuned guess. `ships/registry.ts` is how anything asks for either.

The source stores no polygons — a face is a normal, and an edge says which
two faces it lies between — so `ships/elite-a-faces.ts` reconstructs closed
loops for the black fill and reports what it could not resolve.
`test/geometry.test.ts` pins those reports.

Each ship is two overlapping objects: `LineSegments` for the glowing edges,
plus a matte-black `Mesh` of the faces with `polygonOffset` pushing it just
behind the lines — that's the classic "hidden line" look, and it's why the
renderer must **not** use a logarithmic depth buffer (log-depth writes
gl_FragDepth, which disables polygon offset).

Scale: planets are ~4,500-6,500 radius and the sun sits ~320,000 out. The
**stations** are the one thing at 1 unit ≈ 1 source unit (320 across) rather
than at the ship scale — `STATION_PRESENTATION_SCALE` in
`ships/station-hulls.ts`, which says why: their hulls are the exact released
tables, but `game/docking.ts` gates five station half-widths out and the launch
standoff is an absolute distance, so shrinking them fourfold would be a docking
change. The slot itself is the source's own upright letterbox now, and the
tolerance channel turned with it.

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
steering: pirates attacking the player (`pirate-attack-g3`, and
`pirate-pack-r4-selectonly` for an organised gang) and armed traders defending
themselves (`jameson-defend-g1`). `game/brain-names.ts` decides which name flies
for whom and `game/brains.ts` turns that name into weights, so the ship and the
combat trainer's report cannot disagree; `npm test` reads those files rather than
a list. `brainFly()` runs the MLP at 10 Hz and integrates its discrete
keyboard-style controls with the same ramp the player's ship uses. It is public,
because a training episode flies a candidate genome through it — one flight
model, one place. Six more policies are in the bundle and none of them fly until
they are picked: `__game.state.brains.scripted = true` from a console, or the
LIVE BRAINS row on the combat trainer's setup panel (`T` at any station).

### 5. Training runs on the game, not on a copy of it

`src/ai-training/scenario.ts` builds an `Episode` out of the engine: the
pirates are `NpcShip`s flying `NpcShip.brainFly`, the target is a `PlayerShip`
flown from a `FlightDemand`, the guns are `game/gunnery.ts`, the ramming is
`game/collisions.ts`, the dice are `game/rng.ts`, and the step is `FIXED_DT`.
Node runs it with no canvas and no WebGL; the browser viewer replays the same
episodes.

It used to be a **copy** — `ai-training/core.ts`, ~450 lines with its own
vec/quat maths, its own PRNG, and tables mirroring ship-specs.ts, gunnery.ts,
collisions.ts and player.ts — and the contract was "change one, change the
other". That contract failed three times in ways that took a training round
each to notice: an NPC gun 5.4x too fast, a player model at accel 120 against
the real 220, and a turn decay 35% out at the two files' step rates. **A
combat number now has one home**, so a balance change changes the game and the
training environment together — which also means it invalidates the shipped
brains rather than merely desyncing them. Retrain; do not re-copy.

What is genuinely about training stays here: the fitness functions, the
opponent pool, the escape range, and the observation encoder. The policies'
observation is ship-frame relative (`policy.ts` docstring), which is what makes
them position/orientation invariant.

### 6. Pirates are businesses, not a difficulty slider

`pirateThreat()` in `game/threat.ts` decides your reception from a **mark**
— what a pirate can observe (cargo value, contraband, hold size, fitted laser,
kills, regional notoriety). It returns a count, a *tier* and whether they're *organised* (which flies the
coordinated pack brain). The tier describes the *group*, not every ship in it:
`memberTier()` gives the first one or two members the full tier and drops the
rest a rung, so a gang is ringleaders plus hangers-on. `ship-specs.ts` owns the
hulls (`pirateSpecForTier`), `threat.ts` owns the rule — so the campaign
simulator resolves each attacker at the strength the game actually spawns. Two
rules keep it from rubber-banding: only visible
things count — never credits in the bank — and threat grows sub-linearly with
the prize, so the player outgrows the galaxy slowly rather than never.

Reputation is deliberately two-sided. It lowers `appeal` (thieves want easy
cargo, not a fight) but rolls a separate *challenge*: at Dangerous, ~35% of
receptions are an organised group who came for the name. Folding fame straight
into the tier instead made 99% of late-game receptions gangs, which erased the
ladder — it has to roll, not accumulate.

Because it lives in threat.ts, `npm run campaign` scores the same function
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
- **Debug handles** (deliberate, documented): `window.__game` (a
  `legacyHandles(Game)` console view — used by the autopilot test harness, see
  docs/JAMESON-TRIALS.md), `window.__policyKit` (trained brains + inference
  fns), `state.brains.scripted` (disable brains), `state.cheat`
  (buy any equipment free, any tech level), `state.brains.pack`
  (switch pirates to the 18-input pack brain — off by default, and see
  docs/TRAINING-LOG.md for why).
- **Determinism**: everything is seeded (mulberry32) and `Math.random` is
  banned in world code — `game/rng.ts` is the world's only stream, and
  `makeRng()` beside it hands a harness a private one. A training episode
  reseeds the world from its own seed, so episodes must be run one at a time
  rather than interleaved. Episode seeds are deterministic per generation and
  mutation noise comes from a seeded RNG, so a full training rerun produces
  byte-identical weights on the same CLI args (verified: two runs, same
  generation curve, same brain).
- The **help panel** (`?` in-game) is hand-maintained in **play.html** —
  update it when you touch key bindings, along with the README table,
  `engine/keymap.ts` and `BINDINGS` in `game/controls.ts`. Four homes, and
  they change together.

## Where to start reading, in order

1. `galaxy/galaxy.ts` — self-contained, delightful, 250 lines.
2. `ships/elite-a-hulls.ts` → `ships/elite-a-faces.ts` — the data-as-art bit.
3. `player.ts` then `game/npc.ts` — flight, then behaviours.
4. `game/game.ts` — top to bottom once, with the mode machine in mind.
5. `ai-training/policy.ts` → `ai-training/scenario.ts` → `train/evolve.ts` — the AI stack
   (then docs/AI-TRAINING.md and docs/TRAINING-LOG.md for the results).
