# 91 — Delete the target-speed input, and retrain

**Kind:** training fidelity / AI · **Severity:** high · **Size:** large
**Depends on:** none · found by the docs/TODO/90 survey · **Chris decided this
on 2026-08-04**, choosing deletion over closing the divergence

## Why

The game floors the target speed a pirate brain is fed. `brains.ts:135`:

```ts
const TARGET_SPEED_FLOOR = 150;
…
targetSpeed: (a) => Math.max(TARGET_SPEED_FLOOR, a),   // brains.ts:236
```

consumed at `npc.ts:674` as `choice.targetSpeed(player.speed)`.

**The trainer does not.** `scenario.ts:954` passes `this.trader.speed` raw, and
`TARGET_SPEED_FLOOR` is imported by nothing in `train/` or `src/ai-training/`.

It lands on `observation.ts:179`:

```ts
out[10] = target.speed / 400;
```

which `brains.ts`'s own comment identifies as the input *"the policy has latched
onto"*. Against `playerCobraSlow` (ceiling 90) or the `holding` pilot (which
brakes toward 60), a training pirate reads slot 10 anywhere from **0.00 to
0.225**. The same brain against the same commander in the live game reads **at
least 0.375**. Two of the four target speeds `evolve.ts`'s `flies()` gate
samples — 0 and 90 — are unreachable in the game.

This is docs/TODO/71's shape inverted. There, a fact the trainer could not see;
here, a correction the game applies and the trainer does not.
`combat-computer.ts:118-127` records the identical trap on the defence side and
calls the surviving constant *"the divergence rather than the protection"*.
Nobody had written that sentence about this one.

## The decision

Two honest answers were on the table and Chris took the second.

**Not** "make the trainer apply the floor". That closes the divergence and keeps
the game flying as it does today, but it leaves in place a constant whose only
job is to hide the fact that the brain is out of distribution at low speed.

**Delete the input**, which is what `brains.ts` already proposes in as many
words:

> deleting the input entirely is the honest fix and costs a retrain of every
> brain

The floor is a symptom of the encoder, not a rule about the game. A policy that
needs its input clamped to stay in distribution is a policy fitted on a slot it
cannot use honestly. Removing the slot removes the thing that can diverge.

`TARGET_SPEED_FLOOR` and `BrainChoice.targetSpeed` go with it.

## What this costs, stated plainly

**A full retrain of every shipped policy.** `pirate-attack-g3`,
`pirate-pack-r4-selectonly` and `jameson-defend-g2` are all fitted against an
encoder that has this slot. Every figure in docs/TRAINING-LOG.md for all three
predates the change. This is not a refactor with a retrain attached; it is a
retrain with a refactor attached.

CLAUDE.md: *"Changing a combat number invalidates the brains; retrain
deliberately."* And the two hazards it names apply directly — a run with no
output name overwrites a shipped brain, and without validation-based selection
the champion is the luckiest generation rather than the best genome.

## The size cascade, and the trap in it

Removing one slot from the solo encoder shifts all four sizes:

| constant | now | after |
| --- | --- | --- |
| `OBS_SIZE` | 14 | 13 |
| `DEFEND_OBS_SIZE` | 17 | 16 |
| `PACK_OBS_SIZE` | 18 | 17 |
| `PACK_WIDE_OBS_SIZE` | 26 | 25 |

**`observeFor` dispatches on `brain.obsSize`** (`observation.ts:376-378`), and
`policy.ts:45` says so explicitly: *"17 not 18 because the input count is what
picks the encoder"*.

So the new `PACK_OBS_SIZE` (17) **collides with the old `DEFEND_OBS_SIZE`**
(17). Trace a stale `jameson-defend-g2.json` through the new dispatcher:

```
brain.obsSize === DEFEND_OBS_SIZE   → 17 === 16   false
!mates || obsSize < PACK_OBS_SIZE   → 17 < 17     false
obsSize >= PACK_WIDE_OBS_SIZE       → 17 >= 25    false
                                    → observePack
```

**An old defence brain is silently encoded as a pack brain.** It does not throw,
it does not warn, and `brainFromFile` loads it happily. Every brain is being
retrained so this only bites a file kept from before — but "kept from before" is
exactly what `src/ai-training/brains/` is, and what a bisect does.

Deal with it deliberately: bump a version in the brain-file meta and refuse a
mismatch, or pick sizes that cannot collide with the old set, or delete the old
weights in the same commit. Do not leave the collision reachable.

## What is NOT the problem

- **Not `TARGET_SPEED_FLOOR`'s value.** 150 is a sensible clamp. The objection
  is that a clamp is needed at all, on one side only.
- **Not the trainer being wrong.** Passing the real speed is the honest thing
  for a trainer to do. The game is the side applying a correction.
- **Not `observeDefend`'s or `observePack`'s own slots.** Only the shared solo
  block is losing an entry; the extra slots keep their meanings and shift index.

## Watch out for

- **The three encoders share the first `OBS_SIZE` slots** and
  `observation.ts:357` says a pack-sized brain on the solo encoder reads only
  the first block. Every index after slot 10 shifts by one in all three. Get the
  renumbering right and assert it, or a brain will read pitch rate where it
  expects closing speed.
- **`evolve.ts`'s `flies()` gate samples target speeds** `[0, 90, 220, 400]`
  (`evolve.ts:527`). With the input gone, that dimension of the sweep is
  meaningless and the gate needs rethinking, not just editing.
- **`EPISODE_SCHEMA` is 5** and this changes what a brain can perceive, not what
  the world does. Argue whether that is a schema bump; it may not be, and the
  brain-file version above may be the right place instead.
- **Retrain with validation-based selection**, at the budget the log records for
  the previous runs, and compare on held-out seeds — not on the training
  fitness. docs/TODO/65 exists because this went wrong before.
- **Do not retrain and refactor in one commit.** Land the encoder change with
  the old brains still flying (they will be out of distribution and that is
  expected and temporary), then the retrain, then the promotion — each provable
  on its own.

## Acceptance

- `observation.ts` has no target-speed slot; `TARGET_SPEED_FLOOR` and
  `BrainChoice.targetSpeed` are gone from `brains.ts` and `npc.ts`.
- Nothing in the trainer or the game applies a speed correction the other does
  not — grep proves it.
- The old/new `obsSize` collision is unreachable, by whichever mechanism is
  chosen, with a test that fails if a stale-sized brain file is loaded.
- All three policies retrained with validation-based selection, promoted only if
  they beat the incumbent on held-out seeds, and docs/TRAINING-LOG.md says every
  figure before this is incomparable.
- `npm run build`, `npm run campaign`, `npm run elite-a`, `npm run portability`.
- **Flown.** `T` at any station, against a retrained pirate. CLAUDE.md: prefer a
  fight a human flew to a bot-flown number.

## Verify

```sh
grep -rn "TARGET_SPEED_FLOOR" src train    # game only; trainer never sees it
grep -n "out\[10\]" src/ai-training/observation.ts
# observation.ts:179  out[10] = target.speed / 400;
```

The divergence itself: in an episode against `playerCobraSlow`, log
`target.speed` at the `brainFly` call in `scenario.ts:954` and compare with
`choice.targetSpeed(player.speed)` at `npc.ts:674` for the same speed. Below
150 they differ; above it they agree.
