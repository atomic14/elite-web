# 53 — Delete the legacy save migration

**Kind:** simplification · **Severity:** medium · **Size:** small
**Depends on:** 43, 44

## Why

Chris, 2026-08-03: *"We don't need to worry about migrating any data. We're
the only ones playing right now."*

The named-save scheme (TODO 40) kept a careful migration from the four
numbered slots, and TODO 44 hardened it further. All of it exists to serve
players who do not exist. It is code, tests and an invariant clause carrying
a risk — TODO 44 was a live data-loss bug *inside the migration itself* — for
no benefit.

What goes:

- `migrateLegacySaves()`, `migrateOneSlot()`, `recordFromSlot()` and the
  legacy key builders in `src/game/storage.ts` (`legacyCommanderKey`,
  the `elite-web-world:<slot>` and `elite-web-slot` readers, `LEGACY_BARE`).
- `SaveRecord.from` if nothing else reads it — it exists to make a re-run of
  the migration idempotent.
- The migration fixtures and cases in `test/saves.test.ts`.
- The migration half of docs/INVARIANTS.md invariant 3, which should end up describing
  the scheme that exists rather than the one it replaced.

## Watch out for

- **The old keys are still on Chris's machine.** Deleting the migration
  without deleting them leaves dead `elite-web-commander:*` entries in
  localStorage forever. Decide whether to leave them (harmless, invisible) or
  clear them once — and if you clear them, that is itself a destructive write,
  so it belongs behind the same care as everything else here.
- `bootSave()`'s fallback and the boot pointer must still behave when the
  shelf is empty — that is the fresh-install path, which is not migration and
  must stay.
- TODO 44's write-then-verify-then-delete pattern is correct in general and
  should survive wherever a delete still follows a write.

## Acceptance

- No code path reads a numbered-slot key.
- A store containing only old keys boots as a fresh commander rather than
  crashing or half-loading.
- `npm test` still passes with the migration tests removed rather than
  skipped.
- Invariant 3 describes the current scheme only.

## Verify

`npm run check`, plus booting against a store that holds only legacy keys.
