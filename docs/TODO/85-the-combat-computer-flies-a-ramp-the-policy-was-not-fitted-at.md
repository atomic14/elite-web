# 85 — The combat computer flies a ramp two thirds of the defence training does not use

**Kind:** training fidelity · **Severity:** medium · **Size:** small
**Depends on:** none · surfaced by 72's widening of the defence rotation

## Why

`game/combat-computer.ts` states its own contract:

> The rate ramp an NPC's brain flies with, applied to the player's ship. ...
> Only the constants are this module's: **the defence policy was fitted at the
> NPC ramp, so the autopilot flies at the NPC ramp.**

```ts
export function ccRamp(cur, target, active, dt) {
  return rampToward(cur, target, active, dt, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY);
}
```

That was true when every defence episode flew `traderCobra`, whose `TargetHull`
is built by `traderHull()` and does use `BRAIN_RATE_RAMP` / `BRAIN_RATE_DECAY`
(`scenario.ts:230-231`).

`train/defence-fight.ts` rotates three hulls evenly:

```ts
const HULLS: TargetHullId[] = ['playerCobra', 'traderCobra', 'playerCobraSlow'];
```

and the other two are built by `targetFlightHull()`, which uses the **player's**
ramp:

```ts
rateRamp: PLAYER_FLIGHT.rateRamp,     // 4.1396  — same
rateDecay: PLAYER_FLIGHT.rateDecay,   // 13.3886 — against BRAIN_RATE_DECAY's 5.2207
```

**2.56x the bleed-off rate**, on two of every three defence episodes. The probe
confirms the rotation is even — over `evolve.ts`'s 24 validation seeds the hulls
split 8/8/8, and over the 900-seed training stream 303/297/300.

So the autopilot's own comment is true for a third of what its policy was fitted
in, and the file has no way to know: `combat-computer.ts` cannot see
`defence-fight.ts`.

## What is actually failing

A pilot's turn does not stop where the policy learned it stops. `RATE_DECAY` is
not a cosmetic constant — `player.ts` records exactly what moving it did:

> Was 5.0, which made a light tap far bigger than it should be: most of the
> movement came AFTER the key was released, not during it. Measured on a 100ms
> tap at 1/60s, the ship swung 6.9 degrees, of which 5.5 was coast-down — against
> target hit windows of 1-2.5 degrees. At 12 the same tap is 3.7 degrees.

A policy that re-decides at 10 Hz is producing exactly those taps. Two thirds of
its episodes were flown with the tight tail and one third with the loose one, and
the game gives it the loose one — so a genome that learned to stop a turn by
releasing the stick overshoots in the game by roughly the difference the quote
describes.

`me.pitchRate` and `me.rollRate` are also OBSERVED (`observe()` slots 11-12), and
the combat computer feeds them from `this.state.pitch/roll` — its own ramped
values. So the mismatch is not only in the flying; it is in the input.

Two smaller mismatches sit beside it and are worth settling in the same change:

- **`CC_ACCEL = 100` against the trader Cobra's `shipAccel` of 101.2**
  (220 x `ACCEL_FRACTION` 0.46). A hardcoded number one step off a derived one,
  which is the shape `ship-specs.ts` exists to have ended. `CC_MAX_SPEED = 220`
  does match `SPECS.trader[0].maxSpeed`, and the pitch/roll caps are derived from
  `TURN` correctly.
- **The threat the policy is shown is chosen by different rules.**
  `CombatComputer.step` requires `isHostileToPlayer` and a range under
  `THREAT_RANGE` (6500), and DISENGAGES when nothing qualifies. `Episode`'s
  `observeTrader` is fed `this.nearestPirate() ?? this.pirates[0]` — no range
  gate, no hostility gate, and the `?? this.pirates[0]` branch hands the encoder
  a **dead** ship's transform on the frame every attacker has been destroyed. So
  the policy is fitted on threat observations the game cannot produce.

## What is NOT the problem

- **Not `rampToward`.** One rule, one home, correct; only the constants differ.
- **Not `PLAYER_FLIGHT.rateDecay` being 13.3886.** That is the player's ship and
  it is right.
