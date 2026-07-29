# Reproducing the AI training runs

Everything here runs in plain Node (≥ 22.6, for `--experimental-strip-types`)
with **zero extra dependencies** — the trainer imports the same TypeScript
sim the game uses, directly.

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

> **Footgun warning:** training OVERWRITES the committed brain files, and the
> game imports them at build time — `git checkout src/ai-training/brains` to restore
> the shipped ones. The brains referenced by the game are
> `pirate-attack-r2.json` and `jameson-defend.json`.

## The five phases

| phase | trains | against | command |
| --- | --- | --- | --- |
| `attack` | a pirate | scripted trader | `npm run train -- attack --gens 400 --pop 64 --eps 3` |
| `evade` | an unarmed trader | trained pirate | `npm run train -- evade --gens 400 --pop 64 --eps 3` |
| league r2 | pirate v2 | trained evader | `npm run train -- attack --opponent trader-evade --seed-brain pirate-attack --out pirate-attack-r2 --gens 300 --pop 48` |
| `pack` | 3 shared-brain pirates | armed scripted trader | `npm run train -- pack --gens 300 --pop 48` |
| `defend` | an ARMED trader ("Jameson") | 2× pirate-attack-r2 | `npm run train -- defend --gens 300 --pop 48` |

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
CLI args is bit-identical on the same Node build and platform. Across
platforms expect small numeric drift (Math.tanh/acos aren't spec-mandated to
be correctly rounded) — judge against the reference columns rather than
demanding exact equality there.

## Wiring a new brain into the game

1. Train it (`--out my-brain`).
2. Evaluate it — beat the incumbent's tournament row before shipping.
3. Import it where the incumbent is imported:
   pirates → `src/game/npc.ts` (`pirateBrainFile`), armed traders →
   same file (`defendBrainFile`), viewer scenarios → `src/viewer/main.ts`.
4. `npm run build` bundles the JSON weights (~40 KB each).

In-game A/B: `window.__scriptedPirates = true` reverts every ship to the
scripted AI at runtime.

## The Jameson autopilot (end-to-end economy test)

The trade-run experiment from docs/JAMESON-TRIALS.md is a browser-console
harness: it drives the *real game* through `window.__game` and flies combat
through `window.__policyKit`. See `train/jameson-autopilot.js` — paste it
into the DevTools console with the game open, then:

```js
await __auto.runTrial('Lave', 'Leesti', 6)   // 6 legs, prints the ledger
```

It backs up your commander save first and restores it afterwards.
