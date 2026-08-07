// The damage-path audit: two units, one home per rule, and no way back.
//
// This is the enforcement half of docs/DAMAGE-PATHS.md. The doc says which
// numbers exist and where they live; this file holds the code to it, because a
// checked-in inventory that nothing verifies is a comment.
//
// It asserts four different kinds of thing, and they are different on purpose:
//
//   1. THE ANCHORS ARE STILL THE ANCHORS. Every Harmless impact number is
//      calibrated from the Cobra Mk III's released bank and the commander's
//      shield face. Both are re-derived from the catalogue here, so a re-import
//      that moved either fails the build instead of leaving the table stale.
//   2. THE CROSSFIRE RULE IS THE ORACLE'S. A ship shooting a ship uses the two
//      source rules that apply and no third arithmetic.
//   3. THE PLAYER-LASER-ONLY PROPERTIES STAY PLAYER-LASER-ONLY. The
//      Constrictor's halving and a station's immunity must not reach a
//      crossfire, a ram, a warhead or the bomb.
//   4. THE OLD SCALE CANNOT COME BACK. Source scans for the deleted bridges,
//      for fractional damage literals, for a call site minting its own points,
//      and for direct writes to a health pool outside the file that owns it.
//
// The scans are greps, and greps are blunt. Each is paired with a
// not-vacuous check, because a regex that silently stops matching is exactly
// the failure this file is meant to prevent.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { check, eq } from './harness.ts';
import { npcEnergyPoints, playerPoolPoints } from '../src/game/damage-units.ts';
import { npcImpactDamage, playerImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import {
  ANCHOR_NPC_MAX_ENERGY, COBRA_MK_3_DESIGN, npcCrossfireDamage, npcEnergyPolicy,
  playerLaserDamage,
} from '../src/game/npc-energy.ts';
import { npcWeaponByte, playerLaserHit } from '../src/game/gunnery.ts';
import {
  eliteANpcDefence, eliteANpcLaserStrength,
} from '../src/game/elite-a/combat-math.ts';
import { ELITE_A_VARIANTS } from '../src/game/elite-a/variants.generated.ts';
import { recommendedNpcProfile } from '../src/game/elite-a/catalogue.ts';
import {
  COBRA_MK_3_HULL_ID, npcCombatProfileIdOf, recommendedProfileIdFor,
} from '../src/game/ship-identity.ts';
import { OBJECT_DESIGNS } from '../src/ships/registry.ts';
import { CONSTRICTOR_SPEC, SPECS } from '../src/game/ship-specs.ts';
import { MAX_ENERGY, MAX_SHIELD } from '../src/constants/pools.ts';
import { NpcShip } from '../src/game/npc.ts';
import { CargoField } from '../src/game/cargo.ts';
import { seedWorld } from '../src/game/rng.ts';

const src = (path: string): string =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
/**
 * The same file with every comment removed.
 *
 * The scans below look for names that must not be REACHED FOR, and the prose in
 * this project deliberately names the things it deleted — that history is what
 * stops somebody reintroducing them. So the greps read code, not comments.
 */
const code = (path: string): string =>
  src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const doc = (path: string): string =>
  readFileSync(new URL(`../docs/${path}`, import.meta.url), 'utf8');

console.log('\ndamage units — two scales, and nothing between them');

{
  eq('energy points are whole', npcEnergyPoints(44), 44);
  eq('pool points are whole', playerPoolPoints(115), 115);
  const refused = (f: () => unknown): boolean => {
    try { f(); return false; } catch { return true; }
  };
  check('a fraction cannot be minted as energy points',
    refused(() => npcEnergyPoints(0.45)));
  check('...nor as pool points', refused(() => playerPoolPoints(0.06)));
  check('...and neither can a negative amount',
    refused(() => npcEnergyPoints(-1)) && refused(() => playerPoolPoints(-1)));
}

console.log('\nthe Harmless impact rule — its anchors, re-derived');

{
  // ANCHOR ONE: the representative NPC.
  eq('the NPC anchor is the released Cobra Mk III',
    recommendedNpcProfile(COBRA_MK_3_DESIGN).shipName, 'Cobra Mk III');
  eq('...and the roster really flies that design as its Cobra',
    SPECS.trader[0].profileId,
    npcCombatProfileIdOf(recommendedNpcProfile(COBRA_MK_3_DESIGN).variantId));
  eq('...with a 98-point bank', ANCHOR_NPC_MAX_ENERGY, 98);

  // ANCHOR TWO: the commander's own face and bank.
  eq('the commander anchor is a full shield face', MAX_SHIELD, 255);
  eq('...in front of an equal bank', MAX_ENERGY, 255);

  // ...and every impact number derived from them. The severities are the ones
  // docs/DAMAGE-PATHS.md states; they are here so that changing the table means
  // changing the stated share too.
  const ofShip = (share: number) => Math.round(share * ANCHOR_NPC_MAX_ENERGY);
  const ofFace = (share: number) => Math.round(share * MAX_SHIELD);
  eq('a ram costs a ship 45% of the anchor bank', IMPACT.ram.ship, ofShip(0.45));
  eq('...and the commander 45% of a shield face', IMPACT.ram.commander, ofFace(0.45));
  eq('a canister on the hull is 6% of a face', IMPACT.canisterOnHull.commander, ofFace(0.06));
  eq('a station scrape is 90% of a face', IMPACT.stationScrape.commander, ofFace(0.9));
  check('a warhead flattens a full shield face and no more',
    IMPACT.warhead.commander <= MAX_SHIELD
    && IMPACT.warhead.commander > MAX_SHIELD - 10);
  check('...and is worth the same to a ship', IMPACT.warhead.ship === IMPACT.warhead.commander);
  eq('the energy bomb is the top of the byte scale', IMPACT.energyBomb.ship, 255);

  // What those two numbers MEAN against the released catalogue, which is the
  // claim docs/DAMAGE-PATHS.md makes and the reason 250 is 250.
  const banks = ELITE_A_VARIANTS.map((v) => v.maxEnergy);
  const tougher = banks.filter((e) => e > IMPACT.warhead.ship);
  check(`only the heaviest released builds survive a warhead `
    + `(${tougher.length} of ${banks.length}: `
    + `${[...new Set(tougher)].sort((a, b) => a - b).join('/')})`,
    tougher.length > 0 && tougher.length < banks.length / 20);
  check('nothing released survives the energy bomb',
    banks.every((e) => e <= IMPACT.energyBomb.ship));

  // The impact functions take NO TARGET. That is the structural reason a ram
  // cannot be halved by the Constrictor's flag or shrugged off by a station's:
  // there is nothing to consult. The spend side imports the units and nothing
  // else, and the table's own home — constants/impact.ts since the fight's
  // constants moved — imports nothing at all (the constants gate holds the
  // directory to that; this holds the file, so the property is asserted where
  // it is relied on).
  const impacts = src('game/impact-damage.ts');
  const imports = [...impacts.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  check(`impact-damage.ts imports only the units (${imports.join(', ')})`,
    imports.length === 1 && imports[0] === './damage-units.ts');
  check('...so no impact can see a ship, a profile or a role',
    !/policy|profile|role|Constrictor|laserImmune/i.test(impacts.split('*/').pop() ?? ''));
  // Both import shapes, because a side-effect `import 'x';` has no `from` and
  // sailed straight past the first spelling of this check — the same hole the
  // constants gate's leaf rule had, found the same way, by breaking it.
  check('the table\'s home imports nothing at all',
    !/^\s*import\b/m.test(code('constants/impact.ts')));
  check('...and no impact NUMBER can see a ship, a profile or a role either',
    !/policy|profile|role|Constrictor|laserImmune/i.test(code('constants/impact.ts')));
}

console.log('\nNPC versus NPC — the same oracle as the player-facing paths');

{
  // Every attacker in the roster against every rostered target: the composed
  // rule must equal the two source rules, exactly, with nothing else applied.
  const attackers = [...Object.values(SPECS).flat(), CONSTRICTOR_SPEC];
  let pairs = 0;
  let wrong = 0;
  const values = new Set<number>();
  for (const a of attackers) {
    const byte = npcWeaponByte(a.profileId);
    for (const t of attackers) {
      const policy = npcEnergyPolicy(t.profileId);
      const want = Math.max(0,
        eliteANpcLaserStrength(byte) - eliteANpcDefence(policy.maxEnergy));
      const got = npcCrossfireDamage(byte, policy);
      pairs += 1;
      values.add(got);
      if (got !== want) wrong += 1;
    }
  }
  check(`crossfire is strength minus defence for every rostered pair (${pairs})`,
    wrong === 0);
  check('...and the check is not vacuous', pairs >= 2000);
  check(`...producing a spread of values rather than one flat number (${values.size})`,
    values.size >= 5);

  // It reads the ATTACKER's gun...
  const thargoid = npcWeaponByte(SPECS.thargoid[0].profileId);
  const worm = npcWeaponByte(SPECS.trader[4].profileId);
  const victim = npcEnergyPolicy(SPECS.pirate[0].profileId);
  check('a Thargoid crossfire hurts more than a Worm\'s',
    npcCrossfireDamage(thargoid, victim) > npcCrossfireDamage(worm, victim));
  // ...and the DEFENDER's bank.
  const soft = npcEnergyPolicy(SPECS.trader[3].profileId);      // Adder, defence 0
  const hard = npcEnergyPolicy(SPECS.pirate[9].profileId);      // Python, defence 5
  check('...and a hull with defence takes less of it than one without',
    npcCrossfireDamage(thargoid, hard) < npcCrossfireDamage(thargoid, soft));

  // And it really is what the live sky spends: the call site passes the firing
  // ship's byte and the target's own policy, not a constant.
  //
  // The call site is `game/fire-resolution.ts` since docs/TODO/64 and was
  // `game/world-step.ts` before it — ONE resolver now, so the trainer spends
  // this too rather than the flat number it used to.
  const resolver = src('game/fire-resolution.ts');
  check('the resolver spends the composed rule, with both sides\' own numbers',
    /npcCrossfireDamage\(npc\.weaponByte, victim\.energyPolicy\)/.test(resolver));
  check('...and the player-facing bolt spends the firing build against the target hull',
    /npcLaserDamageToPlayer\(npc\.weaponByte, world\.target\.hullId\)/.test(resolver));
  check('...and neither is left behind in the two callers',
    !/npcCrossfireDamage|npcLaserDamageToPlayer\(npc/.test(src('game/world-step.ts')));

  // A live pair, deterministically.
  seedWorld(31_337);
  const shooter = new NpcShip('thargoid', new THREE.Vector3(), 0, SPECS.thargoid[0]);
  const target = new NpcShip('trader', new THREE.Vector3(0, 0, -800), 0, SPECS.trader[0]);
  const before = target.state.energy;
  const dealt = npcCrossfireDamage(shooter.weaponByte, target.energyPolicy);
  target.takeDamage(dealt, shooter.object.position);
  eq(`a Thargoid's bolt takes ${dealt} points off a trader Cobra`,
    before - target.state.energy, dealt);
  check('...and the shot provoked it without crediting the player',
    target.state.provoked && !target.state.provokedByPlayer);
}

console.log('\nthe Constrictor and the stations — player lasers only');

{
  const constrictor = npcEnergyPolicy(CONSTRICTOR_SPEC.profileId);
  eq('the Constrictor carries the halving on its profile',
    constrictor.playerLaserMultiplier, 0.5);

  const military = playerLaserHit(COBRA_MK_3_HULL_ID, 'military');
  const defence = eliteANpcDefence(constrictor.maxEnergy);
  eq('a player laser really is halved before defence',
    playerLaserDamage(constrictor, military),
    Math.floor(military * 0.5) - defence);

  const anyByte = npcWeaponByte(SPECS.pirate[0].profileId);
  eq('a CROSSFIRE hit on it is not halved',
    npcCrossfireDamage(anyByte, constrictor),
    eliteANpcLaserStrength(anyByte) - defence);
  eq('a RAM on it is the ordinary ram', npcImpactDamage(IMPACT.ram), IMPACT.ram.ship);
  eq('...and a warhead the ordinary warhead',
    npcImpactDamage(IMPACT.warhead), IMPACT.warhead.ship);

  // The rock hermit is a tough but destructible outpost now — a hollowed rock
  // you CAN crack open, not one of the immune source stations.
  const hermit = npcEnergyPolicy(SPECS.hermit[0].profileId);
  check('the rock hermit is not laser-immune — you can destroy it', !hermit.laserImmune);
  check('...so a player laser bites it',
    playerLaserDamage(hermit, playerLaserHit(COBRA_MK_3_HULL_ID, 'military')) > 0);
  check('...but it is tougher than any hull, so cracking it is a deliberate job',
    hermit.maxEnergy > 255);
  check('...and a ram or crossfire bites it too, like any hull',
    npcCrossfireDamage(anyByte, hermit) > 0 && npcImpactDamage(IMPACT.ram) > 0);
  eq('the released stations, though, stay immune through the same field',
    [0, 1].filter((d) => !npcEnergyPolicy(
      recommendedProfileIdFor(`elite-a:design:${d}`)).laserImmune).length, 0);
  // ...and nothing can shoot a hermit anyway: NPC targeting only ever picks a
  // trader or a pirate, and collisions treat it as scenery.
  const targeting = src('game/npc-targeting.ts');
  check('NPC targeting never selects a station or a derelict',
    !/'hermit'|'generation'/.test(targeting));
}

console.log('\nworld objects — source profiles where the game can damage them');

{
  const field = new CargoField(new THREE.Object3D());
  seedWorld(4);
  field.spawn(new THREE.Vector3(), 1, [0]);
  const canister = field.items[0];
  eq('a drifting canister carries the released design 4 bank',
    canister.energy,
    npcEnergyPolicy(recommendedProfileIdFor(OBJECT_DESIGNS.cargoCanister)).maxEnergy);
  eq('...which is the pack\'s eight points', canister.energy, 8);
  check('the commander\'s pulse breaks one in a single hit',
    field.takeLaserHit(canister, playerLaserHit(COBRA_MK_3_HULL_ID, 'pulse')));
  check('...and it leaves the field', field.items.length === 0);

  field.spawnCapsule(new THREE.Vector3());
  eq('an escape capsule carries the released escape pod\'s bank',
    field.items[0].energy,
    npcEnergyPolicy(recommendedProfileIdFor(OBJECT_DESIGNS.escapePod)).maxEnergy);

  // An in-flight missile is NOT a target in Harmless: the shot traces ships,
  // cargo and the station, and nothing else. Row 25 of the inventory.
  const shot = src('game/shot.ts');
  check('a shot cannot find a missile in flight',
    !/missile/i.test(shot));
}

console.log('\nthe old scale is gone, and cannot come back');

{
  const files = [
    'game/world-step.ts', 'game/game.ts', 'game/combat.ts', 'game/npc.ts',
    'game/systems.ts', 'game/gunnery.ts', 'game/npc-energy.ts',
    'game/impact-damage.ts', 'game/damage-units.ts', 'game/damage-dealt.ts',
    'game/collisions.ts',
    'game/ordnance.ts', 'game/cargo.ts', 'game/combat-sim.ts',
    // the one resolver both of the two below call, since docs/TODO/64
    'game/fire-resolution.ts',
    // the three the MIGRATIONS ran through, added when they were deleted: the
    // roster carried the old hull column, the World spent it and Persistence
    // rescaled the commander's pools.
    'game/ship-specs.ts', 'game/world.ts', 'game/persistence.ts',
    'ai-training/scenario.ts',
    // the impact table's home since the fight's constants moved
    'constants/impact.ts',
  ];
  const all = files.map((f) => [f, code(f)] as const);

  // 1. THE TWO BRIDGES, AND EVERY CONSTANT THAT ONLY EXISTED FOR THEM.
  //
  // The last six are the MIGRATIONS off those scales, deleted 2026-08-04: there
  // is no save written on either of them anywhere, so a careful conversion
  // served nobody and was one more place a scale could come back (Chris; the
  // same answer docs/TODO/53 gave `migrateLegacySaves`).
  const GONE = [
    'legacyDamageToEnergy', 'legacyDamageToPlayer', 'ENERGY_PER_LEGACY_HULL_POINT',
    'PLAYER_ENERGY_PER_LEGACY_POINT', 'LEGACY_FATAL_DAMAGE', 'RAM_DAMAGE',
    'NPC_VS_NPC_DAMAGE', 'CANISTER_HULL_DAMAGE', 'STATION_COLLISION_DAMAGE',
    'npcShotDamage', 'NPC_DAMAGE_LO', 'NPC_DAMAGE_SPREAD',
    'LEGACY_MAX_ENERGY', 'LEGACY_MAX_SHIELD', 'LEGACY_ASTEROID_HULL_POINTS',
    'legacyHullPoints', 'migratedSystems', 'migratedNpcState',
  ];
  const survivors: string[] = [];
  for (const [f, text] of all) {
    for (const name of GONE) {
      // VICTIM_RAM_DAMAGE is the training stand-in's own, and named so
      if (new RegExp(`(?<![A-Z_])${name}\\b`).test(text)) survivors.push(`${f}: ${name}`);
    }
  }
  check(`the TODO 26/27 bridges and their scaffolding are gone (${GONE.length} names)`,
    survivors.length === 0, survivors.join(' · '));

  // 2. WHO MAY MINT. Three modules own a damage rule; nobody else may make a
  //    point out of thin air, because that is inventing a rule where you stand.
  const MINTERS = [
    'game/damage-units.ts',      // where they are declared
    'game/gunnery.ts', 'game/npc-energy.ts', 'game/impact-damage.ts',
  ];
  const minted: string[] = [];
  let mints = 0;
  for (const [f, text] of all) {
    const n = [...text.matchAll(/\b(npcEnergyPoints|playerPoolPoints)\(/g)].length;
    if (n === 0) continue;
    mints += n;
    if (!MINTERS.includes(f)) minted.push(`${f} (${n})`);
  }
  check('only the three rule modules mint damage points', minted.length === 0,
    minted.join(' · '));
  check(`...and they really do (${mints} mints)`, mints >= 5);

  // 3. NO BYPASS AROUND THE CENTRAL FUNCTIONS. Every argument to takeDamage and
  //    applyPlayerDamage names the rule that produced it. A literal or a local
  //    arithmetic expression going in is the failure this catches.
  //
  //    The first argument is read with a brace counter rather than a regex,
  //    because every legitimate one is itself a call: `[^,)]+` stops at the
  //    opening paren of `npcImpactDamage(...)` and quietly matches nothing,
  //    which is a check that passes by not looking.
  const firstArgs = (text: string, call: string): { on: string; arg: string }[] => {
    const out: { on: string; arg: string }[] = [];
    for (const m of text.matchAll(new RegExp(`(?:([\\w.]+)\\.)?\\b${call}\\(`, 'g'))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const from = i;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (c === '(') depth += 1;
        else if (c === ')') { depth -= 1; if (depth === 0) break; }
        else if (c === ',' && depth === 1) break;
      }
      out.push({ on: m[1] ?? '', arg: text.slice(from, i).trim().replace(/\s+/g, ' ') });
    }
    return out;
  };
  const NPC_ALLOWED = /^(playerLaserDamage\(|npcCrossfireDamage\(|npcImpactDamage\(|ramEnergy$|points$|dealt$)/;
  const PLAYER_ALLOWED = /^(npcLaserDamageToPlayer\(|playerImpactDamage\(|ramPlayer$)/;
  const bad: string[] = [];
  let npcCalls = 0;
  let playerCalls = 0;
  for (const [f, text] of all) {
    for (const { on, arg } of firstArgs(text, 'takeDamage')) {
      // `this.trader` is the training stand-in, on its own normalized scale and
      // reachable by nothing else — excluded by RECEIVER, so the exclusion
      // cannot accidentally cover a real ship.
      if (/\btrader\b/.test(on)) continue;
      if (arg.includes(':')) continue;                         // the declaration
      npcCalls += 1;
      if (!NPC_ALLOWED.test(arg)) bad.push(`${f}: ${on}.takeDamage(${arg})`);
    }
    for (const { arg } of firstArgs(text, 'applyPlayerDamage')) {
      if (arg.includes(':')) continue;                         // a declaration, not a call
      if (arg === 'damage' || arg === 'amount') continue;      // the seam's own forwarding
      playerCalls += 1;
      if (!PLAYER_ALLOWED.test(arg)) bad.push(`${f}: applyPlayerDamage(${arg})`);
    }
  }
  check(`every damage call names its rule (${npcCalls} + ${playerCalls} calls)`,
    bad.length === 0, bad.join(' · '));
  // FOUR player-facing calls, where it was five: docs/TODO/64 moved the NPC
  // laser's out of the step and into `fire-resolution.ts`, where it reaches her
  // through the `FireTarget` seam and arrives at `applyPlayerDamage` as the
  // forwarded `damage` above. The rule it names is asserted by its own source
  // scan in the crossfire block — an equally precise check at the new address,
  // not a lowered bar.
  check('...and the check is not vacuous', npcCalls >= 7 && playerCalls >= 4);

  // 4. NO DIRECT HEALTH MUTATION. A pool is written by the file that owns it and
  //    nowhere else — the failure mode that would route round every rule above.
  const POOL_OWNERS: Record<string, string> = {
    'game/systems.ts': 'the commander\'s pools live here',
    'game/npc.ts': 'a ship\'s bank lives here',
    'game/cargo.ts': 'a drifting object\'s bank lives here',
    // It was game/game.ts. docs/TODO/72 gave the combat computer and a training
    // target the same button, so the burst and its price moved into `fireEcm`
    // beside the rule — three orchestrators spending it would have been the
    // fourth copy of a damage number, which is what this whole file is about.
    'game/ordnance.ts': 'the E.C.M. spends energy — a cost, not damage',
    'ai-training/scenario.ts': 'the stand-in target\'s hp setter, TODO 29',
  };
  const writers: string[] = [];
  let poolWrites = 0;
  for (const [f, text] of all) {
    for (const m of text.matchAll(/\.(energy|foreShield|aftShield)\s*(?:=[^=]|[-+]=)/g)) {
      poolWrites += 1;
      if (!(f in POOL_OWNERS)) writers.push(`${f}: .${m[1]}`);
    }
  }
  check('nothing writes a health pool outside the file that owns it',
    writers.length === 0, writers.join(' · '));
  check(`...and the check is not vacuous (${poolWrites} writes)`, poolWrites >= 8);

  // 5. NO FRACTIONAL DAMAGE LITERALS. Two precise rules rather than one broad
  //    grep, because `EQUIPMENT_DAMAGE_CHANCE` is a probability and
  //    `MISSILE_LAST_STAND_HULL` a threshold — both fractions, neither damage.
  //
  //    (a) nothing named `*_DAMAGE` in game code may hold a fraction. That is
  //        what RAM_DAMAGE, NPC_VS_NPC_DAMAGE, CANISTER_HULL_DAMAGE and
  //        STATION_COLLISION_DAMAGE all were.
  const named: string[] = [];
  for (const f of files.filter((x) => x.startsWith('game/'))) {
    for (const m of code(f).matchAll(/const\s+(\w+)\s*=\s*(-?\d*\.\d+)/g)) {
      if (/_?DAMAGE$/.test(m[1])) named.push(`${f}: ${m[1]} = ${m[2]}`);
    }
  }
  check('no fractional constant is called a damage figure any more',
    named.length === 0, named.join(' · '));

  //    (b) no fractional literal may be handed to anything that spends health,
  //        anywhere in src. The branded types make this a compile error too;
  //        this catches it in a shape a reader can see.
  const SPENDERS = /\b(takeDamage|takeLaserHit|applyPlayerDamage|applyDamage|hitPlayer|npcEnergyPoints|playerPoolPoints)\(\s*\n?\s*([^,)]+)/g;
  const literals: string[] = [];
  let spends = 0;
  for (const [f, text] of all) {
    for (const m of text.matchAll(SPENDERS)) {
      spends += 1;
      if (/^-?\d*\.\d+$/.test(m[2].trim())) literals.push(`${f}: ${m[0].trim()}`);
    }
  }
  check(`no fractional literal is spent as health (${spends} spend sites)`,
    literals.length === 0, literals.join(' · '));
  check('...and the check is not vacuous', spends >= 15);

  //    (c) THE STAND-IN SCALE IS GONE. TODO 29 put the training episode's target
  //        on the commander's own three 255-point pools, hit through
  //        `applyDamage` for `npcLaserDamageToPlayer` points, so the five names
  //        below no longer exist anywhere — not in the trainer either. This is
  //        the last row of docs/DAMAGE-PATHS.md closing.
  const retired = ['TARGET_DAMAGE_LO', 'TARGET_DAMAGE_SPREAD', 'VICTIM_RAM_DAMAGE',
    'targetShotDamage', 'targetHullForPoolPoints'];
  const stillThere: string[] = [];
  for (const f of [...files, 'ai-training/scenario.ts']) {
    for (const name of retired) if (code(f).includes(name)) stillThere.push(`${f}: ${name}`);
  }
  check('the normalized stand-in scale is gone from the project entirely',
    stillThere.length === 0, stillThere.join(' · '));
  check('...and the episode spends the commander\'s own points instead',
    code('ai-training/scenario.ts').includes('npcLaserDamageToPlayer')
    && code('ai-training/scenario.ts').includes('playerImpactDamage'));
}

console.log('\nthe inventory doc is the code\'s own list');

{
  const inventory = doc('DAMAGE-PATHS.md');
  const missing: string[] = [];
  for (const name of Object.keys(IMPACT)) {
    if (!inventory.includes(name)) missing.push(name);
  }
  check('every impact has an inventory row', missing.length === 0, missing.join(' · '));
  for (const name of ['playerLaserDamage', 'npcLaserDamageToPlayer', 'npcCrossfireDamage',
    'NpcEnergyPoints', 'PlayerPoolPoints', 'takeLaserHit']) {
    check(`...and the inventory names ${name}`, inventory.includes(name));
  }
  // Every source the game can attribute a hit to has a row.
  const sources = [...src('game/combat.ts')
    .matchAll(/^\s*\|\s*'(laser|missile|ram|station|cargo)'/gm)].map((m) => m[1]);
  check(`all five DamageSource values are still the list (${sources.join('/')})`,
    sources.length === 5);
  // Twice now: TODO 28 changed what the `them` figures mean, TODO 47 what the
  // `you` figures COVER — laser only, before it credited the ordnance.
  check('...and the report versions its numbers where they changed meaning',
    /COMBAT_SIM_SCHEMA = 3/.test(src('game/combat-sim-report.ts')));
  // The outbound direction is its own closed list, for the same reason the
  // inbound one is: what you hit something WITH is a static fact where it is
  // spent, and a fifth thing to hit it with has to be added here first.
  const dealt = [...(/export type DealtSource =([^;]+);/
    .exec(src('game/damage-dealt.ts'))?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  check(`all four DealtSource values are still the list (${dealt.join('/')})`,
    dealt.join('/') === 'laser/missile/ram/bomb');
  // ...and each of them has a bucket to land in. A source the report does not
  // name goes to `unknown` with a warning, which is a hit nobody attributed.
  const buckets = /const SOURCES[^=]*=\s*([^;]+);/.exec(src('game/combat-sim-report.ts'))?.[1] ?? '';
  check('...and the report has a bucket for every one of them',
    dealt.every((s) => buckets.includes(`'${s}'`)), `${dealt.join('/')} vs ${buckets.trim()}`);
}

// One live spend of each unit, so the two scales are exercised and not merely
// type-checked. The five player-facing paths are asserted end to end through the
// real step in test/world-step.test.ts; the two laser directions against the
// pack's own matrices in test/elite-a-live-combat.test.ts and
// test/elite-a-live-defence.test.ts; the energy bomb in
// test/combat-sim-career.test.ts.
{
  seedWorld(1234);
  const ship = new NpcShip('pirate', new THREE.Vector3(), 0, SPECS.pirate[5]);
  const full = ship.state.energy;
  ship.takeDamage(npcImpactDamage(IMPACT.ram));
  eq('a ram off a Cobra Mk III pirate', full - ship.state.energy, IMPACT.ram.ship);
  check('...and three of them finish it',
    ship.takeDamage(npcImpactDamage(IMPACT.ram)) === false
    && ship.takeDamage(npcImpactDamage(IMPACT.ram)) === true);

  const bombed = new NpcShip('trader', new THREE.Vector3(), 2, SPECS.trader[2]);
  check('the energy bomb destroys the heaviest hull in the roster',
    bombed.takeDamage(npcImpactDamage(IMPACT.energyBomb)) === true);
  const anaconda = new NpcShip('trader', new THREE.Vector3(), 2, SPECS.trader[2]);
  check('...where one warhead does not',
    anaconda.takeDamage(npcImpactDamage(IMPACT.warhead)) === false
    && anaconda.state.energy === 2);
  eq('...and the commander loses exactly one shield face to the same warhead',
    playerImpactDamage(IMPACT.warhead), 250);
}
