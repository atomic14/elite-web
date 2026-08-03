# 59 — The galaxy encyclopaedia

**Kind:** content / new page · **Severity:** low · **Size:** large
**Depends on:** 58

## Why

Chris, 2026-08-03: *"a standalone galaxy 'encyclopaedia' would be a great piece
of static content. Especially if it can be made interactive."*

TODO 58 wrote 256 worlds' worth of prose and put it on one screen inside the
game, behind a launch, a docking and two keypresses. As a thing to read it is
almost invisible; as a reason to visit the site it does not exist at all. The
landing page currently offers four destinations — play, manual, novella,
viewer — and none of them is *the galaxy*, which is the thing this project has
that nothing else does: 256 worlds, byte-accurate to 1984, each with a face and
now with a page of prose.

Chris chose **chart-led with a filter rail**, and **public and indexable**.
Both of those decisions carry consequences, and they pull against each other —
see below.

## The shape

```text
┌──────────────┬─────────────────────────────┐
│ FILTER       │        ·   ·      ·         │
│ Economy  ▾   │    ·  ·    ✦LAVE            │
│ ☑ Rich Agri  │  ·      ·      ·   ·        │
│ Government ▾ ├─────────────────────────────┤
│ ☑ Dictator   │ LAVE   TL:5  Rich Agri      │
│ Tech  1━━●━15│ [face] 2.5 Bn Human Colonial │
│ 34 of 256    │ Lave's surface is dominated… │
└──────────────┴─────────────────────────────┘
```

The 256-system map is the page. Click a star and the detail panel fills with
the portrait, the statistics, the 1984 line and both generated paragraphs. The
rail filters by economy, government, tech level and species; matches stay lit
and the rest dim rather than vanishing, because the SHAPE of the galaxy under a
filter is the interesting part — where the anarchies cluster, how the rich
agricultural worlds sit against the poor industrial ones.

## The tension, and how it resolves

**Interactive and indexable are not the same page.** A crawler that runs no
JavaScript sees an empty canvas and a filter rail; everything worth indexing —
205,000 characters of prose that exists nowhere else — is behind a click.

So the page is built the other way up. **The document IS the encyclopaedia**:
all 256 entries are real elements in the HTML, written at build time from the
same pure modules the game uses. The chart is an enhancement layered over a
document that is already complete. With no JavaScript you get a long, readable,
correctly-marked-up reference work; with it, you get the map.

That is one rule with one home rather than two: there is no separate "SEO
version" to drift from the interactive one, because they are the same markup.

- **Build-time, not runtime.** A small Vite plugin renders the entries into
  `encyclopaedia.html` during the build, exactly as `tools/import-elite-a.mjs`
  generates and `tools/species-prompts.ts` prompts — deterministic, from the
  seeds, no model and no network.
- **`?w=<name>` deep links** so a single world can be shared, with the chart
  opening on it. A query parameter rather than a hash, because a hash is not
  a URL a crawler will treat as a distinct page.
- **Per-world static pages are explicitly NOT in scope here.** 256 routes is a
  bigger change to `vite.config.ts` and to the sitemap than this item should
  carry, and one page holding all 256 entries is already the whole corpus. If
  the traffic justifies splitting it later, the generator that writes the
  entries is the same one that would write the pages.

## Watch out for

- **Invariant 1: "Elite" is never this project's NAME.** Not in the `<title>`,
  not in the H1, not in Open Graph, not in the JSON-LD, not in the sitemap
  entry. It IS used in prose to say what this is a tribute to — that is
  nominative use and it is the point. The page is the **Galactic
  Encyclopaedia**; what it documents is the galaxy of a 1984 game.
- **Invariant 2: link without `.html`.** `/encyclopaedia`, never
  `/encyclopaedia.html`. The canonical, the sitemap entry and the landing-page
  link all follow this or they point at a 308.
- **A new page must be an entry in `vite.config.ts`** or it does not build.
  Add it to `public/sitemap.xml` too, which nothing enforces.
- **Galaxy 1 only.** It is the one with descriptions and the one with
  portraits, and it is the galaxy the game starts you in. `systemDescription`
  already returns `undefined` for the other seven; if they are generated later
  this page should need no change beyond a galaxy switch.
- **`npm run portability`.** Anything the page shares with the game must stay
  browser-free; the page's own DOM code is platform and belongs in its own
  directory, the way `src/viewer/` is.
- **`npm run sizes`.** 400 lines per file. A chart renderer, a filter model and
  a detail painter are three files, not one.
- **The prose is generated and goes into the DOM.** `src/ui/screens.ts` escapes
  it for exactly this reason (TODO 58 found a `</br>` in Tiraor's entry). Do
  the same here rather than trusting the committed file.

## Acceptance

- `/encyclopaedia` shows the 256-world chart, filters it, and opens any world's
  full entry.
- With JavaScript disabled the page is still a complete, readable encyclopaedia
  of all 256 worlds — a test asserts every system's name and description appear
  in the built HTML.
- `?w=lave` opens on Lave.
- The page names itself without using the "Elite" trademark, and a test asserts
  it. There were no naming tests before this — invariant 1 had never been
  enforced mechanically — so this item adds the first ones.
- Canonical, sitemap and landing-page link all omit `.html`.
- It is an entry in `vite.config.ts`, and `npm run build` emits it.
- `npm run check` and `npm run portability` unmoved.

## Verify

`npm run check`, `npm run build`, then open `/encyclopaedia`, filter to the
anarchies and see where they sit, click three worlds, and load it once with
JavaScript turned off.
