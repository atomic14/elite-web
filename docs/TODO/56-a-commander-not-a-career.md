# 56 — A commander, not a career

**Kind:** naming / UX · **Severity:** medium · **Size:** medium
**Depends on:** 45

## Why

Chris, 2026-08-03: *"'career' doesn't really carry any meaning to an end user.
They are playing a character."*

He is right, and it goes deeper than a label. "Career" is the word the save
code invented for *which run a save belongs to* — `SaveRecord.career`,
`state.career`, `bootCareer()`, `freshCareerName()`. It leaks onto the screen
("▶ IS THE CAREER YOU ARE FLYING") because there was no other word for the
thing.

Elite already has the word: you are a **commander**. It is on the station
menu, on the file screen, in the manual, and on the export button. The game
has been saying it since 1984.

The reason the code reached for a second word is that `commander` was taken:
`CommanderData` is the character's *stats* — credits, cargo, rating. So the
code has a name for the sheet and no name for the pilot, and invented
"career" for the pilot.

## The consequence on screen

Because identity is generated rather than chosen, a second run is called
`JAMESON 2` — a suffix `freshCareerName()` picks. It reads as a second save
of one commander when it is a different commander entirely, which is TODO
55's finding 2. Fixing the vocabulary without fixing where the name comes
from would leave the screen saying `COMMANDER: JAMESON 2`, which is worse: it
looks like the game named your character for you, because it did.

## What to do

- **Ask for the name.** Starting a new commander should prompt for one, the
  way `SAVE COMMANDER` already prompts and pre-fills. The name entry screen
  exists (`screens/saves.ts` already pushes one for saving and for renaming) —
  this is a third use of it, not new machinery.
- Identity then becomes **the name the player chose**, and `freshCareerName`'s
  auto-suffix becomes the fallback for the one case that still needs it: a
  name already in use. Decide what that does — refuse and ask again is
  probably kinder than silently appending a 2.
- **Retire the word "career" from everything player-facing**, and consider
  retiring it from the code too. If it stays internally it needs a comment
  saying it means "which commander this save belongs to" and why it is not
  called `commander` — the collision with `CommanderData` is the reason and it
  should be written down.
- Renaming a commander must move their saves with them, or say plainly that
  it does not. Today `R — RENAME COMMANDER` changes `CommanderData.name`; what
  it does to identity should be deliberate and stated.

## Watch out for

- `SaveRecord.career` is the **key** autosaves are addressed by
  (`save:auto:<CAREER>:dock`). Changing what fills it is a save-scheme change,
  and TODO 43 exists because that field had two homes. Keep it one, and read
  invariant 3 before touching the key space.
- Renaming a commander must not orphan their autosaves — if identity is the
  name, a rename moves the keys, and that is a multi-key write with all the
  care TODO 44 established.
- We are the only players (Chris, 2026-08-03), so **no migration is needed**
  for existing saves. Do not build one.

## Acceptance

- Nothing player-facing says "career".
- Starting a new commander asks for a name and uses it.
- Two commanders cannot silently become `NAME` and `NAME 2` without the
  player having chosen it.
- Identity still has exactly one home, and a test still fails if a second
  appears.
- Renaming does something stated, and a test asserts what.

## Verify

`npm run check`, then start a second commander and read the file screen: it
should be obvious that these are two different pilots and which one you are.
