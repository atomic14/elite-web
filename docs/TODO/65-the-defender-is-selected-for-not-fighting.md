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

## DONE, 2026-08-04 — the rule, the ratio, the test, and a brain that was not promoted

### The rule

`train/selection.ts` is a file now, because the rule had to be assertable and it
was two expressions inside a script that parses argv and starts training on
import. It holds the outcome per phase, the shaping term and the ratio between
them; `evolve.ts` imports it in three places and defines none of it.

```
score = 0.75 x outcome(0..1) + 0.25 x shaped/full-scale(0..1)

attack, pack   the share of the target's pools taken off her — unchanged
evade          the share she kept, cumulative, zero if she died
defend         0.6 x the share she kept + 0.4 x the share of the attacking
               force she broke, zero if she died
```

**Why that shape.** Three defects had to close at once and each names a term:

- *Shooting was worth almost nothing.* The fighting half is 40% of the outcome,
  so against two attackers destroying one is worth about a third of her pools —
  where it used to be worth 0.3% of them. That is a deliberate statement in the
  other direction and it is defensible in fight terms: a dead attacker stops
  shooting for the rest of the engagement and her pools come back while it does
  not.
- *Finishing was worth less than dawdling* (63's inversion, above). Both halves
  are CUMULATIVE — `1 - targetDamageShare()` and
  `Episode.attackerDamageShare()` — so a pilot who clears the fight at 26s is
  not scored on how long she then had to heal.
- *Surviving was the only thing that counted.* It still gates everything: an
  episode she does not come out of is worth zero. Since 62 that column
  discriminates (4-6 in 240) instead of saturating.

The fighting half is a SHARE OF THEIR BANKS, not a kill count — the same
argument `targetDamageShare` already makes on the pirate side, that a rare
binary cannot rank anything. Measured over the validation seeds it separates
what the kill count cannot: `jameson-defend-g1` reads 22.7% there against a 3.5%
kill share.

### The ratio, stated

`SHAPED_SHARE = 0.25`: the shaping term may MOVE a genome's score by at most a
quarter of the score's range, over a per-phase `SHAPED_FULL_SCALE` measured from
the reference pilots and written down beside the constant. It was `±499` on a
quantity that ranges 8 to 19, which contributed **1.9%** and could never break a
tie. `test/selection.test.ts` asserts the swing is exactly 0.25 for all four
phases, and that an outcome gap wider than it cannot be bought back with shaped
fitness — which is what "break ties WITHIN an outcome band" always meant.

### The test, on two hand-built genomes

`test/selection.test.ts` builds two policies by hand — no training, no weights
file — that differ in **exactly one number**, the bias on the fire head. Same
flying, same seeds, same dice; one pulls the trigger. Over 24 held-out fights:

| | shots | broke | killed | cleared | damage taken | terminal hp | OLD score | NEW score |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| turret | 142 | 82.0% | 71.9% | 15/24 | **263** | **89.2%** | **910.6** ← last | **0.7744** ← first |
| pacifist | 0 | 0.0% | 3.5% | 0/24 | 305 | 92.4% | 936.5 ← first | 0.4266 |

Both defects in one pair: turning the trigger OFF on the same genome bought 26
points of the old score, and the pilot that is hit LESS ends with LOWER terminal
`hp` because clearing the fight ends the episode early. The test asserts the new
ordering AND the old inversion, so putting the old rule back fails here.

### `evade` got a different fix, and says so

It shares `outcomeOf` and it does not share a definition of winning. An evader's
job is to be somewhere else, so its outcome is the share she kept and has **no
fighting term at all** — but it takes the two fixes that do apply to it:
cumulative rather than terminal (escaping ends the episode early too), and zero
if she died. Whether GETTING CLEAR belongs in the outcome is left open in the
file, with the reason: nothing in the game flies an evade policy, so there is no
run to judge the answer against.

### The retrain: three runs, one fighter, and a hold

300 generations, population 48, 3 episodes, `--validate-select`, against the
scripted attack run:

| run | flags | validation outcome | kept | broke | throttle |
| --- | --- | --- | --- | --- | --- |
| `t65a` | `--select-kills` | 0.475 | 68.1% | 16.5% | 87% |
| `t65b` | (shaped ranking) | 0.410 | 63.6% | 7.0% | 5% |
| `t65c` | `--select-kills --seed-brain jameson-defend-g1` | **0.642** | 68.7% | **65.0%** | 49% |

`npm run defence-probe -- 120 ...`, 240 held-out episodes each, and 800 for the
outcome columns:

| brain | pools left | **broke** | **killed** | died | kept (cumulative) |
| --- | --- | --- | --- | --- | --- |
| `jameson-defend-g1` (shipped) | 90.1% | 16.5% | 5.7% | **19/800** | 63.3% |
| `jameson-defend-t65a` | **94.3%** | 5.8% | 1.4% | **4/800** | **70.7%** |
| `jameson-defend-t65b` | 91.2% | 5.1% | 2.3% | 3/800 | 63.3% |
| `jameson-defend-t65c` | 89.7% | **57.8%** | **41.0%** | 42/800 | 66.5% |

**The rule does what it was changed to do.** On all three seed sets — the
validation base and both held-out bases — the OLD rule ranks the 42%-kill
fighter LAST and the new rule ranks it FIRST:

```
held-out (8,675,309), 240 episodes
brain                  terminal hp   shaped    OLD score   NEW score   kill%
jameson-defend-g1        91.2%     8.55      920.9     0.4410    6.3%
jameson-defend-t65a      95.3%    11.62      964.2     0.4873    1.8%   <- old rule's pick
jameson-defend-t65b      91.4%    12.19      926.2     0.4511    3.4%
jameson-defend-t65c      89.9%    14.49      913.3     0.6480   42.5%   <- new rule's pick
```

**`t65c` was NOT promoted.** It kills 6.8x what the incumbent kills and takes
LESS cumulative damage doing it (66.5% of her pools kept against 63.3%) — and it
is destroyed in **42 of 800 held-out fights against 19**, which is a real
difference (z ~ 3.0) and not equal survivability. The acceptance criterion is
"better kills AT equal survivability" and this is a trade, in the one currency
the outcome itself refuses to trade.

**What the deaths are, which is the part worth carrying forward.** Every death,
for every brain, has a warhead in it — 19 of 19, 4 of 4, 42 of 42. Without a
missile landing, no defence policy has ever died in these 800 episodes. So the
column the promotion turns on is **entirely docs/TODO/72's**: she has no E.C.M.
and no output that could press one, so a warhead in training is undodgeable. And
`t65c` draws MORE of them (0.64 launched at her an episode against g1's 0.59,
`t65a`'s 0.27) precisely because it kills packmates, which is what
`NpcShip.chooseWeapon` launches on. Deciding this trade needs a world where a
missile can be answered, and a fight a human flew — neither of which this session
had.

The weights are reproducible in eight minutes from the command in
docs/TRAINING-LOG.md, and `train/logs/jameson-defend-t65*.jsonl` are the record.

### What is still in the way, and it is not this item

- **docs/TODO/71** bounds the fighting half. `observe()` is fourteen numbers and
  own health is not one of them, so nothing in the 14-input family can break off
  when hurt: `t65c` is the aggressive end of a health-BLIND family, and "fight,
  take the damage, break off while the shields come back" is still not a policy
  the search can express. The kill rate this item unlocked is the ceiling of
  that family, not of the phase.
- **docs/TODO/72** owns the column above. Until she can answer a missile,
  `died` measures how many warheads a policy attracts.
- **docs/TODO/74** sits under every `broke` and `killed` figure here: the
  episode's armed FREIGHTER lands about 51% more of its shots than the game's
  would. It does not touch the `playerCobra` rows, which fire the commander's
  own deterministic laser, and the `traderCobra` row is the one to distrust.
