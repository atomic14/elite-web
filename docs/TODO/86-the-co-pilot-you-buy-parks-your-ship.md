# 86 — The co-pilot you buy parks your ship

**Kind:** combat feel/design · **Severity:** medium · **Size:** medium
**Depends on:** none, but read 80 and 85 first · nothing here has been FLOWN

## Why

CLAUDE.md's north star for the AI:

> **For the AI: threat is not fun.** A well-optimised pirate is a turret that
> hangs in space and snipes, and evolution will find it. ... **Fly it before
> tuning it.**

`jameson-defend-g2` was promoted on measurements alone. Nobody has flown it. It
is the policy an armed trader turns and fights with AND the policy the
purchasable combat computer flies YOUR ship with (`defenceBrainNameFor` answers
both), and `brain-names.ts` calls it `TURNS AND KILLS — AN ARMED TRADER THAT
TURNS ON THE SPOT AND SHOOTS BACK`.

"Turns on the spot" is exact. Over 800 held-out defence fights, sampling the
target's speed every frame:

| hull flown | hull top speed | mean speed | frames with any speed at all |
| --- | --- | --- | --- |
| `playerCobra` | 400 | **10.6** | 10.9% |
| `traderCobra` | 220 | **3.3** | 7.0% |
| `playerCobraSlow` | 90 | **2.2** | 7.3% |

**It is stationary on nine frames out of ten.** `train/ram-probe.ts` reports the
same thing from the other side: its `evades` row, which flies this policy on the
commander's Cobra, has a target mean speed of **5** against the `holding`
scripted pilot's 56 — the shipped defence policy is less mobile than the
fixture that exists to model a pilot who has stopped dead to shoot.

Nothing in the selection can see this. `outcomeOf('defend', …)` is pools kept and
attackers broken; `fitnessDefend` pays for time, pools, damage dealt and kills.
None of them has a speed term, and the only guard that could catch it is
`evolve.ts`'s `flies()`, which rejects a champion whose forward throttle share is
under 5%. This policy reads **12.9%** on that fixture — it passes, at two and a
half times the threshold, on a probe that only ever presents a head-on approach.

## What is actually failing

Possibly nothing, and that is why this is a decision rather than a bug. The
measurements say the policy is very good at its job: 88.5% of her pools kept
cumulatively, 41.6% of her attackers destroyed, **0 deaths in 800 fights**, and
every warhead sent at her answered (0.80 launched an episode, 0.00 landed — and
the E.C.M. head is genuinely doing that work: with the E.C.M. taken away on the
same seeds, 0.68 land).

The question is what it is like to sit in. Three specific things to look for:

- **It is your ship.** A pirate that hangs still is a design failure this project
  has already rejected once, by name, after Chris flew generation 2 and asked for
  the old brain back. The same behaviour on the player's own hull is not
  obviously the same failure — a gun platform that never gets hit and kills two
  fifths of a gang may be exactly what a 20,000-credit fitting should be — but it
  is the same shape, and the project's own rule is that this is settled by flying
  it.
- **A parked ship cannot leave.** The combat computer disengages when nothing
  hostile is within `THREAT_RANGE`, and until then it holds the throttle shut. A
  commander who engages it in a wave he is losing has bought a fitting that
  removes his ability to run — and running is the counterplay the escape range in
  every training episode exists to preserve.
- **It is measured only against one attacker.** The defence phase trains against
  `scripted` and `defence-probe.ts` probes against `scripted`. Against
  `pirate-attack-g3` — a close-range standoff policy it has never seen — the same
  800 fights read 79.6% cumulative pools kept instead of 88.5%. It generalises,
  but nine points less well, and the sky it will actually fly in contains four
  tactics of the scripted run and gangs of up to six.

## What is NOT the problem

- **Not the E.C.M. head.** It works, it is earned rather than given
  (`widenBrain` starts it inert and `act` reads `>` not `>=`), and it is the
  difference between 0.00 and 0.68 warheads landing.
- **Not `MIN_CRUISE_FRACTION`.** That floor is deliberately for HOSTILES only —
  "traders and haulers are allowed to come to rest" — so this is not a rule being
  violated. Whether the ship a PLAYER is sitting in should have one is the
  question.
