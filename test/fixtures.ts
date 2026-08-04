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
import { brainFromFile, type BrainFile } from '../src/ai-training/policy.ts';
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
export const load = (n: string): ReturnType<typeof brainFromFile> =>
  brainFromFile(JSON.parse(readFileSync(`${BRAINS}${n}.json`, 'utf8')) as BrainFile);

/**
 * The brains the GAME actually flies, read out of brains.ts rather than typed
 * here.
 *
 * The baseline checks used to load 'pirate-attack-r2' and 'jameson-defend',
 * neither of which the game flew — so the regression gate that exists to stop a
 * bad brain reaching players was measuring two brains that were not in it.
 * Deriving the names means retraining under a new one cannot silently orphan
 * the check, and since TODO 57 there is nothing else in the directory to get
 * hold of by mistake: `test/ai.test.ts` holds it to exactly these imports.
 */
export const brainsSrc = readFileSync(
  new URL('../src/game/brains.ts', import.meta.url), 'utf8');

export const shippedBrainFile = (which: string): string => {
  const m = brainsSrc.match(
    new RegExp(`import ${which}BrainFile from '[^']*brains/([^']+)\\.json'`));
  if (!m) throw new Error(`brains.ts no longer imports a ${which} brain`);
  return m[1];
};

export const SHIPPED_PIRATE = shippedBrainFile('pirate');
export const SHIPPED_DEFEND = shippedBrainFile('defend');
export const shippedPirate = load(SHIPPED_PIRATE);
export const jameson = load(SHIPPED_DEFEND);
