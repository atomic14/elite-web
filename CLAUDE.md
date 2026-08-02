# CLAUDE.md — working on HARMLESS

**HARMLESS** — an unofficial browser tribute to Elite (1984). TypeScript, Vite,
three.js, with ship AI trained by neuroevolution self-play. Owner: Chris
(atomic14.com). Site https://harmless.atomic14.com, repo
github.com/atomic14/harmless. Public repo; MIT plus a fan-project notice — keep
the non-commercial homage framing intact.

This file is the **rules and the north star**. Where code lives is
`docs/ARCHITECTURE.md`'s 30-second map, a complete one-line-per-file index. How
we got here is `docs/DEVLOG.md` and `docs/TRAINING-LOG.md`. Which combat
numbers are the released game's, which are a clean recreation and which are
ours is `docs/ELITE-A.md`, and every way anything can be hurt is
`docs/DAMAGE-PATHS.md`. Nothing here needs re-arguing — if a rule looks wrong,
say so and we will change it.

## The north star

**One world state. A pure step that advances it. A renderer that only reads it.**

Everything follows from that:

- The world advances in fixed 1/60 slices from one seeded PRNG, so the same
  inputs give the same run — which is what makes a replay, a regression test and
  a training run possible at all.
- The trainer flies the **real game**. There is no second physics.
- One rule has one home. The recurring failure this defends against is one rule
  with two homes, kept in step by hope.
- A module decides and reports; the orchestrator applies. Modules return events;
  `game.ts` has one small `apply*` per module.
- Anything that drives behaviour and is not a constant is state, and state is
  saved. AI state is game state.
- `npm run portability` measures how much of `src` would survive a move to
  another shell, and the contaminated bucket is **zero** — the platform lives
  behind `engine/shell.ts`, which `browser-shell.ts` implements and
  `headlessShell()` proves is real. Keep it at zero.

**For the AI: threat is not fun.** A well-optimised pirate is a turret that hangs
in space and snipes, and evolution will find it. We want a dogfight the player
can win — attack runs, weaving, overshoots. Lethality is a proxy for threat, and
a brain that wins every measurement can still be the wrong brain. **Fly it
before tuning it.**

## Commands

```sh
npm run dev        # landing at localhost:5173 · game at /play · viewer at /viewer
npm run lint       # tsc --noEmit over src/, train/ and test/
npm test           # invariant + unit tests (no framework; test/run.ts is an index)
npm run check      # lint + tests — what `prebuild` runs
npm run build      # prebuild then vite build → dist/
npm run campaign   # headless balance playtest (test/campaign.ts)
                   # `-- <commanders> <legs> <trader|hunter|privateer|both|all>`
npm run portability   # how much of src would port to another shell
npm run sizes      # no file over 400 lines without a stated reason
npm run coverage   # what the tests touch, and what they never touch
npm run generate:elite-a   # regenerate src/game/elite-a from the vendored pack
                   # `-- --check` is the non-writing drift gate, part of `check`
npm run elite-a    # THE ALIGNMENT GATE: the pack's hashes, the generated
                   # catalogue, the 20,070 oracle rows, the live laser paths,
                   # the identities, the roster and the geometry — under a
                   # second. In CI as its own step; NOT in `check`, which
                   # already runs every one of those assertions via `npm test`
npm run train -- <attack|evade|pack|defend> [--gens N --pop N --out NAME ...]
npm run evaluate   # held-out tournament
npm run survivability # can a shielded commander survive a gang? (a BOT answer)
```

Node >= 22.6 (train and evaluate run TS directly via
`--experimental-strip-types`).

CI lints, tests, builds and runs the campaign. Deployment is Cloudflare Pages
from the repo, and because npm runs `prebuild` first, a commit that fails lint or
tests never deploys. **Don't move lint/test out of `prebuild`** — that gate is
the only thing stopping a broken commit reaching the live site.

**Site layout**: `/` is a static landing page with no game bundle, the game is
`play.html`, and `manual.html` / `novella.html` carry the long-form text. All are
Vite entries in `vite.config.ts`; add new pages there or they won't build.

## Invariants that MUST hold

