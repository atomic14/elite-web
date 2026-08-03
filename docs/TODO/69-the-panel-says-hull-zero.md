# 69 — The setup panel says "HULL (0)" and means "ask the hull"

**Kind:** UI/UX · **Severity:** low · **Size:** small
**Depends on:** none

## Why

Chris, reading the combat trainer's opposition rows: what do `MISSILES → HULL
(0)` and `E.C.M. → HULL (0%)` mean?

They mean "leave it to the hull, which for this hull happens to be none". The
row is showing its DEFAULT MODE and the VALUE of that default in one string, and
a reader has no way to tell which part is the setting and which is the
consequence — `HULL (0)` reads like a broken interpolation.

It is the same class of problem TODO 41 fixed for brains ("name the opposition,
not the file"): the row's value was an implementation detail rather than an
answer to the question the row asks.

## What is actually failing

`combat-sim-setup.ts` renders `g.missiles === null` as `` `HULL (${n})` `` and
`g.ecm === null` as `` `HULL (${pct}%)` ``. `null` is a real and useful state —
"whatever this hull carries" is different from "zero" and stays right when the
hull changes — so the fix is wording, not behaviour.

## What to work out

- **Say what it is doing, then what that gives.** Something in the shape of
  `AS THE HULL CARRIES — NONE` / `AS THE HULL CARRIES — 60%`, so the mode is
  words and the number is a consequence.
- **Check the arrow-key affordance.** `nudgeOrHull` steps off `null` into an
  explicit number and back; whatever the wording, arrowing to the end and back
  should visibly return to the hull's own value.
- **The same reading appears in the record.** If the exported JSON quotes it,
  the two must agree — one rule, one home.

## Acceptance

- No row reads `HULL (0)`.
- A reader who has never seen the panel can tell whether a row is set or
  delegated.
- `test/combat-sim-panel.test.ts` asserts every row's value is non-empty and
  changes when changed — extend it to assert the delegated state is
  distinguishable from an explicit zero.

## Verify

`npm run dev`, open `/play`, dock, press `T`, add a custom group, and read the
MISSILES and E.C.M. rows for a hull that carries none against one that carries
two — a Python carries 2 missiles and a 60% E.C.M. chance, a Krait carries
neither (`src/game/ship-specs.ts`). Then `npm test` for the panel assertions.
