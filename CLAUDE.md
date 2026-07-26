# CLAUDE.md — working on elite-web

A web remake of 1984's Elite (TypeScript + Vite + three.js) with ship AI
trained by neuroevolution self-play. Owner: Chris (atomic14.com). Public
repo; MIT + fan-project notice in LICENSE — keep the non-commercial homage
framing intact.

## Commands

```sh
npm run dev        # game at localhost:5173, viewer at /viewer.html
npm run build      # tsc --noEmit (src/ AND train/) + vite build → dist/
npm run train -- <attack|evade|pack|defend> [--gens N --pop N ...]
npm run evaluate   # held-out tournament for the current brains
npm test           # invariant + sim tests (test/run.ts, no framework)
```

CI (.github/workflows/ci.yml) type-checks, builds and tests. Deployment is
Cloudflare Pages, auto-deploying from the repo — no deploy workflow here.

Node ≥ 22.6 (train/evaluate run TS directly via --experimental-strip-types).

## Read these before big changes

- `docs/ARCHITECTURE.md` — the five core ideas + conventions checklist. The
  fastest way to orient; keep it updated when structure changes.
- `docs/TRAINING-LOG.md` — every AI run, exact commands, results. Append new
  runs here; never edit old entries.
- `docs/GAP-ANALYSIS.md` — feature parity vs the 1984 manual.
- `train/README.md` — reproducing training; brain-overwrite footgun.

## Invariants that MUST hold (things that silently break)

1. **Galaxy fidelity**: `generateGalaxy(1)[7]` must be LAVE TL:5 Rich
   Agricultural Dictatorship. Never "fix" galaxy.ts math; it is byte-matched
   to the 1984 algorithm. `npm test` asserts this (plus the market model,
   sim determinism, and that the shipped brains still beat their baselines).
2. **Sim/game parity**: combat numbers (ship classes, laser damage/cooldown/
   heat, turn rates) exist twice — `src/game/{npc,game}.ts` and
   `src/sim/core.ts`. Change one → change the other, and note that trained
   brains were fitted to the old numbers (consider retraining).
3. **No logarithmicDepthBuffer** on the renderer: it disables polygonOffset,
   which is what keeps black hull fills behind wireframe edges.
4. **Ship defs use +Z nose**; buildShip() mirrors Z (three.js forward is −Z).
   Hulls must stay left/right symmetric or the mirror becomes visible.
5. **Money is integer tenths of a credit; fuel is tenths of a LY (max 70).**
6. **Key bindings live in four places**: src/engine/keymap.ts (flight keys,
   classic 1984 default + modern toggle), command keys in game.ts, the `?`
   help panel (flight rows are rewritten by keymap.refreshHelpPanel), and
   the README table. Change them together.
7. Retraining overwrites `src/sim/brains/*.json` which the game/viewer
   import at build time. `git checkout src/sim/brains` restores shipped
   weights. Shipped-in-game: `pirate-attack-r2` (pirates), `jameson-defend`
   (armed traders + anything player-assist).

## Verification workflow (what has worked well)

- `window.__game` is the Game instance; `window.__policyKit` exposes
  {act, observe, makeScratch, pirateBrain, defendBrain}. Drive the real game
  headlessly from the console/javascript-tool: call `g.update(1/60, t)` in a
  loop to simulate time (browser rAF throttles in background tabs — manual
  stepping is the reliable way in automation).
- `window.__scriptedPirates = true` disables all NPC brains (A/B testing).
- `test/playtest.js` (paste into console, or `fetch('/test/playtest.js')`
  then eval) is the **autonomous playtest agent**: it plays the real game —
  contracts, trading, equipping, jumping, combat via the trained defence
  brain, docking, hermits — while asserting invariants every 30 frames, and
  prints a report of what it exercised plus any violations. Run it after
  gameplay changes: `await __playtest.run({ legs: 8 })` (~4 min).
  Inspect `__playtest.history` for the per-leg ledger.
- `train/jameson-autopilot.js` is the narrower trade-run harness behind
  docs/JAMESON-TRIALS.md: `await __auto.runTrial('Lave','Leesti',6)`.
  Both back up and restore the player's save.
- Browser automation gotchas: key taps can collapse into one frame — put
  waits between scripted keypresses, or drive via __game directly. The
  player's save is `localStorage['elite-web-commander']` — back it up before
  destructive tests and restore after; saves happen on dock/equip-purchase
  only.

## Style

- Module-header comments state each file's role — maintain them.
- `game/game.ts` is deliberately the single orchestrator; NPCs return
  FireEvents, the Game resolves all consequences. Don't give NPCs side
  effects.
- Screens (`ui/screens.ts`) are pure render functions; HUD is a dumb painter.
- This is a **homage, not a museum piece** (Chris's framing): it must stay
  instantly recognisable to anyone who played the original — never "they've
  ruined it" — but we apply what game design has learned since 1984.
  Prices/behaviour follow the original unless there's a good reason;
  docs/GAP-ANALYSIS.md records every deliberate deviation.
- Commit per milestone with a descriptive message.

## Current state & direction

Core game complete and validated end-to-end (see docs/JAMESON-TRIALS.md).
Six trained brains ship; viewer at /viewer.html showcases them. Open
direction (Chris's priorities): new-player QoL (docking aid, pause), target
market from chart, purchasable Combat Computer (defence brain flies the
player), remaining hulls, README screenshots, deploy workflow for an
atomic14.com CNAME, then the two-level "living galaxy" (design in
docs/AI-TRAINING.md) and AI round 3 (notes in docs/TRAINING-LOG.md).
