# 03 — Two modules choose the observation encoder, differently

**Kind:** information leakage / one rule, two homes · **Severity:** medium ·
**Size:** small

## What is wrong

"Which observation encoder does this brain want" is decided in two places, and
the two decisions do not agree. `policy.ts` owns the encoders and the sizes but
exposes no function that chooses between them, so both callers reconstruct the
mapping from `brain.obsSize` themselves — one three-way, one two-way.

The consequence is direct: a genome the trainer can produce is not, by
construction, a genome the game can fly. Adding a fourth encoder means finding
both sites and hoping.

## Evidence (read at `de9a668`)

- `src/game/npc.ts:731-742`, in `brainFly` — a three-way choice:
  ```ts
  !fleet || brain.obsSize < PACK_OBS_SIZE
    ? observe(...)
    : brain.obsSize >= PACK_WIDE_OBS_SIZE
      ? observePackWide(...)
      : observePack(...)
  ```
- `src/ai-training/scenario.ts:444` — a coarser two-way version of the same call:
  `ctrl.brain.obsSize >= PACK_OBS_SIZE ? this.fleet : null`.
- `src/ai-training/policy.ts` owns the sizes and encoders —
  `genomeSize(obsSize, hidden)` at `:81`, `obsSize` on the `Brain` type at `:87`,
  the load default at `:108`, the forward pass reading `brain.obsSize` at `:252`,
  `randomBrain(rng, obsSize = OBS_SIZE, ...)` at `:295` — and no chooser.

## The fix

Move the choice into `policy.ts` as one function, e.g.

```ts
export function observeFor(
  brain: Brain, me: ObservableShip, target: ObservableShip,
  mates: readonly ObservableShip[] | null, out: Float32Array,
): void
```

which switches on `brain.obsSize` in the single place that knows what the sizes
mean, and have both `npc.ts:731` and `scenario.ts:444` call it. Then adding an
encoder is one file.

Note the two call sites pass different things for `mates` (`fleet` vs
`this.fleet`, one of which may be `null`) — settle in the new function what
`null` means, rather than leaving each caller to decide.

## Verify

- `npm run lint && npm test`
- Equivalence on a seeded episode: same seed, identical outcome. The three-way
  branch in `npc.ts` is the authority — if the unified chooser changes what a
  shipped brain flies, it is wrong, and `pirate-attack-g3`,
  `jameson-defend-g1` and `pirate-pack-r4-selectonly` are the ones to check.
- `npm run evaluate` if you want the tournament's opinion, but the seeded
  equivalence check is the real gate.

## Notes

Do this before file 04 — they touch adjacent code and 04's `writeView` is the
natural companion to `observeFor`. Doing them in one session is also reasonable
if it stays under one commit's worth of change.
