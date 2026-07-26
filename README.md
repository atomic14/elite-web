# ELITE (web)

A web remake of the classic 1984 Elite: authentic wireframe ships and the
original procedural galaxy, with modern shader-driven suns and planets.

## Run

```sh
npm install
npm run dev     # http://localhost:5173  (game)
                # http://localhost:5173/viewer.html  (AI combat viewer)
npm run build   # type-check + production build to dist/
npm run train -- attack --gens 400   # retrain the pirate AI (see docs/TRAINING-LOG.md)
```

You start docked at Lave Station with 100.0 Cr, a full tank and 3 missiles.
Progress saves automatically every time you dock.

## Controls

### Flight
| Key | Action |
| --- | --- |
| W / S or ↑ / ↓ | pitch (flight-style: ↓ pulls the nose up) |
| A / D or ← / → or , / . | roll (comma/period are the classic 1984 keys) |
| SPACE / X or / | accelerate / decelerate (slash is the classic key) |
| F | fire laser (watch the temperature) |
| 1-4 | front / rear / left / right view |
| T / M / U | missile lock / fire / unarm |
| E / TAB | E.C.M. / energy bomb (if fitted) |
| J | torus jump drive (8×, disengages when mass-locked) |
| C | docking computer (if fitted, within range) |
| N / G / I | local chart / galactic chart / commander status |
| H / ⇧H | hyperspace jump / galactic hyperdrive (if fitted) |
| F (in charts) | type-to-find a system by name |
| ? | in-game controls guide (all bindings, by category) |

Manual docking: fly into the station's slot with your wings matched to the
slot's rotation. Get it wrong and you'll bounce off with shield damage.

### Docked
L launch · M market · E equip ship · N local chart · G galactic chart · I status

Press **?** anywhere for the full in-game controls guide. Layout policy: the
classic 1984 keys are kept wherever they don't fight modern muscle memory
(SPACE, `,` `.`, `/`, T/M/U missiles, E, TAB, J, C, H); flight is modernised
to WASD+arrows (the BBC used S/X and `<` `>`), fire is F (was A), views are
1-4 (were F0-F3), and the screens use letters instead of function keys.

### Market
↑↓ select · B buy · V sell · ESC exit

### Chart
Arrows move cursor · ENTER set target · ESC exit

## Game systems

- **Trading** — 17 commodities with the original price/quantity model;
  economies matter (buy food cheap at agriculturals, sell computers dear).
  20t hold; precious metals/gems don't take hold space.
- **Combat** — pulse laser with heat, homing missiles with target lock,
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
- **Navy missions** — prove yourself (16+ kills) for the Constrictor hunt
  and the classified courier run.

## Architecture

- `src/galaxy/` — the genuine Elite galaxy algorithm: three twisted 16-bit
  seed words generate all 256 systems per galaxy (names, economy, government,
  tech level, market). Galaxy 1 is byte-identical to the original — system 7
  is Lave.
- `src/ships/` — ships as explicit vertex/edge lists in the style of the
  original BBC data (Cobra Mk III, Sidewinder, Viper, Coriolis, missile),
  drawn as wireframe edges over a black occluding hull (classic hidden-line
  look).
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

## Roadmap

See [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) for a full feature-by-feature
comparison against the original manual. Headlines: cabin temperature +
sun-skimming risk, cargo scooping & mining, CLEAN/OFFENDER/FUGITIVE legal
tiers, the wider ship roster (Python, Anaconda, Fer-de-Lance…), rear/side
views and laser mounts, Thargoids in witch-space, Dodo stations, missions.
