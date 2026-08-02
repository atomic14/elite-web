# The Elite-A reference catalogue

What was imported, what it is used for, which numbers are the released game's
and which are ours, and what a future shipyard will need. Written at the close
of the Elite-A damage-and-catalogue alignment phase (TODOs 21-30,
[plan](TODO/ELITE-A-COMBAT-PLAN.md)).

The two companion documents: [DAMAGE-PATHS.md](DAMAGE-PATHS.md) is the
inventory of every way anything can be hurt, and
[GAP-ANALYSIS.md](GAP-ANALYSIS.md) records every deliberate deviation from the
1984 original. This file is about the DATA and the identities.

## Source attribution and provenance

The catalogue is generated from an analysis pack of the released Elite-A ship
and combat tables, vendored verbatim at `reference/elite-a/source/`. It is ten
files, and the importer refuses to run against anything else:

```
sourceHash  85fece5618c1302dac6b2bbc5c6e78629d37fb5ac27769dddf24fb0b38b52ccb
```

That is a SHA-256 over the ten per-file SHA-256s. Every file the importer
writes carries it in a `source-hash:` header line, `ELITE_A_SOURCE_HASH` in
`provenance.generated.ts` exports it, the three oracle fixtures record it, and
`test/elite-a-catalogue.test.ts` asserts they all agree. The per-file hashes are
`reference/elite-a/manifest.json`, and they are also pinned a second time, by
hand, in `PINNED` at the top of `tools/import-elite-a.mjs` — so a pack that
hashes differently stops the importer rather than quietly becoming the new
truth.

Background reading, and the source of the constraints this phase worked to:

