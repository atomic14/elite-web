# Elite (1984) → HARMLESS — Gap Analysis

Feature parity against the original game manual (elitehomepage.org),
Wikipedia's Elite article, and the byte-level algorithm references used for
the galaxy/market code. Completed items are listed as capability, not as
history — the build story lives in [DEVLOG.md](DEVLOG.md).

Since 2026-08 the ship tables and the laser arithmetic come from a vendored
analysis pack of the released Elite-A ship files rather than from a
reconstruction: what is exact, what is a clean recreation and what is ours is
one table in [ELITE-A.md](ELITE-A.md).

*Current as of 2026-08-02.*

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
| Damage model | The released game's own arithmetic: a laser's hit decoded from its byte, a target's defence from its own energy bank, and a 255-point fore shield, a 255-point aft shield and a 255-point energy bank with an ENERGY LOW warning. Hull hits destroy cargo or knock out fittings; cabin temperature (sun proximity), escape pod, death → reload last save. Every path and its unit: [DAMAGE-PATHS.md](DAMAGE-PATHS.md). |
| Equipment | The manual's price/tech-level table: cargo bay, ECM, four laser mounts, beam/military lasers with old-laser refund, fuel scoops, escape pod, energy bomb, extra energy unit, docking computer, mining laser, galactic hyperdrive — plus a Combat Computer (see deviations). |
| Mining & scooping | Mining laser fragments asteroids into ore canisters; fuel scoops collect cargo canisters and sun-skim for fuel. |
| Legal system | CLEAN → OFFENDER → FUGITIVE; police contraband scans; bounty hunters stalk offenders; fines on docking; escape pod launders your record. |
| Ship roster | All 38 released designs are built, profile-resolvable and viewable (`/viewer`), and 31 of them turn up in play: Cobra Mk III, Cobra Mk I, Sidewinder, Viper, Adder, Krait, Mamba, Fer-de-Lance, Python, Anaconda, Boa, Gecko, Moray, Worm, Shuttle, Shuttle Mk II, Transporter, Dragon, Monitor, Ophidian, Ghavial, Bushmaster, Rattler, Iguana, Chameleon, Thargoid, Thargon, Constrictor, plus the missile, the cargo canister and the escape capsule — every one the released vertex/edge/face table rather than an approximation, at one scale, with the released targetable radius driving hit registration. The Asp Mk II is built and viewable but flies nowhere: no released build of it can take a point off any flyable hull. Which role may fly which hull is read off the released blueprint slots (`src/game/ship-roles.ts`), not chosen by eye; which BUILD of it a job flies is `src/game/role-variants.ts`. |
| NPC ecosystem | Traders arrive from deep space, work the station lane and jump out; pirates hunt the player and prey on traders; police hunt pirates; lone bounty hunters; NPC-vs-NPC combat. Piracy scales with government type, traffic with productivity. |
| Missions | Station bulletin board (cargo, courier and bounty contracts with day-based deadlines) available from the first landing, plus the Constrictor hunt and the classified courier run (16+ kills, galaxy 1). |
| Living galaxy | A level-1 simulation runs trade between all 256 systems while you play: convoys depart on productivity, are lost to piracy in lawless space, and arrive as real traders in whatever system you're in. Prices drift ±25% from the 1984 baseline with supply, pirate hotspots emerge along lawless routes, and system news reports it. |
| Encounters | Escape capsules from destroyed ships (scoopable, with consequences), station defence Vipers, rock hermits that trade ore and ask no questions, derelict generation ships, and Trumbles. |
| Progression | Kills → Harmless … E L I T E; save-on-dock; save export/import. |
| Console | Elliptical 3D scanner, compass, gauges, missile pylons, the energy readout in four banks (see deviations), S (station in range) and E (ECM detected) indicator lights. |
| Presentation | Wireframe hidden-line ships, shader sun and planets, phosphor HUD, WebAudio synth, in-game controls guide. Mouse throughout: pointer-lock flight, clickable menus/markets/equipment, click-to-target on the charts. |
| Ship AI | Pirates and armed traders fly neural policies trained by self-play (see [TRAINING-LOG.md](TRAINING-LOG.md)); scripted AI remains as a runtime toggle. |

## Remaining

1. **A player shipyard** — all 15 flyable hulls are imported, resolve, and are
   read by live combat through the commander's saved `shipId`; nothing can yet
   change which one you fly. With it come the per-hull flight profiles, the
   Adder start and the per-mount laser redesign. The deferred list, and what a
   purchase would have to do, is in [ELITE-A.md](ELITE-A.md).
