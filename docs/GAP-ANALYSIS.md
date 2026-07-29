# Elite (1984) → HARMLESS — Gap Analysis

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
- **Traders dock.** In the original you saw ships use the station; here they
  fly the slot properly, sharing the autopilot with your own docking computer
  (src/game/docking.ts). About half of arriving traders put in; the rest
  jump out as before.
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
- **The rating ladder counts difficulty, not bodies.** The original scored
  every kill the same, which made the fastest route to E L I T E farming the
  weakest thing you could find, and made the top of the ladder a flat grind.
  A gang's Fer-de-Lance is worth five Sidewinders (`killValue` in
  commander.ts). `kills` is still the literal body count on the status screen;
  `combatScore` is what the ladder reads. The iconic 25,600 is untouched.
- **Fame draws challengers.** In the original, reputation only ever made you
  safer. Here it cuts both ways: a reputation deters thieves after easy cargo
  (it lowers `appeal`) while drawing people who want to be the ones who killed
  you. At Dangerous, ~35% of receptions are someone coming for the name rather
  than the hold — which is what stops the endgame being a grind, and is the
  reason a famous commander gets hunted flying an empty ship.
- **Player gunnery is a ray against the hull**, not a cone around a sphere.
  The original (and this project until now) tested an angular cone sized from
  the target's *maximum* radius, which makes every ship a ball: an Anaconda
  was no easier to hit down its long flank than head-on, and shots landed on
  empty space beside thin hulls. Now the shot is cast at the actual mesh,
  with a small graze tolerance for beam width. Measured: an Anaconda is
  1.3° nose-on and 2.5° broadside; a Sidewinder 1.6° across its wings and
  0.6° vertically.
- **The player's Cobra is more agile than the 1984 numbers imply**
  (pitch 1.45 rad/s, roll 2.5). NPC fighters pitch at `turnRate × 1.4`, so
  small hulls turn inside you — as they should — but at the original 1.1 they
  turned inside you so far that holding a bead was hopeless.
- **Jettisoning cargo (Y) buys off pirates.** Not in the original, which had
  no such out. They came for the goods; dumping a proportional share makes
  them break off — turning an unwinnable fight into a decision.
- **Turn-rate ramp is `1 - exp(-rate·dt)`, not `min(1, rate·dt)`.** The
  original's frame rate is not something we can know from here, and it does not
  matter: every rate in this game is per SECOND, not per frame, so the top turn
  rate is the same at any refresh. Only the ramp toward it was frame-rate
  dependent, and now it is not. Constants recalibrated so 60Hz is bit-identical
  to what shipped.
- Fuel priced at 0.4 Cr/LY (the manual's table implies 0.2 Cr/LY).
  The rate is `FUEL_PRICE` in `src/game/commander.ts` — change it there.
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

## Aim assist and the ring sight (deliberate deviation, 2026-07)

The 1984 game had a cross and no assist: a shot hit if the target's silhouette
covered the sight. We keep the ray test that does exactly that, and add an
angular allowance on top — a fixed 2 degrees at knife range, tapering to
nothing by 2400 units so distance shooting still demands precision.

Why deviate. A Sidewinder at 500 units subtends 1.9 degrees. Holding a mouse
or a key inside that while both ships manoeuvre is most of why fights read as
flailing, and it is the half of the combat problem that belongs to the player
rather than to the AI — the NPCs got their fix in the same change (they now
fire whenever the geometric gate allows, instead of also needing the trained
policy's trigger).

Two things keep it honest rather than a cheat:

- The cross became a **ring**, drawn from the projection to the exact angle of
  the assist. Anything inside the ring is inside the envelope, so the sight
  states the rule instead of hiding it. The ring lights when a shot would
  actually connect at the current range.
- The cockpit beams **bend onto the target** they found. Chris's point, and
  the right one: an allowance that silently converts a near miss into a hit
  reads as a bug, where beams that visibly converge read as the gunsight doing
  its job.

Recognisability was the constraint (CLAUDE.md: homage, not museum piece). The
sight keeps a centre pip so it still reads as a gunsight rather than a modern
soft-lock, and nothing tracks or snaps — the ship's nose still has to be put
near the target.
