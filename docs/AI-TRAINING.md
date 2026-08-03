# Ship AI: from behaviour trees to self-play RL, and a living galaxy

> **Status update (2026-07-26): Phases 1-2 are DONE and reproducible.**
> The policy MLP and the neuroevolution trainer shipped (`src/ai-training/`,
> `train/evolve.ts`) — but **what is written below is the original design, not
> the as-built spec**, and it differs in every dimension that has a number in
> it. Each section that shipped differently carries an AS BUILT note; the
> authority is always `src/ai-training/policy.ts`, which exports the sizes.
> The fitness figures once quoted here have been removed rather than
> re-measured: they predate several combat-number changes, each of which
> invalidates the brains they were measured on (CLAUDE.md invariant 5). Runs,
> curves and hyperparameters: `docs/TRAINING-LOG.md`. Watch the results at
> `/viewer`.

Chris's questions: can we train ship AI with reinforcement learning, pitting
AIs against AIs in a simulated environment? And can we simulate a whole
universe of ships doing their own thing, flying between systems?

Short answers: **yes, and it's very tractable for this game** — because our
flight model is tiny and deterministic — and **yes**, with a two-level
simulation. Design below.

## Where we started (the scripted tier — since superseded in two roles)

> As shipped, pirates attacking the player fly `pirate-attack-g3`, an
> organised gang flies `pirate-pack-r4-selectonly`, and armed traders (and the
> combat computer) defend with `jameson-defend-g1`. `src/game/brain-names.ts`
> is where that pairing is stated — `SHIPPED_BRAINS` and the `*BrainNameFor`
> rules — and `src/game/brains.ts` turns a name into weights; `npm test` reads
> those files rather than a list. The scripted logic below remains for every
> other behaviour and as the `state.brains.scripted = true` fallback.

`src/game/npc.ts` implements the behaviour matrix by hand:

- **Traders** arrive from deep space, work the station↔planet lane, depart
  through their own jump flash; they flee (and use ECM) when attacked.
- **Pirates** hunt the player in loose packs (per-ship bearing offsets so a
  group attacks from spread directions), and prey on traders when the player
  is out of reach.
- **Police** attack pirates on sight and fugitive players.
- **Lone bounty hunters** ignore clean players and hunt offenders and
  pirates. They draw from the released bounty-hunter slot band — nine hulls,
  led by the Fer-de-Lance (`ship-roles.ts`).
- **Thargoids** are always hostile and deploy Thargon drones that go inert
  when the mothership dies.

This is decent 1984-plus AI. RL is the path to dogfights that feel *alive* —
lead pursuit, energy management, break turns, pack flanking that emerges
rather than being scripted.

## Why RL fits here unusually well

The whole flight model is ~10 numbers per ship (position, quaternion, speed,
turn-rate caps) with closed-form updates and probabilistic gunnery. A headless
simulation with no rendering can run **millions of ship-seconds per minute**
in a Node worker. Small inputs, small action space, cheap rollouts: this is
the regime where simple methods beat fancy ones.

## Proposed architecture

### 1. Extract the sim core

*(Done, then undone, and the second half is the lesson.)* This was built as
`src/ai-training/core.ts`: the kinematics and combat resolution rewritten as a
pure module with its own vector maths and no three.js. It bought fast episodes
and cost three years' worth of drift in one file — the goal above, "a trained
policy behaves identically in training and in the shipped game", is exactly
what a copy cannot deliver, however carefully it is mirrored.

The kinematics came out of `npc.ts`/`game.ts` in the end anyway, but *into the
game*: `world-step.ts`, `collisions.ts`, `systems.ts`, `gunnery.ts` and a
`PlayerShip` that flies a `FlightDemand` all run headless under node. So
`core.ts` is deleted and `scenario.ts` builds episodes from the engine
directly. Same benefit, no copy.

### 2. Observation & action spaces (per ship)

