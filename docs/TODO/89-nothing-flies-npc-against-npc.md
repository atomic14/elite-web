# 89 — Nothing flies an NPC at another NPC in the live world

**Kind:** test gap · **Severity:** high · **Size:** medium
**Depends on:** none · found while doing 76 · **read this before doing 74**

## Why

Half the sky's combat is NPC against NPC. Police hunt pirates, pirates prey on
traders, bounty hunters help out, and an armed trader turns and fights with the
defence policy. `assignNpcTargets` exists to set all of it up and
`world-step.ts` runs it every two seconds.

**No test flies any of it.** The two files that mention `npcTarget` test
something else:

- `test/npc.test.ts:220-290` tests `assignNpcTargets` — the RULE about who picks
  whom — against fabricated objects (`{ id, role, state: { alive: true },
  npcTarget: null } as unknown as ...`). There is no ship, no position that
  moves, no gun and no damage. It is a good test of the targeting rule and it
  asserts nothing about a fight.
- `test/world.test.ts:200-217` asserts an `npcTarget` pointer survives a
  snapshot round-trip.

Every combat fixture in the suite that actually FLIES goes through `Episode`,
whose fleet is pirates only and whose target is passed as `'player'`. So a
training episode never has an NPC target in its fleet either.

## What is actually failing

Nothing is known to be broken. What is missing is any way to find out.

**docs/TODO/76 is the proof.** It changed `matePositions` so a ship no longer
treats the ship it is attacking as an obstacle to steer around. That is a
behaviour change to police-on-pirate and pirate-on-trader flight in the live
sky, measured at 13.3 and 11.0 ram contacts per engagement where there had been
5 and 0 in 160. **It moved zero assertions** — the campaign is byte-identical
(it does not simulate NPC dogfights), `npm test` is byte-identical, and
`train/ram-probe.ts` is byte-identical because an `Episode` cannot express the
situation. The change is right and it is argued in the file, but it is now
behaviour with no gate on it.

## Why this is urgent for docs/TODO/74

74 is a decision, and Chris has made it: the game's NPC-vs-NPC crossfire adopts
the range curve instead of the flat `NPC_VS_NPC_HIT` coin flip. That changes the
hit chance of every police ship, every bounty hunter and every pirate preying on
a trader — from 0.500 flat to 0.843 at 200 units and 0.150 at 3,000.

**There is currently nothing that would notice.** `fire-resolution.test.ts`
asserts the crossfire branch's rate over 10,000 rolls, which is a unit test of
the constant and will simply be re-baselined. No test says what a police ship
does to a pirate over a fight.

Doing 89 first means 74 lands against something that can see it. Doing 74 first
means the sky's crossfire changes and the only evidence either way is a number
in a doc.

## What is NOT the problem

- **Not `assignNpcTargets`'s test.** It is a proper test of a pure rule and its
  fabricated objects are the right shape for what it asserts. It is just not a
  test of combat.
- **Not the campaign harness.** It measures a trading career's economics over 40
  commanders and it should not grow a dogfight.
- **Not `Episode`.** The trainer's job is to fit a policy against a target, and
  `'player'` is the right target for that. Widening it to hold an `NpcShip`
  target is a much bigger change (see 74's "whether the target can go through
  the resolver at all") and is not what this item asks for.

## What to work out

A fixture that stands up a real `World`, spawns two hostile NPCs, runs the real
`WorldStep` for a few seconds and asserts something that would break. The
material is all there — 76's `test/separation.test.ts` already flies real
`NpcShip`s at each other, and `test/missile-cap.test.ts` already drives a real
`WorldStep` with a stub `StepHost`.

Properties worth pinning, roughly in order of how much they would hurt if they
silently stopped being true:

- **A police ship engaging a pirate actually damages it**, and the pirate dies
  in a bounded time. This is the end-to-end assertion 74 needs.
- **The crossfire hit rule is the one the sky uses** — asserted through a fight
  rather than by re-reading the constant, so a change to it shows up as a
  changed outcome and not only as a changed number.
- **A ship whose quarry dies stops shooting at where it was**, which is the
  targeting rule and the flight agreeing.
- **An armed trader turns and fights** rather than only running, which is the
  live half of what docs/TODO/86 is about and is also untested.

## Watch out for

- **This is the fixture that will be reached for again**, so it is worth putting
  somewhere findable and giving it a header that says what it is for. Several
  open items want it: 74 needs the crossfire outcome, 86 needs the armed trader
  flown, 88 needs the readout for a trader that is fighting.
- **Seed it and keep it short.** A multi-ship fight over thousands of frames is
  a slow test and a flaky one; the assertions above are reachable in seconds of
  simulated time.
- **Do not assert on exact damage totals.** They will move whenever a combat
  number moves, which is often, and a test nobody can re-baseline confidently
  gets deleted. Assert the property — it was damaged, it died, it stopped.

## Acceptance

- A test exists that flies at least two hostile NPCs against each other through
  the real `WorldStep` and asserts an outcome.
- Reverting docs/TODO/76's `matePositions` change fails something, OR the item
  says plainly why that particular change is not worth a gate.
- Changing `NPC_VS_NPC_HIT` (or whatever 74 replaces it with) fails something
  other than the test that restates the constant.

## Verify

```sh
grep -rln "npcTarget\|assignNpcTargets" test/
# 2026-08-04: test/npc.test.ts, test/world.test.ts — and neither flies a fight.
```

The 76 half: revert the `m === this.npcTarget` clause in `npc.ts`'s
`matePositions` and run `npm test`, `npm run campaign`, `npm run elite-a` and
`npm run portability`. On 2026-08-04 all four were unmoved by it.
