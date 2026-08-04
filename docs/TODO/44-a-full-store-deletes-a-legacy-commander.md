# 44 — A full store deletes a pre-slots commander

**Kind:** save integrity / data loss · **Severity:** critical · **Size:** small
**Depends on:** none

## Why

`src/game/storage.ts:431-434`:

```ts
if (bare) {
  if (!readItem(legacyCommanderKey(1))) writeItem(legacyCommanderKey(1), bare);
  dropItem(LEGACY_BARE());        // unconditional
}
```

`writeItem` swallows a quota throw and returns `false` (`storage.ts:111-123`).
`dropItem` then succeeds. So on a full store the commander is read, not
written, and deleted.

Demonstrated with one `elite-web-commander` key and `setItem` throwing:

```text
bare key still there?  false
slot-1 key written?    false
any save on the shelf? 0
keys now: []
```

**This is a regression.** `git show 2b97a5c^:src/game/storage.ts`
(`migrateLegacySave`) let the throw propagate, which skipped the delete. The
new swallowing write turned a safe failure into data loss.

It also contradicts docs/INVARIANTS.md invariant 3, which states that a crash, a
refused write or a full store "leaves them exactly where they were and the
next boot tries again".

Reach is narrow — it needs a pre-slots save AND a full store — but the loss is
total and unrecoverable. Everything downstream of it (`migrateOneSlot`, the
four numbered slots) is correctly write-then-verify-then-delete; this is the
one path that is not.

## Implementation

- Delete only after a verified read-back, the way `migrateOneSlot` already
  does. The pattern exists in the same file — use it.
- Consider whether `writeItem` returning `false` should ever be ignorable.
  Every caller that deletes something on the strength of a write must check.

## Acceptance

- A refused write leaves the legacy key exactly where it was, and the next
  boot migrates it.
- A test drives migration with a `localStorage` whose `setItem` throws, and
  asserts nothing was deleted.
- No caller deletes on the strength of an unchecked `writeItem`.

## Verify

`npm run check` plus the quota-failure test above. `test/saves.test.ts`
already has the fixture idiom.
