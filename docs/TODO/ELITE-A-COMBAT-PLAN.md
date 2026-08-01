# Elite-A damage and ship-catalogue alignment plan

## Goal

Make Harmless's registered-hit damage calculations agree with the supplied
released Elite-A analysis, replace approximate or missing ship geometry with
the complete source catalogue, and establish stable ship identities that a
later shipyard can use.

Damage parity is the main deliverable. This phase is not an attempt to ship
every Elite-A feature.

## Source of truth

The local analysis pack at
`/Users/chrisgreening/Downloads/elite_a_combat_pack` contains:

- 15 flyable player hull profiles;
- 38 NPC/object designs and their exact geometry;
- 23 released S.A-S.W blueprint sets and 260 exact variants, including the
  common missile;
- 713 slot assignments, of which 398 are populated;
- 15,600 player-to-NPC hit rows;
- 3,900 NPC-to-player hit rows; and
- 570 summarized hit-range rows.

TODO 21 vendors the pack, records hashes and generates compact runtime data.
No later task may read from `Downloads` or transcribe a source table by hand.

The annotated source confirms that Elite-A starts with an Adder, offers 15
flyable ships, and selects ship blueprint files using technology, government,
random bits and galaxy number. Those are useful future constraints, but this
phase does not implement the shipyard or blueprint-file selector:

