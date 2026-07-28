# AI Training Log

Every training run, its setup, and what came out. Requires Node ≥ 22.6.
Reproduce any run with the command shown. The whole trainer path is seeded
(mulberry32, single-threaded, no Math.random) — a rerun with identical CLI
args is bit-identical **on the same Node build/platform**; across platforms
expect tiny drift (Math.tanh/acos are not correctly-rounded by spec).
League/defend rounds load their frozen opponents from `src/sim/brains/` —
rerun them against the **committed** round-1 brains (or archived copies),
because retraining a phase overwrites its committed brain file.

## Infrastructure

- **Simulator**: `src/sim/core.ts` — render-free flight + laser model
  mirroring the game's numbers (ship classes from `npc.ts`, pulse-laser model
  from `game.ts`). Deterministic: seeded mulberry32 RNG, fixed dt = 1/15 s.
- **Policy**: `src/sim/policy.ts` — MLP 14 → 32 → 32 → 11 (tanh), 1,899
  parameters. Observation is ship-frame relative (see file docstring).
  Discrete action heads: pitch ±/0, roll ±/0, throttle ±/0, fire y/n —
  exactly the keyboard interface a human gets.
- **Trainer**: `train/evolve.ts` — population evolution strategy.
  Elites survive unchanged; offspring are gaussian mutations of elites at
  σ ∈ {0.02, 0.06, 0.15}; every genome in a generation is scored on the same
  episode seeds (common random numbers). `npm run train -- <phase> [--gens N
  --pop N --eps N]`. Logs to `train/logs/<phase>-<timestamp>.jsonl`.
- **Baseline**: the scripted game AI (perfect continuous steering toward the
  target — policies only get discrete keys, so matching it is non-trivial).

## Run 1 — pirate attack policy

    npm run train -- attack --gens 400 --pop 64 --eps 3

- **Scenario**: one policy pirate (Cobra) vs the scripted trader (wanders,
  flees at max speed once hit). Episode 45 s.
- **Fitness**: `6·damage + kill bonus (8 + up to 4 for speed) +
  0.05·engaged-time − 0.03·shots − 2·damage-taken`.
- **Result**: **18.36** vs scripted-AI reference **18.34** — parity with the
  hand-written hunter, learned from scratch in 210 s of CPU time.

| gen | best | mean | scripted ref |
| --- | --- | --- | --- |
| 0 | 11.97 | −0.48 | 18.32 |
| 40 | 16.72 | 5.55 | 18.34 |
| 120 | 17.72 | 7.01 | 18.35 |
| 200 | 17.77 | 6.83 | 18.37 |
| 399 | 17.86 | 6.98 | 18.34 |

Observed behaviour (viewer): straight-line intercept, throttle management on
approach, then close-range pursuit with constant gunfire once inside the
cone. Accuracy typically 60-80%.

## Run 2 — trader evade policy (self-play vs Run 1)

    npm run train -- evade --gens 400 --pop 64 --eps 3

- **Scenario**: policy trader (unarmed Cobra, slower and less agile) vs the
  **trained** Run-1 pirate. Episode 45 s.
- **Fitness**: `10·(survival time / max) + 5·hp remaining + distance bonus
  (≤2)`. Max ≈ 17.
- **Reference**: the *scripted* trader scores ≈ **0.5-1.2** against the
  trained pirate — it dies almost immediately.
- **Result**: **14.44** after 400 generations (410 s CPU) — the evolved
  evader survives most or all of an episode that slaughters the scripted
  trader. Curve: best ≈ 13.8 by gen 130, slow polish thereafter.

| gen | best | mean | scripted trader ref |
| --- | --- | --- | --- |
| 0 | ~3 | ~1 | 0.9 |
| 130 | 13.79 | 11.47 | 0.88 |
| 230 | 14.43 | 11.48 | 1.23 |
| 400 | 14.44 | ~11.7 | ~0.8 |

## Artefacts

- `src/sim/brains/*.json` — six brains, each with meta (fitness, date,
  hyperparams): `pirate-attack`, `pirate-attack-r2` (shipped, pirates),
  `trader-evade`, `trader-evade-r2`, `pirate-pack`, `jameson-defend`
  (shipped, armed traders)
- `train/logs/*.jsonl` — per-generation best/mean/worst fitness curves
- `train/logs/tournament-final.txt` — the held-out tournament table

## Watching the results

`npm run dev` → http://localhost:5173/viewer.html — scenarios: shipped
pirate (r2) vs trader · scripted pirate (old AI) · random policy (untrained
baseline) · r2 vs trained evader · pack of 3 solo-brains vs armed trader ·
pack-trained vs armed trader · Commander Jameson (defence AI) vs 2 pirates.
Orbit/chase cameras, pause, 0.25×/1×/4× speed, auto-restart with a new seed.

## Follow-ups — all three since completed

- ✅ **Pack phase** — Run 4 below (result at the time: underperforms solo
  brains). **Superseded by Run 7**: that verdict was a trainer bug, not a
  property of pack policies. See the bottom of this file.
- ✅ **League play** — Run 4 below (r2 pirate: 0% → 98% vs the evader).
- ✅ **In-game integration** — pirates fly `pirate-attack-r2`, armed traders
  fly `jameson-defend` (Run 5); toggle with `window.__scriptedPirates`.
  The pack brain is wired into the game too (`window.__packBrain = true`
  switches every pirate to the 18-input policy) but is **off by default**.
  The toggle now loads Run 7's `pirate-pack-r4-selectonly`, which takes 100%
  against all three test traders — the reason it isn't the default is no
  longer that it's worse (it isn't), but that it is 4-7x faster to kill,
  which is a balance decision. See Run 7.

## Run 3 — evaluation methodology (how we tell it works)

`train/evaluate.ts` — the tournament that decides whether a brain ships:

1. **Held-out seeds.** Training consumes seeds `gen·977 + e·131 + 7`
   (< ~400k); evaluation starts at seed 10,000,019. A policy that scores well
   here generalises — it cannot have memorised these episodes.
2. **Baselines on the same seeds.** Scripted AI (note: it is an upper-bound
   *aimbot* — perfect continuous steering and deterministic cone hits, better
   than the probabilistic gunnery real NPCs get in-game) and an untrained
   random policy (floor).
3. **Behaviour metrics**, not just the training fitness: kill rate,
   time-to-kill, shot accuracy, trader survival time, pirates lost, and
   attacker angular spread at hit moments (the flanking measure).

### Baseline tournament (round-1 brains, 40 held-out episodes/matchup)

| matchup | kill | t-kill | acc | t-surv |
| --- | --- | --- | --- | --- |
| scripted pirate vs scripted trader | 100% | 1.8s | 100% | 1.8s |
| random policy vs scripted trader | 0% | — | 2% | 45.0s |
| **trained pirate r1** vs scripted trader | **100%** | 6.0s | 32% | 6.0s |
| scripted pirate vs **trained evader** | 100% | 1.8s | 100% | 1.8s |
| **trained pirate r1 vs trained evader** | **0%** | — | 4% | 45.0s |

Findings:

- **Generalisation confirmed**: r1 pirate kills 100% of episodes it has
  never seen (vs 0% for the random floor).
- **The arms race is real and visible in one table**: r1 pirate dominates the
  scripted trader, and the co-trained evader dominates the r1 pirate. This
  is the textbook self-play cycle — hence the league round (below).
- The scripted "aimbot" beating the evader is expected: it snap-aims and
  lands deterministic hits from spawn range before the evader can open
  distance. In-game NPCs use probabilistic gunnery, so the realistic
  difficulty band is the policy-vs-policy one.

