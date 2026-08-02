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
> `src/game/brains.ts`, and `npm test` reads that file rather than a list, so
> the regression gate cannot end up measuring a brain nobody flies.

## The five phases

| phase | trains | against | command |
| --- | --- | --- | --- |
| `attack` | a pirate | scripted trader | `npm run train -- attack --gens 400 --pop 64 --eps 3` |
| `evade` | an unarmed trader | trained pirate | `npm run train -- evade --gens 400 --pop 64 --eps 3` |
| league r2 | pirate v2 | trained evader | `npm run train -- attack --opponent trader-evade --seed-brain pirate-attack --out pirate-attack-r2 --gens 300 --pop 48` |
| `pack` | 3 shared-brain pirates | armed scripted trader | `npm run train -- pack --gens 300 --pop 48` |
| `defend` | an ARMED trader ("Jameson") | 2× `pirate-attack-r2` (the default; `--opponent` overrides it, and the SHIPPED pirate is `pirate-attack-g3`) | `npm run train -- defend --gens 300 --pop 48` |

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

1. Train it (`--out my-brain`).
2. Evaluate it — beat the incumbent's tournament row before shipping.
3. Import it where the incumbents are imported: `src/game/brains.ts` (one
   `brainFromFile` block and one line in `LOADED`), viewer scenarios →
   `src/viewer/main.ts`. Any observation width works — 14, 18 or 26; `npc.ts`
   picks the widest encoder the brain has inputs for.
4. Name it in `src/game/brain-names.ts`: one `BrainName`, one `BrainSelection`
   flag, one line in the rule, one row in `SELECTIONS`. That is what makes it
   pickable in both places and reportable by name — the combat trainer's
   `SIM_BRAINS` list is derived from it.
5. `npm run build` bundles the JSON weights (~15 KB gzipped each).

In-game A/B: brain selection is STATE, not a global — `state.brains`
(`BrainSelection` in `src/game/brain-names.ts`). Two ways in, and neither is a
flag: the **LIVE BRAINS (CAREER)** row on the combat trainer's setup panel (`T`
at any station) picks one policy for the whole galaxy, and from a console the
one documented handle does the same — `__game.state.brains.scripted = true`
reverts every ship to the scripted AI, and `legacy` / `sharp` / `engine` /
`pack` / `t29` / `packT29` / `defendT29` swap in the unshipped candidates. It is
in the snapshot, so a reload keeps flying what you chose.

## The Jameson autopilot (end-to-end economy test)

The trade-run experiment from docs/JAMESON-TRIALS.md is a browser-console
harness: it drives the *real game* through `window.__game` and flies combat
through `window.__policyKit`. See `train/jameson-autopilot.js` — paste it
into the DevTools console with the game open, then:

```js
await __auto.runTrial('Lave', 'Leesti', 6)   // 6 legs, prints the ledger
```

It backs up your commander save first and restores it afterwards.
