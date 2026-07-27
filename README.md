# ELITE (web)

A web remake of the classic 1984 Elite: authentic wireframe ships, the
original byte-accurate procedural galaxy (Lave is system 7, as it should
be), modern shader-driven suns and planets — and ship AI trained by
neuroevolution self-play, flying both the pirates that hunt you and the
traders that fight back.

![Approaching a Coriolis station with the docking aid live](docs/images/station-docking.jpg)

| | |
| --- | --- |
| ![A seeded shader planet](docs/images/planet.jpg) | ![The Short Range Chart](docs/images/short-range-chart.jpg) |

*Every planet is generated from the 1984 seeds — Diso's violet coastlines
above, "Population: 4.1 Billion (Black Furry Felines)", exactly as the
original's data tables intend. Below: three trained pirates converging in
the [combat viewer](docs/TRAINING-LOG.md).*

![Trained pirates converging on a trader in the combat viewer](docs/images/combat-viewer.jpg)

**Docs index:**
[Development log](docs/DEVLOG.md) ·
[Architecture tour](docs/ARCHITECTURE.md) ·
[AI design](docs/AI-TRAINING.md) ·
[Training runs & results](docs/TRAINING-LOG.md) ·
[Reproducing the training](train/README.md) ·
[Gap analysis vs the 1984 original](docs/GAP-ANALYSIS.md) ·
[The Jameson Trials](docs/JAMESON-TRIALS.md)

## Run

```sh
npm install
npm run dev     # http://localhost:5173  (game)
                # http://localhost:5173/viewer.html  (AI combat viewer)
npm run build   # lint + tests (via prebuild), then production build to dist/
npm run train -- attack --gens 400   # retrain the pirate AI (Node ≥ 22.6; see train/README.md)
npm run evaluate                     # held-out tournament for the current brains
npm test                             # invariant + simulation tests (no framework)
npm run campaign                     # headless balance playtest: 40 careers × 60 legs
npm run campaign -- 4 45000 all      # three career strategies, all the way to E L I T E
```

Two playtest harnesses back this up. `npm run campaign` plays hundreds of
full commander careers headlessly — real galaxy, market, living-galaxy and
contract code, with only flight abstracted — and reports whether the economy
actually works (wealth curve, bankruptcy rate, time to first upgrade,
equipment progression, piracy losses), failing the build if it doesn't. It
can also play a commander all the way to **E L I T E** (25,600 kills) in
about 20 seconds, under three different strategies — `trader`, `hunter`,
`privateer` — which is how the combat ladder below was measured.

There's also an **autonomous playtest agent** (`test/playtest.js`): paste it
into the browser console with the game open and `await __playtest.run({
legs: 8 })` sends a commander off to take contracts, trade, fight, jump and
dock on its own, asserting invariants as it goes and printing a report of
everything it exercised. It's how gameplay changes get regression-tested.

CI lints, tests, builds and runs the balance playtest on every push. The
live site deploys from Cloudflare Pages (build `npm run build`, output
`dist`) — and since npm runs `prebuild` before `build`, a commit that fails
lint or tests fails the deploy build rather than shipping.

> Retraining overwrites the committed neural weights in `src/sim/brains/`
> that the game imports — `git checkout src/sim/brains` restores them.

You start docked at Lave Station with 100.0 Cr, a full tank and 3 missiles.
Progress saves automatically every time you dock.

## Controls

Two flight layouts ship. **CLASSIC — the authentic 1984 keys — is the
default**; press **B** when docked to switch to MODERN (WASD), which is
remembered per browser. Press **?** any time for the in-game guide, which
always shows the active layout.

### Flight

| CLASSIC (default) | MODERN | Action |
| --- | --- | --- |
| S / X | W / S | dive / climb — pitch (in both: ↓ arrow pulls up) |
| `,` / `.` | A / D | roll (arrows work in both) |
| SPACE | SPACE | accelerate |
| `/` | X or `/` | decelerate |
| A (or F) | F | fire laser (watch the temperature) |

The original's `<` `>` roll and `/` slow-down are live in both layouts, so
muscle memory from 1984 mostly survives either choice. Arrow keys always fly.

**Mouse flight**: press **V** in flight to pointer-lock the mouse into a
self-centring analogue stick (left button fires). Touching the keyboard
overrides it; ESC or V releases. This is the closest thing to the
joystick the original supported.

### Commands (identical in both layouts)

