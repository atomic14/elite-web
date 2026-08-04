# AI Training Log

Every training run, its setup, and what came out. Requires Node ≥ 22.6.
Reproduce any run with the command shown. The whole trainer path is seeded
(mulberry32, single-threaded, no Math.random) — a rerun with identical CLI
args is bit-identical **on the same Node build/platform**; across platforms
expect tiny drift (Math.tanh/acos are not correctly-rounded by spec).
League/defend rounds load their frozen opponents from `src/ai-training/brains/` —
rerun them against the **committed** round-1 brains (or archived copies),
because retraining a phase overwrites its committed brain file.

> **One thing every entry below predates.** Runs quote the A/B toggles as
> console globals — `window.__scriptedPirates`, `window.__legacyPirates`,
> `window.__packBrain`, `window.__sharpPirates`. Those five no longer exist:
> which brain a ship flies is a field of the game state, because the step reads
> it and therefore it is state. `npm test` now bans the globals from coming
> back. The measurements are unaffected — only the way you switch between them
> changed — so entries are left exactly as written, per this file's own rule.
> Translate as you read:
>
> | the entry says | type this |
> | --- | --- |
> | `window.__scriptedPirates = true` | `__game.state.brains.scripted = true` |
> | `window.__legacyPirates = true` | `__game.state.brains.legacy = true` |
> | `window.__packBrain = true` | `__game.state.brains.pack = true` |
> | `window.__sharpPirates = 'pro'` | `__game.state.brains.sharp = 'pro'` |
>
> `__game` remains a handle the game publishes rather than a flag it reads.
> It is now a `legacyHandles(Game)` console view: mutate canonical state through
> `__game.state`, while old harness reads such as `__game.commander` remain
> available. See `src/game/game-handles.ts` and `src/game/console.ts`.

> **And one thing everything before 2026-08 predates: the damage scale.**
> Entries up to and including Run 18 measure health in a normalized "fraction
> of a Cobra" — a commander with 1.0 per shield and a bank of 4, a ship with
> `hp`, a ram worth 0.45, an `ENERGY_PER_DAMAGE` of 2. **None of that exists.**
> The commander now has three 255-point pools (fore shield, aft shield, energy
> bank), a ship carries its exact released energy bank of 2 to 255 points, and
> what a laser hit is worth is decoded from the released bytes rather than
> rolled. See `docs/ELITE-A.md` and `docs/DAMAGE-PATHS.md`.
>
> So: **an hp figure, a damage figure or a shots-to-kill figure below is a
> record of what was measured then, not a statement about the game now.** The
> SHAPES still transfer — a turret is still a turret, imperfect pursuit is
> still what the balance rests on — and the numbers do not. Entries are
> appended and never edited, which is why this note is here instead of a
> hundred corrections.
>
> Which brains ship is likewise not settled by any entry below: it is
> `src/game/brains.ts`, and `npm test` reads that file rather than a list. As
> of Run 19 they are `pirate-attack-g3` (pirates), `pirate-pack-r4-selectonly`
> (organised gangs) and — since docs/TODO/71 and /72 — `jameson-defend-g2`
> (armed traders and the combat computer), which replaced `jameson-defend-g1`.

## Infrastructure

- **Environment**: `src/ai-training/scenario.ts` — episodes built from the
  REAL engine (`NpcShip`, `PlayerShip`, `gunnery.ts`, `collisions.ts`,
  `rng.ts`), stepped at the game's own `FIXED_DT` = 1/60 s.
  *Runs 1-16 below used `src/ai-training/core.ts`, a render-free copy of the
  combat physics with its own vector maths, at dt = 1/15 s. It is deleted as
  of run 17; every figure recorded before that entry was measured in the copy,
  and the copy is a large part of why several of them did not transfer.*
- **Policy**: `src/ai-training/policy.ts` — MLP 14 → 32 → 32 → 11 (tanh), 1,899
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

- `src/ai-training/brains/*.json` — every brain ever trained, each with meta
  (fitness, date, hyperparams). At the time of Run 2 that was six:
  `pirate-attack`, `pirate-attack-r2`, `trader-evade`, `trader-evade-r2`,
  `pirate-pack`, `jameson-defend`. **Which of them SHIP is `src/game/brains.ts`
  and nowhere else** — see the note at the top of this file; the list here is
  what existed when this entry was written.
- `train/logs/*.jsonl` — per-generation best/mean/worst fitness curves
- `train/logs/tournament-final.txt` — the held-out tournament table

## Watching the results

`npm run dev` → http://localhost:5173/viewer — scenarios: the pirate of the
day (r2 when this was written) vs trader · scripted pirate (old AI) · random
policy (untrained baseline) · pirate vs trained evader · pack of 3 solo-brains vs armed trader ·
pack-trained vs armed trader · Commander Jameson (defence AI) vs 2 pirates.
Orbit/chase cameras, pause, 0.25×/1×/4× speed, auto-restart with a new seed.

## Follow-ups — all three since completed

- ✅ **Pack phase** — Run 4 below (result at the time: underperforms solo
  brains). **Superseded by Run 7**: that verdict was a trainer bug, not a
  property of pack policies. See the bottom of this file.
- ✅ **League play** — Run 4 below (r2 pirate: 0% → 98% vs the evader).
- ✅ **In-game integration** — pirates fly a trained attack brain and armed
  traders a trained defence one (Run 5). *Written when that meant
  `pirate-attack-r2` and `jameson-defend`, switched with
  `window.__scriptedPirates`; both statements have since moved on twice — see
  the two notes at the top of this file, and `src/game/brains.ts` for what
  actually flies.* The pack brain was wired in at the same time and left off
  by default; Run 8 shipped it to organised gangs.

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
r3 weights are kept in `src/ai-training/brains/` purely as evidence.

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

`src/ai-training/core.ts` has no collision detection. `radius` appears in the ship
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

**The original plan was a collision model in `ai-training/core.ts` plus a retrain.** That
is a sim/game parity issue (docs/INVARIANTS.md invariant 5) and the shipped brains
were all fitted without it, so every one of them would need re-validating
through the tournament. Worth doing as its own round: it would let the
policies learn deflection and break-off themselves rather than having the
game override them at knife range.

## Collision round — ships are solid, and the retrain that wasn't needed

`ai-training/core.ts` now has `COLLISION` + `resolveCollision`, and `Episode.step`
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
sim and the game to hold invariant 5, and every brain was fitted without them
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

## Run 15 — generation 1: the gun

Chris: *"do it."*

The sim gave every ship the player's pulse laser. The game's NPCs carry
something else entirely, and the mismatch ran in both directions at once:

| | sim (`LASER`) | game (`npc.ts` + `resolveNpcFire`) |
| --- | --- | --- |
| firing gate | ~0.027 rad (cone at 2000) | 0.25 rad |
| cadence | 0.24s | 0.9 + rand*0.8, mean 1.30s |
| hit | deterministic cone test | dice on range, capped 0.85 |
| damage/s when lined up | 0.667 | 0.041 |

Training therefore paid for precision aim the game never asks for, while the
game needs a patience the sim never modelled. Every attack run since round 1
was fitted to a weapon that does not exist.

The confirmation was immediate and slightly grim. Replayed under the real gun,
the brain the game had been shipping all along:

| pirate | kills | shots per episode | it died |
| --- | --- | --- | --- |
| statue (never moves) | 93% | 19.2 | — |
| scripted chase AI | 56% | 6.7 | — |
| **pirate-attack-r2 (shipped)** | **2%** | **1.9** | — |

One-point-nine shots in a 45-second engagement. That is not a subtle
regression, it is Chris's bug report reproduced in a test harness: *"I met a
gecko and sidewinder — neither of them shot at me, even though they seemed to
point right at me."* Six rounds of training never saw it, because the sim was
measuring a different weapon.

### The fix

`core.ts` gains `NPC_GUN` beside `LASER`, and `ShipClass.gun` selects between
them; pirate and trader hulls declare `gun: 'npc'`. Shots are stochastic but
driven by the episode's seeded rng, so episodes stay reproducible. `test/run.ts`
now asserts cadence, gate, hit cap and damage are **equal** across sim and
game, where it used to document a 5.4x ratio as a known gap.

All four brains retrained against it — `trader-evade-g1`, `jameson-defend-g1`,
`pirate-attack-g1`, `pirate-pack-g1`. On 250 held-out episodes (seed base
4410907, not the training stream nor either validation base):

| target | r2 | g1 |
| --- | --- | --- |
| knife-fight, as Chris flies (playerCobraSlow) | 0% | 93% |
| player, full speed | 0% | 79% |
| runner, player speed | 0% | 1% |
| freighter | 2% | 97% |

Shots fired per engagement went from 1.3 to 17.0. The runner column is the
reassuring one: a commander who simply leaves still gets away 99% of the time,
because pirates do 260/300 against the player's 400 and no amount of training
changes arithmetic.

Two things came out of the wiring that were not part of the plan:

- **The target-speed constant is gone.** `npc.ts` passed a hardcoded 300
  because the brains had only ever seen a freighter near 220 and Chris flies at
  a median of 66. The comment set its own condition for removal — "a retrain
  with target speed sampled across the envelope a human actually flies" — and
  the g1 pool spans 90, 220 and 400 speed hulls plus two runners. It now passes
  `player.speed`.
- **The knife-range dead zone is gone.** `RAM_GUARD` switches a pirate's guns
  off inside 220 units, which is exactly where Chris fights (median engagement
  range 260, 10th percentile 214). It was the right trade for brains that
  kamikazed; g1 destroys itself in 1-9% of engagements against r2's 36-73%, so
  it gets `RAM_GUARD_NO_RAM` (90) instead. Fixing the gun would have achieved
  little if pirates still went silent at the range the fight happens.

### Balance is not settled, and the harness says so

`npm run survivability`, corrected for the commander's real durability:

| pirates | hp 3.0 (one face) | hp 4.0 (both shields) |
| --- | --- | --- |
| 1 | 25% in 40.0s | 1% |
| 2 | 98% in 25.5s | 89% |
| 3 | 100% in 17.4s | 100% |

One pirate is a long, survivable fight, which is right. Two at 89-98% is
hotter than the 50%-for-a-gang-of-three this project previously aimed at.

Before anyone tunes on that number: **the defender in that table loses 0.0-0.3
pirates per fight.** It barely shoots back, where Chris kills them. It is the
same trap CLAUDE.md warns about, pointed the other way — the bot is again the
thing deciding the answer. The old brains measured 0-2% here, so the honest
summary is "the late game went from no threat to an unflown amount of threat".

Fly it before tuning it. If it needs a lever, the legible numbers are
`NPC_COOLDOWN_LO/SPREAD`, the 0.85 hit cap and the 0.25 gate — all now mirrored
in `NPC_GUN` and asserted equal by the tests — not the flying, which is
emergent and would take the balance with it.

