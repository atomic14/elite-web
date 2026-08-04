# 76 — Wingman avoidance can be deleted and nothing notices

**Kind:** test gap · **Severity:** medium · **Size:** small
**Depends on:** none · found by mutation, alongside 83

## Why

`game/separation.ts` is a whole rule module with two swept constants, a measured
table in its own header, and three call sites inside the attack run
(`npc.ts:1095` in `passing`, `:1134` in `extending`, `:1168` in `closing`). It
exists because Chris flew the attack run in waves and reported *"I think we need
to get the npc better at collision avoidance though - they crashed into each
other a couple of times."*

**No test imports it.** `grep -rn "separationFrom\|SEPARATION_PUSH\|SEPARATION_RANGE" test/`
returns nothing. There is no `test/separation.test.ts`, and
`test/npc.test.ts:295-314` explicitly excludes gang separation from its own
fixture on the grounds that it is "separation.ts's job" — so the exclusion is
honoured on both sides and the rule is asserted nowhere.

Proven by mutation. Gutting the function so it always reports "nobody near":

```ts
  if (nearest === null || true) return 0;   // was: if (nearest === null) return 0;
```

— which deletes wingman avoidance from all three legs of the attack run — leaves
`npm test` at **2982 passed, 0 failed**.

## What is actually failing

Nothing is broken today. The module is correct as far as I can tell by reading:
nearest-mate-only, urgency linear in how far inside the range it is, a
`set(1,0,0)` fallback for two hulls in exactly the same place, and `mates` skipped
by position identity so a caller need not know its own index.

What is missing is any way to find out when that stops being true. The three call
sites are subtle in different ways and each has a failure mode a unit test would
catch:

- **`passing` is the one that matters and the one that is easiest to break.**
  That phase steers for NOTHING else — the whole point is that the committed
  heading is what carries a ship past its target — so the separation nudge is the
  only thing that can move it, and if it silently returned 0 the symptom would be
  ship-on-ship collisions in a wave, which nothing measures per-run.
- **`extending` shares the ship's scratch with `passOffset` and the arc**
  (`tmpDir2`, `tmpSide`, `tmpLead`, `tmpAway`). A scratch collision here would
  read as a steering bug a long way from its cause.
- **`closing` bends the AIM POINT**, so an error there shows up as the pass
  missing by the wrong distance — which is `pass-aim.ts`'s subject, and would be
  diagnosed there.

There is a second, quieter thing the absence hides: **`matePositions` does not do
what its comment says.** The comment reads "Everything solid and alive except
itself **and the thing it is attacking**", and the code excludes only `this`,
dead ships and inert ones (`npc.ts:1341-1349`). For a pirate attacking the
PLAYER this makes no difference — the player is not in the fleet. For a police
ship attacking a pirate, or a pirate attacking a trader, the target IS in the
fleet, so inside `SEPARATION_RANGE` (200) the ship steers away from the ship it
is attacking. Since `closing` only runs at `dist >= BREAK_OFF_RANGE` (220), the
only reachable case is `passing` — the phase whose entire job is to hold the
line through the merge. Whether that is right is a decision; that the comment and
the code disagree is not.

## What is NOT the problem

- **Not the constants.** 200 and 120 have a sweep table in the file header, and
  it is a good one. This item is not asking for them to be re-swept.
- **Not `train/ram-probe.ts`.** It reports `shipOnShipPerEpisode`, which is the
  right end-to-end number, but it is a probe rather than a gate: it is not run by
  `npm test`, it has no threshold, and it derives the count by subtracting
  `traderRams` from a damage quotient.
- **Not the coverage tool.** `npm run coverage` will report separation.ts as
  executed, because `npc.ts` calls it on every frame of every NPC test. Executed
  is not asserted, which is exactly what the mutation shows.

## What to work out

A `test/separation.test.ts` beside its subsystem, and the shape is already fixed
by the module being pure and taking positions:

- **The urgency curve**: 0 at exactly `SEPARATION_RANGE`, 1 at contact, linear
  between, and 0 for an empty list.
- **The direction**: `out` points from the mate to me, is unit length, and is the
  NEAREST mate rather than an average of several.
- **The two guards**: `mate === me` skipped by identity, and two hulls in the same
  place producing a finite unit vector rather than NaN. The NaN case is worth an
  explicit assertion — it would otherwise reach `object.position` and take the
  ship out of the world.
- **One behavioural assertion in `test/npc.test.ts`**, because the pure test
  cannot see the call sites: two ships placed inside `SEPARATION_RANGE` on
  converging lines, stepped, and asserted to separate — and the same fixture with
  one of the three call sites removed must fail.

Then decide the `matePositions` question and make the comment and the code agree
either way.

## Watch out for

- **A behavioural test here is easy to make vacuous.** "They did not collide" is
  true of most fixtures; the assertion has to be that the gap GROWS relative to
  the same fixture with the push at zero, which means the test needs the
  no-separation control in it.
- **Do not widen `SEPARATION_RANGE` to make a test easier to write.** The header's
  table says 260 costs nearly half the attack runs at eight ships.
- **`separation.ts` is not on `test/ai.test.ts`'s `PURE` list**, and neither are
  `npc.ts`, `break-off.ts`, `pass-aim.ts` or `extend-arc.ts`. Adding it is one
  line and is free.

## Acceptance

- `test/separation.test.ts` exists and asserts the four properties above.
- The mutation `if (nearest === null || true) return 0;` fails `npm test`.
- Removing any ONE of the three call sites in `npc.ts` fails `npm test`.
- `matePositions`'s comment and its code agree.

## Verify

```sh
# the mutation, by hand
#   src/game/separation.ts:96   if (nearest === null) return 0;
#                            -> if (nearest === null || true) return 0;
npm test
# 2026-08-04: 2982 passed, 0 failed
git checkout src/game/separation.ts
```
