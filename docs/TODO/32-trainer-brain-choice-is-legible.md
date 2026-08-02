# 32 — Make choosing a brain a real choice

**Kind:** UI/UX · **Severity:** high · **Size:** medium
**Depends on:** 31

## Why

The trainer exists to answer one question — *does this brain make a fight worth
flying* — and its brain rows answer it with filenames.

`EXERCISE BRAIN` now offers twelve values and `LIVE BRAINS (CAREER)` eleven.
Both step one value per key press, with no way to see the list, jump to an end,
or tell that the value has wrapped. Reaching the TODO 29 brains is five to seven
taps. And when you arrive, the row says `PIRATE-ATTACK-T29`, which tells a
playtester nothing about what they are about to fly against.

We already know what each brain does. `train/flight-probe.ts` measures mean
speed, engagement range and contact rate per brain, and `docs/TRAINING-LOG.md`
records why each was or was not shipped. None of it reaches the room where the
choice is made.

## Implementation

- Give every selectable brain a one-line CHARACTER, stated where the brain is
  named (`game/brain-names.ts` is the file that already owns naming and holds no
  weights). Behaviour, not provenance: what it does in a fight, and the one
  number that shows it. For example — the shipped pirate closes to about 234
  units at 216 speed and makes attack runs; the t29 pirate hangs at about 754 at
  104 and snipes.
- Show that line under the panel when a brain row is selected, in the slot the
  contextual help already uses.
- Make a long list navigable: at minimum wrap indication and a way to reach
  either end without walking. If a value list is the better answer, it must obey
  the Screen contract — one input surface, `data-key`/`data-row`, no parallel
  click path.
- Do not invent numbers. Every figure quoted must come from a recorded probe
  run, and where a brain has never been probed, say so rather than guessing.

## Acceptance

- Selecting any brain row shows what that brain does, without opening a doc.
- Every quoted figure is traceable to `train/logs/` or `docs/TRAINING-LOG.md`.
- Stepping through a full list and back returns to where it started.
- A test asserts every name the picker offers has a character line, so adding a
  brain without describing it fails the build.

## Verify

`npm run check`, then `T` at a station: step both brain rows end to end and read
what each says.
