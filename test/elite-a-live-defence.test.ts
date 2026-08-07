// The LIVE NPC-to-player path, against every row the pack supplies.
//
// The mirror of `test/elite-a-live-combat.test.ts`, and it keeps the same
// bargain: `test/elite-a-oracle.test.ts` proves the ARITHMETIC, this proves the
// GAME runs it, so nothing here calls `elite-a/combat-math.ts` for a number it
// is checking. Every figure below comes out of the code an incoming shot
// actually goes through:
//
//   gunnery.ts   which byte the firing build carries, and what one hit is worth
//                against the hull the commander is flying
//   systems.ts   the three 255-point pools, the face that takes it, the spill
//                into energy, destruction, and the recharge
//   npc.ts       the ship that carries the byte
//   combat.ts    the whole hit, resolved out of the player's own transform
//
// 3,900 rows: 260 exact released variants x 15 flyable hulls. Rows are counted
// rather than printed, as the oracle's are, and a mismatch reports the count
// and the first row.
//
// The one thing this file DOES read the oracle for is the `original` encoding
// (`weaponByte >> 1`), and only to prove the live path never produces it — see
// "the released diagnostic stays test-only" at the bottom.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { check, eq } from './harness.ts';
import { ELITE_A_PLAYER_HULLS } from '../src/game/elite-a/player-hulls.generated.ts';
import { eliteADamageToPlayer } from '../src/game/elite-a/combat-math.ts';
import {
  PLAYER_HULL_IDS, COBRA_MK_3_HULL_ID, HARMLESS_OVERLAYS,
  npcCombatProfileIdOf, playerHull, type PlayerHullId,
} from '../src/game/ship-identity.ts';
import {
  npcLaserDamageToPlayer, npcLaserStrength, npcWeaponByte,
} from '../src/game/gunnery.ts';
import {
  applyDamage, breachLoss, durability, freshSystems,
} from '../src/game/systems.ts';
import { MAX_ENERGY, MAX_SHIELD } from '../src/constants/pools.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';
import { NpcShip } from '../src/game/npc.ts';
import { Combat } from '../src/game/combat.ts';
import { SPECS } from '../src/game/ship-specs.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { World } from '../src/game/world.ts';

interface DamageFixture {
  readonly variants: string[]; readonly playerShips: string[];
  readonly playerPerHitShieldArmour: number[]; readonly cleanBeforeArmour: number[];
  readonly originalBeforeArmour: number[]; readonly cleanAfterArmour: number[];
  readonly originalAfterArmour: number[];
}
const damage = JSON.parse(readFileSync(
  new URL('./fixtures/elite-a/npc-damage-to-player.json', import.meta.url),
  'utf8')) as DamageFixture;

/** Count failures instead of printing 3,900 lines; keep the first one. */
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

console.log('\n--- live defence: an NPC laser against the commander ---');

// --- the hull the commander is flying supplies the armour --------------------
{
  const armour = new Tally();
  let hulls = 0;
  for (const [index, hull] of ELITE_A_PLAYER_HULLS.entries()) {
    hulls += 1;
    // Live: the same `playerHull(shipId)` lookup `npcLaserDamageToPlayer` makes,
    // resolved from the id a commander SAVES — so all 15 profiles are reachable
    // through the runtime path even though the UI cannot leave the Cobra yet.
    if (playerHull(PLAYER_HULL_IDS[index]).perHitShieldArmour
      !== damage.playerPerHitShieldArmour[index]) {
      armour.fail(`${hull.name}`);
    }
  }
  armour.report('per-hit armour, resolved from the saved hull id', 15, hulls);
  eq('the fixture names the same 15 hulls, in the same order',
    ELITE_A_PLAYER_HULLS.map((h) => h.name).join('|'), damage.playerShips.join('|'));
  eq('a fresh career is flying the Cobra Mk III of those 15',
    newCommander().shipId, COBRA_MK_3_HULL_ID);
}