1. **The name.** "Elite" is a live Frontier trademark, so it is never this
   project's NAME — not in titles, H1s, Open Graph, JSON-LD or the domain. It IS
   used in prose to say what this is a tribute to, which is nominative use and is
   the point. The in-game `E L I T E` combat rank stays: it describes gameplay,
   not the product.
2. **Link to pages WITHOUT `.html`.** Cloudflare serves clean URLs and
   308-redirects `/play.html` → `/play`, so a canonical or sitemap entry ending
   in `.html` points at a redirect, which is an SEO error rather than a cosmetic
   one.
3. **The `elite-web-*` localStorage keys are never renamed** —
   `elite-web-commander:<slot>`, `elite-web-world:<slot>`, `elite-web-slot`,
   `elite-web-keymap`. They are where every existing player's commander lives.
   `storage.ts` is the only file that may touch localStorage.
4. **Galaxy fidelity**: `generateGalaxy(1)[7]` is LAVE, TL:5, Rich Agricultural
   Dictatorship. Never "fix" `galaxy.ts` maths; it is byte-matched to the 1984
   algorithm. `npm test` asserts it.
5. **One combat model.** `src/ai-training/scenario.ts` builds episodes out of
   `NpcShip`, `PlayerShip`, `gunnery.ts`, `collisions.ts` and `rng.ts`. A change
   to a combat number therefore changes the game and the training world
   together — so nothing desyncs, but it **invalidates the brains**. Retrain
   deliberately.
6. **No `logarithmicDepthBuffer`** on the renderer: it disables polygonOffset,
   which is what keeps black hull fills behind wireframe edges.
7. **Ship defs use +Z nose**; `buildShip()` turns them a half turn about Y to
   fly along three.js's forward. It used to MIRROR Z, which is the same picture
   for a left/right symmetric hull and a different ship for an asymmetric one —
   and eight released designs are asymmetric, so the mirror had to go.
8. **Money is integer tenths of a credit; fuel is tenths of a LY (max 70).**
9. **Key bindings live in four places** and change together:
   `engine/keymap.ts` (flight keys, classic and modern layouts), `BINDINGS` in
   `game/controls.ts` (command keys, per mode), the `?` help panel in
   `play.html`, and the README table.
10. **Economic rules live in `game/contracts.ts`**, not `game.ts`, so the
    headless campaign runs the same code the game does. Likewise prices in
    `shop.ts`, contraband and fines in `law.ts`.
11. **`Math.random` is banned in world code and `npm test` enforces it** —
    including bare references, THREE's own generators, and destructuring it out
    of `Math`. `game/rng.ts` is the only source of chance. `starfield.ts` and
    `audio.ts` are exempt because nothing reads them back.
12. **Global variables are unacceptable, and `npm test` enforces it.** No rule
    may be read from ambient state. If game code branches on it, it is a field
    of `GameState` — that is what makes it saveable, testable as an argument,
    and impossible to leave set by accident. Five `window.__` flags decided
    which brain flew and what could be fitted, and each cost the same three
    things: not in the snapshot, so a reload changed the game; settable by a
    test only with a clean-up it had to remember; and a put-it-back dance in the
    combat trainer guarding a hazard instead of removing it. They are
    `state.brains` and `state.cheat` now.

    A **handle** is the one legitimate exception and it is not a variable: the
    game WRITES `__game`, `__policyKit` and `__simLog` so a console or an agent
    can reach in, nothing reads them, and nothing branches on them. They live in
    `src/game/console.ts`, the only file allowed to touch `globalThis` — same
    bargain as `game/storage.ts` and localStorage. Module-level mutable state is
    held to the same bar: `rng.ts`'s stream is allowed because it is snapshotted
    and every consumer reseeds, which is the standard to meet, not a precedent
    to cite.
