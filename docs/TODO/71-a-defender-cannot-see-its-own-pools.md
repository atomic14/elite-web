# 71 — A defender cannot see its own pools, so it cannot learn to break off

**Kind:** training fidelity · **Severity:** high · **Size:** medium
**Depends on:** none, but it is the other half of 65 — read that first

## Why

Item 63 gave a training episode's target the same recovery the game gives the
commander: the bank recharges every tick and a shield face comes back once the
bank is out of its last quarter. The point of that was to make "take a hit,
disengage, come back" a strategy the trainer can express.

**It cannot be expressed.** Measured before and after 63, over 240 held-out
episodes, `jameson-defend-g1` killed **5.7%** of its attackers either way — the
same number to the decimal, because the policy's flying did not change by a
single frame. It could not: `policy.ts`'s `observe()` is fourteen numbers and
**none of them is the defender's own health.**

```
0 speed/max   1 laserTemp   2 canFire   3-5 dir-to-target (ship frame)
6 log distance   7 closing speed   8 target-facing-us dot
9 angle-to-target/pi   10 target speed   11 pitchRate   12 rollRate   13 bias
```

So a defender at full shields and a defender one hit from the escape capsule
emit **identical controls in identical geometry**. There is no policy in the
14-input family that breaks off when hurt, because "when hurt" is not a
distinction it can draw.

## What is actually failing

- **`observe()` has no own-health input.** Fourteen slots, listed above.
- **Only `observePackWide` has one** — slot 25, *"our own health fraction —
  press or break off"*, written for round 4 of the pack phase.
- **No shipped brain uses that encoder.** `pirate-attack-g3` and
  `jameson-defend-g1` are 14-input; `pirate-pack-r4-selectonly` is **18**, which
  is `observePack` — direction and distance to the nearest mate, no health. So
  the one encoder in the codebase that can see a ship's own condition is flown by
  nothing, and **nothing the game flies knows how hurt it is.**
- **Widening the brain would not be enough on its own.** `observeFor()` picks the
  encoder by pack context first: `if (!mates || brain.obsSize < PACK_OBS_SIZE)
  return observe(...)`. A defender has no fleet, so `mates` is null and the solo
  encoder runs whatever the brain's size — and the solo encoder writes only the
  first 14 slots, so a wider defence brain would read stale memory in its tail.
  The file says exactly this, in `observeFor`'s own comment.
- **The plumbing is already there.** `ShipView` declares `hp` and `cls.hp` (for
  the wide encoder), and `CombatComputer.step` is handed the commander's
  `ShipSystems` and already copies `sys.laserTemp` and `sys.laserCooldown` into
  its view. The number is one expression away in the game and free in an episode.
  **The encoder is the blocker, not the data.**

## Why this matters to 65 specifically

docs/TODO/65 is about the defence policy being *selected* for not fighting. It
is right, and it is only half of the problem: **65 can change what is selected
for; it cannot make the policy capable of the behaviour.** "Fight, take the
damage, break off while the shields come back, come back in" needs the ship to
know which of those it is doing. Fix 65 alone and the search will find the best
health-blind fighter — which may well be better than what ships, and is still a
ceiling put there by the observation rather than by the search.

The honest ordering is 65 first (it is cheaper, and it is a real defect on its
own), then this, then one retrain that gets both.

## What is NOT the problem

- **Not the fitness.** `fitnessDefend` pays for pools left, damage dealt and
  kills. It is asking for the behaviour; the policy has no way to produce it.
- **Not the combat computer's plumbing.** It has `sys` in hand.
- **Not `observePackWide`.** It is the model to copy, not something to fix.
- **Not a missing recurrent state.** This is a fully observable quantity the
  encoder omits, not something that needs memory to infer.

## What to work out

