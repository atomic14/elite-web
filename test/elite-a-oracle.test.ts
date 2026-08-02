// The Elite-A combat oracle, checked against every row the pack supplies.
//
// TODO 21 proved the IMPORT; this file proves the ARITHMETIC. `combat-math.ts`
// holds no data and the catalogue holds no rules, so the only way to know they
// agree is to run every combination the pack tabulated:
//
//   15,600  player laser -> NPC        15 hulls x 4 lasers x 260 exact variants
//    3,900  NPC laser -> player        260 variants x 15 hulls, both encodings
//      570  min/max hits summary       15 hulls x 38 designs
//
// The 570 are DERIVED from each design's exact variants rather than read as a
// third opinion: a summary that agreed with itself would prove nothing. Rows are
// counted, not printed — 20,070 `ok` lines would drown the suite — and a
// mismatch reports the count and the first row that broke.
//
// One honest limit: `laserImmune` and `playerLaserMultiplier` were SOLVED from
// this same matrix by the importer, so the outgoing loop cannot independently
// discover that stations are immune. What it proves is that the rules here — the
// mask, the shift, the floor before defence, the subtraction and the ceiling —
// reproduce every row given that classification, itself pinned by name in
// `elite-a-catalogue.test.ts`.

import { readFileSync } from 'node:fs';

import { check, eq } from './harness.ts';
import {
  eliteADesign, eliteAPlayerHull, eliteAVariantsOf, npcCombatProfile, recommendedNpcProfile,
} from '../src/game/elite-a/catalogue.ts';
import {
  ELITE_A_DEFAULT_REGEN_PER_SECOND, ELITE_A_REGEN_TICKS_PER_SECOND, eliteADamageToNpc,
  eliteADamageToPlayer, eliteAEnergyAfterDamage, eliteAHitsToDestroy, eliteAIsDestroyed,
  eliteALaserIsContinuous, eliteALaserPower, eliteANpcCanFireLaser, eliteANpcDefence,
  eliteANpcLaserPower, eliteANpcLaserStrength, eliteANpcMissileCount, eliteAPlayerLaserDamage,
  eliteAPlayerLaserHit, eliteARegenerate, eliteARegenTicks, eliteAScaledPlayerHit,
  type EliteARegenState,
} from '../src/game/elite-a/combat-math.ts';
import { ELITE_A_DESIGNS } from '../src/game/elite-a/designs.generated.ts';
import { ELITE_A_PLAYER_HULLS } from '../src/game/elite-a/player-hulls.generated.ts';
import { ELITE_A_VARIANTS } from '../src/game/elite-a/variants.generated.ts';
import type { EliteALaserType } from '../src/game/elite-a/types.ts';

interface HitsFixture {
  readonly playerShips: string[]; readonly laserTypes: EliteALaserType[];
  readonly variants: string[]; readonly effectiveDamagePerHit: number[];
  readonly hitsToDestroy: (number | null)[];
}
interface DamageFixture {
  readonly variants: string[]; readonly playerShips: string[];
  readonly playerPerHitShieldArmour: number[]; readonly cleanBeforeArmour: number[];
  readonly originalBeforeArmour: number[]; readonly cleanAfterArmour: number[];
  readonly originalAfterArmour: number[];
}
interface RangeFixture {
  readonly playerShips: string[]; readonly designs: string[];
  readonly laserTypes: EliteALaserType[]; readonly rows: (number | null)[][];
}

const fixture = <T>(name: string): T => JSON.parse(
  readFileSync(new URL(`./fixtures/elite-a/${name}.json`, import.meta.url), 'utf8')) as T;

const hitsFixture = fixture<HitsFixture>('hits-to-destroy');
const damageFixture = fixture<DamageFixture>('npc-damage-to-player');
const rangeFixture = fixture<RangeFixture>('hit-ranges');

/** Count failures instead of printing 20,070 lines; keep the first one. */
class Tally {
  count = 0;
  first = '';
  fail(detail: string): void {
    this.count += 1;
    if (this.first === '') this.first = detail;
  }

  report(name: string, expected: number, rows: number): void {
    eq(`${name}: every row visited`, rows, expected);
    check(`${name}: every row reproduced`, this.count === 0,
      `${this.count} row(s) disagree, first: ${this.first}`);
  }
}

console.log('\n--- elite-a combat oracle ---');