## Run 16 — generation 3: training for fun instead of for kills

Chris, after flying g1/g2: *"I think our old AI was more fun to play with"*,
then *"there's definitely some work to do to make them shoot more often and
try and line up with the ship"*, then *"we need to find some balance in the
weaving and them trying to line up on our six."*

That is the whole brief, and it retires the objective the previous fifteen
runs were optimising. Generation 1 and 2 won every measurement available —
17 shots an engagement against r2's 1.3, 93% kills against a target flown the
way Chris flies against 0% — and they were **not fun**, which outranks all of
it. Rolled back the same day they shipped.

The cause is structural rather than a bad fit, and it was Chris's own
observation weeks earlier: slowing down or stopping lets you pivot and hold a
firing line, because you stop translating past the target. That is true, the
sim models it faithfully, so evolution finds it — and a fully-optimised pirate
is a turret that hangs in space and snipes. r2 is fun BECAUSE it is bad at
that: it flies attack runs, weaves, overshoots, and gives a dogfight that can
be won.

**Lethality was a proxy for threat, and threat is not the same as fun.**

### Making the boring move unavailable

Two changes, neither of them to the network:

- `ShipClass.minSpeed` — pirate hulls cannot throttle below ~43% of top speed
  (110 of 260, 130 of 300), mirrored in `npc.ts` as `MIN_CRUISE_FRACTION`
  (invariant 5). The turret is no longer in the search space.
- `Episode.tailTime` — fitness pays 0.6 per second spent **on the target's
  six**: astern of it (`forward(target) · dir > 0.35`) and lined up on it
  (`forward(pirate) · dir > 0.9`). Asking for the threatening manoeuvre
  directly, instead of for damage by whatever route.

The population stopped collapsing immediately: `flies()` rejected **30 of 379**
champions against 171 of 395 for g2.

### Measured against a target that stops and turns to fight

| brain | mean speed | lined up | on your six | mean range | shots | kills |
| --- | --- | --- | --- | --- | --- | --- |
| r2 | 235 | 38% | 2% | 822 | 0.6 | 0% |
| g2 | 133 | 96% | 1% | 1135 | 7.3 | 7% |
| **g3** | **220** | 27% | **10%** | **543** | **4.5** | 1% |

g3 flies at r2's speed, closes 280 units nearer, works onto the six five times
as often, and shoots seven and a half times as much — while a gang of three
still kills a shielded commander only 1% of the time (`npm run survivability`),
against g2's 100%. Old harmlessness, new aggression.

r2's row also answers a question open since the first playtest: *"they seemed
to point right at me and never shot"*. It is aligned 38% of the time and fires
0.6 times an engagement, because it was trained when firing required a 0.027
rad cone. It learned never to trust a loose line, and the game's gate is 0.25.

`window.__legacyPirates = true` restores r2 exactly (wide ram guard, constant
target speed); `window.__sharpPirates` flies g2. Both are one console line, so
the comparison can be made in a single session rather than argued about.

### What is still open

`lined up` fell from r2's 38% to 27%. Pursuit improved and instantaneous
alignment did not, which suggests the tail term is doing the work and the
firing gate is still where the shots are lost. The next lever is the policy's
own trigger discipline rather than its flying — and, as always, the answer
comes from flying it, not from this table.

## Run 17 — the simulator is deleted; training runs on the game

Not a training run. An environment change, and the largest one this project
has made: `src/ai-training/core.ts` no longer exists, and an `Episode` is now
built out of `NpcShip`, `PlayerShip`, `game/gunnery.ts`, `game/collisions.ts`
and `game/rng.ts`, stepped at the game's own `FIXED_DT`.

### Why

Every entry above is measured in a copy of the game's physics — 450 lines with
its own vector and quaternion maths, its own PRNG, a `CLASSES` table mirroring
ship-specs.ts, `LASER`/`NPC_GUN` mirroring gunnery.ts, `COLLISION` mirroring
collisions.ts and a `stepShip` mirroring player.ts and npc.ts. Invariant 5
existed solely to police it, and the record of that policing is in this file:

| drift | cost |
| --- | --- |
| sim gave every ship the player's pulse laser (0.24s / 0.027 rad) where an NPC has 1.30s / 0.25 rad | runs 9-14 failed to transfer |
| `playerCobra.accel` 120 against player.ts's 220 | every pirate brain up to g1 hunted a commander taking twice as long to reach speed |
| `RATE_DECAY` 5.0 in the sim against the player's 12.0 | fixed, which then silently broke the NPC half that had matched |
| one ramp constant at two step rates (1/15 vs 1/60) | the same number meant different handling in each file |

Each was invisible for months because **each file agreed with itself.** The
tests could compare the copies but could never decide which was right, and two
of them ended as `TODO(owner)` comments in test/run.ts asking for a ruling.

### What the merge required

Four seams, all of which the engine mostly had already:

- `NpcShip.brainFly` and `NpcShip.attack` are **public**. An episode flies a
  candidate genome through the real flight model; `update()` still picks the
  shipped brain, which is the last thing a trainer wants.
- `PlayerShip` already took a `FlightDemand` rather than a keyboard, so the
  target is the commander's own ship with a different pilot behind it.
- `FIXED_DT` moved from game.ts (needs a browser) to world-step.ts (does not),
  so the trainer can ask what a slice of the world is.
- `makeRng` moved from the simulator into `game/rng.ts`, where the same
  mulberry32 was already written out a second time.

### Bugs it exposed, and the rulings

- **Per-hull accel did not exist in the game.** `npc.ts` threw every
  brain-flown ship at a flat `BRAIN_ACCEL = 120` where the sim gave each hull
  its own. Ruling: hulls have accel. The sim's three hand-written numbers turn
  out to be one rule — 140/300, 120/260 and 100/220 are all ≈ 0.46 of top
  speed — so `ACCEL_FRACTION = 0.46` reproduces all three within a rounding
  step and gives every hull in the roster a defensible value. A Sidewinder
  accelerates at 138 now instead of 120.
- **The player's roll cap disagreed with itself.** `MAX_ROLL` is 2.5;
  the sim flew the commander at `turnRate × TURN.roll` = 2.4864, and stored
  the pitch cap as a rounded quotient (1.036 × 1.4 = 1.4504 against 1.45).
  Both were flagged and neither could be fixed by a parity test. Gone: the
  target hull reads `PLAYER_FLIGHT`.
- **A 26-input pack brain could be trained and never flown.** `npc.ts` knew
  the 14- and 18-input observations only, so `observePackWide` — the whole
  point of round 4's `--wide` arm — had no path into the game. It picks the
  widest encoder the brain has inputs for now, and `packmates()` reports
  health, orientation and hull as `ObservableMate` wants.
- **The rate ramp had four homes** (player.ts, npc.ts, combat-computer.ts,
  the sim), each with the constants written out again. One `rampToward` now,
  constants passed in.
- **`NpcShip.facing()` allocated a Vector3 per call**, on the firing gate,
  which every ship takes every frame — and now every ship-step of every
  episode.

### Cost: none

| workload | old simulator, dt 1/15 | real engine, dt 1/60 |
| --- | --- | --- |
| `train -- attack --gens 20 --pop 16 --eps 2` | 1.18-1.21s | 1.05-1.06s |
| `train -- attack --gens 60 --pop 32 --eps 3` | 8.66s | 8.19s |

Four times the timestep resolution, and *faster*. The MLP forward pass
dominates a ship-step, and the decision cache pins it at 10 Hz however finely
the world is stepped — where the old sim ran `act()` on every one of its
coarser steps. The engine's per-step cost is real (~3.9x the sim's) and it is
simply not what the clock was measuring.

Training moved to 1/60 for the same reason it moved to the engine: at 1/15 a
brain re-decides every 0.133s instead of 0.1, and every `rotateTowards` and
collision test is four times coarser. That was the last way left for the
trainer to be fitting a world that does not exist.

### Reproducibility

Two runs of the same command produce an identical generation-by-generation
curve and byte-identical weights (the saved file differs only in its
`trainedAt`). The one new constraint is that an episode reseeds the world's
PRNG at construction, so episodes must be run to completion one at a time —
which is what every driver here already does, and what `game/rng.ts` being
module state has always implied.

### The shipped brains under the real physics

`npm test`'s regression gate still passes, which was not a foregone
conclusion, but the numbers move a long way — as expected, since these brains
were fitted in the copy:

| measure | in the simulator | on the engine |
| --- | --- | --- |
| `pirate-attack-g3` kills a scripted trader | 43% | 93% |
| `jameson-defend-g1` dies 2v1 | 48% | 33% |
| untrained policy kills | ~2% | 0% |
| g3 rams per episode vs a trained evader | 0.78 | 0.38 |

g3 flying 5,565 units an episode, 12 shots, 6.8 hits and 1.07 laser damage
says the kill is earned rather than an artefact — it is not ramming the target
to death (0.02 damage taken per episode) and it is not sitting still. The
gap is presumably the decision cadence it was selected under (15 Hz in the
sim, 10 Hz in the game) plus the real collision, accel and turn-cap numbers,
and it is exactly the class of surprise this merge exists to stop happening
in the other direction.

**These brains are now stale by construction and should be retrained**
deliberately, against the environment the game actually is. Nothing in
`src/ai-training/brains/` was touched by this work.

## Run 18 — first brains trained on the game engine

The first training run in this project's history where the world the brains
were fitted in IS the world they fly in. `src/ai-training/core.ts` is deleted;
episodes step the real `World`, `NpcShip`, `gunnery.ts` and `collisions.ts` at
`FIXED_DT` (1/60, where the old sim used 1/15).

    npm run train -- attack --validate-select --out pirate-attack-e1 \
        --gens 300 --pop 48 --eps 4                       # 82s
    npm run train -- evade  --validate-select --opponent pirate-attack-e1 \
        --out trader-evade-e1 --gens 300 --pop 48 --eps 4  # 8m19s

**pirate-attack-e1** — 100% validation kill rate. `flies()` rejected 145 of 258
generation champions for constant throttle, which is the guard doing its job on
a corpus that large. Measured head to head over 40 held-out seeds: 100% kills
against a scripted trader in a mean 25.0s, against the shipped g3's 26.3s. So
marginally better, and fitted to real physics rather than a copy.

**trader-evade-e1** — 100% validation survival, and honestly overfitted. It was
trained against `pirate-attack-e1` alone, and it shows:

| trader-evade-e1 vs | dies |
| --- | --- |
| pirate-attack-e1 (its training opponent) | 0% |
| pirate-attack-g3 (shipped, unseen)       | 3% |
| **the scripted baseline (unseen)**       | **18%** |

Worse against the dumb opponent than the clever ones — the signature of
specialising into one pursuit curve. An opponent rotation is the fix and it is
what `--pool` is for.

### `--pool` was broken for every phase but attack

The retrain that was meant to fix the overfitting produced a brain that never
throttles: **282 of 282 champions rejected by `flies()`, 0% validation
survival**. Not a training failure — a misused flag.

