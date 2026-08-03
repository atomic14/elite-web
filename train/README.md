# Reproducing the AI training runs

Everything here runs in plain Node (≥ 22.6, for `--experimental-strip-types`),
and the trainer imports **the game itself** — `NpcShip`, `PlayerShip`,
`gunnery.ts`, `collisions.ts`, `rng.ts`, stepped at the game's own `FIXED_DT`.
three.js is the only dependency and it runs headless; there is no canvas and
no WebGL anywhere in a training run.

There used to be a second physics (`src/ai-training/core.ts`) kept in step by
hand. It is deleted. What that means for you: **a change to a combat number is
a change to the training environment**, so the shipped brains are stale the
moment you touch `NPC_COOLDOWN_LO`, `IMPACT.ram`, a hull's energy bank or
the player's flight envelope. That is the trade — nothing can silently drift any
more, and nothing is free either.

## Quick start

```sh
npm install                       # only needed for the game/viewer, not training
npm run train -- attack           # ~4 min on one laptop core
npm run train -- evade            # trains against the pirate you just made
node --experimental-strip-types --no-warnings train/evaluate.ts 40
```

Each run prints per-generation `best / mean / scripted-ref` fitness, appends
a JSONL curve to `train/logs/`, and writes the winning brain to
`src/ai-training/brains/<name>.json` (with its hyperparameters and score in `meta`).

> **Always pass `--validate-select`.** Without it the final brain is chosen by
> comparing scores across generations that used different episode seeds, which
> picks the luckiest generation rather than the best genome.
>
> **Footgun warning:** training OVERWRITES the committed brain files, and the
> game imports them at build time — `git checkout src/ai-training/brains` to restore
> the shipped ones. Which brains the game flies is decided in
> `src/game/brain-names.ts` — `SHIPPED_BRAINS` is the one line that changes a
> default — and `src/game/brains.ts` turns a name into loaded weights. `npm
> test` reads those files rather than a list, so the regression gate cannot end
> up measuring a brain nobody flies.

## The five phases

| phase | trains | against | command |
| --- | --- | --- | --- |
| `attack` | a pirate | scripted trader | `npm run train -- attack --gens 400 --pop 64 --eps 3` |
| `evade` | an unarmed trader | trained pirate | `npm run train -- evade --gens 400 --pop 64 --eps 3` |
| league | a pirate again | a trained evader | `npm run train -- attack --opponent <an evade brain> --seed-brain pirate-attack-g3 --out my-brain --gens 300 --pop 48` |
| `pack` | 3 shared-brain pirates | armed scripted trader | `npm run train -- pack --gens 300 --pop 48` |
| `defend` | an ARMED trader ("Jameson") | 2× `pirate-attack-g3`, the shipped pirate (`--opponent` overrides it) | `npm run train -- defend --gens 300 --pop 48` |

A league or `evade` run needs a frozen opponent BY NAME, and the only weights
files in the tree are the three the game flies (TODO 57): train the opponent you
want first, or point `--opponent` at one of the three. `--out` defaults to the
phase's shipped brain, which is the loud overwrite this file has always warned
about and did not do — `git checkout src/ai-training/brains` restores.

Flags: `--gens --pop --eps --elites` (numbers), `--opponent <brain-name>`
(loads `src/ai-training/brains/<name>.json` as the frozen opponent),
`--seed-brain <name>` (start the population from a previous champion —
league play), `--out <name>` (output brain name).

## How to tell it worked (don't trust the training fitness)

```sh
node --experimental-strip-types --no-warnings train/evaluate.ts 40
```

runs the tournament on **held-out seeds** (base 10,000,019 — training seeds
never exceed ~400k), against a scripted-AI upper bound and a random-policy
floor, reporting kill rate / time-to-kill / accuracy / survival / losses /
flanking spread per matchup. The numbers we shipped against are recorded in
[docs/TRAINING-LOG.md](../docs/TRAINING-LOG.md); the raw table for the
current brains is `train/logs/tournament-final.txt`.

