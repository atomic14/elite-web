# 87 — Three parity checks assert `f(x) === f(x)`

**Kind:** test gap · **Severity:** low · **Size:** small
**Depends on:** none · the same family as docs/TODO/49

## Why

`test/combat-model.test.ts` is the file that holds the trainer and the game to
one physics. Its section 6 is introduced like this:

> and the simulator's stepShip — each with the constants written out again. That
> is how the simulator sat at decay 5.0 while the player moved to 12.0, and how
> "correcting" it silently broke the NPC half. **One rule now, with the constants
> passed in, so assert the rule rather than the copies.**

The two assertions under that comment are:

```ts
check('the shared ramp is what the player\'s controls use',
  rampFlightRate(0.4, 1.2, true, 1 / 60)
    === rampToward(0.4, 1.2, true, 1 / 60, PLAYER_FLIGHT.rateRamp, PLAYER_FLIGHT.rateDecay));
check('...and what the combat computer uses, at the NPC constants',
  ccRamp(0.4, 1.2, false, 1 / 60)
    === rampToward(0.4, 1.2, false, 1 / 60, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY));
```

`src/player.ts` defines `rampFlightRate` as `rampToward(…, RATE_RAMP,
RATE_DECAY)` and `PLAYER_FLIGHT.rateRamp` as `RATE_RAMP`.
`src/game/combat-computer.ts:227-229` defines `ccRamp` as `rampToward(…,
BRAIN_RATE_RAMP, BRAIN_RATE_DECAY)`. Each assertion expands to the same
expression on both sides of the `===`.

The third, seven lines down:

```ts
check(`combat computer caps track TURN (${CC_MAX_PITCH} / ${CC_MAX_ROLL})`,
  CC_MAX_PITCH === 0.5 * TURN.pitch && CC_MAX_ROLL === 0.5 * TURN.roll);
```

against `export const CC_MAX_PITCH = 0.5 * TURN.pitch;`.

All three pass for any value of the constants and any behaviour of
`rampToward` — including a `rampToward` that returns its input unchanged, or one
whose two constants are swapped. (They would fail on `NaN`, since `NaN !== NaN`.
That is the only defect they can detect.)

## What is actually failing

Nothing in the code. Three of the assertions guarding the project's single most
expensive historical bug class — a physics constant written out twice — cannot
observe it.

The section's own comment says what it wants: *assert the rule rather than the
copies*. To do that it has to compare against something that is NOT the
implementation — a known-good value, or an independently-derived one.

The rest of that file is good and this item is not about it: the `SPECS`
crossfire checks, the accel derivation, the firing cadence bounds and the
`shipAccel` parity are all real. `test/fire-resolution.test.ts` is the model —
it drives the same `FireEvent` and the same seed through BOTH callers and then
gutted the resolver to prove the test notices.

Two smaller ones in the same family, worth the same pass:

- **`test/npc.test.ts:78-83`** — `check('an NPC only ever RETURNS a fire event,
  never applies it', player.speed === 100)`. `PlayerRef` is `{ position,
  quaternion, speed }`; there is no damage sink on it, so an NPC that applied
  damage would have nothing to write to and this would still pass. The title
  claims invariant 15.
- **`test/brain-names.test.ts:98-100`** — the round-trip check carries an escape
  hatch `|| (id === 'pirate-attack-g3' || id === 'jameson-defend-g2')`, and only
  ONE of the two actually fails to round-trip (`jameson-defend-g2`, whose
  selection is `{}` and therefore reads back as `as-shipped`).
  `pirate-attack-g3` round-trips correctly, so its exemption is dead weight that
  would hide a regression. Of five ids, three are tested.

## What is NOT the problem

- **Not `rampToward`.** One rule, one home. The refactor it came from was right.
- **Not the constants.** 4.1396 / 5.2207 and 13.3886 are correct as far as
  anything here can tell; that is the point — nothing here can tell.
- **Not the whole file.** Most of `combat-model.test.ts` is doing real work.
- **Not `test/brain-names.test.ts`'s other assertions.** The name-level checks
  around the escape hatch are the ones carrying the weight and they are fine.

## What to work out

- **Pin the ramp to a computed value, not to its own definition.** One step of
  `rampToward` at a stated input, against the number written out — so a change to
  either constant or to the shape of the curve fails, loudly, with the old and
  new values in the message. Three lines.
- **Pin `CC_MAX_PITCH` to the trader Cobra's row** rather than to its own
  right-hand side: `SPECS.trader[0].turnRate * TURN.pitch`. That is what the
  comment claims it tracks, and it makes the check fail if the roster row ever
  moves — which is the failure it is for.
- **Give `test/npc.test.ts:78-83` something to observe**, or delete it and let
  the `FireEvent` return-type assertions carry invariant 15 on their own. The
  honest version is a `PlayerRef`-shaped object with a poisoned setter, or a
  frozen one.
- **Narrow the `brain-names` hatch to the one id that needs it**, and consider
  fixing the underlying collision instead: `SELECTIONS['jameson-defend-g2'] = {}`
  makes the picker offer a row that is indistinguishable from AS_SHIPPED (see
  docs/TODO/81).

## Watch out for

- **Pinning to a literal is a maintenance cost.** It is the right one here —
  these three constants have moved exactly twice in the project's life and both
  times it was the bug — but the message has to print both numbers or the next
  person has no idea what changed.
- **Do not delete the assertions.** They are in the right place and they name the
  right property; they just do not test it.

## Acceptance

- Each of the three checks fails when its constant is changed by 1%.
- `test/npc.test.ts`'s invariant-15 check fails when an NPC is made to mutate
  what it is handed, or is replaced by something that can.
- The `brain-names` round-trip hatch covers exactly the ids that do not round
  trip.

## Verify

```sh
# src/game/npc.ts   export const BRAIN_RATE_DECAY = 5.2207;
#                -> export const BRAIN_RATE_DECAY = 5.3;
npm test
# 2026-08-04: 2982 passed, 0 FAILED
git checkout src/game/npc.ts
```

That is the whole finding in one line: the constant that governs how every
brain-flown ship and the purchasable combat computer bleed off a turn can be
moved and **no test in the project notices** — including the two that name it.
