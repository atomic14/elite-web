# 50 — Key bindings have six homes, and two live keys are in none of them

**Kind:** UI / documentation · **Severity:** medium · **Size:** medium
**Depends on:** none

## Why

docs/INVARIANTS.md invariant 9 names four places a binding lives. There are six, and
they disagree.

| key | `controls.ts` | `?` panel | README | `manual.ts` |
| --- | --- | --- | --- | --- |
| K combat computer | :158 | yes | yes | **missing** |
| TAB energy bomb | :160 | yes | yes | **missing** |
| ⇧H galactic jump | :162 | yes | yes | **missing** |
| **B distress beacon** | :164 | **missing** | yes | **missing** |
| **⇧Y jettison 5t** | :165 | **missing** | **missing** | **missing** |
| D data on system | *docked only* | correct | correct | **listed as flight** |
| C contracts (docked) | :214 | **missing** | yes | n/a |
| H briefing (docked) | :213 | **missing** | yes | n/a |

Two matter concretely. **B is destructive** — GalCop tows you out and takes
your cargo — and appears in no in-game help surface at all; the only `B` in
the `?` panel is play.html:157's "toggle with B when docked", so the panel
actively misleads. And **contracts**, a whole revenue system, plus the new
pilot's briefing, are invisible to anyone using the in-game guide.

**The fifth home** is `src/manual.ts:46-63`, a hand-written `COMMANDS` array —
in a file whose own header says *"A hand-written table here would have made
five, and the fifth is the one nobody remembers… So it is generated from
`allLayouts()`."* True of the flight table it renders; false of the command
table directly beneath it. `manual.html:133-136` then tells the reader both
*"cannot fall out of step with what your keyboard actually does."*

**The sixth home** is `src/ui/screens.ts:67-79`, the docked menu — and it is
the one with a click path, since `data-key` becomes a keystroke
(`screen-host.ts:261-264`). A row whose key has no binding renders,
highlights, accepts a click and does nothing. That has already happened and is
admitted at `controls.ts:218-220`.

## Implementation

- The command table in `manual.ts` should be generated from `BINDINGS` the way
  the flight table is generated from `allLayouts()`. That removes the fifth
  home rather than syncing it.
- The `?` panel and the README need the missing keys — or the keys need
  removing if they are not wanted.
- Decide what to do about the docked menu: a test that every `data-key` in a
  rendered menu resolves to a real binding would close the click path for
  good. TODO 49 covers the vacuous test that was supposed to do this.
- Update invariant 9 to the true number of homes, or reduce the homes to the
  number it claims. The second is better.

## Acceptance

- Every key bound in `controls.ts` appears in every surface that claims to
  list it, and nothing appears that is not bound.
- A test fails if a binding is added without its documentation, and if a menu
  row names a key with no binding.
- docs/INVARIANTS.md invariant 9 states the true arrangement.

## Verify

`npm run check`, then read the `?` panel and the manual against
`controls.ts`.
