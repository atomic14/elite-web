// Every hull the commander can be, against every design the sky can hold.
//
//   node --experimental-strip-types train/profile-sweep.ts
//   (also printed as the last section of `npm run evaluate`)
//
// The tournament next door measures POLICIES. This measures the CATALOGUE: all
// 15 flyable player profiles and all 38 designs' recommended NPC/object
// profiles, through the runtime functions and nothing else — `npcWeaponByte`,
// `npcLaserDamageToPlayer`, `npcEnergyPolicy` and `playerLaserDamage`. It calls
// no arithmetic of its own, so it cannot quietly disagree with the game.
//
// It exists because TODO 29's roster grew to sixteen pirate hulls and fifteen
// player hulls, and every balance figure this project quotes was measured
// against exactly two of the first and one of the second. A table that covers
// all of them is the difference between "the shipped brain is fine" and "the
// shipped brain is fine against a Cobra Mk III".
//
// NON-COMBAT OBJECTS ARE EXCLUDED FROM THE AGGREGATES and listed separately.
// A Coriolis station, a cargo canister, an asteroid and a missile in flight are
// all designs with combat profiles, and averaging them into "how hard does a
// ship hit" produces a number that describes nothing. Membership is DERIVED,
// not listed: an object is a combatant if its recommended build's packed byte
// carries laser power at all. Stations are immune to the player's laser too,
// and that is reported rather than averaged.

import {
  COBRA_MK_3_HULL_ID, PLAYER_HULL_IDS, npcCombatProfileById, playerHull,
  recommendedProfileIdFor, shipDesignIdOf, type PlayerHullId,
} from '../src/game/ship-identity.ts';
import {
  npcLaserDamageToPlayer, npcLaserStrength, npcWeaponByte, playerLaser,
} from '../src/game/gunnery.ts';
import { npcEnergyPolicy, playerLaserDamage } from '../src/game/npc-energy.ts';
import { eliteADesignIds } from '../src/game/elite-a/catalogue.ts';
import { roleCandidateVariants, roleCombatProfileId } from '../src/game/role-variants.ts';
import { MAX_ENERGY, MAX_SHIELD, durability } from '../src/game/systems.ts';
import { Episode } from '../src/ai-training/scenario.ts';
import { brainFromFile, type Brain, type BrainFile } from '../src/ai-training/policy.ts';
import { FIXED_DT } from '../src/game/world-step.ts';
import { readFileSync } from 'node:fs';

const BRAINS = new URL('../src/ai-training/brains/', import.meta.url);
const load = (name: string): Brain =>
  brainFromFile(JSON.parse(readFileSync(new URL(`${name}.json`, BRAINS), 'utf8')) as BrainFile);

/** Held-out, and distinct from evaluate.ts's base and the trainer's stream. */
const SWEEP_BASE = 20_000_003;
const EPISODES = Number(process.argv[2] ?? 12);

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const rpad = (s: string | number, n: number): string => String(s).padStart(n);

// --- the 38 designs ---------------------------------------------------------

interface Row {
  name: string;
  designId: string;
  variantId: string;
  maxEnergy: number;
  defence: number;
  /** its gun, before the commander's armour */
  strength: number;
  /** ...and after a Cobra Mk III's */
  perHit: number;
  /** hits its bank takes from the commander's pulse laser, null if immune */
  pulseHits: number | null;
  combatant: boolean;
  laserImmune: boolean;
  /**
   * What the same design flies as a PIRATE, when the source ever filed it as
   * one — the build `role-variants.ts` selects, and what it does to a Cobra
   * Mk III. Beside the recommended default, because the difference between the
   * two columns IS TODO 29's threat change, and it is one released build
   * against another rather than a tuned number.
   */
  asPirate: { variantId: string; perHit: number } | null;
}

/** The pirate build of a design, or null where no released set filed one. */
function pirateBuild(designId: string): { variantId: string; perHit: number } | null {
  const profileId = roleCombatProfileId('pirate', designId);
  if (profileId === recommendedProfileIdFor(designId)
    && roleCandidateVariants('pirate', Number(designId.split(':').pop())).length === 0) {
    return null;
  }
  const record = npcCombatProfileById(profileId);
  if (record.source !== 'elite-a') return null;
  return {
    variantId: record.profile.variantId,
    perHit: npcLaserDamageToPlayer(npcWeaponByte(profileId), COBRA_MK_3_HULL_ID),
  };
}

