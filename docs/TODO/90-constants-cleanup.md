# 90 — the cleanup list

Stragglers from the constants move. Everything here is a loose end the slices
deliberately did not tie, recorded as it was found so none of it is discovered
again from scratch.

Three kinds, and they want different treatment:

- **Blocked** — will be resolved by a later slice. No decision needed, just
  order.
- **Decided** — a stated exception. Not pending work; do not "fix" it.
- **Open** — needs a decision or a separate behaviour change.

---

## Blocked — a later slice unblocks these

| what | where | unblocked by |
| --- | --- | --- |
| `RAM_MIN_SPEED` = `PLAYER_FLIGHT.maxSpeed * 0.7` | `game/tactic-choice.ts:66` | the flight slice, which brings `PLAYER_FLIGHT` forward |
| `CC_MAX_PITCH` = `0.5 * TURN.pitch` | `game/combat-computer.ts:40` | the flight slice, which brings `TURN` forward |
| `CC_MAX_ROLL` = `0.5 * TURN.roll` | `game/combat-computer.ts:41` | as above |

All three are correctly-derived constants that an import-nothing leaf cannot
reach. **This will keep happening**: the constants that most want to be
expressions are exactly the ones that pull another module's table into the leaf.
When a slice leaves one behind, add it here rather than weakening the leaf rule.

The other half of the `4.1396` pair — `player.ts`'s `RATE_RAMP` and
`RATE_DECAY` — also lands in the flight slice, and needs the mirror of the
warning `constants/brain-flight.ts` already carries.

---

## Decided — stated exceptions, leave them alone

**`MISSILE_HULL` stays in `game/ordnance.ts`.** It is a memoised
`requireShipDef` lookup, not a rule, and moving it would put a function call
inside the leaf. It sits in the gate's per-name allowlist under a heading saying
it is a decision rather than pending work.

**`NPC_HIT_FALLOFF` stays a literal in `constants/npc-gun.ts`.** It looks like
the laser's reach and the history says otherwise: `git log -S` puts the
expression in the initial commit, when the NPC's own firing gate was 2,600 while
the player's `LASER_RANGE` was 3,500. Two readings survive and they want
different expressions — `NPC_LASER_RANGE`, or `NPC_LASER_RANGE / 0.75` which is
4,667 and a balance change. The argument is written beside the constant.
**Resolving it is a decision for Chris, not a refactor.**

**`SIGHT_Y`'s CSS twin stays duplicated.** docs/TODO/93 owns the phosphor and
the stylesheets; CSS was ruled out of 90's scope.

---

## Open — a decision or a separate change

### Three derivations whose arithmetic no longer produces the shipped value

Each looks like an obvious tidy-up. Each is a behaviour change. They are on the
survey's land-separately list and they stayed literals through slice 2, with the
discrepancy recorded in the comment beside them.

| constant | shipped | its own stated arithmetic |
| --- | --- | --- |
| `tactics.slash.missDistance` | 175 | "1.6× the standard pass" = `110 × 1.6` = **176** |
| `CLEAR_RANGE` | 340 | `BREAK_OFF_RANGE` "and half again" = `220 × 1.5` = **330** |
| `CC_ACCEL` | 100 | the trader Cobra's `220 × ACCEL_FRACTION` = **101.2** |

For each: is the value right and the prose wrong, or the other way round? A
one-unit move on the first, ten on the second, 1.2 on the third — small, but
each is a real change to how a ship flies.

### `MAX_TRADERS` still has two homes

`game/encounters.ts:43` and `game/population.ts:41`, both `= 4`. This is the
fuse the whole item was named after and it is still lit. The survey settled the
answer: **population owns it** — it is a property of what a system holds, not of
the clock that adds to it. Waiting on the spawning-and-population slice.

The gate would now catch a *third* home mechanically, but not these two: they
are both on the allowlist as pending work.

### CLAUDE.md does not yet carry the instruction

The read-it-do-not-grep-it wording is written out in
`docs/TODO/90-one-home-for-every-constant.md` and has not been added to
CLAUDE.md, because pointing at `src/constants/` before it is finished would send
an agent to a half-built home. **Add it when the last slice lands**, not before.

The gate catches a second home mechanically, which is stronger than the
instruction. The instruction is what stops one being written in the first place.

### The scan cannot see four things

Recorded so nobody assumes the gate is total:

- **Function-local constants.** The scan is column-zero only, by the item's own
  rule that a value whose meaning is local to one function is not in scope.
- **Magic numbers written inline.** The survey found hundreds — `threat.ts`
  alone has ~18 unnamed tuning values that `npm run campaign` is tuned against.
  A named constant in the wrong place is caught; an unnamed one anywhere is not.
- **`train/` and `tools/`.** Excluded deliberately: the trainer's search
  hyperparameters and seed bases are its own, and `tools/` is a separate world.
  But `train/` also mirrors game constants, and those mirrors are exactly what
  invariant 15 keeps being broken by — see the survey's training section.
- **Non-TypeScript homes.** CSS and the four `.html` files. 93 owns the first;
  nothing owns the second.

### `player-interest.ts` and `tactics.ts` were deleted

Both were a table or a single constant plus reasoning, with nothing left once
the values moved. Six comments in `npc.ts` naming them by filename were
repointed. If a future reader finds another dangling reference, it belongs here.
