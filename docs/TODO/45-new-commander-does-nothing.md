# 45 — "NEW COMMANDER" does nothing

**Kind:** save model / UI · **Severity:** high · **Size:** small
**Depends on:** 43

## Why

`startNewCommander()` (`src/game/screens/saves.ts:96-99`) clears the boot
pointer and reloads. `bootSave()` then falls through to *"the newest record on
the shelf"* (`src/game/storage.ts:333-335`) — which is the career you just
asked to set aside, career name and all, so its autosaves keep landing on the
same keys.

Demonstrated:

```text
career: JAMESON credits 999999
after clearBootId, boot pointer key present? false
--- after "NEW COMMANDER" + reload ---
commander: CHRIS credits 999999 kills 42 career JAMESON mode docked
```

Nothing is lost, but the confirm panel promising to "start again at Lave with
100.0 Cr" (`src/ui/screens.ts:184-205`) is a lie, and it is the ONLY way to
create a second career from the UI — import is the other, and TODO 43 shows
that one is broken too. So the multi-career save model the new scheme was
built for is currently unreachable.

## Implementation

- Clearing the boot pointer is not enough; decide what "start a new commander"
  actually means now that a shelf exists, and make the code do it.
- It must produce a career name nothing on the shelf is using —
  `freshCareerName()` already exists (`storage.ts:361`) and is what
  `bootCareer` uses when there is no boot record.
- The existing career and its saves must survive untouched; this is a "put
  that one down", not a delete.

## Acceptance

- After NEW COMMANDER, the commander is a fresh one at Lave with 100.0 Cr, on
  a career name no existing save uses.
- The previous career's named saves and autosaves are byte-identical
  afterwards.
- A test drives it through the real `Game` and asserts both halves.

## Verify

`npm run check`, then in a browser: fly a career, NEW COMMANDER, confirm you
get a fresh one, and confirm the old one is still on the shelf and loadable.
