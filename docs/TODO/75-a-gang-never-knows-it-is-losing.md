# 75 — A gang never knows it is losing, because a dead ship leaves the sky first

**Kind:** combat bug / training fidelity · **Severity:** high · **Size:** small
**Depends on:** none · same family as 70, 73 — a reward term that cannot be earned

## Why

`npcMissileEmergency` (`game/missile-launch.ts`) has three ways in, and each is a
REASON rather than a roll:

```ts
return hull <= MISSILE_LAST_STAND_HULL      // about to die
  || passes >= MISSILE_COMMIT_PASSES        // flown at it twice and it is still there
  || matesLost > 0;                         // the gang is losing — one of us is gone
```

**The third one can never be true in the live game.** `matesLost(fleet)` counts
`!state.alive` ships in the fleet it is handed, and the fleet it is handed is
`world.npcs`. Every path that kills an NPC removes it from `world.npcs` inside
the same statement: `Combat.destroy` opens with `this.wreck(npc)`
(`combat.ts:217`) and `wreck` calls `this.world.despawn(npc)` (`combat.ts:266`),
which splices the array (`world.ts:90-94`). There is no frame, and no
instruction between a ship dying and a ship leaving, in which any NPC runs a
decision.

Measured two ways.

**In the live game**, a fresh career launched with a four-pirate gang spawned on
top of the commander, 7,200 frames (two minutes, ending in the commander's
death):

    max matesLost seen in world.npcs over 120s: 0
    sum of dead-but-present ship-frames:        0

**Directly**, killing a pirate the way the energy bomb does:

    pirates: 4   matesLost before: 0
    victim alive after damage: false | still in world.npcs: true | matesLost: 1
    after destroyNpc:          in world.npcs: false | matesLost: 0

So the value is 1 for exactly as long as it takes the caller to run the next
line, and 0 whenever anything can read it.

`NpcShip.matesLost`'s own doc comment says the opposite in as many words:

> Counted off the fleet at the moment it is asked rather than latched, so a ship
> that arrives late to a fight already in progress reads the same situation as
> one that has been there throughout.

A ship arriving late reads **zero**, and so does one that watched three wingmen
die.

## What is actually failing

Two separate things, and they point in opposite directions.

**The rule is dead in the sky.** A gang that is being cut apart has no reason to
escalate. The two surviving reasons both require the individual ship to be in
trouble — its own hull under 0.4, or its own two completed passes — so
`missile-launch.ts`'s stated design ("the gang is losing. One of us is already
gone.") is not something the game can express.

**The rule is alive in the trainer**, which is the divergence. `Episode` never
removes a dead pirate from `this.fleet` — `fire.wreck` is `() => {}`
(`scenario.ts:871`) and `hurtSelf` does not despawn — so `matesLost(this.fleet)`
counts correctly there. A training pirate in a four-ship gang unlocks its rack
the moment a wingman dies; the same ship in the same fight in the game does not.
That is a decision made differently by the two orchestrators, which is what
invariant 15's second half exists to stop.

**And nothing catches it.** Replacing the body of `matesLost` with a loop that
can never increment:

```ts
export function matesLost(fleet: readonly NpcShip[]): number {
  let lost = 0;
  if (fleet.length < 0) lost += 1;   // was: for (const s of fleet) if (!s.state.alive) lost += 1;
  return lost;
}
```

leaves `npm test` at **2982 passed, 0 failed**. The only test that mentions
`matesLost` is a comment in `test/missiles.test.ts:242`.

## What is NOT the problem

- **Not `world.despawn`.** Removing a dead ship promptly is right: it is what
  stops the renderer, the collision loops, the targeting sweep and the encounter
  counts working over corpses. The fix is not "keep the dead around".
- **Not `matesLost`'s arithmetic.** It counts what it says it counts. It is
  handed a list that cannot contain the thing it is looking for.
- **Not the same bug as 73.** 73 is about `passesMade` being unreachable for a
  BRAIN-flown pirate in TRAINING. This is about `matesLost` being unreachable for
  EVERY pirate in the GAME, brain-flown or scripted. They are two of the three
  reasons, failing in the two different worlds, for two different structural
  reasons — which between them leave one reason working on each side.
