# 72 — The target cannot answer a missile

**Kind:** training fidelity · **Severity:** high · **Size:** large
**Depends on:** 62 (which created the gap by making missiles real), 71

## Why

docs/TODO/62 gave a training pirate its missiles back: it decides, the warhead
flies, the rack empties, and 250 of the commander's 765 pool points go with it.
Measured over 240 held-out defence fights, `jameson-defend-g1` fell from 99.2% of
her pools left to 90.1%, and six of those fights ended with her dead where none
ever had before.

**The commander in an episode has no answer to any of it.** In the game, an
incoming missile has exactly one counter and it is a button: E.C.M., a quarter of
the bank, every missile in the sky gone (`ordnance.ts`, `ECM_ENERGY_COST`). It is
the reason a hostile launch is capped at one in the air at a time gang-wide —
`WorldView.missileInbound` exists so that one press stays a complete answer, and
the comment there says so. A training target has no E.C.M. fitted, no output that
could press it, and no observation that would tell it there was anything to
press.

So the world a defence policy is now fitted in is one where missiles are
undodgeable. That is not the game. It is a *harder* game than the one the player
plays, which is the opposite failure to the one 62 fixed and just as wrong:
CLAUDE.md's principle is that training matches the real world, in both
directions.

Chris, 2026-08-03, is where this started — *"E.C.M. could be fitted for an
exercise but would do nothing in a training run"* — and 62 deliberately did not
answer it, because fitting the equipment without an action for it is theatre.

## What is actually failing

Three things, and only the first is small:

1. **No equipment.** `Episode`'s target is `TargetShip`, which carries
   `ShipSystems` and a hull id. It has no `CommanderData` and therefore no
   `equipment.ecm`. `Ordnance.triggerEcm` takes a `CommanderData` and reads
   `commander.equipment.ecm`.
2. **No action.** `policy.ts`'s head is `OUT_SIZE = 11`: pitch(3), roll(3),
   throttle(3), fire(2). There is no twelfth output and no fourth head. Adding
   one changes the shape of every network, which means **every shipped brain is
   invalidated and all three phases retrain** — not a fall-back, a rebuild.
3. **No observation.** `observe()` is fourteen numbers and none of them is "there
   is a missile coming". This is docs/TODO/71's finding in a second place: 71 is
   about the defender not seeing its own pools, and a policy that cannot see an
   inbound warhead cannot learn when to spend a quarter of its bank on one
   either. Whatever 71 does to the encoder, this wants the same treatment in the
   same pass — the two together are one observation change, not two.

## What is NOT the problem

- **Not `ordnance.ts`.** `triggerEcm` is already a pure-enough rule over a
  commander and an energy number, and 62 proved the module runs headlessly over
  an `OrdnanceWorld` with no scene. Nothing about the E.C.M. rule needs writing.
- **Not the pirates' E.C.M.** `NpcState.hasEcm` is rolled at spawn and already
  works: `Ordnance.step` checks it for missiles homing on a SHIP. It is
  unreachable in an episode only because nothing there launches at a ship.
- **Not the cap.** One missile in the air at a time is the right rule and it
  becomes *more* right once the counter exists, not less.

## What to work out

- **Whether E.C.M. is an ACTION or a REFLEX.** A twelfth output is the honest
  version and it costs three retrains. The cheap version is a scripted reflex —
  the target fires E.C.M. whenever one is inbound and the bank can afford it —
  which needs no head change, models a competent human almost exactly, and can
  ship first. Decide which, and say why in `scenario.ts`.
- **What the fit-out record says.** `EpisodeSetup.target` already carries the
  laser and the energy unit because both change how a fight goes. E.C.M. belongs
  beside them, and `EPISODE_SCHEMA` moves again when it lands: an episode with a
  counter in it is not the same measurement as one without.
- **What it does to `defence-fight.ts`.** The defence distribution rolls hull,
  laser, count and energy unit. E.C.M. is another axis, and docs/TODO/65's
  finding — that the selection metric is blind to an axis the distribution
  spreads over — is the trap to avoid repeating.
- **Whether the pirates should then be allowed more than one in the air.** They
  are capped because the player only gets one press. If the target can press it,
  the cap is a balance lever rather than a fairness one.

## Watch out for

- **65 and 71 come first, or this measures nothing.** A defender is currently
  selected on pools-left, where 1% is worth 10 points and a kill is worth 3
  (docs/TODO/65). Adding a button that saves 250 pool points to a search that
  already rewards never being hit will produce a policy that hides and presses
  it, and the measurement will call that an improvement.
- **A twelfth output invalidates all three brains at once**, not just the
  defender: `OUT_SIZE` is shared. That is a retrain of attack, pack and defend in
  one sitting, and the pack phase is blocked on docs/TODO/70.
- **Fly it before tuning it.** CLAUDE.md: threat is not fun. A gang that cannot
  land a missile is a gang whose most dangerous weapon is decorative.

## Acceptance

- A training target with E.C.M. fitted destroys an inbound warhead, and one
  without it does not — asserted, on the same seed.
- The fit-out is in `EpisodeSetup` and `EPISODE_SCHEMA` says the record changed.
- A stated decision, in `scenario.ts`, on action-versus-reflex and on the
  one-in-the-air cap.
- `npm run defence-probe` re-run: the drop 62 measured (99.2% -> 90.1%, 0 -> 6
  deaths in 240) should come back part of the way, and how far is the number
  worth having.

## Verify

Two episodes on one seed, identical but for the E.C.M., and the one with it takes
250 fewer pool points. Then `npm run defence-probe` and `npm run survivability`,
which is the same claim from the commander's side — 62 moved it from 0%
destroyed at every gang size to 1-4%, and a pack of four killing her in 8.3
seconds is Chris's real 9.1-second death showing up in the trainer for the first
time.