- **Not `traderHull()` using the NPC ramp.** An armed trader IS an NPC and flies
  at the NPC ramp in the game too.
- **Not a reason to narrow the rotation back to one hull.** docs/TODO/72's
  widening is the right direction — Chris: *"we should train against all the
  different scenarios and ships"*. The defect is that the autopilot did not
  follow.

## What to work out

The question is which ship the combat computer is supposed to BE, and there are
two coherent answers:

- **It is the commander's ship.** Then `CC_MAX_SPEED`, `CC_ACCEL`, the caps and
  the ramp should all come from `PLAYER_FLIGHT` and the hull the commander is
  actually flying, and the defence rotation is already right. This is the honest
  reading of "a co-pilot flying YOUR ship", and it is a bigger change: it makes
  the autopilot faster and more agile than anything the policy has been flown at
  on two of three hulls, and it needs a flown check before it ships.
- **It is a deliberately handicapped co-pilot.** Then the numbers stay, and
  `defence-fight.ts` should include an envelope that matches them — i.e. the
  autopilot's own hull should be one of the rotation's rows, so the policy is
  fitted at the ramp it will fly at. This is the smaller change and it keeps the
  file's stated contract true.

Either way the two files should stop being able to disagree: whichever set of
constants wins, they belong in one place that both `combat-computer.ts` and
`scenario.ts`'s hull table read, in the same way `TURN` and `shipAccel` already
are.

The `nearestPirate` question is separate and smaller: gate it the way the
autopilot gates, or state why an episode does not need to.

## Watch out for

- **This invalidates the defence brain if the rotation changes.** Adding or
  changing a hull changes what a champion is fitted to; a retrain after it is not
  comparable with one before it (docs/TODO/63's precedent).
- **Changing `CC_*` is a live gameplay change** to a 20,000-credit fitting a
  player has bought. Fly it (`T` at any station, combat computer engaged) before
  shipping.
- **`ccRamp` is also used by `train/jameson-autopilot.js`**, the console harness
  that stands in for the autopilot, precisely so it does not write 4.0/5.0 out
  again. It follows whatever this file does.
- **Do not "fix" this by pinning the trainer to the NPC ramp on all three
  hulls.** `playerCobra` flying with an NPC's decay is a ship that does not exist
  either.

## Acceptance

- The ramp, the accel, the speed ceiling and the turn caps the combat computer
  flies at are the ramp, accel, ceiling and caps at least one row of
  `defence-fight.ts`'s rotation is flown at, and the two read them from one
  place.
- `combat-computer.ts`'s comment describes the arrangement that exists.
- `CC_ACCEL` is derived or is stated as a deliberate departure with a number
  beside it.
- `Episode.observeTrader` is never handed a dead ship.

## Verify

```sh
node --experimental-strip-types --no-warnings -e "
  const { PLAYER_FLIGHT } = await import('./src/player.ts');
  const { BRAIN_RATE_RAMP, BRAIN_RATE_DECAY } = await import('./src/game/npc.ts');
  const { CC_ACCEL, CC_MAX_SPEED } = await import('./src/game/combat-computer.ts');
  const { SPECS, shipAccel } = await import('./src/game/ship-specs.ts');
  console.log({ playerDecay: PLAYER_FLIGHT.rateDecay, brainDecay: BRAIN_RATE_DECAY,
                CC_ACCEL, traderAccel: shipAccel(SPECS.trader[0]),
                CC_MAX_SPEED, traderSpeed: SPECS.trader[0].maxSpeed });
"
# 2026-08-04: { playerDecay: 13.3886, brainDecay: 5.2207,
#               CC_ACCEL: 100, traderAccel: 101.2,
#               CC_MAX_SPEED: 220, traderSpeed: 220 }
```

The hull split over the seeds actually used:

```js
const HULLS = ['playerCobra', 'traderCobra', 'playerCobraSlow'];
const hull = (s) => HULLS[(s >>> 9) % 3];
const val = Array.from({ length: 24 }, (_, e) => hull(5000011 + e * 7919));
console.log(val.reduce((m, h) => (m[h] = (m[h] || 0) + 1, m), {}));
// { playerCobra: 8, traderCobra: 8, playerCobraSlow: 8 }
```
