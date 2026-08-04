# 82 — The tournament and the survivability tool do not score what ships

**Kind:** training methodology · **Severity:** medium · **Size:** small
**Depends on:** none · fallout from `d563e3d`, same family as 81

## Why

Since `d563e3d` a pirate flies the scripted attack run. `train/flight-probe.ts`
was updated for it and says so in as many words:

> `null` means the SCRIPTED attack run, which is what every pirate flies since
> `d563e3d`. This file could not measure the shipped AI at all until that was
> true.

and its command line leads with it: `printFlightShapes(['scripted',
...TRAINED_ALTERNATIVES], …)`.

**`npm run evaluate` was not updated, and neither was `npm run survivability`.**

`train/evaluate.ts` ends with

```ts
printFlightShapes([SHIPPED_PIRATE, SHIPPED_PACK, ...CANDIDATES], …);   // evaluate.ts:304
```

where `SHIPPED_PIRATE` is the string `'pirate-attack-g3'`. So the tournament's
flight table has two rows and neither is the AI the game sends at a player:

    ## the shape of the fight — 30 held-out episodes, target stops and turns to fight
    | pirate-attack-g3           |  209 | 100% |  85/230/936 |  41 | 0.00 | 0.0s | 0.20 |  5.6% |
    | pirate-pack-r4-selectonly  |  144 | 100% | 396/1450/2905 | 37 | 0.83 | 0.0s | 0.63 | 13.8% |

The same three constants label every table above it `(SHIPPED)`.

`train/survivability.ts` — the tool CLAUDE.md calls "the bot answer" to *can a
shielded commander survive a gang?* — loads three brains and flies two of them:

```ts
const BRAIN_NAMES = {
  pack: process.env.PACK_BRAIN ?? 'pirate-pack-r4-selectonly',
  solo: process.env.SOLO_BRAIN ?? 'pirate-attack-g3',
  ...
```

Its whole output is eight rows of `pirate-attack-g3 (opportunists)` and
`pirate-pack-r4-selectonly (gangs)`. No pirate in the game is either of those.

## What is actually failing

The tools are correct; their subject moved.

**It matters most for `survivability.ts`**, because the question it asks is a
balance question about the live game and the answer it gives is about two
policies that only appear behind an A/B flag. Its current rows say a gang of four
strips 25-40% of the commander's pools and destroys her 0-1% of the time. The
scripted run is a materially different attacker — it makes 4.4 attack runs an
episode where `pirate-attack-g3` makes 0.00, and it takes 16.2% of a hauler's
pools against g3's 12.8% — so the number Chris would read off that table is not
the number the game produces.

**For `evaluate.ts` it matters in two ways.** The `(SHIPPED)` label is simply
wrong on three rows. And the tool's stated principle 2 is "BASELINES — every
trained policy is scored alongside the scripted AI ... The interesting number is
the gap" — which the 1v1 tables do honour (`scripted pirate (baseline)` is
there), but the flight-shape table, the pack tables' `3x scripted pirates` row
aside, and the defence section do not: the defence section flies **two
`pirate-attack-g3`** at the defender, so the shipped defence policy is scored
against an attacker no commander meets.

That last one is not only cosmetic. `jameson-defend-g2` is trained against
`scripted` (it is `evolve.ts`'s default opponent for the defend phase) and
probed against `scripted` (`defence-probe.ts` hard-codes `{ kind: 'scripted' }`),
so `pirate-attack-g3` is the one attacker it has never seen. Over 800 held-out
fights on the defence fixture:

| attackers | cumulative pools kept | broke | killed | died |
| --- | --- | --- | --- | --- |
| scripted (trained and probed against) | **88.5%** | 58.8% | 41.6% | 0 |
| `pirate-attack-g3` (never seen) | **79.6%** | 52.2% | 47.3% | 1 |

Nine points of generalisation gap, and the tournament reports the second world
while the promotion was decided in the first.

## What is NOT the problem

- **Not the three `SHIPPED_*` constants being wrong as identifiers.** They name
  the three files in the bundle, which is what `tryLoad` needs. It is the LABEL
  and the omission that are wrong.
- **Not `CANDIDATES` being empty.** That is the resting state and is documented.
- **Not the 9-point defence gap being a disqualifier.** She still keeps four
  fifths of her pools and dies once in 800. It is a generalisation figure, not a
  failure; it is here because the tool that would have shown it prints the wrong
  fixture with the wrong label.
- **Not `flight-probe.ts`.** It is right, and it is the model for the fix.

## What to work out

- **Add `scripted` to `evaluate.ts`'s `printFlightShapes` call** and to the
  defence section's attackers, or state deliberately why the tournament compares
  trained policies against each other only.
- **Give `survivability.ts` a scripted row.** It already resolves its brains
  from env-overridable names; a third row costs one entry and is the only row
  that answers the question in its own title.
- **Retire or re-word `(SHIPPED)`.** `game/brain-names.ts` already exports
  `SHIPPED_BRAINS`, `pirateBrainNameFor` and `defenceBrainNameFor`; either derive
  the label from them or drop it. Note that `flight-probe.ts` deliberately does
  NOT derive its list from `SHIPPED_BRAINS` and says why ("deriving this would
  collapse the list and quietly drop the things the probe exists to compare
  against") — so the fix is to derive the LABEL, not the list.
- **Decide whether the defence phase should train against more than one
  attacker.** `defence-fight.ts` rotates four axes of the FIGHT and pins the
  OPPONENT at one; the 88.5 → 79.6 gap is the size of what that costs. This is a
  decision, and it belongs beside 65's.

## Watch out for

- **Adding a scripted row to `survivability.ts` will move its headline.** State
  the change in docs/TRAINING-LOG.md rather than silently replacing the table.
- **`evaluate.ts` already takes several minutes.** Adding rows adds time; N is a
  command-line argument and the flight shapes run at `max(12, N/2)`.
- **Do not conclude from the 9-point gap that the defence brain should be
  retrained against g3.** g3 is not what a commander meets either. If the defence
  opponent is widened it should be widened toward what the game sends — which is
  the scripted run at four different tactics, and a gang of it.

## Acceptance

- Every table in `npm run evaluate` that carries a `(SHIPPED)` label either
  scores the policy the game flies or says which policy it is scoring and why.
- `npm run survivability` has a row for the scripted attack run.
- The generalisation figure above is in docs/TRAINING-LOG.md beside the
  promotion it qualifies.

## Verify

```sh
npm run evaluate            # the flight-shape table at the end has no `scripted` row
npm run survivability       # every row is pirate-attack-g3 or pirate-pack-r4-selectonly
npm run flight-probe -- 40  # this one DOES lead with `scripted`
```

The defence generalisation figure is the snippet in docs/TODO/80's Verify with
the pirates swapped for `{ kind: 'policy', brain: g3 }`.
