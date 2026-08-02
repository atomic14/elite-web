// Ship identity: one id, one record, and what a save without one becomes.
//
// TODO 23's gate. The identities themselves are in src/game/ship-identity.ts;
// what this file asserts is the part that can go quietly wrong later —
//
//   * an id resolves to exactly ONE immutable record, and a value that is not
//     an id is refused rather than half-resolved;
//   * the two Harmless inventions stay visibly ours and never look like
//     recovered source designs;
//   * a career saved before ships had ids loads as a Cobra Mk III and loses
//     nothing else;
//   * all 15 flyable hulls survive commander JSON and the simulator's clone;
//   * every ship in today's roster survives a snapshot, INCLUDING an exact
//     variant that is not its design's recommended one — because re-deriving
//     identity on restore looks identical until the day something picks a
//     different build;
//   * and restoring costs nothing from the rng and changes nobody's identity.
//
// It is deliberately not a second copy of the catalogue's own gate: counts and
// provenance are test/elite-a-catalogue.test.ts's job.

import { readFileSync, readdirSync } from 'node:fs';

import * as THREE from 'three';

import {
  COBRA_MK_3_HULL_ID, HARMLESS_OVERLAYS, NPC_COMBAT_PROFILE_IDS, PLAYER_HULL_IDS,
  SHIP_DESIGN_IDS, isHarmlessOverlayId, isNpcCombatProfileId, isPlayerHullId,
  isShipDesignId, migratedPlayerHullId, npcCombatProfileById, playerHull,
  recommendedProfileIdFor, requireNpcCombatProfileId, requirePlayerHullId,
  requireShipDesignId, savedShipIdentity, shipDesign,
} from '../src/game/ship-identity.ts';
import {
  ASTEROID_IDENTITY, CONSTRICTOR_SPEC, SPECS, pirateSpecForTier,
  type NpcSpec,
} from '../src/game/ship-specs.ts';
import type { NpcRole } from '../src/game/ship-roles.ts';
import { newCommander, type CommanderData } from '../src/game/commander.ts';
import { exerciseCommander } from '../src/game/combat-sim-safety.ts';
import { loadCommander, saveCommander, slotKeys } from '../src/game/storage.ts';
import { World } from '../src/game/world.ts';
import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld, rngState } from '../src/game/rng.ts';
import type { NpcSnapshot } from '../src/game/snapshot.ts';
import { g1 } from './fixtures.ts';
import { check, eq } from './harness.ts';

console.log('\n--- ship identity ---');

/** Did this throw? The rejection half of "invalid ids are refused". */
const refuses = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};

// --- one id, exactly one record ---------------------------------------------

console.log('\nevery id resolves to one record');
{
  eq('15 flyable hulls', PLAYER_HULL_IDS.length, 15);
  eq('40 designs — the source 38 and the two that are ours',
    SHIP_DESIGN_IDS.length, 40);
  eq('262 combat profiles — the 260 released builds and the same two',
    NPC_COMBAT_PROFILE_IDS.length, 262);

  check('no id is issued twice',
    new Set([...PLAYER_HULL_IDS, ...SHIP_DESIGN_IDS, ...NPC_COMBAT_PROFILE_IDS]).size
    === PLAYER_HULL_IDS.length + SHIP_DESIGN_IDS.length + NPC_COMBAT_PROFILE_IDS.length);

  check('every player hull id resolves, and to the hull it names',
    PLAYER_HULL_IDS.every((id, i) => playerHull(id).playerShipId === i));
  check('...to the same record each time — records are shared, not rebuilt',
    PLAYER_HULL_IDS.every((id) => playerHull(id) === playerHull(id)));
  eq('the migration target is the Cobra Mk III',
    playerHull(COBRA_MK_3_HULL_ID).name, 'Cobra Mk III');

  check('every design id resolves',
    SHIP_DESIGN_IDS.every((id) => shipDesign(id).designId === id));
  check('every profile id resolves', NPC_COMBAT_PROFILE_IDS.every(
    (id) => npcCombatProfileById(id).profileId === id));

  // The recommended default is an ACTUAL released build, not an average of
  // them — the fidelity contract's words. So it must belong to its own design.
  check('a design\'s recommended profile is a real variant OF THAT DESIGN',
    SHIP_DESIGN_IDS.every((id) => {
      const record = npcCombatProfileById(recommendedProfileIdFor(id));
      const design = shipDesign(id);
      return record.source === 'harmless'
        ? design.source === 'harmless' && record.profileId === design.overlay.profileId
        : design.source === 'elite-a' && record.profile.designId === design.design.designId;
    }));
  check('...and it is deterministic — the same design gives the same build twice',
    SHIP_DESIGN_IDS.every((id) => recommendedProfileIdFor(id) === recommendedProfileIdFor(id)));
}