- **Where the input goes, and how narrowly.** Appending a slot to `observe()`
  changes the input layout for **every brain that reads it**, and
  `observePack`/`observePackWide` both call `observe()` first — so one line
  invalidates all three shipped policies at once (invariant 5). A separate
  `observeDefend()` with its own exported size, selected the way `observeFor`
  already selects between three encoders, confines the change to the phase that
  needs it and leaves attack and pack **byte-identical**. Decide which, and say
  why in the file.
- **What exactly is fed.** `Episode`'s target has `hp` (pool / maxPool, the
  observation boundary's own fraction). The game must feed the same expression
  from `ShipSystems`, or the policy is flown out of distribution the moment it
  leaves the trainer. One helper, both callers.
- **Whether one number is enough.** Fore and aft faces are separate pools and
  "which side is gone" is tactically different from "how much is left" — an
  attacker on your six is spending a different bank from one head-on
  (`hitFromFront`). Two or three slots may be the right answer; more slots is
  more search space, and docs/TODO/65's warning about widening a distribution the
  selector is blind to applies here too.
- **What retrains.** At minimum the defence phase. If `observe()` itself is
  widened, all three — and `docs/TRAINING-LOG.md` gets another baseline note.

## Watch out for

- **Invariant 5: this invalidates brains.** Say which, in advance, and retrain
  deliberately.
- **The out-of-distribution trap has already bitten here twice**, and both are
  written down in `combat-computer.ts`: the threat's speed is pinned at a
  constant 280 and the pirate views at 300, *because that is the only value the
  brains have ever been flown against*. A new input is a new way to make that
  mistake — feed it the real quantity in training and in the game, from one
  place, from the first run.
- **`flies()` in `evolve.ts` builds `ShipView`s by hand** to sample the controls
  a genome emits. It will need the new field, or the degenerate-throttle guard
  starts judging genomes on an observation the trainer never gives them.
- **`test/ai.test.ts` asserts each weights file's length against its declared
  shape.** A new obs size changes `genomeSize`, and that is the check that will
  notice if a brain and its encoder ever disagree — do not weaken it.
- **A defender that can see its health may learn to run away**, which is exactly
  what docs/TODO/65 says the selection rule already rewards. Doing this one
  first, alone, could make the shipped behaviour *worse*.

## Acceptance

- A defence policy's controls change with its own hull fraction, everything else
  held equal — asserted as a test, on one genome, at two health values in
  identical geometry. That test fails today for every brain in the tree.
- The game and the trainer compute that fraction in one place.
- A retrained defender that measurably disengages when hurt and re-engages when
  recovered: `npm run defence-probe` showing kills up at pools-left held, and the
  engagement-range spread in `train/defence-probe.ts` widening rather than
  collapsing.
- Attack and pack brains untouched, or a stated decision that they retrain too.

## Verify

That no shipped policy can see its own condition, today:

```js
// node --experimental-strip-types <this file>   — from the repo root
import { readFileSync, readdirSync } from 'node:fs';
const B = new URL('../src/ai-training/brains/', import.meta.url);
for (const f of readdirSync(B).filter((n) => n.endsWith('.json'))) {
  const m = JSON.parse(readFileSync(new URL(f, B), 'utf8')).meta;
  console.log(m.name, m.phase, 'obsSize', m.obsSize ?? 14);
}
// 2026-08-04: jameson-defend-g1 defend 14 · pirate-attack-g3 attack 14
//             pirate-pack-r4-selectonly pack 18
// own health is slot 25 of the 26-input encoder. Nothing reaches it.
```

And that health does not reach the controls:

```js
const { act, observe, makeScratch, shipView } = await import('../src/ai-training/policy.ts');
const { brainFromFile } = await import('../src/ai-training/policy.ts');
// same brain, same geometry, hp 1.0 vs hp 0.1 — the controls are identical,
// because `observe()` never reads `me.hp`.
```

Then fly it: `T` at any station, fit the combat computer, and take damage
deliberately. It should break off. Today it does not, and it cannot.

## DONE, 2026-08-04 — `observeDefend`, 17 inputs, and `jameson-defend-g2`

