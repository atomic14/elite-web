# CLAUDE.md — working on HARMLESS

**HARMLESS** — an unofficial browser tribute to Elite (1984) (TypeScript +
Vite + three.js) with ship AI trained by neuroevolution self-play. Owner:
Chris (atomic14.com). Public repo; MIT + fan-project notice in LICENSE — keep
the non-commercial homage framing intact.

**The name is deliberate and load-bearing.** "Elite" is a live Frontier
Developments trademark, so it is not used as this project's NAME anywhere —
not in titles, H1s, Open Graph, JSON-LD or the domain. It IS used in prose to
say what this is a tribute to ("a browser tribute to Elite (1984)"), which is
nominative use and is the point. The in-game `E L I T E` combat rank stays: it
describes gameplay, not the product. Site is https://harmless.atomic14.com, repo is
github.com/atomic14/harmless.

**Link to pages WITHOUT the .html.** Cloudflare Pages serves clean URLs and
308-redirects `/play.html` to `/play`, so a canonical or sitemap entry ending
in .html points at a redirect — which is an SEO error, not a cosmetic one.
Vite's dev server serves both forms, so extensionless links work locally too.

**The `elite-web-*` localStorage keys are NOT branding and must never be
renamed** — `elite-web-commander:<slot>`, `elite-web-slot`, `elite-web-keymap`.
They are where every existing player's commander lives; renaming them orphans
every save silently, which is exactly the bug class that ate New Commander and
Import earlier. They stay as they are, forever.

## Commands

