# 68 — A vocabulary of tactics, not one behaviour

**Kind:** combat feel / design · **Severity:** medium · **Size:** large
**Depends on:** 66, 67 (the one tactic we have should be right first)

## Why

Chris, 2026-08-03, after the attack run shipped: *"we should think of these
scripted behaviours as different strategies that an NPC can pick from randomly.
We now have a quite good - run at the enemy, fly past and turn, we can have
other strategies. What might be interesting is that an NPC could switch
strategies if it is getting damaged."*

Every hostile in the game now flies ONE pattern. It is a good pattern and it is
learnable — which is the problem a vocabulary solves.

He also named the two failure modes to design against, and both are real: a ship
that hangs far out sniping ("probably a really good approach for someone who is
really good at aiming like an AI, but annoying to play against if you are a
human"), and one that hangs very close and pivots. The second is what
`pirate-attack-g3` does — median range 240, 0.00 passes — so it is not
hypothetical.

## Where the code is

- `src/game/break-off.ts` — the one tactic that exists, as a worked example of
  what a tactic module looks like: constants with their arithmetic, a pure phase
  function, and `describeFlight` which names it for the record.
- `src/game/npc.ts` — `attack()` flies it; `NpcState` is where a `tactic` field
  goes and is walked generically by `snapshot.ts`, so it saves for free.
- `src/game/separation.ts` — the newest rule, and the smallest complete example
  of adding one.
- `src/game/ship-specs.ts` — `turnRate` and `maxSpeed` per hull, which is what a
  capability gate reads. `TURN` there converts to pitch/roll.
- `src/game/rng.ts` — the ONLY source of chance. `Math.random` is banned in
  world code and `npm test` enforces it.

## The shape

A tactic is a choice of four things: where to aim, what throttle, when to shoot,
when to quit. The attack run already is one; it just is not named as such.
Making it explicit costs one state field and one pure function:

```ts
NpcState.tactic: TacticId                       // rolled at spawn, re-rolled on a trigger
chooseTactic(hull, health, reason, roll): TacticId    // pure, testable
```

Same bargain as `extendRange`: state so it snapshots for free, `rng.ts` so it is
seeded and replayable.

**Gate each tactic on whether the hull can fly it.** The Python making 0 passes
in Chris's wave-9 record is exactly this failure — at 0.49 rad/s it needs 1,026
units to reverse, so the attack run was never available to it and it defaulted
to loitering at 739 units doing nothing. Offer a hull only what its turn rate
and top speed can actually execute.

## The candidates

Cheap — aim point and throttle only:

- **Slash** — breaks at 400 rather than 220, never merges. For fragile hulls
  that cannot afford the commitment.
- **Lag pursuit** — aim behind the target's motion and cut the corner. The
  counter to a hard-breaking player. Only worth giving to the six hulls that
  out-pitch the commander's 1.45 rad/s: Constrictor 1.68, Fer-de-Lance /
  Sidewinder / Bushmaster 1.54, Mamba / Ophidian 1.47.
- **Standoff** — the degenerate one, made deliberate and rare, and only for
  heavy hulls. Never more than one ship in a gang, and it must be punishable.
- **Disengage and heal** — below a hull fraction, break contact properly and
  come back. Makes finishing a kill matter.
- **Committed ram** — a doomed ship aiming to collide. Turns an event that
  currently reads as a bug into a story.

Medium:

- **Scissors** — a rolling turn that bleeds speed and forces a pursuer past.
  The most interesting for feel, because it only appears when the player has
  earned the position, and beating it means throttling back.
- **Missile boat** — ordnance at range rather than guns, deliberately and for
  one ship. Gives E.C.M. something to do at a range the player can react at,
  which the knife-range launches do not.

Expensive — needs fleet coordination:

- **Pincer** — ships time their merges so one is always in your face while
  another comes from behind. `packOffset` is a crude static version.
- **Blocking** — get between the player and the station. Denies the escape
  rather than the kill.

## Switching

Damage is the trigger Chris named and `NpcState.underFire` already exists,
though today it only interrupts an extend. The useful set:

- took a hit; hull below a threshold; a wingman died; the target is running;
- **no shot for N seconds** — the sleeper. "This is not working, try something
  else" is a general anti-degeneracy rule, and it is what would have stopped the
  Python loitering for 22 seconds.

## Watch out for

- **`npc.ts` is 1,276 lines and already a stated debt.** None of this goes
  there; `break-off.ts` is the precedent for a tactic owning its own file.
- **Instrument first — and it is done.** `describeFlight` and the trainer's
  SPENT ITS TIME column already report what each ship is doing, live and in the
  record. A `tactic` name drops into the same string.
- **The brains only fly the last 150 units.** A shipped policy hands over at
  `BRAIN_HANDOVER_RANGE`, so tactics govern scripted ships and everyone else's
  knife range. Since `d563e3d` that is every pirate, but the handover is worth
  revisiting if this is where the interesting behaviour goes.
- **Threat is not fun** (CLAUDE.md). Every tactic is judged by flying it, not by
  its damage numbers.

## Acceptance

- At least three tactics, chosen per ship from `rng.ts`, snapshotted, and
  visible by name in the trainer's per-ship column.
- A hull is never offered a tactic it cannot physically execute, and a test
  asserts that for the slowest hull in the roster.
- At least one switching trigger fires on damage.
- `npm run campaign` unmoved — this is a feel change, not a balance one.

## Verify

Fly it. Then read the SPENT ITS TIME column: a fight should show different ships
doing different things, and the same ship changing its mind after being hit.