Done in ONE pass with docs/TODO/72, because they are one observation change.
The full record is docs/TRAINING-LOG.md, "the defender can see itself and answer
a missile"; what belongs here is the decision this item asked for and the part
of the acceptance that did **not** land.

### The decision: a separate encoder, and why

`observeDefend()` at **17 inputs**, selected by `observeFor` off the brain's own
input count, not two more slots on `observe()`.

- Appending to `observe()` moves the layout of every brain in the project,
  because `observePack` and `observePackWide` both call it first: one line,
  three invalidated policies, three retrains (invariant 5). None of the three
  numbers means anything to a pirate — it has one pool rather than three,
  nothing launches a warhead at it in an episode, and its E.C.M. is rolled at
  spawn and applied without the ship deciding.
- So attack and pack are **byte-identical** and were not retrained.
  `npm run flight-probe` is byte-identical to its pre-change output;
  `test/defence-answer.test.ts` asserts both files still declare 14/11 and
  18/11.
- 17 rather than 18 because **the size IS the discriminator** and 18 is
  `observePack`'s. `observeFor` asks for the defence encoder FIRST, by size
  alone, precisely because a defender has no fleet and every other test would
  fall through to the solo 14 and leave the tail holding stale memory — the case
  the function's own comment warned about.

### What is fed, from one place

`systems.ts` `poolsLeft(sys)` and `energyLeft(sys)`. The trainer's
`TargetShip.hp` IS `poolsLeft` and `CombatComputer.step` calls the same two, so
the out-of-distribution trap this item cites cannot open between them.

**Three slots, not one or two.** 14 is the whole ship (the same expression as
`observePackWide` slot 25), 15 is the energy bank alone — what she dies at, what
the shields will not recover past, and what the E.C.M. spends a quarter of — and
16 is docs/TODO/72's warhead. The FORE/AFT SPLIT was left out with a reason: the
total and the bank already give the shields' sum, only the split is missing, and
every input is search space a fixed budget has to cover. It is one size (19)
away for whoever wants it.

### And the trap this item names, closed rather than avoided

`combat-computer.ts` pinned the threat's speed at 280 "until the brain is
retrained". It has been, and `Episode.observeTrader` has always fed the real
speed, so the pin became the divergence. It feeds `threat.state.speed` now. The
300 in `npc.ts` is untouched — those brains were not retrained.

### Acceptance, honestly

- **A defence policy's controls change with its own hull fraction** — asserted,
  both ways: on a hand-built genome, and over 100 random 14-input genomes that
  cannot (the family this item is about). ✅
- **The game and the trainer compute the fraction in one place.** ✅
- **`flies()` in evolve.ts sees the new field** — it sweeps two health values
  now, and does so without changing what it measures for attack or pack. ✅
- **Attack and pack untouched.** ✅
- **A retrained defender that measurably disengages when hurt** — ❌ **NOT MET,
  and this is the finding.** `jameson-defend-g2`'s median engagement range is
  385 when hurt against 402 when whole: it closes very slightly, the same
  direction g1 does. The range SPREAD widened as asked (p10/p90 134-1056 against
  129-874), and kills went from 4.8% to 41.6% at pools-left held (89.2% → 98.3%)
  — but the mechanism is not break-off. It is that g2 spends **4.3%** of the
  fight hurt where g1 spends 15.3%, because it kills the attacker. Conditioning
  on your own pools turned out to be worth having for a reason the item did not
  guess.
- Measured against the ablation, **the health inputs are not what unlocked the
  fighting** — the 14-input family had already reached 41% kills (`t65c`). What
  they bought is real but smaller than this item implies; what bought the
  promotion was docs/TODO/72.

### Still open, and named here because this item is where it will be looked for

Both defence policies are near-stationary knife-fighters — mean speed 5 for g2
and 8 for g1. It is not a regression and it is not obviously wrong for a
defender (Chris's own median is 66), but the combat computer holds your ship
almost still and pivots, and nobody has flown g2 yet. **Fly it before tuning
it.**
