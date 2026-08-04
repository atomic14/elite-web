# 88 — The flight readout still quotes two stale words

**Kind:** UI/UX · **Severity:** low · **Size:** small
**Depends on:** none · found while doing 77, and the same defect as 77

## Why

`describeFlight` (`break-off.ts`) exists to say what a ship is DOING, and
`flownBy` was added to it because the first cut said `closing 45s` for a g3
pirate that never ran the closing logic. Its own comment names the failure:
reporting a field the ship's flight path never touches is "quoting a stale
word".

77 found a third field with that defect — `underFire`, latched rather than
decayed — and fixed it. Two more are left, and both are in the same function.

```ts
if (fleeing) return 'fleeing';
if (flownBy === 'brain') return underFire > 0 ? 'evading' : 'own policy';
if (underFire > 0) return `${tactic} evading`;
return `${tactic} ${phase}`;
```

**`fleeing` outranks everything, and an armed trader fights from inside it.**
`takeDamage` sets `state.fleeing = true` for ANY trader that is hit
(`npc.ts:1493-1496`). `update()`'s `fleeing` branch then reads, in its own
comment, "armed traders turn and fight with the trained Jameson defence brain"
— and calls `brainFly` with the defence policy (`npc.ts:695-709`). So the ship
that is flying a trained policy at its attacker, the one docs/TODO/86 is about,
is reported as `fleeing` for the whole engagement. The word is the BRANCH it
took, not what it is doing.

This also means 77's item text was wrong about the trader: it claimed the trader
"read `evading` forever". It never did — `fleeing` returns first. The latched
flag was reaching `nextAttackPhase` and `tacticSwitchReason`, which was the real
damage; the readout was already wrong for a different reason, and still is.

**A ship that flies no attack run still reports a phase.** `attackPhase`
initialises to `'closing'` (`npc.ts:533`) and `flownBy` to `'scripted'`, so a
ship that has never executed the phase machine — a pirate outside interest
range, a trader ambling between planet and station — falls through to
`` `${tactic} ${phase}` `` and reads `slash closing`. `flownBy` does not cover
this case because such a ship is nominally scripted; it simply is not flying.

## What is NOT the problem

- **Not `flownBy`.** It is correct and doing its job. These are the two cases it
  was never asked about.
- **Not `state.fleeing` itself.** A trader that has been shot at IS in the
  fleeing state, and the flag drives real behaviour. What is wrong is the
  readout treating "took the fleeing branch" as "is running away".
- **Not urgent.** Nothing decides anything on this string. It is the trainer's
  SPENT ITS TIME column, the cockpit strip and `flight-probe.ts`'s `doing`
  field — three places a human reads to understand a fight, which is precisely
  why 77 mattered.

## What to work out

- **The armed trader needs a word that is true.** It is fighting, with a trained
  policy, and `own policy` is the honest answer the function already has: reorder
  so the brain check comes before the fleeing check, or gate the fleeing branch
  on whether a defence brain actually took the wheel. The second is more
  faithful — an UNARMED trader in the same branch really is running.
- **A ship flying nothing needs a word too**, and the honest one is not a phase.
  Whatever is chosen, the point is that `attackPhase`'s initial value must stop
  being reported as though the machine had produced it.
- **Consider whether `attackPhase` should have a null-ish initial state** rather
  than `'closing'`, so "has not run" is representable. That is the root of the
  second half and it touches the snapshot, so weigh it against just fixing the
  readout.

## Watch out for

- **`describeFlight`'s output is a fixture in tests.** Changing a word changes
  strings that are asserted; check which and re-baseline deliberately.
- **Do not reach for a new state field.** Both facts are derivable from what the
  ship already carries, and a fourth field with the same failure mode is how this
  item came to have two halves.

## Acceptance

- An armed trader flying the defence brain does not report `fleeing`, asserted
  through the real `update()`.
- A ship that has never run the phase machine does not report a phase.
- Both assertions fail if the corresponding branch is reverted.

## Verify

Both halves were confirmed by reading, 2026-08-04: `takeDamage` sets `fleeing`
for every damaged trader, `update()`'s fleeing branch calls `brainFly` with
`defenceBrain(brains)` when the trader is armed, and `describeFlight` returns
`'fleeing'` before it tests `flownBy`. `attackPhase` is initialised to
`'closing'` in the same constructor line that sets `flownBy: 'scripted'`.