- **Not the selection rule.** docs/TODO/65's outcome is a large improvement and
  this policy is what it found. A speed term bolted onto `fitnessDefend` to fix
  the symptom would be the same mistake 65 diagnoses.
- **Not `flies()` being wrong.** It catches the run-11 failure it was written for.
  It is narrow: one head-on geometry, 1800 units closing to 325, at four target
  speeds and two hulls, and a 5% floor.

## What to work out

**Fly it first.** `T` at any station, an exercise with the combat computer
engaged, against a wave. Then the honest options, in order of size:

- **Accept it and say so.** Re-word the character line so a pilot knows what he
  is buying: it holds station and shoots, it does not manoeuvre. That is one
  line and it is the minimum.
- **Give the autopilot a speed floor.** The same argument `MIN_CRUISE_FRACTION`
  makes for hostiles, applied to the co-pilot — but as a clamp in
  `CombatComputer.step` it is a rule the policy was not fitted under, and the
  policy's aim would degrade against a moving line it never learned to hold.
- **Widen `flies()`.** It samples one geometry; a spread that includes being
  overtaken, being crossed and being astern would give the guard something to
  see. Cheap, and it does not invalidate anything.
- **Put a movement term in the defence phase.** The most expensive and the one to
  be most careful with — a shaped term for translation is the kind of thing that
  produces a policy that flies in circles to collect it.

## Watch out for

- **Do not compare this with `jameson-defend-g1`'s numbers.** g1 was measured
  before the pools recharged (63), before missiles existed (62) and before the
  E.C.M. (72); docs/TRAINING-LOG.md says so.
- **A retrain is not free.** The defence genome is 17 inputs and 13 heads and is
  the only one of the three with either; it is also what the combat computer
  flies, so a bad one is a fitting the player has paid for.
- **The measurements above are all bot-flown**, which CLAUDE.md says is the
  weaker kind of evidence in both directions. The 88.5% and the 41.6% are as
  provisional as the mean speed of 3.

## Acceptance

- A human has flown against the armed-trader version and WITH the combat
  computer version, and the record is in docs/TRAINING-LOG.md.
- The character line in `brain-names.ts` describes what a pilot experiences.
- Whatever is decided about the speed, it is decided on the record rather than
  left as a property of a search.

## Verify

```js
// node --experimental-strip-types <this file>
import { readFileSync } from 'node:fs';
import { Episode } from '../src/ai-training/scenario.ts';
import { brainFromFile } from '../src/ai-training/policy.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { defenceFight } from '../train/defence-fight.ts';

const B = new URL('../src/ai-training/brains/', import.meta.url);
const brain = brainFromFile(JSON.parse(
  readFileSync(new URL('jameson-defend-g2.json', B), 'utf8')));
const byHull = {};
for (const base of [8675309, 1234577]) {
  for (let e = 0; e < 60; e++) {
    const seed = base + e * 7919, f = defenceFight(seed);
    const ep = new Episode({
      seed, pirates: Array.from({ length: f.count }, () => ({ kind: 'scripted' })),
      trader: { kind: 'policy', brain }, traderArmed: true, traderClass: f.hull,
      traderLaser: f.laser, targetEnergyUnit: f.energyUnit, targetEcm: f.ecm,
    });
    const c = byHull[f.hull] ??= { n: 0, sum: 0, moving: 0 };
    while (!ep.done) {
      ep.step(FIXED_DT);
      c.n += 1; c.sum += ep.trader.speed; if (ep.trader.speed > 1) c.moving += 1;
    }
  }
}
for (const [h, c] of Object.entries(byHull)) {
  console.log(h, 'mean', (c.sum / c.n).toFixed(1), 'moving', (100 * c.moving / c.n).toFixed(1) + '%');
}
// 2026-08-04: playerCobra 10.6 / 10.9%   traderCobra 3.3 / 7.0%
//             playerCobraSlow 2.2 / 7.3%
```

`npm run ram-probe -- 40` says the same thing in its `evades` row: target mean
speed 5.
