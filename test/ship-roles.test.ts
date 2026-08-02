// The roster, and what it is allowed to contain.
//
// TODO 25's gate. `ship-identity.test.ts` asserts that a ship knows what it is;
// this asserts that what it is makes sense — that every hull the galaxy can put
// in the sky is a hull the released blueprint sets filed under that job, that
// all 38 designs can actually be built and resolved, that the ten ships this
// phase recovered can really turn up, and that the two Harmless inventions
// cannot wander into a source parity matrix.
//
// The things that can go quietly wrong later, and are checked here:
//
//   * a hull filed under a role the source never used it for — the easy
//     mistake, because a Sidewinder LOOKS like a trader's escort;
//   * a threat tier that stopped following the pack's own numbers;
//   * a design nothing can construct, which a viewer would show and the game
//     would crash on;
//   * a seeded run that picks different hulls after a save and reload — the
//     carried-over TODO 23 defect, where restore rebuilt a pirate from the tier
//     table instead of from the design its own snapshot recorded.

import { readFileSync, readdirSync } from 'node:fs';

import * as THREE from 'three';

import { check, eq } from './harness.ts';
import { eliteADesignIds, recommendedNpcProfile } from '../src/game/elite-a/catalogue.ts';
import {
  MISSION_TARGET_DESIGNS, roleAllowsDesign, roleCandidateDesigns, roleSourceBands,
  type NpcRole,
} from '../src/game/ship-roles.ts';
import {
  ASTEROID_IDENTITY, CONSTRICTOR_SPEC, PIRATE_TIERS, SPECS, pirateSpecForTier,
  shipAccel, sourceSpeedToWorld, specForDesign, WORLD_SPEED_PER_SOURCE_SPEED,
  type NpcSpec,
} from '../src/game/ship-specs.ts';
import { hullThreatTier, sourceThreatScore } from '../src/game/threat.ts';
import {
  isHarmlessOverlayId, npcCombatProfileById, recommendedProfileIdFor, shipDesign,
  shipDesignIdOf,
} from '../src/game/ship-identity.ts';
import { registeredHull, shipDisplayName } from '../src/ships/registry.ts';
import { STATION_DESIGNS, STATION_PRESENTATION_SCALE, stationDockZ } from '../src/ships/station-hulls.ts';
import { World } from '../src/game/world.ts';
import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { g1 } from './fixtures.ts';

console.log('\n--- the roster ---');

const ROLES = Object.keys(SPECS) as Exclude<NpcRole, 'asteroid'>[];
const rosterRows: { role: NpcRole; spec: NpcSpec }[] =
  ROLES.flatMap((role) => SPECS[role].map((spec) => ({ role, spec })));

// --- every role draws from its own source band ------------------------------

console.log('\nrole membership comes from the released slot bands');
{
  const strays = rosterRows.filter(
    ({ role, spec }) => !roleAllowsDesign(role, spec.designId)
      // the two Harmless inventions have no band at all, by design
      && !isHarmlessOverlayId(spec.designId));
  check('no roster row flies a design its role never occupied a slot for',
    strays.length === 0,
    strays.map((s) => `${s.role} ${shipDisplayName(s.spec.designId)}`).join(', '));

  // The tier tables and the mission target reach the sky by other routes, so
  // they are held to the same rule separately.
  const tierStrays = PIRATE_TIERS.flat()
    .filter((spec) => !roleAllowsDesign('pirate', spec.designId));
  check('...nor does any threat tier', tierStrays.length === 0,
    tierStrays.map((s) => shipDisplayName(s.designId)).join(', '));
  check('the Navy Constrictor is filed under its own released slot, not the pirates\'',
    MISSION_TARGET_DESIGNS.includes(CONSTRICTOR_SPEC.designId)
    && !roleAllowsDesign('pirate', CONSTRICTOR_SPEC.designId));
  check('a rock is one of the three mining designs',
    roleAllowsDesign('asteroid', ASTEROID_IDENTITY.designId));

  // ...and the bands are the ones the source uses, not a re-typed guess.
  eq('the police band is the cop slot and holds exactly the Viper',
    roleCandidateDesigns('police').join(), shipDesignIdOf(16));
  eq('the Thargoid band holds exactly the Thargoid', roleCandidateDesigns('thargoid').join(),
    shipDesignIdOf(26));
  check('a trader draws from the shuttle, trader and child bands',
    roleSourceBands('trader').join() === 'shuttle,trader,child');
  // The child band admits the Sidewinder alongside the Worm — ship-roles.ts
  // says why — so this is the roster declining a permission, not a band.
  check('...so a Sidewinder may be small civilian traffic, and the roster says no',
    roleAllowsDesign('trader', shipDesignIdOf(17))
    && !SPECS.trader.some((s) => s.designId === shipDesignIdOf(17)));
  check('...and an Anaconda is a trader and never a pirate',
    roleAllowsDesign('trader', shipDesignIdOf(13))
    && !roleAllowsDesign('pirate', shipDesignIdOf(13)));
}