```sh
npm run dev        # landing at localhost:5173 · game at /play
                   # viewer at /viewer · manual + novella at /manual, /novella
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
   weights. Shipped-in-game: **`pirate-attack-r2`** (pirates),
   **`jameson-defend-g1`** (armed traders + anything player-assist),
   **`pirate-pack-r4-selectonly`** (organised gangs only — `npc.ts`,
   `this.organised || packBrainEnabled()`). `window.__sharpPirates = true`
   flies generation 2 (`= 'pro'` only on tier >= 1); `window.__packBrain =
   true` forces the pack policy on everyone.

   **The generation-1/2 attackers were measured, shipped, flown and rolled
   back.** They win on every number this project can produce — 17 shots an
   engagement against r2's 1.3, 93% kills against a target flown the way
   Chris flies against 0% — and he played them and said the old brain was
   more fun. That outranks the numbers. The reason is structural, and it is
   Chris's own observation: stopping lets you pivot and hold a firing line
   because you stop translating past the target. It is true, the sim models
   it faithfully, so evolution finds it — and a well-optimised pirate is a
   turret that hangs in space and snipes. r2 is fun BECAUSE it is bad at
   that: it flies attack runs, weaves, overshoots, and gives you a dogfight
   you can win. **Lethality is a proxy for threat, and threat is not fun.**
   The open problem is r2's flying with g2's gunnery.

   **Generation 1 is the first set trained against the gun a pirate actually
   carries**, and that is the whole story of runs 9-14 failing to transfer.
   The sim handed every ship the player's pulse laser — 0.24s cadence through
   a ~0.027 rad cone, deterministic hits — where `npc.ts` gives an NPC 1.30s
   through a 0.25 rad gate and then rolls dice on range. Lined up, 0.667
   damage/second against 0.041. `src/sim/core.ts` now models both as
   `LASER` and `NPC_GUN`, hulls declare `gun`, and `test/run.ts` asserts
   cadence, gate, hit cap and damage are EQUAL rather than documenting a
   5.4x ratio. Change one side, change the other (invariant 2).

   Balance is NOT settled. Under the real gun the old brains kill a shielded
   commander 0-2% of the time — the late game had no threat, which is what
   playing it felt like. The new ones, in the corrected-durability harness
   (`npm run survivability`), go 25% for one pirate at hp 3.0, 98% for two,
   100% for three. That is hotter than the 50%-for-a-gang-of-three the
   project previously aimed at, but the sim's defender loses only 0.0-0.3
   pirates a fight where a human kills them, so it understates the player
   badly. **Fly it before tuning it** (`test/arena.js`, `test/combat-recorder.js`).
   If it needs a lever, prefer the legible numbers — `NPC_COOLDOWN_LO/SPREAD`,
   the 0.85 hit cap, the 0.25 gate, all mirrored in `NPC_GUN` — over the
   flying, which is emergent. See docs/TRAINING-LOG.md runs 12-15.
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
- `window.__legacyPirates = true` flies the pre-gun-fix `pirate-attack-r2` on
  every pirate (`= 'pro'` only on tier >= 1). It is the control, not a
  difficulty setting: under the real gun it fires about one shot per
  engagement and dies in 65% of its own ambushes. Use it to A/B the new
  brains in one session with test/gang-trial.js.
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
- `test/combat-recorder.js` records a fight a HUMAN flew, which every other
  harness cannot: `__rec.start()`, fly, `__rec.report()`. It logs your accuracy
  and theirs, damage both ways, and the geometry that decides whether an NPC
  can shoot at all (distance, facing error, share of the fight lined up).
  **Prefer it to bot-flown measurements.** Both bots mislead in opposite
  directions: flying straight flatters freighter-trained brains, and the
  defence policy evades superbly while shooting badly, so everything looks
  survivable. Read-only, restores its patches on stop().
- `train/jameson-autopilot.js` is the narrower trade-run harness behind
  docs/JAMESON-TRIALS.md: `await __auto.runTrial('Lave','Leesti',6)`.
  Both back up and restore the player's save.
- Browser automation gotchas: key taps can collapse into one frame — put
  waits between scripted keypresses, or drive via __game directly. The
  player's save is `localStorage['elite-web-commander']` — back it up before
  destructive tests and restore after; saves happen on dock/equip-purchase
  only.

## Headless: what it takes to run game code under node

The goal is for the **real world step** to be what training runs against,
instead of the parallel model in `src/sim`. three.js is NOT the obstacle —
`worldToLocal`, quaternions and `rotateOnAxis` all work in node with no canvas
and no WebGL (measured, not assumed). Four things were, and three are fixed:

- **No side effects at module scope.** `npc.ts` assigned `window.__policyKit`
  as a bare statement, so importing the file touched `window`. It is
  `installPolicyKit()` now, called by the Game. Don't reintroduce the pattern.
- **Explicit `.ts` on relative imports.** Vite resolves extensionless, node
  does not. `src/sim` always had them; the rest of `src` does now.
- **`with { type: 'json' }` on JSON imports.** Same story — Vite infers, node
  requires the attribute. The brain files carry it.
- **Everything needing a GPU is confined to `engine/render-stack.ts`** —
  WebGLRenderer, the post chain, the camera, the cockpit beams and the
  projection lift. It is the only file the world step cannot reach for.
  `Game` still calls it from its constructor, so constructing a `Game` still
  needs a browser; giving it an optional stack is the remaining step.

Pieces of the world step that are already out, pure and unit-tested:
`game/collisions.ts` (who is overlapping whom), `game/systems.ts` (energy,
shields, laser heat, cabin temperature, and the damage model),
`galaxy/navigation.ts` (distances and jump costs), `hud/hud-model.ts` (what
the HUD needs computing). **`train/survivability.ts` imports the damage model
now** rather than transcribing it — every balance figure this project quotes
depends on that model, and it used to live in a comment.

The payoff is already real: the police-hostility checks were four regexes
against source text because npc.ts could not be imported. They are now ten
tests that call `isHostileToPlayer` directly.

## Screens: the contract to build against

`src/ui/screen-host.ts` routes every overlay. A screen owns its rendering, its
keys and its own state **in one file**, behind `open()`, `render()`,
`input(i)` and optionally `select(row)`. It never sets the mode, never touches
the Game and never reaches for another screen — it returns an OUTCOME
(`'stay' | 'back' | 'exit' | { open: id }`) and the host acts on it. Same
discipline as `NpcShip` returning a `FireEvent`.

- **`Game.mode` is DERIVED** — `screens.topId ?? baseMode`. Assign `baseMode`
  (`docked`/`flight`/`dead`) or push/pop the stack. There is no other writer.
- **The stack replaced two hacks**: the overlay half of `mode`, and the
  one-deep `dataReturn` that existed so the system-data screen could remember
  whether it came from the chart. `back` handles both.
- **Clicks are input**: `data-key` becomes a keystroke, `data-row` goes to
  `select()`. A screen has ONE input surface. The old parallel click path
  drifted from the key path and produced a real bug (the market showed the
  system's name instead of the hermit's).
- **Adding a screen** = a new file, one line in `ScreenId`, one line in the
  registration list in `game.ts`. That is the whole shared surface, so two
  people adding two screens collide on one line rather than on a switch.
- **Migration is incremental**: an id with no registered screen still occupies
  the stack, and `update()` returns false so `game.ts` handles it the old way.
  Screens live in `src/game/screens/`, one file each. **All ten have
  migrated**, so `handleInput`'s switch is down to the three non-screen states
  (docked, flight, dead) and the legacy fall-through is gone.
- Two optional contract methods exist for the charts and only the charts:
  `tick(dt, i)` for cursor motion while a key is HELD, and `clickAt(el, e)`
  for a canvas that must map pixels to its own coordinates. Don't reach for
  them otherwise — discrete taps and `select(row)` cover every other screen.
- **NO PARAMETER PROPERTIES** in a screen or the host — `npm test` runs under
  `--experimental-strip-types`, which rejects `constructor(private readonly x)`.
  Vite compiles it fine, so this only fails in the test run. Assign fields
  explicitly; it is what keeps screens unit-testable outside a browser.
- The menu cursor runs BEFORE the top screen, and `Input.pressed()` consumes.
  It is safe only because it touches nothing unless a `.menu` is on screen, and
  even then only arrows and Enter. Don't widen it.

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