// --- one way in -------------------------------------------------------------

console.log('\nnobody reaches past the lookups');
{
  // The rule the whole module exists for: a caller that scans a generated array
  // has invented a second way to answer "what is this ship", and the two drift.
  // catalogue.ts is the one file allowed to know the arrays are arrays.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []));
  const offenders = walk(new URL('../src/', import.meta.url))
    .filter((url) => !url.pathname.endsWith('/elite-a/catalogue.ts')
      && !url.pathname.includes('.generated.'))
    .filter((url) => /from '[^']*\.generated\.ts'/.test(readFileSync(url, 'utf8')))
    .map((url) => url.pathname.split('/src/')[1]);
  check(`only catalogue.ts imports the generated arrays${offenders.length ? ` — ${offenders.join(', ')}` : ''}`,
    offenders.length === 0);
}

// --- and anything else is refused -------------------------------------------

console.log('\ninvalid ids are rejected, not guessed at');
{
  const notHulls = [
    undefined, null, 7, '7', 'elite-a:player:15', 'elite-a:player:-1',
    'elite-a:player:07', 'elite-a:design:7', 'harmless:player:7', '',
  ];
  check('nothing but one of the 15 is a player hull id',
    notHulls.every((v) => !isPlayerHullId(v)));
  check('...and requiring one throws rather than substituting',
    notHulls.every((v) => refuses(() => requirePlayerHullId(v))));

  const notDesigns = [
    'elite-a:design:38', 'elite-a:design:1.0', 10, 'harmless:design:frigate', 'B:10',
  ];
  check('a design id outside the catalogue is not a design id',
    notDesigns.every((v) => !isShipDesignId(v) && refuses(() => requireShipDesignId(v))));

  const notProfiles = [
    'elite-a:variant:Z:10', 'elite-a:variant:B:11', 'B:10',
    'harmless:profile:frigate', 'elite-a:design:10',
  ];
  check('a variant that was never released is not a profile id',
    notProfiles.every((v) => !isNpcCombatProfileId(v)
      && refuses(() => requireNpcCombatProfileId(v))));
  // B:11 is the tell: set B exists and design 11 exists, so a check that only
  // parsed the shape would let a build through that the pack never shipped.
  check('...even when its set and its design both exist separately',
    isShipDesignId('elite-a:design:11') && !isNpcCombatProfileId('elite-a:variant:B:11'));

  check('a saved ship with a bad id is refused rather than migrated',
    refuses(() => savedShipIdentity({ designId: 'elite-a:design:99', profileId: 'x' })));
  check('...and so is half an identity — a legacy save has NEITHER, not one',
    refuses(() => savedShipIdentity({ designId: 'elite-a:design:10' })));
  check('a legacy ship, with neither, migrates instead',
    savedShipIdentity({}) === undefined);
}

// --- ours stays ours --------------------------------------------------------

