import assert from 'node:assert/strict';
import { analyzePortability } from './portability.mjs';

const fixture = (name) => `tools/fixtures/portability/${name}/src`;
const contaminated = (name, platform = ['platform/']) => analyzePortability(fixture(name), platform).contaminated;
const chains = (name, platform) => new Map(contaminated(name, platform).map((file) => [file.rel, file.chain]));

assert.deepEqual(chains('direct').get('core.ts'), ['core.ts', 'platform/audio.ts']);
assert.deepEqual(chains('transitive').get('core.ts'), ['core.ts', 'middle.ts', 'platform/audio.ts']);
assert.deepEqual(chains('type-only').get('browser-token.ts'), ['browser-token.ts', 'browser token']);
assert.equal(contaminated('type-only').some((file) => file.rel === 'core.ts'), false);
assert.deepEqual(chains('cycle').get('loop/a.ts'),
  ['loop/a.ts', 'platform/audio.ts']);
assert.deepEqual(chains('cycle').get('loop/b.ts'),
  ['loop/b.ts', 'loop/a.ts', 'platform/audio.ts']);
assert.deepEqual(chains('cycle').get('z-core.ts'),
  ['z-core.ts', 'loop/b.ts', 'loop/a.ts', 'platform/audio.ts']);
assert.equal(contaminated('clean').length, 0);
assert.deepEqual(chains('former-core-audio', ['audio.ts']).get('game/combat.ts'), ['game/combat.ts', 'audio.ts']);

// game.ts is the platform composition root, not a dependency available to
// rules. If core starts importing it, classifying the root as platform would
// hide a real inward dependency instead of describing the port surface.
const live = analyzePortability('src');
const gameImporters = Object.values(live).flat()
  .filter((file) => file.dependencies.some((dependency) =>
    dependency.replaceAll('\\', '/').endsWith('/game/game.ts')))
  .map((file) => file.rel)
  .sort();
assert.deepEqual(gameImporters, ['main.ts']);

console.log('portability fixtures: ok');
