# 51 — The market estimate lies, and the price model has three homes

**Kind:** economy / duplicated rule · **Severity:** medium · **Size:** medium
**Depends on:** none

## Why

The MARKET ESTIMATE screen transcribes the 1984 price model instead of asking
`galaxy.ts` for it:

- Owner: `src/galaxy/galaxy.ts:171-180` (`generateMarket`, per fluctuation)
- Copy A, player-facing: `src/ui/screens.ts:747`
  `const price = ((cm.basePrice + cm.mask / 2 + sys.economy * cm.gradient) & 0xff) * 0.4;`
- Copy B, the balance harness: `test/campaign.ts:569-572`, same expression

Measured against the true 256-fluctuation mean across all 256 systems and 17
commodities: **113 of 4,352 rows are out by more than 5 Cr, worst 38.4 Cr** —
Teanrebi Narcotics reads ~96.8 Cr against a true mean of 58.4. Neither copy
applies the living galaxy's ±25% `applyMarketPressure` either.

The sharp part: **this transcription was already found wrong and fixed in a
third copy, and these two were left.** `train/jameson-autopilot.js:49-56`
records the fix — *"It now runs galaxy.ts's own model over all 256
fluctuations with contracts.ts's pressure on top, which is exactly what the
destination will quote."*

So a player planning a run is given a number the destination will not honour,
and the campaign harness scores trade decisions against a different economy
from the one the game runs.

## Implementation

- One home. The estimate should come from `galaxy.ts`'s own model, with
  `contracts.ts`'s pressure on top — `jameson-autopilot.js` already
  demonstrates exactly this and can be read as the reference.
- Decide what the screen should actually show. A mean over fluctuations is a
  different claim from a price; if it is an estimate, it should say what kind,
  and the manual should agree.
- `test/campaign.ts`'s copy goes the same way. Invariant 10 exists so that the
  headless campaign runs the code the game runs.

## Acceptance

- The estimate for any system and commodity agrees with what that system
  actually quotes, within a stated and documented tolerance.
- No expression of the price model exists outside `galaxy.ts`.
- A test compares the estimate against `generateMarket` across a spread of
  systems and commodities and fails on drift.
- `npm run campaign` figures are reported before and after — trade decisions
  will move, and that is the point.

## Verify

`npm run check`, `npm run campaign`, plus the all-systems sweep above.
