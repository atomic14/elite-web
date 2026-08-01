# 21 — Vendor and generate the Elite-A reference catalogue

**Kind:** data provenance / generated source · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

The authoritative pack currently lives in `Downloads`, outside the repository.
Later work must not depend on that path, hand-copy 260 variants, or bundle the
multi-megabyte analysis files into the browser. We need one reproducible import
step and one compact runtime catalogue.

## Implementation

1. Copy the complete pack verbatim into `reference/elite-a/source/`. This is
   reference input only; no runtime module may import it.
2. Add a manifest containing the source filenames, byte sizes and SHA-256
   hashes. The current hashes are:

   ```text
   0b2a198bd525b8244bf45b5f2000f7fc234dbe5bf73ce38c647fb75d214b3105  EliteACombatModel.swift
   d667f3677bfddd07034c719845a2c3c2712ce50bfc6f75762db5587b6a2a4046  README.txt
   57f5ea6c110e3feab91ef25b341c5c3f571b8ca31b518c2cefaaa05cddcd96f8  elite_a_combat_reference.md
   bc69c28bf5e09f166346a8aea88df335e746e566ceeeb556ce4baccb1cb257de  elite_a_complete_ship_data.json
   3e3c394967ce3700580a67444a1423b16a380bab963b3a3d8776c82961b31e5b  elite_a_hit_ranges.json
   86e88ab405eceecd765e8c60cfbf27a02d25eb29b0cd0bc586ef517f1aab9482  elite_a_hit_ranges.md
   53e603ea2a031d5b70788c03b22f1c0c208504b59037f511f13ad22890037e68  elite_a_hits_to_destroy.json
   4b53dce5218dd43b84471c0e53ebeebab8ed91e7f57a213e9235a383705346fe  elite_a_npc_damage_to_player.json
   abfd6cf6e8e55f79753066f15be8860e9e9f1a139660c4cf15572d53dbdbf47c  elite_a_npc_ship_summary.json
   a9e3dc3e12425ee915a78917b7bab62c7eff1eddd82c47f4232708ac57e74021  elite_a_player_ships.json
   ```

3. Add `tools/import-elite-a.mjs`. It reads the vendored source and emits a
   deterministic, compact generated catalogue under `src/game/elite-a/` plus
   compact oracle fixtures under `test/fixtures/elite-a/`.
4. The runtime output must retain all behavior-driving fields: player hull
   values; design ids/names; unique geometry; exact variant headers; set and
   slot identity; NEWB flags; recommended defaults; and station/Constrictor
   special classification. Deduplicate geometry by design rather than copying
   it into every variant.
5. The test fixtures must retain the 15,600 hits-to-destroy rows, 3,900
   NPC-to-player rows and 570 range summaries in a compact form suitable for
   exhaustive tests. They must not be imported by production modules.
6. Generate `recommendedNpcProfile(designId)` by finding an exact variant whose
   combat tuple matches the supplied recommended default. When multiple
   variants match, choose the first in A-W source order; never synthesize an
   averaged profile.
7. Add `npm run generate:elite-a` and a non-writing `--check` mode suitable for
   CI. Generated files start with a source hash and “do not edit” notice.

## Acceptance

- The importer asserts 15 player hulls, 38 designs, 23 sets, 260 exact
  variants, 713 slot rows, 398 populated slots, 15,600 outgoing-hit rows,
  3,900 incoming-hit rows and 570 range rows.
- It asserts one unique geometry per design and validates every edge/face
  index before emitting code.
- It asserts every recommended default resolves to at least one exact variant.
- Re-running the importer is byte-identical and `--check` fails on drift.
- Production build output does not contain the source JSON or oracle matrices.
- No table from the pack is manually retyped into a gameplay module.

## Verify

Run the importer twice, its `--check` mode, focused catalogue tests, then the
standard project verification commands from the overview.