13. **Screens**: a screen owns its rendering, its keys and its state in one file,
    behind `open()` / `render()` / `input(i)` / optional `select(row)`. It never
    sets the mode, never touches the Game, and returns an outcome
    (`'stay' | 'back' | 'exit' | { open: id }`). `Game.mode` is DERIVED —
    `screens.topId ?? baseMode` — and has no other writer. Adding a screen is one
    file, one line in `ScreenId`, one registration. **No parameter properties**:
    `npm test` runs under `--experimental-strip-types`, which rejects
    `constructor(private readonly x)`.

    Two related rules. **Clicks are input** — `data-key` becomes a keystroke and
    `data-row` goes to `select()`, so a screen has ONE input surface; a parallel
    click path drifts from the key path. And `tick(dt, i)` (cursor motion while
    a key is held) plus `clickAt(el, e)` (a canvas mapping pixels to its own
    coordinates) exist **for the charts and only the charts** — discrete taps
    and `select(row)` cover everything else.
14. **The menu cursor runs BEFORE the top screen**, and `Input.pressed()`
    consumes. That is safe only because it touches nothing unless a `.menu` is on
    screen, and even then only arrows and Enter. Don't widen it.
15. **NPCs return `FireEvent`s; the Game resolves all consequences.** Don't give
    an NPC a side effect. `ui/screens.ts` renders and nothing else, and the HUD
    is a dumb painter.

## Training

- `npm run train` writes `src/ai-training/brains/<out>.json` and **defaults
  `--out` to the phase's real brain**, so a run with no `--out` overwrites a
  shipped one. `git checkout src/ai-training/brains` restores.
- Always use **`--validate-select`**. Without it the final brain is chosen by
  comparing scores across generations that used different episode seeds, which
  picks the luckiest generation rather than the best genome.
- `--pool` rotates the TRADER, so it is refused for phases where the genome IS
  the trader.
- Shipped: **`pirate-attack-g3`** (pirates), **`jameson-defend-g1`** (armed
  traders and anything player-assist), **`pirate-pack-r4-selectonly`**
  (organised gangs). `pirate-attack-r2` is the legacy control behind
  `state.brains.legacy`, not a shipped brain.
- Balance is not settled, and a figure quoted in any doc may predate a physics
  change. Measure; don't cite.

## State

**`Game.state`** (`GameState`, `state.ts`) holds everything the step may change —
galaxy, commander, living galaxy, world, player, session, ship systems, dock
plan, encounter timers, markets, charts. `freshState(commander)` builds it under
node with no browser.

Two objects inside it are walked **generically** by `snapshot.ts`, so adding a
field to either saves it for free: **`NpcShip.state`** (`NpcState`) and
**`state.session`** (`SessionState`). `NpcState.pos` and `.quat` ARE the mesh's
own vectors, so the renderer reads the state and there is no sync pass to forget.

**The top-level snapshot is a hand-written list** (`persistence.ts`), so it is
not free — but a test asserts every `GameState` field appears by name in both
capture and restore.

Restore may differ from an unbroken run in ways a player cannot observe or
exploit; it is not required to be byte-identical. Seeded reproducibility from a
given seed IS required, because training and the regression gate depend on it.

## Running game code under node

Most of it already does — `World.build()`, the world step, `NpcShip` and fifteen
pure rule modules are asserted browser-free by `npm test`. To keep it that way:

- **No side effects at module scope.** Install debug globals from a function
  (`installPolicyKit()`), never a bare assignment.
- **Explicit `.ts` on relative imports**, and `with { type: 'json' }` on JSON
  imports. Vite infers both; node does not.
- **Everything platform-bound is behind `Shell`** (`engine/shell.ts`): the GPU
  stack, the frame loop, resize, clicks, the sight and the `?` panel. `Game`
  takes a shell factory, so `new Game(() => headlessShell())` constructs and
  flies under node — `test/game.test.ts` does exactly that, and asserts
  `game.ts` names no DOM API at all, because TypeScript will not (the DOM types
  are ambient, so `window.innerWidth` type-checks fine in a file that can never
  run — that is how it hid in `tunnel.ts`).
- **A painter with no DOM is inert, not broken** — `engine/inert-dom.ts`. Same
  bargain as `storage.ts` with localStorage and `sun.ts` with the canvas: the
  file that knows about the platform copes with it being absent. Nothing reads a
  painter back, so dropping the writes changes no rule.

## Verification

- `window.__game` is the console-only `legacyHandles(Game)` view;
  `window.__policyKit` exposes the trained policies. `__game.state` is the
  canonical mutable model; legacy aliases such as `__game.commander` are
  getter conveniences for the untyped harnesses.
  Drive the game headlessly by calling `g.update(1/60, t)` in a loop — background
  tabs throttle rAF, so manual stepping is the reliable way.