// --- 3,900 rows, through the live gun and the live banks ---------------------
{
  const strength = new Tally();
  const clean = new Tally();
  const spent = new Tally();
  let cursor = 0;
  let variants = 0;
  for (const [index, variantId] of damage.variants.entries()) {
    variants += 1;
    // What the firing ship carries — resolved the way a spawned NpcShip does.
    const byte = npcWeaponByte(npcCombatProfileIdOf(variantId));
    if (npcLaserStrength(byte) !== damage.cleanBeforeArmour[index]) {
      strength.fail(`${variantId} weapon byte ${byte}`);
    }
    for (const [hullIndex, hull] of ELITE_A_PLAYER_HULLS.entries()) {
      const shipId = PLAYER_HULL_IDS[hullIndex];
      const where = `${variantId}/${hull.name}`;
      const got = npcLaserDamageToPlayer(byte, shipId);
      if (got !== damage.cleanAfterArmour[cursor]) {
        clean.fail(`${where} got ${got}, want ${damage.cleanAfterArmour[cursor]}`);
      }
      // ...and it really comes out of the banks. Two independent claims: the
      // rule says N, and a fresh ship that takes the hit is N points down.
      const sys = freshSystems();
      applyDamage(sys, got, true, () => 1);
      if (MAX_SHIELD - sys.foreShield !== got || sys.energy !== MAX_ENERGY) {
        spent.fail(`${where} left ${sys.foreShield}/${sys.energy}`);
      }
      cursor += 1;
    }
  }
  strength.report('NPC laser strength before armour, live', 260, variants);
  clean.report('NPC laser after armour, live', 3900, cursor);
  spent.report('...and spent out of the facing shield, live', 3900, cursor);
}

console.log('\nlive defence — the cases the contract names');

