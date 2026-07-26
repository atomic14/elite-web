# AI Training Log

Every training run, its setup, and what came out. Reproduce any run with the
command shown (results vary slightly — mutation noise uses the wall-clock-free
seeded RNG, but per-generation seeds are deterministic given the CLI args).

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

- `src/sim/brains/pirate-attack.json` — weights + meta (fitness, date,
  hyperparams)
- `src/sim/brains/trader-evade.json` — same for the evader
- `train/logs/*.jsonl` — per-generation best/mean/worst fitness curves

## Watching the results

`npm run dev` → http://localhost:5173/viewer.html — scenarios:
trained pirate vs trader · scripted pirate (old AI) · random policy
(untrained baseline) · trained vs trained · pack of 3 vs armed trader.
Orbit/chase cameras, pause, 0.25×/1×/4× speed, auto-restart with a new seed.

## Next runs (planned)

- **Pack phase**: 3 shared-policy pirates vs armed trader, shared reward —
  looking for emergent spreading/flanking (packOffset inputs already exist
  in-game; add pack-relative observations to the sim).
- **League play**: alternate attack/evade phases against frozen checkpoints
  to keep the arms race going without forgetting.
- **In-game integration**: `NpcShip.brain` toggle so trained pirates fly in
  the real game (10 Hz decision rate, keyboard-model controls are already
  identical).

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
