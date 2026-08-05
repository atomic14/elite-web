// What an exercise measures, and the JSON it hands to a training run.
//
// This absorbed test/combat-recorder.js, which identified damage by wrapping five
// Game methods BY NAME — all five moved to world-step.ts and it silently filed
// every hit as `unknown`. The measurement is an argument in a signature now, which
// cannot go stale that way. Versioned from day one: it has an external consumer.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { type DamageSource } from '../src/game/combat.ts';
import { LASER_RANGE } from '../src/constants/player-gun.ts';
import { NPC_FIRE_GATE, NPC_LASER_RANGE } from '../src/constants/npc-gun.ts';
import {
  CombatSimRecorder,
  combatSimJson,
  makeSimLog,
  aimAngle,
  quantile,
  mean,
  COMBAT_SIM_SCHEMA,
  type ContactSample,
  type FrameSample,
  type ExerciseSetup,
  type PlayerLoadout,
  type CombatSimReport,
} from '../src/game/combat-sim-report.ts';
import { SIX_CONE, MAX_SAMPLES } from '../src/constants/combat-record.ts';
import { NO_OPENING } from '../src/game/combat-sim-opening.ts';
import { installSimLog } from '../src/game/console.ts';
import { check, eq } from './harness.ts';

// --- the combat simulator's report ------------------------------------------
//
// src/game/combat-sim-report.ts is the measurement layer of the training
// simulator (docs/COMBAT-SIM.md), and it absorbs two console harnesses that
// could never be tested: test/combat-recorder.js (a fight a human flew) and
// test/arena.js's envelope() (how that human flies, which is what the trainer
// fits its target hull to).
//
// The samples here are BUILT BY HAND, which is the whole reason the module is
// pure: a statistic is only right if you can state the answer independently.
// Several of these tests exist specifically to pin down which average is which
// — combat-recorder.js reported a MEAN engagement range, and one pirate
// breaking off to 9000 while two knife-fight at 400 drags a mean out to a range
// nobody was ever at. Where the spec says median, a mean must fail.

