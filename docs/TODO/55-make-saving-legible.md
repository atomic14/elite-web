# 55 — Make saving and loading legible

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** 43, 45, 54

## Why

Chris, 2026-08-03: *"Let's make sure the ui and what happens is easy for a
user to understand."*

The save model is now correct — a career owns its autosaves, a named save is
an archive, the checkpoint is where you are — but none of that is visible, and
one consequence is genuinely surprising:

```text
career at day 300  →  load a day-5 named save  →  checkpoint still day 300 ✔
press S to look at your saves               →  checkpoint becomes day 5   ✘
```

By the checkpoint's own definition that is correct: you *are* at day 5 now.
But it means **loading an old save discards your current run unless you named
it first**, and the write that does it is triggered by *looking at the save
list* — `SavesScreen.open()` calls `ctx.checkpoint()`
(`src/game/screens/saves.ts:130`).

Nothing about that is guessable from the screen. A player finds out by losing
a run.

## The rule to make true and visible

**Opening a screen must never destroy anything.** Looking is not an action.
Whatever the list needs in order to show your current position, it must get
without writing to the shelf.

**Loading over an unnamed run must say so.** If the career's current state is
not stored under any name, loading is destructive and the player should be
told once, plainly, before it happens — not warned in general, but told what
specifically is about to be lost.

**The list should say what each row is and what will happen to it.** A player
should be able to answer, without reading a doc: which one am I flying, which
one is automatic, which one did I make, which one gets overwritten next, and
what does Enter do to the run I am in.

## What to work out

- Why `open()` checkpoints at all, and what the list actually needs. If it
  wants to show the live commander rather than the stored one, it can read
  state without writing it.
- The wording. This is the part that matters most and it is not a code
  problem: the panel already carries good sentences (TODO 31's fence is the
  model — it says what leaves the room and what does not). Aim for that
  register. No jargon: not "career", not "checkpoint", not "record", unless
  the screen teaches the word in the same breath.
- Whether the docked checkpoint should be visibly distinct from the in-flight
  ring in the list, since the docked one is the guarantee a player relies on
  after dying.
- Whether saving should be offered at the moment it is most wanted — after a
  good run, before a risky jump — rather than only on demand.

## Explicitly NOT in scope

The old numbered-slot scheme. It is deleted (TODO 53) and nothing here should
accommodate it or mention it.

## Acceptance

- No screen writes to the shelf as a side effect of being opened, and a test
  asserts it for the saves screen specifically.
- Loading a save when the current run is not stored under a name tells the
  player what will be lost, and lets them back out.
- A reader who has never seen the code can look at the list and say what each
  row is and what Enter will do.
- The words on the screen match what the code does — checked against the
  behaviour, not against the previous wording.

## Verify

`npm run check`, then read the screen cold: open the commander file, load an
old save over a live run, die, and come back — and at each point ask whether
the screen told you what was about to happen.
