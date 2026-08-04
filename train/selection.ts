// WHAT A CHAMPION IS CHOSEN BY — the selection rule, in one file.
//
// `train/evolve.ts` runs the search; this says which genome comes out of it. It
// is a separate file for the same reason `train/defence-fight.ts` is: the rule
// has to be assertable. It was two expressions inside a script that parses argv
// and trains on import, so nothing could ask it a question, and the answer to
// "does a defender that fights outrank one that does not" was found by reading
// arithmetic rather than by running it. `test/selection.test.ts` runs it now, on
// two hand-built genomes.
//
// ## The rule, in one line
//
//   score = 0.75 x outcome(0..1) + 0.25 x shaped/full-scale(0..1)
//
// Both terms are fractions of a stated whole, so THE RATIO IS STATED: the
// outcome owns three quarters of the score and the shaping term can move a
// genome by at most a quarter, whatever the phase's fitness function happens to
// be scaled in.
//
// It was `win * 1000 + clamp(shaped, ±499)`, and the clamp was written so that
// shaping could break ties "within an outcome band rather than ever outranking a
// better outcome". It does that — and real shaped values come out between 8 and
// 19 against a bound of 499, so the shaping term contributed 1.9% of the score
// and the tie-break never fired (docs/TODO/65). A ±499 clamp on a quantity that
// ranges 8-19 is not a policy about how much shaping should count; it is an
// accident of scale, and this file replaces it with a decision.
//
// ## What "won" means, per phase, and why the two sides differ
//
// The polarity trap first, because it has cost four retrains and the warning
// belongs wherever `outcomeOf` lives: in `evade` and `defend` THE GENOME IS THE
// TRADER, so the trader dying is a FAILURE. Scoring every phase by damage done
// to the trader selected the evader and the defender that died most often —
// trader-evade fell from 14.44 to 2.09 and jameson-defend from 22.43 to 1.34
// across four retrains before anyone spotted it, and the physics was blamed
// first. Any change here needs that scepticism, including this one.
//
//   attack, pack   the share of the target's pools TAKEN OFF HER
//                  (`targetDamageShare`) — unchanged, and cumulative since
//                  docs/TODO/63 gave her a recharge.
//   evade          the share she KEPT, zero if she died. Getting away untouched
//                  is the whole job of an evader, so there is deliberately no
//                  fighting term here — see below.
//   defend         the share she kept AND the share of the attacking force she
//                  broke. Surviving is necessary and not sufficient: a commander
//                  fits the combat computer to help her FIGHT, not to fly her
//                  away, and a policy that survives by never being in the fight
//                  must not be able to top the table.
//
// ## Why the defender's outcome is not terminal `hp`
//
// It was `ep.trader.hp` — her pools at the final frame — and that quantity has
// two defects, one of which arrived with docs/TODO/63:
//
//   - **Shooting was worth almost nothing.** At 1000x for the outcome and a
//     shaping term worth 1.9% of the score, killing an entire pirate paid 3
//     points where 1% of her pools paid 10. Killing was rational only if the
//     engagement cost less than 0.30% of her pools, which it never does, so a
//     policy that flew away outranked every policy that fought. `jameson-defend-
//     t62` fired ZERO shots across 240 held-out fights and still outranked the
//     shipped brain on this metric.
//   - **Finishing was worth less than dawdling.** With the pools recharging,
//     terminal `hp` is close to "how long since she was last hit". A pilot that
//     CLEARS the fight ends the episode early and heals for less of the clock,
//     so it reads lower however well it flew. Measured: a hand-built turret that
//     kills 75.7% of its attackers and clears 15 of 24 fights takes the LEAST
//     cumulative damage of any pilot tried (247 points against a runner's 272)
//     and ends with the LOWEST terminal `hp` of the five (86.9% against 89.7%).
//
// `1 - targetDamageShare()` is the same quantity with neither defect: cumulative
// points taken off her, over her own pools, which is what `Episode` already
// gives the attack and pack phases from the other side.
//
// ## The ratio, in the units docs/TODO/65 stated the defect in
//
// Against two attackers, with `DEFENCE_POOLS_KEPT` at 0.6 and
// `DEFENCE_ATTACKERS_BROKEN` at 0.4:
//
//   | | worth at selection | was |
//   |---|---|---|
//   | 1% of her pools | 0.0045 | 10 points |
//   | destroying one of two attackers | 0.15, plus the shaping | 3 points |
//
// So destroying one of two attackers is worth about a THIRD of her pools, where
// it used to be worth 0.3% of them. That is the deliberate statement, and it is
// deliberate in this direction: a dead attacker stops shooting for the rest of
// the fight, and her pools come back while it does not. Trading a third of her
// shields to halve the incoming fire is a good trade and the rule should say so.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import type { Episode } from '../src/ai-training/scenario.ts';

export type Phase = 'attack' | 'evade' | 'pack' | 'defend';

/**
 * How the defender's outcome divides between keeping her ship and breaking
 * theirs. They sum to 1, so the outcome stays a 0..1 fraction.
 *
 * Not 50/50: keeping the ship is the larger half because a defender who trades
 * all her survival for kills has overcorrected, and this rule exists because the
 * previous one was an overcorrection in the other direction. At these weights a
 * policy cannot buy a kill with an arbitrary amount of damage — against two
 * attackers the kill is worth 0.20 of the outcome and the pools it would cost to
 * get it are worth 0.6 x that share.
 */
export const DEFENCE_POOLS_KEPT = 0.6;
export const DEFENCE_ATTACKERS_BROKEN = 0.4;

