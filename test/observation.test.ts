// What a policy sees, held to the rules it was fitted at.
//
// Three constants the encoders spend are pinned in the measured shape: the
// speed scale is SOLVED back out of slot 10, the turn caps out of slots 11/12
// at a ship's own limits, and the log-distance encoding is held to being ONE
// rule across the three slots that used to spell it out separately (the
// survey's "written out three times, feeding three different brains").

import {
  observe, observeDefend, observePackWide, shipView, writeView,
  type ObservableMate,
} from '../src/ai-training/observation.ts';
import { OBS_SIZE, PACK_WIDE_OBS_SIZE } from '../src/ai-training/policy.ts';
import { OBS_SPEED_SCALE } from '../src/constants/brain-flight.ts';
import { TURN } from '../src/constants/hull-motion.ts';
import { check, eq } from './harness.ts';

console.log('\nobservation encoders');
{
  const out = new Float32Array(PACK_WIDE_OBS_SIZE);
  const me = shipView(400, 1.2);
  const target = shipView();

  // --- the speed scale, solved back out of slot 10 ---------------------------
  writeView(me, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  writeView(target, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 0, w: 1 });
  target.speed = 200;
  observe(me, target, out);
  eq('slot 10 is the target speed over OBS_SPEED_SCALE',
    200 / out[6 + 4], OBS_SPEED_SCALE);
  check('...which every shipped brain was fitted at, so it is 400 and frozen',
    OBS_SPEED_SCALE === 400);

  // --- the turn caps: a ship at its own limit reads exactly 1 ----------------
  me.pitchRate = me.cls.turnRate * TURN.pitch;
  me.rollRate = me.cls.turnRate * TURN.roll;
  observe(me, target, out);
  check(`slot 11 reads 1 at the ship's own pitch cap (${out[11].toFixed(6)})`,
    Math.abs(out[11] - 1) < 1e-6);
  check(`slot 12 reads 1 at the ship's own roll cap (${out[12].toFixed(6)})`,
    Math.abs(out[12] - 1) < 1e-6);
  me.pitchRate = 0;
  me.rollRate = 0;

  // --- the log-distance rule is ONE rule -------------------------------------
  // An equilateral fixture: the target, the nearest mate and the mate-to-target
  // hop are all exactly 1,000 units, so slots 6, 17 and 19 must agree to the
  // bit — and 1,000 is half way up the two log decades, so the value itself is
  // pinned too. Before the shared helper, each slot spelled the encoding out
  // again and could drift alone.
  const mate: ObservableMate & { speed: number } = {
    pos: { x: 866.0254037844386, y: 0, z: -500 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    hp: 1, cls: { hp: 1 }, alive: true, speed: 0,
  };
  observePackWide(me, target, [mate], out);
  check('slots 6, 17 and 19 read one encoding for one distance',
    out[6] === out[17] && out[6] === out[19]);
  check(`...and 1,000 units is half way up the scale (${out[6].toFixed(6)})`,
    Math.abs(out[6] - 0.5) < 1e-6);
  check('...100 units is the bottom of it', (() => {
    writeView(target, { x: 0, y: 0, z: -100 }, { x: 0, y: 0, z: 0, w: 1 });
    observe(me, target, out);
    return Math.abs(out[6]) < 1e-6;
  })());
  check('...10,000 is the top, and further reads no further', (() => {
    writeView(target, { x: 0, y: 0, z: -10_000 }, { x: 0, y: 0, z: 0, w: 1 });
    observe(me, target, out);
    const top = out[6];
    writeView(target, { x: 0, y: 0, z: -40_000 }, { x: 0, y: 0, z: 0, w: 1 });
    observe(me, target, out);
    return Math.abs(top - 1) < 1e-6 && out[6] === top;
  })());
  check('...and the floor sits at exactly 50 units', (() => {
    const at = (z: number): number => {
      writeView(target, { x: 0, y: 0, z: -z }, { x: 0, y: 0, z: 0, w: 1 });
      return observe(me, target, out)[6];
    };
    // point-blank clamps to the floor's own reading, and the first step past
    // the floor moves — so a drifted floor (60 held 51 flat) goes red
    return at(10) === at(50) && at(51) > at(50);
  })());

  // --- the defence tail reads the same rule the solo head does ---------------
  writeView(target, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 0, w: 1 });
  me.hp = 0.6;
  me.energy = 0.25;
  me.missileInbound = true;
  observeDefend(me, target, out);
  const solo = new Float32Array(PACK_WIDE_OBS_SIZE);
  observe(me, target, solo);
  check('observeDefend is the solo 14 plus its three tail slots',
    Array.from(out.subarray(0, OBS_SIZE)).every((v, i) => v === solo[i])
    && Math.abs(out[14] - 0.6) < 1e-6 && Math.abs(out[15] - 0.25) < 1e-6
    && out[16] === 1);
}