- [Buying and flying ships in Elite-A](https://elite.bbcelite.com/deep_dives/elite-a_buying_and_flying_ships.html)
- [Ship blueprints in Elite-A](https://elite.bbcelite.com/deep_dives/elite-a_ship_blueprints.html)

## In scope

- A deterministic source-data import and permanent provenance manifest.
- Pure TypeScript combat arithmetic exhaustively checked against every
  supplied matrix row.
- Stable IDs for all 15 player hulls, all 38 designs and all exact NPC
  variants.
- A saved player `shipId`; missing legacy values migrate to Cobra Mk III.
- Exact geometry, face/edge data and target radii for all 38 designs.
- The ten currently missing named ship designs: Cobra Mk I, Dragon, Monitor,
  Ophidian, Ghavial, Bushmaster, Rattler, Iguana, Shuttle Mk II and Chameleon.
- Source-backed combat profiles for the current and expanded NPC roster.
- Exact player-laser versus NPC energy/defence calculations.
- Exact clean NPC-laser versus player armour calculations.
- 255-point player fore shield, aft shield and energy banks.
- Elapsed-time NPC regeneration and a complete audit of secondary damage.
- Simulator, trainer, save, report and campaign rebaselining.

## Explicitly deferred

- Buying, selling or part-exchanging player ships.
- Switching fresh careers from Cobra Mk III to Adder.
- Applying every player hull's speed, turn, cargo, fuel, rack and equipment
  restrictions in live play.
- A per-mount laser equipment redesign.
- Selecting S.A-S.W by system and spawning exact per-set role slots.
- Recreating original AI timing, accuracy, collision physics or economy.

The generated catalogue must retain the fields needed by those future
features. Deferring their behavior must not require another data extraction or
another combat rewrite.

## Fidelity contract

- Player laser base hit:

  ```text
  hit = (fittedLaserByte & 0x7f) >> 1
  ```

- NPC defence is `maxEnergy & 7`; damage is `max(0, hit - defence)`.
- The Constrictor halves player laser hit strength before defence.
- Stations are immune to player lasers.
- Clean NPC laser hit before player armour is `laserPower << 2`.
- The released diagnostic `weaponByte >> 1` remains testable but never drives
  gameplay; missile bits must not increase laser damage.
- Player hull `perHitShieldArmour` subtracts once from each NPC laser hit.
- Player fore shield, aft shield and energy capacities are each 255.
- Destroy at `currentEnergy <= 0`; do not recreate the exact-zero survival
  quirk.
- Ordinary AI ships regenerate one energy point per elapsed second initially.
  Stations, missiles, cargo and rocks do not regenerate.
- Keep Harmless firing cadence, heat, hit cone, aim assist and seeded encounter
  counts. The supplied matrices describe damage after a hit registers.
- For current spawning, resolve the pack's recommended per-design default to
  an actual exact variant with the same combat tuple, breaking multiple matches
  by A-W source order. A later feature may select a different exact variant by
  system; combat must not care which selection policy supplied it.
- Non-laser damage remains an explicit Harmless policy where the source is
  silent. Every conversion must be named, centralized and tested.

## Future-ready identity rules

- Save IDs, never expanded generated records or geometry object references.
- `PlayerHullId` addresses all 15 flyable profiles. Live combat resolves laser
  and armour through the saved ID even though the UI cannot change it yet.
- `ShipDesignId` addresses shared geometry.
- `NpcCombatProfileId` addresses an exact `{ blueprintSet, designId }` variant.
  A generated `recommendedNpcProfile(designId)` lookup chooses the current
  roster's deterministic exact variant; it must not manufacture average stats.
- Keep selection policy outside combat. A future shipyard changes player
  identity; a future blueprint loader changes NPC profile identity.
- Legacy player saves default to Cobra Mk III. Legacy NPC snapshots map their
  current hull/role/seed to the deterministic recommended profile once.

## Ordered delivery

| TODO | Deliverable | Depends on |
| --- | --- | --- |
| 21 | vendored pack, deterministic importer and generated catalogue | none |
| 22 | pure combat arithmetic and exhaustive oracle tests | 21 |
| 23 | stable player/design/NPC profile identities and save migrations | 21 |
| 24 | exact 38-design geometry and target radii | 21, 23 |
| 25 | complete source-backed runtime roster, including missing ships | 23, 24 |
| 26 | player lasers, NPC energy/defence and regeneration | 22, 23, 25 |
| 27 | player 255-point defence and clean NPC laser damage | 22, 23, 25, 26 |
| 28 | secondary-damage unit audit and NPC-vs-NPC parity | 26, 27 |
| 29 | simulator, trainer, campaign and balance rebaseline | 25, 28 |
| 30 | permanent parity gate, final docs and browser acceptance | all prior |

Each TODO is one reviewable commit. TODOs 26 and 27 deliberately split the two
live laser directions so each exhaustive matrix provides a clear review gate.
Do not tune balance until TODO 28 has removed mixed units.

## Model allocation

The agreed default is to use the lighter implementation model for one bounded
TODO at a time. Each task file therefore specifies inputs, invariants, tests
and a completion gate. Use the stronger model for:

- changes to this dependency plan or fidelity contract;
- importer/schema review;
- save migrations and mixed-unit boundary review;
- diagnosis when an oracle row disagrees; and
- the final TODO 30 parity and architecture audit.

A lighter-model implementation is not accepted on plausible-looking output:
the same deterministic gates apply regardless of which model writes it.

## Rules for every implementation item

- Generated files are read-only. Change the importer or canonical input,
  regenerate and review the diff.
- Core data, selectors and combat maths remain browser-free.
- A random choice that affects a future frame is saved state; restore must not
  silently choose a new combat profile.
- Keep AI health observations normalized at their boundary while runtime
  combat stores source-scale values.
- Retain the custom Harmless generation ship and hermit station as explicit
  overlays; do not mislabel them as recovered Elite-A designs.
- Run focused tests while working, then `npm run lint`, `npm test`,
  `npm run build`, `npm run campaign`, `npm run portability` and
  `git diff --check` before closing an item.

## Definition of complete

This phase is complete when:

- every supplied combat-oracle row is reproduced by the pure rules;
- all live laser damage flows call those rules with a stable source-backed
  combat profile;
- every source design renders with exact geometry and target radius;
- the missing ships are available through the existing roster system;
- player/NPC saves and deterministic replays preserve identity and health;
- secondary damage contains no accidental normalized/source-unit mixing;
- trainers and reports use the same runtime model; and
- one permanent command proves the catalogue, geometry and damage model have
  not drifted.
