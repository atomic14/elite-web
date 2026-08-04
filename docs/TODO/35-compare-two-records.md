# 35 — Compare two records without leaving the room

**Kind:** UI/UX · **Severity:** medium · **Size:** medium
**Depends on:** 34

## Why

The trainer's whole method is A/B: same seed, same scenario, two brains, two
reports. `docs/COMBAT-SIM.md` says so, and it is why the seed is on the report.

But comparing means flying one, reading a screen, flying the other, and holding
twenty numbers in your head while pressing left and right between records.
Everything needed is already in the ring — the records are kept, they carry
their seed and their brain, and `←/→` already walks them.

## Implementation

- A compare view over two records from the ring: the current one and one other,
  shown as this / that / difference.
- Refuse honestly rather than mislead: comparing two records with different
  seeds, scenarios or loadouts is not an A/B, and the view should say which
  fields differ instead of quietly showing a difference that means nothing.
  Different BRAINS is the point; different anything else is a confound.
- Pick the other record with the keys already in use. Do not add a binding
  unless there is genuinely no room — docs/INVARIANTS.md invariant 9 lists four places a
  binding lives, and they change together.
- Copy and export should be able to take the pair, since the pair is the
  finding.

## Acceptance

- Two records from the same seed and scenario can be read side by side without
  leaving the report.
- A mismatched pair states what differs and does not present a difference column
  as if it were a result.
- The comparison is derived from the records, adding no new accumulation.

## Verify

`npm run check`, then fly the same seed twice against two brains and read the
comparison.