// --- custom ships cannot enter a parity matrix ------------------------------

console.log('\nthe Harmless inventions stay out of the source model');
{
  const customRoles = ['hermit', 'generation'] as const;
  check('neither custom role has a source band to draw from',
    customRoles.every((role) => roleCandidateDesigns(role).length === 0
      && roleSourceBands(role).length === 0));
  const custom = customRoles.flatMap((role) => SPECS[role]);
  check('...and both their rows carry harmless: ids on BOTH identities',
    custom.length === 2 && custom.every((s) =>
      isHarmlessOverlayId(s.designId) && isHarmlessOverlayId(s.profileId)));
  check('...which resolve to an overlay, never to a released combat profile',
    custom.every((s) => shipDesign(s.designId).source === 'harmless'
      && npcCombatProfileById(s.profileId).source === 'harmless'));
  // The converse, which is what "cannot enter a parity matrix" means: every
  // source-backed roster row DOES resolve to one, so a filter on the tagged
  // union is a complete partition rather than a best effort.
  const sourceBacked = rosterRows
    .filter(({ spec }) => !isHarmlessOverlayId(spec.designId))
    .map(({ spec }) => spec);
  check('every other roster row resolves to a released build, with nothing between',
    sourceBacked.length === rosterRows.length - 2
    && sourceBacked.every((s) => npcCombatProfileById(s.profileId).source === 'elite-a'));
}

// --- the whole catalogue is usable ------------------------------------------

console.log('\nall 38 designs are constructible and profile-resolvable');
{
  const ids = eliteADesignIds();
  eq('the catalogue is still 38 designs', ids.length, 38);
  const broken: string[] = [];
  for (const sourceId of ids) {
    const designId = shipDesignIdOf(sourceId);
    try {
      const hull = registeredHull(designId);
      const profile = recommendedNpcProfile(sourceId);
      if (!hull.def || hull.targetRadius <= 0) broken.push(`${designId} geometry`);
      if (npcCombatProfileById(recommendedProfileIdFor(designId)).source !== 'elite-a'
        || profile.designId !== sourceId) broken.push(`${designId} profile`);
    } catch (e) {
      broken.push(`${designId} threw ${(e as Error).message}`);
    }
  }
  check('every source design builds a hull and resolves a recommended build',
    broken.length === 0, broken.join(', '));
}

// --- the ten missing ships can actually turn up -----------------------------

console.log('\nthe ten recovered ships reach the sky through a role');
{
  const RECOVERED: Record<string, number> = {
    'Cobra Mk I': 22, Dragon: 29, Monitor: 30, Ophidian: 31, Ghavial: 32,
    Bushmaster: 33, Rattler: 34, Iguana: 35, 'Shuttle Mk II': 36, Chameleon: 37,
  };
  const missing: string[] = [];
  const summary: string[] = [];
  for (const [name, sourceId] of Object.entries(RECOVERED)) {
    const designId = shipDesignIdOf(sourceId);
    const roles = ROLES.filter((role) => SPECS[role].some((s) => s.designId === designId));
    if (roles.length === 0) missing.push(name);
    // ...and every role it was added to is one the source supports
    if (roles.some((role) => !roleAllowsDesign(role, designId))) missing.push(`${name} (band)`);
    summary.push(`${name}: ${roles.join('/')}`);
  }
  check(`all ten are rostered — ${summary.join('; ')}`, missing.length === 0,
    missing.join(', '));

  // The other direction: everything the roster now flies is a design that can
  // be drawn, so a new row cannot be a name with no hull behind it.
  check('every roster row has a hull to build',
    rosterRows.every(({ spec }) => spec.designId === SPECS.hermit[0].designId
      || registeredHull(spec.designId).def !== null));
}