## Run 4 — pack phase + league round 2 (chained)

    npm run train -- pack --gens 300 --pop 48
    npm run train -- attack --opponent trader-evade --seed-brain pirate-attack \
        --out pirate-attack-r2 --gens 300 --pop 48
    npm run train -- evade --opponent pirate-attack-r2 --seed-brain trader-evade \
        --out trader-evade-r2 --gens 250 --pop 48
    node --experimental-strip-types train/evaluate.ts 40   # final tournament

- Pack policy uses the 18-input observation (solo 14 + nearest packmate
  direction and distance); shared reward: team damage + kill bonus +
  survivors − shots − damage taken. League rounds are *seeded from the
  previous champion* (`--seed-brain`) so they refine rather than restart.
- Results: appended below when the chained run completes
  (`train/logs/tournament-final.txt`).

### Run 4 results — final tournament (40 held-out episodes per matchup)

Full table: `train/logs/tournament-final.txt`. Headlines:

| matchup | kill | t-kill | acc |
| --- | --- | --- | --- |
| pirate **r1** vs scripted trader | 100% | 6.0s | 32% |
| pirate **r1** vs trained evader | **0%** | — | 4% |
| pirate **r2 (league)** vs scripted trader | 90% | 21.7s | 19% |
| pirate **r2 (league)** vs trained evader | **98%** | 18.6s | 22% |

- **League play worked**: one round of self-play (seeded from r1, trained
  against the evader) took the evader matchup from 0% → **98%** kills.
