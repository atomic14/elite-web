// WHAT A CHAMPION IS CHOSEN BY — `train/selection.ts`, run rather than read.
//
// docs/TODO/65 was found by reading arithmetic: `evolve.ts` scored a defence
// champion by `hp * 1000 + clamp(shaped, ±499)`, real shaped values come out
// between 8 and 19, so shooting was worth 1.9% of a number that survival owned
// outright. Nothing could ask the rule a question, because the rule was two
// expressions inside a script that parses argv and starts training on import.
//
// It is a module now, and this file asks it the question the item asks:
//
//   does a defence policy that engages and kills outrank one that survives
//   without firing?
//
// It is asked of TWO HAND-BUILT GENOMES — no training, no weights file, no
// search. They are the same genome apart from ONE NUMBER, the bias on the fire
// head, so everything else about the comparison is held constant by
// construction: same flying, same geometry, same seeds, same dice. One pulls
// the trigger and one does not.
//
// The pair is also the cleanest measurement of the second defect docs/TODO/63
// left behind. The turret kills 69% of its attackers, clears more than half its
// fights, takes ~20% LESS cumulative damage than the pacifist — and ends with
// LOWER terminal `hp`, because clearing a fight ends the episode early and she
// heals for less of the clock. The rule this replaced read terminal `hp` and
// therefore ranked the pacifist first, which is asserted below so that putting
// it back fails here.

import { Episode } from '../src/ai-training/scenario.ts';
import {
  genomeSize, HIDDEN, OBS_SIZE, OUT_SIZE, type Brain,
} from '../src/ai-training/policy.ts';
import { IMPACT, playerImpactDamage } from '../src/game/impact-damage.ts';
import { defenceFight } from '../train/defence-fight.ts';
import {
  championScore, outcomeOf, defenceTerms, shapedContribution,
  DEFENCE_ATTACKERS_BROKEN, DEFENCE_POOLS_KEPT, SHAPED_SHARE, SHAPED_FULL_SCALE,
} from '../train/selection.ts';
import { check, eq } from './harness.ts';
import { DT } from './fixtures.ts';

console.log('\nchampion selection');

// --- two hand-built genomes -------------------------------------------------
//
// A policy with no learning in it: two wired reflexes and three fixed levers.
// All weights are zero except the ones named here, so what it does is readable
// off the code rather than off a training log.
//
//   layer 1  unit 0 = sign(obs[4]), the target's vertical offset in our frame
//            unit 1 = sign(obs[3]), its lateral offset
//   layer 2  passes both through
//   output   pitch head from unit 0, roll head from unit 1 — so `aim: 1` swings
//            the nose onto the threat and `aim: -1` swings it away — and the
//            throttle and fire heads from their biases alone.
interface Wiring { aim: 1 | -1; throttle: -1 | 0 | 1; fire: boolean }

function wired(o: Wiring): Brain {
  const H = HIDDEN;
  const weights = new Float32Array(genomeSize(OBS_SIZE, H));
  const GAIN = 12; // enough that tanh saturates: these are signs, not gains
  const OUT = 4;
  weights[0 * OBS_SIZE + 4] = GAIN;
  weights[1 * OBS_SIZE + 3] = GAIN;
  const layer2 = OBS_SIZE * H + H;
  weights[layer2 + 0 * H + 0] = GAIN;
  weights[layer2 + 1 * H + 1] = GAIN;
  const out = layer2 + H * H + H;
  weights[out + 0 * H + 0] = -OUT * o.aim; // pitch -1
  weights[out + 2 * H + 0] = OUT * o.aim; // pitch +1
  weights[out + 3 * H + 1] = -OUT * o.aim; // roll -1
  weights[out + 5 * H + 1] = OUT * o.aim; // roll +1
  const bias = out + OUT_SIZE * H;
  weights[bias + 6] = o.throttle === -1 ? 1 : 0;
  weights[bias + 8] = o.throttle === 1 ? 1 : 0;
  // the fire head is [don't, fire] and `act` takes the larger — this one bias
  // is the entire difference between the two genomes below
  weights[bias + 10] = o.fire ? 1 : -1;
  return { weights, obsSize: OBS_SIZE, hidden: H };
}

const turret = wired({ aim: 1, throttle: 0, fire: true });
const pacifist = wired({ aim: 1, throttle: 0, fire: false });

