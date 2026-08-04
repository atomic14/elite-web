# 80 — The defence probe's headline is the metric docs/TODO/65 threw out

**Kind:** training methodology · **Severity:** medium · **Size:** small
**Depends on:** 65 (done) — this is its own argument, applied to the tool

## Why

docs/TODO/65 replaced a defender's outcome because terminal pools are the wrong
question. `train/selection.ts` states the reasoning:

> **Finishing was worth less than dawdling.** With the pools recharging,
> terminal `hp` is close to "how long since she was last hit". A pilot that
> CLEARS the fight ends the episode early and heals for less of the clock, so it
> reads lower however well it flew.

and the outcome is `1 - targetDamageShare()` — cumulative points taken over her
own pools — for exactly that reason.

**`train/defence-probe.ts`'s first column is still terminal.**

```ts
pools: Math.max(0, ep.trader.hp) * 100,     // defence-probe.ts:145
```

and `ep.trader.hp` is `poolsLeft(this.sys)`, read at the final frame. Its own
footer says so — "the outcome `evolve.ts` selects on is 0.6 x pools kept
(cumulative, not the terminal figure above)" — and then the table prints the
terminal one first, largest, and under the heading the tool exists for.

The gap is not small. `jameson-defend-g2`, the same 800 held-out fights, both
quantities:

| | value |
| --- | --- |
| terminal pools (what the probe prints) | **98.3%** |
| cumulative kept (what the selector reads) | **88.5%** |

98.3% reads as "she was barely touched". 88.5% reads as "she lost an eighth of
her ship and healed most of it back". They are the same fight.

And 98.3% is what got copied. `game/brain-names.ts`'s character line for the
shipped policy — the line a playtester reads in the trainer's brain picker before
choosing what to fly against — says:

> 41.6% of her attackers destroyed, **98.3% of her pools left**, 0 deaths

Every one of those numbers reproduces exactly (I re-ran the probe), and the
middle one is the metric this project has already decided is misleading.

## What is actually failing

Nothing is being selected on the wrong thing — `evolve.ts` reads `outcomeOf`,
which is cumulative and correct. What is wrong is the READOUT, in three places:

- **The probe's headline column** ranks policies on the quantity 65 rejected. Two
  policies that differ by 8 points of cumulative damage can differ by 1 point of
  terminal pools, and this column is what a human compares.
- **The character line** quotes it to a pilot as the policy's quality.
- **`train/evaluate.ts`'s defence section says the opposite thing entirely**:
  `"(here LOW 'hurt' is the defender winning — it is her pools being spent)"`.
  `hurt` there IS `targetDamageShare`, i.e. the cumulative one — but after 65 the
  rule deliberately pays a defender to spend pools on kills. The tournament's
  annotation now contradicts the selection rule it is meant to be evidence for.
  In that table `jameson-defend-g2` reads 18.5% against a scripted armed
  trader's 9.2% and the note calls that losing, when the whole of 65 is the
  argument that trading a third of her shields to halve the incoming fire is a
  good trade.

There is a second thing the terminal column hides, and it is the reason the gap
is 10 points rather than 1: **the pools are saturated.** Terminal pools read
98.0-98.7% across every pirate count from one to four and every hull, so the
column that 60% of the outcome is built on cannot separate a one-pirate fight
from a four-pirate one. All the discrimination is in `broke`, which runs
88.2% → 36.3% over the same range. That is worth knowing before the next defence
retrain: `DEFENCE_POOLS_KEPT = 0.6` is 60% of the outcome resting on a quantity
with almost no variance left in it.

## What is NOT the problem

- **Not `selection.ts`.** The rule is right and is stated. This is the tool and
  the prose disagreeing with it.
- **Not `trader.hp` / `poolsLeft`.** Terminal pools are a real thing and worth
  printing — as a second column, beside the one being selected on.
- **Not the 41.6% / 0 deaths figures.** Both reproduce exactly.
- **Not `EPISODE_SCHEMA`.** No world changes here; only what is reported.

## What to work out

- **Print the cumulative figure as the first column**, keep terminal beside it,
  and label both. The probe already has `ep.targetDamageShare()` available and
  `train/selection.ts` already exports `defenceTerms(ep)`, which returns exactly
  `{ kept, broken }` — so the probe can print the two halves of the outcome the
  champion is chosen by, which is what its own footer says it is for.
- **Re-derive the character line** in `brain-names.ts` from whatever the probe
  ends up printing, and re-run it, so "every figure here is traceable" stays
  true.
- **Fix or delete `evaluate.ts`'s footnote.** Post-65, low `hurt` on the defence
  row is not by itself the defender winning.
- **Decide whether `DEFENCE_POOLS_KEPT` at 0.6 still earns its share** given that
  the quantity behind it varies by 0.7 points across the whole fixture. That is a
  selection question and belongs with whoever does the next defence retrain;
  it is stated here because the measurement is what surfaces it.

## Watch out for

- **Do not re-baseline quietly.** The archived defence numbers in
  docs/TRAINING-LOG.md are terminal; a run reported cumulative afterwards is not
  the same measurement, and the log's own convention is to say so.
- **The terminal column is not useless.** It answers "was she in trouble at the
  end", which is a real question for a wave that continues. Keep it, name it.
- **`train/survivability.ts` prints "pools stripped"**, which is terminal too
  (`1 - trader.hp` at the end). Same decision applies there.

## Acceptance

- The defence probe's leading column is the quantity `outcomeOf('defend', …)`
  reads, with the terminal figure kept and labelled.
- `brain-names.ts`'s shipped defence character line reproduces from a current
  run of the tool.
- `evaluate.ts`'s defence footnote says something that is true after 65.

## Verify

```js
// node --experimental-strip-types <this file>
import { readFileSync } from 'node:fs';
import { Episode } from '../src/ai-training/scenario.ts';
import { brainFromFile } from '../src/ai-training/policy.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { defenceFight } from '../train/defence-fight.ts';

const B = new URL('../src/ai-training/brains/', import.meta.url);
const brain = brainFromFile(JSON.parse(
  readFileSync(new URL('jameson-defend-g2.json', B), 'utf8')));
let term = 0, cum = 0, n = 0;
for (const base of [8675309, 1234577]) {
  for (let e = 0; e < 400; e++) {
    const seed = base + e * 7919, f = defenceFight(seed);
    const ep = new Episode({
      seed, pirates: Array.from({ length: f.count }, () => ({ kind: 'scripted' })),
      trader: { kind: 'policy', brain }, traderArmed: true, traderClass: f.hull,
      traderLaser: f.laser, targetEnergyUnit: f.energyUnit, targetEcm: f.ecm,
    });
    while (!ep.done) ep.step(FIXED_DT);
    term += Math.max(0, ep.trader.hp) * 100;
    cum += (1 - ep.targetDamageShare()) * 100;
    n += 1;
  }
}
console.log({ terminal: (term / n).toFixed(1), cumulative: (cum / n).toFixed(1), n });
// 2026-08-04: { terminal: '98.3', cumulative: '88.5', n: 800 }
```
