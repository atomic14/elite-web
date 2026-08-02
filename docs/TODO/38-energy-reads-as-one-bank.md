# 38 — The console still shows four energy banks

**Kind:** UI/UX · **Severity:** low · **Size:** small
**Depends on:** none

## Why

TODO 27 replaced the player's `1 / 1 / 4` systems with three 255-point pools,
and `manual.html` was corrected to describe one energy bank the size of a
shield. The console still paints energy as four discrete segments — the retired
model's presentation sitting on top of the new one.

It is not wrong so much as unreconciled: the segments no longer correspond to
anything, the manual now says something else, and `ENERGY LOW` fires at
`LOW_ENERGY` (a quarter of the bank) rather than at a segment boundary.

## Implementation

- Decide what the console should show, and make the manual, the HUD and the
  warning agree. Either the segments become a deliberate reading of one bank —
  quarters, with the warning at the same quarter — or energy is drawn as a bar
  like the shields it is now the size of.
- One home for the threshold. `LOW_ENERGY` already exists in `systems.ts`; the
  painter reads it rather than knowing a number.
- This is presentation. No rule moves, and `npm run campaign` must not change.

## Acceptance

- What the console shows, what the manual says and where the warning fires all
  describe the same thing.
- The HUD reads the threshold rather than restating it.
- Campaign output is byte-identical.

## Verify

`npm run check`, `npm run campaign` against the previous commit, then take an
exercise and watch the energy readout drain past the warning.