The whole trainer is seeded and single-threaded, so a rerun with identical
CLI args is bit-identical on the same Node build and platform — verified by
running the same command twice and diffing both the generation curve and the
saved weights. Note the single-threaded part is now load-bearing rather than
incidental: an episode reseeds the world's own PRNG (`game/rng.ts`), so
episodes have to be run one at a time and not interleaved. Across
platforms expect small numeric drift (Math.tanh/acos aren't spec-mandated to
be correctly rounded) — judge against the reference columns rather than
demanding exact equality there.

## Wiring a new brain into the game

**`src/ai-training/brains/` holds exactly the three the game flies, and
`npm test` fails on a fourth file or a missing one** (TODO 57). So a candidate
is either being compared or being promoted, and the two are different amounts of
work:

*To COMPARE it* — no game changes at all:

1. Train it (`--out my-brain`), which leaves the weights in the directory.
2. Add the stem to `CANDIDATES` in `train/evaluate.ts`. Every solo, pack and
   defence table it belongs in grows a row, and so does the flight probe.
3. `npm run evaluate`, and fly it: the combat trainer at `T` needs step 4 below,
   so until then the honest comparison is the tournament plus the probe.
4. Delete it or promote it. The guard will report the extra file until you do —
   that is the decision it exists to force.

*To PROMOTE it* — now the game has to be able to fly it:

5. Import it where the incumbents are imported: `src/game/brains.ts` (one
   `brainFromFile` block and one line in `LOADED`). Any observation width
   works — 14, 18 or 26; `npc.ts` picks the widest encoder the brain has inputs
   for. The combat viewer's rows ask `brains.ts` for the shipped policy by role,
   so `src/viewer/main.ts` needs nothing unless you want a row of its own.
6. Name it in `src/game/brain-names.ts`: one `BrainName`, one row in
   `SELECTIONS` (and a `BrainSelection` flag if it is an alternative rather than
   a replacement), one line in the rule, and one entry in `BRAINS` — the two or
   three words a pilot picks it by (`HOLDS OFF`) beside the measured line they
   compress (`A GANG THAT WATCHES ITS FLEET AND HOLDS OFF — MEDIAN RANGE 1447
   …`). Both, or `npm test` fails: a brain the picker offers with no name is a
   filename on the row, and one with no line is a claim with no probe behind it.
   That is what makes it pickable in both places and reportable by name — the
   combat trainer's `SIM_BRAINS` list is derived from it.
7. If it REPLACES an incumbent, delete the incumbent's weights: the directory
   guard is what keeps "what ships" and "what is in the bundle" the same set.
8. `npm run build` bundles the JSON weights (~15 KB gzipped each).

In-game A/B: brain selection is STATE, not a global — `state.brains`
(`BrainSelection` in `src/game/brain-names.ts`). Two ways in, and neither is a
flag: the **LIVE BRAINS (CAREER)** row on the combat trainer's setup panel (`T`
at any station) picks one policy for the whole galaxy, and from a console the
one documented handle does the same — `__game.state.brains.scripted = true`
reverts every ship to the scripted AI and `__game.state.brains.pack = true` puts
the gang policy on every pirate. Those two are the whole of `BrainSelection`:
the other six flags each named an unshipped candidate's weights file and went
with them in TODO 57. A save carrying one still loads and flies the shipped
brains. It is in the snapshot, so a reload keeps flying what you chose.

## The Jameson autopilot (end-to-end economy test)

The trade-run experiment from docs/JAMESON-TRIALS.md is a browser-console
harness: it drives the *real game* through `window.__game` and flies combat
through `window.__policyKit`. See `train/jameson-autopilot.js` — paste it
into the DevTools console with the game open, then:

```js
await __auto.runTrial('Lave', 'Leesti', 6)   // 6 legs, prints the ledger
```

It calls `useHarnessSaves()` first, which moves the whole page — the running
game's autosave included — into a scratch namespace for the life of the tab.
Nothing it does can reach a real save, and nothing puts the namespace back:
reload the page to play your career. Backing a save up and restoring it in a
`finally` was what this used to do, and it was not enough, because the world
autosaves every 20 seconds and a tab left running wrote over the restore.
