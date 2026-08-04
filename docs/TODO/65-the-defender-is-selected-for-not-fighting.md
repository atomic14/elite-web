# 65 — The defender is selected for not fighting

**Kind:** training methodology · **Severity:** high · **Size:** medium
**Depends on:** none (but 63 changes the numbers below, so read it first)

## Why

CLAUDE.md has said this for as long as there has been a defence policy:

> the defence policy evades superbly and shoots badly

It has been treated as a property of the brain. It is a property of the
**selection rule**, and it is arithmetic rather than opinion.

`train/evolve.ts` picks the champion by

```ts
const score = v.win * 1000 + Math.max(-499, Math.min(499, v.shaped));
```

and for the defend phase `outcomeOf` is `ep.trader.hp` — the fraction of the
commander's pools still standing. So:

| | worth at selection |
|---|---|
| 1% of your pools | **10 points** |
| killing an entire pirate | **3 points** |

Killing a pirate pays only if the engagement costs less than **0.30%** of your
pools. It never does. **Under this rule, shooting is strictly irrational**, and
a policy that flies away and survives outranks every policy that fights.

`fitnessDefend` is not the problem — it pays 3 per kill and 4× damage dealt, and
it is doing its job. The problem is the 1000× scaling in front of `win`: the
clamp at ±499 was written so shaped fitness could break ties "within an outcome
band rather than ever outranking a better outcome", and it does that correctly.
But real shaped values come out around **11 to 16**, not near 499, so the whole
shaping term contributes **1.9%** of the final score. The tie-break never
happens; the outcome decides everything.

## The evidence

`npm run defence-probe` prints this. `jameson-defend-g1`, held-out episodes,
broken down (2026-08-03):

```
by pirate count     pools left      pirates killed
  1                    91.4%             10.2%
  2                    81.8%              5.4%
  3                    72.9%              6.8%
  4                    60.6%             10.5%

by hull flown
  playerCobra          76.1%              7.5%
  playerCobraSlow      77.0%              4.9%
  traderCobra          76.6%             12.4%     <- 2.5x the kills

by laser
  beam                 77.3%              4.3%
  military             77.0%              9.6%     <- 2.2x the kills
```

The hull moves the kill rate by 2.5× and the laser by 2.2×, and NEITHER moves
pools-left at all. The selection metric cannot see the difference, so widening
the training
distribution along that axis — which this session did — adds search space the
selector is blind to. That is why two retrains across the wider distribution
came out WORSE than the narrow shipped brain rather than better, and why
tripling the search budget was not the answer.

## What to work out

- **What "won" should mean for a defender.** Surviving is necessary and not
  sufficient — Chris fits the combat computer to help him fight, not to fly him
  away. A candidate: `hp` weighted with damage dealt, or `hp` gated by having
  engaged at all, so a policy that survives by never being in the fight cannot
  top the table.
- **The scale mismatch, independently.** Even keeping `hp` as the outcome, a
  ±499 clamp on a quantity that ranges 11-16 is a tie-break that never fires.
  Either normalise `shaped` onto the same scale as `win`, or state the ratio
  deliberately rather than inheriting it.
- **Whether `evade` wants the same fix.** It shares `outcomeOf`, and for an
  evader "survive and leave" may genuinely be the whole job — in which case the
  two phases want different outcomes and should say so.
- **Do NOT just add more compute.** It was tried: 400 generations at population
  96 with 5 episodes, three times the budget, was stopped once this was
  understood. A better search finds a better evader.

## Watch out for

- **`--select-kills` already exists** and is a different knob: it changes
  ranking WITHIN a generation, not the final champion choice. Read the flag's
  comment before adding a fourth.
- **The inversion warning in evolve.ts.** Scoring defend by trader deaths was
  tried and it selected the defender that dies most — the comment records that
  it wrecked two phases across four retrains and the physics was blamed first.
  Any change to `outcomeOf` needs the same scepticism.
- **Item 63 changes these numbers.** With shield regeneration, `hp` at the end
  of an episode measures something different — recovery as well as avoidance —
  and the balance between the terms should be re-derived, not carried over.

## Acceptance

- A defence policy that engages and kills outranks one that survives untouched
  without firing, and a test asserts that ordering on two hand-built genomes.
- The contribution of `shaped` to the final score is a stated ratio rather than
  an accident of scale.
- A retrained policy beats `jameson-defend-g1` on kills at equal survivability,
  on held-out seeds, in the varied setup.