{
  let differ = 0;
  let at = -1;
  for (let i = 0; i < turret.weights.length; i++) {
    if (turret.weights[i] !== pacifist.weights[i]) { differ += 1; at = i; }
  }
  eq('the two genomes differ in exactly one weight', differ, 1);
  const fireBias = genomeSize(OBS_SIZE, HIDDEN) - OUT_SIZE + 10;
  eq('...and it is the bias on the fire head', at, fireBias);
}

// --- fly them ----------------------------------------------------------------
//
// The defence phase's own fight, from `train/defence-fight.ts` — 1 to 4 scripted
// pirates, one of three hulls, beam or military, with or without the energy
// unit — on `train/defence-probe.ts`'s held-out base rather than the trainer's
// validation base, because nothing here is being selected and the held-out
// seeds are the ones a claim about defenders is normally made on.
const BASE = 8_675_309;

/**
 * 96, and the number is load-bearing rather than generous.
 *
 * It was 24, and 24 was UNDER-POWERED ALL ALONG — which is the useful half of
 * this comment, because it was not obvious until something moved. The quantity
 * the last assertion in this section turns on is the terminal-hp gap between
 * the two genomes, and 24 episodes cannot resolve it. Flown on the same code at
 * three sizes, the gap is 0.7 percentage points of hull at 24, 2.4 at 48 and
 * 3.8 at 96, and the old rule's margin follows it.
 *
 * What exposed that was docs/TODO/68's vocabulary of tactics, which squeezed
 * the gap: measured like for like at 96 episodes, against HEAD before it, a
 * gang takes 257 -> 234 points off the turret and 276 -> 257 off the pacifist,
 * so the old rule's margin goes 40.0 -> 31.7. A real cost, comfortably
 * asserted. On the 24-episode fixture the same pair of runs read 73 -> 0.5,
 * which looked like a collapse and was mostly sampling — the honest lesson is
 * that a two-genome comparison on a stochastic fight needs the episodes, not
 * that the vocabulary nearly broke the claim.
 *
 * The whole file costs about a second either way, so there is nothing to buy
 * back by shrinking it. If a future change squeezes the gap again, widen this
 * rather than loosening the assertion — and if it inverts, that is a real
 * finding about the flight model and should be reported as one.
 */
const EPISODES = 96;

interface Flown {
  outcome: number;
  shaped: number;
  hp: number;
  kept: number;
  broken: number;
  kills: number;
  shots: number;
  taken: number;
  cleared: number;
  seconds: number;
  last: Episode;
}

function fly(brain: Brain): Flown {
  const f: Flown = {
    outcome: 0, shaped: 0, hp: 0, kept: 0, broken: 0, kills: 0,
    shots: 0, taken: 0, cleared: 0, seconds: 0, last: null as unknown as Episode,
  };
  for (let e = 0; e < EPISODES; e++) {
    const seed = BASE + e * 7919;
    const fight = defenceFight(seed);
    const ep = new Episode({
      seed,
      pirates: Array.from({ length: fight.count }, () => ({ kind: 'scripted' as const })),
      trader: { kind: 'policy', brain },
      traderArmed: true,
      traderClass: fight.hull,
      traderLaser: fight.laser,
      targetEnergyUnit: fight.energyUnit,
    });
    while (!ep.done) ep.step(DT);
    const terms = defenceTerms(ep);
    f.outcome += outcomeOf('defend', ep);
    f.shaped += ep.fitnessDefend();
    f.hp += ep.trader.hp;
    f.kept += terms.kept;
    f.broken += terms.broken;
    f.kills += ep.pirates.filter((p) => !p.alive).length / fight.count;
    f.shots += ep.trader.shotsFired;
    f.taken += ep.trader.damageTaken;
    f.seconds += ep.t;
    if (ep.pirates.every((p) => !p.alive)) f.cleared += 1;
    f.last = ep;
  }
  // per episode, except `cleared`, which is a count out of EPISODES
  f.outcome /= EPISODES; f.shaped /= EPISODES; f.hp /= EPISODES;
  f.kept /= EPISODES; f.broken /= EPISODES; f.kills /= EPISODES;
  f.shots /= EPISODES; f.taken /= EPISODES; f.seconds /= EPISODES;
  return f;
}