// --- the axes really are the catalogue's, in the catalogue's order -----------
check('the fixture axes are the catalogue in order',
  hitsFixture.playerShips.join(',') === ELITE_A_PLAYER_HULLS.map((h) => h.name).join(',')
  && hitsFixture.variants.join(',') === ELITE_A_VARIANTS.map((v) => v.variantId).join(',')
  && damageFixture.variants.join(',') === ELITE_A_VARIANTS.map((v) => v.variantId).join(',')
  && damageFixture.playerShips.join(',') === ELITE_A_PLAYER_HULLS.map((h) => h.name).join(',')
  && rangeFixture.playerShips.join(',') === ELITE_A_PLAYER_HULLS.map((h) => h.name).join(',')
  && rangeFixture.designs.join(',') === ELITE_A_DESIGNS.map((d) => d.shipName).join(','));
check('the player armour column is the hulls\' own',
  damageFixture.playerPerHitShieldArmour.join(',')
  === ELITE_A_PLAYER_HULLS.map((h) => h.perHitShieldArmour).join(','));

// --- the rules agree with the numbers the catalogue stores -------------------
// The pack decodes each variant's weapon byte itself, and those columns feed
// nothing here — which makes them a free second opinion on the decode.
{
  const tally = new Tally();
  for (const variant of ELITE_A_VARIANTS) {
    const design = eliteADesign(variant.designId);
    const byte = variant.weaponByte;
    if (eliteANpcDefence(variant.maxEnergy) !== variant.perHitDefence
      || eliteANpcLaserPower(byte) !== variant.laserPower
      || eliteANpcCanFireLaser(byte) !== variant.canFireLaser
      || eliteANpcMissileCount(byte) !== design.missileCount
      || byte >> 1 !== variant.weaponByteShiftedHalf
      || eliteANpcLaserStrength(byte, 'clean') !== variant.npcLaserDamageCleanBeforeArmour
      || eliteANpcLaserStrength(byte, 'original')
        !== variant.npcLaserDamageOriginalBeforeArmour) {
      tally.fail(`${variant.variantId} weapon byte ${byte}`);
    }
  }
  tally.report('variant decode', 260, ELITE_A_VARIANTS.length);
}
{
  const tally = new Tally();
  let cells = 0;
  for (const hull of ELITE_A_PLAYER_HULLS) {
    for (const type of hitsFixture.laserTypes) {
      const laser = hull.lasers[type];
      cells += 1;
      if (eliteALaserPower(laser.rawByte) !== laser.power
        || eliteALaserIsContinuous(laser.rawByte) !== laser.continuousFlag
        || eliteAPlayerLaserHit(laser.rawByte) !== laser.baseDamagePerHit) {
        tally.fail(`${hull.name} ${type} raw ${laser.rawByte}`);
      }
    }
  }
  tally.report('fitted laser decode', 60, cells);
}

// --- 15,600 player-to-NPC rows ----------------------------------------------
// Each row also has its hits-to-destroy FLOWN: apply that many hits and the
// target must be dead, one fewer and it must not be — which is what makes the
// ceiling division and `energy <= 0` one claim rather than two.
{
  const effect = new Tally();
  const count = new Tally();
  const flown = new Tally();
  let cursor = 0;
  for (const hull of ELITE_A_PLAYER_HULLS) {
    for (const type of hitsFixture.laserTypes) {
      const raw = hull.lasers[type].rawByte;
      for (const variantId of hitsFixture.variants) {
        const target = npcCombatProfile(variantId);
        const where = `${hull.name}/${type}/${variantId}`;
        const damage = eliteAPlayerLaserDamage(raw, target);
        const hits = eliteAHitsToDestroy(raw, target);
        if (damage !== hitsFixture.effectiveDamagePerHit[cursor]) {
          effect.fail(`${where} got ${damage}, want ${hitsFixture.effectiveDamagePerHit[cursor]}`);
        }
        if (hits !== hitsFixture.hitsToDestroy[cursor]) {
          count.fail(`${where} got ${hits}, want ${hitsFixture.hitsToDestroy[cursor]}`);
        }
        if (hits !== null) {
          let energy = target.maxEnergy;
          for (let i = 0; i < hits - 1; i += 1) energy = eliteAEnergyAfterDamage(energy, damage);
          const survived = !eliteAIsDestroyed(energy);
          const dead = eliteAIsDestroyed(eliteAEnergyAfterDamage(energy, damage));
          if (!survived || !dead) flown.fail(`${where} survived=${survived} dead=${dead}`);
        }
        cursor += 1;
      }
    }
  }
  effect.report('damage per hit', 15600, cursor);
  count.report('hits to destroy', 15600, cursor);
  flown.report('hits to destroy, flown', 15600, cursor);
}

