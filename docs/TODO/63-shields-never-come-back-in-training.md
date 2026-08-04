# 63 — A training target's shields never come back

**Kind:** training fidelity · **Severity:** high · **Size:** small
**Depends on:** none

## Why

Found while answering item 62, and it may be the more consequential of the two.

`PlayerTarget.fly()` in `src/ai-training/scenario.ts` runs this, and says so:

```ts
this.ship.update(dt, demand);
// the gun's half of systems.ts `regenerate` — the only half a target has
this.laserCooldown -= dt;
this.laserTemp = Math.max(0, this.laserTemp - LASER_COOL_RATE * dt);
```

The game runs `systems.ts`'s `regenerate()`, which does that AND recharges
energy every tick, AND brings both shields back once energy is out of its last
bank. The comment calls the omission "the only half a target has", which is a
statement about the code rather than about the world: nothing stops a target
having the other half.

**So every defence policy has been fitted in a world where damage is
permanent.** A commander in a real fight loses a shield face on a pass and gets
it back before the next one — `energyLow` is the console light that says when.
In an episode the damage only accumulates, so the only strategy that survives is
to never be hit at all.

That is a very good description of the brain we shipped. CLAUDE.md, written
before anyone knew why: *"the defence policy evades superbly and shoots
badly"*. Shooting means holding a line, holding a line means taking hits, and
taking hits was made irreversible by the trainer rather than by the game.

## What is NOT the problem

- **Not the fitness.** `fitnessDefend` pays for the pools that are left, which
  is the right thing to pay for. It is the world underneath that is wrong.
- **Not the NPC side.** `p.npc.regenerate(dt)` is already called for every
  pirate, deliberately, with a comment explaining the debt. This is the same
  debt on the other ship.

## What to work out

- **Call the real rule.** `regenerate(sys, dt, { shipId, energyUnit })` is pure
  and already imported by the game. The target holds a `ShipSystems`, so this
  should be close to a one-line change — confirm the carry fields
  (`energyCarry`, `foreShieldCarry`) are on the episode's target and are
  snapshotted the way the game's are.
- **Whether the energy unit is part of the fit-out.** `regenerate` takes it, and
  it changes the recovery rate. It belongs with the laser choice added for the
  combat-computer fit-out rather than being hardcoded.
- **What it does to the balance figures.** Every defence and evade number in
  docs/TRAINING-LOG.md was measured without regeneration. They do not become
  wrong, they become incomparable — say so in the log rather than silently
  re-baselining.

## Watch out for

- **It makes episodes longer.** A target that heals survives more, so
  `maxTime` may need revisiting or the fitness will reward stalling.
- **It may make the escape term dominant.** If a defender can outlast anything,
  `escaped` and the clock become the whole game. Check `fitnessDefend` still
  discriminates after the change.
- **Retrain deliberately** (invariant 5), and expect the shipped defence policy
  to be beaten by something less evasive — that is the point.

## Acceptance

- A target in an episode recovers energy, and recovers shields once energy is
  above `energyLow`, by exactly `systems.ts`'s rule and no other.
- A test flies a target, damages it, and asserts its pools at t+10s match what
  the game's `regenerate` produces for the same inputs.
- The defence phase is retrained and the log records that its numbers are on a
  new baseline.

## Verify

`npm run train -- defend --gens 20` and read the champion's pools-left: it
should be materially higher than the ~82% the pre-change policies score, because
the metric now includes recovery. Then fly it: `T` at any station, fit the
combat computer, and press `K`.

## Done, 2026-08-04 — and two things it left open

The change is in, the log has the new baseline, and the defence phase was
retrained twice at run 19's budget. **Neither candidate shipped**: both validated
at 99.8-99.9% of her pools left and both were worse than `jameson-defend-g1` on
held-out seeds — more damage taken, 2.4x and 8x less dealt, 41 and 13 shots an
episode against 234. That is docs/TODO/65's arithmetic, measured in the new
world; the table is appended to that item.

Two consequences are NOT closed here, and each has its own file rather than a
paragraph in an index:

- **docs/TODO/70** — a gang of three killed the armed scripted trader in 21 of 60
  episodes before this change and 0 of 60 after, so `fitnessPack`'s kill bonus is
  a constant zero. It was 51% of the shipped pack policy's fitness, and it blocks
  a meaningful pack retrain.
- **docs/TODO/71** — `observe()` is fourteen numbers and the defender's own health
  is not one of them. Recovery is now real and no policy can perceive it, which is
  why the kill rate was identical to the decimal either side of this change.

The attack phase needed nothing: `targetDamageShare()` became cumulative
(`trader.damageTaken / maxPool`, the same question `pirateDamageShare` has always
asked of a pirate) and a solo attack episode is bit-identical either side.