// Full absorption, one-point penetration, the face that takes it, the spill,
// and destruction — all through `applyDamage`, which is what `Combat.hitPlayer`
// runs.
{
  {
    // FULL ARMOUR ABSORPTION. The weakest gun any released ship carries is three
    // power bits — 12 before armour, the Worm's (`SPECS.pirate[6]`). Only the
    // heaviest flyable hull swallows it whole: the Anaconda's 13 points of
    // armour. Nothing is fully stopped by the Cobra Mk III's 7 any more — every
    // real NPC laser leaves it at least 5, which is exactly what the five-bit
    // decode restored (see combat-math.ts `eliteANpcLaserPower`).
    const worm = npcWeaponByte(SPECS.pirate[6].profileId);
    const anacondaIndex = ELITE_A_PLAYER_HULLS.findIndex((h) => h.name === 'Anaconda');
    eq('the Anaconda has the heaviest flyable armour',
      ELITE_A_PLAYER_HULLS[anacondaIndex].perHitShieldArmour, 13);
    const anacondaHull = PLAYER_HULL_IDS[anacondaIndex];
    eq('a laser weaker than the hull\'s armour is worth nothing at all',
      npcLaserDamageToPlayer(worm, anacondaHull), 0);
    const sys = freshSystems();
    let rolls = 0;
    const r = applyDamage(sys, npcLaserDamageToPlayer(worm, anacondaHull), true,
      () => { rolls += 1; return 0; });
    check('...and a zero hit costs no shield, breaks nothing and kills nobody',
      sys.foreShield === MAX_SHIELD && !r.reachedHull && !r.destroyed && rolls === 0);
    // ...and the same gun DOES bite a lighter hull: 12 past the Cobra's 7 is 5,
    // and past the Adder's 4 is 8. Strength less armour, floored at zero.
    eq('against lighter armour it is the strength less that armour',
      npcLaserDamageToPlayer(worm, COBRA_MK_3_HULL_ID), 5);
    eq('...and a lighter hull still takes more',
      npcLaserDamageToPlayer(worm, PLAYER_HULL_IDS[0]), 8);
  }
  {
    // ONE-POINT PENETRATION of the SHIELD, which is the other boundary.
    const sys = freshSystems();
    sys.foreShield = 1;
    const r = applyDamage(sys, playerPoolPoints(2), true, () => 1);
    check('a hit one point bigger than the shield spills exactly one into energy',
      sys.foreShield === 0 && sys.energy === MAX_ENERGY - 1 && r.reachedHull);
  }
  {
    // FRONT AND AFT, resolved from the player's own transform by Combat.
    seedWorld(27_270_726);
    const world = new World();
    const combat = new Combat(world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();       // nose along -Z
    const ahead = new THREE.Vector3(0, 0, -900);
    const astern = new THREE.Vector3(0, 0, 900);
    const fore = freshSystems();
    combat.hitPlayer(fore, playerPoolPoints(30), ahead, pos, quat, scratch);
    check('a hit from ahead lands on the FORE shield',
      fore.foreShield === MAX_SHIELD - 30 && fore.aftShield === MAX_SHIELD);
    const aft = freshSystems();
    combat.hitPlayer(aft, playerPoolPoints(30), astern, pos, quat, scratch);
    check('...and one from astern on the AFT shield',
      aft.aftShield === MAX_SHIELD - 30 && aft.foreShield === MAX_SHIELD);
  }
  {
    // SPILLOVER AND DESTRUCTION, one hit at a time, at a real build's damage.
    const thargoid = npcWeaponByte(SPECS.thargoid[0].profileId);
    const perHit = npcLaserDamageToPlayer(thargoid, COBRA_MK_3_HULL_ID);
    eq('a Thargoid\'s 7 power bits are 28 before armour and 21 after', perHit, 21);
    const sys = freshSystems();
    let hits = 0;
    let destroyed = false;
    while (!destroyed && hits < 1000) {
      destroyed = applyDamage(sys, perHit, true, () => 1).destroyed;
      hits += 1;
    }
    check(`a commander dies to ${hits} Thargoid hits on one face`,
      destroyed && sys.energy === 0
      && hits === Math.ceil(durability(false) / perHit));
    check('...and the bank floors at zero rather than going negative',
      sys.energy === 0);
  }
  {
    // EQUIPMENT DAMAGE, and the probability the unit conversion must not touch.
    // The chance belongs to the HIT; the pools grew 255x and the roll count did
    // not, which is the whole point.
    const sys = freshSystems();
    sys.foreShield = 0;
    let rolls = 0;
    applyDamage(sys, playerPoolPoints(MAX_ENERGY - 1), true, () => { rolls += 1; return 1; });
    eq('one roll for a fitting per penetrating hit, whatever its size', rolls, 1);
    const shielded = freshSystems();
    let none = 0;
    applyDamage(shielded, playerPoolPoints(MAX_SHIELD), true, () => { none += 1; return 1; });
    eq('...and none at all when the shield swallowed the whole hit', none, 0);
    // ...and what it costs is unchanged: cargo first, then a fitting.
    const commander = newCommander();
    commander.cargo[0] = 1;
    commander.equipment.ecm = true;
    eq('a breach still takes cargo before a fitting',
      breachLoss(commander, () => 0.1).kind, 'cargo');
    eq('...and a fitting when there is no cargo left',
      breachLoss(commander, () => 0.99).kind, 'equipment');
  }
}

console.log('\nlive defence — every one of the 15 hulls, flown');

// The runtime path end to end, per hull: a real spawned pirate, its real byte,
// the commander's saved hull id, and the banks it actually empties.
{
  seedWorld(27_270_727);
  const tally = new Tally();
  const pirate = new NpcShip('pirate', new THREE.Vector3(), 0, SPECS.pirate[0]);
  let hulls = 0;
  for (const [index, hull] of ELITE_A_PLAYER_HULLS.entries()) {
    hulls += 1;
    const shipId: PlayerHullId = PLAYER_HULL_IDS[index];
    // `npc.weaponByte` is what world-step.ts hands the rule; the armour is the
    // commander's own. This is the whole live expression, per hull.
    const perHit = npcLaserDamageToPlayer(pirate.weaponByte, shipId);
    // A pirate Sidewinder's 5 power bits: `V:17`, the hardest build the released
    // sets ever filed in a pirate slot (game/role-variants.ts). It was `D:17`
    // and 4 bits before the roster started choosing by role.
    const want = 20 - hull.perHitShieldArmour;
    if (perHit !== Math.max(0, want)) {
      tally.fail(`${hull.name} got ${perHit}, want ${Math.max(0, want)}`);
    }
    const sys = freshSystems();
    sys.foreShield = 0;
    applyDamage(sys, perHit, true, () => 1);
    if (sys.energy !== MAX_ENERGY - Math.max(0, want)) {
      tally.fail(`${hull.name} bank left ${sys.energy}`);
    }
  }
  tally.report('a Sidewinder\'s bolt against each of the 15 hulls', 15, hulls);
  check('...and the armour really does differ across them',
    new Set(ELITE_A_PLAYER_HULLS.map((h) => h.perHitShieldArmour)).size > 1);
}

console.log('\nlive defence — the released diagnostic stays test-only');

// `weaponByte >> 1` reads the WHOLE packed byte, so the missile-count bits add
// up to 3 points of laser damage. It stays reproducible because the pack
// tabulates it; it must never reach gameplay.
{
  const differ: string[] = [];
  const bigger: string[] = [];
  for (const variantId of damage.variants) {
    const byte = npcWeaponByte(npcCombatProfileIdOf(variantId));
    const live = npcLaserDamageToPlayer(byte, COBRA_MK_3_HULL_ID);
    const original = eliteADamageToPlayer(byte, 7, 'original');
    if (live !== original) differ.push(variantId);
    if (original > live) bigger.push(variantId);
  }
  check(`the two encodings really do disagree (${differ.length} of 260 builds)`,
    differ.length >= 50);
  check('...and the live path never takes the encoding that reads missile bits',
    bigger.length > 0);
  // The live rule ignores bits 0-2 entirely: change only the missile count and
  // the damage cannot move. Every byte in the catalogue, both directions.
  const moved: string[] = [];
  for (const variantId of damage.variants) {
    const byte = npcWeaponByte(npcCombatProfileIdOf(variantId));
    const base = npcLaserDamageToPlayer(byte, COBRA_MK_3_HULL_ID);
    for (let missiles = 0; missiles < 8; missiles += 1) {
      if (npcLaserDamageToPlayer((byte & ~7) | missiles, COBRA_MK_3_HULL_ID) !== base) {
        moved.push(`${variantId}+${missiles}`);
      }
    }
  }
  check(`missile bits cannot move live laser damage (260 builds x 8 racks)`,
    moved.length === 0, moved.slice(0, 3).join(' · '));
  // ...and no live file can even ask for it. The rule argument defaults to
  // 'clean', so the only way in is to name the other one.
  const live = [
    'game/world-step.ts', 'game/gunnery.ts', 'game/systems.ts', 'game/combat.ts',
    'game/npc.ts', 'game/npc-energy.ts', 'game/game.ts', 'ai-training/scenario.ts',
  ];
  const named = live.filter((f) => /'original'/.test(
    readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')));
  check('no live combat file names the original encoding at all',
    named.length === 0, named.join(' · '));
}

console.log('\nlive defence — the two Harmless inventions');

{
  // The two Harmless inventions carry no released weapon, and say so.
  for (const overlay of [HARMLESS_OVERLAYS.rockHermit, HARMLESS_OVERLAYS.generationShip]) {
    eq(`${overlay.name} has no source weapon byte`,
      npcWeaponByte(overlay.profileId), 0);
    eq(`...so it can never hurt the commander`,
      npcLaserDamageToPlayer(npcWeaponByte(overlay.profileId), COBRA_MK_3_HULL_ID), 0);
  }
}