// --- 3,900 NPC-to-player rows, both encodings -------------------------------
{
  const clean = new Tally();
  const original = new Tally();
  const before = new Tally();
  let cursor = 0;
  for (const [index, variantId] of damageFixture.variants.entries()) {
    const byte = npcCombatProfile(variantId).weaponByte;
    if (eliteANpcLaserStrength(byte, 'clean') !== damageFixture.cleanBeforeArmour[index]
      || eliteANpcLaserStrength(byte, 'original') !== damageFixture.originalBeforeArmour[index]) {
      before.fail(`${variantId} weapon byte ${byte}`);
    }
    for (const hull of ELITE_A_PLAYER_HULLS) {
      const armour = hull.perHitShieldArmour;
      const where = `${variantId}/${hull.name}`;
      const gotClean = eliteADamageToPlayer(byte, armour);
      const gotOriginal = eliteADamageToPlayer(byte, armour, 'original');
      if (gotClean !== damageFixture.cleanAfterArmour[cursor]) {
        clean.fail(`${where} got ${gotClean}, want ${damageFixture.cleanAfterArmour[cursor]}`);
      }
      if (gotOriginal !== damageFixture.originalAfterArmour[cursor]) {
        original.fail(
          `${where} got ${gotOriginal}, want ${damageFixture.originalAfterArmour[cursor]}`);
      }
      cursor += 1;
    }
  }
  before.report('NPC laser strength before armour', 260, damageFixture.variants.length);
  clean.report('NPC laser after armour, clean', 3900, cursor);
  original.report('NPC laser after armour, original', 3900, cursor);
}

// --- 570 range rows, derived from the exact variants ------------------------
{
  const tally = new Tally();
  let cursor = 0;
  for (const hull of ELITE_A_PLAYER_HULLS) {
    for (const design of ELITE_A_DESIGNS) {
      const expected = rangeFixture.rows[cursor];
      const derived: (number | null)[] = [];
      for (const type of rangeFixture.laserTypes) {
        const raw = hull.lasers[type].rawByte;
        const perVariant = eliteAVariantsOf(design.designId)
          .map((variant) => eliteAHitsToDestroy(raw, npcCombatProfile(variant.variantId)));
        const lethal = perVariant.filter((hits): hits is number => hits !== null);
        const barren = perVariant.length - lethal.length;
        derived.push(lethal.length === 0 ? null : Math.min(...lethal));
        derived.push(lethal.length === 0 ? null : Math.max(...lethal));
        derived.push(barren);
        derived.push(barren === perVariant.length ? 1 : 0);
      }
      if (derived.join(',') !== expected.join(',')) {
        tally.fail(`${hull.name}/${design.shipName} got [${derived}], want [${expected}]`);
      }
      cursor += 1;
    }
  }
  tally.report('min/max hits per design', 570, cursor);
}

console.log('\nelite-a oracle — the cases the contract names');

// Station immunity: never any damage, never destroyable, whatever is fitted.
{
  const stations = ELITE_A_DESIGNS.filter((d) => d.laserImmune);
  const touched = stations.flatMap((d) => eliteAVariantsOf(d.designId))
    .flatMap((v) => ELITE_A_PLAYER_HULLS.flatMap((hull) => hitsFixture.laserTypes
      .map((type) => [hull.lasers[type].rawByte, npcCombatProfile(v.variantId)] as const)))
    .filter(([raw, target]) => eliteAPlayerLaserDamage(raw, target) !== 0
      || eliteAHitsToDestroy(raw, target) !== null);
  eq('the two stations are the immune designs', stations.length, 2);
  eq('no fitted laser touches a station', touched.length, 0);
}

// No damage: defence can cancel a hit entirely, and then there is no hit count.
{
  const dragon = recommendedNpcProfile(29);
  const adderPulse = eliteAPlayerHull(0).lasers.pulse.rawByte;
  eq('a Dragon\'s 7 points of defence eat an Adder\'s 7-point pulse',
    eliteAPlayerLaserDamage(adderPulse, dragon), 0);
  eq('...so it never dies to one', eliteAHitsToDestroy(adderPulse, dragon), null);
  eq('damage never goes negative',
    eliteADamageToNpc(1, { maxEnergy: 255, laserImmune: false, playerLaserMultiplier: 1 }), 0);
}

