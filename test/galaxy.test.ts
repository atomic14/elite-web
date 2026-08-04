// The 1984 universe: the galaxy, its prose, and its economy in motion.
//
// Invariant 4 lives here — generateGalaxy(1)[7] is LAVE, TL:5, Rich Agricultural
// Dictatorship — and it is the one test in the project that must never be "fixed".
// The generator is byte-matched to the original; a failure here means the maths
// was changed, not that the expectation is stale.

import { readFileSync, readdirSync } from 'node:fs';
import {
  checkJump,
  resolveJump,
  jumpCost,
  refusalMessage,
} from '../src/game/hyperspace.ts';
import {
  witchspaceChance,
  distanceTenths,
  daysForJump,
} from '../src/galaxy/navigation.ts';
import {
  WITCHSPACE_ESCAPE_COST, MISJUMP_CHANCE, MISJUMP_CHANCE_PLANS,
  JUMP_DAYS_BASE, TENTHS_PER_JUMP_DAY,
} from '../src/constants/jump.ts';
import { TENTHS_PER_CHART_UNIT, CHART_Y_SQUASH } from '../src/constants/chart-metric.ts';
import type { CommanderData } from '../src/game/commander.ts';
import {
  generateGalaxy,
  speciesName,
  describeSystem,
  COMMODITIES,
  type StarSystem,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import { makeRng } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

// --- the canonical universe -------------------------------------------------

console.log('\ngalaxy generation (1984 fidelity)');
eq('galaxy 1 has 256 systems', g1.length, 256);
eq('system 7 is Lave', g1[7].name, 'Lave');
eq('Lave is a Rich Agricultural Dictatorship TL:5',
  describeSystem(g1[7]), 'LAVE  TL:5  Rich Agricultural  Dictatorship');
eq('Lave chart position', `${g1[7].x},${g1[7].y}`, '20,173');
eq('system 0 is Tibedied', g1[0].name, 'Tibedied');
eq('Lave inhabitants', speciesName(g1[7]), 'Human Colonials');
eq('Diso inhabitants', speciesName(g1.find((s) => s.name === 'Diso')!), 'Black Furry Felines');
for (const name of ['Diso', 'Leesti', 'Riedquat', 'Zaonce', 'Orerve', 'Reorte', 'Ususor']) {
  check(`canonical system present: ${name}`, g1.some((s) => s.name === name));
}
check('all 8 galaxies generate 256 named systems',
  [1, 2, 3, 4, 5, 6, 7, 8].every((n) => {
    const g = generateGalaxy(n);
    return g.length === 256 && g.every((s) => s.name.length > 0);
  }));
check('galaxy 2 differs from galaxy 1', generateGalaxy(2)[7].name !== g1[7].name);

// --- planet descriptions (goat soup) ----------------------------------------

console.log('\nplanet descriptions');
eq("Lave's canonical description",
  planetDescription(g1[7]),
  'Lave is most famous for its vast rain forests and the Lavian tree grub.');
check('descriptions are deterministic',
  planetDescription(g1[42]) === planetDescription(g1[42]));
check('every system in galaxy 1 gets a sentence',
  g1.every((s) => {
    const d = planetDescription(s);
    return d.length > 12 && d.endsWith('.') && !d.includes('undefined');
  }));
check('descriptions vary across systems',
  new Set(g1.slice(0, 40).map(planetDescription)).size > 25);

// --- living galaxy ----------------------------------------------------------

console.log('\nliving galaxy');
{
  const gradients = COMMODITIES.map((c) => c.gradient);
  const rngA = makeRng(12345);
  const living = new LivingGalaxy(g1);
  living.advance(60, gradients, rngA);
  check('convoys are in flight after two months', living.convoys.length > 0);
  check('convoy list stays bounded', living.convoys.length <= 400);
  check('some systems have drifted from baseline', living.states.size > 0);

  let priceOk = true;
  let anyDrift = false;
  for (const [index] of living.states) {
    for (let i = 0; i < COMMODITIES.length; i++) {
      const m = living.priceMultiplier(index, i);
      if (m < 0.74 || m > 1.26) priceOk = false;
      if (m !== 1) anyDrift = true;
    }
  }
  check('price multipliers stay within ±25% of the 1984 baseline', priceOk);
  check('prices actually move', anyDrift);
  check('danger stays in 0..1',
    [...living.states.values()].every((s) => s.danger >= 0 && s.danger <= 1));

  // determinism + persistence
  const livingB = new LivingGalaxy(g1);
  livingB.advance(60, gradients, makeRng(12345));
  eq('same seed → same day', livingB.day, living.day);
  eq('same seed → same convoy count', livingB.convoys.length, living.convoys.length);

  const restored = new LivingGalaxy(g1);
  restored.load(living.save());
  eq('save/load round-trips the day', restored.day, living.day);
  eq('save/load round-trips convoys', restored.convoys.length, living.convoys.length);
  // Sample a system whose price has ACTUALLY MOVED.
  //
  // This used to take `states.keys()[0]` and commodity 0, whose multiplier is
  // exactly 1.0 — the baseline every LivingGalaxy returns for a system it has
  // never touched. So the check passed whether load() restored the pressures
  // or restored nothing at all, which is the one failure it exists to catch.
  // The control below is what makes it a test: an unloaded galaxy must
  // DISAGREE at the same point.
  let sample = -1;
  let commodity = 0;
  let drift = 0;
  for (const [index] of living.states) {
    for (let i = 0; i < COMMODITIES.length; i++) {
      const d = Math.abs(living.priceMultiplier(index, i) - 1);
      if (d > drift) { drift = d; sample = index; commodity = i; }
    }
  }
  const at = (l: LivingGalaxy) => l.priceMultiplier(sample, commodity);
  check(`a price has drifted far enough to be worth comparing (x${(1 + drift).toFixed(3)})`,
    sample >= 0 && drift > 0.02);
  check(`save/load round-trips prices (${g1[sample]?.name} ${COMMODITIES[commodity]?.name}, `
    + `x${at(living).toFixed(3)})`,
  sample >= 0 && Math.abs(at(restored) - at(living)) < 0.002);
  check('...where a galaxy that never loaded gives the baseline instead (the control)',
    sample >= 0 && Math.abs(at(new LivingGalaxy(g1)) - at(living)) > 0.02);

  // piracy must concentrate in lawless space, not merely busy space
  const lawless = new LivingGalaxy(g1);
  lawless.advance(365, gradients, makeRng(999));
  const entries = [...lawless.states.entries()];
  const risky = entries.filter(([, s]) => s.danger > 0.15);
  const avgGovRisky = risky.reduce((sum, [i]) => sum + g1[i].government, 0) / (risky.length || 1);
  check(`dangerous systems are lawless (mean government ${avgGovRisky.toFixed(2)} vs galaxy 3.50)`,
    risky.length >= 5 && avgGovRisky < 2.5);
  const anarchy = entries.filter(([i]) => g1[i].government === 0).map(([, s]) => s.danger);
  const corporate = entries.filter(([i]) => g1[i].government === 7).map(([, s]) => s.danger);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  check('anarchies are more dangerous than corporate states',
    mean(anarchy) > mean(corporate) + 0.05);
  check('Lave stays safe for new commanders', lawless.danger(7) < 0.35);

  // pressure decays back toward baseline when trade stops
  const quiet = new LivingGalaxy(g1);
  const st = quiet.state(7);
  st.pressure[0] = 0.9;
  quiet.advance(40, gradients, () => 1); // rng()=1 → no new convoys
  check('pressure decays back toward the baseline', Math.abs(st.pressure[0]) < 0.01);
}

// --- one owner for the chart metric -----------------------------------------

// The 1984 distance rule had grown three implementations — ui/screens.ts,
// game/contracts.ts and a hand-inlined squared copy in game.ts galacticJump —
// all correct, none the owner, kept in step by nothing. That is invariant 5's
// failure mode, and it bites harder here: test/campaign.ts validates the whole
// economy against its own copy, so a drift would leave the balance harness
// measuring a different game from the one that ships.
//
// galaxy/navigation.ts owns it now. These checks stop it re-forking.

console.log('\nchart metric has one owner');
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  // EVERY .ts IN src/, NOT A HAND-PICKED FOUR. The old version of this check
  // read ui/screens.ts, contracts.ts, game.ts and campaign.ts — the files that
  // had forked it once — and galaxy/living.ts, which had forked it AGAIN with
  // a byte-identical private `chartDistance()` and a hand-inlined
  // `daysForJump` beside it, was not among them. A list of the places it went
  // wrong before is not a scan; this is.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : /\.ts$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const SRC = new URL('../src/', import.meta.url);
  const files: (readonly [string, string])[] = walk(SRC)
    .map((url) => [`src/${url.pathname.slice(SRC.pathname.length)}`, readFileSync(url, 'utf8')] as const)
    .filter(([name]) => name !== 'src/galaxy/navigation.ts');
  files.push(['test/campaign.ts', read('../test/campaign.ts')] as const);

  // the metric itself: TENTHS_PER_CHART_UNIT * sqrt(dx^2 + (dy/CHART_Y_SQUASH)^2),
  // in either the old spelling or one written with the constants
  const forked = files.filter(([, src]) =>
    /(4|TENTHS_PER_CHART_UNIT) \* Math\.sqrt/.test(src)).map(([n]) => n);
  check(`only navigation.ts implements the distance metric${forked.length ? ' — found in ' + forked.join(', ') : ''}`,
    forked.length === 0);
  // the half-weight-y comparison, which galacticJump used to inline
  const inlined = files.filter(([, src]) =>
    /\(s\.y - from\.y\) \/ 2|dx \* dx \+ dy \* dy(?! \+)/.test(src)).map(([n]) => n);
  check(`nobody re-inlines the squared form${inlined.length ? ' — found in ' + inlined.join(', ') : ''}`,
    inlined.length === 0);
  // and the jump-day formula, which game.ts, campaign.ts and living.ts each
  // had a copy of
  const days = files.filter(([, src]) =>
    /(1|JUMP_DAYS_BASE) \+ Math\.ceil\([a-zA-Z.()\[\] ]*\/ (20|TENTHS_PER_JUMP_DAY)\)/.test(src))
    .map(([n]) => n);
  check(`only navigation.ts computes jump days${days.length ? ' — found in ' + days.join(', ') : ''}`,
    days.length === 0);
  // the control: the scan reads real files and its patterns do fire
  check(`...and the scan read the whole tree (${files.length} files)`,
    files.length > 100 && /(4|TENTHS_PER_CHART_UNIT) \* Math\.sqrt/
      .test(read('../src/galaxy/navigation.ts')));

  const nav = read('../src/galaxy/navigation.ts');
  check('navigation.ts imports nothing but the system type and its constants',
    (nav.match(/^import /gm) ?? []).length === 3
    && /import type \{ StarSystem \}/.test(nav)
    && !/from '(?!\.\/galaxy\.ts|\.\.\/constants\/)/.test(nav));
}

// --- inhabitant portraits ---------------------------------------------------

// The game builds these paths at runtime from a system's index and name
// (screens.ts portraitUrl), while the files are written offline by
// tools/generate-species.py. That is a filename convention shared by two
// programs with nothing connecting them: rename a system, change the padding,
// or regenerate half a galaxy, and the portraits silently stop appearing —
// there is no error, just the old text-only page. So assert the mapping.

console.log('\ninhabitant portraits');
{
  const dir = new URL('../public/species/', import.meta.url);
  const url = (s: { index: number; name: string }) =>
    `${String(s.index).padStart(3, '0')}-${s.name.toLowerCase()}.png`;
  const have = new Set(readdirSync(dir).filter((f) => f.endsWith('.png')));
  const missing = g1.filter((s) => !have.has(url(s)));
  const stray = [...have].filter((f) => !g1.some((s) => url(s) === f));
  check(`every galaxy 1 system has a portrait (${g1.length - missing.length}/${g1.length})`,
    missing.length === 0);
  check(`no unreferenced portrait files (${stray.length} stray)`, stray.length === 0);
}

// --- hyperspace -------------------------------------------------------------

console.log('\nhyperspace');
{
  const sys = generateGalaxy(1);
  const cmdr = (systemIndex: number, fuel: number, stage = 0) =>
    ({ systemIndex, fuel, day: 0, mission: { stage } }) as unknown as CommanderData;
  // Lave -> Diso is a short hop; something far away is not
  const near = sys.reduce((best, s) => {
    const d = distanceTenths(sys[7], s);
    return s.index !== 7 && d > 0 && d < distanceTenths(sys[7], best) ? s : best;
  }, sys[0]);

  check('no target set is refused',
    checkJump(cmdr(7, 70), sys, null, false, false).ok === false);
  check('...and so is jumping to where you already are',
    checkJump(cmdr(7, 70), sys, 7, false, false).ok === false);
  {
    const r = checkJump(cmdr(7, 0), sys, near.index, false, false);
    check('an empty tank is refused', !r.ok && r.reason === 'noFuel');
    check('...with the right line',
      refusalMessage('noFuel', false).includes('RANGE')
      && refusalMessage('noFuel', true).includes('WITCH-SPACE'));
  }
  check('a countdown already running is not restarted',
    checkJump(cmdr(7, 70), sys, near.index, false, true).ok === false);
  {
    const r = checkJump(cmdr(7, 70), sys, near.index, false, false);
    check('a jump in range is allowed',
      r.ok && r.cost === distanceTenths(sys[7], near));
  }

  {
    // witch-space charges a flat rate regardless of how far the target is
    const far = sys.reduce((a, b) =>
      distanceTenths(sys[7], a) > distanceTenths(sys[7], b) ? a : b);
    check('escaping witch-space is a flat fare, not the chart distance',
      jumpCost(sys[7], far, true) === WITCHSPACE_ESCAPE_COST
      && jumpCost(sys[7], far, false) > WITCHSPACE_ESCAPE_COST);
    const c = cmdr(7, WITCHSPACE_ESCAPE_COST);
    check('...and is affordable on exactly that much fuel',
      checkJump(c, sys, far.index, true, false).ok === true);
    const r = resolveJump(c, sys, far.index, true, () => 0);
    check('...and cannot itself mis-jump', !r.misjump && c.fuel === 0);
  }

  {
    const c = cmdr(7, 70);
    const r = resolveJump(c, sys, near.index, false, () => 1); // never mis-jumps
    check('a jump moves you, spends fuel and takes time',
      c.systemIndex === near.index && c.fuel === 70 - jumpCost(sys[7], near, false)
      && r.days > 0 && c.day === r.days);
  }
  {
    // the original's cruelty: a mis-jump still charges full fare
    const c = cmdr(7, 70);
    const r = resolveJump(c, sys, near.index, false, () => 0); // always mis-jumps
    check('a mis-jump costs the fuel and gets you nowhere',
      r.misjump && r.days === 0 && c.systemIndex === 7
      && c.fuel === 70 - jumpCost(sys[7], near, false));
  }
  check('the courier run is the dangerous one',
    witchspaceChance(3) > witchspaceChance(0));
  check('...and the two chances are the ones constants/jump.ts states',
    witchspaceChance(3) === MISJUMP_CHANCE_PLANS && witchspaceChance(0) === MISJUMP_CHANCE
    && MISJUMP_CHANCE > 0 && MISJUMP_CHANCE_PLANS < 1);
}

// --- the chart metric, and what a jump costs in days ------------------------
//
// Two numbers turn chart coordinates into tenths of a light year, and they had
// six homes between them: `distanceTenths`, `distanceSq` and `distanceSqToPoint`
// in navigation.ts, a byte-identical private copy in living.ts, and both
// charts' `y / 2` and `fuel / 4` in ui/screens.ts. They are
// constants/chart-metric.ts now. What is asserted is the CLAIMS they are made
// of — the original's asymmetry, and the scale that makes a full tank 7.0 LY —
// rather than the expression, which would pass whatever the constants said.

console.log('\nthe chart metric');
{
  const at = (x: number, y: number) => ({ x, y }) as StarSystem;
  const origin = at(0, 0);

  check(`one unit of chart x is ${TENTHS_PER_CHART_UNIT} tenths of a light year`,
    distanceTenths(origin, at(1, 0)) === TENTHS_PER_CHART_UNIT
    && distanceTenths(origin, at(10, 0)) === TENTHS_PER_CHART_UNIT * 10);
  check(`...and one unit of chart y is ${CHART_Y_SQUASH}x less, which is the`
    + " original's half-height chart",
  distanceTenths(origin, at(0, CHART_Y_SQUASH)) === TENTHS_PER_CHART_UNIT);
  // The scale exists to make the classic range come out. MAX_FUEL is the
  // career's constant; the arithmetic that meets it is this file's subject.
  check('a full 70-tenth tank is the classic 7.0 LY of chart distance',
    distanceTenths(origin, at(70 / TENTHS_PER_CHART_UNIT, 0)) === 70);

  // The days rule: a base day plus one per TENTHS_PER_JUMP_DAY, rounded up.
  // living.ts had its own copy of this too, inlined beside its own copy of the
  // metric, so a convoy aged differently from a commander flying the same leg.
  check(`the shortest jump still costs ${JUMP_DAYS_BASE} day and a bit`,
    daysForJump(1) === JUMP_DAYS_BASE + 1 && daysForJump(0) === JUMP_DAYS_BASE);
  check(`...and a day per ${TENTHS_PER_JUMP_DAY} tenths after that, rounded up`,
    daysForJump(TENTHS_PER_JUMP_DAY) === JUMP_DAYS_BASE + 1
    && daysForJump(TENTHS_PER_JUMP_DAY + 1) === JUMP_DAYS_BASE + 2
    && daysForJump(TENTHS_PER_JUMP_DAY * 3) === JUMP_DAYS_BASE + 3);
}
