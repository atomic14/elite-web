# 43 — Loading or importing a save eats a career's checkpoint

**Kind:** save integrity / data loss · **Severity:** critical · **Size:** medium
**Depends on:** none

## Why

Two reviewers found this independently, by different routes, and it destroys
player data with no confirmation and no way back.

**Which career a session's autosaves belong to has two homes:**

- `SaveRecord.career` — `src/game/save-file.ts:75`, read by
  `bootCareer()` at `src/game/storage.ts:357`.
- `WorldSnapshot.career` — `src/game/snapshot.ts:163`, written at
  `src/game/persistence.ts:125` and read back at
  **`src/game/persistence.ts:187`: `if (snap.career) s.career = snap.career;`**

The second overwrites the first, one step after boot. `state.career` is what
`writeDockSave` / `writeFlightSave` / `clearFlightSaves` address
(`persistence.ts:264-312`), so whatever the record decided is discarded.

### Symptom 1 — loading an old save

`SavesScreen.input` deliberately writes the current career's checkpoint before
leaving (`src/game/screens/saves.ts:168`), then `setBootId` + reload. Restore
ends at `enterMode(snap.mode)` (`persistence.ts:247`) → `game.ts:817`
`enterDocked(true)` → `Station.dock` pushes a checkpoint (`station.ts:200`) →
`writeDockSave` — **onto the same key the screen just protected.**

Demonstrated: a career at day 300 / 500,000 Cr, load a day-5 save, and the
day-300 state exists nowhere. One Enter, no confirmation.

### Symptom 2 — importing a file

`importSaveFile` goes to trouble to make the imported record's career unique
(`src/game/screens/save-transfer.ts:74-75`, `career: name`). `restore()` then
takes the career the file was EXPORTED under. Everyone's default career is
JAMESON, so a friend's export lands on your `save:auto:JAMESON:*` group.

Demonstrated: my career at day 300 / 500,000 Cr, import a stranger's file, and
my checkpoint is their commander at day 0.

`bootCareer`'s own docstring (`storage.ts:352-358`) promises exactly what is
being violated: *"so starting a fresh commander can never adopt an old one's
autosave group and evict its docked checkpoint."*

## Implementation

- **One home for career identity.** Decide whether the record or the snapshot
  owns it and make the other read it. The record is the likelier owner — it is
  what the shelf is keyed by — but a snapshot restored into a fresh session
  needs an answer too, so state the rule and make the losing side derive.
- Loading a save must not let the boot-time dock write land on the career you
  just left. Work out whether the protective write, the boot checkpoint, or
  both are wrong.
- `src/game/screens/save-transfer.ts` has **zero test coverage**
  (`grep -rn "importSaveFile\|save-transfer" test/` returns nothing). That is
  how this shipped.

## Acceptance

- Loading a named save leaves every other career's checkpoint byte-identical.
- Importing a file cannot write to any career that existed before the import,
  whatever the file claims.
- A test drives the real `Game` through load-a-save and through import, and
  asserts the other careers' autosave keys are untouched.
- `career` has one home, and a test fails if a second appears.

## Verify

`npm run check`, plus the two reproductions above driven through the real
`Game` in the harness namespace.
