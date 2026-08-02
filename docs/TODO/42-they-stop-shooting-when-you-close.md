# 42 — They stop shooting when you get close

**Kind:** combat bug · **Severity:** critical · **Size:** small
**Depends on:** none

## Why

Chris, playtesting: *"it feels almost like they stop shooting when they get
close."* They do.

Measured — a police ship held nose-on to a stationary commander, shots in 20
seconds by range:

```text
range :   120  180  210  240  300  500  900 1500 2500 3400
police:     0    0    0   16   16   16   16   16   16   16
```

Zero inside 220, sixteen from 240 out. The cause is one rule with two homes,
which is this project's named bug class:

- `game/brains.ts` has `RAM_GUARD_NO_RAM = 150`, with a comment explaining at
  length that it was lowered from 220 *precisely because* the wide guard
  switched a ship's guns off at the range a human fights at — Chris's recorded
  median engagement is 260 and his 10th percentile 214, and "three tier-1
  ships managed ZERO shots in 33 seconds."
- `game/npc.ts`'s `attack()` opens with a hardcoded `if (dist < 220) { …
  return null; }`. It never got the fix.

So the correction reached the brain hand-over point and not the gun. The
effect:

- **Brain-flying pirates** fire down to 150 (through `brainFly`), then nothing.
- **Everything else that fights** — police, bounty hunters, Thargoids, and any
  pirate whose brain did not load — goes silent inside **220**, because
  `attack()` is the path they all fire on.

It also lands on the new wave ramp: wave 16's bounty hunter and wave 18's
Thargoids both fly `attack()`, so they stop shooting the moment the player
closes.

Note the code already knows this path matters. The comment above the
`npcTriggerPull` call in `attack()` says it is "the path every police ship,
bounty hunter, thargoid and knife-range pirate actually fires on", and
records a previous bug where this path had drifted from the brain's gun.
This is the same drift again, one line higher.

## The design question inside the bug

Breaking off before a ram is right. **Holding fire while breaking off is a
separate decision**, and nothing argues for it — a ship turning away that has
the commander in its gate should still be able to shoot. The two behaviours
are currently one `return null`.

So the fix is probably not "change 220 to 150". It is:

- **One home for the break-off distance**, named, shared by `attack()` and
  `brains.ts` rather than a literal in one and a constant in the other.
- **Separate steering from firing.** A ship inside the break-off distance
  steers away AND still runs `npcTriggerPull`, which already applies the gate,
  the range and the cooldown.

Decide whether a breaking-off ship should fire, and say why. If it should not,
then the two constants still have to agree and the value has to clear the
range a human actually fights at.

## Acceptance

- The measurement above shows shots at every range a fight happens at, for
  every hostile role — not just from 240 out.
- The break-off distance has ONE home; a test fails if a second appears.
- Whatever the rule becomes, it is the same for a pirate, a police ship, a
  bounty hunter and a Thargoid, or the difference is stated and deliberate.
- Ships still break off rather than ramming: the collision rate must not climb.
  Check it against `train/flight-probe.ts`'s rams-per-episode column, which is
  the number that caught this class of change before.
- `npm run campaign` and the `ai.test.ts` gates are reported before and after.
  This changes how much damage NPCs do, so movement is expected — do not tune
  it away, report it.

## Verify

`npm run check`, the range-band measurement above rerun for pirate, police,
hunter and Thargoid, `train/flight-probe.ts` for the ram rate, then a human
fight at knife range.