export function designRows(): Row[] {
  const pulse = playerLaser(COBRA_MK_3_HULL_ID, 'pulse');
  return eliteADesignIds().map((id) => {
    const designId = shipDesignIdOf(id);
    const profileId = recommendedProfileIdFor(designId);
    const record = npcCombatProfileById(profileId);
    if (record.source !== 'elite-a') throw new Error(`not a source design: ${designId}`);
    const p = record.profile;
    const policy = npcEnergyPolicy(profileId);
    const byte = npcWeaponByte(profileId);
    const bite = playerLaserDamage(policy, pulse.hit);
    return {
      name: p.shipName,
      designId,
      variantId: p.variantId,
      maxEnergy: p.maxEnergy,
      defence: p.maxEnergy & 7,
      strength: npcLaserStrength(byte),
      perHit: npcLaserDamageToPlayer(byte, COBRA_MK_3_HULL_ID),
      pulseHits: bite > 0 ? Math.ceil(p.maxEnergy / bite) : null,
      combatant: npcLaserStrength(byte) > 0,
      laserImmune: policy.laserImmune,
      asPirate: pirateBuild(designId),
    };
  });
}

export function printDesignSweep(): void {
  const rows = designRows();
  console.log(`\n## every design's recommended profile (${rows.length})\n`);
  console.log('| design | default | energy | def | vs Cobra III | as a pirate | pulse hits |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const note = r.laserImmune ? ' *(immune)*' : r.combatant ? '' : ' *(object)*';
    const asPirate = r.asPirate
      ? `${r.asPirate.variantId} -> ${r.asPirate.perHit}` : '—';
    console.log(`| ${pad(r.name + note, 26)} | ${pad(r.variantId, 7)} | ${rpad(r.maxEnergy, 6)} | `
      + `${rpad(r.defence, 3)} | ${rpad(r.perHit, 12)} | ${rpad(asPirate, 11)} | `
      + `${rpad(r.pulseHits ?? 'never', 10)} |`);
  }
  // The aggregate, over combatants only. Averaging a canister's zero into this
  // is how "the average design does 6 points" gets written down.
  const fighters = rows.filter((r) => r.combatant);
  const objects = rows.filter((r) => !r.combatant);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`\n${fighters.length} combatants · ${objects.length} non-combat objects `
    + `excluded from the aggregates (${objects.map((o) => o.name).join(', ')})`);
  console.log(`combatants: mean ${mean(fighters.map((r) => r.perHit)).toFixed(1)} points a hit `
    + `against a Cobra Mk III, ${fighters.filter((r) => r.perHit === 0).length} of them zero `
    + `(${fighters.filter((r) => r.perHit === 0).map((r) => r.name).join(', ') || 'none'})`);
  console.log(`the commander soaks ${durability(false)} points on one face `
    + `(${MAX_SHIELD} shield + ${MAX_ENERGY} bank), ${durability(true)} manoeuvring`);
}

// --- the 15 flyable hulls ----------------------------------------------------

/**
 * Each player hull flown as the target of the same fight, on the same seeds.
 *
 * The armour is the whole difference: it is a SUBTRACTION off every incoming
 * hit, so an Anaconda's 13 does not soak 3x what an Adder's 4 does — against a
 * 20-point pirate gun it soaks nearly twice as much per hit, and against a
 * 12-point one it soaks all of it.
 */
export function printPlayerHullSweep(brainName: string): void {
  const brain = load(brainName);
  console.log(`\n## every flyable hull as the target — ${EPISODES} held-out episodes,`
    + ` 2x ${brainName}\n`);
  console.log('| hull | armour | pools | taken/ep | share | their hits |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const shipId of PLAYER_HULL_IDS) {
    const hull = playerHull(shipId);
    let taken = 0;
    let share = 0;
    let hits = 0;
    for (let e = 0; e < EPISODES; e++) {
      const ep = new Episode({
        seed: SWEEP_BASE + e * 7919,
        pirates: [{ kind: 'policy', brain }, { kind: 'policy', brain }],
        trader: { kind: 'scripted' },
        traderClass: 'playerCobra',
        targetShipId: shipId as PlayerHullId,
        maxTime: 45,
      });
      while (!ep.done) ep.step(FIXED_DT);
      const r = ep.report();
      taken += r.target.damageTaken;
      share += 1 - r.target.healthFraction;
      hits += r.pirates.reduce((a, p) => a + p.hits, 0);
    }
    console.log(`| ${pad(hull.name, 14)} | ${rpad(hull.perHitShieldArmour, 6)} | `
      + `${rpad(durability(true), 5)} | ${rpad((taken / EPISODES).toFixed(0), 8)} | `
      + `${rpad(((share / EPISODES) * 100).toFixed(1) + '%', 5)} | `
      + `${rpad((hits / EPISODES).toFixed(1), 10)} |`);
  }
  console.log('\ntaken/ep = mean pool points off · share = of all three pools');
}