- **A/B switches are STATE, not globals.** `state.brains` picks which brains fly
  (`scripted` disables them all, `legacy`/`sharp`/`pack` swap them — see
  `BrainSelection`) and `state.cheat` fits anything from the catalogue free. They
  were five `window.__` flags; a rule read from ambient state is not in the
  snapshot, so a reload changed the game. From a console go through the handle:
  `__game.state.brains.legacy = 'pro'`. `npm test` bans their return, and
  `src/game/console.ts` is the only file allowed to touch `globalThis` — it
  publishes handles the game WRITES, never flags it reads.
- `npm run campaign` after touching prices, rewards, equipment or the living
  galaxy. `test/playtest.js` plays the real game and asserts invariants.
- **Never write save slots 1-3.** Harnesses run in slot 4 (`SAVE_SLOTS`) and
  restore the pointer; do the same in console work. Backing up and restoring is
  NOT enough, because the world autosaves every 20 seconds and a tab left
  running will overwrite the restore.
- **Prefer a fight a human flew to a bot-flown measurement.** Bots mislead in
  both directions: flying straight flatters freighter-trained brains, and the
  defence policy evades superbly while shooting badly. That is what the docked
  combat trainer is for — `T` at any station. It reports accuracy both ways,
  damage by source, engagement ranges, time on each other's six, and your own
  flight envelope, and exports the lot as JSON (clipboard, file, and
  `window.__simLog`). Feed those records back when judging a training run;
  `npm run survivability` is the bot answer to the same question and says so.
- When verifying a refactor, prove **equivalence with the previous code** (same
  seed, identical outcome), not merely that the new code is self-consistent.
  Freshly spawned NPCs need one settling step before their world matrices are
  valid, or the fixture diverges for reasons that are not the code's.

## Style

- **Tests are organised like `src/`.** One file per subsystem in `test/` —
  the world (`galaxy`, `economy`, `contracts`, `trade`, `world`, `world-step`,
  `station`, `game`, `state`, `snapshot`), the ships and being shot at
  (`flight`, `geometry`, `npc`, `systems`, `combat`, `gunnery`,
  `instrumentation`, `damage-paths`, four `elite-a-*`, `ship-identity`,
  `ship-roles`, `role-variants`), the brains (`ai`, `combat-model`, `arena`),
  the shell (`ui`, `hud-binding`, `audio`) and four for the combat trainer.
  `test/run.ts` is an INDEX that imports them all and prints one total;
  `test/elite-a.ts` is a second index over the alignment-critical subset, with
  no assertions of its own. `harness.ts` holds `check`, `fixtures.ts` holds
  data two or more files need. Put a new test beside its subsystem, not in an
  index.
- **Keep files small, and `npm run sizes` enforces it.** The soft ceiling is
  **400 lines**; anything above it must be named in the allowlist in
  `tools/sizes.mjs` **with a reason**, and the check fails on a new file growing
  past it. This is not tidiness. Two files in this project reached 3,244 and
  4,729 lines, and both got there the same way: they were the default place to
  put things, so nobody ever decided. The cost was real — a kitchen-sink file is
  where one rule quietly grows two homes, and three agents working on unrelated
  modules still collided in the same test file.

  When you are about to add to a long file, the question is not "will this fit"
  but "what is this file FOR, and is this that?" If the answer needs an "and",
  it belongs somewhere else.
- Module-header comments state each file's role — maintain them. A file that
  needs a paragraph in `ARCHITECTURE.md` to make sense has the wrong name.
- `game/game.ts` is the orchestrator and nothing else: the fixed-timestep loop,
  the step order, the mode machine, constructor wiring. If you are about to add a
  rule to it, it belongs somewhere else.
- This is a **homage, not a museum piece**: it must stay instantly recognisable
  to anyone who played the original, but we apply what game design has learned
  since 1984. Prices and behaviour follow the original unless there is a good
  reason; `docs/GAP-ANALYSIS.md` records every deliberate deviation.
- Commit per milestone with a descriptive message.
