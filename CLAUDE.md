# CLAUDE.md — working on elite-web

**HARMLESS** — an unofficial browser tribute to Elite (1984) (TypeScript +
Vite + three.js) with ship AI trained by neuroevolution self-play. Owner:
Chris (atomic14.com). Public repo; MIT + fan-project notice in LICENSE — keep
the non-commercial homage framing intact.

**The name is deliberate and load-bearing.** "Elite" is a live Frontier
Developments trademark, so it is not used as this project's NAME anywhere —
not in titles, H1s, Open Graph, JSON-LD or the domain. It IS used in prose to
say what this is a tribute to ("a browser tribute to Elite (1984)"), which is
nominative use and is the point. The in-game `E L I T E` combat rank stays: it
describes gameplay, not the product. Site is harmless.atomic14.com. The repo
and npm package are still named elite-web, deliberately left alone.

## Commands

```sh
npm run dev        # landing at localhost:5173 · game at /play.html
                   # viewer at /viewer.html · manual + novella at /manual.html, /novella.html
npm run lint       # tsc --noEmit over src/, train/ and test/
npm run check      # lint + tests — what `prebuild` runs
npm run build      # prebuild (lint + test) then vite build → dist/
npm run train -- <attack|evade|pack|defend> [--gens N --pop N ...]
npm run evaluate   # held-out tournament for the current brains
npm run survivability  # can a *shielded* commander survive a gang? (see invariant 8)
npm test           # invariant + sim tests (test/run.ts, no framework)
npm run campaign   # headless balance playtest (test/campaign.ts)
                   # `-- <commanders> <legs> <trader|hunter|privateer|both|all>`
                   # `-- 4 45000 all` runs full careers to E L I T E (~70s)
```

CI (.github/workflows/ci.yml) lints, tests, builds and runs the campaign.
Deployment is Cloudflare Pages, auto-deploying from the repo with build
command `npm run build` — and because npm runs `prebuild` first, a commit
that fails lint or tests fails the Cloudflare build and never deploys.
**Don't move lint/test out of `prebuild`**: that gate is the only thing
stopping a broken commit reaching the live site.

Node ≥ 22.6 (train/evaluate run TS directly via --experimental-strip-types).

**Site layout**: `/` is a static landing page (no game bundle — it exists to
be read and indexed), the game is `play.html`, and `manual.html` /
`novella.html` carry the long-form text. All are Vite entries in
vite.config.ts; add new pages there or they won't build.

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
7. **Contract/market rules live in `src/game/contracts.ts`**, not game.ts,
   so the headless campaign simulator runs the *same* code the game does.
   Keep new economic rules there.
8. Retraining overwrites `src/sim/brains/*.json` which the game/viewer
   import at build time. `git checkout src/sim/brains` restores shipped
   weights. Shipped-in-game: `pirate-attack-r2` (pirates), `jameson-defend`
   (armed traders + anything player-assist). `pirate-pack-r4-selectonly`
   **now ships, for organised gangs only** (`npc.ts` — `this.organised ||
   packBrainEnabled()`): opportunists and professionals fly the solo brain,
   a tier-2 gang of 3+ flies the pack policy. `window.__packBrain = true`
   still forces it on everyone, for A/B.
   That split is the balance answer, and it is measured. Beware the
   tournament's headline "kills a defended target in 0.7s": its defender is
   `traderCobra`, hp 1.0, and the sim has **no shields**, while the player
   soaks 3-4x that (fore/aft shields 1.0 each, then energy at 2 per point).
   Correct for it (`npm run survivability`) and a gang of 3 kills a commander
   **50% of the time in 4.5s**, 38% if they keep both shields working — a
   real fight with time to answer, not an execution. The same correction
   shows why gangs must exist: opportunists on the solo brain kill a shielded
   commander 0-2% of the time, so without them the late game has no threat.
   Gangs are gated on fame — a new commander never meets one; by E L I T E
   they are 34-45% of receptions. Still unflown in the real game, where ECM,
   the escape pod, torus and RAM_GUARD all favour the player, so treat 50% as
   the floor. Lever if it needs one: `organised` in contracts.ts, not the
   brain. See docs/TRAINING-LOG.md runs 7 and 8.
9. **The trainer's `--validate-select` flag matters more than it looks.**
   Without it, the final brain is chosen by comparing scores across
   generations that used *different* episode seeds — that picks the luckiest
   generation, not the best genome, and it silently ruined runs 4 and 6. Use
   it for any new run.

## Verification workflow (what has worked well)

- `window.__game` is the Game instance; `window.__policyKit` exposes
  {act, observe, makeScratch, pirateBrain, defendBrain}. Drive the real game
  headlessly from the console/javascript-tool: call `g.update(1/60, t)` in a
  loop to simulate time (browser rAF throttles in background tabs — manual
  stepping is the reliable way in automation).
- `window.__scriptedPirates = true` disables all NPC brains (A/B testing).
- `window.__cheat = true` fits anything from the equipment catalogue, free and
  at any tech level — playtesting only. A console handle rather than a key
  binding, deliberately: nobody should reach it by accident.
- `npm run campaign` is the **balance playtest**: hundreds of full careers
  through the real galaxy/market/living-galaxy/contract modules (only flight
  is abstracted). Run it after touching prices, rewards, equipment or the
  living galaxy — it asserts the economy still works and prints the wealth
  curve, bankruptcy rate and equipment progression.
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
