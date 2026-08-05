// Fixtures that more than one test file needs.
//
// The bar for putting something here is that two files genuinely share it, not
// that it looks reusable — a fixture nobody else uses belongs beside its tests,
// where you can read it and the assertion together. Everything here earned its
// place by being referenced from at least two of the files.
//
// `check` and the counters are in harness.ts; this is data.

import { readFileSync } from 'node:fs';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import {
  genomeSize, randomBrain,
  DEFEND_OBS_SIZE, DEFEND_OUT_SIZE, HIDDEN,
} from '../src/ai-training/policy.ts';
import { makeRng } from '../src/game/rng.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';

/**
 * Galaxy 1: the canonical universe, and the most-shared fixture in the suite.
 *
 * Generated rather than stored, which is the whole point — if the generator
 * drifts, every test built on this one starts failing at once, and that is a
 * better alarm than a fixture file that would quietly keep agreeing with itself.
 */
export const g1 = generateGalaxy(1);

/**
 * The world's own slice. Tests step at the rate the game steps at; a test that
 * used its own dt would be measuring a world that does not exist, which is the
 * mistake the trainer made for fifteen training runs.
 */
export const DT = FIXED_DT;

export const BRAINS = new URL('../src/ai-training/brains/', import.meta.url).pathname;

/**
 * brains.ts's source, for the gates that hold the weights DIRECTORY to what
 * the file imports. Since 2026-08-05 that is NOTHING — the trained defence
 * line followed the trained pirates out of the bundle (docs/TRAINING-LOG.md
 * runs 20-21) — and the empty directory is itself the asserted claim.
 */
export const brainsSrc = readFileSync(
  new URL('../src/game/brains.ts', import.meta.url), 'utf8');

/**
 * A defence-SHAPED genome, deterministic, for every test whose subject is the
 * machinery a defence brain flies through — brainFly's clocks, the snapshot,
 * the encoder plumbing — none of which cares what the weights say. It stood
 * on the shipped `jameson-defend-*` weights until the line was discarded;
 * what those tests were ever pinning was the SHIP's behaviour, so a seeded
 * random genome of the right shape carries them.
 */
export const defendShaped = randomBrain(
  makeRng(0xdefe4d), DEFEND_OBS_SIZE, HIDDEN, 0.5, DEFEND_OUT_SIZE);

/**
 * A defence genome that ALWAYS asks for the E.C.M. — the yes/no biases of the
 * thirteenth head forced apart, everything else `defendShaped`'s own weights.
 * What the missile tests pin is the mechanism (the head reaches `fireEcm`,
 * the gate needs a warhead, the press costs a quarter of the bank), and that
 * must not depend on whether some particular training run learned to press.
 */
export const ecmPresser = (() => {
  const b = randomBrain(makeRng(0xdefe4d), DEFEND_OBS_SIZE, HIDDEN, 0.5, DEFEND_OUT_SIZE);
  const biasBase = genomeSize(DEFEND_OBS_SIZE, b.hidden, DEFEND_OUT_SIZE) - DEFEND_OUT_SIZE;
  b.weights[biasBase + 11] = -50; // ecm-no
  b.weights[biasBase + 12] = 50;  // ecm-yes
  return b;
})();
