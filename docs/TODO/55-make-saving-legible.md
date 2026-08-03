# 55 — Make saving and loading legible

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** 43, 45, 54

## Why

Chris, 2026-08-03: *"Let's make sure the ui and what happens is easy for a
user to understand."*

The save model is now correct — a career owns its autosaves, a named save is
an archive, the checkpoint is where you are. None of that is legible from the
screen. This is a review of the whole flow, read cold from the live game.

## What the screen says today

```text
COMMANDER FILE
NAME       KIND      WHEN        WHERE           CASH      RATING    DAY
JAMESON 2  SAVED     13 HR AGO   LAVE · DOCKED   100.0 Cr  HARMLESS  DAY 0
▶JAMESON   SAVED     13 HR AGO   LAVE · DOCKED   100.0 Cr  HARMLESS  DAY 0
▶JAMESON   STATION ● JUST NOW    LAVE · DOCKED   100.0 Cr  HARMLESS  DAY 0

  S — SAVE   ENTER — LOAD   D — DELETE   R — RENAME COMMANDER   ESC — DONE

▶ IS THE CAREER YOU ARE FLYING · ● IS THE STATION YOU CAN ALWAYS GET BACK TO ·
AUTOSAVES CANNOT OVERWRITE A SAVE YOU NAMED
```

## The findings

1. **`▶` marks a career, but reads as "this one".** It is on two rows. A
   player will take a single-headed arrow to mean the current item; here it
   means "belongs to the run you are in", which is a different and less
   obvious idea. Nothing marks *the row you are actually flying right now*.

2. **Two rows are called JAMESON and a third is JAMESON 2.** The 2 is a
   different **career**, but it reads as a second save of the same commander.
   The screen's most important distinction — separate runs — is carried by a
   suffix that looks like a version number.

3. **`KIND` mixes registers and hides the important word.** `SAVED` is
   something you did; `STATION` is a place. Neither says **automatic**, which
   is the only thing a player needs from that column: *did I make this, or did
   the game?*

4. **The legend does the `KIND` column's job.** `●` needs a footnote because
   `STATION` does not say what it is. Two mechanisms explaining one fact.

5. **The legend reassures about the wrong thing.** "Autosaves cannot overwrite
   a save you named" answers a worry nobody has. The worry they *should* have
   — **loading discards the run you are in unless you named it** — is not on
   the screen at all.

6. **`ENTER — LOAD` does not say what it costs.** This is the sharp one. Load
   an old save over a live unnamed run and that run is gone; the checkpoint
   follows you to where you loaded to. Correct by the model, invisible on the
   screen.

7. **`R — RENAME COMMANDER` is about a different noun.** Every other control
   acts on a save; this one acts on the pilot. Sitting in the row it does, it
   reads as "rename this save".

8. **In-flight autosaves are invisible while docked**, which is exactly where
   you stand when you want them — after dying and coming back.

9. **Getting to the prompt is `S` then `S`.** The first opens the file, the
   second saves. Defensible, but the station menu calls `S` "COMMANDER FILE"
   and the panel calls it "SAVE", so the same key is two different promises
   one keystroke apart.

**What is already good and should not be lost:** the SAVE COMMANDER prompt.
It pre-fills the commander's name, states the overwrite rule in one line
(*"a name that already exists replaces it — it asks first"*), and names the
keys. That is the register the rest of the flow should match.

## The rules to make true and visible

- **Opening a screen must never destroy anything.** `SavesScreen.open()`
  currently calls `ctx.checkpoint()` (`src/game/screens/saves.ts`), so
  *looking at your saves* moves your checkpoint. Whatever the list needs in
  order to show your current position, it must get without writing.
- **Loading over an unnamed run must say what will be lost**, once, plainly,
  before it happens — naming the run, not warning in general.
- **The list must answer, without a legend:** which row am I in right now,
  which did I make, which did the game make, which run does each belong to.
- No jargon unless the screen teaches it in the same breath. Not "career",
  not "checkpoint", not "record".

## Explicitly NOT in scope

The old numbered-slot scheme. It is deleted (TODO 53); nothing here should
accommodate or mention it.

## Acceptance

- No screen writes to the shelf as a side effect of being opened, and a test
  asserts it for the saves screen.
- Loading when the current run is not stored under a name says what will be
  lost and can be backed out of.
- A reader who has never seen the code can look at the list and say what each
  row is and what ENTER will do.
- The words on the screen match what the code does, checked against the
  behaviour rather than the previous wording.

## Verify

`npm run check`, then read it cold: open the file, save, load an old save over
a live run, die, come back — and at each point ask whether the screen told you
what was about to happen.