// --- the tiers follow the pack, not a typed-out table -----------------------

console.log('\npirate threat tiers classify from source combat fields');
{
  check('all three tiers have hulls in them',
    PIRATE_TIERS.length === 3 && PIRATE_TIERS.every((t) => t.length > 0));
  check('every tier entry is a row of the pirate roster, not a second copy',
    PIRATE_TIERS.flat().every((s) => SPECS.pirate.includes(s)));
  check('...and every pirate hull is in exactly one tier',
    PIRATE_TIERS.flat().length === SPECS.pirate.length
    && new Set(PIRATE_TIERS.flat()).size === SPECS.pirate.length);
  check('the tier is the classification, with nothing overriding it in the table',
    PIRATE_TIERS.every((tier, t) =>
      tier.every((s) => hullThreatTier(s.designId, s.profileId) === t)));

  // The classification is monotone in the numbers it claims to read.
  const scored = SPECS.pirate.map((s) => ({
    name: shipDisplayName(s.designId), score: sourceThreatScore(s.profileId),
    tier: hullThreatTier(s.designId, s.profileId),
  }));
  const sidewinder = scored.find((s) => s.name === 'Sidewinder')!;
  const krait = scored.find((s) => s.name === 'Krait')!;
  eq('the Sidewinder and the Krait are the same released ship, to the point',
    sidewinder.score, krait.score);
  check('...so the Sidewinder is the ONE curated exception, held at tier 0',
    sidewinder.tier === 0 && krait.tier === 1);
  const others = scored.filter((s) => s.name !== 'Sidewinder');
  check('every other hull\'s tier is a pure function of its score',
    others.every((a) => others.every((b) =>
      !(a.score > b.score && a.tier < b.tier))),
    others.map((s) => `${s.name} ${s.score}/${s.tier}`).join(', '));

  // The tier a hull lands in follows the BUILD it flies, and TODO 29 changed
  // which build that is: a combat role now takes the hardest variant the source
  // ever filed under its own job (game/role-variants.ts), so a hull with a
  // harder gun scores higher and several moved up. Recorded here rather than
  // argued about — the Gecko went 0 -> 1 and the pirate Cobra Mk III 1 -> 2, and
  // the Asp Mk II left the roster entirely because no released build of it can
  // hurt a flyable hull.
  eq('tier 0 opens Sidewinder, Worm, Ophidian',
    [0, 1, 2].map((k) => shipDisplayName(pirateSpecForTier(0, k).designId)).join(),
    'Sidewinder,Worm,Ophidian');
  eq('tier 1 opens Krait, Mamba, Gecko, Moray',
    [0, 1, 2, 3].map((k) => shipDisplayName(pirateSpecForTier(1, k).designId)).join(),
    'Krait,Mamba,Gecko,Moray');
  eq('tier 2 opens Cobra Mk III, Fer-de-Lance, Python',
    [0, 1, 2].map((k) => shipDisplayName(pirateSpecForTier(2, k).designId)).join(),
    'Cobra Mk III,Fer-de-Lance,Python');
  check('...and no tier is empty, so every threat level has hulls to draw from',
    PIRATE_TIERS.every((tier) => tier.length > 0));
}

// --- no source combat field is copied into the tables -----------------------

console.log('\nthe roster states Harmless policy and nothing the pack owns');
{
  // A source check, in the style of the brain-file gates: the point is not that
  // today's numbers are right, it is that the next person to add a row cannot
  // paste an energy or a defence value in beside them. Combat reads those
  // through `profileId`, and a copy here would go stale the day the pack is
  // re-imported.
  const src = readFileSync(new URL('../src/game/ship-specs.ts', import.meta.url), 'utf8');
  const forbidden = [
    'maxEnergy', 'perHitDefence', 'laserPower', 'weaponByte', 'bountyRaw',
    'npcLaserDamage', 'canFireLaser', 'playerLaserMultiplier', 'laserImmune',
  ].filter((field) => src.includes(field));
  check('ship-specs.ts names no source combat field at all', forbidden.length === 0,
    forbidden.join(', '));
  check('...and the one source number it does read arrives converted',
    src.includes('sourceSpeedToWorld(eliteADesign(sourceDesignId).maxSpeed)'));
}

