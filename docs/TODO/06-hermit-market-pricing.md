# 06 — Hermit market pricing lives in the orchestrator

**Kind:** wrong abstraction · **Severity:** medium (CLAUDE.md invariant 10) ·
**Size:** small

## What is wrong

Hermit market pricing is an economic rule, and invariant 10 puts economic rules in
`contracts.ts` / `shop.ts` so the headless campaign runs the same code the game
does. It is instead inlined in `game.ts` as bare commodity indices and
multipliers.

Two costs. The campaign cannot price hermit trade, so a balance change to it is
unmeasured. And `i === 12 || i === 13 || i === 14 || i === 15` requires the reader
to know the commodity table by index — the rule is unreadable where it sits.

## Evidence (read at `de9a668`)

`src/game/game.ts:1371-1381`, in `openHermitTrade`:

```ts
this.hermitMarket = generateMarket(this.system, randomInt(256))
  .map((m, i) => {
    // miners are flush with ore and pay over the odds for supplies
    if (i === 12 || i === 13 || i === 14 || i === 15) {
      return { ...m, quantity: m.quantity + 20, price: +(m.price * 0.75).toFixed(1) };
    }
    if (i === 0 || i === 4 || i === 8) return { ...m, price: +(m.price * 1.3).toFixed(1) };
    return m;
  });
```

## The fix

Move it to a named function beside the other price rules — `hermitMarket(system,
seed)` in `shop.ts` (prices) or `contracts.ts`, whichever already owns
`generateMarket`'s output shape. In its new home the indices become commodity
names, and the two multipliers get one docstring saying what the hermit economy
is meant to feel like.

`game.ts` then keeps only: call it, store it, open the screen.

Once it is a function the campaign can reach, consider whether
`npm run campaign` should exercise a hermit leg. Not required by this fix, but it
is the whole reason the rule is being moved.

## Verify

- `npm run lint && npm test`
- `npm run campaign` — required after touching prices. Compare against a run
  before the change; the numbers should be unchanged, because this is a move.
- Fly it: find a hermit and confirm ore is still cheap and supplies still dear.
  `test/playtest.js` drives `openHermitTrade()` by name (`game.ts:1370` marks it
  `@internal — driven by test/playtest.js`), so keep the method and its name.
