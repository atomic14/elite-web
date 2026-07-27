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

**The real fix is a collision model in `sim/core.ts` plus a retrain.** That
is a sim/game parity issue (CLAUDE.md invariant 2) and the shipped brains
were all fitted without it, so every one of them would need re-validating
through the tournament. Worth doing as its own round: it would let the
policies learn deflection and break-off themselves rather than having the
game override them at knife range.
