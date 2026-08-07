// Which released BUILD a role flies — the selection policy's gate.
//
// `src/game/role-variants.ts` is the file this covers, and the load-bearing
// claim is a negative one: threat was restored WITHOUT touching the combat
// rules. So the assertions come in three groups.
//
//   1. Everything selected is a real released row of the vendored pack, present
//      in a slot the role's own bands cover. Nothing is averaged, invented or
//      copied — a synthesised stat block would pass a damage check and fail
//      every one of these.
//   2. The choice is deterministic and total: the same answer twice, no rng
//      touched, a defined answer for every role and every design, and the same
//      answer a legacy snapshot re-derives on restore.
//   3. THE POINT OF THE EXERCISE — no combat role flies a build that cannot
//      damage a Cobra Mk III. The Asp Mk II was exactly that failure until a
//      decode bug was fixed (combat-math.ts `eliteANpcLaserPower`); its byte is
//      laser power nine, and it now hits for 29 and flies as a pirate.
//
// The oracle itself is not re-tested here; `test/elite-a-oracle.test.ts` owns
// the arithmetic and this file must not restate a line of it. What it does is
// drive the LIVE expression — the roster's own profile, its own byte, the
// commander's own armour — because a selection policy that picks a harder
// variant nothing reads would be no change at all.

import { check, eq } from './harness.ts';
import {
  COMBAT_ROLES, isCombatRole, roleCandidateVariants, roleCombatProfileId,
} from '../src/game/role-variants.ts';
import { roleBandContainsSlot, type NpcRole } from '../src/game/ship-roles.ts';
import {
  CONSTRICTOR_SPEC, PIRATE_TIERS, SPECS, pirateSpecForTier,
} from '../src/game/ship-specs.ts';
import { MISSION_TARGET_DESIGNS } from '../src/game/ship-roles.ts';
import {
  COBRA_MK_3_HULL_ID, PLAYER_HULL_IDS, isNpcCombatProfileId,
  npcCombatProfileById, playerHull, recommendedProfileIdFor,
} from '../src/game/ship-identity.ts';
import { npcLaserDamageToPlayer, npcWeaponByte } from '../src/game/gunnery.ts';
import { eliteAVariantsOf } from '../src/game/elite-a/catalogue.ts';
import { shipDisplayName } from '../src/ships/registry.ts';
import { rngState, seedWorld } from '../src/game/rng.ts';

const ROLES: NpcRole[] = [
  'trader', 'pirate', 'police', 'hunter', 'thargoid', 'thargon',
  'asteroid', 'hermit', 'generation',
];

/**
 * Every (role, spec) pair the roster can actually put in the sky.
 *
 * The Constrictor is here as a `pirate` because that is the role it flies with
 * (bounty, legality, police response), and it is EXCLUDED from the gun gate
 * below on purpose: it is the Navy's mission ship in its own released slot 31,
 * its single released build `G:28` carries no laser at all, and the whole point
 * of TODO 29 is that nothing about it is adjusted. It threatens with two
 * missiles and 370 units of speed. See `MISSION_TARGET_DESIGNS`.
 */
const rostered: [NpcRole, string][] = [
  ...Object.entries(SPECS).flatMap(
    ([role, list]) => list.map((s) => [role as NpcRole, s.designId] as [NpcRole, string])),
  ['pirate', CONSTRICTOR_SPEC.designId],
];

/** The ordinary combat spawns — everything the roster arms to shoot you. */
const combatRostered = rostered.filter(
  ([role, designId]) => isCombatRole(role)
    && !MISSION_TARGET_DESIGNS.includes(designId));

console.log('\nthe build a role flies is a real released row');
{
  check('every role and every rostered design resolves to a catalogue profile',
    rostered.every(([role, designId]) =>
      isNpcCombatProfileId(roleCombatProfileId(role, designId))));

  // Permitted means the source ACTUALLY filed this build under this job — the
  // same reading of the slot table `ship-roles.ts` uses for design membership.
  const strays: string[] = [];
  for (const [role, designId] of rostered) {
    if (!isCombatRole(role)) continue;
    const record = npcCombatProfileById(roleCombatProfileId(role, designId));
    if (record.source !== 'elite-a') continue;
    const candidates = roleCandidateVariants(role, record.profile.designId);
    if (candidates.length === 0) continue; // the Constrictor: see below
    if (!candidates.some((v) => v.variantId === record.profile.variantId)) {
      strays.push(`${role} ${record.profile.shipName} ${record.profile.variantId}`);
    }
  }
  check('...and a combat role only ever flies a build the source filed as that job',
    strays.length === 0, strays.join(', '));

  check('a candidate is a build that occupies one of the role\'s own slots',
    roleCandidateVariants('pirate', 17).every(
      (v) => v.presentInSlots.some((slot) => roleBandContainsSlot('pirate', slot))));

  // Nothing is manufactured: the chosen record is byte-for-byte one of the rows
  // the importer emitted for that design.
  const forged: string[] = [];
  for (const [role, designId] of rostered) {
    const record = npcCombatProfileById(roleCombatProfileId(role, designId));
    if (record.source !== 'elite-a') continue;
    const row = eliteAVariantsOf(record.profile.designId)
      .find((v) => v.variantId === record.profile.variantId);
    if (!row || row.maxEnergy !== record.profile.maxEnergy
      || row.weaponByte !== record.profile.weaponByte) {
      forged.push(`${role} ${designId}`);
    }
  }
  check('no selected profile carries a number the pack does not', forged.length === 0,
    forged.join(', '));

  eq('the Constrictor sits in a band no pirate draws from, so it keeps its default',
    roleCombatProfileId('pirate', CONSTRICTOR_SPEC.designId),
    recommendedProfileIdFor(CONSTRICTOR_SPEC.designId));
  eq('...which is the build the roster states', CONSTRICTOR_SPEC.profileId,
    recommendedProfileIdFor(CONSTRICTOR_SPEC.designId));
}