console.log('\nthe Harmless inventions stay separate');
{
  const overlays = Object.values(HARMLESS_OVERLAYS);
  check('the generation ship and the rock hermit are the only two',
    overlays.length === 2);
  check('...and both are labelled `harmless:`, so no save can read them as source data',
    overlays.every((o) => o.designId.startsWith('harmless:')
      && o.profileId.startsWith('harmless:')));
  check('...with a stated reason they are not recovered designs',
    overlays.every((o) => o.why.length > 20));
  check('no source id claims the harmless namespace',
    [...PLAYER_HULL_IDS, ...SHIP_DESIGN_IDS, ...NPC_COMBAT_PROFILE_IDS]
      .filter((id) => id.startsWith('harmless:')).length === 4);
  check('an overlay resolves to itself and not to an Elite-A record',
    overlays.every((o) => {
      const design = shipDesign(o.designId);
      const profile = npcCombatProfileById(o.profileId);
      return design.source === 'harmless' && profile.source === 'harmless'
        && isHarmlessOverlayId(o.designId) && isHarmlessOverlayId(o.profileId);
    }));
  check('...and nothing the pack supplied is mistaken for one',
    !isHarmlessOverlayId('elite-a:design:10')
    && !isHarmlessOverlayId('elite-a:variant:B:10'));
}

// --- the roster says what it is ---------------------------------------------

console.log('\nthe roster states its identity');
{
  const everySpec: NpcSpec[] = [
    ...Object.values(SPECS).flat(),
    ...[0, 1, 2].flatMap((tier) => [0, 1, 2, 3].map((seed) => pirateSpecForTier(tier, seed))),
    CONSTRICTOR_SPEC,
  ];
  check('every hull in the roster carries ids that resolve',
    everySpec.every((s) => isShipDesignId(s.designId) && isNpcCombatProfileId(s.profileId)));
  check('...and each flies its design\'s recommended exact build',
    everySpec.every((s) => s.profileId === recommendedProfileIdFor(s.designId)));
  check('the asteroid, which has no roster entry, still has one identity',
    isShipDesignId(ASTEROID_IDENTITY.designId)
    && ASTEROID_IDENTITY.profileId === recommendedProfileIdFor(ASTEROID_IDENTITY.designId));
  check('the Constrictor is the Constrictor and not the hull it is drawn like',
    shipDesign(CONSTRICTOR_SPEC.designId).source === 'elite-a'
    && npcCombatProfileById(CONSTRICTOR_SPEC.profileId).source === 'elite-a');
  check('a hull flown by two roles is the same design in both',
    SPECS.trader[0].designId === SPECS.pirate[5].designId);
}

// --- a career saved before ships had ids ------------------------------------