- **Not a balance question yet.** Nobody has decided the gang should be more
  dangerous; the point is that a stated rule does nothing, and the two worlds
  disagree about it.

## What to work out

The question is where "how many of us are gone" should be counted, and there are
three honest answers:

- **A field of the world.** A counter the Game increments in `wreckNpc` /
  `destroyNpc`, reset per system, read through the `WorldView` the way
  `missileInbound` already is. It is state, so it is saved. This matches how the
  ship is already told the other fact it cannot see for itself, and it is the
  smallest change that makes the rule mean something.
- **A field of the ship.** `NpcState.matesLost`, latched, incremented for every
  living ship when one dies. Costs a fan-out on death and gives each ship its own
  history — which is arguably better ("a ship that arrives late has not watched
  anybody die") and is the opposite of what the current doc claims.
- **Delete the reason.** If "the gang is losing" is not a signal the game wants
  to model, say so and take it out of `npcMissileEmergency` — and out of the
  trainer with it, because the trainer having it and the game not is the worst of
  the three states.

Whichever is chosen, `matesLost(fleet)` and its doc comment go with it: the
function is only reachable from `NpcShip.update` and `Episode.step`, and both
would stop calling it.

## Watch out for

- **This is a balance change, in the direction of more warheads.** The gang
  currently launches only from desperation and commitment. Turning the third
  reason on adds launches to exactly the fights that are already going badly for
  the player. CLAUDE.md: threat is not fun — fly it (`T` at any station, a wave
  scenario) before shipping it.
- **The one-in-the-air cap is what makes it survivable**, and it has no test —
  see docs/TODO/83. Do that one first or at the same time.
- **It invalidates nothing on its own**, because no shipped brain reads
  `matesLost`; it is `chooseWeapon`'s argument, not an observation. But it DOES
  change what a training episode does, so a defence retrain after it is not
  comparable with one before it.
- **The training side may already be wrong in the other direction.** If the fix
  is a world counter, the episode has to keep one too, and `Episode` counting
  `!alive` in an array it never prunes is only accidentally the same answer.

## Acceptance

- "How many of this gang are gone" is a value the live game can produce, and a
  test that kills a ship, steps the world, and asserts a surviving pirate sees a
  non-zero count.
- The two orchestrators read the same rule from the same place, or the reason is
  gone from both.
- A test that fails when the counting is gutted — the mutation above must break
  something.
- `npm run campaign` and a flown wave, because this adds warheads to gang fights.

## Verify

The live-game half:

```js
// node --experimental-strip-types <this file>   — needs node_modules resolvable
import * as THREE from 'three';
import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { matesLost } from '../src/game/npc.ts';
import { dealToNpc } from '../src/game/damage-dealt.ts';
import { npcImpactDamage, IMPACT } from '../src/game/impact-damage.ts';

withoutSaving(() => {
  seedWorld(99);
  const g = new Game(() => headlessShell());
  g.launch();
  const w = g.state.world;
  for (let i = 0; i < 4; i++) {
    w.spawn('pirate', g.state.player.position.clone()
      .add(new THREE.Vector3(400 + i * 60, 0, -600)), i + 1);
  }
  for (let i = 0; i < 60; i++) g.update(1 / 60, i / 60);
  const victim = w.npcs.filter((n) => n.role === 'pirate')[0];
  dealToNpc(victim, npcImpactDamage(IMPACT.energyBomb), g.state.player.position, 'bomb');
  console.log('dead but present:', w.npcs.includes(victim), 'matesLost:', matesLost(w.npcs));
  g.destroyNpc(victim);
  console.log('after destroyNpc: present:', w.npcs.includes(victim),
    'matesLost:', matesLost(w.npcs));
});
// 2026-08-04: dead but present: true matesLost: 1 / after: present: false matesLost: 0
```

The vacuity half: apply the two-line mutation to `matesLost` above and run
`npm test`. It reports 2982 passed, 0 failed.
