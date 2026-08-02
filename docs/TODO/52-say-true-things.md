# 52 — Say true things

**Kind:** documentation / dead code · **Severity:** medium · **Size:** medium
**Depends on:** 43, 45

## Why

This codebase carries its reasoning in its comments on purpose, so a comment
that has become false is a defect rather than a nitpick — it actively misleads
the next reader, and it has already cost time in this review. A sweep after
the Elite-A migration, the trainer work and the save rewrite found these.

**Dangerous — it teaches a rule that loses data:**

- `docs/BROWSER-TRIALS.md:12-13` — *"Never write save slots 1-3… if you drop
  to a console, use slot 4."* There are no numbered slots. The replacement is
  the one-way `useHarnessSaves()`, and CLAUDE.md:113-121 explains why "back up
  and restore" was not enough — *"that is how a commander was actually lost"*.
  Commit `2b97a5c` updated four other documents and missed this one.
- `train/README.md:116` — *"It backs up your commander save first and restores
  it afterwards."* `train/jameson-autopilot.js:302-309` does the opposite,
  one-way, with the reason inline. The stale sentence also survives in that
  file's own header at `:11-13`.

**Points a maintainer at the wrong place:**

- `src/game/screens/combat-sim-setup.ts:319` cites `window.__legacyPirates`,
  a global invariant 12 bans and `test/state.test.ts:234-235` asserts is gone.
  It is `state.brains`. The paragraph's conclusion is still right; its reason
  names a symbol that does not exist.
- `docs/GAP-ANALYSIS.md:170` — `FUEL_PRICE` is in `src/game/shop.ts:26`, not
  `commander.ts`. Same failure as the `pirateThreat` pointer already fixed.
- `docs/AI-TRAINING.md:24` and `train/README.md:35-37` send you to `brains.ts`
  for a rule that moved to `brain-names.ts` — a file that exists *because*
  that rule had two homes.
- `docs/ARCHITECTURE.md:154` and `:536` describe a `Game` constructor that
  needs a browser, in the present tense, one of them as a "known gap". It
  takes a shell factory; three test files construct it headless.
- `src/game/threat.ts:143-144` justifies its one curated tier exception with
  the recommended-default build's numbers; since TODO 29 the scorer reads the
  pirate-role build. The conclusion holds, the row does not.
- `src/game/npc-energy.ts:125` — *"252 is the heaviest thing that FLIES"* —
  contradicts `impact-damage.ts:98-100`, which correctly names the `W:29`
  Dragon at 255. The Dragon is a rostered trader.
- `src/game/storage.ts:1` and `docs/ARCHITECTURE.md:293` both say storage is
  *"the ONLY file that touches localStorage"*. `src/engine/keymap.ts:42,46,75`
  also does. Invariant 3 carves this out; these two restatements do not.

**Describes something that never shipped, under a banner saying it did:**

- `docs/AI-TRAINING.md:3-9` claims the network below is implemented. It says
  ~30 observation floats (actual `OBS_SIZE = 14`), 54 output combos (actual
  `OUT_SIZE = 11`), 30→64→64 ~7k params (actual 14→32→32→11), and an
  `NpcShip.brain` field that does not exist.

**Player-facing:**

- `index.html:154` — *"Four commander slots."*
- `manual.html:275` lists nine combat ranks; `commander.ts:93-104` has ten.
  A commander reading BELOW AVERAGE cannot find their rank on the ladder.
- `viewer.html:62,65` label the combat viewer's scenarios "Shipped pirate
  (league r2)"; `src/viewer/main.ts:16` imports `pirate-attack-g1`, which
  `brain-names.ts` calls CANNOT BE FLOWN. The shipped pirate is g3.

**Counts the project asserts about itself, now drifted:** CLAUDE.md's
"fifteen pure rule modules" (23) and "six for the combat trainer" (nine);
ARCHITECTURE's portability block, assertion count, `game.ts` and `npc.ts` line
counts, "six of them are still there" (seven), Shell's "seven members" (nine);
COMBAT-SIM's line references.

**Dead code**, verified unreferenced across `src/`, `test/`, `train/`,
`tools/` and the HTML entries, and not reachable from a console handle:
`hullMaterial()` (`src/ships/geometry.ts:110`, its one caller deleted in
`1fa0b78`, and its docstring still promises a consumer), `careerIds()`
(`storage.ts:517`), `isValidSaveName()` (`save-file.ts:112`, shipped and never
called), `playerHullIdOf()` (`ship-identity.ts:130`), `worldSeed()` and
`randomRange()` (`rng.ts:76,103`). Also `src/ui/screen-host.ts:88` and
`src/game/game.ts:1449` describe an "unmigrated screen" case that all twelve
`ScreenId`s now make unreachable.

## Implementation

Fix the claim or fix the code, and prefer deriving a number to restating it —
several of these are counts that will drift again the moment they are typed.
Where a doc quotes a measurement, either re-measure it or remove the figure;
CLAUDE.md's own rule is *"Measure; don't cite."*

Delete the dead code unless it is deliberately kept, and if it is kept, say so
where it lives.

## Acceptance

- Every claim above is true, or gone.
- No dead export remains without a stated reason to exist.
- The counts that can be derived are derived rather than typed.

## Verify

`npm run check`, plus a re-run of the checks that produced this list: every
backticked path resolves, every markdown link resolves, and a grep for the
retired vocabulary (`slot 1-3`, `window.__`, `four commander slots`) is empty.
