# 73 — A training pirate never hands over, so it never earns a missile

**Kind:** training fidelity · **Severity:** medium · **Size:** medium
**Depends on:** none · found while doing 62 · same family as 62, 63 and 64

## Why

Found while doing docs/TODO/62, which made a training pirate able to launch the
missiles it has always carried. Three reasons let a ship spend one
(`npcMissileEmergency`): its hull is under 0.4, one of its gang is already dead,
or **it has flown at the target twice and the target is still there**. That third
one is Chris's own, quoted in `missile-launch.ts`: *"missiles are expensive, they
should be used in emergencies — e.g. when your opponent turns out to be tougher
than you thought."*

**A brain-flown pirate in a training episode makes zero passes. Ever.** Measured
over 60 fights, three shipped `pirate-attack-g3` against a `jameson-defend-g1`
target with a military laser:

| attackers | passes per pirate | missiles launched (of 61 carried) |
| --- | --- | --- |
| `pirate-attack-g3` (brain) | **0.00** | 13 |
| scripted attack run | **3.88** | 35 |

Against a target that merely runs, the brain-flown row launches **nothing at
all**: 0 warheads from 61 rounds over 60 fights, because none of the three
reasons can be reached.

## What is actually failing

`passesMade` is incremented in exactly one place — `NpcShip.attack()`, when the
attack phase reaches `extending`, which needs the ship to have been inside
`BREAK_OFF_RANGE` (220) and come out again. And `attack()` is the SCRIPTED flight.

In the game, a brain-flown pirate reaches it anyway, because `NpcShip.update()`
hands over:

```ts
const shot = choice && distPlayer >= choice.guard
  ? this.brainFly(...)          // outside 150 units
  : this.attack(...);           // inside BRAIN_HANDOVER_RANGE — the scripted break-off
```

**A training episode has no handover.** `scenario.ts` picks the flight once, from
the controller kind, and a `policy` pirate calls `brainFly` at every range down
to zero. So the ship never enters the phase machine, never completes a pass,
never accrues `passesMade`, and `state.attackPhase` stays on whatever it was
initialised to.

This is a fourth row for docs/TODO/64's table, and the first one that is not
about resolving a shot:

| | the game | the trainer |
| --- | --- | --- |
| flight inside `BRAIN_HANDOVER_RANGE` | the scripted break-off | the policy, all the way in |
| `passesMade` accrues | yes | **no** |
| the missile-commit reason is reachable | yes | **no** |

## What is NOT the problem

- **Not `BRAIN_HANDOVER_RANGE` itself.** 150 is deliberate and break-off.ts
  argues it: a policy fitted at long range flies a pursuit curve, and a pursuit
  curve at knife range is a collision. The number is not in question.
- **Not `flownBy`.** That field already reports honestly which flight ran, and it
  is what makes this visible at all.
- **Not fatal to 62.** Missiles do launch in training — 272 over 480 defence
  fights — through the other two reasons. What is missing is the one that
  rewards *engaging*, which is the one CLAUDE.md's "threat is not fun" cares
  about: a missile a ship EARNS by making passes, rather than one it fires
  because it is dying.

## What to work out

- **Whether the episode should hand over too.** The obvious fix is one line in
  `scenario.ts` — call `attack()` inside the guard, exactly as `update()` does —
  and the obvious objection is that it changes what the trainer is optimising:
  the genome would stop being scored on the last 150 units of every pass.
  Measure it before assuming either.
- **Whether the handover belongs in `NpcShip` rather than in its two callers.**
  This is the same shape as 62's finding about `chooseWeapon`: the game's
  `update()` is the only place that composes "pick a flight, then pick a weapon",
  and everything the episode omits is something `update()` does. A method that
  takes a brain and a target and does the whole composition would leave the
  episode with one call and nothing to forget. That is 64's question with a
  smaller blast radius.
- **What it does to the shipped brains' measured behaviour.** `flight-probe.ts`
  reports passes per episode and reads 0 for every policy today. If that column
  starts moving, every figure in it changes meaning.

## Watch out for

- **This invalidates the brains if it lands** — invariant 5. A pirate that flies
  a different program inside 150 units is a different opponent, and it changes
  the episodes every attack and pack genome is scored in.
- **Seeded reproducibility.** `attack()` draws from the stream (`rollExtendRange`,
  `passSide`, its own trigger) where `brainFly` draws only for the trigger, so
  every archived episode outcome shifts.
- **Do not "fix" it by giving a brain-flown ship passes it did not fly.**
  Incrementing `passesMade` from anywhere but the phase machine is one rule with
  two homes, and the field's own comment says what it means.

## Acceptance

- A stated decision about whether a training episode hands over at
  `BRAIN_HANDOVER_RANGE`, with the passes-per-pirate table above re-measured
  either way.
- If it does hand over: `flight-probe.ts`'s passes column is non-zero for a
  shipped policy, and docs/TRAINING-LOG.md says every figure before it is
  incomparable.
- `npm test`, `npm run elite-a` and `npm run portability` unmoved.

## Verify

The table at the top is the measurement. Run three shipped pirates against a
defence policy for 60 seeded episodes, sum `npc.state.passesMade` and
`missilesFired` across them, and do it again with `{ kind: 'scripted' }`
attackers. The brain row reading 0.00 passes against the scripted row's 3.88 is
the whole finding.
