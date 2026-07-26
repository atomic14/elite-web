# Elite (1984) → elite-web — Gap Analysis

Feature parity against the original game manual (elitehomepage.org),
Wikipedia's Elite article, and the byte-level algorithm references used for
the galaxy/market code. Completed items are listed as capability, not as
history — the build story lives in [DEVLOG.md](DEVLOG.md).

*Current as of 2026-07-26.*

## Implemented

| Area | Notes |
| --- | --- |
| Galaxy generation | Byte-accurate: 8 galaxies × 256 systems; names, economy, government, tech level, population, productivity, radius, species. Galaxy 1 is identical to the original (Lave at system 7) — asserted by `npm test`. |
| Market & trading | Original 17-commodity price/quantity model, per-visit fluctuation, buy/sell, 20t/35t hold, kg/g exemption. Market estimates for any charted system (M on the charts). |
| Charts | Galactic chart + Short Range Chart with names, 7 LY fuel circle, cursor targeting, Data-on-System panel, type-to-find by name. |
| Hyperspace | Real chart distances, fuel cost, 5-second countdown, break-pattern tunnel. Witchpoint arrivals 12 planet-radii out on the station's side. Galactic Hyperdrive (one-shot, TL10). |
| Witch-space | Mis-jumps (9%, 22% on the courier mission) drop you among Thargoids with Thargon drones; 1.0 LY escape jump; stranding is possible. |
| Stations | Rotating Coriolis with docking slot; dodecahedral Dodo stations at TL10+; manual docking with roll alignment + on-screen alignment aid; docking computer (C, TL9); launch/dock tunnel effect; policed safety zone. |
| Flight | Elite-style nose-steering with keyboard-analogue rates; classic 1984 key layout by default (modern WASD toggle); torus drive (J) with mass-lock; four views (1-4); pause. |
| Combat | Pulse/beam/military lasers with heat, four laser mounts (front/rear/left/right), missiles with lock/fire/unarm, ECM, energy bomb, tracer bolts, hit flashes, explosion debris, collisions, bounties. |
| Damage model | Fore/aft shields, four energy banks with ENERGY LOW warning, cabin temperature (sun proximity), escape pod, death → reload last station save. |
| Equipment | The manual's price/tech-level table: cargo bay, ECM, four laser mounts, beam/military lasers with old-laser refund, fuel scoops, escape pod, energy bomb, extra energy unit, docking computer, mining laser, galactic hyperdrive — plus a Combat Computer (see deviations). |
| Mining & scooping | Mining laser fragments asteroids into ore canisters; fuel scoops collect cargo canisters and sun-skim for fuel. |
| Legal system | CLEAN → OFFENDER → FUGITIVE; police contraband scans; bounty hunters stalk offenders; fines on docking; escape pod launders your record. |
| Ship roster | 21 hulls: Cobra Mk III, Sidewinder, Viper, Adder, Krait, Mamba, Asp, Fer-de-Lance, Python, Anaconda, Boa, Gecko, Moray, Worm, Shuttle, Transporter, Thargoid, Thargon, Constrictor, missile, cargo canister. |
| NPC ecosystem | Traders arrive from deep space, work the station lane and jump out; pirates hunt the player and prey on traders; police hunt pirates; lone bounty hunters; NPC-vs-NPC combat. Piracy scales with government type, traffic with productivity. |
| Missions | The Constrictor hunt and the classified courier run (16+ kills, galaxy 1). |
| Progression | Kills → Harmless … E L I T E; save-on-dock; save export/import. |
| Console | Elliptical 3D scanner, compass, gauges, missile pylons, S (station in range) and E (ECM detected) indicator lights. |
| Presentation | Wireframe hidden-line ships, shader sun and planets, phosphor HUD, WebAudio synth, in-game controls guide. |
| Ship AI | Pirates and armed traders fly neural policies trained by self-play (see [TRAINING-LOG.md](TRAINING-LOG.md)); scripted AI remains as a runtime toggle. |

## Remaining

1. **Pointer-lock mouse flight** — in progress; the original supported
   joysticks and analogue control is the one input mode we lack.
2. **Gamepad support** — same rationale, via the Gamepad API.
3. **The living galaxy** — a two-level simulation where traffic flows
   between all 256 systems and materialises in yours, with prices nudged by
   simulated trade and pirate risk migrating to rich, lawless routes.
   Design in [AI-TRAINING.md](AI-TRAINING.md).
4. **Rare encounters** — generation ships, asteroid hermits, and Trumbles
   (the tribble infestation).
5. **Witch-space rescue** — stranding is currently a slow death with no
   counterplay; a distress beacon (at a price) would make it a story.
6. **AI round 3** — pack-phase retrain with the reward fixes noted in the
   training log, and a third league round.

## Deliberate deviations

- Shader-rich sun and planets instead of flat 1984 circles — the founding
  goal of the project.
- Station collisions damage and bounce you rather than killing instantly.
- The docking computer docks instantly rather than flying an animation.
- Galactic hyperdrive on ⇧H instead of the manual's "G then H" chord (G
  opens the chart here; U is missile unarm, as in the original).
- Views on 1-4 and screens on letters, because browsers claim F1-F12.
- Fuel priced at 0.4 Cr/LY (the manual's table implies 0.2 Cr/LY).
- A **Combat Computer** (TL9, 2000 Cr) with no 1984 equivalent: it hands
  your ship to the trained defence policy for as long as you hold a fight.