2. **Selecting a blueprint set by system** — all 23 released S.A-S.W sets and
   all 713 slot assignments are imported; what runs is one deterministic
   recommended build per design plus a role-based override. Choosing the set by
   technology, government and galaxy is a swap of that policy and nothing else.
3. **Contract variety** — the bulletin board covers cargo, courier and
   bounty work; passenger berths and smuggling runs would widen it.
4. **Surfacing the living galaxy** — the simulation runs, but the player
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
  (`pirateThreat` in src/game/threat.ts) — cargo, hold size, fitted laser,
  reputation, and regional notoriety from your recent sales. Poor commanders
  meet opportunists in Sidewinders, rich ones meet organised gangs — two
  ringleaders in Fer-de-Lances, Pythons or Cobras flying the coordinated pack brain,
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
- **Stations are drawn four times larger, relative to ships, than the source
  tables place them.** The *hulls* are exact — the Coriolis and the Dodo are
  released vertex tables like every ship — but they are the only objects in the
  game that do not go through the one geometry conversion. Through it a Coriolis
  would be 40 world units against the Cobra's 23.75, or 1.7 Cobras wide; here it
  is 160, or 4.7. `STATION_PRESENTATION_SCALE` in `src/ships/station-hulls.ts`
  is the single named place that says so. It exists because everything about
  docking is built on the wider station — `src/game/docking.ts` gates five
  station half-widths out, the launch standoff and the Vipers' stack are
  absolute distances — and shrinking the station fourfold would move all of them
  at once, which is a docking change and not a geometry one. The Dodo grew with
  it: its slot face is 196 world units out where the old hand-built
  dodecahedron's was 135.
