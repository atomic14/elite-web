# 77 — A brain-flown ship is "evading" forever, because only the scripted run ticks the clock

**Kind:** combat bug · **Severity:** medium · **Size:** small
**Depends on:** none · touches the same field as 73

## Why

`NpcState.underFire` is documented as *"seconds of evasive flying left after the
last hit taken"*. `takeDamage` sets it to `UNDER_FIRE_SECONDS` (1.2), and
`break-off.ts` explains the decay as the whole point:

> It is a decay, not a latch, so a ship that is genuinely being shot at stays
> evasive for as long as that is true.

**It is decremented in exactly one place** — `NpcShip.attack`, line 1062:

```ts
this.state.underFire = Math.max(0, this.state.underFire - dt);
```

`brainFly` never touches it. So for any ship flying a trained policy it is a
LATCH, not a decay: one hit and it stays at 1.2 for the rest of the ship's life.

Measured — a pirate hit once, then flown for ten seconds on each path:

    underFire right after a hit:        1.2
    underFire after 10s of brainFly:    1.2   describeFlight -> "evading"
    underFire after 10s of attack():    0

## What is actually failing

**The readout lies, in exactly the way `flownBy` was added to stop.**
`describeFlight` (`break-off.ts:366`) returns `'evading'` for a brain-flown ship
whenever `underFire > 0`, and its own comment says the alternative would be
"quoting a stale word". It is quoting a stale word: the trainer's SPENT ITS TIME
column (`combat-sim.ts:898`), the live cockpit strip and `train/flight-probe.ts`'s
`doing` field will all read `evading` for the entire remaining life of any
brain-flown ship that has ever been hit — which, in a fight, is all of them
within a couple of seconds. The column then has two values, `own policy` before
the first hit and `evading` after it, and can never say anything else.

**The stale flag also reaches two rules, on the handover.** When a brain-flown
pirate crosses `BRAIN_HANDOVER_RANGE` and `attack()` takes over the flying:

- `nextAttackPhase(phase, dist, underFire > 0, extendRange)` cuts a run-out short
  whenever `underFire` is set, so the ship comes round immediately rather than
  extending — reading "somebody is landing shots on me" from a hit that may have
  landed a minute ago.
- `tacticSwitchReason` gates both of its damage triggers on `underFire > 0`
  (`tactic-choice.ts:279-280`), so a hurt brain-flown ship that hands over is
  permanently eligible for a `hurt` or `lastStand` re-roll rather than eligible
  only while it is actually being hit.

Neither is catastrophic today, because the shipped pirate AI is `scripted` and
never enters `brainFly` at all. It bites in three places that ARE live: the
combat trainer with a trained brain selected (which is what the LIVE BRAINS row
is for), the A/B flags `state.brains.trained` and `.pack`, and **the armed trader
flying `jameson-defend-g2`**, which reaches `brainFly` through the `fleeing`
branch of `update()` and never runs `attack()` at all — so its `underFire` is
set on the first hit and stays set forever.

It also matters for docs/TODO/73: if a training episode is given the handover,
every policy pirate arrives at `attack()` with a latched flag.

## What is NOT the problem

- **Not `takeDamage`.** Setting the flag from every damage source is right and is
  what makes the ship react to rams and warheads and not only gunfire.
- **Not `describeFlight`.** It reads the field honestly; the field is wrong.
- **Not the 1.2 seconds.** The constant is fine; nothing is decaying it.
- **Not `flownBy`.** That field is correct and is doing its job — it is why
  `describeFlight` does not ALSO quote a stale `attackPhase`. `underFire` is the
  second field with the same defect and it was not caught by the same audit.

## What to work out

The decay belongs somewhere both flights run, and there are two candidates:

- **`NpcShip.update()`, once per frame**, beside `this.regenerate(dt)` at the top
  — which is already the "before anything decides" slot and is already documented
  as running whatever the ship is doing. `attack()` then stops decrementing it.
  The catch is that a training episode drives `brainFly`/`attack` directly and
  never calls `update()`, so the episode would owe the ship the call, exactly as
  it already owes `regenerate` and `chooseWeapon` — three debts to the same split.
- **`brainFly` as well as `attack`**, which is one line and keeps the debt where
  it is. It is the smaller change and it leaves the field ticking on two paths,
  which is the shape that produced this.

The first is right by this codebase's own standards ("one rule has one home") and
the second is what will not break the trainer. Decide, and if it is the first,
add the call to `Episode.step` in the same change.

A third thing to settle while in here: `chooseWeapon` says **"CALL IT ONCE PER
FRAME"** and is called only from the `aggressiveToPlayer` branch of `update()`,
so `missileReload` also stops ticking whenever a pirate is doing anything else.
Same class, much smaller consequence.

## Watch out for

- **This changes seeded outcomes.** `nextAttackPhase` reads the flag, so any
  fixture where a brain-flown ship hands over will diverge. `test/npc.test.ts`
  and `test/break-off.test.ts` walk phases explicitly; expect to re-baseline.
- **It does NOT invalidate a brain.** `underFire` is not observed — no encoder
  reads it — so the weights are untouched.
- **`state.underFire` is snapshotted** (it is a field of `NpcState`, walked
  generically), so a save written today carries a latched value. It will decay on
  its own after the fix, which is the right migration and needs no code.
- **A test for this must exercise the brain path**, not the scripted one. The
  scripted path already decays correctly, so a fixture that flies `attack()` will
  pass either way.

## Acceptance

- `underFire` reaches 0 within `UNDER_FIRE_SECONDS` of the last hit on BOTH
  flight paths, asserted for each.
- `describeFlight` for a brain-flown ship returns `own policy` again 1.2s after a
  hit.
- The one-line mutation that removes the decay fails `npm test`.

## Verify

```js
// node --experimental-strip-types <this file>
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { NpcShip } from '../src/game/npc.ts';
import { npcImpactDamage, IMPACT } from '../src/game/impact-damage.ts';
import { brainFromFile } from '../src/ai-training/policy.ts';
import { describeFlight } from '../src/game/break-off.ts';
import { seedWorld } from '../src/game/rng.ts';

seedWorld(7);
const B = new URL('../src/ai-training/brains/', import.meta.url);
const brain = brainFromFile(JSON.parse(
  readFileSync(new URL('pirate-attack-g3.json', B), 'utf8')));
const tgt = new THREE.Vector3(), q = new THREE.Quaternion();

const a = new NpcShip('pirate', new THREE.Vector3(0, 0, 1000), 3);
a.takeDamage(npcImpactDamage(IMPACT.ram), tgt, true);
for (let i = 0; i < 600; i++) {
  a.brainFly(brain, 1 / 60, tgt, q, 300, a.object.position.distanceTo(tgt), 'player');
}
console.log('brainFly  ', a.state.underFire,
  describeFlight(a.state.attackPhase, a.state.underFire, a.state.fleeing, a.state.flownBy, a.state.tactic));

const b = new NpcShip('pirate', new THREE.Vector3(0, 0, 1000), 4);
b.takeDamage(npcImpactDamage(IMPACT.ram), tgt, true);
for (let i = 0; i < 600; i++) b.attack(1 / 60, tgt, b.object.position.distanceTo(tgt), true);
console.log('attack()  ', b.state.underFire);
// 2026-08-04:  brainFly 1.2 "evading"   ·   attack() 0
```
