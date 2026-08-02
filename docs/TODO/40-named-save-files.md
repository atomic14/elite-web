# 40 — Named save files, and an autosave that cannot eat one

**Kind:** save model / UI · **Severity:** high · **Size:** large
**Depends on:** none

## Why

Saves are four numbered slots. A player picks a number and has to remember
what is in it, the list shows the commander's name only after you have read
it, and every write — deliberate or automatic — goes to the same place. So
the autosave and the save you meant to keep are the same key, and losing the
one to the other takes twenty seconds of a tab left running.

That is not hypothetical. During this session an agent switched the slot
pointer while a game was still running; the next autosave wrote the scratch
commander over the real one in slot 1, and there was nothing to restore from.
CLAUDE.md's harness rule ("never write save slots 1-3, harnesses run in slot
4") exists because the current model makes that mistake easy — the rule is a
warning sign in front of a hole, and this item is about filling the hole.

Chris's proposal: name a save after the commander, let the player choose a
different name when they save, and give the autosave its own name.

## This changes a stated invariant

CLAUDE.md invariant 3 says the `elite-web-*` keys are NEVER renamed, because
they are where every existing player's commander lives. That rule is right
about the risk and this item does not get to wave it away: the deliverable is
a new scheme PLUS a migration that cannot lose a save, and the invariant is
rewritten to describe the new scheme and the same protection. If the migration
cannot be made safe, the answer is to keep the keys and do nothing else here.

`storage.ts` remains the only file that may touch localStorage.

## The design question to settle first

**Names collide, so a name cannot be the identity.** Every commander starts as
JAMESON — that is the joke and the homage — so "save named after the
commander" gives every player several files called JAMESON on day one.
Renaming a save should also not move a key, or a rename becomes a copy plus a
delete with a window in the middle where a crash loses both.

So the strong candidate is: **a stable generated id in the key, and the
display name inside the record.** Names then become free-form, duplicates are
legal, renaming is a field write, and the key scheme never has to change
again. Weigh that against name-in-key (simpler to read in devtools, and one
fewer indirection) and record the decision with its reason.

## What to work out

- **The key scheme.** Ids, and how a save is enumerated for the list. If the
  list comes from scanning the `elite-web-*` prefix, say so and own the cost;
  if there is an index record, say what happens when it disagrees with the
  saves that actually exist. The disagreement case is the one that bites.
- **Autosave.** One reserved autosave per commander, or one globally? Per
  commander is the answer if a player can hold several careers at once — a
  single global autosave silently belongs to whoever flew last. Either way an
  autosave must never overwrite a named save, and a named save must never be
  written by anything the player did not ask for.
- **What "restore from autosave" looks like** to a player who has just died or
  reloaded. That is the case the whole feature exists for.
- **Capacity.** A snapshot measured at TODO 30 is about 9.7 kB and localStorage
  is a few megabytes, so hundreds of saves fit. Decide whether saves are
  capped, and if so what the list does when full — silently dropping the
  oldest is the wrong answer.
- **The reserved harness save.** CLAUDE.md's slot-4 rule becomes a reserved
  name that cannot be confused with a player's. Make it structurally
  impossible for a harness to write a player's save, rather than a rule
  somebody has to remember. This is the part with direct evidence behind it.
- **Export and import.** `X EXPORT` / `Z IMPORT` already exist and predate
  this; an exported file should carry its name, and an import should not be
  able to silently land on top of an existing save.
- **The screen.** `screens/saves.ts` owns the list and already pushes a name
  entry screen. It stays behind the Screen contract (invariant 13), keeps one
  input surface, and the name entry it already has is the obvious place for
  choosing a name on save.

## Migration

- Every existing slot 1-4 becomes a named save, keeping its commander and its
  world. The name comes from the commander, disambiguated when they collide —
  and they will, because they are all JAMESON.
- A player who has never seen this build must lose nothing, including the
  world snapshot mid-flight.
- Migration runs once and is idempotent: running it twice must not duplicate a
  save, and a half-migrated store (a crash mid-write) must be recoverable.
- Decide whether the old keys are deleted or left in place as a fallback, and
  say why. Leaving them is cheap insurance; leaving them forever is a second
  home for the same data.

## Acceptance

- A save has a name the player chose, or the commander's name by default.
- Two saves may share a name without either being lost.
- Renaming a save does not move or copy its data.
- The autosave has its own identity and can never overwrite a named save.
- Every pre-existing slot survives the migration with its commander AND its
  world; a test loads a fixture of the old shape and proves it.
- Migration is idempotent, and a half-written store recovers.
- A harness cannot write a player's save by mistake — structurally, not by
  convention.
- `storage.ts` is still the only file that touches localStorage, and
  CLAUDE.md invariant 3 is rewritten to describe the new scheme.

## Verify

`npm run check`, plus: a fixture test for the old key shape, an idempotency
test, a crash-midway test, and a browser pass that creates several saves with
the same name, renames one, dies, and restores from the autosave.
