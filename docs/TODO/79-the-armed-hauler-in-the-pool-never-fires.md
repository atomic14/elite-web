# 79 — The "trader that shoots back" in the attack pool fires 0.00 shots an episode

**Kind:** training methodology · **Severity:** medium · **Size:** small
**Depends on:** none · it is the fix docs/TODO/-era `--pool` made, measured

## Why

`train/evolve.ts`'s opponent rotation exists because "a single opponent produces
a counter-brain rather than a pilot", and its comment names two axes:

> Variety means two different things and the pool needs both. Different
> BEHAVIOUR: a scripted hauler flies a predictable line, the evaders jink. And
> different THREAT: **a trader that shoots back is a completely different problem
> from one that only runs**, and a pirate that has never been shot at has no
> reason to learn when to break off.
>
> That second axis was missing entirely — the attack phase never set
> traderArmed, so every opponent in the rotation, jameson-defend included, flew
> unarmed. The pirate was being trained exclusively against victims.

The fix was to add a row: `{ ctrl: { kind: 'scripted' }, armed: true, label:
'scripted, armed' }` (`evolve.ts:234`).

**That row shoots nothing.** 60 episodes each on `evolve.ts`'s own validation
seeds:

| target | attacker | trader shots/ep | hits/ep | damage/ep | pirate bank lost |
| --- | --- | --- | --- | --- | --- |
| scripted, UNarmed | `pirate-attack-g3` | 0.00 | 0.00 | 0.0 | 0.8% |
| scripted, UNarmed | scripted | 0.00 | 0.00 | 0.0 | 0.0% |
| scripted, **armed** | `pirate-attack-g3` | **0.00** | 0.00 | 0.0 | **0.8%** |
| scripted, **armed** | scripted | **0.02** | 0.02 | 0.3 | 0.2% |

One shot every fifty episodes, against one of the two attackers, and none at all
against the other. The armed row and the unarmed row are the same fixture.

The tail-time and engagement shaping confirm it — the two rows are identical to
two decimal places:

    scripted hauler   g3        tailTime/ep 18.54s   engaged/ep 32.2s
    scripted, armed   g3        tailTime/ep 18.54s   engaged/ep 32.2s

## What is actually failing

`Episode.step`'s non-policy trigger discipline:

```ts
this.traderFireCooldown -= dt;
if (threat && this.traderFireCooldown <= 0
    && this.facingAngle(this.trader, threat.pos) < 0.15) {      // scenario.ts:1009-1010
```

and `scriptedTrader`:

```ts
if (this.trader.damageTaken > 0) {
  // nose to `own * 2 - threat` — directly AWAY — and throttle open
```

A scripted trader that has been hit points its nose 180 degrees from the pirate
for the rest of the episode, so `facingAngle < 0.15` is never satisfied again.
Before it is hit it ambles to waypoints rolled 2,000 units away and is pointed at
the pirate only by accident. The gun cannot fire because the pilot never looks at
anything.

Two consequences:

- **One of seven pool entries is a duplicate**, so `--pool` rotates over six
  distinct opponents and calls it seven. Since the pick is `traderPool[seed %
  traderPool.length]`, a seventh of the episode budget is spent re-flying a
  fixture the rotation already contains.
- **The axis the comment says was missing is still missing for the SCRIPTED
  half.** The pool does have two genuinely armed rows — `jameson-defend-g2` on two
  hulls — and one more that shoots, `holding/playerCobra`. So "the pirate is
  trained exclusively against victims" is no longer true. But the row added to fix
  it is not one of the ones that fixed it, and the comment credits the wrong one.