- **The docking slot stands upright, and always did in the source.** Harmless
  drew a horizontal 96x20 letterbox for years; the released Coriolis slot is a
  vertical 20x60 (the Dodo's a 32x64), so the exact hulls turned the letterbox
  a quarter turn and the roll you hold to fly it turned with them. The approach
  is no more demanding: the tolerance channel is the same 52x124 rectangle
  rotated to match, and the roll tolerance is the same 0.65 rad, so over a
  uniform sample of approach offsets and rolls the fraction that docks is
  6.68% against the old rule's 6.62%.
- **Asteroids are generated, not tabulated.** The released Asteroid, Boulder and
  Splinter all fix a rock at radius 20; here they are jittered icosahedra with a
  size drawn from their seed between 25 and 70 (`buildAsteroid`), because a
  field where every rock is identical is worse to fly through and the size
  variety is what makes one worth aiming at. The three exact designs stay
  registered, profile-resolvable and viewable — the deviation is which mesh the
  `asteroid` role spawns, not which designs exist.
- **The two Harmless-only ships carry stated energy, not recovered energy.** The
  rock hermit and the derelict generation ship have no released design, so they
  cannot have a released bank. Both are written down in `game/npc-energy.ts`
  with a reason and are excluded from every claim of source parity: the hermit
  is a STATION, so it takes the station rule — immune to player lasers, 240
  points, no regeneration — and the derelict gets 252, the heaviest bank the
  catalogue holds, and recovers nothing because its reactors are cold. The
  visible change is that a rock hermit can no longer be shot down.
- **The console reads energy in four banks, and the ship has one pool.** The
  original's dashboard showed four energy banks and a pilot flew by how many
  were left; TODO 27 replaced this project's four-point bank with a single
  255-point pool, and for a while the console went on drawing four segments of
  nothing in particular. Keeping the four-bank READING was the deliberate
  choice over drawing energy as a bar like the shields it is now the same size
  as, because "two banks left, break off" is a decision a player makes at a
  glance and "0.43" is a number they have to think about — and because the
  four-bank console is one of the most recognisable things about the 1984
  screen. So the segments are quarters of one pool, and nothing about the pool
  changed. `ENERGY_BANKS` in `src/game/systems.ts` is the single place that
  says four: `LOW_ENERGY` is derived from it, so the segment the gauge turns
  red, the ENERGY LOW the step announces and the point at which shields stop
  recharging are one number seen three ways, and the gauge's own segments are
  built from it rather than written into `play.html`.
- **The mining laser is still a fitting, not a mount.** The pack gives every
  flyable hull a mining-laser byte and `playerLaserHit()` answers for it, but
  Harmless has no fourth mount to select: `miningLaser` is equipment that
  changes what a destroyed rock yields. The equipment redesign that turns it
  into a real mounted weapon is deferred by the combat plan.
- Fuel priced at 0.4 Cr/LY (the manual's table implies 0.2 Cr/LY).
  The rate is `FUEL_PRICE` in `src/game/commander.ts` — change it there.
- A **Combat Computer** (TL9, 2000 Cr) with no 1984 equivalent: it hands
  your ship to the trained defence policy for as long as you hold a fight.
- A **combat training simulator** (`T` when docked, free, every station), which
  the original had no equivalent of at all — it gave you no way to practise, and
  a game whose opponents are *trained* wants one. Two reasons, and the second is
  the load-bearing one: a player can learn what a Fer-de-Lance does differently
  from a Sidewinder without paying for the lesson with a career, and the AI can
  finally be judged against a human instead of only against other AI. CLAUDE.md
  records the cost of that gap — generation 1 and 2 won every measurement this
  project could produce and lost the only one that counted. Every exercise
  exports a JSON record, and those records are the missing input.

  The rule that makes it defensible is that **nothing which happens in it
  leaves it**: no kills, no `combatScore`, no credits, no legal status, no cargo
  or equipment lost, no save write, and death ends the exercise rather than the
  career. It must not advance you toward E L I T E — that requires real kills.
  Your own ship's FIT-OUT is selectable inside an exercise (lasers, shields,
  E.C.M., missiles, energy unit and bomb) but the HULL is not: the player's hull
  is four constants in `player.ts`, and `ai-training/scenario.ts` reads them as
  the target every pirate brain was fitted against. Design in
  `docs/COMBAT-SIM.md`.
- **Contracts from day one.** The original gated missions behind a high
  combat rating; here a bulletin board gives every commander work from the
  first landing. Recognisable, but kinder.
- **Rock hermits** and **Trumbles** are affectionate borrowings from
  [Oolite](https://wiki.alioth.net/index.php/Rock_Hermit_(Oolite)), not the
  1984 game; **generation ships** come from the Elite fiction (Ian Bell
  notes they were never coded). This project is a homage, not a museum
  piece — see the deviations above.

## Non-laser damage is Harmless policy (deliberate deviation, 2026-08)

The Elite-A analysis pack tabulates registered LASER hits exhaustively — 15,600
player-to-NPC rows and 3,900 NPC-to-player rows — and says nothing whatever
about what a ram, a canister breaking on the hull, a Coriolis wall, a missile
warhead or an energy bomb is worth. Those numbers are therefore **ours**, and
they are labelled as ours: `src/game/impact-damage.ts` is their only home, and
none of them may be quoted as an Elite-A fact.

**The rule.** An impact costs a fixed whole number of source points, stated
separately for a ship's energy bank and for the commander's pools, and is spent
on whatever it hits without asking what that is.

Two columns rather than one, because the two banks are not comparable: a
released ship carries 2 to 255 energy, and the commander carries a 255-point
facing shield in front of a 255-point bank. Fixed points rather than a share of
the target, because a hull's size is meant to be worth something — the same
44-point scrape is a third of a Sidewinder and a sixth of an Anaconda.

**The anchors**, both the Cobra Mk III, and both re-derived from the catalogue
by `test/damage-paths.test.ts` so a re-import cannot leave them stale:

| impact | ship | commander | severity |
| --- | --- | --- | --- |
| ram | 44 | 115 | 45% of the 98-point NPC anchor / of a 255-point shield face |
| canister on the hull | — | 15 | 6% of a face |
| station scrape | — | 230 | 90% of a face |
| missile warhead | 250 | 250 | flattens a full face exactly; above every released bank but five of 260 builds |
| energy bomb | 255 | — | the top of the byte scale — nothing released survives it |

The ram, the canister and the station scrape are the numbers Harmless has always
played with, restated in the units they are now spent in. The warhead moved: it
was an unconditional kill against a ship and 332 pool points against the
commander, and is 250 either way — so the five heaviest released builds survive
one at full energy by a sliver, and only an actual kill pays a bounty.

**NPC-versus-NPC laser fire is a composition, not an invention.** The pack does
not tabulate that direction, so `npcCrossfireDamage` uses the two source rules
that each half of it does have — the firing build's own `laserPower << 2` and
the defending build's own `maxEnergy & 7` — through the same oracle the two
player-facing directions use. It replaced a flat 0.11 normalized amount that
made a Thargoid's gun and a Worm's identical.

**The Constrictor's halving and a station's immunity are properties of a PLAYER
LASER.** They are fields on the target's profile, read by the player's shot and
by nothing else: a crossfire hit on the Constrictor is not halved, and a ram on a
station is not shrugged off. The impact functions are not even given a target to
ask, which is the structural version of the same rule.

The whole inventory — every path, its unit and its owner — is
`docs/DAMAGE-PATHS.md`.

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