| Key | Action |
| --- | --- |
| 1 2 3 4 | front / rear / left / right view |
| T / M / U | arm missile (locks in your sights) / fire / unarm |
| E / TAB | E.C.M. / energy bomb (if fitted) |
| J | torus jump drive (8×, stars streak; cuts out when mass-locked) |
| C | docking computer (if fitted, within range) |
| K | combat computer — the trained defence AI flies your ship (if fitted) |
| N / G | short range chart / galactic chart |
| H / ⇧H | hyperspace jump / galactic hyperdrive (if fitted) |
| B | distress beacon — GalCop tows you out of witch-space, for your cargo |
| Y | jettison a tonne of cargo — pirates came for the goods, not for you |
| I | commander status |
| P | pause |
| V | mouse flight — pointer-locked analogue stick, left button fires |
| ? | controls guide |

Views on 1-4 (the original used F0-F3) and screens on letters (were F4-F9),
because browsers claim the function keys.

### Docked

L launch · M market · E equip ship · N local chart · G galactic chart ·
C contracts · D data on system · I status · B switch keyboard layout ·
X export save · Z import save · **⇧N start a new commander** (confirms first)

### Market

↑↓ select · B buy · V sell · ESC exit

### Charts

**Click a system to target it** · arrows move the cursor · ENTER set
hyperspace target · **D data on system** (the full statistics page with the
original's procedurally generated planet description) · M market estimate ·
F find a system by name · ESC exit

### Docking and the console

Fly into the station's slot with your wings matched to the slot's rotation,
using the alignment aid that appears as you line up: the dot shows your
lateral offset (green when you'd fit through), the bar shows the slot's
rotation (green when your roll matches). Get it wrong and you'll bounce off
with shield damage — or buy the docking computer.

The console lights an **S** while the station is in scanner range (its
defences cover you there) and an **E** when an E.C.M. broadcast is
detected — as on the original's dashboard.

## Game systems

- **Trading** — 17 commodities with the original price/quantity model;
  economies matter (buy food cheap at agriculturals, sell computers dear).
  20t hold; precious metals/gems don't take hold space.
- **Combat** — pulse/beam/military lasers with heat, four mounts, homing
  missiles you arm and then lock by putting the target in your sights,
  on-screen target brackets with a lead marker, hull hits that cost you
  cargo and fittings,
  fore/aft shields and 4 energy banks, bounties, kill ratings from Harmless
  to E L I T E. Pirate numbers scale with the government type; shoot police
  or traders and you become a fugitive (police attack; fine on docking).
- **Hyperspace** — 7.0 LY fuel range, per-jump fuel cost by real chart
  distance, 5-second countdown.
- **Death** — ship destroyed → reload your last station save (unless an
  escape pod saves you, at the cost of your cargo).
- **Legal system** — CLEAN → OFFENDER → FUGITIVE; police scan for contraband
  (slaves, narcotics, firearms), bounty hunters stalk offenders, fines on
  docking.
- **A living system** — traders warp in, do business at the station and jump
  out; pirates hunt them for cargo you can scoop; police hunt the pirates.
- **Witch-space** — mis-jumps drop you among Thargoids and their Thargon
  drones. High bounties, if you live. Out of fuel out there? Broadcast a
  distress beacon and GalCop will tow you clear — they'll take your cargo
  as the salvage fee.
- **Mining & scooping** — blast asteroids (mining laser drops ore canisters)
  and scoop drifting cargo with fuel scoops; sun-skim to refuel, watching the
  cabin temperature.
- **A living galaxy** — trade runs between all 256 systems while you play.
  Convoys depart from productive worlds, get taken by pirates in lawless
  space, and arrive in your system as real ships. Prices drift with supply,
  pirate hotspots emerge along dangerous routes, and the system data screen
  reports the news. The 1984 economy stays the baseline underneath — this
  layer only ever nudges it ±25%.
- **Pirates as businesses** — what waits for you on the way in depends on
  what you're visibly worth. An empty Cobra draws a couple of opportunists in
  Sidewinders; a full hold draws professionals; a fat, notorious one draws an
  organised gang flying a coordinated attack policy. A gang isn't five
  Fer-de-Lances, though — it's two ringleaders plus hangers-on in whatever
  they could afford, which is why they can be common without being hopeless. Only
  what a pirate can *see* counts — cargo, hold size, fitted laser, your
  reputation — never your bank balance, so banking the money and flying clean
  is a real strategy. Threat grows far slower than your ship does, so upgrades
  are felt rather than cancelled out. And since they came for the cargo,
  **jettisoning it (Y) buys them off** — proportionally: opportunists want a
  little, a gang that organised for you wants about a third of the prize.
  Selling big or dirty loads raises your profile here and in neighbouring
  systems, and it fades if you lie low. Your **reputation cuts both ways**:
  it scares off thieves after easy cargo, but once you're Dangerous roughly a
  third of the ships waiting for you came for the name rather than the hold.
  Ratings count difficulty too — a gang's Fer-de-Lance is worth five
  Sidewinders — so the ladder rewards the fights worth having.
- **Contracts** — every station runs a bulletin board with cargo runs,
  courier jobs and pirate-clearing bounties, available from your very first
  landing. Deadlines are measured in days, which pass as you jump. (The
  original made you earn your first mission with 16 kills; a new commander
  deserves somewhere to be.)
- **Navy missions** — prove yourself (16+ kills, galaxy 1) for the
  Constrictor hunt and the classified courier run.
- **Don't shoot the station.** Its hull shrugs off a laser, but GalCop
  notices: you're marked an offender and the station scrambles Vipers from
  the slot. Shooting *those* is how you become a fugitive.
- **Encounters** — destroyed ships eject escape capsules (scoop one and the
  survivor becomes, regrettably, cargo); stations scramble Vipers if you
  misbehave in their sight; rock hermits hide among the asteroids, dealing
  ore and asking no questions; derelict generation ships drift between the
  stars; and someone will sell you a Trumble for 2 credits, which is one of
  the worst decisions available to you.
- **Trained ship AI** — pirates and armed traders fly neural policies
  trained by self-play (docs/TRAINING-LOG.md); watch them fight in the
  combat viewer.

## Architecture

- `src/galaxy/` — the genuine Elite galaxy algorithm: three twisted 16-bit
  seed words generate all 256 systems per galaxy (names, economy, government,
  tech level, market). Galaxy 1 is byte-identical to the original — system 7
  is Lave.
- `src/ships/` — 21 hulls as explicit vertex/edge/face tables in the style
  of the original BBC data (Cobra Mk III, Sidewinder, Viper, Adder, Krait,
  Mamba, Asp, Fer-de-Lance, Python, Anaconda, Boa, Gecko, Moray, Worm,
  Shuttle, Transporter, Thargoid, Thargon, Constrictor, missile, canister) plus the Coriolis and Dodo stations, drawn
  as wireframe edges over a black occluding hull (classic hidden-line look).
- `src/world/` — shader sun (animated fbm surface, limb darkening, corona),
  shader planet (coastline contours, graticule, terminator, atmosphere rim —
  seeded per system), starfield, space dust, per-system scene assembly.
- `src/game/` — game orchestrator (modes, docking, hyperspace, combat),
  NPC AI (traders/pirates/police), commander state + saves.
- `src/hud/`, `src/ui/` — scanner/compass/gauges console and the full-page
  screens (station menu, market, chart, status).
- `src/audio.ts` — WebAudio synth in the spirit of the BBC sound chip.
- `src/sim/` + `train/` — render-free combat simulator, tiny MLP policies
  (1.9k params, keyboard-style discrete actions) and a neuroevolution
  self-play trainer; trained weights live in `src/sim/brains/`. The combat
  viewer (`viewer.html`) replays matchups with the real wireframe ships.
  See `docs/AI-TRAINING.md` and `docs/TRAINING-LOG.md`.
- Rendering: three.js + UnrealBloom for the phosphor glow.

## Acknowledgements & legal

This is a non-commercial fan homage, released under the MIT license (see
LICENSE). Elite (1984) was created by Ian Bell and David Braben and published
by Acornsoft; the "Elite" trademark belongs to Frontier Developments plc.
This project is affiliated with none of them. The galaxy generator follows
the long-published descriptions of the original algorithm; ship silhouettes
are freshly-made approximations in the spirit of the originals.

## Roadmap

[docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) tracks feature-by-feature parity
with the original manual — almost all of it is now implemented. Remaining:
side laser mounts, gamepad / pointer-lock mouse flight, and the two-level
"living galaxy" simulation sketched in
[docs/AI-TRAINING.md](docs/AI-TRAINING.md). AI-wise: pack-phase round 3
(reward shaping ideas in docs/TRAINING-LOG.md) and putting the defence brain
behind a purchasable in-game "combat computer".
