# 47 — The trainer credits you zero damage for every non-laser kill

**Kind:** combat trainer / reporting · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

`CombatSimRecorder.dealt()` (`src/game/combat-sim-report.ts:796`) is the only
way anything reaches `you.damageDealt`, `you.damageBySource` or
`OpponentReport.damageFromYou`. It has exactly ONE caller in the repo —
`playerShot()` at `:789`, the laser path. Its own docstring says "a missile or
a collision comes straight in". Nothing ever does.

`docs/COMBAT-SIM.md:210` promises "damage both ways, **by source** (laser /
missile / ram / collision)".

The three player-dealt non-laser paths all bypass it and route straight to a
kill:

- missile — `src/game/world-step.ts:433` → `host.destroyNpc` →
  `src/game/combat-sim.ts:413` → `opponentDown()`
- ram — `src/game/world-step.ts:345`, same route
- energy bomb — `src/game/game.ts:449`, same route

Demonstrated: kill a Sidewinder with a real missile and the record reads

```text
kills credited to you: 1
you.damageDealt      : 0
you.damageBySource   : {}
opponent line        : {"destroyed":true,"killedByYou":true,"damageFromYou":0}
```

The `them` direction is complete — all five `applyPlayerDamage` sites carry a
`DamageSource` — so the report is silently asymmetric. CLAUDE.md says to feed
these records back when judging a training run, and the exercise fit-out
deliberately offers missiles and the energy bomb.

## Implementation

- The three sites already know the amount and the source. They need to reach
  `recorder.dealt()`.
- The likely shape is `WorldStep` reporting player-dealt damage the way it
  already reports `npcFired` — an event the host resolves — rather than the
  recorder being called from three places. Invariant 15: a module decides and
  reports; the orchestrator applies.
- Do not add a second accumulation. TODO 33 made `report()` derive its
  counters from one place; keep that property.

## Acceptance

- A missile, a ram and an energy-bomb kill each credit their damage, under
  their own source, to `you.damageBySource` and to that opponent's
  `damageFromYou`.
- The by-source totals sum to `damageDealt`.
- A test flies an exercise for each of the three and asserts the figures.
- `npm run campaign` and the ai gates are unmoved — this is reporting, not
  damage.

## Verify

`npm run check`, then an exercise flown with missiles and one with the bomb,
reading the report.
