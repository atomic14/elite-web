// What a policy sees, held to the rules it was fitted at.
//
// Three constants the encoders spend are pinned in the measured shape: the
// speed scale is solved out of the closing rate (the ONLY slot that reads a
// target's speed since docs/TODO/91 deleted the raw-speed input), the turn
// caps out of slots 10/11 at a ship's own limits, and the log-distance
// encoding is held to being ONE rule across the three slots that used to
// spell it out separately.

import {
  observe, observeDefend, observeFor, observePackWide, shipView, writeView,
  type ObservableMate,
} from '../src/ai-training/observation.ts';
import { OBS_SIZE, PACK_WIDE_OBS_SIZE, type Brain } from '../src/ai-training/policy.ts';
import { OBS_SPEED_SCALE } from '../src/constants/brain-flight.ts';
import { TURN } from '../src/constants/hull-motion.ts';
import { check } from './harness.ts';

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
  // docs/TODO/91: THERE IS NO TARGET-SPEED SLOT. The speed reaches the network
  // only through slot 7's closing rate — both ships face -z here, so the
  // closure is me.speed - target.speed over the scale.
  check('the closing rate reads both speeds over OBS_SPEED_SCALE',
    Math.abs(out[7] - Math.max(-1, (me.speed - 200) / OBS_SPEED_SCALE)) < 1e-6);
  check('...which every shipped brain was fitted at, so it is 400 and frozen',
    OBS_SPEED_SCALE === 400);
  check('...and no slot reads the raw target speed any more', (() => {
    const a = new Float32Array(PACK_WIDE_OBS_SIZE);
    const b = new Float32Array(PACK_WIDE_OBS_SIZE);
    // two speeds, same closing rate: approach dead astern so closing is
    // me.speed - target.speed, and bump me.speed to compensate — every slot
    // must read identically, which only holds with the raw-speed slot gone
    writeView(target, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 0, w: 1 });
    me.speed = 300; target.speed = 100; observe(me, target, a);
    me.speed = 400; target.speed = 200; observe(me, target, b);
    const same = a.every((v, i) => i === 0 || Math.abs(v - b[i]) < 1e-6);
    me.speed = 0; target.speed = 200;
    return same;
  })());

  // --- the turn caps: a ship at its own limit reads exactly 1 ----------------
  me.pitchRate = me.cls.turnRate * TURN.pitch;
  me.rollRate = me.cls.turnRate * TURN.roll;
  observe(me, target, out);
  check(`slot 10 reads 1 at the ship's own pitch cap (${out[10].toFixed(6)})`,
    Math.abs(out[10] - 1) < 1e-6);
  check(`slot 11 reads 1 at the ship's own roll cap (${out[11].toFixed(6)})`,
    Math.abs(out[11] - 1) < 1e-6);
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
  check('slots 6, 16 and 18 read one encoding for one distance',
    out[6] === out[16] && out[6] === out[18]);
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
  check('observeDefend is the solo block plus its three tail slots',
    Array.from(out.subarray(0, OBS_SIZE)).every((v, i) => v === solo[i])
    && Math.abs(out[13] - 0.6) < 1e-6 && Math.abs(out[14] - 0.25) < 1e-6
    && out[15] === 1);
}

// --- the stale-file collision is unreachable (docs/TODO/91) -------------------
//
// Shrinking every size by one made TODAY'S pack size (17) YESTERDAY'S defence
// size, so a `jameson-defend` file kept from before the change — which is
// exactly what a bisect replays — would dispatch to the pack encoder by input
// count and be silently mis-encoded. The dispatcher reads the HEAD count for
// the defence family instead (only defence genomes have the E.C.M. head), so
// the stale file reaches its own encoder: out of distribution until its
// retrain, never mis-read as a pack brain.
{
  const me = shipView(400, 1.2);
  const target = shipView();
  writeView(me, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  writeView(target, { x: 0, y: 0, z: -1000 }, { x: 0, y: 0, z: 0, w: 1 });
  me.energy = 0.25;
  me.missileInbound = true;
  const mate = {
    pos: { x: 500, y: 0, z: -500 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    hp: 1, cls: { hp: 1 }, alive: true,
  };
  const stale: Brain = {
    weights: new Float32Array(0), obsSize: 17, hidden: 32, outSize: 13,
  };
  const buf = new Float32Array(PACK_WIDE_OBS_SIZE).fill(-9);
  observeFor(stale, me, target, [mate], buf);
  check('a stale 17-input defence file reaches the defence encoder, with a pack present',
    Math.abs(buf[14] - 0.25) < 1e-6 && buf[15] === 1);
  const pack: Brain = {
    weights: new Float32Array(0), obsSize: 17, hidden: 32, outSize: 11,
  };
  buf.fill(-9);
  observeFor(pack, me, target, [mate], buf);
  check("...while today's 17-input pack brain, 11 heads, reads the pack tail",
    buf[16] !== -9 && buf[16] !== 1 && buf[15] !== 1);
}
