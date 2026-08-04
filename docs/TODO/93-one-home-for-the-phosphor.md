# 93 — One home for the phosphor

**Kind:** architecture / UI · **Severity:** medium · **Size:** medium
**Depends on:** none, but do it AFTER docs/TODO/90 — that item settles the shape
of `src/constants/` and this one has to fit it

## Why

docs/TODO/90 is game constants and CSS was ruled out of its scope on purpose
(Chris, 2026-08-04) so that a 500-constant refactor was not also a styling
refactor. This is the other half, and the survey behind 90 already found it all.

The game has four colours. **`#4dff5c` alone has at least fourteen homes in
three spellings.**

| where | how it is written |
| --- | --- |
| `style.css:2-5` | `--hud-green`, `--hud-dim`, `--hud-amber`, `--hud-red` |
| `manual.css:7-10` | the same four, verbatim |
| `landing.css:7-9` | green, dim, amber — verbatim, no red |
| `hud/hud.ts:13-15` | `GREEN`, `DIM`, `AMBER` as hex, for canvas drawing |
| `hud/hud.ts:34-42` | `CONTACT_COLORS.station = '#4dff5c'` — `GREEN` restated twenty lines below its own const |
| `hud/hud.ts` (7 sites) | inline hex, including a red that has no const in that file at all |
| `hud/tunnel.ts` (3 sites) | `rgba(77, 255, 92, …)` — the same colour in decimal |
| `style.css` (16+ sites) | `rgba(77,255,92,…)` ×9, `rgba(255,180,68,…)` ×4, `rgba(255,77,77,…)` ×3 |
| `ui/screens.ts:627-783` | ten inline hex for the chart — four are the palette, six are unnamed one-offs |
| `viewer/gallery.ts:32-34` | `RADIUS_COLOUR`, `LABEL_COLOUR` — amber and green again |
| `tools/posterise.py:61-63` | `DIM`, `BRIGHT` copied from the stylesheet, with a comment saying so |

`viewer.css` uses the variables **without defining them**, so it renders
correctly only because of whichever other stylesheet the page happens to load.

## The two that have already gone wrong

**The encyclopaedia has a different palette, and it has leaked.** Its stylesheet
defines `--green #33ff33` and `--amber #ffcc33` against the game's `#4dff5c` and
`#ffb444`, under a comment reading *"Sharing the palette is the right amount of
sharing"* — which is the opposite of what the file then does. And two of its
greens have escaped into the game's own stylesheet: `style.css` lines 161 and
700 use `rgba(51, 255, 51, 0.18)` for the two `.sysmore` rules. Nothing says
whether the second palette is deliberate. **That is the first question to
answer**, because the whole shape of the fix depends on it: one palette with a
recorded exception, or two palettes named as two.

**`posterise.py`'s copy is one-third wrong.** It says *"the game's greens, from
src/style.css"* and defines `DARK = (0x00, 0x08, 0x02)`. `style.css` has no such
value — it uses `background: #000`. Two of the three are real copies; the third
is the tool's own invention presented as one.

## The pattern that already works, twice

This is not an unsolved problem in this codebase — it is a solved problem
applied in two places and nowhere else.

- **`--sight-r`** is computed at boot from `AIM_ASSIST` through the real
  projection (`game.ts:619`) and written onto the document. The crosshair ring
  is therefore drawn to the angle the gun actually forgives, not to taste.
- **`--chart-side`** is passed in from `LOCAL_CANVAS`, with a comment saying why
  it is not repeated in the stylesheet.

Both are one-way: TypeScript owns the number, CSS receives it. That is the
direction this item should generalise.

## What to work out

- **The palette question above**, first.
- **Which direction each value flows.** A colour is probably owned by
  TypeScript and pushed into CSS at boot as a custom property, because canvas
  drawing needs it as a value and CSS only needs it as a variable. A layout
  number like `#screen { top: 40% }` is probably owned by CSS and nothing in
  TypeScript needs it — those may simply be left alone and said to be left
  alone.
- **The boot-time push.** One loop that writes the palette onto
  `documentElement.style`, in the shell, beside the `--sight-r` write that is
  already there. Then the three stylesheets keep `var(--hud-green)` and stop
  defining it — and a page that loads no stylesheet still works, which is what
  `viewer.css` currently depends on by accident.
- **The `rgba()` spellings.** Sixteen-plus sites write the palette in decimal
  with an alpha. `color-mix()` or a `--hud-green-rgb` triple both solve it;
  pick one.
- **`posterise.py` cannot import anything.** It is Python and it runs offline.
  The honest answer is a stated copy with the authoritative source named — which
  is what it attempts. Fix `DARK`'s comment so the claim is true, and consider
  whether the gate below should read the CSS and check it.
- **`SIGHT_Y` stays duplicated.** docs/TODO/90 moves it as a game constant and
  records the CSS twin as a deliberate exception. Do not undo that here without
  a reason; if the boot-time push makes it free, take it.

## What is NOT in scope

- **Pure drawing geometry in `hud.ts`** — bracket radii, arrow polygons, scanner
  ring fractions. Single-use numbers describing a shape nobody else needs.
  docs/TODO/90 excluded them and so does this.
- **Anything docs/TODO/90 is moving.** `SCANNER_RANGE`, the gauge thresholds,
  `ASSUMED_TARGET_SPEED`, the chart projection — those are game rules that
  happen to live in presentation files, and they belong to 90.

## Watch out for

- **A colour is not only a colour here.** The four are the game's identity, and
  the landing page, the manual and the encyclopaedia are public pages. Changing
  what anything looks like is not the job; making it have one home is.
- **`hud.ts` draws to a canvas**, so it needs the value at runtime and cannot
  read a CSS variable cheaply per frame. Read once at construction, or hold the
  hex in TypeScript and push it out — the latter is almost certainly right.
- **Two more duplications sit in the same files and are worth taking while you
  are in there**: the bloom parameters `(0.55, 0.5, 0.15)` and the
  `min(devicePixelRatio, 2)` clamp are byte-identical in `render-stack.ts` and
  `viewer/stage.ts` (and the clamp again in `encyclopaedia/chart.ts`). Whether
  the viewer's 55° camera against the game's 60° is deliberate is unstated, and
  `IN_VIEW_DEG` is derived in prose from "a 60-degree field of view".
- **`viewer/main.ts:177,181` hand-copies two roster colours** — `0xff9a5c` and
  `0xffffff` are `SPECS.pirate[0].color` and `SPECS.trader[0].color`. Those are
  ship data, not palette, and should read the roster.

## Acceptance

- Each of the four colours has one home, and the three stylesheets, the canvas
  code and the two dev pages all reach it from there.
- `viewer.css` no longer depends on another page's stylesheet having been
  loaded.
- The encyclopaedia's palette is either the same one or is named as a second
  one on purpose, in writing — and `style.css` stops using its green.
- `posterise.py`'s comment is true.
- A gate: nothing outside the one home spells a palette colour, in hex or in
  `rgba()`. Break it and confirm it goes red.
- Nothing looks different. Screenshots before and after, or Chris's eye.

## Verify

```sh
grep -rn "4dff5c\|4DFF5C" src | wc -l
grep -rn "77, *255, *92" src | wc -l
grep -rn "hud-green" src | wc -l
grep -rn "33ff33\|51, *255, *51" src
# the last one should return the encyclopaedia only, and today does not
```
