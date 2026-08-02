// The generated Elite-A catalogue: is it all there, and is it still the pack's?
//
// This is TODO 21's gate and only TODO 21's. It asserts the IMPORT — counts,
// identity, dedup, index validity, the resolved recommended variant, and that
// neither the vendored pack nor the oracle matrices can reach the game. It does
// NOT check combat arithmetic: reproducing the 15,600 and 3,900 oracle rows is
// TODO 22's job, and the fixtures below are what it will read.
//
// The counts are hard-coded on purpose. They come from the pack's own README,
// so a regeneration that quietly produced 259 variants fails here rather than
// being believed.

import { readFileSync, readdirSync } from 'node:fs';

import { check, eq } from './harness.ts';
import {
  ELITE_A_NO_FACE, eliteADesign, eliteAGeometry, eliteANewbFlags, eliteAPlayerHull,
  eliteASlotsForSet, eliteATargetRadius, eliteAVariant, eliteAVariantsOf,
  npcCombatProfile, recommendedNpcProfile,
} from '../src/game/elite-a/catalogue.ts';
import { ELITE_A_DESIGNS } from '../src/game/elite-a/designs.generated.ts';
import { ELITE_A_GEOMETRY } from '../src/game/elite-a/geometry.generated.ts';
import { ELITE_A_PLAYER_HULLS } from '../src/game/elite-a/player-hulls.generated.ts';
import {
  ELITE_A_COUNTS, ELITE_A_SOURCE_HASH,
} from '../src/game/elite-a/provenance.generated.ts';
import { ELITE_A_SLOTS } from '../src/game/elite-a/slots.generated.ts';
import { ELITE_A_VARIANTS } from '../src/game/elite-a/variants.generated.ts';

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`./fixtures/elite-a/${name}.json`, import.meta.url), 'utf8'));

console.log('\n--- elite-a catalogue ---');

// --- the counts the pack states ---------------------------------------------

eq('15 player hulls', ELITE_A_PLAYER_HULLS.length, 15);
eq('38 designs', ELITE_A_DESIGNS.length, 38);
eq('260 exact variants', ELITE_A_VARIANTS.length, 260);
eq('713 slot rows', ELITE_A_SLOTS.length, 713);
eq('398 populated slots',
  ELITE_A_SLOTS.filter((s) => s.designId !== null).length, 398);
eq('23 blueprint sets',
  new Set(ELITE_A_SLOTS.map((s) => s.blueprintSet)).size, 23);
eq('one geometry per design', ELITE_A_GEOMETRY.length, 38);
check('the provenance counts agree with the data',
  ELITE_A_COUNTS.designs === ELITE_A_DESIGNS.length
  && ELITE_A_COUNTS.variants === ELITE_A_VARIANTS.length
  && ELITE_A_COUNTS.slotRows === ELITE_A_SLOTS.length
  && ELITE_A_COUNTS.populatedSlots === 398
  && ELITE_A_COUNTS.playerHulls === ELITE_A_PLAYER_HULLS.length);
check('every generated module carries the same source hash',
  /^[0-9a-f]{64}$/.test(ELITE_A_SOURCE_HASH)
  && readdirSync(new URL('../src/game/elite-a/', import.meta.url))
    .filter((name) => name.endsWith('.generated.ts'))
    .every((name) => readFileSync(
      new URL(`../src/game/elite-a/${name}`, import.meta.url), 'utf8')
      .includes(`source-hash: ${ELITE_A_SOURCE_HASH}`)));
check('...and says not to edit it',
  readdirSync(new URL('../src/game/elite-a/', import.meta.url))
    .filter((name) => name.endsWith('.generated.ts'))
    .every((name) => readFileSync(
      new URL(`../src/game/elite-a/${name}`, import.meta.url), 'utf8')
      .startsWith('// GENERATED FILE — DO NOT EDIT.')));

// --- identity ---------------------------------------------------------------

eq('designs are numbered 0..37 in order',
  ELITE_A_DESIGNS.map((d) => d.designId).join(','), [...Array(38).keys()].join(','));
eq('player hulls are numbered 0..14 in order',
  ELITE_A_PLAYER_HULLS.map((h) => h.playerShipId).join(','),
  [...Array(15).keys()].join(','));