// --- the one source-speed conversion ----------------------------------------

console.log('\nnew hulls take their cruise from the pack, old hulls keep theirs');
{
  check(`one source speed unit is ${WORLD_SPEED_PER_SOURCE_SPEED.toFixed(2)} units/s`,
    Math.abs(WORLD_SPEED_PER_SOURCE_SPEED - 400 / 42) < 1e-9);
  eq('...so the released Ophidian\'s 34 becomes 324',
    sourceSpeedToWorld(34), 324);
  const cobra = SPECS.trader[0];
  eq('...and the trader Cobra keeps the 220 it was tuned and trained at',
    cobra.maxSpeed, 220);
  check('every hull still accelerates by the roster\'s one fraction',
    rosterRows.every(({ spec }) => spec.accel !== undefined
      || Math.abs(shipAccel(spec) - spec.maxSpeed * 0.46) < 1e-9));
  check('...and every hull has a turn rate, which the pack cannot supply',
    rosterRows.every(({ spec }) => typeof spec.turnRate === 'number'));
}

// --- the stations are exact hulls at a size we chose ------------------------

console.log('\nthe stations are released geometry at the scene\'s scale');
{
  eq('a station is drawn four times the one geometry conversion',
    STATION_PRESENTATION_SCALE, 4);
  eq('...which keeps the Coriolis at the 160 the scene has always used',
    stationDockZ(STATION_DESIGNS.coriolis), 160);
  eq('...and puts the Dodo\'s slot face at 196', stationDockZ(STATION_DESIGNS.dodo), 196);
  // The slot's long axis is what game/docking.ts rolls the ship against, so if a
  // re-import ever turned a letterbox on its side this is what would say so.
  for (const [name, designId] of Object.entries(STATION_DESIGNS)) {
    const def = registeredHull(designId).def!;
    const face = def.vertices.reduce((z, v) => Math.max(z, v[2]), 0);
    const slot = def.vertices.filter((v) => v[2] === face
      && Math.abs(v[0]) < face * 0.4 && Math.abs(v[1]) < face * 0.4);
    const halfW = Math.max(...slot.map((v) => Math.abs(v[0])));
    const halfH = Math.max(...slot.map((v) => Math.abs(v[1])));
    check(`the ${name} slot is upright — ${halfW * 2} wide by ${halfH * 2} tall`,
      slot.length === 4 && halfH > halfW);
  }
}

// --- a seeded run picks the same hulls after a reload -----------------------

console.log('\na seeded run selects the same designs across save and restore');
{
  const g = withoutSaving(() => {
    seedWorld(25_250_825);
    const game = new Game(() => headlessShell());
    game.launch();
    for (let i = 0; i < 600; i++) game.update(1 / 60, i / 60);
    return game;
  }).value;

  const fleet = () => g.state.world.npcs.map(
    (n) => `${n.role}:${n.designId}:${n.profileId}:${n.radius}:${n.maxEnergy}`).join('|');
  check(`the flight has ships in it (${g.state.world.npcs.length})`,
    g.state.world.npcs.length > 0);
  const before = fleet();
  const snap = g.captureSnapshot();
  withoutSaving(() => g.restoreSnapshot(snap));
  eq('every ship comes back as the same design, build, size and hull',
    fleet(), before);

  // ...and it keeps agreeing after the run carries on from the restore point.
  withoutSaving(() => {
    for (let i = 0; i < 120; i++) g.update(1 / 60, (600 + i) / 60);
  });
  const carried = fleet();
  withoutSaving(() => g.restoreSnapshot(g.captureSnapshot()));
  eq('...and again a hundred frames later', fleet(), carried);
}

// --- the carried-over TODO 23 defect ----------------------------------------
//
// A pirate spawned from the plain roster rather than from a tier table — the
// combat trainer's hull picker is the way to do that — used to be rebuilt
// through `pirateSpecForTier` on restore, so it came back on a tier hull while
// keeping its saved identity. Hull and identity then disagreed for good.

