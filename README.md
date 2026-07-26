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
npm run build   # type-check + production build to dist/
npm run train -- attack --gens 400   # retrain the pirate AI (Node ≥ 22.6; see train/README.md)
npm run evaluate                     # held-out tournament for the current brains
```

> Retraining overwrites the committed neural weights in `src/sim/brains/`
> that the game imports — `git checkout src/sim/brains` restores them.

You start docked at Lave Station with 100.0 Cr, a full tank and 3 missiles.
Progress saves automatically every time you dock.

## Controls

### Flight — CLASSIC layout (the 1984 default; press B when docked for modern WASD)
| Key | Action |
| --- | --- |
| S / X or ↑ / ↓ | dive / climb — the original's pitch keys |
| , / . or ← / → | roll |
| SPACE / `/` | accelerate / decelerate |
| A (or F) | fire laser (watch the temperature) |
| 1-4 | front / rear / left / right view |
| T / M / U | missile lock / fire / unarm |
| E / TAB | E.C.M. / energy bomb (if fitted) |
| J | torus jump drive (8×, disengages when mass-locked) |
| P | pause |
| C | docking computer (if fitted, within range) |
| K | combat computer — the trained defence AI flies your ship (if fitted) |
| N / G / I | local chart / galactic chart / commander status |
| H / ⇧H | hyperspace jump / galactic hyperdrive (if fitted) |
| F (in charts) | type-to-find a system by name |
| ? | in-game controls guide (all bindings, by category) |

Manual docking: fly into the station's slot with your wings matched to the
slot's rotation, using the alignment aid that appears as you line up. Get it
wrong and you'll bounce off with shield damage.

The console lights an **S** while the station is in scanner range (its
defences cover you there) and an **E** when an E.C.M. broadcast is
detected — as on the original's dashboard.

### Docked
L launch · M market · E equip ship · N local chart · G galactic chart ·
I status · X export save (JSON download) · Z import save

Press **?** anywhere for the full in-game controls guide (it always shows
the active layout). The CLASSIC layout is the authentic 1984 set — S/X
pitch, `<` `>` roll, A fire, SPACE//. Press **B** when docked to switch to
a MODERN WASD scheme (persisted per browser). In both layouts views are 1-4
(were F0-F3) and screens use letters (were F4-F9).

### Market
↑↓ select · B buy · V sell · ESC exit

### Chart
Arrows move cursor · ENTER set target · M market estimate for the
highlighted system · F find by name · ESC exit

## Game systems

- **Trading** — 17 commodities with the original price/quantity model;
  economies matter (buy food cheap at agriculturals, sell computers dear).
  20t hold; precious metals/gems don't take hold space.
- **Combat** — pulse/beam/military lasers with heat, a rear mount, homing
  missiles with target lock,
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
  drones. High bounties, if you live.
- **Mining & scooping** — blast asteroids (mining laser drops ore canisters)
  and scoop drifting cargo with fuel scoops; sun-skim to refuel, watching the
  cabin temperature.
- **Navy missions** — prove yourself (16+ kills, galaxy 1) for the
  Constrictor hunt and the classified courier run.
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