`traderPool` rotates the TRADER, and it is consumed as the trader controller.
In `evade` the genome IS the trader, so the pool was replacing the candidate
being scored. Eight minutes to discover, and it looked like the search had
collapsed. `evolve.ts` now refuses `--pool` outside `attack`/`pack` with a
message naming `--opponent` as the alternative.

The trader still wants a proper pirate rotation via repeated `--opponent` runs
or a pirate-side pool; `trader-evade-e1` ships as the better of the two but is
not the last word.

## Postscript to run 18 — nothing shipped, and one sentence above is wrong

Appended rather than edited, per this file's rule. The last line of run 18 says
`trader-evade-e1` "ships as the better of the two". **It does not, and it never
did.** Checked against the code rather than memory:

- `brains.ts` imports g3, g2, r2, r4-selectonly and jameson-defend-g1. Every one
  of them predates the engine merge. Neither `e1` brain is imported.
- there is no wiring point for a trader-evade brain in the game *at all* — only
  `viewer/main.ts` loads one. An armed trader flies the DEFENCE policy
  (`jameson-defend-g1`), so "ships" was not merely unset, it had nowhere to go.
- the combat trainer listed `pirate-attack-e1` in its picker and could not load
  it, so every exercise that asked for e1 silently flew g3 and said so in a
  warning nobody was reading.

So: run 18 trained two brains on the game engine, and the game still flies the
pre-merge ones. That is the accurate state.

### `pirate-attack-e1` is now loadable, and still not shipped

`state.brains.engine = true` flies it; the trainer's picker can select it for
real. Not the default, and deliberately so — **it took a 100% validation kill
rate, which is the exact profile of generation 1 and generation 2.** Both won
every measurement in this file and lost the only one that counted, because the
optimal way to hold a firing line is to stop moving, and evolution finds it.
Shipping e1 on its score would be making that mistake a third time with better
numbers.

What settles it is a fight Chris flies: `T` at a station, same scenario, same
seed, e1 as the opposition and then g3, and compare the reports. That comparison
is what the trainer was built for, and it could not be run until now.

The trader remains genuinely unfinished: `trader-evade-e1` is overfitted to a
single opponent (0% deaths against its training partner, 18% against the
scripted baseline) and wants a pirate rotation via repeated `--opponent` runs.


## Run 19 — TODO 29: the trainer flies the commander, and three retrains that must not ship

Not a training round so much as a rebaseline that happened to include one. Three
things changed under the brains at once, so the honest way to read this entry is
top to bottom: the world moved first, the existing brains were measured in it,
and only then was anything retrained.

    npm run evaluate 60          # before, from a worktree at ee60eb8
    npm run survivability
    npm run campaign
    # ...then the same three after every change below

Archived, deterministic, in `train/logs/todo29/`: `evaluate-before.txt`,
`survivability-before.txt`, `campaign-before.txt` and their `-after` twins, plus
the three training console logs. Catalogue manifest hash
`85fece5618c1302dac6b2bbc5c6e78629d37fb5ac27769dddf24fb0b38b52ccb`
(`npm run generate:elite-a -- --check`), episode record schema
`EPISODE_SCHEMA = 1`, exercise record schema `COMBAT_SIM_SCHEMA = 2`.

### 1. Threat came back by SELECTION, not by changing a rule

The oracle is untouched. What changed is which released BUILD a combat role
flies: `src/game/role-variants.ts` gives a pirate, a policeman, a bounty hunter,
a Thargoid and a Thargon the hardest variant of their hull that the source
itself ever filed under that job, instead of the pack's recommended default.
Same design, same geometry, same name, one more point of laser power on most of
them — and still one hundred per cent released data.

| hull | was | now | to a Cobra Mk III |
| --- | --- | --- | --- |
| Sidewinder | D:17 | **V:17** | 9 -> **13** |
| Krait | I:19 | W:19 | 9 -> 13 |
| Mamba | F:18 | W:18 | 9 -> 13 |
| Gecko | A:21 | S:21 | 9 -> 13 |
| pirate Cobra Mk III | B:10 | T:10 | 9 -> 13 |
| Cobra Mk I | A:22 | U:22 (pirate) / V:22 (hunter) | 9 -> 13 |
| Bushmaster | D:33 | S:33 | 9 -> 13 |
| Python | C:11 | U:11 | 13 -> **17** |
| Fer-de-Lance | J:24 | W:24 | 17 -> **21** |
| Monitor | A:30 | S:30 (pirate) | 17 -> 17, bank 132 -> 133 |
| Viper (police) | A:16 | W:16 | 13 -> **17** |
| Moray, Worm, Ophidian, Rattler, Iguana, Chameleon, Thargoid, Thargon | unchanged | | |

A Cobra Mk III's 510-point front face now takes about 39 hits from an ordinary
pirate where it took 57. Traders keep the recommended default: a freighter is
not trying to hurt anyone.

**The Asp Mk II left the pirate and hunter rosters**, and it is the one
deliberate omission in the roster. All three released builds carry the same
packed byte, worth four points before armour, against a minimum flyable-hull
armour of four — so it did ZERO to every ship the commander can fly, and armour
subtracts per hit, so ten of them accumulated nothing. No selection fixes it;
the alternatives were to invent a number the pack does not contain or to adopt
the `>> 1` diagnostic encoding the fidelity contract forbids.
`test/role-variants.test.ts` now asserts that no combat role flies a build which
cannot hurt a Cobra Mk III.

Threat tiers moved with the builds, because `hullThreatTier` reads the build:
the Gecko went 0 -> 1 and the pirate Cobra Mk III 1 -> 2. Tier 0 is Sidewinder,
Worm, Ophidian.

### 2. The episode's target is the commander now

`ai-training/scenario.ts` held the last normalized scale in the project: a
stand-in at hp 1.0 taking a 0.1-0.22 roll per hit. It holds
`game/systems.ts`'s three 255-point pools, hit by `applyDamage` for
`npcLaserDamageToPlayer` points off the firing build's own byte, with the facing
shield chosen by geometry and a ram costing the stated 115. `TARGET_DAMAGE_LO`,
`TARGET_DAMAGE_SPREAD`, `VICTIM_RAM_DAMAGE`, `targetShotDamage` and
`targetHullForPoolPoints` are gone, and `test/damage-paths.test.ts` asserts that
none of the five comes back. Episode pirates are sampled from the whole roster
by the game's own threat-tier rule instead of alternating between two hulls.

**One thing is deliberately left out, and it is the difference between a trainer
and a playtest: the target's pools do not recharge.** A shield face recovers 8.9
points a second and a gang of three lands about two, so an episode with
regeneration in it cannot be lost by anyone and carries no gradient at all.

### 3. Which retired the kill rate, and that is the interesting part

A pirate lands about seven hits in forty-five seconds. Seven times thirteen is
91 points of 765. **Nothing kills the commander inside an episode any more** —
not the shipped brain, not an untrained one, not the scripted aimbot — so every
kill rate in this file reads 0 and ranks nothing.

`--select-kills` and `--validate-select` both rested on it. They now rank on the
SHARE OF HER POOLS taken (or, for `evade`/`defend`, the share she keeps): the
same quantity with its granularity restored, ordered the same way, and
continuous enough to hill-climb. On 60 held-out seeds against a scripted hauler:

| policy | of her pools taken |
| --- | --- |
| scripted aimbot (ceiling) | 25.3% |
| **pirate-attack-g3 (shipped)** | **12.0%** |
| untrained random policy | 1.7% |

`test/ai.test.ts`'s gates were rebaselined onto the same number, and the
collision bounds in `test/combat.test.ts` with them — the roster sampling put
lighter, faster hulls in more episodes, so r2 went 0.10 -> 0.40 rams/episode on
a bound that was 0.3.

### The three retrains

    npm run train -- attack --pool --validate-select --select-kills \
        --out pirate-attack-t29 --gens 300 --pop 48 --eps 6            # 375s
    npm run train -- pack --validate-select --select-kills \
        --out pirate-pack-t29 --gens 300 --pop 48 --eps 6              # 344s
    npm run train -- defend --opponent pirate-attack-g3 --validate-select \
        --select-kills --out jameson-defend-t29 --gens 300 --pop 48 --eps 6   # 926s

300 generations x 48 population x 6 episodes was chosen to fit a ten-minute
wall-clock budget per run so all three could go in parallel; the previous
shipped brains used 350-450 generations at 6-10 episodes, so this is the same
order and slightly cheaper. Training seeds are the usual `gen*977 + e*131 + 7`
stream, validation `5,000,011`, the tournament `10,000,019`, the profile sweep
`20,000,003` and the flight probe `30,000,007` — five disjoint bases.

Validation, on the new metric: attack **27.5%** of her pools taken, pack
**73.2%**, defence **91.0%** of her pools kept.

### None of them ships, and the table that settles it

Every candidate beats its shipped counterpart on held-out seeds, by a lot:

| matchup (60 held-out episodes) | shipped | candidate |
| --- | --- | --- |
| one pirate vs scripted hauler | 12.0% | **29.5%** |
| one pirate vs a commander who fights back | 5.3% | **25.3%** |
| a gang of three vs the same | 23.7% | **53.1%**, 18% kills |
| the defence brain, 2v1 (lower is better) | 21.4% | 22.3% |

And `train/flight-probe.ts` — new, and the whole reason this run has an answer
rather than a temptation — says what those numbers cost. It flies each brain
against a target that stops and turns, and reports the SHAPE of the fight:

| brain | mean speed | range p10/med/p90 | rams/ep | of her pools |
| --- | --- | --- | --- | --- |
| **pirate-attack-g3 (shipped)** | **216** | 85/**234**/964 | 0.20 | 6.1% |
| pirate-attack-r2 (legacy) | 262 | 185/254/1166 | 0.70 | 13.1% |
| pirate-attack-e1 | 182 | 222/706/1740 | 0.93 | 20.7% |
| **pirate-attack-g2** (rolled back, run 16) | **117** | 113/**628**/1762 | 2.27 | **42.1%** |
| **pirate-attack-t29** (this run) | **104** | 102/**754**/1952 | 2.23 | **42.1%** |

**t29 is generation 2 again.** Not similar — the same, to the decimal on the
damage share, and slower still. Mean speed 104 against the shipped brain's 216,
a median engagement range three times longer, and eleven times the contact.
Chris played g2, said *"I think our old AI was more fun to play with"*, and it
was rolled back the day it shipped. Evolution found the turret again the moment
the reward could see damage clearly, exactly as CLAUDE.md says it will.

`pirate-pack-t29` reads the same way — 29.7% of her pools to the shipped pack's
14.2% on the same probe, 1.47 rams an episode against 0.63, and a median
engagement range of 1,340 units, which is sniping rather than a gang closing.
`jameson-defend-t29` is simply worse: it
lets attackers sit on her six for 13.5 seconds against the shipped brain's 2.3
and shoots down 0.12 of them against 0.42.