/**
 * How much of the champion score the SHAPED fitness may MOVE — the swing from
 * the worst shaped fitness a phase can produce to the best, with the outcome
 * held still. It is not "a quarter of every score": the share of a particular
 * score depends on how good that genome's outcome was, and `test/selection.
 * test.ts` asserts the swing rather than the share for exactly that reason.
 *
 * A quarter, and the number is the whole point of stating it. The outcome is
 * coarse — it says what winning is — and the shaped fitness is fine-grained and
 * says which way is up: `fitnessDefend` pays for damage dealt long before a kill
 * lands, and `fitnessAttack` pays for the tail position and the engagement. A
 * quarter is enough for that gradient to separate two genomes with the same
 * outcome and not enough to reorder two genomes with different ones, which is
 * what "break ties within an outcome band" was always meant to mean.
 */
export const SHAPED_SHARE = 0.25;

/**
 * The shaped fitness at which the shaping term saturates, per phase — MEASURED,
 * over `evolve.ts`'s own 24 validation seeds on 2026-08-04, not derived from the
 * fitness functions' algebra:
 *
 *   attack   -3.75 for a random policy, 12.06 for `pirate-attack-g3`, 17.95 for
 *            the scripted attack run, 27.26 at its best single episode.
 *   defend    8.55 for `jameson-defend-g1`, 11.3-11.6 for the three scripted
 *            pilots that never shoot, 17.61 for `holding`, 19.05 for the
 *            hand-built turret in `test/selection.test.ts`.
 *   pack      4.55 for `pirate-pack-r4-selectonly`, 5.29 scripted, 19.34 at its
 *            best single episode.
 *   evade    13.6-16.7 across every scripted pilot — a phase whose shaped
 *            fitness barely discriminates, which is a fact about `fitnessEvade`
 *            and not something a scale should hide.
 *
 * Below 0 and above the scale the term is clamped, so a genome cannot buy the
 * champion slot with an outlying shaped score, and a phase whose fitness goes
 * negative (attack's escape penalty is -6) reads zero rather than dragging the
 * score below what a dead genome gets.
 */
export const SHAPED_FULL_SCALE: Record<Phase, number> = {
  attack: 24,
  evade: 20,
  pack: 20,
  defend: 20,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** The two halves of a defender's outcome, for reporting as well as scoring. */
export interface DefenceTerms {
  /** share of her three pools never taken off her, cumulative */
  kept: number;
  /** share of the attacking force's banks she took off them */
  broken: number;
}

export function defenceTerms(ep: Episode): DefenceTerms {
  return {
    kept: clamp01(1 - ep.targetDamageShare()),
    broken: ep.attackerDamageShare(),
  };
}

/**
 * HOW WELL DID THIS GENOME DO ITS JOB, 0..1 — the outcome, per phase.
 *
 * It was "did the trader die", and TODO 29 retired that: the episode's target is
 * the commander now, three 255-point pools hit for 9 to 21 points a time, so a
 * kill is rare and a binary that is always zero cannot rank anything. Every term
 * below is a share for that reason — continuous, hill-climbable, and ordered the
 * way the binary was.
 *
 * DEATH IS ZERO on the two phases where the genome is the trader, rather than
 * being one more point off a share. It is the one outcome a defender cannot
 * trade for anything, and until docs/TODO/62 put missiles in the world nothing
 * could kill her inside 45 seconds, so the column was saturated and the
 * distinction cost nothing to make. It is 4 to 6 episodes in 240 now.
 */
export function outcomeOf(phase: Phase, ep: Episode): number {
  if (phase === 'attack' || phase === 'pack') return ep.targetDamageShare();
  if (!ep.trader.alive) return 0;
  if (phase === 'evade') {
    // No fighting term, and that is the phase saying what it is for: an evader's
    // job is to be somewhere else, `fitnessEvade` already pays the escape, and
    // nothing in the game flies an evade policy — it exists to produce training
    // opponents. Whether GETTING CLEAR belongs in the outcome (it ends the
    // episode, so it is the same "finishing is punished" shape as the defender's)
    // is a live question for whoever revives the phase; this change does not
    // answer it, because there is no run to judge the answer against.
    return clamp01(1 - ep.targetDamageShare());
  }
  const t = defenceTerms(ep);
  return DEFENCE_POOLS_KEPT * t.kept + DEFENCE_ATTACKERS_BROKEN * t.broken;
}

/** The shaping term, on the outcome's own 0..1 scale. */
export function shapedTerm(phase: Phase, shaped: number): number {
  return clamp01(shaped / SHAPED_FULL_SCALE[phase]);
}

/**
 * The champion score: what `evolve.ts` keeps the best of.
 *
 * `outcome` and `shaped` are MEANS over a genome's episodes, not one episode's
 * — averaging the score per episode instead would let one lucky fight where
 * everything died count for as much as the outcome band it lands in.
 */
export function championScore(phase: Phase, outcome: number, shaped: number): number {
  return (1 - SHAPED_SHARE) * outcome + SHAPED_SHARE * shapedTerm(phase, shaped);
}

/**
 * What fraction of THIS score the shaping term accounted for — for the log, not
 * for a bound. It exceeds `SHAPED_SHARE` whenever the outcome is well short of
 * 1, which is most of the time; the bound is on the swing, above.
 */
export function shapedContribution(phase: Phase, outcome: number, shaped: number): number {
  const score = championScore(phase, outcome, shaped);
  return score > 0 ? (SHAPED_SHARE * shapedTerm(phase, shaped)) / score : 0;
}
