# 70 — The pack's kill bonus can no longer be earned

**Kind:** training methodology · **Severity:** high · **Size:** medium
**Depends on:** none, but read 63 first (it caused this) and 62 before deciding

## Why

Found while doing item 63, which gave a training episode's target the same
`regenerate` the game runs for the commander. It fixed the world and it left one
consequence open, and this is it.

Three `pirate-pack-r4-selectonly` against the armed scripted trader, 60 held-out
episodes (base 10,000,019, stride 7,919, `maxTime` 60), either side of that
change:

| | kills | mean t | pool points taken | shots |
| --- | --- | --- | --- | --- |
| before (damage was permanent) | **21 / 60** | 56.6s | 409.2 | 75.8 |
| after (the game's own recovery) | **0 / 60** | 60.0s | 442.2 | 80.0 |

They shoot slightly more, land slightly more, and never kill her. `fitnessPack`
pays `killed ? 12 + 5 * (1 - t/maxTime) : 0`, so that term is now **0.00 on
every episode**, and it was not a garnish:

```
before   fitnessPack 8.86  = damage 2.66  pressure 0.29  KILL 4.48  alive 1.50  taken -0.06
after    fitnessPack 4.61  = damage 2.88  pressure 0.29  KILL 0.00  alive 1.50  taken -0.06
```

**The kill bonus was 51% of the shipped pack policy's fitness.** What is left is
a damage term of 2.88 and a pressure term of 0.29 — the search now hill-climbs
on a quantity a third the size, with its largest and most decisive component
constant at zero for every genome in the population.

## What is actually failing

Nothing is broken. A term is unearnable, and the fitness still pays for it.

The arithmetic says it is unearnable by construction rather than by bad luck. A
Cobra Mk III recovers **6.4 energy points a second**, plus **8.9 a second per
damaged shield face** while the bank is above `LOW_ENERGY` — so 15.3/s with one
face down and 24.2/s with both. Three pirates delivered 442 points over 60
seconds: **7.4 points a second.** They are outhealed roughly two to one at every
state that matters.

Below `LOW_ENERGY` the shields stop and recovery drops to 6.4/s, which is under
their 7.4 — so a kill is arithmetically available *from* that state. It is not
reachable: getting there means winning a 7.4-against-15.3 race first.

**So a longer `maxTime` cannot help.** This is an equilibrium, not a clock. That
is the one option to rule out before spending anything on the others.

## What is NOT the problem

- **Not the selection metric.** `outcomeOf` for `pack` is
  `targetDamageShare()`, which 63 made cumulative (`trader.damageTaken /
  maxPool`) — it is unaffected by recovery and still ranks genomes cleanly. This
  is the opposite situation to docs/TODO/65, where the outcome is the broken
  part; here the outcome is fine and a fitness term is dead.
- **Not the other four terms.** Damage, pressure, survivors and self-damage all
  survive the change and read within noise of what they read before.
- **Not the regeneration.** Do not turn it back off. It is what the game does,
  and docs/TRAINING-LOG.md's own note says regeneration is what makes the real
  game's gang fights survivable.
- **Not `pirate-pack-r4-selectonly` itself.** It is unchanged and its damage
  output went *up*. Nothing about the shipped policy got worse; the reward it was
  fitted against stopped being reachable.

## What to work out

Four honest options, and they are not mutually exclusive:

- **Wait for item 62.** Missiles do not exist in training, and in the three
  fights Chris recorded they were 45%, 48% and 94% of the incoming damage. A
  gang that can launch is a gang whose throughput roughly doubles, which is
  exactly the gap between 7.4 and 15.3. **62 may restore this term on its own,
  and re-weighting the fitness before it lands risks tuning against a world that
  is about to change.** This is the reason to frame rather than fix.
- **A harder target.** The armed scripted trader is a predictable hauler.
  `holding` — the knife-fighter — is in the attack pool and not the pack one.
  Decide whether "can this gang kill a commander who is *trying* to die" is even
  the question the pack phase should be asking.
- **Re-weight, deliberately and on the record.** If a kill genuinely cannot
  happen, paying 12-17 points for one is paying for a lottery nobody can enter,
  and the honest fix is to drop the term and rescale the survivors — with the
  ratio stated rather than inherited, which is the same complaint docs/TODO/65
  makes about `evolve.ts`'s 1000x.
- **Accept the finding as the answer.** "Three pirates cannot kill a regenerating
  Cobra Mk III inside a minute" may simply be true of this game, in which case
  the pack phase should be optimising pressure and damage and should say so in
  its comment. That is a design decision and it is Chris's.

## Watch out for

- **This blocks a meaningful pack retrain.** Anything trained today is fitted
  against a reward whose dominant term is a constant. If a pack retrain is
  wanted for another reason, this item comes first.
- **Do not compare a new pack number with an old one.** Every pack figure in
  docs/TRAINING-LOG.md before 2026-08-04 was measured against a target that never
  healed — the entry for 63 says so.
- **`maxTime` is 60 for pack and 45 everywhere else**, and it is set in two
  places (`makeEpisodeFor` and `scriptedReference`). If it is touched at all, it
  is touched in both, and the ruling-out above says it should not be touched to
  fix this.
- **CLAUDE.md: threat is not fun.** A change that makes gangs lethal enough to
  earn the bonus is a change to how the game plays. Fly it before shipping it —
  `T` at any station, a gang scenario — not just measure it.

## Acceptance

- A stated decision, in `scenario.ts`'s `fitnessPack` comment and in
  docs/TRAINING-LOG.md, about whether a pack kill is a thing the fitness pays
  for; if it is, a measurement showing a genome can actually earn it.
- If the term stays, the ratio between it and the damage/pressure terms is
  stated deliberately rather than inherited from round 3.
- A pack retrain whose champion is chosen on a reward with no constant term in
  it, judged against `pirate-pack-r4-selectonly` on held-out seeds.

## Verify

This is the measurement the table above came from:

```js
// node --experimental-strip-types <this file>   — from the repo root
import { readFileSync } from 'node:fs';
const { Episode } = await import('../src/ai-training/scenario.ts');
const { brainFromFile } = await import('../src/ai-training/policy.ts');
const { FIXED_DT } = await import('../src/game/world-step.ts');
const B = new URL('../src/ai-training/brains/', import.meta.url);
const pack = brainFromFile(JSON.parse(
  readFileSync(new URL('pirate-pack-r4-selectonly.json', B), 'utf8')));
let fit = 0, kill = 0, kills = 0, t = 0;
for (let e = 0; e < 60; e++) {
  const ep = new Episode({
    seed: 10000019 + e * 7919,
    pirates: [0, 1, 2].map(() => ({ kind: 'policy', brain: pack })),
    trader: { kind: 'scripted' }, traderArmed: true, maxTime: 60,
  });
  while (!ep.done) ep.step(FIXED_DT);
  const killed = !ep.trader.alive;
  fit += ep.fitnessPack();
  kill += killed ? 12 + 5 * (1 - ep.t / 60) : 0;   // the term under test
  if (killed) kills += 1;
  t += ep.t;
}
console.log({ fitnessPack: fit / 60, killTerm: kill / 60, kills, meanT: t / 60 });
// 2026-08-04, shipped pack: { fitnessPack: 4.61, killTerm: 0, kills: 0, meanT: 59.96 }
```

`npm run survivability` is the same claim from the commander's side: 0%
destroyed at every gang size from one to four, where three used to kill her 5%
of the time and four 9%.