console.log('\nlegacy commanders load as a Cobra Mk III');
{
  // The real save path, on a fake store in slot 4 — CLAUDE.md: harnesses never
  // touch slots 1-3, and this one cannot reach a browser's storage at all.
  const held = new Map<string, string>();
  const fakeStorage = {
    get length() { return held.size; },
    key: (i: number) => [...held.keys()][i] ?? null,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { held.set(k, v); },
    removeItem: (k: string) => { held.delete(k); },
    clear: () => { held.clear(); },
  };
  const globals = globalThis as unknown as { localStorage?: unknown };
  const hadStorage = 'localStorage' in globals;
  const previousStorage = globals.localStorage;
  globals.localStorage = fakeStorage;
  const KEYS = slotKeys(4);

  try {
    // A commander exactly as it was written before this phase: no shipId at all.
    const legacy: Record<string, unknown> = { ...newCommander(), credits: 4321, kills: 9 };
    delete legacy.shipId;
    legacy.cargo = [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    held.set(KEYS.commander, JSON.stringify(legacy));

    const loaded = loadCommander(4);
    eq('a save with no hull loads as the Cobra Mk III every one of them flew',
      loaded.shipId, COBRA_MK_3_HULL_ID);
    check('...and loses nothing else on the way',
      loaded.credits === 4321 && loaded.kills === 9 && loaded.name === 'JAMESON'
      && loaded.cargo[1] === 2 && loaded.fuel === newCommander().fuel);

    held.set(KEYS.commander, JSON.stringify({ ...legacy, shipId: 'elite-a:player:99' }));
    eq('a hull id that resolves to nothing migrates too, rather than failing the load',
      loadCommander(4).shipId, COBRA_MK_3_HULL_ID);
    check('...still without losing the career', loadCommander(4).credits === 4321);

    // Every one of the 15, through the real bytes.
    const survived = PLAYER_HULL_IDS.filter((id) => {
      saveCommander({ ...newCommander(), shipId: id }, 4);
      return loadCommander(4).shipId === id;
    });
    eq('all 15 flyable hulls round-trip through the commander save',
      survived.length, PLAYER_HULL_IDS.length);
  } finally {
    if (hadStorage) globals.localStorage = previousStorage;
    else delete globals.localStorage;
  }

  eq('migration is one rule with one home', migratedPlayerHullId(undefined),
    COBRA_MK_3_HULL_ID);
  check('...which keeps a hull it recognises',
    PLAYER_HULL_IDS.every((id) => migratedPlayerHullId(id) === id));

  // JSON, not the save layer: the same object crossing structuredClone and a
  // stringify/parse pair, which is what a world snapshot and a clone do.
  const survives = (c: CommanderData): boolean =>
    JSON.parse(JSON.stringify(c)).shipId === c.shipId
    && structuredClone(c).shipId === c.shipId
    && exerciseCommander(c).shipId === c.shipId;
  check('all 15 survive commander JSON and the simulator\'s clone',
    PLAYER_HULL_IDS.every((id) => survives({ ...newCommander(), shipId: id })));
  eq('a fresh commander still starts in a Cobra Mk III',
    newCommander().shipId, COBRA_MK_3_HULL_ID);
}

// --- every ship in the sky survives a snapshot ------------------------------

console.log('\nnpc identity round-trips through a snapshot');
{
  seedWorld(4_070_931);
  const world = new World();
  world.build(g1[7]);
  world.clearNpcs();

  // One of everything the galaxy can put in the sky, built the way the galaxy
  // builds it: every rostered variant of every role, every hull of every pirate
  // tier, the mission Constrictor, and a rock. Pirates come through
  // `pirateSpecForTier` because that is the only way spawnPopulation makes one
  // — and it is how persistence.ts's `specFor` finds their hull again.
  const roles = (Object.keys(SPECS) as Exclude<NpcRole, 'asteroid'>[])
    .filter((role) => role !== 'pirate');
  for (const role of roles) {
    SPECS[role].forEach((_, i) => world.spawn(role, new THREE.Vector3(i * 40, 0, 0), i));
  }
  world.spawn('asteroid', new THREE.Vector3(0, 300, 0), 5);
  [0, 1, 2].forEach((tier) => [0, 1, 2, 3].forEach((seed) => {
    const npc = world.spawn('pirate', new THREE.Vector3(seed * 50, 0, tier * 60), seed,
      pirateSpecForTier(tier, seed));
    npc.state.threatTier = tier;
  }));
  const constrictor = world.spawn('pirate', new THREE.Vector3(900, 0, 0), 0, CONSTRICTOR_SPEC);
  constrictor.state.isMissionTarget = true;

  const before = world.npcs.map((n) => `${n.role} ${n.designId} ${n.profileId}`);
  check('every ship in the sky knows what it is',
    world.npcs.every((n) => isShipDesignId(n.designId) && isNpcCombatProfileId(n.profileId)));

  // The same rule persistence.ts applies: the hull comes from the state, the
  // identity from the save.
  const specFor = (n: NpcSnapshot): NpcSpec | undefined => (
    n.state.isMissionTarget ? CONSTRICTOR_SPEC
      : n.role === 'pirate' ? pirateSpecForTier(Number(n.state.threatTier ?? 0), n.seed)
        : undefined);

  const saved = world.captureNpcs();
  check('the snapshot carries the ids rather than leaving them to be worked out',
    saved.every((s) => isShipDesignId(s.designId!) && isNpcCombatProfileId(s.profileId!)));

  world.restoreNpcs(saved, specFor);
  eq('...and every one of them comes back as what it was',
    world.npcs.map((n) => `${n.role} ${n.designId} ${n.profileId}`).join('|'),
    before.join('|'));

  // The property that makes saving the id worth anything: an exact variant that
  // is NOT the recommended one still comes back. Re-deriving on restore passes
  // every test above and fails this one.
  const exact = 'elite-a:variant:N:10'; // a Cobra Mk III from set N, not the recommended B
  const doctored: NpcSnapshot[] = saved.map((s, i) => (i === 0
    ? { ...s, designId: 'elite-a:design:10', profileId: exact } : s));
  world.restoreNpcs(doctored, specFor);
  eq('an exact variant that is not the design default survives the reload',
    world.npcs[0].profileId, exact);
  check('...and it really is a different build of the same design',
    exact !== recommendedProfileIdFor('elite-a:design:10')
    && npcCombatProfileById(exact).source === 'elite-a');

  // A world written before this phase: no ids at all.
  const legacy: NpcSnapshot[] = saved.map((s) => {
    const copy = { ...s };
    delete copy.designId;
    delete copy.profileId;
    return copy;
  });
  world.restoreNpcs(legacy, specFor);
  const migrated = world.npcs.map((n) => `${n.role} ${n.designId} ${n.profileId}`).join('|');
  eq('a legacy fleet migrates onto the same identities its hulls always had',
    migrated, before.join('|'));
  // Twice, from a stream that has moved on in between: the derivation reads the
  // role, the seed and the hull, and nothing else.
  world.restoreNpcs(legacy, specFor);
  eq('...deterministically, wherever the rng happens to be',
    world.npcs.map((n) => `${n.role} ${n.designId} ${n.profileId}`).join('|'), migrated);
}

// --- restoring costs nothing ------------------------------------------------

console.log('\nrestoring a world neither draws nor re-decides');
{
  const g = withoutSaving(() => {
    seedWorld(20_260_802);
    const game = new Game(() => headlessShell());
    game.launch();
    for (let i = 0; i < 420; i++) game.update(1 / 60, i / 60);
    return game;
  }).value;

  check('the flight has ships in it', g.state.world.npcs.length > 0);
  const snap = g.captureSnapshot();
  const before = g.state.world.npcs.map((n) => `${n.designId} ${n.profileId}`).join('|');
  const commanderHull = g.state.commander.shipId;

  withoutSaving(() => g.restoreSnapshot(snap));

  const after = rngState();
  check('the stream is exactly where the snapshot left it — no ship rerolled itself',
    after.seed === snap.rng.seed && after.state === snap.rng.state);
  eq('...and every ship came back as the same exact build',
    g.state.world.npcs.map((n) => `${n.designId} ${n.profileId}`).join('|'), before);
  eq('...flying against the same commander hull', g.state.commander.shipId, commanderHull);

  // The other half of the migration: a world save with no ids anywhere.
  const legacy = structuredClone(snap) as typeof snap;
  legacy.npcs = legacy.npcs.map((n) => {
    const copy = { ...n };
    delete copy.designId;
    delete copy.profileId;
    return copy;
  });
  delete (legacy.commander as Partial<CommanderData>).shipId;
  withoutSaving(() => g.restoreSnapshot(legacy));
  eq('a world saved before this phase restores with the identities it implied',
    g.state.world.npcs.map((n) => `${n.designId} ${n.profileId}`).join('|'), before);
  eq('...and its commander in the Cobra Mk III', g.state.commander.shipId, COBRA_MK_3_HULL_ID);
  const legacyRng = rngState();
  check('...still without touching the stream',
    legacyRng.seed === snap.rng.seed && legacyRng.state === snap.rng.state);
}
