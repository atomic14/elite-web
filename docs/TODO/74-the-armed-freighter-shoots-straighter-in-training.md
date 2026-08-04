# 74 — An armed freighter shoots 51% straighter in training than in the game

**Kind:** training fidelity · **Severity:** medium · **Size:** small
**Depends on:** none · found while doing 64 · same family as 62, 63, 64 and 73

## Why

docs/TODO/64 closed the resolution half of invariant 15: `world-step.ts` and
`ai-training/scenario.ts` both call `game/fire-resolution.ts` now, so an NPC's
`FireEvent` costs the same wherever it is resolved. Its own Why section says the
list of divergences was never known to be complete, and finishing it turned up
this one — **pointing the other way**, which is why it was not in the table.

The direction 64 covers is *an NPC fired*. The direction it does not is *the
episode's TARGET fired*, which is `Episode.fireTraderGun`. When the target stands
in for an armed freighter (`traderCobra`, `gun: 'npc'`) it composes the shot
itself:

```ts
const reload = npcTriggerPull(t.laserCooldown, angle, dist, random);   // the game's gate ✓
...
if (random() >= npcHitChance(dist)) return miss;                       // THE RANGE CURVE
const damage = npcCrossfireDamage(TRADER_WEAPON_BYTE, threat.npc.energyPolicy);  // ✓
```

In the game, an armed trader IS an `NpcShip`, so its shot at a pirate is a
`FireEvent` with `at: NpcShip`, and the crossfire branch rolls **the flat
`NPC_VS_NPC_HIT`**, not the range curve. Two rules for one shot:

| range | the episode's armed freighter | the game's armed freighter |
| --- | --- | --- |
| 200 | 0.843 | 0.500 |
| 420 | 0.780 | 0.500 |
| 800 | 0.671 | 0.500 |
| 1,500 | 0.471 | 0.500 |
| 2,450 | 0.200 | 0.500 |
| 3,000 | 0.150 | 0.500 |

They cross at about 2,450 units, and **a fight is not fought there**. Measured
over 40 episodes apiece, three scripted pirates against an armed `traderCobra`:

| target pilot | shots | hits | accuracy | median engagement range |
| --- | --- | --- | --- | --- |
| `holding` | 284 | 214 | **0.754** | 390 |
| `weaving` | 22 | 17 | **0.773** | 165 |

So the trainer's armed freighter lands about **51% more of its shots** than the
game's would, everywhere a dogfight actually happens.

## Why it matters, and to what

It is an input to two fitness functions and one held-out table:

- `fitnessDefend` pays `4 × dealt` and `3 × killedPirates`, both of which this
  inflates directly.
- `fitnessPack` pays for damage and pressure on a target that is shooting back
  harder than it would in the sky, so a pack genome is fitted against an
  opponent the game does not field.
- `npm run defence-probe` and docs/TODO/65's tables read the same numbers.

It does NOT touch the commander. `playerCobra`/`playerCobraSlow` targets carry
`gun: 'player'` and fire the commander's own laser through `canFire`,
`chargeShot`, `hitCone` and `takeLaserHit` — deterministic, no dice, and stated
as such. This is the freighter row only.

## What to work out

- **Which rule is right**, and it is not obvious. A flat coin flip for
  NPC-vs-NPC is Harmless's own (`NPC_VS_NPC_HIT`'s comment says so: *"a coin
  flip, and Harmless's"*), chosen because crossfire is scenery a player watches
  rather than a fight they are in. But an armed freighter defending itself in a
  training episode is not scenery — it is the genome. It may be that the GAME's
  rule is the one to change, in which case this is a balance decision about the
  sky and not a trainer fix.
- **Whether the target can go through the resolver at all.** `resolveNpcFire`
  takes an `NpcShip` shooter — it reads `weaponByte`, `object.position` and the
  rack — and the episode's target is a `TargetShip`. Closing this by calling the
  resolver would mean a shooter seam as well as a `FireWorld`, which is a bigger
  change than the numbers justify on their own. The cheap honest version is for
  the freighter branch to roll the same flat chance the crossfire branch rolls,
  from the same constant.
- **What it does to the shipped defender.** `jameson-defend-g1` fires 232 shots
  an episode (docs/TRAINING-LOG.md, 2026-08-04); a third of its registered hits
  would stop registering.

## Watch out for

- **This changes the world, so it invalidates comparisons** — invariant 5. Every
  `dealt` and `kills` figure for a defence or pack run predates it.
- **`random()` count is unchanged either way**: one roll per shot, before and
  after. So a seed still replays, and the shift is a threshold rather than a
  reordering — the same shape as the range fix in 64.
- **Do not "fix" it by giving the game's crossfire the range curve** without
  saying so out loud. That is a live-combat balance change affecting every
  police ship, every bounty hunter and every pirate preying on a trader, and it
  belongs in docs/GAP-ANALYSIS.md if it happens.

## Acceptance

- One rule for "an armed freighter shot a pirate", read from one place by both
  worlds, with a stated decision about which rule it is.
- The accuracy table above re-measured, and docs/TRAINING-LOG.md saying which
  figures it makes incomparable.
- `npm test`, `npm run elite-a`, `npm run campaign` and `npm run portability`
  unmoved.

## Verify

The table at the top is the measurement. Run 40 episodes of three scripted
pirates against an armed `traderCobra` for each of `holding` and `weaving`, count
the `ShotEvent`s whose `from` is the target, and compare the hit rate with
`NPC_VS_NPC_HIT`. 0.754 against 0.500 is the whole finding.
