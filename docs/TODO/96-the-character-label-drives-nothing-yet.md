# 96 — The character label drives nothing in the world yet (phase 2)

**Kind:** feature · **Severity:** medium · **Size:** medium
**Depends on:** the Character phase-1 commit (`c7d90d6`) · this is its planned phase 2

## Where we are

Phase 1 shipped a `disrepute` number on the commander and a **Character** label
on the status screen (Honest → Dubious → Dodgy → Shady → Notorious → Cutthroat,
Honest at the top). Shady deeds raise it, time erodes it. The rule is
`game/character.ts`; the numbers are `constants/character.ts`.

**It is deliberately the label alone.** Nothing in the world reads `disrepute`
yet — a Dodgy pilot is treated exactly like an Honest one. Phase 2 is making the
galaxy react to the name it already tracks.

## What phase 2 does

Wire `disrepute` into the two places "how you're seen" already turns into "what
happens to you", plus the hermit:

1. **`markOf` / `pirateThreat` (`game/threat.ts`).** `Mark` already carries
   `notoriety` (regional heat) and `combatScore` (fame); add `disrepute` as a
   third signal so a Dodgy-or-worse pilot draws a warier or worse pirate
   reception — more challengers, a higher tier, or a fresh reception more often.
   `markOf` is at `game/threat.ts:49`; `pirateThreat` reads the `Mark` just
   below it. Decide how `disrepute` COMBINES with the two signals already there
   rather than bolting on a fourth independent term — the point of routing it
   through `markOf` is that it stays one "how you're seen" model.

2. **The hermit hail (`world-step.ts` ~674, `openHermitTrade`).** A known
   hermit-killer is turned away — the beacon still blinks, but the hail reads
   "WE KNOW WHAT YOU DID" and does not open trade above some disrepute
   threshold. This is the direct, thematic punishment for cracking hermits: you
   lose the no-scan contraband market you needed them for.

3. **(Optional, only if the outlaw path is wanted — see below.)** The reverse:
   a smuggler in good odour gets better hermit prices, and pirates occasionally
   pass a sufficiently notorious pilot by. Skip unless Chris wants a *playable*
   outlaw path, not just a punishable one.

## Decisions already made (don't relitigate)

- **Slow decay** — people forget, but slowly (phase 1, `DISREPUTE_DECAY`).
- **Honest is the top rung** — the scale only ever describes a fall from grace.
- **One galaxy-wide number**, not regional like heat — your name, not a place.
- **Deed/decay values are tunable** starting points, set in `constants/character.ts`.

## Open questions for whoever picks this up

- **How far does the outlaw path go?** Chris's lean was "mostly a lawful game,
  the underworld is a risk and a service" — so punishment-first (items 1–2),
  and item 3 only if he still wants a playable outlaw side. Confirm before
  building the carrot half.
- **How does `disrepute` combine in `markOf`?** Additive with `notoriety`, a
  separate multiplier on the reception, or a shift in the challenge rate
  (`CHALLENGE_RATE`, `constants/threat.ts`)? Pick the one that reads as "your
  reputation precedes you" without erasing the cargo-and-fame model.
- **Hermit refusal: binary or graded?** Turned away above a threshold (simple),
  or worse prices sliding into refusal (richer). Binary is the cheaper first cut.

## Watch out for

- **This is a balance change.** `pirateThreat` is what `npm run campaign`'s 33
  rows are tuned against (`constants/threat.ts` header). Touching it means
  re-running the campaign and reading the aggregate, not eyeballing one fight.
- **The trainer builds its own `Mark`.** `combat-sim-scenarios.ts` /
  `combat-sim.ts` size the reception with `markOf`/`pirateThreat`, and the
  exercise flies a clone "with no cargo and no reputation". Decide whether the
  trainer's clone has a `disrepute` of 0 (a clean slate to practise against) or
  a knob on the setup panel — and thread it through the `Mark` it builds either
  way, or the trainer and the sky will disagree about what a Mark contains.
- **Fly it before tuning.** The reception change is a feel change; the campaign
  gives the aggregate but a human should meet a Dodgy pilot's pirates first.
