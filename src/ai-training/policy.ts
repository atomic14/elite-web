// Tiny MLP policies: observation (ship frame) → discrete controls.
// ~2k parameters — cheap enough to run per-ship at 10 Hz in-game, and small
// enough for neuroevolution to optimise without gradients.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.
//
// The handful of vector helpers below came from ai-training/core.ts, the
// parallel physics simulator that has now been deleted in favour of training
// against the real engine. They are NOT a second physics: they are the
// observation encoder's own arithmetic, and they are structural (V3 is
// `{x,y,z}`) on purpose — `observe()` is handed THREE.Vector3s by the game and
// plain objects by a harness, and must read both without converting or
// allocating a scene graph to ask where a ship is pointing.

export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };

/** Discrete control input — three-way sticks and a trigger, as a keyboard gives. */
export interface Control {
  pitch: -1 | 0 | 1;
  roll: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fire: boolean;
}

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
 * The minimal ship surface `observe` needs. Both the game and the training
 * scenarios adapt their THREE.js ships to it, which costs nothing: THREE
 * vectors and quaternions are structurally compatible with V3/Q4, so a view
 * object can point straight at a mesh's own transform.
 */
export interface ObservableShip {
  pos: V3;
  quat: Q4;
  speed: number;
  cls: { maxSpeed: number; turnRate: number };
  laserTemp: number;
  laserCooldown: number;
  pitchRate: number;
  rollRate: number;
}

function fwdOf(s: ObservableShip): V3 {
  return qRotate(s.quat, v3(0, 0, -1));
}

export const OBS_SIZE = 14; // solo observation
export const PACK_OBS_SIZE = 18; // solo + nearest-packmate dir (3) + distance (1)
// Round 4: the r2/r3 pack brains could see *where* a mate was but not what it
// was doing, and runs 4 and 6 both concluded the missing signal was
// coordination, not reward. This adds the mate's health, whether it is
// actually engaging the target, and which side of the target it is coming
// from — the minimum needed to choose a complementary attack line.
export const PACK_WIDE_OBS_SIZE = 26;
export const HIDDEN = 32;
// output heads: pitch(3) roll(3) throttle(3) fire(2)
export const OUT_SIZE = 11;

export function genomeSize(obsSize: number, hidden = HIDDEN): number {
  return obsSize * hidden + hidden + hidden * hidden + hidden + hidden * OUT_SIZE + OUT_SIZE;
}

export interface Brain {
  weights: Float32Array;
  obsSize: number;
  hidden: number;
}

export interface BrainFile {
  meta: {
    name: string;
    phase: string;
    trainedAt: string;
    generations: number;
    fitness: number;
    hyperparams: Record<string, number>;
    obsSize?: number;
    hidden?: number;
  };
  weights: number[];
}

export function brainFromFile(f: BrainFile): Brain {
  return {
    weights: Float32Array.from(f.weights),
    obsSize: f.meta.obsSize ?? OBS_SIZE,
    hidden: f.meta.hidden ?? HIDDEN,
  };
}

/**
 * Observation, everything in the observer's ship frame so policies are
 * position/orientation invariant:
 *  0 speed/max  1 laserTemp  2 canFire  3-5 dir-to-target (ship frame)
 *  6 log distance  7 closing speed  8 target-facing-us dot
 *  9 angle-to-target/pi  10 target speed  11 pitchRate  12 rollRate  13 bias
 */
export function observe(me: ObservableShip, target: ObservableShip, out: Float32Array): Float32Array {
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
  out[6] = Math.min(2, Math.log10(Math.max(50, dist) / 100)) / 2;
  out[7] = Math.max(-1, Math.min(1, closing / 400));
  out[8] = vDot(targetFwd, vNorm(vSub(me.pos, target.pos))); // +1 → target faces us
  out[9] = Math.acos(Math.max(-1, Math.min(1, vDot(myFwd, relDir)))) / Math.PI;
  out[10] = target.speed / 400;
  out[11] = me.pitchRate / (me.cls.turnRate * 1.4);
  out[12] = me.rollRate / (me.cls.turnRate * 2.4);
  out[13] = 1;
  return out;
}

/**
 * Pack observation: the solo 14 plus nearest living packmate — direction in
 * our ship frame (3) and log distance (1). Lets a shared policy coordinate.
 */
export function observePack(
  me: ObservableShip,
  target: ObservableShip,
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
    out[14] = local.x;
    out[15] = local.y;
    out[16] = local.z;
    out[17] = Math.min(2, Math.log10(Math.max(50, bestD) / 100)) / 2;
  } else {
    out[14] = 0; out[15] = 0; out[16] = 0; out[17] = 1;
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
  hp: number;
  cls: { hp: number };
  alive: boolean;
}