console.log('\nrestore rebuilds a ship from the design its snapshot recorded');
{
  seedWorld(778_899);
  const world = new World();
  world.build(g1[7]);
  world.clearNpcs();

  // Every pirate hull, spawned the way the hull picker spawns one: an explicit
  // roster row, with a threat tier that does NOT agree with it.
  SPECS.pirate.forEach((spec, i) => {
    const npc = world.spawn('pirate', new THREE.Vector3(i * 40, 0, 0), i, spec);
    npc.state.threatTier = 2;
  });
  const before = world.npcs.map((n) => `${n.designId}:${n.radius}:${n.maxEnergy}`);

  const saved = world.captureNpcs();
  // The rule persistence.ts applies, called the way it calls it.
  world.restoreNpcs(saved, (n) => specForDesign(n.role as NpcRole, n.designId)
    ?? pirateSpecForTier(Number(n.state.threatTier ?? 0), n.seed));
  eq('a trainer-picked pirate hull survives the reload',
    world.npcs.map((n) => `${n.designId}:${n.radius}:${n.maxEnergy}`).join('|'), before.join('|'));
  check('...and the hull it came back on is the one its identity claims',
    world.npcs.every((n) => registeredHull(n.designId).targetRadius === n.radius));

  // A save from before ships had ids has no design to look up, and still comes
  // back through the tier table exactly as it always did.
  const legacy = saved.map((s) => {
    const copy = { ...s };
    delete copy.designId;
    delete copy.profileId;
    return copy;
  });
  world.restoreNpcs(legacy, (n) => specForDesign(n.role as NpcRole, n.designId)
    ?? pirateSpecForTier(Number(n.state.threatTier ?? 0), n.seed));
  eq('a legacy pirate still falls back to its tier',
    world.npcs.map((n) => n.designId).join('|'),
    saved.map((s) => pirateSpecForTier(2, s.seed).designId).join('|'));
}

// --- the roster is findable -------------------------------------------------

// A data file nobody can grep is a data file nobody reviews. `ship-specs.ts`
// joined its map keys with a RAW NUL byte — deliberate, correct, and enough to
// make file(1) call the file `data`, after which `grep -r` and ripgrep both
// SKIP it in silence: every repo-wide search over the roster's colours, cruise
// speeds, turn rates, bounties and rack counts came back empty and looked like
// an answer. It is an ESCAPE now; the ban below is over all of src/.
console.log('\nevery source file is searchable text');
{
  /** The byte file(1), grep and ripgrep all use to decide a file is binary. */
  const NUL = String.fromCharCode(0);
  /** The predicate under test, named so it can be aimed at a known-bad string. */
  const readsAsBinary = (contents: string): boolean => contents.includes(NUL);
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : /\.(ts|json)$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const files = walk(new URL('../src/', import.meta.url));
  const binary = files.filter((u) => readsAsBinary(readFileSync(u, 'utf8')))
    .map((u) => u.pathname.slice(u.pathname.indexOf('/src/') + 1));
  check(`no file under src/ reads as binary to grep (${files.length} scanned)`,
    binary.length === 0, binary.join(', '));
  // ...and it can say no: an empty walk, or a dead predicate, passes as loudly.
  check('...and the scan is not vacuous', files.length > 100
    && files.some((u) => u.pathname.endsWith('/game/ship-specs.ts'))
    && readsAsBinary(`pirate${NUL}elite-a:design:22`)
    && !readsAsBinary('pirate\\u0000elite-a:design:22'));
  // The roster still needs a separator neither half of a key can contain.
  const roster = readFileSync(new URL('../src/game/ship-specs.ts', import.meta.url), 'utf8');
  check('ship-specs.ts states its map separator as an escape',
    /const KEY_SEP = '\\u0000';/.test(roster) && !readsAsBinary(roster));
  check('...and the keys it builds still find a row by role and design',
    specForDesign('pirate', CONSTRICTOR_SPEC.designId) === CONSTRICTOR_SPEC
    && specForDesign('trader', SPECS.trader[0].designId) === SPECS.trader[0]
    && specForDesign('trader', shipDesignIdOf(0)) === undefined);
}