So **the shipped three are unchanged** — `pirate-attack-g3`,
`pirate-pack-r4-selectonly`, `jameson-defend-g1` — and all three candidates are
kept as evidence, with the flight probe as the reason. What would change the
verdict is a fight Chris flies: `T` at any station, same scenario, same seed.
See docs/BROWSER-TRIALS.md.

### Wired in, still not shipped

Chris asked for them to be pickable, so they are. All three are loaded by
`game/brains.ts`, named in `game/brain-names.ts` (`t29`, `packT29`,
`defendT29`), offered by the combat trainer's brain rows, and — the new part —
selectable for LIVE PLAY from the **LIVE BRAINS (CAREER)** row on the setup
panel, which writes `state.brains` and is in the save. Console form unchanged:
`__game.state.brains.t29 = true`.

The bundle cost of the three candidate weight files is **+46 kB raw, +18 kB
gzipped** on the play chunk. `SHIPPED_BRAINS` is still `{}` and `npm test`
asserts it, so the galaxy flies g3 / pack-r4 / defend-g1 until somebody changes
that one line; a seeded `npm run campaign` is byte-identical across the wiring
change, which is the check that says the default did not move.

The wiring also fixed a drift the review found: `liveBrainFor` — what the
trainer's report names — hardcoded the shipped ids and ignored `BrainSelection`
entirely, so a career flying `state.brains.sharp = 'pro'` was told it fought g3
while `npc.ts` flew g2. Both sides ask `brain-names.ts` now, and
`test/brain-names.test.ts` takes every selection to both and demands the same
policy.

### Balance, after all of it

`npm run survivability`, rewritten because there is no longer a stand-in
durability to correct — it reports what a gang can strip from the commander's
real pools:

| gang | brain | destroyed | pools stripped | a shield flattened | they lost |
| --- | --- | --- | --- | --- | --- |
| 1 | g3 | 0% | 5% | 2% | 0.04/ep |
| 2 | g3 | 0% | 18% | 12% | 0.36/ep |
| 3 | g3 | 5% | 31% | 34% | 0.69/ep |
| 4 | g3 | 9% | 43% | 55% | 1.13/ep |
| 3 | pack (organised) | 1% | 15% | 6% | 0.26/ep |
| 4 | pack (organised) | 1% | 23% | 12% | 0.39/ep |

A single opportunist is a nuisance, two are a fight, four flatten a shield face
in more than half of engagements, and the defender still lives — which is what
the harder builds were meant to buy. Note the reversal against the old table:
the SOLO brain is now more dangerous than the pack policy at every gang size,
because the pack brain snipes from 1,447 units where g3 closes to 234, and the
harder builds reward closing.

`npm run campaign` passes every check, and gained three of them: the receptions
are now reported and asserted in EARLY / MIDDLE / LATE thirds of a career.

| third | tier mix | tier1+ | gangs | deaths | cargo lost |
| --- | --- | --- | --- | --- | --- |
| early | 70/24/6 | 30% | 9 | 0.42 | 11.1t |
| middle | 55/34/12 | 45% | 27 | 0.40 | 11.8t |
| late | 42/36/22 | 58% | 57 | **0.00** | 10.8t |

Escalation works and the upgrades outrun it: the late band throws twice the
tier-1+ receptions and six times the gangs at her, and kills nobody. Median net
worth moved 6,033 -> 5,926 Cr and kills 20.8 -> 20.6 per career, which is the
tier reshuffle changing which bounties get paid and nothing else.

### The Constrictor: a signposting fix, and a figure that was off by ten

Chris's ruling stands and the oracle is untouched. Two things were checked and
one was wrong.

The military laser is **6,000 Cr, not 60,000** — the catalogue's `60000` is
tenths of a credit, as everything in this project is (docs/INVARIANTS.md invariant 8),
and both the TODO and a comment in `test/campaign.ts` had read it as credits.
And it is not remote: 49 of galaxy 1's 256 systems are TL10+, and **201 of 256
are within a single 7-light-year jump of one** (241 within two). Every commander
in a 40x60 campaign run had already docked somewhere that sells it before the
Navy called.

So the mission is reachable, and what was missing was being told. The docking
transmission and the mission line now carry a warning derived from the
commander's ACTUAL fitted gun through the oracle:

> NAVY: TARGET ARMOUR HALVES LASER FIRE — YOUR BEAM LASER SCORES 0 A HIT, A
> MILITARY LASER 3

It states the two numbers rather than issuing an instruction, and it says
nothing at all once she is carrying the right gun. The beam laser is the trap
worth signposting: it is the upgrade, and against this one hull it is worse than
the pulse laser it replaced (0 a hit against 1).

The campaign's own 3% military-laser figure is unchanged and still measures the
BOT: its shopping list spends down to a 1,500-tenth float, so it holds a median
of 63 Cr in cash at the moment the Navy calls, whatever its 5,900 Cr of net
worth says. That is a purchasing policy, not a reachability problem, and the
campaign now asserts the reachability instead.

## Probe run — TODO 32: the numbers on the trainer's brain rows

Not a training run. The combat trainer's two brain rows answered "which brain"
with a filename, and TODO 32 gives every value a one-line CHARACTER — what it
does in a fight, and the one measured number that shows it. This is where those
numbers come from, so that every figure on the panel is traceable and none of
it is invented.

    node --experimental-strip-types --no-warnings --input-type=module -e \
      "import { printFlightShapes } from './train/flight-probe.ts';
       printFlightShapes([...the eight solo and pack policies...], 30)"

Archived at `train/logs/todo32/flight-probe.txt`. Probe base `30,000,007` and
`train/flight-probe.ts` are both unchanged, and the seven rows that also appear
in run 19's `train/logs/todo29/evaluate-after.txt` reproduce byte for byte —
which is the check that says nothing under the brains has moved since.

| brain | speed | range p10/med/p90 | passes | rams/ep | of her pools |
| --- | --- | --- | --- | --- | --- |
| pirate-attack-g3 (shipped) | 216 | 85/**234**/964 | 0.00 | 0.20 | 6.1% |
| pirate-pack-r4-selectonly (shipped) | 144 | 393/**1447**/2905 | 0.83 | 0.63 | 14.2% |
| pirate-attack-t29 | 104 | 102/**754**/1952 | 0.00 | 2.23 | 42.1% |
| pirate-pack-t29 | 185 | 198/**1340**/4505 | 0.50 | 1.47 | 29.7% |
| pirate-attack-g2 | 117 | 113/**628**/1762 | 0.00 | 2.27 | 42.1% |
| **pirate-attack-g1 (new)** | **117** | 103/**868**/1994 | 0.13 | 1.97 | 37.2% |
| pirate-attack-e1 | 182 | 222/**706**/1740 | **0.93** | 0.93 | 20.7% |
| pirate-attack-r2 | 262 | 185/**254**/1166 | 0.00 | 0.70 | 13.1% |

**`pirate-attack-g1` is the one new row.** The picker offers it and the game
cannot fly it — `brains.ts` does not import it, so an exercise refuses it on the
record — but the weights file is in the tree and had never been probed, and
"never probed" on the panel would have been a worse answer than measuring it.
It reads as generation 2 does: speed 117, a median engagement range of 868, and
1.97 collisions an episode. Generation 1 and 2 are the same animal, which is
what the rollback said at the time.

Two deliberate omissions, both stated in the archived log:

- **The two `jameson-defend` policies are not in the table.** `flight-probe.ts`
  flies the brain in a PIRATE seat against a holding target, so probing a
  defence policy that way asks it a question it was never trained on — the run
  above does produce rows for them, and they mean nothing. Their character lines
  quote run 19's tournament instead ("the defence policy: two shipped pirates on
  her tail"): `jameson-defend-g1` shakes attackers off her six in 2.3s and
  shoots down 0.42 an episode; `jameson-defend-t29` lets them sit there 13.5s
  and downs 0.12.
- **The on-six column reads 0.0s for every brain and nothing quotes it.** The
  probe's target holds station rather than running, so `tailTime` never
  accumulates. It is a fact about the probe, not about the brains.

`scripted` has no weights file to probe, so its line quotes the tournament as
well: 58% accuracy and 31.8s on a hauler's six, and 0.93 ships lost an episode
to a commander who fights back.

## 2026-08-03 — the unshipped weights were deleted (TODO 57)

**Nothing above was re-measured, re-run or rewritten.** This entry records one
thing: the weights files for every policy this project trained and did not ship
were removed from `src/ai-training/brains/`, which now holds exactly the three
the game flies —

```text
pirate-attack-g3            the solo pirate
pirate-pack-r4-selectonly   an organised gang
jameson-defend-g1           an armed trader, and player assist
```

— and `npm test` fails if a fourth appears or one of those three goes missing.
31 files went: the round-1 to round-14 attack rounds, five `trader-evade`
policies, the eight-way `pirate-pack-r4` ablation, generations 1, 2 and 4, `e1`,
and TODO 29's three `t29` candidates. Chris, 2026-08-03: *"we should clean up
all the experiments that aren't shipping — so we can just show the combat AI
that we actually ship."*

**The figures in every entry above stand as the record of what was measured.**
They were taken on the seeds and the commands each entry states, the archived
tables in `train/logs/` are untouched, and this file's own rule — append, never
rewrite — is why they are still here in full. What is gone is the ability to
re-run them without retraining: a round that loaded a frozen opponent by name
now needs that opponent regenerated first (`npm run train -- <phase> --out
<name>`), and the trainer's brain picker, the combat viewer and
`train/evaluate.ts` offer the shipped three plus the scripted control and
nothing else.

Putting a candidate back is deliberately still one move: drop its `.json` in
`src/ai-training/brains/`, add the stem to `CANDIDATES` in `train/evaluate.ts`
for the tournament and the flight probe, and — if it is to be FLOWN rather than
scored — give it a `BrainName`, a character line and a `BrainSelection` entry in
`src/game/brain-names.ts` plus an import in `src/game/brains.ts`. The guard will
report the extra file until it is either promoted or removed, which is the
decision it exists to force.

One consequence worth stating because it is not a number: the six A/B flags that
named those weights (`legacy`, `sharp`, `engine`, `t29`, `packT29`, `defendT29`)
are gone from `BrainSelection`, so the translation table at the top of this file
now has two live rows rather than four — `__game.state.brains.scripted = true`
and `__game.state.brains.pack = true`. A save carrying one of the deleted flags
still loads; nothing reads it, so that career flies the shipped brains, and the
combat trainer's LIVE BRAINS row says the selection cannot be named and offers
to take it back.

## 2026-08-03 — the attack-run candidate was deleted (TODO 61)

