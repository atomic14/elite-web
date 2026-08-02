// What do the tests actually cover?
//
// Zero dependencies: node dumps raw V8 coverage when NODE_V8_COVERAGE is set, so
// this runs the suite that way and summarises it. The bespoke `check()` runner
// means node's own --experimental-test-coverage does not apply.
//
// The number that matters is not the percentage, it is the LIST at the bottom:
// files no test touches at all. When this was first run it found station.ts and
// screens/trade.ts — the money paths, both extracted specifically to be
// testable, neither tested.
//
// Run: node tools/coverage.mjs   (also `npm run coverage`)

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'cov-'));
try {
  execFileSync(process.execPath, ['--experimental-strip-types', 'test/run.ts'], {
    env: { ...process.env, NODE_V8_COVERAGE: dir },
    stdio: 'ignore',
  });
} catch {
  console.error('the test suite failed; coverage is only meaningful when it passes');
  process.exit(1);
}

const files = new Map();
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  for (const s of JSON.parse(readFileSync(join(dir, f), 'utf8')).result ?? []) {
    if (!s.url.includes('/src/') || s.url.includes('node_modules')) continue;
    const rel = s.url.split('/elite-web/')[1];
    let [cov, tot] = files.get(rel) ?? [0, 0];
    for (const fn of s.functions ?? []) {
      for (const r of fn.ranges) {
        const n = r.endOffset - r.startOffset;
        tot += n;
        if (r.count > 0) cov += n;
      }
    }
    files.set(rel, [cov, tot]);
  }
}
rmSync(dir, { recursive: true, force: true });

const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name))
    : e.name.endsWith('.ts') ? [join(d, e.name)] : []));

const rows = [...files].map(([rel, [c, t]]) => [t ? (c / t) * 100 : 0, rel])
  .sort((a, b) => a[0] - b[0]);
console.log('least covered:');
for (const [pct, rel] of rows.slice(0, 12)) {
  console.log(`  ${pct.toFixed(1).padStart(5)}%  ${rel}`);
}

const never = walk('src').filter((p) => !files.has(p)).sort();
let c = 0, t = 0;
for (const [cc, tt] of files.values()) { c += cc; t += tt; }
console.log(`\noverall ${(c / t * 100).toFixed(1)}% of executed bytes, `
  + `${files.size} of ${files.size + never.length} files touched`);

console.log(`\nNEVER EXECUTED (${never.length}) — the list that matters:`);
for (const p of never) {
  const n = readFileSync(p, 'utf8').split('\n').length;
  console.log(`  ${String(n).padStart(5)}  ${p}`);
}
console.log('\nSome of these need a browser (game.ts, render-stack, screens).');
console.log('Others do not, and those are the gaps.');