const fought = fly(turret);
const fled = fly(pacifist);

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

check(`the turret shoots (${fought.shots.toFixed(0)} shots an episode)`, fought.shots > 50);
eq('...and the pacifist never does', fled.shots, 0);
check(`the turret breaks the attacking force (${pct(fought.broken)} of its banks,`
  + ` ${pct(fought.kills)} destroyed)`, fought.broken > 0.5 && fought.kills > 0.4);
check(`...where the pacifist barely scratches it (${pct(fled.broken)})`, fled.broken < 0.05);
check(`the turret CLEARS fights (${fought.cleared}/${EPISODES} against`
  + ` ${fled.cleared}/${EPISODES})`, fought.cleared > 4 && fled.cleared === 0);
// ...and what it buys is that the fight ENDS, which is not the same claim this
// line used to make. It used to be that the turret took less damage outright —
// 263 points against the pacifist's 305 — and docs/TODO/67 changed that, not
// the selection rule: attack runs stopped flying into people, and contact was
// most of what a passive commander was taking. The pacifist's total fell by a
// fifth (305 -> 238) while the turret's barely moved. So cumulative damage no
// longer separates them and the honest statement is the trade: a pilot who
// stops to shoot is hit harder while it lasts, and it lasts a third as long.
check(`...trading a higher damage RATE for a fight that ends`
  + ` (${(fought.taken / fought.seconds).toFixed(1)}/s over ${fought.seconds.toFixed(1)}s`
  + ` against ${(fled.taken / fled.seconds).toFixed(1)}/s over ${fled.seconds.toFixed(1)}s,`
  + ` totals ${fought.taken.toFixed(0)} and ${fled.taken.toFixed(0)})`,
fought.taken / fought.seconds > fled.taken / fled.seconds
  && fought.seconds < fled.seconds * 0.75);

// THE TRAP THE OLD OUTCOME FELL INTO, measured on the pair: winning the fight
// early means healing for less of the clock, so the pilot that is hit LESS ends
// the episode with LOWER terminal hp. Under recovery, terminal hp is close to
// "how long since she was last hit" (docs/TODO/63).
check(`...while ENDING with lower terminal hp (${pct(fought.hp)} against`
  + ` ${pct(fled.hp)}, mean ${fought.seconds.toFixed(1)}s against`
  + ` ${fled.seconds.toFixed(1)}s)`, fought.hp < fled.hp);

// --- the ordering ------------------------------------------------------------

const scoreFought = championScore('defend', fought.outcome, fought.shaped);
const scoreFled = championScore('defend', fled.outcome, fled.shaped);

check(`a defender that engages and kills outranks one that survives without firing`
  + ` (${scoreFought.toFixed(4)} against ${scoreFled.toFixed(4)})`,
scoreFought > scoreFled);
check('...on the outcome, not only on the shaping',
  fought.outcome > fled.outcome);

// The rule this replaced, spelled out here so that reverting to it fails: the
// champion score was terminal hp scaled by 1000, with shaped fitness clamped to
// ±499 on top. Both genomes are the same pilot; one of them shoots.
//
// The ordering is decided by hp, because the shaped term never gets near its
// clamp — 11 to 18 points, against a hp term worth 1000. So this is the trap
// two lines above, priced: the pilot that clears the fight ends with less hull
// than the one that never fired, and the old rule read that as the better
// genome. `EPISODES` above carries why this fixture is the size it is, and how
// much of the margin the vocabulary of tactics spent.
const oldScore = (hp: number, shaped: number): number =>
  hp * 1000 + Math.max(-499, Math.min(499, shaped));
check(`the rule this replaced ranked them the other way round`
  + ` (${oldScore(fled.hp, fled.shaped).toFixed(1)} for the pacifist against`
  + ` ${oldScore(fought.hp, fought.shaped).toFixed(1)})`,
oldScore(fled.hp, fled.shaped) > oldScore(fought.hp, fought.shaped));

// --- the ratio is stated, not inherited --------------------------------------

