// Tiny MLP policies: observation (ship frame) → discrete controls.
// ~2k parameters — cheap enough to run per-ship at 10 Hz in-game, and small
// enough for neuroevolution to optimise without gradients.
//
// WHAT SHAPE A GENOME IS lives here — the input count, the head count, the size
// of the weights vector, and the four operations over one: load, mutate, widen
// and run. WHAT IT SEES is `observation.ts`, which fills the input vector this
// file's `act` consumes. They were one file until docs/TODO/71 and /72 added a
// third encoder and a fourth output head; they meet at `ShipView` and at
// `observeFor`, and nowhere else.
//
// Erasable-TypeScript only — runs in Node via --experimental-strip-types.


/** Discrete control input — three-way sticks and a trigger, as a keyboard gives. */
export interface Control {
  pitch: -1 | 0 | 1;
  roll: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fire: boolean;
  /**
   * Press the E.C.M. — the fourth head, and only the DEFENCE head has it.
   *
   * Always false for a brain whose `outSize` is `OUT_SIZE`, because there is no
   * logit to read: a pirate has no E.C.M. button (its `NpcState.hasEcm` is
   * applied by `ordnance.ts` without anything deciding), and giving every policy
   * the output would have invalidated all three shipped brains for a control
   * two of them can never use (docs/TODO/72).
   */
  ecm: boolean;
}

export const OBS_SIZE = 14; // solo observation
/**
 * The DEFENDER's observation: the solo 14, plus the three things a ship being
 * shot at needs and a ship doing the shooting does not — see `observeDefend`.
 *
 * 17 rather than 18 is not an accident and not a spare slot: **the input count
 * is what picks the encoder** (`observeFor`), so the four sizes have to be
 * distinct, and 18 is already `observePack`'s. What was dropped to make room is
 * written down in `observeDefend` — the fore/aft shield SPLIT, which is a
 * different question from "how hurt am I" and can be added as sizes 19/20 by
 * whoever wants to answer it.
 */
export const DEFEND_OBS_SIZE = 17;
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
/**
 * ...and the DEFENDER's head, which has one more: E.C.M.(2).
 *
 * An ACTION rather than a reflex, and the reasoning is stated where the world
 * is (`ai-training/scenario.ts`). What it costs is confined to the defence
 * phase for the same reason `DEFEND_OBS_SIZE` is: `OUT_SIZE` is shared, so a
 * twelfth output on every policy would have invalidated `pirate-attack-g3` and
 * `pirate-pack-r4-selectonly` as well — three retrains for a button two of them
 * can never press (docs/TODO/72).
 */
export const DEFEND_OUT_SIZE = 13;
/** The widest head, which is all `makeScratch` needs to know. */
export const MAX_OUT_SIZE = DEFEND_OUT_SIZE;

export function genomeSize(obsSize: number, hidden = HIDDEN, outSize = OUT_SIZE): number {
  return obsSize * hidden + hidden + hidden * hidden + hidden + hidden * outSize + outSize;
}

export interface Brain {
  weights: Float32Array;
  obsSize: number;
  hidden: number;
  /**
   * How many logits this genome emits — `OUT_SIZE`, or `DEFEND_OUT_SIZE` for a
   * policy with an E.C.M. head. A property of the GENOME rather than a constant
   * of the file, because the shape of the last layer is part of what a weights
   * file is: reading a 13-head brain as an 11-head one silently mis-slices
   * every bias.
   */
  outSize: number;
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
    outSize?: number;
  };
  weights: number[];
}

export function brainFromFile(f: BrainFile): Brain {
  return {
    weights: Float32Array.from(f.weights),
    obsSize: f.meta.obsSize ?? OBS_SIZE,
    hidden: f.meta.hidden ?? HIDDEN,
    // Absent means the eleven heads every brain had before docs/TODO/72, which
    // is what the three shipped files say by saying nothing.
    outSize: f.meta.outSize ?? OUT_SIZE,
  };
}

