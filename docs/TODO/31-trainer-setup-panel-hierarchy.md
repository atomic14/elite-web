# 31 — Give the setup panel a shape, and fence the career switch

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

The setup panel is thirteen rows in one undifferentiated list, and one of them
changes the game outside the simulator.

`LIVE BRAINS (CAREER)` sets what the whole galaxy flies and is saved with the
commander. It sits sixth, between `EXERCISE BRAIN` and `OPPOSITION`, styled
exactly like `YOUR MISSILES`. Its warning appears only AFTER it has been
changed, in the same orange as the ordinary contextual help two lines above, so
the one row with consequences outside the room reads as the quietest thing on
the panel.

The other twelve rows are three unrelated groups — which fight to run, who
flies what, and your loadout — presented as one flat column. Every row is the
same weight, so finding one means reading rather than scanning.

## Implementation

- Group the rows and label the groups: **THE FIGHT** (mode, fight, threat tier,
  seed), **WHO FLIES WHAT** (exercise brain, opposition, and the per-group
  rows), **YOUR SHIP** (the six `YOUR …` rows). Faint headings and one blank
  line, in the panel's existing idiom — not boxes.
- Move `LIVE BRAINS (CAREER)` out of the fight settings entirely, to its own
  fenced block at the foot of the panel, and mark it as leaving the room. Its
  note should be present whenever the row is not `AS SHIPPED`, and should read
  differently from the contextual help — this is a state the pilot can forget
  they are in.
- Reserve the note's space so the panel does not change height when it appears.
  Today every row shifts about 17px mid-interaction and the selected row moves
  under the cursor.
- The footer hint wraps mid-item (`· X` / `REMOVE ·`). Let it break between
  items.
- `L — LAST REPORT` is a button that appears once a report exists, but `L` is
  never named in the footer hint. Name it.

## Acceptance

- The three groups are visually distinct and the row order within them is
  unchanged, so muscle memory survives.
- `LIVE BRAINS (CAREER)` is outside the exercise settings and states, whenever
  it is set, that it applies to the career and is saved.
- Selecting rows top to bottom never changes the panel's height.
- `npm test`'s combat-trainer suites still pass. They find rows by LABEL rather
  than index (TODO 29 fixed that); keep it that way.
- The screen still owns its rendering, its keys and its state in one file,
  returns an outcome, and never touches the Game (docs/INVARIANTS.md invariant 13).

## Verify

`npm run check`, then open `T` at any station and walk every row with the
keyboard and with the mouse.