eq('variant ids are unique', new Set(ELITE_A_VARIANTS.map((v) => v.variantId)).size, 260);
check('a variant id is `set:designId`',
  ELITE_A_VARIANTS.every((v) => v.variantId === `${v.blueprintSet}:${v.designId}`));
eq('the common missile is its own set', eliteAVariant('COMMON:15').designId, 15);
eq('...and hull 0 is the Adder, as Elite-A starts you', eliteAPlayerHull(0).name, 'Adder');
eq('Cobra Mk III is design 10', eliteADesign(10).shipName, 'Cobra Mk III');
check('every variant belongs to a real design',
  ELITE_A_VARIANTS.every((v) => eliteADesign(v.designId).designId === v.designId));
check('every populated slot names a real design',
  ELITE_A_SLOTS.every((s) => s.designId === null
    || eliteADesign(s.designId).shipSymbol === s.shipSymbol));
eq('set A has 31 slots', eliteASlotsForSet('A').length, 31);

// --- geometry: deduplicated by design, and every index in range -------------

check('a design owns exactly one hull',
  new Set(ELITE_A_GEOMETRY.map((g) => g.designId)).size === 38
  && ELITE_A_DESIGNS.every((d) => eliteAGeometry(d.designId).designId === d.designId));
check('geometry is stored once, not per variant',
  ELITE_A_GEOMETRY.length < ELITE_A_VARIANTS.length);
check('vertex, edge and face counts match the design header',
  ELITE_A_DESIGNS.every((d) => {
    const g = eliteAGeometry(d.designId);
    return g.vertices.length === d.vertexCount * 8
      && g.edges.length === d.edgeCount * 5
      && g.faces.length === d.faceCount * 4;
  }));
{
  let badVertex = 0;
  let badFace = 0;
  for (const design of ELITE_A_DESIGNS) {
    const g = eliteAGeometry(design.designId);
    const faceOk = (i: number) => i === ELITE_A_NO_FACE || (i >= 0 && i < design.faceCount);
    for (let i = 0; i < g.vertices.length; i += 8) {
      for (let k = 3; k <= 6; k += 1) if (!faceOk(g.vertices[i + k]!)) badFace += 1;
    }
    for (let i = 0; i < g.edges.length; i += 5) {
      for (let k = 0; k <= 1; k += 1) {
        if (g.edges[i + k]! < 0 || g.edges[i + k]! >= design.vertexCount) badVertex += 1;
      }
      for (let k = 2; k <= 3; k += 1) if (!faceOk(g.edges[i + k]!)) badFace += 1;
    }
  }
  eq('every edge names a real vertex', badVertex, 0);
  eq('every face slot is an index or the no-face sentinel', badFace, 0);
}
eq('the Dragon has no whole-number radius, so it is derived',
  Math.round(eliteATargetRadius(eliteADesign(29)) * 1000) / 1000, 161.839);
eq('...and the Coriolis station does have one',
  eliteATargetRadius(eliteADesign(1)), 160);

// --- classification, solved from the oracle ---------------------------------

eq('only the two stations are laser-immune',
  ELITE_A_DESIGNS.filter((d) => d.laserImmune).map((d) => d.shipName).join(', '),
  'Dodo station, Coriolis station');
eq('only the Constrictor halves incoming player laser hits',
  ELITE_A_DESIGNS.filter((d) => d.playerLaserMultiplier === 0.5)
    .map((d) => d.shipName).join(', '), 'Constrictor');
check('everything else takes player lasers at full strength',
  ELITE_A_DESIGNS.every((d) => d.laserImmune
    || d.playerLaserMultiplier === 1 || d.designId === 28));

// --- NEWB flags -------------------------------------------------------------

check('the NEWB byte decodes to eight independent bits',
  eliteANewbFlags(0b1000_0001).trader && eliteANewbFlags(0b1000_0001).escapePodFitted
  && !eliteANewbFlags(0b1000_0001).cop);
eq('slot A/2 is the station, and it is a cop',
  `${eliteASlotsForSet('A')[1]!.slotCategory}/${eliteANewbFlags(eliteASlotsForSet('A')[1]!.newbRaw).cop}`,
  'station/true');

// --- the recommended default resolves to a real variant ---------------------

