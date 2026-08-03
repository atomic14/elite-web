# 58 — Extended system descriptions, generated offline

**Kind:** content / tooling · **Severity:** low · **Size:** large
**Depends on:** none

## Why

Chris, 2026-08-03: *"it might be fun to have 'enhanced' descriptions of the
planets and the inhabitants. We could run a very cheap model to create extended
descriptions. We'd need to provide some good guidelines."* And then the two
constraints that shape the whole thing: *"The extended descriptions will have
to be generated offline. These are additions to the original galaxy — so our
base data matches the original and this is layered on top. And yes, we need to
constrain the output."*

The 1984 generator already writes one line per world — `planetDescription()` in
`src/galaxy/goatsoup.ts`, the goat-soup grammar, byte-matched like the rest of
`galaxy.ts`. LAVE is *"a dull world"*. That line is the whole of what the game
says about a place you may spend an hour trading in.

This adds a second paragraph beside it. It does not replace the first, and it
does not touch `galaxy.ts` or `goatsoup.ts` at all.

## The shape, and why it is this shape

**The game deploys as a static site, so no model can run at build time or at
play time.** `tools/species-prompts.ts` already says this in its header and
already solves it: it derives prompts from the 1984 seeds, emits a reproducible
manifest, and `tools/generate-species.py` turns that manifest into images that
are generated offline and committed. This is the same pipeline with prose
instead of pixels — follow it rather than inventing a second one.

So: a **manifest** built from the seeds, a **generator** that calls the model
once per system, a **vendored JSON** that is committed, and a **drift gate**
that fails `npm run check` if the committed output no longer matches the
manifest it claims to come from. Same bargain as `npm run generate:elite-a
-- --check`.

## The 1984 data is the source of truth

The model is a decorator. It elaborates on facts it is handed and may not
introduce, contradict or soften any of them. The facts it gets, all from
`StarSystem` and its derivations:

```text
name · economy · government · tech level · population (billions)
productivity (M CR) · radius (km) · species (speciesName)
the goat-soup line (planetDescription)
```

The one-line description is an **input**, not something to rewrite: if the
grammar says *"fabled for its exotic goat soup"*, the paragraph is about a
world where that is true.

What the model must not do is say anything the rest of the game will
contradict on the next screen. The concrete traps, all live rules:

- **Prices.** `generateMarket()` sets what a commodity costs. A paragraph that
  says slaves are cheap here is checkable, and wrong half the time.
- **Tech level.** `shop.ts` decides what is fitted for sale. A world described
  as fielding military lasers when TL says otherwise is a lie the shop screen
  tells on you.
- **Government.** `law.ts` drives fines and police. Anarchies and dictatorships
  behave differently and the paragraph should not promise the opposite.
- **Anything about the player.** No second person, no "you will find".

That is the constraint list; it belongs in the system prompt verbatim and in
the schema's field descriptions.

## Constraining the output

Use **structured outputs** (`output_config.format` with a `json_schema`), not
prose parsing. The schema is the contract, and it is narrow on purpose:

```text
description   2-4 sentences on the world itself
inhabitants   1-3 sentences on who lives there
```

Plus hard rules the schema cannot express, which the generator enforces after
the fact and refuses on: a length ceiling in characters, no second person, no
banned words (a short list — "bustling", "vibrant", "nestled", "boasts",
"testament"), and no digits, because a number in the prose is a fact that can
disagree with the game.

A refusal is not a failure of the run: record it, leave that system without an
extended description, and let the fallback carry it.

## Missing is a supported state

The game must read this as an **optional overlay**. If a system has no entry —
because galaxies 2-8 have not been generated, because a record was refused,
because the file is absent entirely — the screen shows exactly what it shows
today. That is what makes it safe to ship galaxy 1 first and the rest later,
and it is what keeps this from becoming load-bearing.

## The model

**Claude Haiku 4.5 (`claude-haiku-4-5`) through the Message Batches API.**
$1/$5 per MTok, halved to **$0.50/$2.50** by batching, which is the right
surface anyway — the whole job is offline and nothing is waiting on it. The
estimate for all eight galaxies (2,048 systems, ~1,700 input and ~300 output
tokens each) is about **$3.30**; galaxy 1 alone is about 40 cents.

Sonnet 5 is roughly twice that — around $6.60 for the whole set at the
introductory rate. Cost is not the deciding factor at these numbers, prose is.
**Generate galaxy 1 on both, read them, then pick**; that comparison costs
under a dollar and is the only measurement that matters here.

Don't bother with prompt caching: Haiku 4.5's minimum cacheable prefix is 4,096
tokens and the system prompt will be smaller than that, so it would silently
never cache.

## Implementation

- `tools/system-prompts.ts` — the manifest, mirroring `species-prompts.ts`:
  pure, derived from the seeds, prints a sample by default and emits JSON with
  `--json`. Includes a `promptHash` per system so drift is detectable.
- `tools/generate-descriptions.ts` — submits the batch, polls, writes
  `src/galaxy/descriptions/<galaxy>.json`. Uses `@anthropic-ai/sdk` (the
  project is TypeScript; do not hand-roll HTTP). Keyed by `custom_id`, because
  batch results come back in any order.
- `src/galaxy/descriptions.ts` — the reader. Pure, browser-free, no side
  effects at module scope, `.ts` on relative imports and
  `with { type: 'json' }` on the JSON import, because `npm run portability`
  and the node tests both apply. Returns `undefined` for a system with no
  entry.
- `npm run generate:descriptions -- --check` — non-writing drift gate, wired
  into `check` beside the Elite-A one.
- The screen change is one paragraph under the existing line in
  `src/ui/screens.ts`, which renders and nothing else.

## Watch out for

- **`galaxy.ts` and `goatsoup.ts` are byte-matched to 1984 (invariant 4). Do
  not touch either.** This layer reads them; it never edits them.
- **Bundle size is not a constraint here.** Chris, 2026-08-03: *"the bundle
  cost is not too important — we get compression automatically so not an
  issue."* 256 systems × ~400 characters is ~100 kB of prose per galaxy, which
  gzips to a fraction of that. Report the figure, do not design around it.
- **`npm run sizes`** — 400-line ceiling applies to every new file.
- The API key is a developer credential for an offline tool. It lives in
  `.env.local` (already covered by the `*.local` rule in `.gitignore`) or the
  environment, is never committed, never passed on a command line where shell
  history would keep it, and nothing in `src/` ever sees it.

## Acceptance

- `generateGalaxy(1)[7]` is still LAVE, TL:5, Rich Agricultural Dictatorship,
  and `planetDescription` still returns its 1984 line — a test asserts both are
  unchanged by this work.
- A system with no extended description renders exactly as it does today, and a
  test covers the empty-overlay case.
- The committed JSON matches the manifest: `--check` fails if a prompt input
  changed without regeneration.
- No entry contains a digit, a second-person pronoun, or exceeds the length
  ceiling — a test over the committed file, not just the generator.
- `npm run portability` contaminated bucket is still zero.
- The bundle cost of the overlay is measured and stated.

## Verify

`npm run check`, `npm run build`, then read twenty of them cold and ask of each:
does this tell me something the market screen, the shop and the police will
agree with?
