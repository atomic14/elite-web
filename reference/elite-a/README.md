# Elite-A reference pack

`source/` is the released-Elite-A analysis pack, vendored **verbatim**. It is
input to a build step and nothing else:

- **No runtime module imports it.** `src/` never reads this directory, and
  nothing here reaches the browser bundle — `test/elite-a-catalogue.test.ts`
  asserts both.
- **Nobody edits it.** If the pack is ever revised, replace the files, update
  the pinned hashes in `tools/import-elite-a.mjs`, regenerate and review the
  diff.
- **Nobody retypes it.** Every gameplay number that comes from this pack
  arrives through the generated catalogue, never by hand.

## Regenerating

```sh
npm run generate:elite-a           # rewrite the generated catalogue and fixtures
npm run generate:elite-a -- --check   # non-writing drift check, for CI
```

The importer verifies each file's SHA-256 against a pinned list before it reads
anything, then writes:

- `src/game/elite-a/*.generated.ts` — the compact runtime catalogue.
- `test/fixtures/elite-a/*.json` — the exhaustive combat oracles.
- `manifest.json` beside this file — filenames, byte sizes and hashes.

## What is in the pack

| File | What it holds |
| --- | --- |
| `elite_a_complete_ship_data.json` | 15 player hulls, 38 designs, 23 blueprint sets, 260 exact variants, 713 slot rows, decoded 20-byte headers and explicit vertex/edge/face arrays |
| `elite_a_player_ships.json` | the 15 flyable hulls on their own |
| `elite_a_npc_ship_summary.json` | per-design ranges, allowed slots and the recommended per-design default |
| `elite_a_hits_to_destroy.json` | 15,600 player-laser-to-NPC rows |
| `elite_a_npc_damage_to_player.json` | 3,900 NPC-laser-to-player rows |
| `elite_a_hit_ranges.json` / `.md` | 570 summarised hit-range rows |
| `elite_a_combat_reference.md` | the prose reference and the clean combat rules |
| `EliteACombatModel.swift` | a reference 60-fps-safe combat model |
| `README.txt` | the pack's own counts |

Primary upstream source: <https://elite.bbcelite.com/deep_dives/elite-a_ship_blueprints.html>
and the annotated released Elite-A source files S.A–S.W.

This is a fan-project reference for a non-commercial homage. "Elite" is used
here only to say what the data describes.