console.log('\nselection is deterministic, and costs the world nothing');
{
  seedWorld(29_290_729);
  const before = rngState();
  const first = rostered.map(([role, id]) => roleCombatProfileId(role, id)).join('|');
  const second = rostered.map(([role, id]) => roleCombatProfileId(role, id)).join('|');
  eq('asking twice gives the same answer', first, second);
  eq('...and asking does not draw from the rng',
    JSON.stringify(rngState()), JSON.stringify(before));

  // A save written before ships had ids re-derives identity from role and
  // design. It must land on what it would have spawned as, or a reload changes
  // the ship.
  check('a legacy snapshot re-derives the build it would have spawned with',
    Object.entries(SPECS).every(([role, list]) => list.every(
      (s) => s.profileId === roleCombatProfileId(role as NpcRole, s.designId))));

  check('every role has an answer for every design it may fly',
    ROLES.every((role) => rostered.filter(([r]) => r === role)
      .every(([, id]) => isNpcCombatProfileId(roleCombatProfileId(role, id)))));

  check('a non-combat role is left on the pack\'s recommended default',
    ROLES.filter((r) => !isCombatRole(r)).every((role) =>
      rostered.filter(([r]) => r === role).every(
        ([, id]) => roleCombatProfileId(role, id) === recommendedProfileIdFor(id))));
  eq('the combat roles are the five whose job is the fight',
    [...COMBAT_ROLES].sort().join(), 'hunter,pirate,police,thargoid,thargon');
}

console.log('\nno combat role flies a gun that cannot hurt you');
{
  // THE ASSERTION THIS FILE EXISTS FOR. The live expression: the roster's own
  // profile, the byte gunnery.ts hands the rule, and the armour of the hull a
  // fresh career flies.
  const toothless: string[] = [];
  for (const [role, designId] of combatRostered) {
    const byte = npcWeaponByte(roleCombatProfileId(role, designId));
    const perHit = npcLaserDamageToPlayer(byte, COBRA_MK_3_HULL_ID);
    if (perHit <= 0) toothless.push(`${role} ${shipDisplayName(designId)}`);
  }
  check('every combat-role build takes points off a Cobra Mk III',
    toothless.length === 0, toothless.join(', '));

  // The Cobra Mk III is the gate because it is the ship a career flies and the
  // only one this phase can fly. Across the OTHER fourteen hulls the answer is
  // a fact rather than a rule: armour is a subtraction, the Anaconda's is 13,
  // and the light hulls' guns genuinely bounce off it. Counted, so a re-import
  // or a policy change moves a number here instead of moving quietly.
  const armour = PLAYER_HULL_IDS.map((id) => playerHull(id).perHitShieldArmour);
  const toughest = PLAYER_HULL_IDS[armour.indexOf(Math.max(...armour))];
  const blunted = combatRostered.filter(
    ([role, designId]) => npcLaserDamageToPlayer(
      npcWeaponByte(roleCombatProfileId(role, designId)), toughest) <= 0);
  eq('against the best-armoured hull of the fifteen, only the two lightest bounce',
    [...new Set(blunted.map(([, id]) => shipDisplayName(id)))].sort().join(),
    'Ophidian,Worm');
  check('...and every other combat build gets through even that',
    blunted.length === 3 && combatRostered.length > 20);

  // The movement itself, stated so a later change to the pack or the policy
  // shows up as a diff rather than as a feeling.
  const perHit = (spec: { profileId: string }): number =>
    npcLaserDamageToPlayer(npcWeaponByte(spec.profileId), COBRA_MK_3_HULL_ID);
  eq('a tier-0 Sidewinder does 13 to a Cobra Mk III, where the default build did 9',
    perHit(pirateSpecForTier(0, 0)), 13);
  eq('a pirate Fer-de-Lance does 21', perHit(SPECS.pirate[7]), 21);
  eq('a Viper does 17', perHit(SPECS.police[0]), 17);
  eq('a Thargoid does 21', perHit(SPECS.thargoid[0]), 21);
  check('every tier still has hulls in it', PIRATE_TIERS.every((t) => t.length > 0));

  // A trader is NOT held to this: it is not trying to hurt anyone, and an
  // Anaconda's released build genuinely cannot.
  check('a trader may still fly a build that cannot scratch you',
    SPECS.trader.some((s) => perHit(s) === 0));
}
