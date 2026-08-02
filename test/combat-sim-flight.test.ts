// How they flew: passes, the opposition's envelope, and the one home both the
// game and the trainer's probe read them from.
//
// The rest of the report is asserted in combat-sim-report.test.ts. These three
// measurements get their own file because they answer a different question, and
// it is the question this project keeps getting wrong: CLAUDE.md's warning is
// that a well-optimised pirate becomes a turret that hangs in space and snipes,
// and three brains have now won on damage and been rejected on FEEL. The
// evidence that settled each of them was train/flight-probe.ts's — how fast THEY
// flew, the spread of the ranges they held, and how often they actually came in.
//
// The samples are BUILT BY HAND, as they are next door, because a statistic is
// only right if you can state the answer independently. And the last section is
// a source scan rather than an assertion about values: the probe and the report
// agreeing today is worth nothing if either is free to keep its own copy of what
// a pass is, which is exactly how a threshold moves in one file and not the
// other.

import { readFileSync } from 'node:fs';
import {
  CombatSimRecorder, countPasses, PASS_CLOSE, PASS_FAR,
  type ContactSample, type ExerciseSetup, type FrameSample,
} from '../src/game/combat-sim-report.ts';
import { NO_OPENING } from '../src/game/combat-sim-opening.ts';
import { check, eq } from './harness.ts';

