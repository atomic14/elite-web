# 41 — Name the opposition, not the file

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** 31, 32

## Why

Chris, looking at the panel: *"I have no idea what the options in the exercise
brain mean."*

He is right, and TODO 32 did not fix it — it explained it. The row still reads

```
EXERCISE BRAIN            1/12 AS THE GAME FLIES
```

and the eleven other values are filenames: `pirate-attack-g3`,
`pirate-pack-r4-selectonly`, `jameson-defend-t29`. Selecting the row prints a
sentence underneath, so the information exists, but the thing you are choosing
between is still a list of build artefacts. A sentence under a row cannot fix a
row whose values are filenames.

Three separate failures:

- **The label names our concept, not the player's.** A "brain" is what we call
  a trained policy. What the row DOES is decide which AI the opposition flies,
  for this fight only — and nothing on the panel says that, or how it differs
  from the fenced `LIVE BRAINS (CAREER)` row directly below it.
- **The values are identifiers.** `pirate-attack-g3` is a filename. It cannot
  be read, compared, or remembered.
- **The help is written for someone who already knows.** "NO OVERRIDE — EVERY
  SHIP FLIES WHAT THE LIVE GAME WOULD GIVE IT, BY ITS ROLE AND ITS TIER"
  presupposes you know there is an override, and "role" and "tier" are our
  vocabulary.

## Implementation

- **Rename the row** to say what it decides. The group is already called WHO
  FLIES WHAT; the row should finish that sentence in a player's words.
- **Give every option a short human name** that says how it FLIES, carried as
  the row's value. The character lines from TODO 32 already contain the
  material — a name is that sentence compressed to two or three words. The
  filename becomes secondary: keep it visible for anyone cross-referencing
  `docs/TRAINING-LOG.md`, but it must not be the thing you read first.
- **Say the two rows apart, on the panel.** One changes this exercise, the
  other changes the career. The fence says the second half already; the first
  half is unsaid.
- **Rewrite the default's help line** in plain English, with no "override", no
  "role" and no "tier".
- Where a name would have to be invented rather than compressed from a
  measured character line, say so rather than inventing one.

The naming lives where naming lives — `game/brain-names.ts` — beside the
character lines, so a brain cannot have one and not the other.

## Acceptance

- A reader who has never seen the training log can tell the options apart and
  say roughly what each will do to the fight.
- No row's primary value is a filename.
- The panel states what the exercise row changes and how that differs from the
  career row.
- A test asserts every option a picker offers has a name AND a character line,
  so adding a brain without both fails the build.
- The existing tests that find rows by label still pass, updated to the new
  labels rather than loosened.

## Verify

`npm run check`, then `T` at a station: read the panel cold and see whether the
choice makes sense without opening a doc.
