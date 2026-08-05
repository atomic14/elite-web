// WHAT A POLICY SEES — the four observation encoders, and the choice between
// them.
//
// One question per encoder, and every answer is in the OBSERVER'S ship frame,
// so a policy is position- and orientation-invariant:
//
//   observe          13  a lone fighter and its target
//   observeDefend    29  ...plus how hurt we are, the warhead, the threat's
//                        velocity, the SECOND threat and the shield split
//                        (docs/TODO/71, /72, /91)
//   observePack      17  ...plus where the nearest wingman is
//   observePackWide  25  ...plus what that wingman is DOING
//
// A separate file from `policy.ts` since docs/TODO/71 and /72 put a third
// encoder and a fourth output head in. That file is the NETWORK and the GENOME
// — what shape a brain is, how a forward pass runs, how a genome mutates and
// widens — and this one is what fills the input vector. The two meet in exactly
// two places: `ShipView`, which is what a caller fills in, and `observeFor`,
// which is the one home for turning a brain's declared input count into an
// encoder. A genome the trainer can produce that the game cannot fly is what
// happens when that choice is made twice, and it has happened twice.
//
// The vector helpers came from ai-training/core.ts, the parallel physics
// simulator that has now been deleted in favour of training against the real
// engine. They are NOT a second physics: they are this file's own arithmetic,
// and they are structural (V3 is `{x,y,z}`) on purpose — the encoders are
// handed THREE.Vector3s by the game and plain objects by a harness, and must
// read both without converting or allocating a scene graph to ask where a ship
// is pointing.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.

import {
  DEFEND_OUT_SIZE, PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE, type Brain,
} from './policy.ts';
import { TURN } from '../constants/hull-motion.ts';
import { OBS_SPEED_SCALE } from '../constants/brain-flight.ts';

export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };

