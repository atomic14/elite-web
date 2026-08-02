# 48 — The energy dead band, and dying at full shields

**Kind:** combat correctness · **Severity:** high · **Size:** small
**Depends on:** none

## Why

Two related defects around `LOW_ENERGY`.

### 1. Three comparisons where the commit message claimed one

TODO 38 (`18bbe82`) said: *"the last bank turns red at exactly the point the
warning fires and shields stop recharging: one comparison, one constant, three
consequences."* That is not what shipped. There are three different tests:

- shields recharge — `src/game/systems.ts:269` `if (sys.energy > LOW_ENERGY)`
- ENERGY LOW warning — `src/game/world-step.ts:501` `if (sys.energy < LOW_ENERGY)`
- gauge goes red — `src/hud/hud.ts:274` `frame.energyFrac < frame.energyLowFrac`

At `energy === 64` (exactly `LOW_ENERGY`) shields are **frozen** while the
console shows nothing wrong:

```text
energy 63: shields FROZEN     | warning=true  | red=true
energy 64: shields FROZEN     | warning=false | red=false   <- dead band
energy 65: shields RECHARGING | warning=false | red=false
```

`test/hud-binding.test.ts:166-169` pins the gauge and the warning together at
this value; nothing holds the shield cut-off to them, which is how it slipped.

### 2. You can die at full shields after an E.C.M. burst

`src/game/ordnance.ts:240` refuses the E.C.M. only when
`energy < ECM_ENERGY_COST`, so firing at exactly 64 is allowed;
`src/game/game.ts:434` then subtracts, leaving the bank at 0, and nothing
checks for death there. `applyDamage` reports
`destroyed: sys.energy <= 0` (`src/game/systems.ts:216`) — an absolute test,
not a consequence of this hit. So until the next whole regen point (~0.157 s,
9-10 frames) **any** hit kills you, including one a full 255-point shield
absorbs, and including a 0-point hit from a build whose laser cannot beat your
armour.

```text
energy before E.C.M.: 64  cost: 64  refused? false
energy after:         0   still flying
fore shield 254/255, reachedHull: false  ->  DESTROYED: true
```

Narrow (the bank must be exactly 64) but it reads to a player as "I died at
full shields for no reason".

## Implementation

- Make the three comparisons one. `LOW_ENERGY` should mean one thing, and
  `>=`/`<` should be chosen once and shared.
- Decide what `destroyed` means: "this hit emptied the bank" (`reachedHull &&
  sys.energy <= 0`) or an absolute. Then make the E.C.M. consistent with it —
  refusing at `<=` cost is one character and closes it at the source.

## Acceptance

- There is no energy value at which shields are frozen and the console is
  quiet.
- A test walks the bank one point at a time across `LOW_ENERGY` and asserts
  the three consequences agree at every value.
- Firing the E.C.M. cannot leave the commander in a state where an absorbed
  hit kills.
- `npm run campaign` byte-identical — these are boundary corrections, and if
  the campaign moves, say why.

## Verify

`npm run check` plus the two walks above.