{
  // THE STATEMENT IS ABOUT THE SWING, not about one score: the shaping term can
  // move a genome by at most SHAPED_SHARE of the score's range, whatever the
  // phase's fitness function happens to be scaled in. That is the thing the
  // ±499 clamp was trying to say and could not, because 499 was not a bound on
  // anything a fitness function produces.
  for (const phase of ['attack', 'evade', 'pack', 'defend'] as const) {
    const swing = championScore(phase, 0.5, 1e6) - championScore(phase, 0.5, -1e6);
    eq(`${phase}: shaping moves a score by at most ${pct(SHAPED_SHARE)}`,
      +swing.toFixed(9), SHAPED_SHARE);
  }
  // ...so it cannot reorder two genomes whose outcomes are further apart than
  // that — which is what "break ties WITHIN an outcome band" always meant. The
  // bound is `SHAPED_SHARE / (1 - SHAPED_SHARE)`, and it is asserted of the
  // FORMULA rather than of this fixture because the fixture moved: the gap
  // between shooting and not shooting was 35.0% and docs/TODO/67 took it to
  // 30.5%, by taking contact damage out of the world. Both halves of the gap
  // moved for the same reason — the pacifist keeps more of her pools when
  // nothing rams her, and the turret breaks fewer attackers when they stop
  // destroying themselves on her hull (71.9% killed -> 65.6%).
  const unbuyable = SHAPED_SHARE / (1 - SHAPED_SHARE);
  check(`an outcome gap over ${pct(unbuyable)} cannot be bought back with shaped fitness`,
    championScore('defend', 0.5 + unbuyable * 1.01, -1e6)
      > championScore('defend', 0.5, 1e6));
  // ...and THIS pair no longer clears that bar, which is worth stating out loud
  // rather than leaving as a check that quietly stopped being made: shooting is
  // still ranked first here (above, on the shaped values these two genomes
  // actually produce), but it is no longer ranked first by arithmetic alone.
  check(`...and the turret/pacifist gap is ${pct(fought.outcome - fled.outcome)},`
    + ' which is inside that bar and so rests on the shaping being honest',
  fought.outcome - fled.outcome > 0.2);
  // What it did contribute here — reported rather than bounded, because the
  // share of a PARTICULAR score depends on how good the outcome was.
  const contribution = shapedContribution('defend', fought.outcome, fought.shaped);
  const old = Math.max(-499, Math.min(499, fought.shaped))
    / oldScore(fought.hp, fought.shaped);
  check(`shaping is ${pct(contribution)} of the turret's score, where under the`
    + ` old formula it was ${pct(old)} of it`, contribution > 0.2 && old < 0.03);
  eq('outcome and shaping sum to the whole score',
    +(((1 - SHAPED_SHARE) * fought.outcome
      + SHAPED_SHARE * Math.min(1, fought.shaped / SHAPED_FULL_SCALE.defend))
      .toFixed(9)), +scoreFought.toFixed(9));
  eq('the defender\'s two halves are a whole', DEFENCE_POOLS_KEPT + DEFENCE_ATTACKERS_BROKEN, 1);
}

// --- what each phase counts as winning ---------------------------------------

{
  const ep = fought.last;
  const terms = defenceTerms(ep);
  eq('attack scores the share of her pools taken off her',
    outcomeOf('attack', ep), ep.targetDamageShare());
  eq('...and pack the same quantity', outcomeOf('pack', ep), ep.targetDamageShare());
  // An evader's job is to be somewhere else, so its outcome has no fighting
  // term at all — the two phases share `outcomeOf` and no longer share a
  // definition of winning.
  eq('evade scores the share she kept, and nothing about the fight',
    outcomeOf('evade', ep), terms.kept);
  check('...so the same fight is worth more to a defender that broke the force',
    outcomeOf('defend', ep) > outcomeOf('evade', ep) && terms.broken > 0);

  // Surviving is necessary. Four warheads is more than her three pools hold, and
  // an episode she does not come out of is worth zero however well it went.
  check('a defender that dies scores zero, whatever else she did',
    outcomeOf('defend', ep) > 0 && (() => {
      for (let i = 0; i < 4; i++) ep.trader.takeDamage(playerImpactDamage(IMPACT.warhead));
      return !ep.trader.alive && outcomeOf('defend', ep) === 0
        && outcomeOf('evade', ep) === 0;
    })());
  // ...and that gate is the DEFENDER's. An attacker's outcome is the damage it
  // did, which a dead target maximises.
  eq('...where for an attacker a dead target is the whole point',
    outcomeOf('attack', ep), 1);
}
