// The strip the pilot reads WHILE the exercise is being flown.
//
// The sixth combat-trainer file, and the only one about the fight as it is
// happening rather than as it is set up or written down. Its whole claim is a
// negative one: the strip is NOT a second tally. Everything on it comes from
// the round's own recorder — the same accumulation `report()` derives the
// finished record from — so the two cannot drift apart.
//
// That claim is only worth anything if it is checked against a REAL exercise,
// so this flies one headlessly through `CombatSim` (the real world step, the
// real gun, the real brains), snapshots the strip on the last frame of the
// fight, and compares it field by field with the record the same exercise then
// produces. Every field, by name and by iteration: a field added to the strip
// with no counterpart in the report fails the last check in this file rather
// than shipping as a number nobody can trace.

import * as THREE from 'three';
import { Ordnance } from '../src/game/ordnance.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { freshState } from '../src/game/state.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import { newCommander } from '../src/game/commander.ts';
import { Combat } from '../src/game/combat.ts';
import { CombatComputer } from '../src/game/combat-computer.ts';
import { seedWorld } from '../src/game/rng.ts';
import { CombatSim, type SimHost } from '../src/game/combat-sim.ts';
import {
  CombatSimRecorder, makeSimLog,
  type CombatSimReport, type ExerciseSetup, type SimProgress,
} from '../src/game/combat-sim-report.ts';
import {
  MODES, SCENARIO_TIMEOUT, exerciseTimeout, type ExerciseSpec,
} from '../src/game/combat-sim-scenarios.ts';
import { exerciseStrip, type ExerciseStrip } from '../src/game/combat-sim-strip.ts';
import type { FlightDemand } from '../src/player.ts';
import { readFileSync } from 'node:fs';
import { check, eq } from './harness.ts';

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// --- the strip, as a pure function ------------------------------------------
//
// Stated independently, the way test/combat-sim-report.test.ts states its
// medians: hand-built progress and a hand-built setup, and the answer written
// out. The mode rules are the only thing this module decides, and there are
// exactly three of them.

console.log('\ncombat simulator — the exercise strip');
{
  const progress = (over: Partial<SimProgress> = {}): SimProgress => ({
    seconds: 12.5, shots: 20, hits: 6, accuracy: 0.3, hitsTaken: 4, kills: 2,
    ...over,
  });
  const setup = (over: Partial<ExerciseSetup> = {}): ExerciseSetup => ({
    seed: 1, scenario: 'Pirate pair', mode: 'scenario',
    player: { shipId: 'elite-a:player:7', laser: 'pulse', missiles: 3, ecm: false,
      energyUnit: false, energyBomb: false },
    opponents: [],
    ...over,
  });
  const spec = (over: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
    mode: 'scenario', scenario: 'pirate-pair', tier: 1, seed: 1, ...over,
  });

  {
    const s = exerciseStrip(spec(), setup(), progress());
    eq('a scenario counts down to the moment it is called off',
      s.remaining, SCENARIO_TIMEOUT - 12.5);
    eq('...from the clock the report will quote', s.elapsed, 12.5);
    eq('...and it is scored on the outcome', s.score, 'outcome');
    eq('...naming the fight exactly as the record does', s.scenario, 'Pirate pair');
    eq('the tallies are the recorder\'s own, carried not recomputed',
      [s.shots, s.hits, s.accuracy, s.hitsTaken].join(), '20,6,0.3,4');
  }
  {
    const s = exerciseStrip(
      spec({ timeoutSeconds: 30 }), setup(), progress({ seconds: 41 }));
    eq('a countdown never goes negative, however late the last frame', s.remaining, 0);
  }
  {
    const s = exerciseStrip(
      spec({ mode: 'sparring' }), setup({ mode: 'sparring' }), progress());
    eq('sparring is endless, so there is nothing to count down', s.remaining, null);
    eq('...and it is scored on kills', s.score, 'kills');
    eq('...which is what it shows instead', s.standing, 2);
  }
  {
    const s = exerciseStrip(
      spec({ mode: 'waves' }), setup({ mode: 'waves', wave: 4 }), progress());
    eq('waves is endless too', s.remaining, null);
    eq('...and scored on the wave you reached', s.score, 'waves');
    eq('...taken from the wave the round\'s own record will carry', s.standing, 4);
  }
  {
    // The property the strip rests on, asserted where it lives: at ANY instant,
    // the recorder's live progress is the record it would produce right then.
    // The end-of-exercise comparison below cannot see this — two accumulations
    // that both end at the same number would pass it — and mid-fight is where a
    // second tally would show.
    const one: ExerciseSetup = setup({
      opponents: [{ hull: 'Mamba', designId: 'elite-a:design:18',
        profileId: 'elite-a:variant:A:18', brain: 'scripted' }],
    });
    const r = new CombatSimRecorder(one);
    const agrees = (when: string) => {
      const p = r.progress;
      const now = r.report('quit');
      eq(`${when}: the live clock is the record's`, p.seconds, now.seconds);
      eq(`${when}: the live shots are the record's`,
        [p.shots, p.hits, p.accuracy, p.kills].join(),
        [now.you.shots, now.you.hits, now.you.accuracy, now.kills.yours].join());
      eq(`${when}: the live hits taken are the record's`, p.hitsTaken, now.them.hits);
    };
    agrees('before a shot is fired');
    r.tick(3, () => ({ speed: 200, pitch: 0, roll: 0, foreShield: 255,
      aftShield: 255, energy: 255, contacts: [] }));
    r.playerShot({ opponent: 0, damage: 9 });
    r.playerShot(null);
    r.taken(11, 'laser', 0);
    agrees('mid-fight');
    r.opponentDown(0, true);
    agrees('after a kill');
  }

  {
    // Every mode in MODES resolves, so a fourth one cannot arrive with no strip.
    for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
      const s = exerciseStrip(spec({ mode }), setup({ mode }), progress());
      eq(`${mode} takes its score from MODES`, s.score, MODES[mode].score);
      check(`...and its countdown from exerciseTimeout`,
        (s.remaining === null) === (exerciseTimeout(spec({ mode })) === 0));
    }
    const src = read('src/game/combat-sim-strip.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check('the strip asks MODES what a mode is, rather than branching on its name',
      !/mode\s*===/.test(src) && !/'sparring'|'scenario'/.test(src));
  }
}