console.log('\ncombat simulator report — how they flew');
{
  const setup = (opponents = 1): ExerciseSetup => ({
    seed: 4242,
    scenario: 'Pirate pair',
    mode: 'scenario',
    sampleHz: 10,
    opening: NO_OPENING,
    player: {
      shipId: 'elite-a:player:7',
      laser: 'beam', missiles: 0, ecm: false, energyUnit: false, energyBomb: false,
    },
    opponents: Array.from({ length: opponents }, (_, i) => ({
      hull: 'Sidewinder',
      designId: 'elite-a:design:17' as const,
      profileId: 'elite-a:variant:D:17' as const,
      brain: i === 0 ? 'pirate-attack-g3' : 'scripted',
      role: 'pirate',
      tier: 0,
    })),
  });
  const contact = (
    opponent: number, dist: number, speed: number,
  ): ContactSample => ({ opponent, dist, speed, theirAim: 0.05, yourAim: 0.05 });
  const frame = (contacts: ContactSample[]): FrameSample => ({
    speed: 250, pitch: 0, roll: 0, foreShield: 255, aftShield: 255, energy: 255, contacts,
  });
  /** Fly opponent `o` through a series of ranges, one sample each. */
  const flyThrough = (rec: CombatSimRecorder, o: number, dists: number[], speed = 200) => {
    for (const d of dists) rec.frame(frame([contact(o, d, speed)]));
  };

  // 1. A pass is a closure AND a break. The hysteresis is the measurement:
  // without it a ship holding station on one threshold scores a pass every time
  // it wobbles across, which is the opposite of what the number is for.
  {
    eq('closing inside PASS_CLOSE and opening back out past PASS_FAR is one pass',
      countPasses([2000, 300, 2000]), 1);
    eq('...and doing it twice is two', countPasses([2000, 300, 2000, 200, 1500]), 2);
    eq('a ship that closed and stayed has not completed a pass',
      countPasses([2000, 300, 350, 200]), 0);
    eq(`...nor has one that never got inside ${PASS_CLOSE}`,
      countPasses([2000, PASS_CLOSE + 1, 2000]), 0);
    eq(`...nor one that broke off only as far as ${PASS_FAR}`,
      countPasses([2000, 300, PASS_FAR, 300]), 0);
    check('a ship loitering between the two thresholds scores none, however long',
      countPasses(Array.from({ length: 500 }, (_, i) => 500 + (i % 2) * 300)) === 0);
    check('...and jitter across ONE threshold scores none either — the gap is the point',
      countPasses(Array.from({ length: 500 }, (_, i) => PASS_CLOSE + (i % 2 ? 1 : -1))) === 0);
    eq('an empty fight has no passes in it', countPasses([]), 0);
  }

  // 2. The report carries them: per opponent, and summed.
  {
    const rec = new CombatSimRecorder(setup(2));
    flyThrough(rec, 0, [2000, 300, 2000, 250, 1800]);   // two runs
    flyThrough(rec, 1, [2000, 1500, 1200, 1000]);       // never came in
    const r = rec.report('quit');
    eq('a brain that comes in and breaks off reads its runs on its own line',
      r.opponents[0].passes, 2);
    eq('...and one that hangs about outside reads none', r.opponents[1].passes, 0);
    eq('...and the fight totals them', r.opposition.passes, 2);
  }

  // 3. Summed PER SHIP, not over a pooled series. Two ships taking turns to be
  // the near one would otherwise read as a stream of crossings nobody flew.
  {
    const rec = new CombatSimRecorder(setup(2));
    // Both sit still, one close and one far, for the whole fight.
    for (let i = 0; i < 20; i++) {
      rec.frame(frame([contact(0, 300, 40), contact(1, 2000, 40)]));
    }
    const r = rec.report('quit');
    eq('two ships holding station make no passes between them', r.opposition.passes, 0);
    check('...even though the pooled series crosses both thresholds forty times',
      countPasses(rec.raw.flatMap((f) => f.contacts.map((c) => c.dist))) > 0);
  }

  // 4. The envelope: how fast they flew, and the SPREAD of the ranges they held.
  // The spread is the measurement — a brain that commits sweeps through it, and
  // a brain that loiters collapses it onto one number that the median alone
  // cannot tell from the other.
  {
    const rec = new CombatSimRecorder(setup(1));
    // ten samples: 100..1000 by hundreds, at speeds 10..100
    for (let i = 1; i <= 10; i++) rec.frame(frame([contact(0, i * 100, i * 10)]));
    const r = rec.report('quit');
    eq('ship-frames behind the figures', r.opposition.samples, 10);
    eq('their median speed', r.opposition.speed?.median, 60);
    eq('...their p90', r.opposition.speed?.p90, 100);
    eq('...and the fastest they ever went', r.opposition.speed?.max, 100);
    eq('the range they held, at p10', r.opposition.range?.p10, 200);
    eq('...at the median', r.opposition.range?.median, 600);
    eq('...and at p90', r.opposition.range?.p90, 1000);
    eq('the median agrees with the mutual range, which is the same population',
      r.opposition.range?.median, r.range.median);
    eq('and a ship\'s own median speed is on its line', r.opponents[0].medianSpeed, 60);

    const turret = new CombatSimRecorder(setup(1));
    for (let i = 0; i < 10; i++) turret.frame(frame([contact(0, 600, 20)]));
    const t = turret.report('quit');
    eq('a turret\'s spread collapses: p10 and p90 are the range it never left',
      `${t.opposition.range?.p10}/${t.opposition.range?.p90}`, '600/600');
    eq('...while its MEDIAN is the same 600 the brain that swept 100-1000 read — '
      + 'which is why the spread is the measurement and the median is not',
      t.opposition.range?.median, r.opposition.range?.median);
    eq('...and nothing here scores it. The report presents; the pilot judges',
      (t.opposition as unknown as Record<string, unknown>).score, undefined);
  }

  // 5. Nothing measured is null, not zero: 0 is a speed and 0 is a range.
  {
    const rec = new CombatSimRecorder(setup(1));
    for (let i = 0; i < 5; i++) rec.frame(frame([]));
    const r = rec.report('quit');
    eq('a fight with nothing hostile in it has no opposition envelope',
      r.opposition.speed, null);
    eq('...nor a range they held', r.opposition.range, null);
    eq('...but the passes are a COUNT, and none is a number', r.opposition.passes, 0);
    eq('...and the per-opponent line agrees', r.opponents[0].medianSpeed, null);
  }
}

// --- one home ---------------------------------------------------------------
//
// The report and the trainer's probe must not be able to disagree about what a
// pass is. The values agreeing today is not the property that matters; the
// property is that there is only one of them.
{
  const probeSrc = readFileSync(
    new URL('../train/flight-probe.ts', import.meta.url), 'utf8');
  check('flight-probe.ts reads the pass thresholds from combat-sim-report.ts',
    /import\s*{[^}]*PASS_CLOSE[^}]*}\s*from\s*'\.\.\/src\/game\/combat-sim-report\.ts'/s
      .test(probeSrc));
  check('...and counts its passes with the game\'s own recorder',
    probeSrc.includes('new CombatSimRecorder')
      && probeSrc.includes('report.opposition.passes'));
  check('...defining neither threshold itself',
    !/const\s+(CLOSE|FAR|PASS_CLOSE|PASS_FAR)\s*=/.test(probeSrc));
  check('...and no second quantile to disagree with the report\'s',
    !/const\s+quantile\s*=|function\s+quantile\s*\(/.test(probeSrc));
}
