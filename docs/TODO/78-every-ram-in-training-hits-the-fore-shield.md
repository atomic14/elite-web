# 78 — Every ram in training lands on the fore shield

**Kind:** training fidelity · **Severity:** medium · **Size:** small
**Depends on:** none · the row docs/TODO/64's table does not have

## Why

docs/TODO/64 created `game/shield-face.ts` because "which of her two shields
takes it" was one rule written twice, agreeing, in `Combat.hitPlayer` and in a
training episode. The file's own header says it plainly:

> HERS, and only hers. A ship carries one bank and has no facing at all.

`scenario.ts` uses it on the laser path — the `FireWorld` callback at
`scenario.ts:866` is `trader.takeDamage(damage, this.hitFromFront(from))` — and
on the warhead path at `:1097`. **The ram path never got it.**
`Episode.resolveCollisions`:

```ts
this.traderRams += 1;
this.trader.takeDamage(ramPool, true);      // scenario.ts:1203
this.hurtSelf(p, ramEnergy);
```

and `TargetShip.takeDamage(points, fromFront = true)` (`:739`) defaults to the
same thing, so there are two `true`s and no geometry at all. The game routes the
same event through `host.applyPlayerDamage(ramPlayer, npc.object.position,
'ram')` (`world-step.ts:380`) → `damagePlayer` → `Combat.hitPlayer` →
`hitFromAhead`, which resolves the face from where the ship actually was.

Measured, over the 800 held-out defence fights `train/defence-probe.ts` flies
(`jameson-defend-g2`, 1-4 scripted pirates, three hulls, beam or military),
counting the true face at the moment each ram is billed:

| | rams |
| --- | --- |
| the attacker was genuinely ahead | 29 |
| the attacker was genuinely BEHIND | **15** |

**34% of rams in training are billed to the wrong pool.**

## What is actually failing

Not the total. The 115 points come off her either way, so `damageTaken`,
`targetDamageShare` and every pools-left figure are unaffected.

What changes is WHICH pool, and `systems.ts` makes that consequential in three
ways that all bear on what a defence policy learns:

- **`applyDamage` spends the facing shield first and spills the remainder into
  the bank.** A ram into a full aft shield costs 115 of the aft face; the same
  ram into an already-flattened fore face goes straight to energy. The two are
  not the same event.
- **`regenerate` freezes BOTH shields once `energyLow(sys.energy)`.** So which
  face a 115-point ram lands on decides when she stops healing at all.
- **`observeDefend` slot 15 is the bank alone**, precisely because "a full shield
  hides an empty bank". The policy is being shown a bank whose depth depends on a
  face chosen by a constant.

And it is the same defect the seam exists to prevent, still present on the one
path the item's table has no row for. `scenario.ts`'s comment on this very loop
says "the same two calls world-step.ts makes"; it is the same two DAMAGE calls
and not the same face rule.

## What is NOT the problem

- **Not `IMPACT.ram`.** Both sides mint the same 115 and the same 44, from the
  same module.
- **Not `collisions.ts`.** Both sides run `playerVsNpcs` and `npcVsNpcs`
  unchanged.
- **Not `hitFromFront`.** `Episode` already has it, already uses it twice, and it
  takes the attacker's position — which `resolveCollisions` is holding.
- **Not large in absolute terms for the defence fixture.** 44 rams over 800
  fights, because `jameson-defend-g2` is rammed rarely. It is much more frequent
  in the fixtures `train/ram-probe.ts` and `train/flight-probe.ts` fly, where
  contact per episode runs 0.13 with five pirates.

## What to work out

The fix looks like one line:

```ts
this.trader.takeDamage(ramPool, this.hitFromFront(npc.object.position));
```

Two things to settle before taking it.

