# 54 — Import can write a save the shelf cannot read, and says it worked

**Kind:** save integrity · **Severity:** medium · **Size:** small
**Depends on:** none

## Why

Two defects in the import path, both found sweeping the review fixes
themselves, both demonstrated.

### 1. A record with the wrong version is accepted, written, and lost

`readSaveFile` (`src/game/screens/save-transfer.ts:57-71`) never checks `v`,
and `adoptSaveFile` (`:106-108`) spreads the parsed file — replacing `name`,
`career` and `kind`, but passing `v` and `savedAt` straight through.
`readSave` then rejects anything whose `v !== SAVE_RECORD_VERSION`
(`src/game/storage.ts:171`).

So a file from another record version is accepted, written, made the boot
pointer, and announced — and then does not exist:

```text
adoptSaveFile said: {"id":"save:file:BRIAN","name":"BRIAN"}
boot pointer:        save:file:BRIAN
readSave of it:      null
on the shelf?        false
bootSave() resolves: save:auto:JAMESON:dock
after "IMPORTED AS BRIAN" + reload we are flying: JAMESON day 300
```

The bytes stay in localStorage forever, unreadable and invisible to
`listSaves()`. `adoptSaveFile`'s own contract says it returns null "if the
file was not a save" — by the shelf's definition, this is not one.

Inert today (`SAVE_RECORD_VERSION` is 1 and there is one build). It is a trap
armed for the moment that constant moves, which is the only reason it exists.

### 2. The one `setBootId` call site TODO 44 missed

`src/game/screens/save-transfer.ts:111` calls `setBootId` bare. TODO 44
(`3da952d`) gave it a boolean precisely so a refused pointer is not reloaded
on as though it had landed, and fixed `saves.ts:182` and
`startNewCommander` — the importer was missed. With the pointer write refused
and the record write fine:

```text
told the player:  "IMPORTED AS BRIAN"
reloads:          1
boot pointer:     save:auto:JAMESON:dock
the reload lands on: JAMESON day 300
```

Same user-visible failure as the two that were fixed.

## Implementation

- Validate `v` where the file is parsed, not where it is read back. An import
  either becomes a record this build can read, or is refused out loud.
- Honour `setBootId`'s return, as the other two call sites now do.
- Consider whether `adoptSaveFile` should mint the record's fields rather than
  spreading the file — a spread passes through whatever the file carries, and
  `v` was not the only field that came along for the ride.

## Acceptance

- A file with an unknown version is refused with a message, and nothing is
  written.
- A refused boot pointer does not reload.
- Every record on the shelf is readable by `readSave` — a test writes one
  through the import path and reads it back.

## Verify

`npm run check`, plus the two reproductions above with an injected failure.