// The Constrictor halves BEFORE defence, and the half is floored.
{
  const constrictor = npcCombatProfile('G:28');
  eq('the Constrictor is the halved design', constrictor.playerLaserMultiplier, 0.5);
  eq('a 7-point hit halves to 3, not 3.5', eliteAScaledPlayerHit(7, constrictor), 3);
  eq('...and 3 points of defence leave nothing', eliteADamageToNpc(7, constrictor), 0);
  check('halving after defence would have left 2 — it does not',
    eliteADamageToNpc(7, constrictor) !== Math.floor((7 - constrictor.perHitDefence) * 0.5));
  eq('an Anaconda military laser halves to 31 and gets through',
    eliteADamageToNpc(eliteAPlayerLaserHit(
      eliteAPlayerHull(14).lasers.military.rawByte), constrictor), 28);
  eq('...in 5 hits', eliteAHitsToDestroy(
    eliteAPlayerHull(14).lasers.military.rawByte, constrictor), 5);
}

// The continuous bit is a flag, not 64 points of laser.
{
  let masked = 0;
  for (let raw = 0; raw <= 255; raw += 1) {
    if (eliteALaserPower(raw) === (raw & 0x7f)
      && eliteAPlayerLaserHit(raw) === eliteAPlayerLaserHit(raw & 0x7f)
      && eliteALaserIsContinuous(raw) === (raw >= 128)) masked += 1;
  }
  eq('every byte 0-255 masks its high bit off the power', masked, 256);
  const beam = eliteAPlayerHull(0).lasers.beam;
  check('the Adder\'s beam is continuous and still a 7-point hit',
    eliteALaserIsContinuous(beam.rawByte) && eliteAPlayerLaserHit(beam.rawByte) === 7
    && eliteAPlayerLaserHit(14) === 7);
}

// Missiles do not make a laser stronger — under the clean rule.
{
  let independent = 0;
  let leaked = 0;
  for (let byte = 0; byte <= 255; byte += 1) {
    if (eliteANpcLaserStrength(byte, 'clean') === eliteANpcLaserStrength(byte & 0xf8, 'clean')) {
      independent += 1;
    }
    if (eliteANpcCanFireLaser(byte) && eliteANpcMissileCount(byte) >= 2
      && eliteANpcLaserStrength(byte, 'original')
        !== eliteANpcLaserStrength(byte & 0xf8, 'original')) leaked += 1;
  }
  eq('clean strength ignores the missile bits for all 256 bytes', independent, 256);
  check('...and the original encoding does not, which is why it is diagnostic only',
    leaked > 0);
  eq('an Adder (byte 33) and a Ghavial (byte 39) both fire 4-power lasers',
    `${eliteANpcLaserStrength(33)}/${eliteANpcLaserStrength(39)}`, '16/16');
  eq('...but the released shift reads their missiles too',
    `${eliteANpcLaserStrength(33, 'original')}/${eliteANpcLaserStrength(39, 'original')}`,
    '16/19');
}

// The diagnostic mode still checks the laser bits first.
eq('a Coriolis station carries 6 missiles and no laser',
  `${eliteANpcMissileCount(6)}/${eliteANpcLaserPower(6)}`, '6/0');
eq('...so the released shift scores 0, not 3', eliteANpcLaserStrength(6, 'original'), 0);
eq('...and so does the clean rule', eliteANpcLaserStrength(6, 'clean'), 0);
eq('a station therefore does no laser damage to any hull', ELITE_A_PLAYER_HULLS
  .filter((h) => eliteADamageToPlayer(6, h.perHitShieldArmour, 'original') !== 0).length, 0);
eq('armour subtracts once and cannot go negative', eliteADamageToPlayer(33, 100), 0);
eq('a Cobra Mk III takes 9 from a 4-power laser',
  eliteADamageToPlayer(33, eliteAPlayerHull(7).perHitShieldArmour), 9);

// Destruction is at exactly zero — the survival quirk is deliberately gone.
check('zero energy is destroyed', eliteAIsDestroyed(0));
check('...and one point is not', !eliteAIsDestroyed(1));
check('...and negative energy stays destroyed', eliteAIsDestroyed(-3));
eq('damage is floored at zero rather than going negative', eliteAEnergyAfterDamage(3, 10), 0);
check('a hit that exactly empties the bank kills',
  eliteAIsDestroyed(eliteAEnergyAfterDamage(16, 16)));

console.log('\nelite-a oracle — regeneration');