- [Buying and flying ships in Elite-A](https://elite.bbcelite.com/deep_dives/elite-a_buying_and_flying_ships.html)
- [Ship blueprints in Elite-A](https://elite.bbcelite.com/deep_dives/elite-a_ship_blueprints.html)

Nothing in `src/` reads the pack or the fixtures. `test/elite-a-catalogue.test.ts`
asserts that too, by scanning every source file for a path into either.

## What the importer produces

`npm run generate:elite-a` reads the pack and writes ten files.
`npm run generate:elite-a -- --check` writes nothing and exits non-zero if any
of them has drifted; it is part of `npm run check` and of `npm run elite-a`.

| generated file | holds |
| --- | --- |
| `src/game/elite-a/designs.generated.ts` | the 38 designs and the header fields every build of one shares |
| `src/game/elite-a/variants.generated.ts` | the 260 exact S.A-S.W builds — the ten fields that DO vary |
| `src/game/elite-a/geometry.generated.ts` | one hull per design, deduplicated: vertices, edges, faces |
| `src/game/elite-a/slots.generated.ts` | the 713 blueprint-slot assignments (398 populated) and their NEWB bytes |
| `src/game/elite-a/player-hulls.generated.ts` | the 15 flyable hulls: four laser bytes, armour, capacities |
| `src/game/elite-a/provenance.generated.ts` | the source hash, the counts, and the solved NEWB bit layout |
| `reference/elite-a/manifest.json` | the ten input files, their sizes and their hashes |
| `test/fixtures/elite-a/hits-to-destroy.json` | 15,600 player-to-NPC oracle rows |
| `test/fixtures/elite-a/npc-damage-to-player.json` | 3,900 NPC-to-player rows, both encodings |
| `test/fixtures/elite-a/hit-ranges.json` | 570 min/max hits-per-design summaries |

Generated files are **read-only**. To change one, change the pack or
`tools/elite-a/build.mjs`, regenerate, and review the diff. Each one opens with
`// GENERATED FILE — DO NOT EDIT.` and a test asserts that it does.

`src/game/elite-a/types.ts` is the only hand-written file beside them: it is the
contract the importer emits against. `catalogue.ts` is the only way in — it is
the one file allowed to know the generated arrays are arrays, and
`test/ship-identity.test.ts` fails if any other module imports a
`.generated.ts`.

## Three stable identities

They are namespaced strings, they are what goes in a save, and they never carry
an expanded record (`src/game/ship-identity.ts`).

| id | shape | addresses |
| --- | --- | --- |
| `PlayerHullId` | `elite-a:player:<0-14>` | one of the 15 flyable hulls |
| `ShipDesignId` | `elite-a:design:<0-37>` | one hull's geometry and shared header |
| `NpcCombatProfileId` | `elite-a:variant:<set>:<design>` | one exact released build |

Plus exactly two `harmless:` overlays — `harmless:design:generation-ship` /
`harmless:profile:generation-ship` and the same pair for `rock-hermit`. They
carry a stated `why`, and they can never be mistaken for recovered source data.
That is why the enumerations are 15 hulls, **40** designs and **262** profiles:
38 + 2 and 260 + 2.

Three identities because three things move independently. A future shipyard
changes the player's hull id; a future blueprint-set loader changes which
variant an NPC spawns as; geometry changes neither. Combat reads the profile
and does not care which policy chose it.

**Migration.** A commander saved before this phase has no `shipId` and loads as
the Cobra Mk III (`migratedPlayerHullId`). An NPC snapshot with no ids
re-derives them from its role, its seed and its hull, deterministically and
without drawing from the rng. A save that carries an EXACT variant which is not
its design's recommended default keeps it — that is the property that makes
saving the id worth anything, and `test/ship-identity.test.ts` checks it
specifically, because re-deriving on restore passes every other test.

## The geometry registry

```
geometry.generated.ts      source vertices, edges, faces (integers)
  -> ships/elite-a-hulls.ts    one conversion: 1 world unit = 4 source units
  -> ships/elite-a-faces.ts    closed polygons rebuilt from face adjacency
  -> ships/registry.ts         designId -> hull, name, target radius: the only way in
  -> ships/geometry.ts         buildShip(): lines + black fill, turned to face -Z
```

Four facts worth knowing before touching any of it:

- **One scale for every design.** `SOURCE_UNITS_PER_WORLD_UNIT = 4`, anchored so
  the Cobra Mk III keeps the size it always had. There is no per-ship factor and
  `test/geometry.test.ts` asserts there is none.
- **The target radius comes from the pack**, through the same conversion, so
  what a ray test hits is the released ship rather than a hand-tuned guess.
  `NpcSpec` has no `radius` field at all — there is nowhere for a roster row to
  state a size. Where the pack stores a whole-number radius (30 designs) it is
  used directly; where it does not (8 designs) it is the square root of the
  stored area, and `eliteATargetRadius()` is the one home for that choice.
- **The source stores no polygons.** A face is a normal, and an edge says which
  two faces it lies between, so `elite-a-faces.ts` reconstructs closed loops for
  the black fill and REPORTS what it could not resolve. Those reports are pinned
  by test: three faces cannot be wound by their stored normal (the alloy plate's
  is `(0,0,0)`, and two of the Splinter's sit past 60 degrees off its own
  geometry), 177 edges bound no face and are drawn anyway, and every hull but the
  alloy plate is closed.
- **`buildShip()` turns a def a half turn about Y** — negating x AND z. It used
  to mirror z alone, which is the same picture for a left/right symmetric hull
  and a different ship for an asymmetric one; eight of the 38 are asymmetric.

The two stations are the one exception to the single scale, at
`STATION_PRESENTATION_SCALE = 4` on top of it — the hulls are exact, the size is
a presentation choice, and `ships/station-hulls.ts` says why.

## The damage flows

Every laser number in the game comes out of `elite-a/combat-math.ts`, which is
pure — it imports nothing at all — and is reproduced against all 20,070 supplied
rows by `test/elite-a-oracle.test.ts`.

```
PLAYER LASER -> NPC
  gunnery.ts   playerLaserHit(shipId, laser)   (byte & 0x7f) >> 1
  npc-energy.ts playerLaserDamage(policy, hit) x multiplier, floor, - (maxEnergy & 7)
  npc.ts       takeLaserHit -> energyAfterDamage, isDestroyed at <= 0

NPC LASER -> COMMANDER
  gunnery.ts   npcWeaponByte(profileId) -> npcLaserStrength   laserPower << 2
  gunnery.ts   npcLaserDamageToPlayer(byte, shipId)           - perHitShieldArmour
  systems.ts   applyDamage: facing 255 shield, then the 255 bank, then dead

NPC LASER -> NPC
  npc-energy.ts npcCrossfireDamage(byte, policy)  the two source halves, composed

EVERYTHING ELSE (ram, canister, station wall, warhead, energy bomb)
  impact-damage.ts  fixed whole points, and OURS — see docs/DAMAGE-PATHS.md
```

The live paths are checked against the pack row by row and NOT through the
oracle: `test/elite-a-live-combat.test.ts` drives all 15,600 outgoing rows
through `gunnery.ts` / `npc-energy.ts` / `npc.ts` / `combat.ts`, and
`test/elite-a-live-defence.test.ts` drives all 3,900 incoming rows through
`gunnery.ts` / `systems.ts` / `combat.ts`. Neither calls `combat-math.ts` for a
number it is checking.

## The units

Two, both whole numbers on the released byte scale, both branded so one cannot
be spent as the other (`game/damage-units.ts`):

| unit | comes off | range |
| --- | --- | --- |
| `NpcEnergyPoints` | a ship's or object's released energy bank | 2 (the missile) to 255 |
| `PlayerPoolPoints` | the commander's 255-point facing shield, then the 255-point bank | 0-510 to strip both |

There is no third scale and no adapter between them. The retired normalized
"fraction of a Cobra" is gone from the project entirely, including from the
trainer, and `test/damage-paths.test.ts` asserts by name that none of the
bridges can come back.

## The save schema

| where | field | note |
| --- | --- | --- |
| `elite-web-commander:<slot>` | `shipId` | a `PlayerHullId`. Absent or unresolvable migrates to the Cobra Mk III |
| `elite-web-world:<slot>` → `npcs[]` | `designId`, `profileId` | optional in the JSON; absent means a legacy save and is re-derived |
| `NpcState` | `energy`, `regenCarry` | whole points, and the sub-second remainder in ticks |
| `ShipSystems` | `energy`, `foreShield`, `aftShield` | 0..255 each, whole numbers |
| `ShipSystems` | `energyCarry`, `foreShieldCarry`, `aftShieldCarry` | one recharge remainder per pool, in ticks |

`SNAPSHOT_VERSION` did not move for any of this: every added key is optional and
a reader that ignores unknown keys survives. The combat trainer's exported JSON
DID move, to `COMBAT_SIM_SCHEMA = 2`, because the damage figures in it changed
meaning.

## Exact, recreated, and ours

The three columns this phase has to keep separate. **Exact** means the pack
states it and the code reproduces it. **Clean recreation** means we stayed
inside the released model but made a decision the source did not force.
**Harmless policy** means the source is silent and the number is ours.

| area | exact Elite-A fact | clean-recreation choice | Harmless policy |
| --- | --- | --- | --- |
| player laser | `hit = (fittedLaserByte & 0x7f) >> 1`; the high bit is a continuous flag, not 64 points of power | — | cadence, heat, the hit cone and aim assist |
| NPC defence | `defence = maxEnergy & 7`, subtracted after the multiplier | — | — |
| the Constrictor | halves the player's hit BEFORE defence, and the half is floored | — | it is signposted in the mission text; the source did not tell you |
| stations | immune to player lasers | — | the rock hermit takes the station rule because it IS a station of ours |
| NPC laser | `laserPower << 2`, less the hull's `perHitShieldArmour` | the `clean` encoding is used; the released `weaponByte >> 1` (which lets missile bits add damage) stays reproducible and test-only | hit chance, cadence and range falloff |
| destruction | — | dead at `energy <= 0`; the released exact-zero survival quirk is deliberately dropped | — |
| regeneration | ordinary AI ships recover one point per elapsed second; stations, missiles, cargo and rocks recover none | — | the 3,600-tick integer clock, so 15, 60 and 144 Hz give the same total |
| player defence | fore 255, aft 255, bank 255 — the pack's own capacities | — | recharge rates, the spill order, the equipment-damage roll |
| geometry | all 38 hulls, exact vertices/edges/faces, and the targetable radius | polygons reconstructed from face adjacency; three faces wound by geometry where the stored normal could not | 1 world unit = 4 source units; stations 4x on top; asteroids generated rather than tabulated |
| NPC roster | which designs a blueprint slot admits, read off the 713-row table | — | which of those the roster actually flies, and the threat tiers |
| exact build | the 260 released variants, byte for byte | the recommended default resolves to a REAL variant with that tuple, ties broken by A-W order | a combat role flies the hardest build the source filed under its own job (`role-variants.ts`) |
| speed | each design's source `maxSpeed` | `sourceSpeedToWorld` = 400/42 world units per source unit | the hulls that predate the import keep the speeds they were tuned and trained at; every turn rate is ours |
| NPC vs NPC | — | composed from the two source rules that each half has | that composing them is the rule at all — the pack does not tabulate this direction |
| ram, canister, station wall, warhead, energy bomb | — | — | all of it: `impact-damage.ts`, and none of it may be quoted as an Elite-A fact |
| the generation ship and the rock hermit | — | — | both, and they carry `harmless:` ids so they cannot enter a parity matrix |

## Deliberately deferred

The phase's job was damage parity, not every Elite-A feature. These are known,
named, and the generated catalogue already carries the fields each will need —
none of them requires another data extraction or another combat rewrite.

1. **The shipyard.** Buying, selling and part-exchanging player ships. All 15
   flyable hulls resolve today and live combat already reads the commander's
   `shipId`; there is simply no UI that can change it.
2. **The Adder start.** Elite-A starts a fresh commander in an Adder. Harmless
   starts in the Cobra Mk III, which is what every existing save is flying and
   what the whole balance is measured against.
3. **Per-hull flight profiles.** The pack gives each flyable hull a speed, a
   pitch/roll range, a cargo capacity, a fuel range, a missile rack and a laser
   mount count. None of it is applied in live play: the player's flight model is
   four constants in `player.ts`, and every trained brain was fitted against
   them, so applying the table is a retrain as well as a feature.
4. **Per-mount laser equipment.** The pack gives every hull a mining-laser byte
   and `playerLaserHit()` answers for it, but Harmless has no fourth mount to
   select and every side mount is a pulse laser whatever is up front. The
   equipment redesign that makes a mount a real choice is its own change.
5. **S.A-S.W selection.** The released game picks a blueprint set by technology,
   government, random bits and galaxy number, and fills the set's own role slots.
   All 23 sets and all 713 slot assignments are imported; what runs today is a
   single deterministic recommended variant per design, plus a role-based
   override. Selecting by system is a swap of that policy and nothing else.
6. **Original AI, accuracy, collision physics and economy.** Explicitly out of
   scope. The supplied matrices describe what a registered hit is worth; they say
   nothing about whether a shot hits, and Harmless keeps its own answers.

## A future shipyard, when it arrives

Combat needs no new formula and no new data for this. The work is state, not
rules:

1. **Purchase sets `commander.shipId`** to another `PlayerHullId` — one field,
   already saved, already migrated, already the thing `playerHull()` resolves.
2. **Validate the loadout against the new hull** before committing: the pack
   states `maxMissiles`, `cargoHoldCapacity`, `laserMounts` and
   `hyperspaceRangeLightYears` per hull, so a rack or a hold that does not fit
   has to be refunded or refused at the counter rather than discovered in
   flight.
3. **Rebuild flight and capacity state** from the new hull —
   `maxSpeed`, `maxPitchRollRate` / `minPitchRollRate`, the hold, the fuel
   range. This is deferred item 3, and it is the real work: the trained brains
   were fitted against one target envelope, so a hull that flies differently
   changes the world they were trained in.
4. **Save atomically.** The commander blob and the world blob are two keys
   (`storage.ts`); a purchase that wrote one and not the other would leave a
   commander flying a hull her world does not agree about. Write the commander,
   then let the ordinary dock-time save handle the rest.

What does NOT change: `perHitShieldArmour` comes off the hull record, so incoming
laser damage re-resolves for free; the three 255-point pools are the same on
every hull the pack lists; and every outgoing laser number is
`playerLaserHit(shipId, laser)`, which already takes the id.

## What it costs

Measured 2026-08-02, at the close of the phase. Re-measure rather than cite.

| | before the phase | now |
| --- | --- | --- |
| `/play` shared chunk | 712.64 kB raw · 202.59 kB gzip | **936.47 kB raw · 228.51 kB gzip** |
| snapshot, a live flight with 6 NPCs | — | 9.7 kB, ~1.04 kB per NPC |
| world step, 8 NPCs, headless | — | 0.005 ms/frame (0.03% of a 60 Hz budget) |
| capture + `JSON.stringify` | — | 0.06 ms |

**The chunk grew by 224 kB raw and 26 kB gzip, and the generated catalogue is
all of it.** The six generated modules are 253 kB of source; minified they are
a 212 kB contiguous region of the built chunk — 22.7% of it. Gzip is kind to
them (they are repetitive object literals with identical keys 260 times over):
23.5 kB of the 26 kB gzip growth.

That is the price of the whole thing, and it is paid on the shared chunk
because the viewer draws all 38 designs too. Two ways to bring it down if it
ever matters: emit the arrays as parallel typed columns rather than 260 objects
with 13 named keys each, or split the slot table (68 kB, and nothing in live
play reads it after `ship-roles.ts` has built its bands at module load). Both
are importer changes, not model changes.

**Loading it is cheap.** Parsed and evaluated as plain JS the six modules cost
**3.0 ms** once, at module load. (Under node with `--experimental-strip-types`
the same import measures 26 ms, but most of that is type-stripping 253 kB of
TypeScript, which the browser never does.) A `recommendedNpcProfile()` lookup
is ~60 ns, and nothing in the step calls one per frame — an `NpcShip` resolves
its policy at construction.

## The gate

```sh
npm run elite-a     # under a second
```

It runs the hash-and-drift check, then the suites that own each claim — the
catalogue, the oracle, both live laser directions, the damage-path audit, the
banks, the identities, the roster, the selection policy and the geometry.
`test/elite-a.ts` maps each bullet of TODO 30's list to the file that asserts
it. It is in CI as its own named step, and it is deliberately NOT in
`npm run check`, which already runs every one of those assertions inside
`npm test`.
