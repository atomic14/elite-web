# Elite (1984) → elite-web — Gap Analysis

Feature parity against the original game manual (elitehomepage.org),
Wikipedia's Elite article, and the byte-level algorithm references used for
the galaxy/market code. Completed items are listed as capability, not as
history — the build story lives in [DEVLOG.md](DEVLOG.md).

*Current as of 2026-07-26.*

## Implemented

| Area | Notes |
| --- | --- |
| Galaxy generation | Byte-accurate: 8 galaxies × 256 systems; names, economy, government, tech level, population, productivity, radius, species, and the original's "goat soup" planet descriptions (Lave's canonical line is asserted by `npm test`). |
| Market & trading | Original 17-commodity price/quantity model, per-visit fluctuation, buy/sell, 20t/35t hold, kg/g exemption. Market estimates for any charted system (M on the charts). |
| Charts | Galactic chart + Short Range Chart with names, 7 LY fuel circle, keyboard or click targeting, type-to-find, market estimates, and the full DATA ON SYSTEM page. |
| Hyperspace | Real chart distances, fuel cost, 5-second countdown, break-pattern tunnel. Witchpoint arrivals 12 planet-radii out on the station's side. Galactic Hyperdrive (one-shot, TL10). |
| Witch-space | Mis-jumps (9%, 22% on the courier mission) drop you among Thargoids with Thargon drones; 1.0 LY escape jump; strand yourself without fuel and a distress beacon (B) buys a tow at the cost of your cargo. |
| Stations | Rotating Coriolis with docking slot; dodecahedral Dodo stations at TL10+; manual docking with roll alignment + on-screen alignment aid; docking computer (C, TL9); launch/dock tunnel effect; policed safety zone. |
| Flight | Elite-style nose-steering with keyboard-analogue rates; classic 1984 key layout by default (modern WASD toggle); torus drive (J) with mass-lock; four views (1-4); pause. |
| Combat | Pulse/beam/military lasers with heat, four laser mounts (front/rear/left/right), the original's missile arm→lock sequence (yellow then red pylon), ECM, energy bomb, tracer bolts, hit flashes, explosion debris, collisions, bounties. On-screen target brackets with range, hull bar and a lead marker. |
| Damage model | Fore/aft shields, four energy banks with ENERGY LOW warning, hull hits that destroy cargo or knock out fittings, cabin temperature (sun proximity), escape pod, death → reload last station save. |
| Equipment | The manual's price/tech-level table: cargo bay, ECM, four laser mounts, beam/military lasers with old-laser refund, fuel scoops, escape pod, energy bomb, extra energy unit, docking computer, mining laser, galactic hyperdrive — plus a Combat Computer (see deviations). |
| Mining & scooping | Mining laser fragments asteroids into ore canisters; fuel scoops collect cargo canisters and sun-skim for fuel. |
| Legal system | CLEAN → OFFENDER → FUGITIVE; police contraband scans; bounty hunters stalk offenders; fines on docking; escape pod launders your record. |
| Ship roster | 21 hulls: Cobra Mk III, Sidewinder, Viper, Adder, Krait, Mamba, Asp, Fer-de-Lance, Python, Anaconda, Boa, Gecko, Moray, Worm, Shuttle, Transporter, Thargoid, Thargon, Constrictor, missile, cargo canister. |
| NPC ecosystem | Traders arrive from deep space, work the station lane and jump out; pirates hunt the player and prey on traders; police hunt pirates; lone bounty hunters; NPC-vs-NPC combat. Piracy scales with government type, traffic with productivity. |
| Missions | Station bulletin board (cargo, courier and bounty contracts with day-based deadlines) available from the first landing, plus the Constrictor hunt and the classified courier run (16+ kills, galaxy 1). |
| Living galaxy | A level-1 simulation runs trade between all 256 systems while you play: convoys depart on productivity, are lost to piracy in lawless space, and arrive as real traders in whatever system you're in. Prices drift ±25% from the 1984 baseline with supply, pirate hotspots emerge along lawless routes, and system news reports it. |
| Encounters | Escape capsules from destroyed ships (scoopable, with consequences), station defence Vipers, rock hermits that trade ore and ask no questions, derelict generation ships, and Trumbles. |
| Progression | Kills → Harmless … E L I T E; save-on-dock; save export/import. |
| Console | Elliptical 3D scanner, compass, gauges, missile pylons, S (station in range) and E (ECM detected) indicator lights. |
| Presentation | Wireframe hidden-line ships, shader sun and planets, phosphor HUD, WebAudio synth, in-game controls guide. Mouse throughout: pointer-lock flight, clickable menus/markets/equipment, click-to-target on the charts. |
| Ship AI | Pirates and armed traders fly neural policies trained by self-play (see [TRAINING-LOG.md](TRAINING-LOG.md)); scripted AI remains as a runtime toggle. |

## Remaining

1. **AI round 4** — round 3's reward reshaping and third league round both
   failed on held-out seeds (see TRAINING-LOG.md); the next attempt should
   widen pack observations and use opponent pools rather than single
   opponents.
2. **Contract variety** — the bulletin board covers cargo, courier and
   bounty work; passenger berths and smuggling runs would widen it.
3. **Surfacing the living galaxy** — the simulation runs, but the player
   only sees it as prices, spawns and one news line. Trade-route and danger
   overlays on the charts would make it legible.

## Deliberate deviations

- Shader-rich sun and planets instead of flat 1984 circles — the founding
  goal of the project.
- Station collisions damage and bounce you rather than killing instantly.
- The docking computer docks instantly rather than flying an animation.
- Galactic hyperdrive on ⇧H instead of the manual's "G then H" chord (G
  opens the chart here; U is missile unarm, as in the original).
- Views on 1-4 and screens on letters, because browsers claim F1-F12.
- **Pirates size you up before they commit.** The original scaled hostility
  with your *combat rating*; here it scales with what you're visibly worth
  (`pirateThreat` in src/game/contracts.ts) — cargo, hold size, fitted laser,
  reputation, and regional notoriety from your recent sales. Poor commanders
  meet opportunists in Sidewinders, rich ones meet organised gangs — two
  ringleaders in Fer-de-Lances or Asps flying the coordinated pack brain,
  plus hangers-on a tier below them. Rationale: an economic
  motive is explicable to the player and gives them levers (bank the money,
  fly armed, lie low) where a hidden difficulty curve gives them none.
  Threat grows deliberately sub-linearly with the prize so upgrades stay felt.
- **Jettisoning cargo (Y) buys off pirates.** Not in the original, which had
  no such out. They came for the goods; dumping a proportional share makes
  them break off — turning an unwinnable fight into a decision.
- Fuel priced at 0.4 Cr/LY (the manual's table implies 0.2 Cr/LY).
- A **Combat Computer** (TL9, 2000 Cr) with no 1984 equivalent: it hands
  your ship to the trained defence policy for as long as you hold a fight.
- **Contracts from day one.** The original gated missions behind a high
  combat rating; here a bulletin board gives every commander work from the
  first landing. Recognisable, but kinder.
- **Rock hermits** and **Trumbles** are affectionate borrowings from
  [Oolite](https://wiki.alioth.net/index.php/Rock_Hermit_(Oolite)), not the
  1984 game; **generation ships** come from the Elite fiction (Ian Bell
  notes they were never coded). This project is a homage, not a museum
  piece — see the deviations above.