- **When is the position read?** `playerVsNpcs` has already teleported the
  target out to `npc.radius + 120` along the away vector before it returns, so
  the direction from target to ship is preserved and the answer is stable — but
  it is worth asserting rather than assuming, because the game reads it in the
  same post-separation state and this is exactly how the RANGE came to disagree
  between the two resolvers (docs/TODO/64's "the range is measured here rather
  than passed in").
- **Should `fromFront` keep a default at all?** `TargetShip.takeDamage`'s
  `fromFront = true` is what let this happen silently. Removing the default makes
  every caller state the face, and the compiler finds the third one.

Beyond the fix, this is evidence for the wider question: **the ram is the only
damage path with no shared resolver.** `fire-resolution.ts` owns a fired shot,
`ordnance.ts` owns a warhead, and "two hulls touched, here is what it costs each"
is still written out in both orchestrators (`world-step.ts:376-396`,
`scenario.ts:1191-1212`) with the prices minted separately on each side. Whether
that becomes an `ImpactWorld` in the same shape is a decision, not a refactor.

## Watch out for

- **It invalidates the defence comparison.** Changing which pool a ram spends
  changes the world, so a `jameson-defend` figure measured after it is not
  comparable with one before — the same bargain docs/TODO/63 and /72 made, and
  it should be stated in docs/TRAINING-LOG.md rather than quietly re-baselined.
  It does NOT need an `EPISODE_SCHEMA` bump on its own: no fit-out changes and no
  new damage source appears. Decide that explicitly.
- **It moves nothing for attack or pack**, whose target is not the genome. Those
  two brains stay valid.
- **Do not "fix" the NPC side to match.** `hurtSelf` passing no `from` and no
  `byPlayer` is a second, smaller divergence (see the report); a ship has one
  bank and no facing, so no face rule is missing there.

## Acceptance

- A ram in a training episode lands on the face the game would put it on.
- `test/fire-resolution.test.ts`'s two-caller pattern extended to a ram, or an
  equivalent assertion: the same contact geometry, both orchestrators, the same
  pool spent.
- Hard-coding the face back to `true` fails that test.

## Verify

```js
// node --experimental-strip-types <this file>
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Episode } from '../src/ai-training/scenario.ts';
import { hitFromAhead } from '../src/game/shield-face.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { IMPACT, playerImpactDamage } from '../src/game/impact-damage.ts';
import { brainFromFile } from '../src/ai-training/policy.ts';
import { defenceFight } from '../train/defence-fight.ts';

const B = new URL('../src/ai-training/brains/', import.meta.url);
const brain = brainFromFile(JSON.parse(
  readFileSync(new URL('jameson-defend-g2.json', B), 'utf8')));
const RAM = playerImpactDamage(IMPACT.ram);
const v = new THREE.Vector3(), q = new THREE.Quaternion();
let front = 0, back = 0;
for (const base of [8675309, 1234577]) {
  for (let e = 0; e < 400; e++) {
    const seed = base + e * 7919, f = defenceFight(seed);
    const ep = new Episode({
      seed, pirates: Array.from({ length: f.count }, () => ({ kind: 'scripted' })),
      trader: { kind: 'policy', brain }, traderArmed: true, traderClass: f.hull,
      traderLaser: f.laser, targetEnergyUnit: f.energyUnit, targetEcm: f.ecm,
    });
    const fleet = ep.fleet ?? [];            // private; read it however you can
    const t = ep.trader, orig = t.takeDamage.bind(t);
    t.takeDamage = (points, fromFront = true) => {
      if (points === RAM) {
        let best = null, bd = Infinity;
        for (const n of fleet) {
          if (!n.state.alive) continue;
          const d = n.object.position.distanceTo(t.pos);
          if (d < bd) { bd = d; best = n; }
        }
        if (best) (hitFromAhead(best.object.position, t.pos, t.quat, v, q) ? front++ : back++);
      }
      return orig(points, fromFront);
    };
    while (!ep.done) ep.step(FIXED_DT);
  }
}
console.log({ trulyAhead: front, trulyBehind: back });
// 2026-08-04: { trulyAhead: 29, trulyBehind: 15 }  — 34% mis-billed
```
