# 81 — Two rows in the brain picker both say they are what ships

**Kind:** UI/UX · **Severity:** medium · **Size:** small
**Depends on:** none · fallout from `d563e3d`

## Why

`game/brain-names.ts` is the one home for what each policy is CALLED and what it
is LIKE, and its header sets the standard:

> **Every figure here is traceable and none of it is invented.** ... A line
> describes behaviour, NOT provenance.

`d563e3d` made the scripted attack run what a pirate flies — `SHIPPED_SOLO` and
`SHIPPED_PACK` are both `'scripted'`. The `scripted` row was updated to say so:

> **WHAT SHIPS.** CLOSES, FLIES THROUGH THE PASS AND COMES ROUND AGAIN — 5.2
> ATTACK RUNS AN EPISODE AGAINST 0.0 FOR THE TRAINED BRAINS, AND 2.2 POINTS OF
> CONTACT DAMAGE WHERE AIMING AT THE TARGET INSTEAD OF PAST IT COST 104.

The `pirate-attack-g3` row was not:

> CLOSES AND STAYS THERE — SPEED 216, MEDIAN RANGE 234, 0.20 COLLISIONS AN
> EPISODE. **THE FIGHT THE GAME SHIPS.**

Both rows are offered by the same picker, one after the other, and both claim to
be the game. A pilot arrowing that row is being told the opposite of what
happens.

## What is actually failing

Two things, and the second is the one the file's own standard is about.

**The claim.** `pirateBrainNameFor` returns `'scripted'` for every tier and for
`organised`, with no override. `pirate-attack-g3` is reachable only through
`state.brains.trained`. Its line has said "THE FIGHT THE GAME SHIPS" since before
that was false and nothing forced it to change.

**The figures.** The `scripted` row's two numbers do not reproduce.
`npm run flight-probe -- 40`, held-out base 30,000,007, target holds and turns —
which is where the other two rows' figures come from and where they still
reproduce exactly:

| brain | speed | range p10/med/p90 | passes | rams | line says |
| --- | --- | --- | --- | --- | --- |
| `scripted` | 234 | 180/547/921 | **4.42** | **0.00** | 5.2 passes, 2.2 contact points |
| `pirate-attack-g3` | 214 | 85/235/917 | 0.00 | 0.20 | speed 216, range 234, 0.20 — ✓ |
| `pirate-pack-r4-selectonly` | 143 | 387/1435/2903 | 0.82 | 0.70 | speed 144, range 1447, 0.83 — ✓ |

4.42 against a claimed 5.2 is 15% out, and the contact figure is zero.

**It is not the tactics vocabulary.** The obvious explanation is that `2c06418`
added `slash` and `knife` to a quarter of spawns each and cost the run some
lethality. It did not cost it this: forcing every weight row in
`tactic-choice.ts` to `run: 100` and re-flying the same 40 episodes reads

    | scripted | 232 | 162/535/925 | 4.33 | 0.00 | 13.0% |

— 4.33 passes, which is if anything lower. Whatever the 5.2 was measured on, it
was not this flight model and it was not this threshold.

(For the record, the same pair of runs does say what the vocabulary costs: the
pirate's share of the commander's pools goes 13.0% with tactics off to 11.2% with
them on, which is the 8-14% `tactic-choice.ts`'s header claims, measured on a
different fixture. That number is fine.)

## What is NOT the problem

- **Not the other two rows.** `pirate-attack-g3`'s and
  `pirate-pack-r4-selectonly`'s figures reproduce to within a unit.
- **Not `PASS_CLOSE` / `PASS_FAR` being wrong.** They are 400 and 600 and the
  probe imports them; the 92% coverage argument in `combat-sim-report.ts` still
  holds (measured apex p10 is 665 for a five-ship fight against a holding
  target).
- **Not a defect in the picker's plumbing.** `LIVE_BRAIN_IDS`,
  `liveBrainSelection` and `brainCharacter` all work; the text they carry is
  stale.
- **Not `SHIPPED_SOLO` being `scripted`.** That is a decision Chris made on the
  record and this item does not reopen it.

## What to work out

- **Rewrite the `pirate-attack-g3` line** so it describes behaviour and does not
  claim the shipped slot. Its measured shape is a good line already: it holds a
  median of 235 units, makes 0.00 attack runs and rams 0.20 times an episode —
  which is the standoff turret the whole cycle exists to avoid, and saying that
  is more useful to a playtester than any provenance.
- **Re-measure the `scripted` line** from a current `npm run flight-probe -- 40`
  and put the numbers it actually produces in it. If a contact figure is wanted,
  take it from `npm run ram-probe` (`ram points/ep`, which is contact billed
  where it happens) rather than from flight-probe's `rams` quotient, which is
  0.00 for a lone scripted pirate against a holding target.
- **Consider whether a test can hold this.** `test/brain-names.test.ts:145-148`
  already asserts every character line "carries the measured number that shows
  it" — by testing `/\d/`, which the generation suffix in a name would satisfy.
  A test cannot check that a number is CURRENT, but it can check that exactly one
  row claims to be what ships: `BRAINS[SHIPPED_SOLO].character` is the only one
  allowed to say so. That is a real assertion and it is one line.

While in the file, two smaller things:

- **`SELECTIONS['jameson-defend-g2']` is `{}`**, which is byte-identical to
  `SHIPPED_BRAINS`. So the picker offers a row that changes nothing, and
  `liveBrainId` — which checks `AS_SHIPPED` first — reads it back as THE
  ORIGINAL. `test/brain-names.test.ts:98-100` has an explicit escape hatch for
  this, and the hatch is one id wider than the defect (`pirate-attack-g3` does
  round-trip correctly, so its exemption is dead weight that would hide a future
  regression).
- **`brains.ts`'s comment block on `PIRATE_BRAIN`** still opens "Generation 3,
  and the first one aimed at how the game FEELS", with a table whose "on your
  six" column reads 10% — a quantity every probe fixture now measures as 0.0s
  (see docs/TODO/84).

## Watch out for

- **Do not re-measure on a different fixture and call it the same number.** The
  three rows' figures come from `train/flight-probe.ts` at its own base with a
  holding target; a figure from `ram-probe` or the tournament is a different
  fight and should say which.
- **The character lines are rendered in the trainer's setup panel**, so length
  matters; `test/brain-names.test.ts` already holds them to the panel's shape.

## Acceptance

- Exactly one row in `BRAINS` claims to be what the game ships, and it is
  `SHIPPED_SOLO`'s.
- Every figure in every row reproduces from a named tool at a named seed base,
  re-run on the day it is written.
- A test that fails if a second row claims the shipped slot.

## Verify

```sh
npm run flight-probe -- 40
# 2026-08-04:
#   scripted                    234  100%  180/547/921   90  4.42  0.0s 0.00 11.2%
#   pirate-attack-g3            214  100%   85/235/917   41  0.00  0.0s 0.20  5.9%
#   pirate-pack-r4-selectonly   143  100% 387/1435/2903  37  0.82  0.0s 0.70 15.2%
```

The tactics control, for the "it is not the vocabulary" claim — set all three
rollable rows of `WEIGHTS` in `src/game/tactic-choice.ts` to `run: 100` and
re-run the same command; `scripted` reads 4.33 passes. `git checkout
src/game/tactic-choice.ts` restores.