/** Fly `steps` frames of 1/hz. The count is given, never derived from a float. */
const run = (hz: number, steps: number, rate: number, from: EliteARegenState,
  max: number): EliteARegenState => {
  let state = from;
  for (let step = 0; step < steps; step += 1) state = eliteARegenerate(state, max, rate, 1 / hz);
  return state;
};
/** The rates, then the same 10 seconds and the same 3 1/3 seconds at each. */
const RATES = [15, 60, 144];
const TEN_SECONDS = [150, 600, 1440];
const TEN_THIRDS = [50, 200, 480];

{
  eq('the default rate is the contract\'s one point per second',
    ELITE_A_DEFAULT_REGEN_PER_SECOND, 1);
  eq('every frame rate under test divides the tick base exactly',
    RATES.filter((hz) => ELITE_A_REGEN_TICKS_PER_SECOND % hz === 0).length, RATES.length);
  eq('...and a frame at each is a whole number of ticks',
    RATES.map((hz) => eliteARegenTicks(1 / hz)).join(','), '240,60,25');
  check('the step counts really are the same elapsed time',
    RATES.every((hz, i) => TEN_SECONDS[i] / hz === 10)
    && new Set(RATES.map((hz, i) => TEN_THIRDS[i] / hz)).size === 1);
  const start = { energy: 100, carryTicks: 0 };
  const tenSeconds = RATES.map((hz, i) => run(hz, TEN_SECONDS[i], 1, start, 255));
  eq('ten seconds is ten points at 15, 60 and 144 Hz alike',
    tenSeconds.map((s) => `${s.energy}:${s.carryTicks}`).join(' '), '110:0 110:0 110:0');

  // 3 1/3 seconds is a whole number of ticks at all three rates but not a whole
  // number of POINTS, so the remainder has to agree too — and the remainder is
  // exactly what a running float sum of `dt` loses.
  const thirds = RATES.map((hz, i) => run(hz, TEN_THIRDS[i], 1, start, 255));
  eq('3 1/3 seconds is 3 points and an identical remainder at all three',
    thirds.map((s) => `${s.energy}:${s.carryTicks}`).join(' '), '103:1200 103:1200 103:1200');

  const slow = RATES.map((hz, i) => run(hz, TEN_SECONDS[i], 0.5, start, 255));
  eq('half a point per second is 5 points in ten, at all three',
    slow.map((s) => s.energy).join(','), '105,105,105');
  const fast = RATES.map((hz, i) => run(hz, TEN_SECONDS[i], 7.5, start, 255));
  eq('7.5 a second is 75 more in ten, at all three',
    fast.map((s) => s.energy).join(','), '175,175,175');

  eq('a rate of 0 never regenerates — stations, missiles, cargo and rocks',
    eliteARegenerate({ energy: 50, carryTicks: 0 }, 255, 0, 10).energy, 50);
  eq('a destroyed ship does not come back',
    eliteARegenerate({ energy: 0, carryTicks: 0 }, 255, 1, 60).energy, 0);
  eq('regeneration stops at maximum',
    run(60, 3600, 1, { energy: 250, carryTicks: 0 }, 255).energy, 255);
  check('...and a full ship banks nothing, so damage does not come straight back',
    run(60, 3600, 1, { energy: 255, carryTicks: 0 }, 255).carryTicks === 0);

  eq('a negative frame time contributes nothing', eliteARegenTicks(-1), 0);
  eq('...nor does a zero one', eliteARegenTicks(0), 0);
  eq('...nor a NaN', eliteARegenTicks(Number.NaN), 0);
  const backwards = eliteARegenerate({ energy: 100, carryTicks: 0 }, 255, 1, -5);
  eq('a rewound clock leaves energy alone', `${backwards.energy}:${backwards.carryTicks}`, '100:0');
  eq('...and 600 backwards frames regenerate nothing where 600 forward ones give 10',
    `${run(60, 600, 1, { energy: 100, carryTicks: 0 }, 255).energy}/${
      run(-60, 600, 1, { energy: 100, carryTicks: 0 }, 255).energy}`, '110/100');
}

// --- the module stays a rule, not a system ----------------------------------
{
  const source = readFileSync(
    new URL('../src/game/elite-a/combat-math.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('combat-math.ts imports nothing at all', !/^\s*(import|require)\b/m.test(code));
  check('...names no browser API',
    !/\b(document|window|localStorage|navigator|requestAnimationFrame)\b/.test(code));
  check('...and rolls no dice', !/\bMath\.random\b/.test(code) && !/\brng\b/.test(code));
}