/**
 * Wide pack observation (round 4): the 18 of `observePack`, plus enough about
 * the nearest mate to coordinate with it rather than merely avoid it —
 *
 *   18  mate health fraction
 *   19  mate's distance to the target (log) — is it engaged, or off chasing?
 *   20  mate's aim alignment on the target — is it attacking *now*?
 *   21..23  direction from the target to the mate, in **our** ship frame:
 *           the flanking signal. Approach opposite this and the target
 *           cannot face both of us.
 *   24  how many mates are still alive (÷3)
 *   25  our own health fraction — press or break off
 */
export function observePackWide(
  me: ObservableShip & { hp: number; cls: { hp: number } },
  target: ObservableShip,
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
    out[18] = Math.max(0, Math.min(1, best.hp / best.cls.hp));
    out[19] = Math.min(2, Math.log10(Math.max(50, mateDist) / 100)) / 2;
    out[20] = vDot(mateFwd, vNorm(mateToTarget));
    out[21] = flank.x;
    out[22] = flank.y;
    out[23] = flank.z;
  } else {
    out[18] = 0; out[19] = 1; out[20] = 0;
    out[21] = 0; out[22] = 0; out[23] = 0;
  }
  out[24] = Math.min(1, living / 3);
  out[25] = Math.max(0, Math.min(1, me.hp / me.cls.hp));
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
  me: ObservableShip & { hp: number; cls: { hp: number } },
  target: ObservableShip,
  mates: readonly ObservableMate[] | null,
  out: Float32Array,
): Float32Array {
  if (!mates || brain.obsSize < PACK_OBS_SIZE) return observe(me, target, out);
  if (brain.obsSize >= PACK_WIDE_OBS_SIZE) return observePackWide(me, target, mates, out);
  return observePack(me, target, mates, out);
}

/** Forward pass → deterministic (argmax per head) control. */
export function act(brain: Brain, obs: Float32Array, scratch: Float32Array): Control {
  const w = brain.weights;
  const OBS = brain.obsSize;
  const H = brain.hidden;
  let o = 0;
  const h1 = scratch.subarray(0, H);
  const h2 = scratch.subarray(H, H * 2);
  const logits = scratch.subarray(H * 2, H * 2 + OUT_SIZE);

  for (let j = 0; j < H; j++) {
    let sum = 0;
    for (let i = 0; i < OBS; i++) sum += obs[i] * w[o + j * OBS + i];
    h1[j] = Math.tanh(sum + w[o + H * OBS + j]);
  }
  o += H * OBS + H;
  for (let j = 0; j < H; j++) {
    let sum = 0;
    for (let i = 0; i < H; i++) sum += h1[i] * w[o + j * H + i];
    h2[j] = Math.tanh(sum + w[o + H * H + j]);
  }
  o += H * H + H;
  for (let j = 0; j < OUT_SIZE; j++) {
    let sum = 0;
    for (let i = 0; i < H; i++) sum += h2[i] * w[o + j * H + i];
    logits[j] = sum + w[o + OUT_SIZE * H + j];
  }

  const argmax3 = (base: number): number => {
    let best = 0;
    if (logits[base + 1] > logits[base + best]) best = 1;
    if (logits[base + 2] > logits[base + best]) best = 2;
    return best - 1; // -1, 0, +1
  };
  return {
    pitch: argmax3(0) as Control['pitch'],
    roll: argmax3(3) as Control['roll'],
    throttle: argmax3(6) as Control['throttle'],
    fire: logits[9 + 1] > logits[9], // fire head: [dont, fire]
  };
}

export function makeScratch(hidden = HIDDEN): Float32Array {
  return new Float32Array(hidden * 2 + OUT_SIZE);
}

export function randomBrain(rng: () => number, obsSize = OBS_SIZE, hidden = HIDDEN, scale = 0.5): Brain {
  const n = genomeSize(obsSize, hidden);
  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) weights[i] = (rng() * 2 - 1) * scale;
  return { weights, obsSize, hidden };
}

export function mutate(parent: Brain, rng: () => number, sigma: number): Brain {
  const weights = new Float32Array(parent.weights);
  for (let i = 0; i < weights.length; i++) {
    // gaussian via Box-Muller
    const u = Math.max(1e-9, rng());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    weights[i] += g * sigma;
  }
  return { weights, obsSize: parent.obsSize, hidden: parent.hidden };
}