**Nothing above was re-measured, re-run or rewritten**, and that includes every
`pirate-attack-e1` figure in this file: run 18's 100% validation kill rate, run
19's probe line (speed 182, range 222/**706**/1740, **0.93** passes, 20.7% of its
own bank), and the argument in *"`pirate-attack-e1` is now loadable, and still
not shipped"* all stand as the record of what was measured. `train/logs/` is
untouched. What this entry records is that **the weights file is gone**, so
those numbers can no longer be re-run without retraining the phase
(`npm run train -- attack --validate-select --out pirate-attack-e1 ...`, the
command run 18 states).

`e1` was restored from `15330cb` after TODO 57 for one job: to be compared,
in a fight Chris flies, against `pirate-attack-g3` as the solo pirate policy.
**That job stopped existing.** `d563e3d` made the scripted attack run what ships
for solo pirates and organised gangs alike, so neither `e1` nor `g3` is the solo
default any more, and a candidate to replace a default that no longer exists is
being kept by inertia rather than by an argument. Chris, 2026-08-03: delete it.

Gone with the file: its `BrainName`, its character line (`MAKES RUNS`), its row
in `SIM_BRAINS` and in `LIVE_BRAIN_IDS`, the `candidateBrainFile` import in
`src/game/brains.ts`, `CANDIDATE_SOLO` / `CANDIDATE_SOLO_BRAIN`, and its entry in
`CANDIDATES` in `train/evaluate.ts` — which is empty again, its resting state.
`src/ai-training/brains/` is back to exactly the three the game loads, and
`npm test` still fails if a fourth appears or one goes missing.

The A/B flag went too: `BrainSelection.passes` is deleted, so the translation
table at the top of this file has three live rows —
`__game.state.brains.scripted = true`, `.pack = true` and `.trained = true`.
A save carrying `passes` still loads and is **not** migrated, exactly as a save
carrying one of TODO 57's six does: nothing reads the key, the career flies the
shipped brains, and the trainer's LIVE BRAINS row reports a selection it cannot
name and offers to take it back. `test/brain-names.test.ts` asserts that for
`passes` beside the six, because `passes` was the one deleted flag
`pirateBrainNameFor` itself read.

Putting a candidate back is still the one move TODO 57's entry describes, and
this run is the worked example of the guard doing its job: it reported the extra
file for as long as the decision was open, and the decision — not the guard —
is what closed it.

## 2026-08-04 — the target's pools come back (TODO 63), and a NEW BASELINE

**Every defence and evade figure above this line was measured in a world where
the commander's damage was permanent.** They are not wrong; they are
**incomparable** with anything measured after this entry, and that is the whole
point of writing it rather than quietly re-baselining. Attack and pack figures
are unaffected, and the paragraph "what did NOT change" below is the measurement
that says so rather than the assurance.

`ai-training/scenario.ts`'s `TargetShip.fly()` ran two lines of `systems.ts`'s
`regenerate` — the laser's cooldown and heat — under a comment calling them *"the
only half a target has"*. It runs the whole function now, the same call
`world-step.ts` makes for the commander every frame: the energy bank recharges
every tick and both shield faces come back once the bank is out of its last
quarter (`energyLow`). The **extra energy unit** went in with it as part of the
defence fit-out, beside the laser choice, because it DOUBLES the recovery rate
and is 15,000 credits next to the combat computer on the same shelf; it is an
`EpisodeOptions.targetEnergyUnit` and it is on the episode's setup record.
`EPISODE_SCHEMA` is **2**.