There is a third thing worth stating while the pool is open: **`runner/playerCobra`
is a fixture in which nothing happens.** The commander's hull runs at 400 against
a pirate's ~240, so it is never caught: `engaged/ep 0.2s`, `tailTime/ep 0.59s`
over the whole 45 seconds. The comment argues for it deliberately ("teaches the
only lesson that is actually true in this game — make the intercept count"), and
that argument is about the ESCAPE penalty, which every genome collects equally.
It is worth re-reading now that it can be measured.

## What is NOT the problem

- **Not `npcTriggerPull`.** The extra 0.15 rad / 1.2s layer never gets far enough
  to reach it. (That layer is itself a third firing rule and is in the report; it
  is not what makes this row silent.)
- **Not `TRADER_WEAPON_BYTE` or `npcCrossfireDamage`.** The damage is right; the
  trigger is never pulled.
- **Not the defence policy rows.** `jameson-defend-g2` on `playerCobra` and
  `playerCobraSlow` genuinely shoots back, and it is those two rows plus
  `holding/playerCobra` that carry the "different threat" axis today.
- **Not a `--pool` bug.** The rotation works; one of its entries is inert.

## What to work out

Three options, and the first is nearly free:

- **Make the scripted trader defend itself.** A hauler that turns its nose on the
  thing shooting it for a second at a time is a small change to `scriptedTrader`
  and gives the row the behaviour the comment claims. It also changes the UNarmed
  scripted hauler, which is the pool's baseline and the `scriptedReference`
  every training run is printed against — so it is not free after all, and that
  is the thing to decide.
- **Replace the row.** `holding` armed on `traderCobra` would be a slow, armed,
  predictable target that actually shoots — different from `holding/playerCobra`
  in envelope and from the defence rows in behaviour.
- **Delete the row and fix the comment.** If the two defence rows and `holding`
  cover the axis, say so, and give the seventh of the budget to something else.

Whichever, `evolve.ts`'s pool comment should end up describing what the pool
does rather than what it was intended to do.

## Watch out for

- **This invalidates a pirate retrain comparison, not a brain.** Nothing shipped
  today was trained with `--pool` since the pool last changed; check
  docs/TRAINING-LOG.md before claiming a run is comparable.
- **`scriptedTrader` is also the `scriptedReference` baseline** (`evolve.ts:381`,
  `:404`) and the `attack` phase's default opponent with no `--pool` at all, and
  it is `train/evaluate.ts`'s "1v1 vs scripted trader" headline row. Changing how
  it flies moves every one of those numbers.
- **`--pool` is refused for `evade` and `defend`** and is not the default for
  `attack`, so nothing that ships today is affected — which is also why this has
  gone unnoticed.

## Acceptance

- Every entry in `traderPool` produces a measurably different fight from every
  other, or is removed.
- The armed rows fire a non-trivial number of shots per episode, measured and
  written into the comment.
- `evolve.ts`'s pool comment describes the pool that exists.

## Verify

```js
// node --experimental-strip-types <this file>
import { readFileSync } from 'node:fs';
import { Episode } from '../src/ai-training/scenario.ts';
import { brainFromFile } from '../src/ai-training/policy.ts';
import { FIXED_DT } from '../src/game/world-step.ts';

const B = new URL('../src/ai-training/brains/', import.meta.url);
const g3 = brainFromFile(JSON.parse(
  readFileSync(new URL('pirate-attack-g3.json', B), 'utf8')));
for (const armed of [false, true]) {
  for (const [who, ctrl] of [['g3', { kind: 'policy', brain: g3 }], ['scripted', { kind: 'scripted' }]]) {
    let shots = 0, dmg = 0;
    for (let e = 0; e < 60; e++) {
      const ep = new Episode({
        seed: 5000011 + e * 7919, pirates: [ctrl],
        trader: { kind: 'scripted' }, traderArmed: armed,
      });
      while (!ep.done) ep.step(FIXED_DT);
      shots += ep.trader.shotsFired; dmg += ep.trader.damageDealt;
    }
    console.log(`armed=${armed} vs ${who}: shots/ep ${(shots / 60).toFixed(2)} dmg/ep ${(dmg / 60).toFixed(1)}`);
  }
}
// 2026-08-04: armed=true vs g3 -> shots/ep 0.00 dmg/ep 0.0
//             armed=true vs scripted -> shots/ep 0.02 dmg/ep 0.3
```
