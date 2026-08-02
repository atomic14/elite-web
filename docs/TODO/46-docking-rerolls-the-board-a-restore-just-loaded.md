# 46 — Docking rerolls the board a restore just loaded

**Kind:** save integrity / exploit · **Severity:** high · **Size:** medium
**Depends on:** none

## Why

`Persistence.restore()` assigns `market` and `contractOffers` from the
snapshot (`src/game/persistence.ts:237-239`), then `enterMode('docked')` runs
`Station.dock`, which re-rolls both (`src/game/station.ts:188` and `:195`).

`src/game/snapshot.ts:198-204` states the opposite in so many words: a save
that dropped them *"would let you reload to reroll prices and contracts until
you liked them."* That is exactly what happens.

A generic capture → restore → re-capture diff isolates it:

```text
=== flight: 0 field(s) did not round-trip ===
=== docked: 2 field(s) did not round-trip ===
     market:         [... price 3.6 ...] -> [... price 4 ...]
     contractOffers: [bounty->55@662 ...] -> [courier->255@648 ...]
```

**The exploit is the combat trainer**, which restores through the same path
(`src/game/combat-sim.ts:688`) with a **player-chosen seed**
(`src/game/screens/combat-sim-setup.ts:404-410`). Enter the trainer, quit
after a second, and the station's contract board is different — and the next
checkpoint persists it. Measured across three exercise seeds, three different
boards. So contracts are rerollable on demand, and the room's promise that
"nothing that happens in here leaves it" is broken in the one direction nobody
checked.

`test/state.test.ts:83-89` passes because it greps `persistence.ts` for the
field NAME. The name is present on both sides; the value is clobbered
afterwards. See TODO 50 — that guard needs fixing too.

## Implementation

- A restore must win over the dock that follows it. Work out whether `dock`
  should not roll when it is re-entering a restored state, or whether restore
  should run after, or whether the roll belongs somewhere else entirely.
- Note `Station.dock` legitimately rolls when you actually arrive at a
  station. The two cases have to be told apart — and the distinction is
  probably "is this a new arrival or a resumed one", which is a fact the
  restore knows and the dock does not.
- The trainer's teardown goes through the same path; fixing the general case
  should close the exploit without a special case for the trainer. Confirm
  that rather than assuming it.

## Acceptance

- capture → restore → re-capture is byte-identical when docked, as it already
  is in flight.
- Entering and leaving the combat trainer leaves the market and the contract
  board exactly as they were, for any exercise seed.
- Actually arriving at a station still rolls a fresh board.
- A test asserts all three.

## Verify

`npm run check`, plus the round-trip diff above and a trainer excursion at
three different seeds.
