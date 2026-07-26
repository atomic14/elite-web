# Elite (1984) → elite-web — Gap Analysis

Sources: the original game manual (elitehomepage.org), Wikipedia's Elite article,
and the byte-level algorithm references already used for the galaxy/market code.
Status as of 2026-07-25.

## What we have (and verified in-browser)

| Area | Status | Notes |
| --- | --- | --- |
| Galaxy generation | ✅ Byte-accurate | 8 galaxies × 256 systems; names, economy, government, tech level, population, productivity, radius, species — galaxy 1 verified identical to original (Lave at 7, "Human Colonials" etc.) |
| Market & trading | ✅ | Original 17-commodity price/quantity model, per-visit fluctuation, buy/sell, 20t/35t hold, kg/g exemption |
| Charts | ✅ | Galactic chart + Short Range Chart with names, 7 LY fuel circle, cursor targeting, full Data-on-System panel |
| Hyperspace | ✅ | Real chart distances, fuel cost, countdown; Galactic Hyperdrive (one-shot, TL10, lands at nearest system) |
| Station | ✅ | Rotating Coriolis with slot; manual docking w/ roll alignment; docking computer (C, TL9 purchase); launch/dock tunnel effect; safety zone (no pirates near station) |
| Flight | ✅ | Elite-style nose-steering, keyboard-analogue pitch/roll, torus drive (J) with mass-lock |
| Combat | ✅ | Pulse/Beam/Military lasers w/ heat, missiles w/ T/M lock-fire, player ECM (E), pirate missiles, tracer bolts, hit flashes, explosions, collisions & AI break-off, bounties |
| Damage model | ✅ | Fore/aft shields, 4 energy banks, death, escape pod, respawn from save |
| Equipment shop | ✅ | Manual's price/TL table: cargo bay, ECM, beam/military lasers, scoops, pod, energy unit, docking computer, galactic drive |
| Progression | ✅ | Kills → Harmless…E L I T E ratings; save-on-dock (localStorage); fugitive flag + dock fines |
| Fuel scoops | ✅ | Sun-skimming, cargo-canister scooping, and mining-laser ore drops |
| Presentation | ✅+ | Wireframe hidden-line ships, shader sun/planets (deliberate modernisation), phosphor HUD, WebAudio synth |

## Gaps — from the manual & wiki

> **Update (later on 2026-07-25):** Tiers 1-3 below are now implemented —
> cabin temperature & sun-skimming risk, missile unarm (U) + NPC ECM, energy
> bomb (TAB), hyperspace break-pattern, energy-low warning, pulse refund,
> cargo canisters & scooping, mining laser drops, CLEAN/OFFENDER/FUGITIVE
> legal tiers with police contraband scans, bounty hunters + pirate packs +
> NPC-vs-NPC combat, trader arrive/trade/depart lifecycle, 11 new hulls
> (Adder, Krait, Mamba, Asp, Fer-de-Lance, Python, Anaconda, Worm, Thargoid,
> Thargon, Constrictor), rear view + rear laser and 4-view switching,
> witch-space Thargoid ambushes, Dodo stations (TL10+), the two Navy
> missions, and chart type-to-find. Remaining: side laser mounts, gamepad /
> mouse flight, and the living-galaxy layer (see AI-TRAINING.md).

### Quick wins
1. **Cabin temperature** — manual: sun proximity raises cabin temp on a gauge
   before death; we insta-die at a radius. Needed to make sun-skimming a real
   risk/reward mechanic. (Gauge slot already exists in the HUD.)
2. **Missile polish** — `U` to unarm a locked missile; ID computer auto-lock;
   NPC traders carrying ECM that can kill *your* missiles (with the "E"
   detected indicator).
3. **Energy Bomb** — TAB, TL7, 900 Cr: destroys every lesser ship in the
   vicinity. One-shot panic button.
4. **Hyperspace break-pattern** — reuse the tunnel effect on jump entry/exit.
5. **ENERGY LOW flashing warning** when the last bank is tapped.
6. **Pulse-laser refund** when upgrading to beam (manual detail).

### Medium
7. **Cargo canisters & scooping** — ships jettison cargo when destroyed;
   scoopable with fuel scoops (keep target in lower half of screen); the
   pirate loop (pirates attack traders for cargo) and "free bounty".
8. **Legal status tiers** — CLEAN → OFFENDER → FUGITIVE; trading illegal goods
   (slaves, narcotics, firearms) raises status; police response scales;
   bounty hunters attack fugitives; escape pod resets hull signature (clean
   record) as per manual.
9. **Ship roster** — manual lists ~20 recognisable hulls: Adder, Anaconda,
   Asp, Boa, Fer-de-Lance, Gecko, Krait, Mamba, Moray, Python, Shuttle,
   Transporter, Worm… Each is just a vertex/edge/face table in our format.
10. **Rear/side views + laser mounts** — F1-F4 views; per-mount pulse lasers
    (TL3, 400 Cr); only one laser fires at a time.
11. **Mining lasers** (TL10, 800 Cr) — fragment asteroids into scoopable ore.
12. **Trader ecosystem** — traders/shuttles actually flying station↔planet
    lanes and launching/docking, rather than ambling.

### Larger
13. **Thargoids & witch-space** — random hyperspace interdiction into
    witch-space; Thargoid ships launch remote Thargon drones; very high
    bounties; possible fuel-starvation stranding (wiki).
14. **Dodo stations** — dodecahedral station model replacing Coriolis at
    high-tech systems.
15. **Missions** — version-specific: the Constrictor hunt, the Thargoid
    blueprint courier run, naval jobs (wiki: "several optional jobs for the
    Galactic Navy").
16. **Galaxy chart planet-finder** — type a name to jump the cursor (disc
    versions).
17. **Input options** — gamepad / pointer-lock mouse flight; the original
    supported joysticks.

## Deliberate deviations (agreed direction)

- Shader-rich sun and planets instead of flat 1984 circles (project goal).
- Station collision damages + bounces instead of instant death (playability).
- Docking computer is instant rather than an animated autopilot.
- Galactic hyperdrive on ⇧H instead of the manual's "G then H" chord
  (G opens the chart here; U is missile unarm, as in the original).
- Modernised key layout (the BBC original used A=fire, S/X=pitch, etc.).
- Fuel priced at 0.4 Cr/LY (the manual's table implies 0.2 Cr/LY).
