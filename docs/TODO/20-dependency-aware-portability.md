# 20 — The portability gate does not follow imports

**Kind:** architecture tooling defect · **Severity:** medium · **Size:** medium

## What is wrong

`tools/portability.mjs` classifies each TypeScript file from its own path and
browser-token text only. It does not follow imports. A core file can therefore
import a platform module and still count as “ports unchanged,” making
`0 contaminated` false assurance for the desktop-port question the tool claims
to answer.

## Evidence

- The tool walks files, checks the `PLATFORM` path list, then applies one browser
  token regex to each file independently.
- It never parses or resolves import edges.
- Before TODO 19, core modules importing `audio.ts`, `storage.ts`, or DOM screen
  modules still contributed to “ports unchanged.”

## The fix

Build a relative-import graph for `src/**/*.ts` and propagate platform
classification transitively:

- An intended platform file remains `platform`.
- A non-platform file that runtime-imports a platform or contaminated file is
  `contaminated`, with the dependency path explaining why.
- Ignore `import type` and `export type` edges because they are erased.
- Resolve explicit `.ts` relative paths and directory/index forms actually used
  by this repository; do not guess package semantics unnecessarily.
- Detect cycles without recursion failure and give deterministic output.

Keep direct browser-token detection as an independent contamination source.

## Verify

- Add fixture-level tests for direct contamination, transitive contamination,
  type-only imports, cycles, and clean graphs.
- Add a regression fixture matching the former core→audio leak and require the
  dependency chain in the diagnostic.
- `npm run portability` must report zero only after TODO 19 removes the live
  runtime edges.
- `npm run lint && npm test && npm run sizes`
- `git diff --check`

## Outcome

The first dependency-aware run reported **16 contaminated files**, not the old
false zero. The three TODO 19 targets (`combat.ts`, `ordnance.ts`, and
`station.ts`) were clean; the graph exposed older runtime paths through console
and storage adapters, HUD binding, the sun renderer, and the keymap. Those
boundaries now point outward through injected data or platform-owned installers.

`game.ts` is explicitly the platform composition root: it constructs the
Input, HUD and screens and applies platform effects, while only `main.ts`
imports it in shipped code. A live invariant protects that direction. The gate
now reports **0 contaminated files** and exits unsuccessfully if one returns.