- **Specialisation cost observed**: r2 is slower against the easy scripted
  trader (90%/21.7s vs r1's 100%/6.0s) — classic catastrophic-forgetting-lite.
  Known fix for round 3: evaluate each genome against a *mixed opponent pool*
  (scripted + all frozen evader checkpoints) instead of a single opponent.
- **Ship decision**: the game's pirates fly **r2** (`src/game/npc.ts`) —
  robust against both target types, and human players fly evasively. Toggle
  the old scripted AI with `window.__scriptedPirates = true`.

**Pack phase (honest reading)**: fitness hit the scripted-pack reference
(25.04) in training, but on held-out seeds the pack-trained brain killed in
only 70% of episodes (though *when* it kills, it's the fastest at 0.6s — an
all-in alpha-strike strategy), versus 100% for three copies of the solo
brain. The flanking-spread metric (91°) shows spawn geometry already spreads
attackers; packmate observations didn't add coordination beyond it yet. The
solo-brain trio remains the better pack for now. Round-3 ideas: reward
sustained pressure (damage-per-second window) rather than survivors, drop
the shot penalty (it appears to teach timidity in the 30% of episodes the
rush fails), and randomise pack size 2-4 during training.

## Run 5 — the Commander Jameson defence policy

    npm run train -- defend --gens 300 --pop 48   # opponent: 2x pirate-attack-r2

Born from the Jameson Trials (docs/JAMESON-TRIALS.md): the trade economy
works, but an unarmed non-fighting trader dies to pirates. So we trained the
trader to fight: an **armed** policy trader vs **two** shipped r2 pirates —
the hardest opponents in the stable. Fitness: `8·survival + 4·hp +
4·damage-dealt + 3·pirates-killed − 0.02·shots`.

Training: best 22.42 vs scripted armed trader's ~1-2 on the same seeds
(340 s CPU). Held-out tournament (40 episodes, 2x r2 pirates):

| trader | died | mean survival | enemy accuracy | pirates shot down |
| --- | --- | --- | --- | --- |
| scripted armed trader | **100%** | 14.0s | 20% | 0.00/ep |
| **JAMESON defence policy** | **10%** | 41.9s / 45s | **1%** | **0.53/ep** |

The policy is evasion-first: it holds enemy accuracy to 1% (vs 20% against
the scripted trader) and guns down an attacker roughly every other episode.

**Shipped in-game**: armed traders (Cobra, Python, Anaconda) now fly this
brain when attacked — by pirates *or by you*. Attack a Python and it fights
like a 90%-survival commander, not a fleeing target. Small traders (Adder,
Worm) still just run. `window.__scriptedPirates = true` disables all brains.

## Run 6 — AI round 3: two hypotheses, two refutations

    npm run train -- pack --out pirate-pack-r3 --gens 300 --pop 48
    npm run train -- attack --opponent trader-evade-r2 --seed-brain pirate-attack-r2 \
        --out pirate-attack-r3 --gens 250 --pop 48
    npm run evaluate 40                    # → train/logs/tournament-r3.txt

### Hypothesis 1: reshape the pack reward (refuted)

Run 4's pack learned an all-in alpha strike — fastest kill in the stable
(0.6s) but only 70% of episodes. The training log blamed the survivor bonus
and shot penalty for rewarding one decisive gamble over sustained pressure,
and proposed three fixes, all applied here:

- reward **damage per second of engagement** (`30·damage/max(4,t)`)
- **drop the shot penalty** entirely (it appeared to teach timidity)
- **randomise pack size 2-4** during training so the policy can't overfit
  to exactly three ships

Training fitness rose from 25.04 to **32.45** (the new terms are worth
more, so the numbers aren't comparable). On held-out seeds:

| pack | kill | t-kill | acc |
| --- | --- | --- | --- |
| 3× scripted | 100% | 0.7s | 100% |
| 3× solo r1 brains | **100%** | 1.6s | 43% |
| pack-trained r2 | 70% | 0.6s | 9% |
| **pack-trained r3** | **68%** | 0.7s | 3% |

No improvement — 68% against r2's 70%, with accuracy *falling* from 9% to
3%. The reward reshaping moved the training score without moving the
behaviour. Conclusion: **the bottleneck is not the reward function.** More
likely the observation: a pack policy sees only the nearest packmate's
bearing and distance, which is too thin to coordinate on — no sense of
whether a mate is engaged, damaged, or lining up its own pass. Round 4, if
attempted, should widen the observation before touching rewards again.

**Three copies of the solo brain remain the shipped pack.**

### Hypothesis 2: a third league round (refuted, instructively)

Seeding from the r2 champion and training against the trained evader
produced fitness 18.40 — nominally the best attack score yet — and a
policy that is nearly useless:

| pirate | vs scripted trader | vs trained evader |
| --- | --- | --- |
| r1 | 100% kills | 0% |
| **r2 (shipped)** | **90%** | **98%** |
| r3 | **3%** | **0%** |

This is a textbook self-play failure: the r2 evader it trained against is
*very* good at running away, so the fitness landscape rewarded closing
behaviour that scores points without ever landing kills, and the policy
walked off the cliff. Training fitness went up; every behavioural metric
went down.

It is the strongest argument yet for the evaluation harness. Both runs
looked like successes from inside the trainer; only held-out cross-play
against baselines exposed them. **The r2 brains stay shipped**, and the
r3 weights are kept in `src/sim/brains/` purely as evidence.

### What would actually help next

1. **Wider pack observations** (mate health, mate engagement, target's
   relative bearing to each mate) — the coordination signal is missing.
2. **Opponent pools rather than single opponents** in league rounds: score
   each genome against scripted + r1 + r2 evaders, so it cannot specialise
   into uselessness.
3. **Behaviour-metric-based selection** — select on tournament kill rate
   rather than shaped fitness, now that the tournament is cheap.

## Run 7 — AI round 4: the plan was wrong, and that's the result

    # the winner
    npm run train -- pack --validate-select --select-kills \
        --out pirate-pack-r4-selectonly --gens 400 --pop 48 --eps 6
    # ablations (each identical but for one flag)
    npm run train -- pack --validate-select --out pirate-pack-r4-control  --gens 400 --pop 48 --eps 6
    npm run train -- pack --validate-select --wide --out pirate-pack-r4-wideonly --gens 400 --pop 48 --eps 6
    npm run train -- pack --validate-select --pool --out pirate-pack-r4-poolonly --gens 400 --pop 48 --eps 6
    npm run train -- pack --validate-select --wide --pool --select-kills --out pirate-pack-r4 --gens 400 --pop 48 --eps 6
    # the isolation run: run 4's exact hyperparameters, one variable changed
    npm run train -- pack --validate-select --out pirate-pack-r4-isolate --gens 300 --pop 48
    npm run evaluate 200

Round 4 was supposed to test the three ideas at the end of run 6. It did.
Two of them did nothing. The thing that actually mattered was a bug in the
trainer that had been quietly corrupting runs 4 and 6.

### The bug: we were saving the wrong brain

The trainer kept the genome with the best score *ever seen*:

```ts
if (scored[0].f > bestFitness) { bestFitness = scored[0].f; best = scored[0].g; }
```

Every generation draws **fresh episode seeds**. So that comparison is across
different exam papers — it doesn't find the best genome, it finds the
luckiest generation, and then keeps whatever won it. The harder the seeds a
genuinely good champion faced, the less likely it was to be saved.

The fix (`--validate-select`) re-judges every generation's champion on **one
fixed validation seed set** at the end, distinct from the training stream
*and* from the tournament's held-out base — selecting on the tournament
seeds would turn the tournament into a training set.

The isolation run settles it. Run 4's exact command, changing only this:

| pack of 3 vs armed scripted trader | kill | t-kill |
| --- | --- | --- |
| pack r2 (run 4, shipped as evidence) | 71% | 0.6s |
| pack r3 (run 6) | 67% | 0.7s |
| **run-4 config, fixed selection** | **100%** | **2.9s** |

Same observation, same single scripted opponent, same shaped fitness, same
300 generations, same population. **Runs 4 and 6 never showed that packs
can't coordinate. They showed that the trainer was throwing the good ones
away.** Both write-ups above stand as what we believed at the time; this is
the correction.

### The ablation (200 held-out episodes per matchup)

All five runs share the fixed selection, so each row varies one thing.
"unseen" is the honest column — `trader-evade` r1 is in nobody's pool,
whereas r4's pool contained jameson-defend and trader-evade-r2.

| pack of 3 | vs scripted | vs jameson-defend (seen) | vs evade-r1 (unseen) |
| --- | --- | --- | --- |
| 3x solo r2 brains (SHIPPED) | 100% / 10.8s | **41%** / 23.2s | 100% / 11.7s |
| pack r2 (run 4) | 71% | 100% | 75% |
| pack r3 (run 6) | 67% | 96% | 67% |
| control (none of the three) | 100% / 2.1s | 97% | 99% |
| + wide observations | 99% | 100% | 100% / 4.9s |
| + opponent pool | 99% | 100% | 95% |
| **+ kill-rate ranking** | **100% / 1.5s** | **100% / 0.8s** | **100% / 2.9s** |
| all three | 100% / 1.9s | 99% | 99% |

Verdict on each idea from run 6's list:

1. **Wider pack observations — no real effect.** 26 inputs (mate health,
   engagement, flank bearing) scored 99/100/100 against the control's
   100/97/99. Within noise. The coordination signal was not the bottleneck;
   the missing coordination was never in the policy in the first place.
2. **Opponent pools — mildly harmful.** 95% on the unseen opponent, the
   worst of the five. Training against jameson-defend and trader-evade-r2
   bought performance against *those* and cost generality.
3. **Kill-rate ranking — this one worked.** Ranking genomes within a
   generation by kills (ties broken on shaped fitness) is the only change
   that improved on the control everywhere, and it produced the first pack
   brain to take 100% against all three traders.

### What ships

Nothing, yet — deliberately. `pirate-pack-r4-selectonly` is the best pack
policy the project has produced, and unlike r2/r3 it beats the shipped
configuration on the metric that matters most (the shipped solo trio only
manages **41%** against a trader that fights back, losing 0.56 ships per
episode; the r4 brain takes 100% in 0.8s losing none).

But it kills a *player-like* target in 1.5-2.9s where the shipped trio takes
10.8-11.7s. That is 4-7x more lethal, and whether Elite's pirates should be
that deadly is a game-design question, not a tournament question. It is
wired in behind `window.__packBrain = true` for playtesting; the default is
unchanged pending a balance decision.

### Methodological notes

- The first ablation matrix was **discarded**: it was launched from a zsh
  function passing `"--wide --pool --select-kills"` as one unquoted
  parameter. zsh, unlike bash, does not word-split those — node received a
  single meaningless argument, npm echoed it unquoted so the command
  *looked* right, and the "all three" run silently trained as the control.
  Caught because two rows were identical to the decimal across 18 metrics.
  Every run in the table above was re-run with the flags as separate
  arguments and its actual `obs=` and pool size audited from its log.
- The three experiment flags default off, so runs 1-6 still reproduce.

## Known gap — the sim has no collision model

Reported from play: "the enemy ship flies towards me, then goes behind and
seems to kamikaze into me."

`src/sim/core.ts` has no collision detection. `radius` appears in the ship
classes but is used only to size the laser cone (`core.ts` line ~191).
Two ships may occupy the same point at no cost.

So in training, flying *through* the target is free, and the optimal learned
behaviour is to close to zero range and sit there shooting. In the game,
where ships are solid and a collision deals 0.45 to both, that reads as
deliberate ramming.

They are **not** being rewarded for it. 0.45 is absorbed by a shielded
player and very nearly kills a 0.55 hp Sidewinder — measured pre-fix, one
of three attacking pirates destroyed itself in 80 seconds. The policy was
simply never taught that ramming is a bad idea.

Compounding it, `attack()`'s 220-unit break-off — added long ago precisely
to stop scripted ships ramming — was unreachable for brain-flown ships,
because `brainFly()` returns before `attack()` is ever called.

**Guard rail shipped** (`RAM_GUARD` in `game/npc.ts`): inside 220 units a
trained pirate hands back to the scripted break-off. Measured over 80 s of
3-v-1 combat:

| | collisions | closest approach | pirates surviving |
| --- | --- | --- | --- |
| before | 3 | 43 (the collision threshold) | 2 of 3 |
| after | 0 | 99 | 3 of 3 |

**UPDATE — the collision model shipped; the retrain turned out to be
unnecessary.** See "Collision round" at the end of this file.

**The original plan was a collision model in `sim/core.ts` plus a retrain.** That
is a sim/game parity issue (CLAUDE.md invariant 2) and the shipped brains
were all fitted without it, so every one of them would need re-validating
through the tournament. Worth doing as its own round: it would let the
policies learn deflection and break-off themselves rather than having the
game override them at knife range.

## Collision round — ships are solid, and the retrain that wasn't needed

`sim/core.ts` now has `COLLISION` + `resolveCollision`, and `Episode.step`
resolves every pirate-trader and pirate-pirate pairing. The game gained
NPC-vs-NPC collisions to match (it previously only collided the *player*
with NPCs, so ships visibly flew through each other).

Asymmetric, mirroring the game: the ship that flew into someone takes 0.45,
the victim takes 0.12. In `game.ts` the player's fore/aft shields absorb
collision damage before the hull sees any, so ramming is heavily weighted
against the pirate; a symmetric model punished the *victim* for being hit,
which is not what the game does.

### What the retraining actually showed

The whole chain was retrained five times against the new physics. Every
attempt produced brains that failed the shipped-brain assertions — and then
the committed, pre-collision brains were tested against the new sim and
passed everything:

| | kill rate | Jameson dies | collisions/episode |
| --- | --- | --- | --- |
| committed brains, collision sim | 100% | 17% | **0.00** |

**The collision model did not invalidate the shipped brains.** They already
fly clear of the target, so a rule that punishes contact costs them nothing.
The retrains were the problem, not the physics.

### Two real bugs the attempts exposed

1. **Inverted selection polarity.** `validate()` (and the `--select-kills`
   ranking) scored every phase by "did the trader die". In the `evade` and
   `defend` phases **the genome IS the trader**, so both were selecting the
   brain that died *most often*. This is why `trader-evade` fell from 14.44
   to 2.09 and `jameson-defend` from 22.43 to 1.34 — blamed on the physics
   for four rounds before the polarity was spotted. Both now branch on
   phase.
2. **Widening `LASER.aim` for the player broke NPC training.** Raising it
   1.6 → 2.4 to make the *player's* shots forgiving also made every NPC 50%
   more accurate in training, and evasion stopped working (evader 14.44 →
   2.74, Jameson 22.43 → -0.14). `LASER.aim` governs NPC gunnery on both
   sides and must not be used as a player-difficulty dial — the player's
   gunnery is a ray test in `game.ts` and is not modelled here at all.

### Also tried and reverted: a global agility nerf

Pirates out-turn the player badly (NPC pitch is `turnRate × 1.4`, so a
Sidewinder gets 1.54 against the player's old 1.1 — 40% better). Cutting
`TURN` to 1.15/2.0 was tried and **reverted**: it leaves the pirate/trader
*ratio* untouched while lowering absolute turn rates, and evasion depends on
absolute agility far more than aggression does. The Jameson defence went
from dying in 10% of 2v1 fights to 92% — no better than an unarmed trader.

Fixed instead by raising the **player** (`MAX_PITCH` 1.1 → 1.45, `MAX_ROLL`
2.0 → 2.5 in `player.ts`), which costs no retrain and cannot break parity,
because the player's flight model is not simulated. The player now out-turns
a pirate Cobra and a Krait, matches a Mamba, and is still edged by a
Sidewinder and an Asp.

## Run 8 — validating run 7 and shipping the pack brain to gangs

    npm run evaluate
    npm run campaign
    npm run campaign -- 4 45000 all

No training. Run 7 had already produced the brain and the ablation; what was
outstanding was the thing run 7 explicitly deferred — "whether Elite's pirates
should be that deadly is a game-design question, not a tournament question" —
and the documentation, which still said nothing shipped.

### Validation reproduces run 7

Held-out tournament, re-run from scratch today:

| pack of 3 vs jameson-defend | kill | t-kill | pirates lost |
| --- | --- | --- | --- |
| 3x solo r2 brains (previous default) | 60% | 14.3s | 1.52 |
| pack r2 (run 4) | 100% | 0.7s | 0.00 |
| **r4 +kill-rate ranking (selectonly)** | **100%** | **0.7s** | **0.02** |

The ordering from run 7 holds. One number is worth restating more sharply
than run 7 did: against a target that *fights back*, the pack brain is not
"4-7x faster to kill", it is **20x** — 0.7s against 14.3s — and it stops
losing ships entirely (1.52 per episode down to 0.02). Run 7's 4-7x figure
came from the softer traders.

### What ships, and the reasoning

`pirate-pack-r4-selectonly` is now live for **organised gangs only**:

```ts
const pack = PACK_BRAIN && (this.organised || packBrainEnabled());
```

Opportunists and professionals keep the solo brain. A tier-2 gang of three or
more flies the pack policy. This reuses the threat tiers rather than adding a
switch: `organised` already means "they had both a reason and the numbers to
bother forming", which is exactly the fight that should be terrifying.

The escalation this produces, measured over 20,000 receptions per row:

| commander | anarchy system | democracy system |
| --- | --- | --- |
| new | 0.0% organised | 0.0% |
| Competent | 7.5% | 2.7% |
| Dangerous | 25.6% | 18.3% |
| E L I T E | 33.1% | 33.0% |

A new commander never meets one, which matters more than the top of the
table: the most lethal AI in the project is unreachable until the player has
earned the attention. Confirmed against full careers — an ordinary 60-leg
trader sees **0.6 organised gangs per career**, while a bounty hunter run all
the way to E L I T E sees 34% of receptions as gangs and a privateer 45%.

### The limit of this evidence — read before trusting it

`npm run campaign` passes every balance check at both scales, and that is
worth **less than it appears**. The campaign abstracts flight. It models the
economy, the market, contracts and the living galaxy, so it can tell us that
gang encounters do not bankrupt anyone and that careers still complete. It
cannot model a 0.7-second time-to-kill, because it never simulates the
dogfight at all.

So the shipped configuration is validated on frequency and on economics, and
is **unvalidated on survivability in real flight**. The tournament says a
gang of three kills a competent defender in under a second; whether the
player, in a Cobra with military lasers and an energy unit, fares better than
the sim's trader hull is untested. If gangs turn out to be unsurvivable, the
lever is the `organised` roll in contracts.ts — make gangs rarer, or smaller,
or drop the pack brain to tier 2 groups of 4+ — not the brain, which is doing
exactly what it was trained to do.

test/playtest.js is the harness that could answer it, since it flies the real
game with the defence brain.

### Correcting the number the balance decision was resting on

    npm run survivability

The 0.7s kill above is measured against `CLASSES.traderCobra`, hp 1.0 — and
`core.ts` says it outright: "The sim has no shields." The player has two, plus
an energy bank that absorbs overflow. From game.ts's `applyPlayerDamage`: each
shield soaks 1.0, then damage costs energy at 2 per point against a bank of 4,
so a commander taking hits on one face soaks **3.0** raw damage and one
manoeuvring so both shields work soaks **4.0**, against the sim trader's 1.0.

The tournament defender is roughly a third as durable as the commander flying
it. That is correct for *training* — shields would have to exist in both the
sim and the game to hold invariant 2, and every brain was fitted without them
— but it is the wrong number to make a balance decision from.

`train/survivability.ts` leaves the sim alone and corrects only the defender's
hp. 200 episodes per cell, on a seed base distinct from both the training
stream and evaluate.ts's held-out base:

| gang of 3, defender flies jameson-defend | pack brain | solo brain |
| --- | --- | --- |
| hp 1.0 — sim trader (what the tournament measures) | 99% in 0.6s | 60% in 15.9s |
| hp 3.0 — player, hits on one face | **50% in 4.5s** | 2% in 21.6s |
| hp 4.0 — player, manoeuvring | **38% in 4.4s** | 0%, never |

| gang of 4 | pack brain | solo brain |
| --- | --- | --- |
| hp 1.0 | 100% in 0.3s | 85% in 13.2s |
| hp 3.0 | 75% in 4.0s | 2% in 23.0s |
| hp 4.0 | 59% in 3.8s | 0%, never |

**The alarm was an artefact.** A gang of three is not a 0.7-second execution;
it is a coin-flip fight lasting four and a half seconds, which is time enough
to burn ECM, run for the station, or engage the torus drive. Four of them at
59-75% is a fight you should probably decline, which seems right for the
rarest reception in the game.

The same table makes the opposite case just as strongly, and this is the part
that justifies gangs existing at all: **opportunists flying the solo brain
kill a properly shielded commander 0-2% of the time, and at hp 4.0 never once
in 200 episodes.** Ship only the solo brain and a commander with working
shields has no opponent. The tier split is not gilding, it is the only thing
putting any threat in the late game.

Still not flown in the real game. Every omission here favours the player —
ECM, escape pod, torus drive, RAM_GUARD breaking pirates off at knife range,
and a player Cobra more agile than `traderCobra`'s 0.5 turn rate — so 50%
is a floor, not an estimate. Regeneration is ignored for the same reason
(0.035/s per shield is under a tenth of a point across a fight this short).

### Flown, at last — and the sim was wrong in the other direction

    fetch('/test/gang-trial.js').then(r => r.text()).then(eval)
    await __gangTrial.run({ trials: 12, gang: 3, maxT: 30 })
    await __gangTrial.run({ trials: 12, gang: 4, maxT: 60 })

`test/gang-trial.js` spawns real tier-2 gangs in the real game — real hull
table (imported from npc.ts, not copied, so it cannot drift), real missiles,
real collision and RAM_GUARD — and flies the player with the same
`jameson-defend` policy the tournament used. 12 trials per row:

| commander | gang | for | died | killed | energy left |
| --- | --- | --- | --- | --- | --- |
| military laser, energy unit | 3 | 30s | **0%** | 0.2 of 3 | 3.99 of 4 |
| military laser, energy unit | 4 | 60s | **0%** | 0.9 of 4 | 4.00 of 4 |
| pulse laser, NO energy unit | 3 | 60s | **0%** | 0.1 of 3 | 4.00 of 4 |

Not one death in 36 fights. The energy bank was never meaningfully touched —
in most trials the fore shield alone absorbed everything, and it dipped below
half in only 5 of 36. A gang of four for a full minute did not land a single
point of hull damage.

**Both earlier estimates were wrong, and in opposite directions.** The
tournament said 100% dead in 0.7s, because its defender was a shieldless
traderCobra. survivability.ts corrected the durability and said 50% dead in
4.5s. The real game says 0%.

The factor both missed is **shield regeneration**. Each shield recovers
0.035/s, so a 60-second fight regenerates 2.1 per shield — more than a
commander's entire nominal durability of 3.0-4.0. I explicitly dismissed
regeneration in survivability.ts as "under a tenth of a point across a fight
this short", reasoning from the sim's 4.5s kill time. That was circular: the
fight is only short *if* the model is right about lethality. Real fights last
minutes, and over minutes regeneration is not a correction to the durability
number, it dominates it.

The pulse-laser row is the one that matters for balance, because it is the
commander who can *just* start meeting gangs. Even that one is in no danger.
So the concern recorded in CLAUDE.md — that gangs might be unsurvivable — is
refuted. If anything the tier-2 gang is now too weak, and that is the question
worth taking to a real playtest.

Caveats, both pointing the same way this time: the defence brain evades
expertly and shoots badly (0.1-0.9 kills per fight), so these are stalemates
rather than wins — a human flying aggressively would take far more hits than
this policy does, and would also kill far faster. And the harness caps
pitch/roll at 0.7/1.2 where the real player has 1.45/2.5.

## Correction — "the shipped brains fly clear of the target" is not general

Reported from watching the viewer: ships colliding.

The collision round above concluded that the committed brains needed no
retraining, on the strength of one line: **collisions/episode 0.00**. That
number is real, and it is also incomplete. It was measured against the scripted
trader and the Jameson matchups. Nobody measured pirate against trained
*evader*, which is a scenario the viewer offers by name.

Measured now, 200 episodes each, counting contacts from the damage ledger
rather than from ship separation. Separation cannot see them: resolveCollision
runs inside the step and shoves the ships apart before any test outside the
step could sample an overlap. My first attempt at this measurement reported
0.00 everywhere for exactly that reason.

| matchup | rams/episode | fights with contact |
| --- | --- | --- |
| pirate r2 vs scripted trader | 0.08 | 7% |
| scripted pirate vs scripted trader | 0.00 | 0% |
| **pirate r2 vs trained evader** | **0.94** | **57%** |
| pack of 3 (solo brains) vs trader | 0.13 | 3% |
| pack-trained vs trader | 0.00 | 0% |

The evader matchup is not cosmetic. Against an unarmed evader the pirate is
destroyed in **17.5%** of episodes and **every one of those deaths is the
pirate flying into the trader**, because an unarmed trader deals no damage at
all. The trader dies in 3%. A brain trained to dodge is, in effect, winning by
being crashed into.

Why: `pirate-attack-r2` and `trader-evade-r2` were both trained on 26 July, and
the collision model landed after them. Neither has any idea that contact costs
0.45 out of a 1.1 hull. They were never taught to avoid each other; they were
only *verified* not to, in matchups where they happened not to.

Not retrained here. The collision round already burned five retrains that all
failed the shipped-brain assertions, and firing a sixth at this without a plan
would repeat it. What has changed is that the claim is now enforced instead of
assumed: `npm test` measures both matchups and fails if either gets worse. The
evader bound is a ceiling on today's behaviour, not a target — a retrain that
fixes this should tighten it rather than delete it.

## Run 9 — the collision retrain: it worked, and it must not ship as-is

    npm run train -- attack --pool --validate-select \
        --out pirate-attack-r5-varied --gens 400 --pop 48 --eps 8
    npm run train -- attack --pool --pool-hold-out jameson-defend --validate-select \
        --out pirate-attack-r5-holdout --gens 400 --pop 48 --eps 8

Goal: stop `pirate-attack-r2` ramming the evader (0.94 contacts/episode, 57% of
fights, and 17.5% of the time the pirate destroyed itself on an unarmed target).

### Two failures first, both informative

Training against `trader-evade-r2` alone produced a counter-brain, not a pilot:
100% kills against that evader in 4.6s, and **9%** against the scripted trader,
down from the shipped brain's 86.5%. Ranking by kill rate (`--select-kills`)
made no difference; the problem was the opponent, not the selection.

`--pool` turned out not to apply to the attack phase at all. It only ever fed
the pack phase, so every "pooled" attack run had been a single-opponent run.
Attack now honours it.

### What variety actually means

Chris's steer: train against a range of pilots, some who run and some who turn
and fight. The second half was missing entirely — the attack phase never set
`traderArmed`, so every opponent in the rotation, `jameson-defend` included,
flew **unarmed**. The pirate was being trained exclusively against victims, and
a pirate that has never been shot at has no reason to learn when to break off.

The pool is now five: scripted hauler, scripted-but-armed, `trader-evade` (r1),
`trader-evade-r2`, and `jameson-defend` armed.

### Result — 200 episodes per cell

| opponent | r2 (shipped) | r5-varied |
| --- | --- | --- |
| scripted trader | 92.0% / 0.10 rams | **100%** / 0.00 |
| trader-evade r1 | 93.5% / 0.06 | 90.0% / 0.00 |
| trader-evade r2 | 3.0% / **0.94** | 99.5% / **0.01** |
| jameson-defend, armed | 4.0% | 77.5% |

The ramming is gone. And because every opponent above was in the pool, that
table alone proves nothing about generality, so `--pool-hold-out` exists now:
a brain trained with `jameson-defend` excluded still kills it **44.5%** of the
time against the shipped brain's 4.0%. Eleven times better on an opponent it
has never met. The improvement is real, not memorised.

### Why it does not ship

`npm run survivability` with the new brain as the ordinary pirate:

| defender | r2 (shipped) | r5-varied |
| --- | --- | --- |
| player, hp 3.0 | 1% killed | **100% in 6.8s** |
| player, hp 4.0 | 0% killed | **100% in 8.4s** |

Three *ordinary* pirates would kill a fully shielded commander every single
time, which makes routine opportunists deadlier than the organised gangs
(53% and 41% at the same hp). A new commander would die on every encounter.

So this is the pack brain all over again: better on every metric and a game
design decision rather than a metrics one. The shipped brain is unchanged.
`pirate-attack-r5-varied` and `-r5-holdout` are committed as evidence.

The obvious use, if it is wanted, is the tier ladder that already exists:
opportunists keep `pirate-attack-r2`, professionals fly r5-varied, gangs keep
the pack brain. That gives three genuine steps of escalation instead of two,
and it is a playtest away.

## The number that explains why sim lethality never matches play

Reported from flying run 9's brain: "a couple of Sidewinders on the way to
Lave, pretty easy to kill, I don't think they even shot at me."

They barely did. NPC fire rate and the sim's are not the same number and never
have been:

| | cooldown | shots/second |
| --- | --- | --- |
| player's pulse laser (`game.ts` LASERS) | 0.24s | 4.2 |
| **the sim** (`core.ts` LASER.cooldown) | 0.24s | 4.2 |
| **a brain-flown NPC** (`npc.ts` brainFly) | 0.9 + rand*0.8, mean 1.30s | 0.8 |
| a scripted NPC (`npc.ts` attack) | 1.4 + rand*1.8, mean 2.30s | 0.4 |

The sim arms every ship with the player's own gun. The game gates an NPC to
roughly one shot every 1.3 seconds, so **every brain this project has trained
fires 5.4x slower in the game than in the world it was fitted to.**

Measured in the game, player flying straight, 30 seconds:

| attackers | hits landed | damage |
| --- | --- | --- |
| 2 Sidewinders, shipped brain | 5 | 0.75 |
| 2 Sidewinders, run 9 brain | 3 | 0.47 |
| 3 tier-2 pirates, run 9 brain | 5 | 2.06 (missiles carry most of it) |

Shields regenerate 0.035/s each, which is **1.05 over those same 30 seconds**.
Two Sidewinders cannot out-damage the shields they are shooting at. That is not
a brain being weak; it is arithmetic.

### What this reframes

Every lethality figure derived from the sim overstates the in-game threat by
about five times. That covers run 7's "kills a player-like target in 1.5-2.9s",
run 9's "100% in 6.8s", and the survivability tables. Those numbers are correct
*about the sim* and should not be read as predictions about play.

It also explains the one measurement that did look alarming in the real game:
run 9's brain killing the commander in 63% of gang trials. Those were tier-2
hulls, which carry **missiles** at 1.3 damage each against a commander who soaks
3.0. The lasers were never the threat.

Not changed. Bringing NPC fire rate to the sim's would make every pirate in the
game five times deadlier, which is a design decision and a large one. The
handicap also looks deliberate: NPCs are meant to be less dangerous than the
player's own gun. What has changed is that it is now asserted in `npm test` as
a ratio, so altering either side is visible rather than silent — and every
brain's behaviour is fitted to the sim's side of it.

## Flying it settles the run 9 question: it should ship

Reported from play: pirates are hard to hit; they do not hit back much; and
after one or two go down the rest "seem to give up".

All three are real, and two of them have the same cause.

### Why they seem to give up

Measured in the game, four tier-1 pirates, 45-60 seconds, **player not firing
a shot**:

| | shipped brain | run 9 brain |
| --- | --- | --- |
| pirates destroyed with no help from the player | **3 of 4** | **0 of 4** |
| share of the fight spent inside 220 units, guns disabled | 24% | 6% |
| hits landed on the player | 11 | 11 |
| damage to the player | 1.67 | 1.83 |

Three of four attackers destroyed themselves. `attack()` disables the guns
inside 220 units and steers away (RAM_GUARD, added so pirates stop kamikazing),
so the survivors spend a fifth of the fight circling at knife range doing
nothing. Between the self-destruction and the guns-off orbiting, "they gave up"
is a fair description of what is on screen.

### The reversal

Run 9's brain was held back because the sim said it kills a shielded commander
100% of the time in 6.8 seconds. In the game it deals **1.83 damage in a
minute** against a commander who soaks 3.0 to 4.0, and the player survives.
The sim was overstating it by the 5.4x fire-rate gap documented above.

At tier 2, where the missiles are, across 5 runs of 3 pirates:

| | shipped | run 9 |
| --- | --- | --- |
| player killed | 0% | 0% |
| pirates lost to their own flying | 1.2 of 3 | 0.2 of 3 |
| damage to the player | 1.68 | 2.00 |
| guns-off orbiting | 21% | 8% |

So it fixes both complaints at a cost of about 0.3 damage a minute. The earlier
63% death figure came from tier-2 ships firing **missiles** at 1.3 damage each,
not from the brain, and it happens with either brain.

The remaining complaint, that pirates are hard to hit, is a separate number and
is not about the AI at all: the player's hit test is `atan(radius * 0.35 /
dist)`, which is the central 12% of a ship's area, while an NPC needs only to
be within 0.25 radians (28.6 degrees wide) of you at any range. That asymmetry
is in `LASER_GRAZE` in game.ts, which core.ts confirms is not modelled in the
sim, so it can be tuned without touching a single brain.

## Correction — the fire-rate gap is real but is not what limits NPC damage

The entry above concluded that NPCs firing 5.4x slower than the sim trains them
to is why they barely hurt you. Two experiments say that conclusion was wrong.

**Fire rate, tested at sim parity.** Cooldown dropped from 0.9-1.7s to
0.18-0.30s, five times faster, six runs of two tier-0 pirates:

| | shots/min/ship | damage in 45s | player deaths |
| --- | --- | --- | --- |
| 0.9-1.7s (shipped) | 4.1 | 3.78 | 0 of 6 |
| 0.18-0.30s (sim parity) | 3.7 | 3.52 | 0 of 6 |

No difference. The cooldown was never the binding constraint.

**Laser range, aligned to the sim.** NPC firing range raised from 2600 to the
3500 the sim and the player both use. Six runs each: damage 3.78 against 3.83,
and both spent 100% of the fight inside 2600 anyway. Also no difference. That
change was made on the strength of a single run showing 51% of time spent
beyond 2600, which was not representative.

**What actually limits them.** Instrumenting one Sidewinder for 60 seconds: it
fired 3 times, at 6.3, 13.6 and 13.9 degrees off the nose, and it was inside
the 14.3 degree firing gate, in range, and outside the ram guard for **5.5% of
the fight**. 5.5% eligibility with a 1.3s cooldown predicts about 2.5 shots a
minute; it fired 3. The arithmetic closes.

A pirate is not waiting for its gun to cool. It is waiting to be pointed at
you, and it is busy weaving — which is the behaviour we want and the same
behaviour that makes it hard for the player to hit. Both complaints, "hard to
hit" and "they never shoot", are the same fact seen from the two cockpits.

Nothing was tuned as a result. The cooldown is back where it was, the range
stays at 3500 purely for parity with the sim the brains trained in (it changed
no measured outcome), and both are named constants now rather than magic
numbers in an expression. Widening the 0.25 rad firing gate is the lever that
would actually raise their output, and it would do it by granting shots at
angles they have not earned.

## Run 10 — they weave because they have never met a player

Chris's question, and it is the right one: if they were trained to shoot, why
are they weaving instead of shooting?

Because every pirate brain in this project was trained against
`CLASSES.traderCobra`, and the commander is not one:

| | training target | the player |
| --- | --- | --- |
| max speed | 220 | 400 |
| pitch | 0.70 | 1.45 |
| roll | 1.20 | 2.50 |

A pursuit curve fitted to a freighter overshoots something twice as agile on
every pass, and the pirate spends the fight re-acquiring rather than firing.
Measured against a player-agility target, share of the fight actually lined up
inside the game's firing gate:

| brain | lined up | kills |
| --- | --- | --- |
| pirate-attack-r2 (shipped) | 30.5% | **0%** |
| r5-varied (run 9) | 94.6% | 43% |
| **r6-playerlike (this run)** | 90.3% | **100%** |

The shipped brain cannot beat a player-agility target at all. Adding two pool
opponents that fly `playerCobra` — the same evader and the same armed defender,
on the commander's hull — fixes it outright.

A real bug fell out of the same investigation. `PlayerRef` had no `speed`, so
`brainFly` was handed the literal **300** whatever the player was doing. The
sim feeds the target's true speed, and speed is the one input a pursuer needs
to lead a shot. Now passed properly.

### And it makes no difference in the game

Two pirates, eight trials, the player flown by the defence brain:

| | commander killed | pirates killed |
| --- | --- | --- |
| shipped | 0% | 0.3 of 2 |
| run 10 | 0% | 0.3 of 2 |

Identical. The game's own gates — a 0.25 rad firing cone, a 1.3s cooldown,
shields that regenerate faster than two Sidewinders can shoot — dominate
whatever the brain does. This is the third time in two days that a large sim
improvement has vanished on contact with the game, and it is worth stating
plainly: **the sim is now a poor predictor of in-game combat**, and any further
AI work should be judged in the game first.

A methodological note, because it nearly fooled me twice. My first in-game
comparison flew the "player" in a straight line and reported run 10 as far
WORSE (0% lined up against the shipped brain's 9%). A drifting target is
exactly the freighter the shipped brain was trained on, so the test flattered
it. Only the harness that flies the ship evasively gives an honest answer.

## The human data: they were never allowed to shoot

Chris flew three waves with test/arena.js and test/combat-recorder.js. First
combat numbers in this project that a person actually produced.

| wave | ships | brain | secs | he killed | their shots | damage to him |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2x tier-0 | shipped | 48 | 2 of 2 | **1** | 0 |
| 2 | 3x tier-1 | shipped | 87 | 3 of 3 | **4** | 0.97 |
| 3 | 3x tier-1 | run 10 | 33 | 3 of 3 | **0** | 0 |

Three ships, thirty-three seconds, not one shot fired. His words: "the ships
didn't do anything."

### His flight envelope explains it exactly

| | Chris | what the brains trained against |
| --- | --- | --- |
| median speed | **66** (p90 400) | 220, constant |
| median pitch rate | **1.36** of 1.45 | 0.70 max |
| median engagement range | **260** | n/a |
| 10th percentile range | **214** | n/a |

`RAM_GUARD` is **220**. He fights at a median of 260, forty units outside the
line where control passes to `attack()`, which steers away and returns no fire
event — guns off. He is inside it a tenth of the time. He turns nearly on the
spot at 66 speed and near-maximum pitch while pirates come past at 290-310, so
every single pass crosses the dead zone.

The guard was added because the brains kamikazed, and it was right then. Run
10's brain does not ram: 0 self-destructions in 4 ships over a minute, against
3 of 4 for the shipped brain. So under that brain the guard drops to 90 units,
close enough that a collision really is imminent, and the ship keeps its guns
until then.

### A measurement bug of mine, corrected

The arena reported 3-5% player accuracy. It was counting `fireLaser()` calls
rather than discharges, and the function is called every frame the trigger is
held while refusing internally until the laser cools. Wave 3 recorded 460
"shots" in 33 seconds against a pulse laser that can manage 4.2 a second. Real
figure for that wave is 138 shots and **12%**. Waves 1 and 2 were tapped rather
than held, at 3.7 shots a second, so those were already true.

Worth noting what this does to the earlier bot-flown accuracy numbers: the bot
fires once per cooldown by construction, so its 33% was never inflated. A human
holding the trigger through a turn is simply a different measurement, and only
the human's is the one that matters.

## Run 11 — the experimental brains freeze against a human, and why

Reported from play: "the enemy ships are not moving, just spinning on the spot."

The shipped brain is fine and always was. This is a defect in the player-like
brains from runs 9 and 10, and the human envelope is what exposed it.

Measured with the player STOPPED, 20 seconds, one tier-1 pirate at 2000 units:

| brain | distance flown | closed to |
| --- | --- | --- |
| pirate-attack-r2 (shipped) | 4829 | 372 |
| run 10 | **99** | did not move |
| run 11 (slow target added) | 653 | 1685 |

And with the player at 300, run 10 flies 1145 and closes to 225. It is not
broken; it only pursues a target that is *moving*. Its pool was a freighter at
220 and player hulls at up to 400, so a stationary target is outside everything
it has ever seen. Chris flies at a median of **66** and stops dead to turn.

Run 11 adds `playerCobraSlow` (90 max, player agility) to the pool, which is
his envelope. It roughly sextuples the distance flown, 99 to 653, and it still
does not close the way the shipped brain does. Better, not fixed.

### What I got wrong on the way

I "fixed" a bug by passing the player's true speed to `brainFly` instead of the
hardcoded 300. It is the correct value and it made things worse: `observe()`
feeds `target.speed / 400`, every shipped brain was fitted against a freighter
near 220, so that input has only ever been about 0.55. A player at 66, or
stopped, is 0.165 or zero — out of distribution, and the shipped brains
degrade too. Reverted to the constant, with a comment saying why it must stay
one until the brains are retrained across the full speed range.

So the ordering matters: the observation cannot be made honest until the
training distribution covers what the honest value can be.

### Where this leaves the experiment

The default game is untouched and healthy: shipped brain, toggle off, closes
2000 to 269 on a stationary player. Everything from runs 9 to 11 sits behind
`window.__sharpPirates` and none of it is fit to ship, for a reason that only
appeared when a human flew: they were all trained against targets that move
like ships, and a human in a dogfight moves like a turret.

### Run 11 postmortem — two independent faults, and the end of this thread

Chris flew `__arena.wave({ n: 3, tier: 1, brain: 'sharp' })` again and the
ships still did nothing. Instrumenting the policy's own output rather than its
effects finally separated the causes.

Control outputs, one tier-1 pirate, player stopped, 15 seconds:

| | throttle | wants to fire | resulting speed |
| --- | --- | --- | --- |
| shipped | 50% forward | 17% | 270 |
| run 11 | **69% reverse** | **0%** | 8 |

And the same brain in the SIM against a stationary target: fire 100%, throttle
**100% reverse**. So:

1. **The braking is the brain.** It reproduces in the sim with no game code
   involved. Adding `playerCobraSlow` at 90 max taught it "slow target, slow
   down", and it generalised that into stopping dead. My fix caused this.
2. **The not-firing is the plumbing, and it is unfixable without a choice.**
   In the sim it wants to fire 100% of the time; in the game, 0%. The game
   hands it `target.speed = 300` while the geometry says the target is
   stationary, a contradiction it never trained on. Feed the true speed instead
   and the SHIPPED brains break, because they only ever saw about 0.55. The two
   generations of brain want incompatible observations.

The toggle now points back at run 9's `pirate-attack-r5-varied`, the last
experimental brain that actually flies and shoots in the game. Runs 10 and 11
stay committed as evidence and are not wired to anything.

**Stopping here.** Three training rounds produced large sim gains; the first
did not transfer, the second regressed against a human, the third regressed
further. The bottleneck was never the training. It is that the sim's target
model and the game's observation plumbing both differ from what a human
actually does, and no amount of evolution against the wrong opponent fixes
that. The next useful step is not a retrain: it is making the game feed the
same observation the sim does, and only then fitting an opponent to Chris's
recorded envelope.

### Correction — run 11 is not speed-sensitive, it is simply degenerate

The postmortem above says run 11 learned "slow target, slow down" from the
90-max-speed opponent. That was wrong, and the test that settles it is one
line: sample the throttle choice against targets at several speeds.

| brain | tgt 0 | tgt 66 | tgt 220 | tgt 400 |
| --- | --- | --- | --- | --- |
| pirate-attack-r2 (shipped) | 100% | 100% | 100% | 100% |
| pirate-attack-r5-varied | 100% | 100% | 100% | 100% |
| **pirate-attack-r11-slow** | **0%** | **0%** | **0%** | **0%** |

Percentage of frames choosing forward throttle. Run 11 never accelerates,
against anything, ever. It is not responding to target speed at all; it is a
degenerate policy that reached 83% validation kill rate for reasons that have
nothing to do with flying — episodes start with the ships closing, and a brain
that coasts and shoots can still score.

That is a selection failure, not an observation mismatch, and `--validate-select`
did not catch it because kill rate does not notice a pirate that never moves.
Worth a guard in the trainer: reject any champion whose throttle output is
constant.

The practical consequence is unchanged. r5-varied is safe on this test and is
what the toggle points at. r11 stays committed as evidence of the failure mode.

## The reference fight — a human, 215 seconds, six kills

Chris flew a real reception with the recorder running. This is the first
combat measurement in the project taken from a person rather than a bot, and it
supersedes the bot-derived numbers above for anything about game feel.

| | |
| --- | --- |
| flight time / under attack | 215s / 178s |
| **his** shots / hits / accuracy | 62 / 19 / **31%** |
| his kills | 6 |
| **their** shots / hits / accuracy | 17 / 15 / **88%** |
| their damage to him | **3.46** (he soaks 3.0-4.0) |
| within laser range | 95% |
| **lined up on him** | **5%** |
| mean facing error | **79.7 degrees** |
| mean distance | 978 |

31% for the player confirms the LASER_GRAZE change: the 3-5% reported earlier
was my broken shot counter, not his aim.

### Their gunnery is a dice roll, not aim

    const hit = Math.random() < Math.min(0.85, Math.max(0.15, 0.9 - dist / 3500));

Once an NPC decides to fire, whether it hits depends **only on range**, capped
at 85%. Aim decides *whether it shoots*, never whether it connects. So 15 of 17
is exactly on model for shots taken close in, and "make them aim better" would
change nothing at all. The only lever is how often they line up.

### The balance is resting on 5%

They are in range 95% of the time and pointed at him 5% of the time. Every
extra point of alignment converts almost directly into damage, at 62-85% per
shot:

| alignment | shots in that fight | damage to him |
| --- | --- | --- |
| 5% (today) | 17 | 3.5 |
| 10% | 34 | 6.9 — dead |
| 15% | 51 | 10.4 — dead |

He survived on 3.46 damage against 3.0-4.0 of durability. **Doubling how often
pirates point at the player kills him.** The game is balanced, and balanced
tightly, on brains that cannot track a human — which is accidental rather than
designed, and worth knowing before anyone "improves" pursuit.

That also retires the idea that pirates need to be more aggressive. They do not
need to shoot more often; they need to keep missing at the current rate. If
anything is worth tuning it is the 0.85 cap and the 0.25 rad gate, both of
which are legible numbers, rather than the flying, which is emergent and would
take the balance with it.

## Run 12-14 — the sim was a box, and nobody noticed for six runs

Chris, on why the attack runs kept collapsing into brains that never move:
*"it sounds like the problem is that the opponent is not fighting back?"* Half
right, and the half that was wrong is the interesting part.

The first fix followed his reading: five of eight pool opponents were unarmed,
so a pirate that parked and sniped took no damage at all, and `fitnessAttack`
punishes passivity only through `- 2 * damageTaken`. Arming the pool
(`pirate-attack-r13-armed`) changed almost nothing — the `flies()` guard still
rejected 309 of 372 champions for never accelerating.

So the pressure wasn't missing, it was *unreachable*. One measurement settled
it. A pirate forced to `speed = 0` for the whole episode:

| target | statue pirate kills |
| --- | --- |
| unarmed | 99% |
| armed | 99% |

`Episode.step()` ended only on timeout, trader death, or all pirates dead.
There was no escape condition. The target could neither be lost nor get away,
so closing the distance was worth exactly nothing and only aiming paid.
**Standing still was the optimal policy, and six runs of evolution had been
correctly finding it.** The `flies()` guard added in run 12 was suppressing a
symptom of a broken environment.

Worse, the capture was mutual. Given an escape range of 6000 and a stationary
attacker, every trader brain — including the two whose entire job is evasion:

| trader brain | hull | escaped | died | furthest it got |
| --- | --- | --- | --- | --- |
| jameson-defend | traderCobra | 1% | 99% | 2107 |
| trader-evade | traderCobra | 0% | 100% | 2151 |
| trader-evade-r2 | playerCobra | 0% | 100% | 2177 |

A forced perfect retreat escapes 92% of the time, so the door was real. No
evolved trader had ever opened it, because orbiting at 2100 already scored
100% survival. The evaders never ran, so the attackers never had to chase.

### What changed

- `Episode` gained `escapeRange` (default 6000): the target getting clear ends
  the episode. `fitnessAttack` pays `- 6` for losing it.
- `fitnessEvade` credits an escape with the full episode time. Without that,
  escaping *early* scored lower than dawdling, and the bonus was self-defeating.
- A new `{ kind: 'runner' }` controller — nose away, throttle open. Retraining
  the evader (`trader-evade-r3`) still didn't produce one, so the pressure is
  supplied by hand instead of hoped for.

Pool rejections fell from 83% to 60%, and `pirate-attack-r14` throttles forward
100% of the time where run 12's best managed 10%. On held-out seeds:

| opponent | r2 | r14 |
| --- | --- | --- |
| runner, player speed | 0% | 14% |
| jameson, knife-fight (playerCobraSlow) | 0% | 100% |
| jameson, player speed | 1% | 36% |

### Why r14 still isn't shipped

It kills the knife-fighter in 2.1s, opening fire at 2071 — the spawn range. It
never closes; it holds the throttle down and empties the magazine from where it
starts. Eight shots at the sim's 0.24s cooldown is 2.1 seconds. The same eight
shots at the game's NPC cooldown (0.9-1.7s, mean 1.30) take about ten.

That gap is asserted in `test/run.ts` as a known one, and it is now the prime
suspect for why nothing transfers: **a policy whose win condition is a burst
the game's guns cannot produce.** Aligning the sim's laser to the NPC fire rate
invalidates all six shipped brains, so it is a decision rather than a fix.
Shipped brains are unchanged: pirates still fly `pirate-attack-r2`.