## Verify

`npm run defence-probe -- 120 jameson-defend-g1 <the-new-brain>` and compare the
two blocks it prints. The per-hull and per-laser kill spreads should now be
visible to the selection metric, and the
`by pirate count` pools gradient should not have collapsed — a policy that
trades all its survival for kills has overcorrected.

## What item 63 did to these numbers (2026-08-04) — re-derived, not carried over

63 is done: the episode's target runs `systems.ts`'s `regenerate` now. Every
figure above is on the old world. Here is the same claim re-measured on the new
one, and it is **stronger, not weaker**.

`evolve.ts`'s own selection score, on its own 24 validation seeds, five
defenders flying the same fights (scripted attackers, 1-4 of them):

| defender | pools left | damage TAKEN | pirates killed | shaped | **selection score** |
| --- | --- | --- | --- | --- | --- |
| `holding` (turns and shoots) | 97.5% | **150 pts** | **42.4%** | **18.09** | **993.6** ← last |
| `jameson-defend-g1` (shipped) | 99.1% | 167 | 3.5% | 8.89 | 999.5 |
| `scripted` hauler | 98.7% | 179 | 0.0% | 11.84 | 998.8 |
| `weaving` | 98.9% | 190 | 1.0% | 12.18 | 1001.0 |
| `runner` (never fires) | 99.3% | 172 | 0.0% | 11.78 | **1005.0** ← first |

The pilot that takes the LEAST damage and kills the MOST comes **last**, and the
pilot that never pulls a trigger comes **first**. `fitnessDefend` gets it right —
18.09 for the fighter against 11.78 for the runner — and the 1000x `win` term in
front of it decides anyway, exactly as this item says.

**And there is a new failure mode on top of the old one.** With recovery in the
world, `hp` at the end of an episode is close to "how long since she was last
hit". `holding` ends its fights early — it CLEARS 7 of 24, mean 37.3s against
45.0 — so it heals for less of the clock and reads lowest on the metric despite
being the least damaged. Terminal `hp` now penalises winning. Restricted to
episodes that ran the full 45s the gap mostly closes (98.4% against the runner's
99.2%), which is the tell: the outcome is measuring the clock, not the fight.

So a fix that keeps terminal `hp` as the outcome has to answer BOTH — that
shooting is worth almost nothing, and that finishing is worth less than
dawdling. `Episode.targetDamageShare()` is already the cumulative form of this
quantity for the attack and pack phases (63 changed it to read
`trader.damageTaken`, because `1 - hp` stopped meaning "damage done" the moment
anything healed); `1 - targetDamageShare()` is the same quantity from the
defender's side and has neither defect.

**And this item is only half the ceiling — see docs/TODO/71.** `observe()` is
fourteen numbers and the defender's own health is not one of them, so a policy
cannot condition on being hurt at all: the kill rate was identical to the decimal
either side of 63, because nothing about the flying could change. 65 can fix WHAT
is selected for; it cannot make the policy capable of "break off while the
shields come back". Do this item first — it is cheaper and it is a real defect on
its own — but a retrain after it is still fitting a health-blind pilot.

## 2026-08-04, again — the third instance, and the clearest one

docs/TODO/62 put missiles into training and the defence phase was retrained twice
under it, at 300 generations. Both champions on 240 held-out episodes, against
the incumbent:

| brain | pools left | taken/ep | dealt/ep | kills | shots/ep | cleared |
| --- | --- | --- | --- | --- | --- | --- |
| **`jameson-defend-g1` (shipped)** | 90.1% | 300.4 | **24.7** | **5.8%** | **232** | **6/240** |
| `jameson-defend-t62` | 90.7% | 316.7 | 0.0 | 5.1% | **0** | 0/240 |
| `jameson-defend-t62b` | **92.7%** | **277.7** | 4.1 | 3.3% | 26 | 2/240 |

**`jameson-defend-t62` fires zero shots across 240 fights and still ranks above
the shipped brain on the metric champions are selected by.** Not "shoots badly" —
does not shoot. It is the argument at the top of this file with the last of the
noise taken out: an armed trader that never arms is what the selector asks for.

Neither was promoted. The one new thing 62 contributes is a `died` column that is
no longer saturated — 0/240 for every defender before today, and 6 / 5 / 4 for
these three — so a fix to this item now has at least one outcome signal that
discriminates without having to be invented.