{
  let unresolved = 0;
  let averaged = 0;
  for (const design of ELITE_A_DESIGNS) {
    const profile = recommendedNpcProfile(design.designId);
    if (profile.designId !== design.designId) unresolved += 1;
    const d = design.recommendedDefault;
    if (profile.maxEnergy !== d.maxEnergy || profile.perHitDefence !== d.perHitDefence
      || profile.maxSpeed !== d.maxSpeed || profile.laserPower !== d.laserPower
      || profile.missileCount !== d.missileCount || profile.weaponByte !== d.weaponByte
      || profile.canFireLaser !== d.canFireLaser
      || profile.bountyRawTenthsOfCredit !== d.bountyRawTenthsOfCredit
      || profile.maxCargoCanistersOnDestruction !== d.maxCargoCanistersOnDestruction) {
      averaged += 1;
    }
  }
  eq('every design resolves to one of its own variants', unresolved, 0);
  eq('...with the recommended tuple exactly, never an average', averaged, 0);
}
check('a tie is broken by A-W source order',
  ELITE_A_DESIGNS.every((design) => {
    const d = design.recommendedDefault;
    const first = eliteAVariantsOf(design.designId).find((v) => v.maxEnergy === d.maxEnergy
      && v.perHitDefence === d.perHitDefence && v.weaponByte === d.weaponByte
      && v.bountyRawTenthsOfCredit === d.bountyRawTenthsOfCredit);
    return first?.variantId === design.recommendedVariantId;
  }));
eq('the Constrictor has one variant, so its recommendation is that one',
  recommendedNpcProfile(28).variantId, 'G:28');
eq('a profile merges the design\'s constants with the variant\'s',
  `${npcCombatProfile('T:10').maxEnergy}/${npcCombatProfile('T:10').maxSpeed}`, '106/28');

// --- the fixtures the exhaustive tests will read ----------------------------

{
  const hits = fixture('hits-to-destroy');
  const damage = fixture('npc-damage-to-player');
  const ranges = fixture('hit-ranges');
  eq('15,600 outgoing-hit rows survive',
    (hits.effectiveDamagePerHit as number[]).length, 15600);
  eq('...paired with 15,600 hits-to-destroy',
    (hits.hitsToDestroy as (number | null)[]).length, 15600);
  eq('...over 15 hulls x 4 lasers x 260 variants',
    (hits.playerShips as string[]).length * (hits.laserTypes as string[]).length
    * (hits.variants as string[]).length, 15600);
  eq('3,900 incoming-hit rows survive',
    (damage.cleanAfterArmour as number[]).length, 3900);
  eq('...and the original encoding beside them',
    (damage.originalAfterArmour as number[]).length, 3900);
  eq('570 range rows survive', (ranges.rows as number[][]).length, 570);
  check('a range row is four lasers x four numbers',
    (ranges.rows as number[][]).every((row) => row.length === 16));
  check('the fixtures name the same variants as the catalogue',
    (hits.variants as string[]).join(',') === ELITE_A_VARIANTS.map((v) => v.variantId).join(',')
    && (damage.variants as string[]).join(',')
      === ELITE_A_VARIANTS.map((v) => v.variantId).join(','));
  check('...and were generated from the same pack',
    hits.sourceHash === ELITE_A_SOURCE_HASH && damage.sourceHash === ELITE_A_SOURCE_HASH
    && ranges.sourceHash === ELITE_A_SOURCE_HASH);
}

// --- the pack and the oracles stay out of the game --------------------------

{
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const sources = walk(new URL('../src/', import.meta.url));
  // Comments name the pack — that is the provenance stamp doing its job. Only
  // code that could actually LOAD it counts, so the comments come out first.
  const code = (text: string) => text
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const offenders = sources.filter((url) => {
    const text = code(readFileSync(url, 'utf8'));
    return /reference\/elite-a/.test(text) || /fixtures\/elite-a/.test(text);
  }).map((url) => url.pathname.split('/src/')[1]);
  eq('no runtime module reads the vendored pack or the oracle fixtures',
    offenders.join(', '), '');
  check('...and the pack really is vendored, so nothing needs to',
    readdirSync(new URL('../reference/elite-a/source/', import.meta.url))
      .filter((n) => !n.startsWith('.')).length === 10);
}