Observation (~30 floats, all in the ship's own frame so policies generalise):
- Own state: speed/maxSpeed, energy, shields, laser temp, missiles left
- For the K=3 nearest ships: relative position (unit dir + log distance),
  relative velocity, their nose direction vs us, hull class one-hot,
  hostile/neutral flag
- Nearest missile: direction + distance + closing speed
- Objective context: direction to protectee (trader being escorted), pack
  centroid offset (pirates), home/escape vector

Actions (discrete, matches the keyboard model — 3×3×3×2 = 54 combos):
- pitch {-1, 0, +1} · roll {-1, 0, +1} · throttle {down, hold, up} ·
  trigger {fire, don't}

> **AS BUILT — smaller, and the encoders are the authority.** The observation
> is one target, not K=3: `observe()` writes `OBS_SIZE = 14` floats, and each
> slot is named in its own docstring in `policy.ts`. Two wider encoders extend
> it for pack play — `observePack` adds the nearest living packmate's
> direction and log distance (`PACK_OBS_SIZE = 18`), and `observePackWide`
> adds enough about that mate to fly a complementary line rather than merely
> avoid it (`PACK_WIDE_OBS_SIZE = 26`). Nothing observes shields, missiles or a
> hull-class one-hot; there is no missile channel and no protectee channel.
> `observeFor()` picks the widest encoder a given brain has inputs for, which
> is why that choice has one home.
>
> The action SPACE is as designed — 3×3×3×2 = 54 reachable combinations — but
> it is not 54 outputs. `act()` emits `OUT_SIZE = 11` logits as four
> independent heads (pitch 3, roll 3, throttle 3, fire 2) and takes an argmax
> per head, so the policy is deterministic and the head count grows additively
> rather than multiplicatively.

### 3. Policy representation

A tiny MLP: 30 → 64 → 64 → action logits (~7k params). At runtime that is a
few thousand multiply-adds per ship per AI tick (10 Hz is plenty — humans
don't re-decide at 60 Hz either) — effectively free for 20 ships. Weights ship
as a Float32Array in a JSON file; inference is 30 lines of TypeScript, no
runtime dependency.

> **AS BUILT — a quarter of the size.** `HIDDEN = 32`, so the solo network is
> 14 → 32 → 32 → 11, and `genomeSize()` in `policy.ts` is the one place the
> parameter count is worked out: it is under 2k for a solo brain and a little
> over 2k for the two pack widths. Do not restate the number here — call
> `genomeSize(obsSize)` if you need it. Everything else in this section held:
> two `tanh` layers, weights as a `Float32Array` in a JSON file, inference in
> `act()` with no runtime dependency, and the 10 Hz tick (`brainFly` in
> `npc.ts` re-decides every 0.1 s and ramps between decisions).

### 4. Training method — two phases

**Phase A: neuroevolution self-play (recommended start).**
Population of ~64 policies; evaluate each over a few hundred randomised
duels/skirmishes; select + mutate (CMA-ES or simple truncation+noise).
No backprop, no Python, runs overnight in Node worker threads. Neuroevolution
is famously competitive on sub-100k-param policies, and the asynchronous
tournament *is* the AI-vs-AI arena you described.

**Phase B (if we want sharper play): PPO self-play in Python.**
Port the sim (it's ~300 lines of math), train with PPO + league play
(current policy vs a pool of past checkpoints, mixed roles), export to ONNX
or raw weights. Only worth it if Phase A plateaus below what we want.

### 5. Role-specific rewards

| Role | Reward |
| --- | --- |
| Pirate (pack) | shared: damage dealt to target + kill bonus + cargo canisters spilled − damage taken − friendly fire; small penalty per second (encourages decisive attacks) |
| Trader | +survival per second, +big bonus for reaching jump-out point alive, − damage taken (learns evasion, jinking, running for mass-lock-free space) |
| Bounty hunter | +kill on marked target only, − shots at neutrals, efficiency bonus (time/energy) |
| Police | +pirate kills, +traders surviving in their patrol radius, − response time |
| Thargon swarm | shared: damage to player-proxy, staying alive while mothership lives |

Curriculum: static targets → drifting targets → scripted current AI →
self-play league. The scripted AI stays forever as the "grader": a candidate
policy must beat it convincingly before shipping.

### 6. Integration

`NpcShip` gains a `brain: 'scripted' | PolicyBrain` field. PolicyBrain maps
observation → action → the same steering primitives (`steerToward` becomes
raw pitch/roll rates). A settings toggle lets us A/B scripted vs trained
ships in-game. Start by training the **pirate pack** (most gameplay value),
then trader evasion, then hunters.

> **AS BUILT — no such field, and that is the point.** A ship does not carry a
> brain. `NpcShip.update` asks `pirateBrainFor(tier, organised, brains)` or
> `defenceBrain(brains)` each frame it needs one, where `brains` is the
> `BrainSelection` handed in with the world view and ultimately `state.brains`.
> The rule for which name flies for whom is `game/brain-names.ts` and the
> weights behind a name are `game/brains.ts`; the ship holds only the cached
> decision and the ramped rates (`brainControl`, `brainTimer`,
> `brainPitchRate`, `brainRollRate`), all of which are snapshotted. The A/B
> toggle is `state.brains` — game state, not a settings global (invariant 12) —
> reachable from the LIVE BRAINS row on the combat trainer's setup panel.
> `brainFly()` is the single implementation of "how a brain-flown ship moves",
> and a training episode flies a candidate genome through that same method.

## The living galaxy (ships doing their own thing, between systems)

Two simulation levels, so cost stays bounded:

**Level 1 — abstract galaxy layer.** Each system gets a lightweight economy
state: traffic rate λ derived from productivity/government (we already
compute these), a pirate-risk score, and commodity price drift from recent
(simulated) trade volume. Ships between systems are just records:
`{shipClass, cargo, from, to, etaTimestamp}`. A few hundred of these cost
nothing; they advance whenever the player does anything (or on a timer).
This is how the universe "keeps happening" while you're docked.

**Level 2 — instantiation at the boundary.** When the player is in a system,
Level-1 arrivals due there materialise as real NPCs: the witch-flash arrival
we already have, flying their actual cargo to the station. When a trader
jumps out, it returns to Level 1 with a real destination and ETA. Destroy a
trader and its cargo genuinely never arrives — with a tiny price effect at
the destination market. Pirates congregate (Level 1) in systems with high
traffic × low government, which is exactly where you'll meet them (Level 2).

The classic seeded galaxy stays the *baseline*; the living layer stores only
*deltas* (recent price nudges, traffic events), so saves stay small and the
1984 determinism survives underneath.

### Suggested build order

1. Extract sim core (also unlocks headless testing of all combat)
2. Level-1 traffic records + arrivals/departures wired to the existing
   trader lifecycle (visible payoff immediately)
3. Neuroevolution trainer (Node worker, pirate pack first)
4. Ship trained pirate/trader brains behind a toggle
5. Market deltas from simulated trade; pirate-risk migration