The old comment's arithmetic was right — a shield face recovers 8.9 points a
second and one pirate lands about two — and its conclusion (*"an episode with
regeneration in it cannot be lost by anyone and carries no gradient at all"*) was
an argument about the FITNESS settled by changing the WORLD. What the gradient
should be is `train/evolve.ts`'s problem and docs/TODO/65's; what the world is,
is the game's.

### What it did to the numbers

`npm run defence-probe`, `jameson-defend-g1`, the same 240 held-out episodes
either side of the change:

| | pools left | by 1 / 2 / 3 / 4 pirates | killed | died |
| --- | --- | --- | --- | --- |
| before (permanent damage) | 78.0% | 91.2 / 81.5 / 75.4 / 64.7 | 5.7% | 0/240 |
| **after (the game's rule)** | **99.2%** | 100.0 / 99.6 / 99.1 / 97.9 | 5.7% | 0/240 |

Identical kills, because the defence observation carries **no health input at
all** (`policy.ts` `observe()` is 14 numbers and own-hp is not one of them —
only the 26-input `observePackWide` has it, at slot 25). So a defender cannot
condition on its own pools, cannot learn "break off and heal", and its flying
does not change: what changed is the accounting, and the gradient.

`npm run survivability` moved further, and this is the row that matters for
balance:

| gang | destroyed, before | destroyed, after | a shield flattened, before → after |
| --- | --- | --- | --- |
| 3 × `pirate-attack-g3` | 5% in 39.2s | **0%** | 34% → 10% |
| 4 × `pirate-attack-g3` | 9% in 31.7s | **0%** | 55% → 17% |

Cumulative damage is unchanged (5 / 18 / 32 / 44% of her pools by gang size,
against 5 / 18 / 31 / 43 before). **Four pirates cannot kill a Cobra Mk III
inside 45 seconds once she recharges.** That is the game's own answer and the
reason the real thing is survivable; treat every survivability row as an even
softer floor than its header already said.

### What did NOT change, measured rather than assumed

`targetDamageShare()` was `1 - trader.hp` and is now `trader.damageTaken /
maxPool` — the SAME question `pirateDamageShare` has always asked of a pirate,
which was cumulative precisely because pirates have always regenerated. Under
recovery the two stopped being the same number: over `test/ai.test.ts`'s 60
held-out seeds the shipped pirate takes **12.0%** of the commander's pools and
leaves **0.4%** still missing at the end, because a scripted hauler heals the
rest back before the clock runs out. `fitnessAttack` pays 6× this for a pirate's
WORK and `fitnessPack` divides it by the clock to get pressure, so terminal hp
would have cut the attack phase's reward signal thirtyfold.

With the cumulative reading, a solo attack episode is **bit-identical** either
side of the change (91.67 points taken, t 45.017, 15.58 shots, 0/60 kills, over
`test/ai.test.ts`'s seeds), and `test/ai.test.ts`'s gates print exactly the
figures they were baselined on: 12.0% shipped, 1.7% untrained, 20.8% defended
against 23.5% scripted. **The attack phase does not need retraining.**

**The pack phase is a different story and is NOT resolved here.** Three
`pirate-pack-r4-selectonly` against an armed scripted trader killed her in
**21 of 60** episodes before and **0 of 60** now, so `fitnessPack`'s kill bonus
(`12 + 5 × (1 - t/maxTime)`) never fires against that opponent any more. Its
damage and pressure terms are cumulative and intact, and the shipped pack brain
was fitted with the bonus live. Nobody has retrained it and nobody should on this
entry alone — it wants its own decision, with a fight Chris flies.

### The retrain: 300 × 48 × 6, twice, and NEITHER SHIPS

    npm run train -- defend --validate-select \
        --out jameson-defend-t63  --gens 300 --pop 48 --eps 6      # 926s train, 16m21 wall
    npm run train -- defend --validate-select --select-kills \
        --out jameson-defend-t63k --gens 300 --pop 48 --eps 6      # 917s train, 15m51 wall

Same budget as run 19's three retrains, opponent the scripted attack run (what
ships), the varied fight from the new `train/defence-fight.ts` — 1-4 pirates,
three hulls, beam or military, energy unit or not.

    t63   99.9% validation pools left, shaped 11.89, throttles forward 20%
          (286 champions re-judged, 72 rejected for constant throttle)
    t63k  99.8% validation pools left, shaped 12.36, throttles forward 100%
          (288 champions re-judged, 157 rejected)

The item predicted the champion's pools-left would be "materially higher than
the ~82% the pre-change policies score". It is: **99.9%**. That is the whole
problem. On 240 held-out episodes, against the incumbent:

| brain | pools left | taken/ep | dealt/ep | kills | shots/ep | cleared |
| --- | --- | --- | --- | --- | --- | --- |
| **`jameson-defend-g1` (shipped)** | 99.2% | 168.1 | **25.0** | **5.7%** | 234 | **6/240** |
| `jameson-defend-t63` | 99.2% | 170.4 | 10.2 | 3.7% | 41 | 2/240 |
| `jameson-defend-t63k` | 98.9% | 175.1 | 3.0 | 4.1% | 13 | 1/240 |

Both candidates take **more** damage than the brain they were meant to beat, deal
**2.4× and 8× less**, and fire 41 and 13 shots an episode against 234. `t63k`
has essentially stopped shooting. **Neither is promoted; the weights are
deleted** (TODO 57's precedent — `src/ai-training/brains/` holds exactly the
three the game flies and `npm test` fails on a fourth), and
`train/logs/jameson-defend-t63*.jsonl` are the record. Re-running the table means
retraining with the commands above.

This is not a failed search, and more compute is not the answer — docs/TODO/65
says why, in arithmetic. `evolve.ts` picks its champion on
`v.win * 1000 + clamp(v.shaped, ±499)` with `win` = terminal `hp`, and in this
world the five candidate behaviours score:

| defender | pools left | damage TAKEN | kills | shaped | selection score |
| --- | --- | --- | --- | --- | --- |
| `holding` (turns and shoots) | 97.5% | **150** | **42.4%** | **18.09** | **993.6** ← last |
| `jameson-defend-g1` | 99.1% | 167 | 3.5% | 8.89 | 999.5 |
| `scripted` hauler | 98.7% | 179 | 0.0% | 11.84 | 998.8 |
| `weaving` | 98.9% | 190 | 1.0% | 12.18 | 1001.0 |
| `runner` (never fires) | 99.3% | 172 | 0.0% | 11.78 | **1005.0** ← first |

The pilot that takes the least damage and kills the most comes last; the one that
never pulls a trigger comes first. `fitnessDefend` ranks them correctly and the
1000× outcome term overrides it. **And regeneration adds a second inversion on
top:** `holding` CLEARS 7 of those 24 fights, mean 37.3s against 45.0, so it
heals for less of the clock and reads worst on terminal hp despite being the
least damaged — over the full-length episodes only, the gap all but closes
(98.4% against 99.2%). Terminal `hp` now penalises **winning**. Both inversions
belong to docs/TODO/65, which has this table appended to it, and the honest
outcome here is to leave the shipped brain alone and let 65 fix the selection
first.

CLAUDE.md's *"the defence policy evades superbly and shoots badly"* stands, and
this run is one more piece of evidence that it is a property of the selection
rule and not of the brain.

### Also in this change

- **`train/defence-fight.ts`** — one function for what a defender meets, imported
  by `train/evolve.ts` and `train/defence-probe.ts`. It was four lines copied into
  both, each with a comment asking the reader to keep them in step; adding the
  energy-unit axis to that was the run where they would have stopped agreeing.
  The bit it reads (6) was chosen by counting: bit 21, the obvious next one, is
  CONSTANT over a 240-episode probe because 2²¹ is 265 strides of 7,919 wide.
- **`EpisodeSetup.target.laser` was lying.** It read `pulse` whenever the target
  flew the commander's hull, so every defence episode — all of which fire beam or
  military — recorded the wrong gun. It reports `opts.traderLaser` now.
- **`train/survivability.ts`** counts a flattened shield when it happens rather
  than at the end (a face that came back is still a face that went down), and its
  header no longer claims recharge is left out.
- **`train/profile-sweep.ts`**'s share column is cumulative, beside the `taken`
  column it has to agree with.

## 2026-08-04 — missiles exist in training now (TODO 62)

**A NEW BASELINE, AGAIN, AND A WIDER ONE THAN 63's.** Every defence, evade and
survivability figure taken before this entry — including the ones taken earlier
today, under docs/TODO/63 — was measured in a world where the only thing that
could reach the commander was a laser. It is not any more. As with 63 this is
written down rather than quietly re-baselined; attack and pack figures against a
target that never shoots back are unaffected, and the measurement below says so.

`NpcShip.chooseWeapon` turns a laser shot into a missile launch and was reachable
only from `NpcShip.update()`, which a training episode never calls. So no pirate
in any training run this project has ever done had *decided* to launch. Measured
with the item's own snippet — 200 pirates, full racks, hurt to 30% of their
banks, 45 seconds each:

    before                              { laser: 1374, missile: 0 }
    after, driven the way an episode
    drives one (fly, then choose)       { laser: 1365, missile: 400 }

400 warheads from 200 ships carrying two apiece: the rack empties exactly and
never further. Two more defects went with it — `scenario.ts`'s resolver never
read `shot.weapon` (a missile would have landed instantly, for laser damage) and
never spent the round (the rack was infinite). `ordnance.ts` now owns
`launchNpcMissile`, which **both** resolvers call, and `Ordnance` takes an
`OrdnanceWorld` — `attach`, `detach`, `npcs` — so an episode flies the game's own
missile model over its own fleet with nowhere to draw. There is no second missile
model. `EPISODE_SCHEMA` is **3**.

### What it did to the numbers

`npm run defence-probe`, `jameson-defend-g1`, the same 240 held-out episodes
(bases 8,675,309 and 1,234,577):

| | pools left | by 1 / 2 / 3 / 4 pirates | killed | died |
| --- | --- | --- | --- | --- |
| before (lasers only, this morning) | 99.2% | 100.0 / 99.6 / 99.1 / 97.9 | 5.7% | **0/240** |
| **after** | **90.1%** | 96.4 / 89.5 / 88.8 / 86.2 | 5.7% | **6/240** |

272 warheads left the rail across 480 such fights, out of 433 carried, with 161
still racked at the end and **not one ship firing more than it carried**.

`npm run survivability`, 200 episodes a row, is the same claim from her side, and
it is the first time this table has not been a column of zeroes:

| gang | destroyed, before | destroyed, after | pools stripped |
| --- | --- | --- | --- |
| 3 × `pirate-attack-g3` | 0% | **4% in 31.2s** | 32% → 34% |
| 4 × `pirate-attack-g3` | 0% | **4% in 23.2s** | 44% → 48% |
| 3 × `pirate-pack-r4-selectonly` | 0% | **1% in 13.0s** | 15% → 16% |
| 4 × `pirate-pack-r4-selectonly` | 0% | **1% in 8.3s** | 23% → 24% |

**A gang of four now kills her in 8.3 seconds when it kills her**, against
Chris's real 9.1-second death on 2026-08-03, which was almost entirely missiles.
Note what the last column says: cumulative damage barely moved. A missile is not
a bit more pressure, it is a discontinuity — 250 points of a 765-point commander
arriving at once, which is why it changes the death rate and not the average.

The kill column did not move in a single cell of either table. That is
docs/TODO/71: a defence policy's fourteen observations do not include its own
health, so nothing about how it flies can change.

### What did NOT change

Three `pirate-pack-r4-selectonly` against the armed scripted trader, docs/TODO/70's
own 60 seeds: `fitnessPack` **4.61**, kill term **0.00**, **0 kills**, 442.2 pool
points, 80.0 shots — byte-identical to 70's "after" row — and **0 missiles
launched**. 70 hoped this item would restore its kill bonus. It does not.

The reason is a fourth divergence between the game and the trainer, found by this
work and written up as docs/TODO/73. `npcMissileEmergency`'s three ways in are a
hull under 0.4, a dead wingman, and **two completed passes**; `passesMade` only
ticks inside `attack()`, the scripted break-off; and a training episode never
hands over to it, where `NpcShip.update()` hands over inside
`BRAIN_HANDOVER_RANGE`. Measured over 60 fights, three attackers against a
`jameson-defend-g1` target with a military laser:

| attackers | passes per pirate | missiles launched (of 61 carried) |
| --- | --- | --- |
| `pirate-attack-g3` (brain) | **0.00** | 13 |
| the scripted attack run | **3.88** | 35 |

So in training the missile is currently a weapon of desperation only, and the
"tougher than you thought" launch Chris asked for — the one that rewards
ENGAGING — is unreachable for brain-flown ships. Against a target that never
shoots back, none of the three reasons can fire at all.

`test/ai.test.ts`'s gates print 12.0% shipped and 1.7% untrained, exactly as
before: a solo pirate against an unarmed scripted trader launches nothing, so the
attack phase's baseline is untouched. Its defended figure moved 20.8% → 21.9%.

### The retrain: 300 generations, twice, and NEITHER SHIPS

    npm run train -- defend --validate-select \
        --out jameson-defend-t62  --gens 300                        # 452s, pop 48, eps 3
    npm run train -- defend --validate-select \
        --out jameson-defend-t62b --gens 300 --pop 48 --eps 6       # 881s — run 19's budget

Opponent the scripted attack run (what ships), the varied fight from
`train/defence-fight.ts`, and now with warheads in it.

    t62   94.1% validation pools left, shaped 12.02, throttles forward 12%
          (290 champions re-judged, 233 rejected for constant throttle)
    t62b  94.2% validation pools left, shaped 11.73, throttles forward 75%
          (289 champions re-judged, 220 rejected)

On the same 240 held-out episodes as the table above:

| brain | pools left | taken/ep | dealt/ep | kills | shots/ep | cleared | died |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`jameson-defend-g1` (shipped)** | 90.1% | 300.4 | **24.7** | **5.8%** | **232** | **6/240** | 6/240 |
| `jameson-defend-t62` | 90.7% | 316.7 | 0.0 | 5.1% | **0** | 0/240 | 5/240 |
| `jameson-defend-t62b` | **92.7%** | **277.7** | 4.1 | 3.3% | 26 | 2/240 | **4/240** |

**`jameson-defend-t62` fires zero shots. Not "few" — none, over 240 fights** —
and it still reads *better* on the metric champions are chosen by. `t62b` is a
genuinely tougher pilot to kill (92.7% of her pools, 277.7 points taken, 4 deaths
against 6) and shoots 26 times an episode against 232, deals a sixth of the
damage, and clears 2 fights where the incumbent clears 6.

Neither is promoted. The bar was "better on pools-left AND on kills"; both are
better on the first and worse on the second, which is docs/TODO/65's inversion
appearing for the third time and this run's most legible instance of it yet — a
policy that has stopped pulling the trigger altogether is the one the selector
prefers. `src/ai-training/brains/` holds the same three files it held this
morning; `train/logs/jameson-defend-t62*.jsonl` are the record, and re-running
the table means retraining with the commands above.

**Missiles did not change that, and were never going to.** Making the world
harder does not fix a selector that pays 1,000× for terminal `hp` and 3 points
for a kill. What they DID do is make the difference between defenders visible in
a column that was previously saturated: `died` was 0/240 for everything before
today, and it now separates 4, 5 and 6. Do docs/TODO/65 next, then retrain
defence again — with 71's health input if it lands, and 72's E.C.M. after that.

## 2026-08-04 — one resolver (TODO 64), and the smallest baseline shift so far

A refactor rather than a training run, recorded here because it touched the world
an episode is fought in and every entry above is measured in that world.

`game/fire-resolution.ts` is now the one home for "a ship fired, what happens" —
the rack, the hit roll, the damage and which shield face takes it — and both
`world-step.ts` and `ai-training/scenario.ts` call it over a four-member
`FireWorld` each implements. Nothing about the RULES changed; what changed is that
there is one copy of them. The game is byte-identical over 7,000 traced frames
(docs/TODO/64 has the hashes).

**One number moved, and it is the row this closed that had a number in it.** The
range the hit dice read is measured inside the resolver now, after the shooter's
own step has moved it, where the episode used to pass in the range it had measured
BEFORE the flight. Over 120 held-out episodes (40 seeds × `scripted`/`holding`/
`weaving`, three scripted pirates apiece, armed target, military laser):

| | before | after |
| --- | --- | --- |
| episodes whose report differs | — | **4 of 120** |
| mean pool points taken | 372.4 | 372.7 |
| pirate accuracy | 0.6201 | 0.6210 |
| target killed | 5 | 5 |

No `random()` call moved — the draws are the same draws in the same order, read
against a threshold a few units of range different — so **every archived figure
above is still comparable** and `EPISODE_SCHEMA` stays at 3. That is a deliberate
statement and not an assumption: 63 and 62 both said the opposite about their own
changes, in their own entries, because both changed what the pools could do.

`npm run campaign` prints byte-identical output either side of the change.

## 2026-08-04 — the selection rule changed (TODO 65), and the brain it found was not promoted

The first entry here that changes **how a champion is chosen** rather than what
it is fought against. Nothing about the world moved: `EPISODE_SCHEMA` is still 3
and every figure in the missiles entry above is still comparable.

### What changed

`train/selection.ts` — a new file, because the rule had to be assertable and it
was two expressions inside a script that trains on import.

```
score = 0.75 x outcome(0..1) + 0.25 x shaped/full-scale(0..1)

attack, pack   targetDamageShare()                    unchanged
evade          1 - targetDamageShare(), 0 if she died
defend         0.6 x (1 - targetDamageShare())
             + 0.4 x attackerDamageShare(),           0 if she died
```

It was `outcome * 1000 + clamp(shaped, ±499)` with `outcome = trader.hp`, and
three things were wrong with that at once: shaped fitness ranges 8 to 19 against
a bound of 499 so the shaping contributed **1.9%** of the score and the tie-break
never fired; terminal `hp` under regeneration pays a defender for DAWDLING,
because clearing a fight ends the episode early and she heals for less of the
clock; and killing paid 3 points where 1% of her pools paid 10, so shooting was
strictly irrational. `jameson-defend-t62`, in the entry above, fired zero shots
across 240 fights and still outranked the shipped brain under it.

`Episode.attackerDamageShare()` is the new quantity: what her gun took off the
WHOLE attacking force, as a share of their banks. It is the same argument
`targetDamageShare` already made on the pirate side — a kill count is a rare
binary and cannot rank anything — and it separates what the kill count cannot:
`jameson-defend-g1` reads 22.7% there against a 3.5% kill share.

### The three runs

```sh
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select --select-kills \
  --out jameson-defend-t65a
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select \
  --out jameson-defend-t65b
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select --select-kills \
  --seed-brain jameson-defend-g1 --out jameson-defend-t65c
```

~8 minutes each. Opponent: the scripted attack run (what ships). Logs:
`train/logs/jameson-defend-t65{a,b,c}-*.jsonl`.

`npm run defence-probe -- 120 jameson-defend-g1 jameson-defend-t65a
jameson-defend-t65b jameson-defend-t65c` — 240 held-out episodes each, `died` and
`kept` over 800:

| brain | pools left | broke | killed | died | kept (cumulative) |
| --- | --- | --- | --- | --- | --- |
| **`jameson-defend-g1` (shipped)** | 90.1% | 16.5% | 5.7% | **19/800** | 63.3% |
| `jameson-defend-t65a` | **94.3%** | 5.8% | 1.4% | **4/800** | **70.7%** |
| `jameson-defend-t65b` | 91.2% | 5.1% | 2.3% | 3/800 | 63.3% |
| `jameson-defend-t65c` | 89.7% | **57.8%** | **41.0%** | 42/800 | 66.5% |

**The rule does what it was changed to do.** On the validation base and on both
held-out bases, the old rule ranks the 42%-kill fighter LAST and the new rule
ranks it FIRST:

```
held-out (8,675,309), 240 episodes
brain                  terminal hp   shaped    OLD score   NEW score   kill%
jameson-defend-g1        91.2%     8.55      920.9     0.4410    6.3%
jameson-defend-t65a      95.3%    11.62      964.2     0.4873    1.8%   <- old rule
jameson-defend-t65b      91.4%    12.19      926.2     0.4511    3.4%
jameson-defend-t65c      89.9%    14.49      913.3     0.6480   42.5%   <- new rule
```

`t65a` is the shape the old rule always produced, arriving on schedule: it keeps
70.7% of her pools, dies four times in 800, and kills 1.4%. It is a better
runner than the runner.

### Nothing was promoted, and why

`t65c` kills **6.8x** what the incumbent kills and takes LESS cumulative damage
doing it — and it is destroyed in **42 of 800 held-out fights against 19**
(z ~ 3.0). The bar was "better kills AT equal survivability"; this is a trade,
in the one currency the outcome itself refuses to trade.

**Every death of every defence policy has a warhead in it** — 19 of 19, 4 of 4,
42 of 42. No defence policy has ever been destroyed in these 800 episodes
without a missile landing. So the column the promotion turns on belongs to
docs/TODO/72: she has no E.C.M. and no output that could press one, so a warhead
in training cannot be answered. And `t65c` attracts more of them (0.64 launched
at her an episode against g1's 0.59 and `t65a`'s 0.27) precisely because it kills
packmates, which is one of the things `NpcShip.chooseWeapon` launches on.

`src/ai-training/brains/` holds the same three files it held this morning.
Rerun any of the three commands above to get the weights back.

### What this does NOT fix

**docs/TODO/71.** `observe()` is fourteen numbers and own health is not one of
them, so `t65c` is the aggressive end of a health-BLIND family — "fight, take the
damage, break off while the shields come back" is still not a policy the search
can express, whatever it is selected on. The kill rate above is that family's
ceiling, not the phase's.

**docs/TODO/74** sits under every `broke` and `killed` figure here: the episode's
armed FREIGHTER lands about 51% more of its shots than the game's would. It does
not touch the `playerCobra` rows (the commander's own deterministic laser); the
`traderCobra` row is the one to distrust.

## 2026-08-04 — the defender can see itself and answer a missile (TODO 71 + 72), and `jameson-defend-g2` ships

The first entry that changes **what a policy observes and what it can do**, and
the first defence brain promoted since g1. `EPISODE_SCHEMA` moves 3 → 4: a
record from before today describes a world in which a warhead could not be
answered, and the `died` column across the two is not one measurement.

### What changed

Two items, done as one pass because they are one observation change.

**docs/TODO/71 — a defender could not see its own pools.** `observe()` is
fourteen numbers and none of them was the ship's own condition, so a defender at
full shields and one hit from the escape capsule emitted identical controls in
identical geometry. That is why the kill rate was identical to the decimal
either side of TODO 63.

**docs/TODO/72 — the target could not answer a missile.** No E.C.M. fitted, no
output that could press one, no observation that there was anything to press.
Every death of every defence policy ever measured had a warhead in it — 19 of
19, 4 of 4, 42 of 42.

**The encoder decision, and it is the load-bearing one.** A separate
`observeDefend()` at **17 inputs** and a separate `DEFEND_OUT_SIZE` at **13
heads**, rather than two more slots on `observe()` and a twelfth output on
everything. `observePack`/`observePackWide` both call `observe()` first and
`OUT_SIZE` is shared, so the obvious version invalidates all three shipped
brains and costs three retrains. This confines it to the defence phase:
`pirate-attack-g3` and `pirate-pack-r4-selectonly` are **byte-identical** and
were not retrained, `npm run flight-probe` is byte-identical to its pre-change
output, and `test/defence-answer.test.ts` asserts both files still declare the
shapes they were trained at.

```
observeDefend, 17 = the solo 14 plus
  14  everything left, over everything she can hold   (systems.ts poolsLeft)
  15  the energy bank alone                           (systems.ts energyLeft)
  16  a hostile warhead is in the air                 (Ordnance.missileInbound)

DEFEND_OUT_SIZE, 13 = pitch(3) roll(3) throttle(3) fire(2) + E.C.M.(2)
```

The fore/aft shield SPLIT was deliberately left out: 17 keeps the four encoder
sizes distinct (18 is `observePack`'s), slots 14 and 15 already give the total
and the bank so only the split is missing, and every input is search space a
fixed generation budget has to cover. It is one size (19) away.

**E.C.M. is an ACTION, not a reflex**, and it is **fitted in every defence
fight** rather than rotated (`train/defence-fight.ts` says why: a commander with
a 20,000-credit combat computer has the 600-credit E.C.M., and rotating an axis
no input can see is TODO 65's mistake in a new place). The one-in-the-air cap
stays. `autopilotEcm` gates the press on there being a warhead to answer, so the
trainer (deciding every step) and the combat computer (10 Hz) spend the same one
burst per warhead.

`widenBrain()` is what made the retrain like-for-like: it re-strides a genome
into a wider shape with the new weights at zero, so `--seed-brain
jameson-defend-g1` still starts generation 0 as g1 exactly — the run changes the
observation without also changing where the search starts.

### The three runs

Identical to the TODO 65 commands, so the comparison is like-for-like. 8m38s
wall clock for all three in parallel; ~7 minutes each.

```sh
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select --select-kills \
  --seed-brain jameson-defend-g1 --out jameson-defend-t71a
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select --select-kills \
  --out jameson-defend-t71b
npm run train -- defend --gens 300 --pop 48 --eps 3 --validate-select \
  --out jameson-defend-t71c
```

`npm run defence-probe -- 400`, 800 held-out episodes each, against the scripted
attack run (1-4 pirates, three hulls, beam or military, energy unit by seed):

| brain | pools left | died | broke | killed |
| --- | --- | --- | --- | --- |
| `jameson-defend-g1` (was shipped) | 89.2% | **30/800** | 13.6% | 4.8% |
| **`jameson-defend-t71a` → g2** | **98.3%** | **0/800** | **58.8%** | **41.6%** |
| `jameson-defend-t71b` | 98.5% | 0/800 | 13.6% | 5.2% |
| `jameson-defend-t71c` | 98.2% | 1/800 | 3.4% | 3.3% |

`t71a` is **8.7x the kills at strictly better survivability** — better on every
column, not a trade. TODO 65's bar was "better kills AT equal survivability" and
this clears it outright, which `t65c` (41.0% kills, 42/800 dead) did not.
`--select-kills` plus the g1 seed is what produces the fighter, exactly as 65
found: `t71b` and `t71c` are better runners than the runner.

### Which half did it — the ablation that matters

Same brains, same seeds, E.C.M. fitted and not:

| brain | ecm | died | pools | broke | killed | launched/ep | landed/ep |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jameson-defend-g1` | yes | 30/800 | 89.2% | 13.6% | 4.8% | 0.71 | 0.64 |
| `jameson-defend-g1` | no | 30/800 | 89.2% | 13.6% | 4.8% | 0.71 | 0.64 |
| `jameson-defend-g2` | yes | **0/800** | 98.3% | 58.8% | 41.6% | 0.80 | **0.00** |
| `jameson-defend-g2` | no | 37/800 | 90.1% | 56.4% | 37.3% | 0.75 | 0.68 |

Three things, and the third is the honest one.

1. **g1 is identical with and without an E.C.M.**, to the episode — proof that
   an 11-head policy cannot press it and therefore that fitting one is not what
   flattered g2.
2. **The E.C.M. is the whole of the survivability gain.** The same g2 without it
   dies 37 times in 800 and takes 0.68 warheads an episode; with it, zero of
   either. TODO 65's held brain died 42 times; this is the same policy family
   with the counter the world was missing.
3. **The health inputs are NOT what unlocked the fighting.** g2-without-E.C.M.
   reads 37.3% kills / 90.1% pools / 37 deaths, which is `t65c`'s profile
   (41.0% / 89.7% / 42) inside the noise. The 14-input family had already found
   that fighter; what 71 bought was not a better fight, it was the ability to
   condition on being hurt — and the search spent it differently from how the
   item expected (below).

### What the policy actually learned, which is not what TODO 71 predicted

240 held-out episodes, sampled at 10 Hz:

| brain | mean speed | range p10/med/p90 | median range whole / hurt | share of the fight spent hurt |
| --- | --- | --- | --- | --- |
| `jameson-defend-g1` | 8 | 129 / 361 / 874 | 374 / 307 | 15.3% |
| `jameson-defend-g2` | 5 | 134 / **401** / **1056** | 402 / 385 | **4.3%** |

The engagement-range spread widened rather than collapsed, which is the
acceptance criterion 71 asked for. **It did not learn to break off when hurt.**
Its median range when hurt is 385 against 402 when whole — it closes very
slightly, the same direction g1 does. What it learned instead is to be hurt
one-quarter as often, by killing the attacker. That is a legitimate answer to
"condition on your own pools" and it is not the answer the item guessed at, and
the item's own acceptance line about "disengages when hurt and re-engages when
recovered" is **not met**.

**Both defence policies are near-stationary knife-fighters** (speed 5 and 8).
That is not new — g1 was already one — but it is the thing to fly before
trusting: the combat computer holds your ship almost still and pivots.

### The other two tools, and one of them had the same defect

`npm run evaluate` (unchanged setup, no E.C.M., two shipped pirates on her tail):

```
| matchup                       | hurt  | kill | acc  | shots | on-six | lost  |
| jameson-defend-g1 (was)       | 18.9% |   0% |  50% |   9.8 |   2.4s |  0.43 |
| jameson-defend-g2 (SHIPPED)   | 18.5% |   2% |  48% |  10.1 |   1.6s |  0.50 |
```

`npm run survivability` **now fits the E.C.M.**, and it had to: the tool models a
commander with a combat computer flying her ship — a fitted commander — and it
was scoring a policy on a third distribution nothing had trained for. Its own
header listed E.C.M. among the things it left out. Fitting one changes nothing
for g1 (it cannot press it), so this does not flatter the new brain.

| gang | brain | g1 destroyed | g2 destroyed | g1 lost/ep | g2 lost/ep |
| --- | --- | --- | --- | --- | --- |
| 1 | solo | 0% | 0% | 0.04 | **0.54** |
| 1 | pack | 0% | 0% | 0.03 | **0.42** |
| 2 | solo | 1% | **0%** | 0.35 | 0.60 |
| 2 | pack | 1% | **0%** | 0.12 | **0.60** |
| 3 | solo | 1% | **1%** | 0.56 | 0.79 |
| 3 | pack | 0% | 0% | 0.19 | **0.67** |
| 4 | solo | **6%** | **1%** | 1.20 | 1.24 |
| 4 | pack | 2% | **0%** | 0.37 | **1.02** |

A gang of four opportunists kills a fitted commander **one sixth** as often, and
she takes three to fourteen times as many of them with her.

### One more divergence closed on the way

`combat-computer.ts` pinned the threat's speed at a constant **280** because
that was the only value any defence policy had been flown against — the comment
said in as many words "load-bearing until the brain is retrained". It has been.
`Episode.observeTrader` has always fed the REAL speed, so the pin was the
divergence rather than the protection, and the combat computer feeds
`threat.state.speed` now. The 300/1.1 envelope stays: no encoder reads a
target's `cls`.

The 300 fed to the PIRATE brains in `npc.ts` is untouched — those brains were
not retrained and it is still load-bearing for them.

## 2026-08-04 — a launch reason the game never had is deleted (TODO 75), and every defence figure above it is re-baselined

No brain was retrained and none needed to be: `matesLost` was never an
observation, only an argument to `NpcShip.chooseWeapon`. But it changed what a
training episode DOES, so `EPISODE_SCHEMA` moves **4 → 5** and every defence
figure in this file measured against a schema-4 world is a measurement of a
different world from the one the trainer now runs.

### What changed

`npcMissileEmergency` had three reasons, and the third — `matesLost > 0`, "the
gang is losing, one of us is already gone" — **could never be true in the live
game**. It counted `!alive` ships in the fleet it was handed, and the fleet was
`world.npcs`; every path that kills an NPC despawns it inside the same statement
(`Combat.destroy` opens with `wreck`, and `wreck` splices the array), so no NPC
has ever run a decision in a frame where a dead mate was still in the list. An
`Episode` never prunes `this.fleet`, so in the trainer it fired exactly as
written. One rule, two orchestrators, opposite answers — invariant 15's second
half.

It was deleted rather than rebuilt, from both worlds, and `matesLost()` went with
it. The alternative — a counter on the world, or a latch on each ship — would
have turned the rule ON for the first time, in the direction of more warheads,
in exactly the fights already going badly for the player. Nobody had decided the
gang should be more dangerous. `src/game/missile-launch.ts` carries the reasoning
beside the two reasons that are left.

### What it did to the numbers

Only a phase whose fleet has more than one ship in it can move, so the three
separate cleanly. 200 episodes each, shipped brains, seeds `e * 131 + 7`, and
these are POLICY pirates in every phase:

| phase | warheads before | after | episodes whose report differs |
| --- | --- | --- | --- |
| attack (1 pirate) | 0 | 0 | **0 of 200** |
| pack (2-4 pirates) | 2 | **0** | 1 of 200 |
| defend (1-4 pirates) | 73 | **44** | 19 of 200 |

Attack is byte-identical because a one-ship fleet never had a mate to lose. The
single pack episode that differs is the one in which the target used to die. At
800 episodes, same construction, defend is 352 warheads before against **225**
after and pack 5 against 2 — the same answer at four times the sample.

**The defend phase's default opponent is the scripted attack run, not a policy**
(`train/evolve.ts`, `--opponent scripted`), so the figure that re-baselines this
file is `npm run defence-probe`, whose pirates are scripted. `jameson-defend-g2`,
the two held-out bases, at both sizes:

| | 240 episodes, before | after | 1200 episodes, before | after |
| --- | --- | --- | --- | --- |
| pools left (terminal) | 98.4% | **98.0%** | 98.4% | **98.0%** |
| died | 0/240 | 0/240 | 0/1200 | 0/1200 |
| broke | 59.7% | 59.6% | 58.8% | 59.0% |
| killed | 43.2% | 43.2% | 40.9% | 41.2% |

Warheads in that same population: 196 of 221 carried before, **171** after (240
episodes); 967 of 1,085 before, **880** after (1,200 episodes) — a 9% drop
against the scripted opponent where the policy opponent gives 36%, because a
scripted pirate makes passes and reaches `passesMade` on its own. The pirate
death count is unchanged (220 deaths in 140 of the 240; 1,000 before and 1,005
after in the same 680 of the 1,200), which is the check that the population is
the same population: she is not killing fewer of them, they are launching fewer
warheads at her.

**The cumulative column — the one the champion is actually chosen on — does not
move.** Pool points taken per episode over the 1,200: 86.1 before, 86.2 after.
Pirate laser damage 96,401 before, 96,164 after. What moves is the TERMINAL
snapshot the table above prints, by 0.39 points, and episodes end 0.25s sooner
on average. Eighty-seven fewer warheads costing her no net pool points says most
of them were being answered — she carries an E.C.M. in every defence fight since
docs/TODO/72 — but the mechanism behind the terminal drop specifically was not
chased down, and this entry does not claim one. The `died` column is 0 either
side at both sizes, so nothing about the promotion of g2 turns on any of it.

### What did NOT move

`npm run campaign` prints identical output either side of the change — 40
commanders × 60 legs, every row to the last decimal, with only the wall-clock
line at the bottom differing (0.6s against 0.7s). That is the empirical half of
the claim that the reason was already dead in the live game: if it had ever
fired in the sky, this is where it would have shown.

`npm run build` (lint, 3,005 tests, sizes and both generator checks), `npm run
elite-a` (480 passed) and `npm run portability` (0 contaminated lines) are green.
The suite goes from 3,006 assertions to 3,005: the one that leaves is
`gunnery.test.ts`'s "a ship whose wingman is already dead spends one", which was
the only test of the deleted reason. The two that remain were each broken to
check they are gates — deleting the hull line fails **23** assertions, deleting
the two-passes line fails **5**.

## 2026-08-04 — the evasion clock ticks on both flights (TODO 77), and the trainer's world does not move

`NpcState.underFire` was decremented in exactly one place — inside
`NpcShip.attack`, the SCRIPTED run. Anything flying a trained policy therefore
latched: `takeDamage` set it to `UNDER_FIRE_SECONDS` (1.2) and nothing ever took
it back down, so one hit made a brain-flown ship permanently "under fire" for the
rest of its life. `missileReload` had the same defect one class down — it ticked
inside `chooseWeapon`, which `NpcShip.update` reaches only when the ship is
hostile and in range.

Both clocks moved to `NpcShip.tickClocks(dt)`, one per-frame call beside the
generator, made by `world-step.ts` and by `Episode.step`. `attack()` no longer
decays anything and `chooseWeapon` no longer takes a `dt`.

### What it did to the trainer's numbers: nothing

`EPISODE_SCHEMA` **stays at 5**, and that is a measurement rather than a hope.
Six configurations — policy solo against a holding and a running target, a
three-ship pack, scripted solo, and scripted and policy threes against an armed
`jameson-defend-g2` — at 40 seeds and again at 200, comparing a SHA-1 of the
whole `EpisodeReport`:

| | 40 seeds/case | 200 seeds/case |
| --- | --- | --- |
| cases whose report digests differ | **0 of 6** | **0 of 6** |
| warheads launched across all cases | 64 = 64 | 318 = 318 |
| pirates still `underFire > 0` at the end | 139 → **71** of 480 | 696 → **366** of 2400 |

Byte-identical because nothing in an episode READS the flag on the path that
changed. A policy pirate never enters `attack()` (docs/TODO/73 — an episode does
not hand over), and a scripted one saw the same within-frame value either way:
the decay simply moved from just inside `attack()` to just before it. No encoder
observes `underFire`, so no brain is invalidated and no weights changed.

### What it did to the readout, which is the point

`describeFlight` returns `evading` while `underFire > 0`, so the trainer's SPENT
ITS TIME column and `train/flight-probe.ts`'s `doing` field were quoting a stale
word for the whole remaining life of any brain-flown ship that had ever been hit.
Held-out flight-probe episodes, share of sampled frames per phrase:

| brain | `evading` before | after |
| --- | --- | --- |
| `pirate-pack-r4-selectonly` | 42.1% | **1.5%** |
| `pirate-attack-g3` | 8.2% | **0.3%** |
| scripted (the control) | 0% | 0% |

200 episodes; at 40 the same figures are 39.1% → 1.3% and 4.3% → 0.2%. The pack
brain was reporting itself as evading for two fifths of every fight while
actually being hit for a fiftieth of it — and the column could only ever hold two
values, `own policy` before the first hit and `evading` after it. It now holds
what the ship is doing.

### What did NOT move

`npm run campaign` prints identical output either side — 40 commanders × 60 legs,
every row to the last decimal, only the wall-clock line differing (0.7s against
0.6s) — because the pirate a player meets is scripted and its evasion clock was
already correct. `npm run elite-a` is byte-identical, and `npm test` was
byte-identical over all 3,005 assertions before the new ones were added, which is
the strongest form of that claim available: not one existing check moved.
`test/ship-clocks.test.ts` is new and takes the suite to 3,024.

The live sky does change in one place the campaign cannot see, and it is the
reason this was worth doing: a ship that is hit and then flies something OTHER
than the scripted run. The armed trader on `jameson-defend-g2` reaches `brainFly`
through the `fleeing` branch and never calls `attack()` at all; measured through
`NpcShip.update`, its `underFire` read 1.200 at 0.6s, 1.2s, 5s and 10s after a
single ram and now reads 0.600, 0.000, 0.000, 0.000. A pirate under the `trained`
A/B flag goes from `evading` at every one of those marks to `own policy` from
1.2s on. A pirate hit at long range and left to amble was latched at 1.200
forever and now cools off on schedule.