/** Forward pass → deterministic (argmax per head) control. */
export function act(brain: Brain, obs: Float32Array, scratch: Float32Array): Control {
  const w = brain.weights;
  const OBS = brain.obsSize;
  const H = brain.hidden;
  const OUT = brain.outSize;
  let o = 0;
  const h1 = scratch.subarray(0, H);
  const h2 = scratch.subarray(H, H * 2);
  const logits = scratch.subarray(H * 2, H * 2 + OUT);

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
  for (let j = 0; j < OUT; j++) {
    let sum = 0;
    for (let i = 0; i < H; i++) sum += h2[i] * w[o + j * H + i];
    logits[j] = sum + w[o + OUT * H + j];
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
    // ...and the E.C.M. head, which only a DEFEND_OUT_SIZE genome has. An
    // 11-head brain has no logit 11 to read, so it never asks: false is the
    // absence of the output rather than a decision not to press.
    ecm: OUT > OUT_SIZE && logits[11 + 1] > logits[11],
  };
}

/**
 * The forward pass's working memory. Sized for the WIDEST head, so one scratch
 * serves an attack brain and a defence brain — two floats, against a caller
 * having to know which policy it is about to run.
 */
export function makeScratch(hidden = HIDDEN): Float32Array {
  return new Float32Array(hidden * 2 + MAX_OUT_SIZE);
}

export function randomBrain(
  rng: () => number, obsSize = OBS_SIZE, hidden = HIDDEN, scale = 0.5, outSize = OUT_SIZE,
): Brain {
  const n = genomeSize(obsSize, hidden, outSize);
  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) weights[i] = (rng() * 2 - 1) * scale;
  return { weights, obsSize, hidden, outSize };
}

export function mutate(parent: Brain, rng: () => number, sigma: number): Brain {
  const weights = new Float32Array(parent.weights);
  for (let i = 0; i < weights.length; i++) {
    // gaussian via Box-Muller
    const u = Math.max(1e-9, rng());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    weights[i] += g * sigma;
  }
  return {
    weights, obsSize: parent.obsSize, hidden: parent.hidden, outSize: parent.outSize,
  };
}

/**
 * The same policy, with room for inputs and outputs it did not have — and it
 * FLIES IDENTICALLY until something mutates the new weights.
 *
 * It exists so a retrain across an observation change can still be seeded from
 * the incumbent. `jameson-defend-t65c`, the only defence policy that has ever
 * fought, came from `--seed-brain jameson-defend-g1`; without this, widening the
 * encoder would have made that command impossible and the comparison would have
 * been a fresh random search against a hill-climb from a known-good brain — two
 * things changed at once, and the run would have said nothing about either.
 *
 * The new weights are ZERO, which is the whole point on both sides. A zero
 * column into the first layer means the new inputs contribute nothing, so the
 * pre-synaptic sums are bit-for-bit what they were. A zero row and bias on the
 * new head means its two logits are equal, and `act` reads `>` rather than
 * `>=`, so a freshly widened genome NEVER presses the E.C.M. — it has to learn
 * that, which is what makes the head an action rather than a gift.
 */
export function widenBrain(parent: Brain, obsSize: number, outSize: number): Brain {
  if (obsSize < parent.obsSize || outSize < parent.outSize) {
    throw new Error(`widenBrain cannot narrow ${parent.obsSize}x${parent.outSize} `
      + `to ${obsSize}x${outSize}`);
  }
  const H = parent.hidden;
  const src = parent.weights;
  const out = new Float32Array(genomeSize(obsSize, H, outSize));
  // layer 1: one row of obsSize per hidden unit, so a wider row is a re-stride
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < parent.obsSize; i++) out[j * obsSize + i] = src[j * parent.obsSize + i];
  }
  for (let j = 0; j < H; j++) out[H * obsSize + j] = src[H * parent.obsSize + j];
  // layer 2 is square in `hidden` and moves across whole
  const srcL2 = H * parent.obsSize + H;
  const dstL2 = H * obsSize + H;
  for (let i = 0; i < H * H + H; i++) out[dstL2 + i] = src[srcL2 + i];
  // layer 3: one row of H per head, then the biases — both grow by the new heads
  const srcL3 = srcL2 + H * H + H;
  const dstL3 = dstL2 + H * H + H;
  for (let i = 0; i < parent.outSize * H; i++) out[dstL3 + i] = src[srcL3 + i];
  for (let j = 0; j < parent.outSize; j++) {
    out[dstL3 + outSize * H + j] = src[srcL3 + parent.outSize * H + j];
  }
  return { weights: out, obsSize, hidden: H, outSize };
}