// --- and now against a real exercise ----------------------------------------
//
// The acceptance test for TODO 33: fly one, snapshot the strip on the last
// frame, and hold the record it produces against it.

console.log('\ncombat simulator — the strip is the record, early');
{
  interface Rig {
    state: ReturnType<typeof freshState>;
    sim: CombatSim;
    baseMode: 'docked' | 'flight' | 'dead';
    t: number;
  }

  /** A career at a station, and an exercise it can start. Nothing is saved. */
  const rig = (seed: number): Rig => {
    seedWorld(seed);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    const ordnance = new Ordnance(state.world);
    const combat = new Combat(state.world);
    const r = { state, baseMode: 'docked', t: 0 } as Rig;

    // No storage anywhere in this file: every write is refused at the host, so
    // a slot cannot be reached even by accident (CLAUDE.md: never write 1-3).
    const pHost: PersistenceHost = {
      baseMode: () => r.baseMode,
      enterMode: (m) => { r.baseMode = m; },
      buildWorld: () => { state.world.build(state.systems[state.commander.systemIndex]); },
      enterWitchspace: () => { state.world.banishScenery(); },
      isDead: () => false,
      message: () => {},
      saveCommander: () => {},
      saveWorld: () => {},
      readWorld: () => null,
      clearWorld: () => {},
      withoutSaving: (fn) => ({ value: fn(), refused: [] }),
    };
    const persistence = new Persistence(state, ordnance, new CombatComputer(), pHost);
    const simHost: SimHost = {
      enterFlight: () => { r.baseMode = 'flight'; },
      message: () => {},
      sound: () => {},
      flashDamage: () => {},
      aimBeams: () => {},
      finished: () => {},
    };
    r.sim = new CombatSim(state, ordnance, combat, persistence, simHost, makeSimLog());
    return r;
  };

  const ATTACK: FlightDemand = { rollRate: 0.2, pitchRate: 0.1, throttle: 1, fire: true };

  /** Frames of exercise, with the renderer's one headless job done by hand. */
  const beat = (r: Rig, steps: number): void => {
    for (let i = 0; i < steps && r.sim.fighting; i++) {
      // Point at whatever is nearest, so the fight is a fight and the strip has
      // shots, hits and damage on it rather than zeroes.
      const foe = r.state.world.npcs[0];
      if (foe) {
        r.state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
          r.state.player.position, foe.object.position, new THREE.Vector3(0, 1, 0)));
      }
      r.sim.tick(FIXED_DT, r.t, { demand: ATTACK, handsOn: true });
      r.t += FIXED_DT;
      r.state.world.scene.updateMatrixWorld(true);
    }
  };

  /**
   * What the FINISHED record says the strip should have said.
   *
   * Written out from the report by hand, field by field — not built by calling
   * `exerciseStrip` again, which would only prove the function is a function.
   */
  const fromReport = (rec: CombatSimReport, spec: ExerciseSpec): ExerciseStrip => {
    const limit = exerciseTimeout(spec);
    const { score } = MODES[rec.mode];
    return {
      scenario: rec.scenario,
      mode: rec.mode,
      elapsed: rec.seconds,
      remaining: limit > 0 ? Math.max(0, Math.round((limit - rec.seconds) * 10) / 10) : null,
      score,
      standing: score === 'waves' ? rec.wave! : rec.kills.yours,
      shots: rec.you.shots,
      hits: rec.you.hits,
      accuracy: rec.you.accuracy,
      hitsTaken: rec.them.hits,
    };
  };

  /** Fly one, and hand back the last strip and the record it became. */
  const flown = (spec: ExerciseSpec, seed: number, steps: number) => {
    const r = rig(seed);
    check('no exercise, no strip — the career cockpit is unchanged',
      r.sim.strip === null);
    check(`an exercise starts (${spec.mode})`, r.sim.begin(spec));
    check('...and the strip appears with it', r.sim.strip !== null);
    beat(r, steps);
    // The last frame of the fight, BEFORE the teardown: the recorder's clock
    // does not move again, so this is the same instant the record is taken at.
    const strip = r.sim.strip!;
    const records = r.sim.quit() ?? [];
    check('...and the exercise produced a record', records.length >= 1);
    check('...and the strip is gone the moment the exercise is',
      r.sim.strip === null && !r.sim.active);
    return { strip, rec: records[records.length - 1] };
  };

  {
    // A gang at the top tier, so the fight lasts long enough to have shots
    // going both ways rather than being over in one pass.
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'pirate-gang', tier: 2, seed: 4242,
    };
    const { strip, rec } = flown(spec, 20_260_802, 1800);

    // The vacuity guard first: "they agree" is easy when both are zero.
    check(`the exercise was a real fight (${strip.shots} shots, ${strip.hits} hits, `
      + `${strip.hitsTaken} taken, ${strip.elapsed}s)`,
      strip.shots > 5 && strip.hitsTaken > 0 && strip.elapsed > 5
      && rec.envelope.samples > 10);

    const wanted = fromReport(rec, spec);
    for (const key of Object.keys(wanted) as (keyof ExerciseStrip)[]) {
      eq(`the strip's ${key} is the record's`, String(strip[key]), String(wanted[key]));
    }
    // …and the other way round, so a field added to the strip and to nothing
    // else cannot pass by being absent from the comparison above.
    eq('the strip has exactly the fields the record accounts for',
      Object.keys(strip).sort().join(), Object.keys(wanted).sort().join());
    check('the countdown is a countdown: elapsed and remaining sum to the timeout',
      Math.abs(strip.elapsed + strip.remaining! - SCENARIO_TIMEOUT) < 0.05);
  }

  {
    // An endless mode: no countdown, and the standing is what MODES says.
    const spec: ExerciseSpec = {
      mode: 'waves', scenario: 'single-pirate', tier: 0, seed: 8675309,
    };
    const { strip, rec } = flown(spec, 5_150_515, 900);
    eq('a wave exercise shows no time remaining', strip.remaining, null);
    eq('...it shows the wave', strip.score, 'waves');
    eq('...and the strip\'s wave is the record\'s', strip.standing, rec.wave);
    eq('...with the same shots as the record', strip.shots, rec.you.shots);
    eq('...and the same hits taken', strip.hitsTaken, rec.them.hits);
  }

  {
    const spec: ExerciseSpec = {
      mode: 'sparring', scenario: 'single-pirate', tier: 0, seed: 99,
    };
    const { strip, rec } = flown(spec, 777_777, 600);
    eq('a sparring exercise shows no time remaining either', strip.remaining, null);
    eq('...it shows kills', strip.score, 'kills');
    eq('...and they are the record\'s kills', strip.standing, rec.kills.yours);
    eq('...on the record\'s clock', strip.elapsed, rec.seconds);
  }
}