console.log('\ncombat simulator report');
{
  // The ids are written out rather than imported, for the same reason the
  // samples below are: this file states the answer independently. They are the
  // Cobra Mk III (player hull 7) and the recommended exact variants of the
  // Sidewinder (design 17) and the Mamba (design 18) — ship-identity.ts.
  const loadout: PlayerLoadout = {
    shipId: 'elite-a:player:7',
    laser: 'beam', missiles: 4, ecm: true, energyUnit: true, energyBomb: false,
  };
  const setup = (over: Partial<ExerciseSetup> = {}): ExerciseSetup => ({
    seed: 90210,
    scenario: 'Pirate pair',
    mode: 'scenario',
    sampleHz: 10,
    opening: NO_OPENING,
    player: loadout,
    opponents: [
      {
        hull: 'Sidewinder',
        designId: 'elite-a:design:17', profileId: 'elite-a:variant:D:17',
        brain: 'pirate-attack-g3', role: 'pirate', tier: 0,
      },
      {
        hull: 'Mamba',
        designId: 'elite-a:design:18', profileId: 'elite-a:variant:F:18',
        brain: 'scripted', role: 'pirate', tier: 1,
      },
    ],
    ...over,
  });
  // `speed` is theirs, and it defaults to 0 here because every case below is
  // about the geometry rather than about how they flew. What the opposition's
  // envelope makes of it is combat-sim-flight.test.ts's question.
  const contact = (
    opponent: number, dist: number, theirAim: number, yourAim: number, speed = 0,
    doing = 'closing',
  ): ContactSample => ({ opponent, dist, speed, theirAim, yourAim, doing });
  const frame = (over: Partial<FrameSample> = {}): FrameSample => ({
    speed: 60, pitch: 0, roll: 0, foreShield: 1, aftShield: 1, energy: 4,
    contacts: [], ...over,
  });
  const near = (o: number) => contact(o, 800, 0.05, 0.05);

  // 1. Accuracy, both ways, and damage attributed to the cause the game named
  // rather than to the size of the number.
  {
    const rec = new CombatSimRecorder(setup());
    rec.playerShot({ opponent: 0, damage: 0.13 });
    rec.playerShot(null);
    rec.playerShot(null);
    rec.playerShot(null);
    rec.npcShot(0, 'laser');
    rec.npcShot(0, 'laser');
    rec.npcShot(1, 'laser');
    rec.npcShot(1, 'laser');
    rec.taken(0.18, 'laser', 0);
    rec.npcShot(1, 'missile');
    rec.taken(1.3, 'missile', 1);
    rec.taken(0.45, 'ram', 1);
    rec.taken(0.06, 'cargo');
    const r = rec.report('quit');

    eq('your accuracy is hits over DISCHARGES', r.you.accuracy, 0.25);
    eq('...and the damage you did is credited to the ship you hit',
      r.opponents[0].damageFromYou, 0.13);
    eq('their accuracy counts lasers only', r.them.accuracy, 0.25);
    eq('...a missile launch is not a shot that could have missed', r.them.missiles, 1);
    eq('...nor is the missile that landed a laser hit', r.them.hits, 1);
    eq('damage to you totals every cause', r.them.damageToYou, 1.99);
    eq('...split by the source the step reported, not by its magnitude',
      r.them.damageBySource.ram?.damage, 0.45);
    eq('...with a count per cause, so a ram is one event and not four shots',
      r.them.damageBySource.ram?.count, 1);
    eq('...and a cause that never happened is absent',
      r.them.damageBySource.station, undefined);
    eq('their damage is billed to the ship that landed it',
      r.opponents[1].damageToYou, 1.75);
    eq('...and a hit with no ship behind it still counts in the total',
      r.them.damageBySource.cargo?.damage, 0.06);
    eq('a shot nobody fired reports no accuracy rather than 0%',
      r.opponents[1].linedUpShare, null);
    eq('...and with no samples there is no shots-per-minute either',
      r.them.shotsPerMinutePerShip, null);
  }

  // 2. MEDIAN where the spec says median, MEAN where it says mean. This is the
  // test that fails if the two are ever swapped.
  {
    const rec = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 8; i++) rec.frame(frame({ contacts: [contact(0, 400, 0, 0)] }));
    for (let i = 0; i < 2; i++) rec.frame(frame({ contacts: [contact(0, 9000, 0, 0)] }));
    const r = rec.report('quit');
    eq('engagement range is a MEDIAN — the range the fight happened at',
      r.range.median, 400);
    check('...and not the mean (2120), which no ship was ever at',
      r.range.median !== 2120);
    eq('closest range is the nearest it ever got', r.range.closest, 400);
    eq('...and the per-opponent line agrees', r.opponents[0].medianRange, 400);

    // aim error is the other way round: an average error IS a mean
    const aims = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 9; i++) aims.frame(frame({ contacts: [contact(0, 400, 0, 0)] }));
    aims.frame(frame({ contacts: [contact(0, 400, Math.PI / 2, Math.PI / 2)] }));
    const a = aims.report('quit');
    eq('mean aim error is a MEAN, in degrees', a.meanAimErrorDeg.them, 9);
    check('...not a median, which would report nine frames of perfect aim',
      a.meanAimErrorDeg.them !== 0);

    // and the envelope: one dash for the horizon must not move the median speed
    const env = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 9; i++) env.frame(frame({ speed: 0, pitch: 1.2, roll: 0.2 }));
    env.frame(frame({ speed: 400, pitch: 0, roll: 0 }));
    const e = env.report('quit').envelope;
    eq('the envelope\'s speed is a median (a mean would read 40)', e.speed?.median, 0);
    eq('...with the top speed kept separately', e.speed?.max, 400);
    eq('...and pitch is the magnitude, whichever way it was pulled',
      e.pitchRate?.median, 1.2);
    eq('a frame with nothing hostile in it contributes no engagement range',
      e.engagementRange, null);
  }

  // 3. "Lined up" is npc.ts's gate and the range cut-offs are the guns' own,
  // because combat-recorder.js wrote 14.3 degrees and 3500 into the harness and
  // a balance change would have moved the game without moving the measurement.
  {
    const rec = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 3; i++) rec.frame(frame({ contacts: [contact(0, 1000, 0.1, 1)] }));
    for (let i = 0; i < 2; i++) rec.frame(frame({ contacts: [contact(0, 1000, 1, 0.1)] }));
    rec.frame(frame({ contacts: [contact(0, LASER_RANGE + 500, 0.1, 0.1)] }));
    for (let i = 0; i < 4; i++) rec.frame(frame({ contacts: [contact(0, 1000, 1, 1)] }));
    const r = rec.report('quit');
    eq('share of ship-frames they spent lined up on you', r.linedUpShare.them, 0.3);
    eq('...and you on them', r.linedUpShare.you, 0.2);
    eq('a ship aimed at you from beyond its range is not lined up',
      r.inRangeShare.them, 0.9);
    eq('every sampled frame with a hostile in it is time under attack',
      r.engagedSeconds, 1);

    const gate = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    gate.frame(frame({ contacts: [contact(0, 1000, NPC_FIRE_GATE - 0.001, Math.PI)] }));
    gate.frame(frame({ contacts: [contact(0, 1000, NPC_FIRE_GATE + 0.001, Math.PI)] }));
    eq(`lined up is NPC_FIRE_GATE (${NPC_FIRE_GATE} rad), not a hardcoded 14.3 degrees`,
      gate.report('quit').linedUpShare.them, 0.5);

    const reach = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    reach.frame(frame({ contacts: [contact(0, NPC_LASER_RANGE - 1, 0, Math.PI)] }));
    reach.frame(frame({ contacts: [contact(0, NPC_LASER_RANGE + 1, 0, Math.PI)] }));
    eq(`...and the cut-off is NPC_LASER_RANGE (${NPC_LASER_RANGE}), not a hardcoded 3500`,
      reach.report('quit').linedUpShare.them, 0.5);
  }

  // 4. On the six: a duration, so it is per FRAME. Two pirates back there at
  // once is one bad second, not two.
  {
    const behind = (o: number) => contact(o, 800, 0.05, Math.PI - 0.05);
    const rec = new CombatSimRecorder(setup());
    for (let i = 0; i < 10; i++) rec.frame(frame({ contacts: [behind(0), behind(1)] }));
    const r = rec.report('quit');
    eq('seconds they spent on your six', r.onSixSeconds.them, 1);
    check('...counted per frame, not doubled because two of them were there',
      r.onSixSeconds.them !== 2);
    eq('...and you were on nobody\'s six', r.onSixSeconds.you, 0);
    check('...though both were lined up on you the whole time',
      r.linedUpShare.them === 1 && r.linedUpShare.you === 0);

    const mirror = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    for (let i = 0; i < 5; i++) {
      mirror.frame(frame({ contacts: [contact(0, 800, Math.PI - 0.05, 0.05)] }));
    }
    eq('the mirror: astern of them and lined up is your six',
      mirror.report('quit').onSixSeconds.you, 0.5);

    const wide = new CombatSimRecorder(setup({ opponents: [setup().opponents[0]] }));
    wide.frame(frame({ contacts: [contact(0, 800, 0.05, Math.PI - SIX_CONE - 0.01)] }));
    eq(`a ship off your beam is not on your six (SIX_CONE ${SIX_CONE.toFixed(2)} rad)`,
      wide.report('quit').onSixSeconds.them, 0);
  }

  // 5. Low-water marks: the worst it got, not where it ended.
  {
    const rec = new CombatSimRecorder(setup());
    rec.frame(frame({ foreShield: 1, aftShield: 1, energy: 4 }));
    rec.frame(frame({ foreShield: 0.35, aftShield: 0.8, energy: 2.5 }));
    rec.frame(frame({ foreShield: 0.6, aftShield: 0.1, energy: 1.2 }));
    const r = rec.report('quit');
    eq('fore shield low-water mark', r.lowWater.foreShield, 0.35);
    eq('aft shield low-water mark', r.lowWater.aftShield, 0.1);
    eq('energy low-water mark', r.lowWater.energy, 1.2);
    eq('and nothing hostile means no engagement time', r.engagedSeconds, 0);
  }

  // 6. The clock: time to first and last kill, how long each opponent lived,
  // and the sampling cadence the durations are derived from.
  {
    const rec = new CombatSimRecorder(setup());
    const probe = () => frame({ contacts: [near(0), near(1)] });
    const advance = (secs: number) => {
      for (let i = 0; i < Math.round(secs * 60); i++) rec.tick(1 / 60, probe);
    };
    advance(3);
    rec.playerShot({ opponent: 0, damage: 0.5 });
    rec.opponentDown(0, true);
    advance(2);
    rec.opponentDown(1, false);
    const r = rec.report('cleared');

    eq('time to your first kill', r.kills.firstAt, 3);
    eq('...and to your last', r.kills.lastAt, 3);
    eq('kills credited to you', r.kills.yours, 1);
    eq('...and every ship that left the sky', r.kills.total, 2);
    eq('a ship that died to something else is not your kill',
      r.opponents[1].killedByYou, false);
    eq('how long the one you killed lived', r.opponents[0].livedSeconds, 3);
    eq('...and the one that saw the exercise out', r.opponents[1].livedSeconds, 5);
    eq('the exercise clock is the sum of the steps', r.seconds, 5);
    // 50 samples in 5 seconds at 10 Hz, exactly. combat-recorder.js zeroed its
    // accumulator instead of subtracting the interval, which at a 1/60 step
    // sampled every SEVEN steps — 43 samples here, 8.6 Hz calling itself 10 —
    // and every duration above is derived from a count of samples. The last
    // sample is float slack: six steps of 1/60 sum to 0.09999999999999999.
    eq('sampling holds at 10 Hz across a 1/60 step', r.envelope.samples, 50);
    eq('...so time under attack matches the clock', r.engagedSeconds, 5);
    eq('their fire rate is per ship, per minute', r.them.shotsPerMinutePerShip, 0);
  }

  // 7. The export: versioned, and it survives a round trip through JSON.
  {
    const rec = new CombatSimRecorder(setup({ wave: 2, mode: 'waves' }));
    rec.frame(frame({ contacts: [near(0), near(1)] }));
    rec.playerShot({ opponent: 1, damage: 0.16 });
    rec.opponentDown(1, true);
    const r = rec.report('destroyed');
    const back = JSON.parse(combatSimJson(r)) as CombatSimReport;

    eq('the export carries a schema version', back.schema, COMBAT_SIM_SCHEMA);
    eq('...the seed the fight ran on', back.seed, 90210);
    eq('...the scenario and mode', `${back.scenario}/${back.mode}/${back.wave}`,
      'Pirate pair/waves/2');
    eq('...your loadout', `${back.player.laser}/${back.player.missiles}`, 'beam/4');
    eq('...and every opponent\'s hull and brain',
      back.opponents.map((o) => `${o.hull}:${o.brain}`).join(','),
      'Sidewinder:pirate-attack-g3,Mamba:scripted');
    eq('the outcome is recorded', back.outcome, 'destroyed');
    check('the whole report survives JSON unchanged — no NaN, no Infinity',
      JSON.stringify(back) === JSON.stringify(r));
    check('and asking for the report twice gives the same answer',
      JSON.stringify(rec.report('destroyed')) === JSON.stringify(r));
  }

  // 8. The ring of recent exercises. Its core factory is pure; the console
  // seam installs the optional global handle.
  {
    const rec = new CombatSimRecorder(setup());
    const r = rec.report('quit');
    const log = makeSimLog(3);
    for (let i = 1; i <= 5; i++) log.push({ ...r, seed: i });
    eq('the ring keeps the most recent N', log.records.length, 3);
    eq('...dropping the oldest', log.records[0].seed, 3);
    eq('...and last() is the newest', log.last()?.seed, 5);
    check('...and it is JSON on request', JSON.parse(log.json()).length === 3);
    log.clear();
    eq('...clear() empties it', log.records.length, 0);

    const host = globalThis as unknown as Record<string, unknown>;
    // The rule is "no side effects at module scope" (CLAUDE.md), and the honest
    // way to check it is over the SOURCE. Reading globalThis here tested the
    // same thing only while nothing else in the suite had built a Game — and
    // the moment test/game.test.ts started constructing real ones, this began
    // failing on test ORDER rather than on the property. The installer belongs
    // to console.ts; this report module must not even import that platform seam.
    const reportSrc = readFileSync(
      new URL('../src/game/combat-sim-report.ts', import.meta.url), 'utf8');
    check('the report module has no platform import',
      !reportSrc.includes("from './console.ts'"));
    const installed = installSimLog(2);
    check('installSimLog() puts the ring on globalThis', host.__simLog === installed);
    check('...and a second call inherits the same ring rather than dropping it',
      installSimLog() === installed);
  }

  // 9. What it does when it stops understanding. A harness that says so beats
  // one that is confidently wrong — combat-recorder.js's `unknown` bucket.
  {
    const rec = new CombatSimRecorder(setup());
    rec.taken(0.2, 'plasma' as DamageSource, 0);
    rec.npcShot(7, 'laser');
    const r = rec.report('quit');
    eq('a cause DamageSource does not name lands in `unknown`',
      r.them.damageBySource.unknown?.damage, 0.2);
    check('...and the report says the game has grown a new way to hurt you',
      r.warnings.some((w) => w.includes('plasma')));
    check('...as it does for a ship this exercise never set up',
      r.warnings.some((w) => w.includes('opponent 7')));
  }

  // 10. The sample buffer is bounded, because sparring and waves are endless —
  // and it STOPS rather than dropping the oldest, so a median stays a median of
  // the fight instead of a median of the end of it.
  {
    const rec = new CombatSimRecorder(setup({ mode: 'sparring' }));
    for (let i = 0; i < MAX_SAMPLES + 5; i++) rec.frame(frame({ speed: i }));
    const r = rec.report('quit');
    eq(`the buffer stops at MAX_SAMPLES (${MAX_SAMPLES})`, r.envelope.samples, MAX_SAMPLES);
    check('...and says so rather than quietly reporting a shorter fight',
      r.warnings.some((w) => w.includes('sample buffer full')));
    eq('...keeping the START of the exercise, so the median is not the tail',
      r.envelope.speed?.median, MAX_SAMPLES / 2);
  }

  // 11. The two statistics helpers, on their own — the definitions everything
  // above rests on.
  {
    eq('quantile picks an element rather than interpolating', quantile([1, 2, 3, 4], 0.5), 3);
    eq('...and the mean of the same four is a different number', mean([1, 2, 3, 4]), 2.5);
    eq('quantile of nothing is null, because 0 is a speed', quantile([], 0.5), null);
    eq('...and so is the mean of nothing', mean([]), null);
    eq('p90 of a hundred samples', quantile(Array.from({ length: 100 }, (_, i) => i), 0.9), 90);
  }

  // 12. The geometry the samples are made of. Forward is −Z (ARCHITECTURE.md),
  // and NpcShip.facing() is the same rule from the other cockpit.
  {
    const origin = new THREE.Vector3();
    const level = new THREE.Quaternion();
    const at = (x: number, y: number, z: number) =>
      aimAngle(origin, level, new THREE.Vector3(x, y, z));
    check('a target dead ahead is 0 off the nose', Math.abs(at(0, 0, -100)) < 1e-9);
    check('...abeam is a right angle', Math.abs(at(100, 0, 0) - Math.PI / 2) < 1e-9);
    check('...and dead astern is pi', Math.abs(at(0, 0, 100) - Math.PI) < 1e-9);
    eq('...and a target in the same place as you is not an error', at(0, 0, 0), 0);
  }
}