const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const vSub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const vDot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vLen = (a: V3): number => Math.sqrt(vDot(a, a));
function vNorm(a: V3): V3 {
  const l = vLen(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}

/** Rotate a vector by a quaternion. */
function qRotate(q: Q4, p: V3): V3 {
  const ux = q.x, uy = q.y, uz = q.z;
  const tx = 2 * (uy * p.z - uz * p.y);
  const ty = 2 * (uz * p.x - ux * p.z);
  const tz = 2 * (ux * p.y - uy * p.x);
  return v3(
    p.x + q.w * tx + (uy * tz - uz * ty),
    p.y + q.w * ty + (uz * tx - ux * tz),
    p.z + q.w * tz + (ux * ty - uy * tx),
  );
}

/**
 * The ship surface the encoders read — ALL of it, including the hull fraction
 * only `observePackWide` looks at.
 *
 * It used to be called `ObservableShip` and stop short of `hp`/`cls.hp`, so
 * every caller reached the encoders through a cast — two in the trainer and
 * the autopilot, and one in npc.ts widened with an intersection carrying
 * exactly those two fields, the type saying out loud that the encoder read
 * things it did not declare. A
 * type that describes what a function reads and omits something it reads is
 * simply wrong, and a cast is how that stays true. The fields are declared
 * here instead, so the callers below fill a struct and hand it over.
 *
 * Both the game and the training scenarios adapt their THREE.js ships to it,
 * which costs nothing: THREE vectors and quaternions are structurally
 * compatible with V3/Q4, so a view can point straight at a mesh's transform.
 */
export interface ShipView {
  pos: V3;
  quat: Q4;
  speed: number;
  cls: { maxSpeed: number; turnRate: number; hp: number };
  /**
   * Everything this ship has left, over everything it can hold — read by
   * `observePackWide` (slot 24) and `observeDefend` (slot 13), which is
   * deliberately the SAME expression in both: two encoders disagreeing about
   * what "our own health" means is exactly the drift invariant 5 exists against.
   */
  hp: number;
  /**
   * The ENERGY BANK alone, over its own maximum — `observeDefend` slot 14.
   *
   * Separate from `hp` because the two say different things and the defender
   * needs both: `hp` is how hurt she is, the bank is what she DIES at (zero
   * energy is destruction, `systems.ts` `applyDamage`), what the shields will
   * not recover until it is out of its last quarter, and what a quarter of
   * comes off every time she presses the E.C.M.
   *
   * A ship with one pool rather than three (any NPC) writes its own health
   * fraction here as well, which is what its bank IS.
   */
  energy: number;
  /**
   * A hostile warhead is in the air, homing on this ship — `observeDefend`
   * slot 15, and the only reason to press the button on the head below.
   *
   * The world's answer, read once a frame, never the ship's guess: `Ordnance`
   * caps a gang at one in the air precisely so one press stays a complete
   * answer, and a policy that could see the sky per-decision instead of
   * per-frame would be playing a different game from the one the cap describes.
   */
  missileInbound: boolean;
  /**
   * Each shield FACE alone, 0..1 — `observeDefend` slots 27/28, from
   * `systems.ts`'s own `foreShieldLeft`/`aftShieldLeft` so the trainer and
   * the game cannot compute them differently. A ship with one pool rather
   * than two faces (any NPC) writes its health fraction to both: its whole
   * pool is the face it spends, whichever side the hit lands.
   */
  fore: number;
  aft: number;
  laserTemp: number;
  laserCooldown: number;
  pitchRate: number;
  rollRate: number;
}

/**
 * A view to write into, once, at construction.
 *
 * The callers each keep theirs for the life of the ship and refill it per
 * decision — a 10 Hz decision that allocated a scene-graph adaptor per NPC per
 * frame is exactly what these views exist to avoid. The arguments are the
 * fields a caller may treat as fixed for that ship, and for at least one of
 * them the fixedness is load-bearing rather than lazy: the combat computer
 * feeds the defence brain a threat speed of 280 forever, because that is the
 * only number it has ever been flown against (see combat-computer.ts).
 */
export function shipView(maxSpeed = OBS_SPEED_SCALE, turnRate = 1, speed = 0): ShipView {
  return {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    speed, cls: { maxSpeed, turnRate, hp: 1 }, hp: 1,
    // Undamaged, and nothing coming: the values a caller that fills neither is
    // asking for, and the ones every 14- and 18-input brain was fitted at.
    energy: 1, missileInbound: false, fore: 1, aft: 1,
    laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
  };
}

/** Point a view at a transform, copying — no allocation, so it is per-frame safe. */
export function writeView(v: ShipView, pos: V3, quat: Q4): void {
  v.pos.x = pos.x; v.pos.y = pos.y; v.pos.z = pos.z;
  v.quat.x = quat.x; v.quat.y = quat.y; v.quat.z = quat.z; v.quat.w = quat.w;
}

function fwdOf(s: ShipView): V3 {
  return qRotate(s.quat, v3(0, 0, -1));
}

/**
 * A distance, as every encoder reads one: log-decades over a 100-unit base,
 * floored at 50 and capped two decades up, normalized to 0..1 — so 100 units
 * is 0, 1,000 is 0.5 and 10,000 or more is 1.
 *
 * ONE HOME, and it had three: slot 6 (target), slot 17 (nearest mate) and
 * slot 19 (mate-to-target) each wrote the expression out again, feeding three
 * different brains — so a floor or decade base moved in one place would have
 * had every genome silently reading a different geometry from the one it was
 * fitted on. The 50/100/2 are what every shipped brain was fitted at;
 * `test/observation.test.ts` holds the three slots to one rule.
 */
const logDistance = (d: number): number =>
  Math.min(2, Math.log10(Math.max(50, d) / 100)) / 2;

/**
 * Observation, everything in the observer's ship frame so policies are
 * position/orientation invariant:
 *  0 speed/max  1 laserTemp  2 canFire  3-5 dir-to-target (ship frame)
 *  6 log distance  7 closing speed  8 target-facing-us dot
 *  9 angle-to-target/pi  10 pitchRate  11 rollRate  12 bias
 *
 * THERE IS NO TARGET-SPEED SLOT (docs/TODO/91). The old slot 10 was
 * `target.speed / OBS_SPEED_SCALE`, the input brains.ts said the policy had
 * latched onto — the game clamped it (`TARGET_SPEED_FLOOR`) and the trainer
 * did not, so every genome was fitted on values the live game never produced.
 * Chris chose deletion over closing the divergence: a bare speed scalar
 * carries no direction and nothing the geometry does not already say, and a
 * policy that needs its input clamped to stay in distribution was fitted on a
 * slot it could not use honestly. The target's speed still reaches the
 * network through slot 7's closing rate — honestly, on both sides.
 */
export function observe(me: ShipView, target: ShipView, out: Float32Array): Float32Array {
  const rel = vSub(target.pos, me.pos);
  const dist = vLen(rel);
  const relDir = vNorm(rel);
  // world → ship frame: rotate by inverse quaternion
  const inv = { x: -me.quat.x, y: -me.quat.y, z: -me.quat.z, w: me.quat.w };
  const local = qRotate(inv, relDir);
  const myFwd = fwdOf(me);
  const targetFwd = fwdOf(target);
  const closing = me.speed * vDot(myFwd, relDir) - target.speed * vDot(targetFwd, relDir);

  out[0] = me.speed / me.cls.maxSpeed;
  out[1] = me.laserTemp;
  out[2] = me.laserCooldown <= 0 ? 1 : 0;
  out[3] = local.x;
  out[4] = local.y;
  out[5] = local.z;
  out[6] = logDistance(dist);
  out[7] = Math.max(-1, Math.min(1, closing / OBS_SPEED_SCALE));
  out[8] = vDot(targetFwd, vNorm(vSub(me.pos, target.pos))); // +1 → target faces us
  out[9] = Math.acos(Math.max(-1, Math.min(1, vDot(myFwd, relDir)))) / Math.PI;
  // The ship's own pitch and roll caps are `turnRate * TURN.*` — ship-specs.ts
  // records that TURN moved OUT of ai-training/ precisely so the two could not
  // disagree, and these two literals were the residue.
  out[10] = me.pitchRate / (me.cls.turnRate * TURN.pitch);
  out[11] = me.rollRate / (me.cls.turnRate * TURN.roll);
  out[12] = 1;
  return out;
}

/**
 * What a defender can see of the sky BEYOND the ship it is fighting.
 *
 * The threat lock (game/threat-lock.ts) holds the fought target steady, and
 * this is the other half of that bargain: the policy is deliberately not
 * chasing the second attacker, so it must at least SEE it. Filled by the
 * combat computer from the hostiles list, by an armed trader from its
 * attackers, and by the training episode from its pirates — the same three
 * callers as the lock, feeding the same encoder.
 */
export interface ThreatsView {
  /** every OTHER live hostile — the fought target is slots 3-6's business */
  others: readonly { pos: V3 }[];
  /** live hostiles in total, the fought target included */
  count: number;
  /** the hostile warhead in the air, or null when the sky is clear */
  missilePos: V3 | null;
}

/** One target and nothing else — a harness, or a caller with no sky to report. */
export const NO_OTHER_THREATS: ThreatsView = { others: [], count: 1, missilePos: null };

/**
 * DEFENCE observation (v2): the solo 13, plus everything a ship being shot at
 * by a gang needs and a lone hunter does not.
 *
 *   13     everything we have left, over everything we can hold — press or
 *          break off. The same expression as `observePackWide`'s slot 24.
 *   14     the energy bank alone. Zero energy is destruction, the shields do
 *          not come back until it is out of its last quarter, and the E.C.M.
 *          spends a quarter of it — none of that is visible in slot 13,
 *          because a full pair of shields hides an empty bank.
 *   15     a hostile warhead is in the air (1/0). At most one, because
 *          `Ordnance` caps the sky so one E.C.M. press is a complete answer.
 *   16-18  the fought threat's VELOCITY, in our ship frame, over
 *          `OBS_SPEED_SCALE` — where it is going, not just where it is.
 *          The v1 encoder gave bearing and closing speed only, so "lead the
 *          target" and "it is crossing left" were unrepresentable; a
 *          memoryless network cannot differentiate its own inputs.
 *   19-21  bearing to the SECOND-nearest hostile, our frame (zeros if none).
 *   22     ...and its log distance (1 — "far" — if none), `logDistance`.
 *   23     live hostiles over 4, the biggest gang `defenceFight` spawns.
 *   24-26  bearing to the inbound warhead, our frame (zeros when slot 15 is
 *          0). Whether to press the E.C.M. is slot 15's fact; where to point
 *          the nose while it closes is this one's.
 *   27-28  fore and aft shield faces, each over its own maximum — an attacker
 *          on your six spends a different face from one head-on
 *          (`shield-face.ts`), so "keep the good face toward him" is flyable
 *          only if the split is visible. Their SUM is already in slot 13.
 *
 * ## Why a separate encoder rather than slots on `observe()`
 *
 * `observePack` and `observePackWide` both CALL `observe()` first, so
 * appending a slot there moves the input layout of every brain in the project
 * (invariant 5). None of these numbers means anything to a pirate — the phase
 * that needs the inputs is the phase that pays for them.
 */
export function observeDefend(
  me: ShipView, target: ShipView, threats: ThreatsView, out: Float32Array,
): Float32Array {
  observe(me, target, out);
  out[13] = Math.max(0, Math.min(1, me.hp / me.cls.hp));
  out[14] = Math.max(0, Math.min(1, me.energy));
  out[15] = me.missileInbound ? 1 : 0;
  const inv = { x: -me.quat.x, y: -me.quat.y, z: -me.quat.z, w: me.quat.w };
  // the fought threat's velocity vector, expressed in our frame — its nose
  // direction times its speed, which is exactly how every ship in this game
  // moves (`advance`: no drift, no sideslip)
  const tFwd = qRotate(inv, fwdOf(target));
  const tSpeed = Math.min(1, target.speed / OBS_SPEED_SCALE);
  out[16] = tFwd.x * tSpeed;
  out[17] = tFwd.y * tSpeed;
  out[18] = tFwd.z * tSpeed;
  let second: { pos: V3 } | null = null;
  let secondD = Infinity;
  for (const o of threats.others) {
    const d = vLen(vSub(o.pos, me.pos));
    if (d < secondD) { secondD = d; second = o; }
  }
  if (second) {
    const dir = qRotate(inv, vNorm(vSub(second.pos, me.pos)));
    out[19] = dir.x;
    out[20] = dir.y;
    out[21] = dir.z;
    out[22] = logDistance(secondD);
  } else {
    out[19] = 0; out[20] = 0; out[21] = 0; out[22] = 1;
  }
  out[23] = Math.min(1, threats.count / 4);
  if (threats.missilePos) {
    const dir = qRotate(inv, vNorm(vSub(threats.missilePos, me.pos)));
    out[24] = dir.x;
    out[25] = dir.y;
    out[26] = dir.z;
  } else {
    out[24] = 0; out[25] = 0; out[26] = 0;
  }
  out[27] = Math.max(0, Math.min(1, me.fore));
  out[28] = Math.max(0, Math.min(1, me.aft));
  return out;
}

/**
 * Pack observation: the solo 14 plus nearest living packmate — direction in
 * our ship frame (3) and log distance (1). Lets a shared policy coordinate.
 */
export function observePack(
  me: ShipView,
  target: ShipView,
  mates: readonly { pos: V3; alive: boolean }[],
  out: Float32Array,
): Float32Array {
  observe(me, target, out);
  let best: { pos: V3; alive: boolean } | null = null;
  let bestD = Infinity;
  for (const m of mates) {
    if ((m as unknown) === (me as unknown) || !m.alive) continue;
    const d = vLen(vSub(m.pos, me.pos));
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (best) {
    const inv = { x: -me.quat.x, y: -me.quat.y, z: -me.quat.z, w: me.quat.w };
    const local = qRotate(inv, vNorm(vSub(best.pos, me.pos)));
    out[13] = local.x;
    out[14] = local.y;
    out[15] = local.z;
    out[16] = logDistance(bestD);
  } else {
    out[13] = 0; out[14] = 0; out[15] = 0; out[16] = 1;
  }
  return out;
}

/**
 * The extra surface the wide pack observation needs on a packmate. npc.ts
 * fills these from the fleet (see `packmates`) — it could not, once, which
 * meant a 26-input policy could be trained and never flown.
 */
export interface ObservableMate {
  pos: V3;
  quat: Q4;
  /**
   * Health, over `cls.hp` — the encoder reads the RATIO, so any consistent
   * pair works and only the fraction is ever observed.
   *
   * The game fills it NORMALIZED (`hp` a 0..1 fraction, `cls.hp` 1), because
   * live combat keeps whole source energy points now and a mate's bank is not
   * the observer's: two ships of different designs handing over raw points
   * against their own maxima would be the same fraction only by accident. One
   * conversion, at this boundary, so the shipped brains keep seeing exactly the
   * number they were fitted against.
   */
  hp: number;
  cls: { hp: number };
  alive: boolean;
}

/**
 * Wide pack observation (round 4): the 18 of `observePack`, plus enough about
 * the nearest mate to coordinate with it rather than merely avoid it —
 *
 *   17  mate health fraction
 *   18  mate's distance to the target (log) — is it engaged, or off chasing?
 *   19  mate's aim alignment on the target — is it attacking *now*?
 *   20..22  direction from the target to the mate, in **our** ship frame:
 *           the flanking signal. Approach opposite this and the target
 *           cannot face both of us.
 *   23  how many mates are still alive (÷3)
 *   24  our own health fraction — press or break off
 */
export function observePackWide(
  me: ShipView,
  target: ShipView,
  mates: readonly ObservableMate[],
  out: Float32Array,
): Float32Array {
  observePack(me, target, mates, out);
  let best: ObservableMate | null = null;
  let bestD = Infinity;
  let living = 0;
  for (const m of mates) {
    if ((m as unknown) === (me as unknown) || !m.alive) continue;
    living += 1;
    const d = vLen(vSub(m.pos, me.pos));
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (best) {
    const mateToTarget = vSub(target.pos, best.pos);
    const mateDist = vLen(mateToTarget);
    const mateFwd = qRotate(best.quat, v3(0, 0, -1));
    const inv = { x: -me.quat.x, y: -me.quat.y, z: -me.quat.z, w: me.quat.w };
    // where the mate sits relative to the target, expressed in our frame
    const flank = qRotate(inv, vNorm(vSub(best.pos, target.pos)));
    out[17] = Math.max(0, Math.min(1, best.hp / best.cls.hp));
    out[18] = logDistance(mateDist);
    out[19] = vDot(mateFwd, vNorm(mateToTarget));
    out[20] = flank.x;
    out[21] = flank.y;
    out[22] = flank.z;
  } else {
    out[17] = 0; out[18] = 1; out[19] = 0;
    out[20] = 0; out[21] = 0; out[22] = 0;
  }
  out[23] = Math.min(1, living / 3);
  out[24] = Math.max(0, Math.min(1, me.hp / me.cls.hp));
  return out;
}

/**
 * Which observation does THIS brain want? The widest one it has inputs for.
 *
 * The encoders and the sizes live in this file, so the choice between them
 * belongs here too. It used to be made twice — three ways in npc.ts, two ways
 * in scenario.ts — which meant a genome the trainer could produce was not, by
 * construction, a genome the game could fly: npc.ts once knew only the 14 and
 * the 18, so the round-4 wide brains had no way into the game at all.
 *
 * `mates` is the pack this ship is flying with, or **null when the caller has
 * no pack context** — a lone hunter, or a harness with no fleet. Null means
 * the solo encoder, whatever the brain's size: a pack policy flown without a
 * pack reads the 14 numbers it shares with the solo one. Note that the solo
 * encoder writes only the first `OBS_SIZE` slots, so a pack-sized brain on
 * that path reads whatever the caller left in the tail of `out` — which is
 * why callers with a fleet should pass it rather than pre-judging the size.
 *
 * `me` carries the hull fraction the wide encoder needs even on the solo path:
 * a caller cannot know which encoder will run, so it supplies the union.
 */
export function observeFor(
  brain: Brain,
  me: ShipView,
  target: ShipView,
  mates: readonly ObservableMate[] | null,
  out: Float32Array,
  /** the rest of the sky, for the defence encoder — see `ThreatsView` */
  threats: ThreatsView = NO_OTHER_THREATS,
): Float32Array {
  // The defence encoder is asked for FIRST and asked by its HEAD count, not
  // its input count. Two reasons. It is the one encoder that is not a rung on
  // the pack ladder: a defender has no fleet, so `mates` is null and every
  // test below would fall through to the solo block and leave the defence tail
  // holding whatever the caller last put there. And input counts COLLIDE
  // across generations — docs/TODO/91's shuffle left the old defence width
  // equal to the new pack width — where the E.C.M. head is the defence
  // family's alone (`DEFEND_OUT_SIZE`, docs/TODO/72) and every defence file
  // ever saved has it. A stale narrow file still reaches its own encoder —
  // out of distribution until its retrain, which is expected, never
  // mis-encoded.
  if (brain.outSize === DEFEND_OUT_SIZE) {
    return observeDefend(me, target, threats, out);
  }
  if (!mates || brain.obsSize < PACK_OBS_SIZE) return observe(me, target, out);
  if (brain.obsSize >= PACK_WIDE_OBS_SIZE) return observePackWide(me, target, mates, out);
  return observePack(me, target, mates, out);
}
