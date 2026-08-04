# 84 — The probe's "on-six" column is 0.0s for every policy, by construction

**Kind:** training methodology · **Severity:** low · **Size:** small
**Depends on:** none

## Why

`train/flight-probe.ts` exists because no score in this project can see whether a
brain is a pilot or a turret, and its header names five signals:

>   speed / passes / range spread / **on-six** — time spent astern of the target
>   AND pointed at it, which is the manoeuvre that is actually threatening /
>   rams

and its footer says how to read them:

> a TURRET reads: low speed, few passes, a collapsed range spread, **low on-six**

Over 40 held-out episodes, all three policies:

| brain | speed | range p10/med/p90 | passes | **on-six** | rams |
| --- | --- | --- | --- | --- | --- |
| `scripted` | 234 | 180/547/921 | 4.42 | **0.0s** | 0.00 |
| `pirate-attack-g3` | 214 | 85/235/917 | 0.00 | **0.0s** | 0.20 |
| `pirate-pack-r4-selectonly` | 143 | 387/1435/2903 | 0.82 | **0.0s** | 0.70 |

The column cannot separate the attack run that ships from the standoff turret the
tool was written to catch, because it reads zero for both.

## What is actually failing

The fixture, not the measurement.

`onSix` is `Episode.tailTime`, and its condition is (`scenario.ts:962-967`):

```ts
const behind = this.trader.forward(this.tmp2).dot(dir) > 0.35;  // we are astern
const pointed = p.forward(this.tmp2).dot(dir) > 0.9;            // and lined up
```

`probeEpisode` flies `trader: { kind: 'holding' }` — which is right for
everything else in the table, and is Chris's own recorded envelope. But
`holdingTrader` steers at the nearest pirate on **every frame**, at the hull's
full turn rate:

```ts
const threat = this.nearestPirate();
if (threat) this.steerTrader(threat.pos, dt);
```

With one pirate, "the target's nose is 70 degrees or more off the attacker" is
never true for long enough to accumulate. `behind` is therefore false almost
always, and the product is zero.

**The shaping term itself is fine.** `fitnessAttack` pays `0.6 * tailTime[i]`,
and against the opponents the attack phase actually trains on it is a live
signal — 40 episodes on `evolve.ts`'s validation seeds, one attacker:

| pool opponent | `pirate-attack-g3` | scripted |
| --- | --- | --- |
| scripted hauler | 18.54s | 25.22s |
| runner/traderCobra | 18.62s | 24.53s |
| defend/playerCobra | 0.21s | 0.29s |
| holding/playerCobra | **0.02s** | **0.02s** |

So the reward discriminates (25.2 against 18.5 is a real gap and it is the right
way round), and the PROBE is measuring the one opponent in the set for which the
quantity is identically zero. That is why the column reads as if nothing has a
tail position, and why the trainer's own brain-picker line for `pirate-attack-g3`
still quotes "on your six 10%" from a fixture that no longer exists
(`brains.ts`'s generation table).

## What is NOT the problem

- **Not `tailTime`.** The geometry is right and the thresholds (0.35 astern, 0.9
  pointed) are reasonable.
- **Not `holding`.** It is the correct fixture for speed, passes, range spread
  and rams, which is four of the five columns, and it is the opponent that
  separates a pursuer from a turret on all four.
- **Not `SIX_CONE`.** That is the combat trainer's own tail measurement in
  `combat-sim-report.ts` and is a different (and better-instrumented) quantity;
  the probe does not use it.
- **Not a reason to change the fitness.** The term earns its place against the
  pool.

## What to work out

The column has to be measured against a target that presents a tail, and there
are two ways:

- **Print it for a second fixture.** `train/ram-probe.ts` already flies three
  target behaviours over the same episode shape, and `weaves` — flat out across
  the arena, indifferent to the pirates — presents a tail by construction. One
  extra row, or one extra column, and the number means something.
- **Drop the column from the `holding` table** and say in the footer that on-six
  is measured elsewhere. Honest, and cheaper than the first.

Either way the footer's "a TURRET reads: ... low on-six" has to stop being
printed under a table where every policy reads zero.

While in here: `brains.ts`'s `PIRATE_BRAIN` comment carries a five-column table
(speed / lined up / on your six / range / shots) from the deleted simulator, and
three of those five columns have no current tool that produces them. It is
provenance rather than behaviour and it is exactly what
`game/brain-names.ts`'s header says a description should not be.

## Watch out for

- **Do not make `holding` present a tail.** It is a model of how Chris flies and
  changing it moves four columns and the `evaluate` tables to fix one.
- **A `weaving` row is not free.** It changes the pirate's whole fight, so the
  passes and range figures in that row are not comparable with the `holding`
  row's; label them.

## Acceptance

- The on-six figure is printed against a fixture in which it can be non-zero, or
  it is not printed.
- No table's footer describes a column that is a constant in that table.

## Verify

```sh
npm run flight-probe -- 40
# 2026-08-04: on-six reads 0.0s for scripted, pirate-attack-g3 and
#             pirate-pack-r4-selectonly alike
```

The reward-side half of the table is the snippet used above: build an `Episode`
per `evolve.ts` pool entry, run it to `done`, and read `ep.tailTime[0]`.
