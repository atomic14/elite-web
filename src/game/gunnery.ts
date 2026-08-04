// The player's guns: which mount fires, whether it can, and how forgiving it is.
//
// The other half of the combat model that systems.ts owns — systems.ts holds
// the heat and the cooldown, this decides what pulling the trigger means. The
// *rules* are here and pure; finding what the shot hit stays with the raycast,
// because there is no honest way to test "does this ray pass through that hull"
// without the hulls.
//
// One split is worth naming. A mount's CADENCE and HEAT are Harmless's numbers
// and always were; what one hit is WORTH is the released game's, and a property
// of the hull as much as of the laser — the pack gives each of the 15 flyable
// ships its own byte per laser. So `LASER_PACING` (constants/player-gun.ts)
// holds the first, `playerLaserHit` looks up the second, and neither is a second
// home for the other. What that hit COSTS a target is game/npc-energy.ts's.
//
// BOTH GUNS ARE RESOLVED HERE, asymmetrically, because the released game is.
// Outgoing, this answers the STRENGTH and the target applies its own defence
// (`npc-energy.ts`); incoming, the pack tabulates the finished number for every
// (build, hull) pair, so `npcLaserDamageToPlayer` answers it in one call and
// `systems.ts` spends it. Neither restates a line of the oracle's arithmetic.
//
// The numbers both guns are governed by are constants/player-gun.ts and
// constants/npc-gun.ts, which is where the reasoning for each of them lives too.

import type { Equipment, LaserType } from './commander.ts';
import {
  AIM_ASSIST, ASSIST_FADE_END, ASSIST_FADE_START, CANISTER_GRAZE,
  LASER_CUTOUT, LASER_GRAZE, LASER_PACING,
} from '../constants/player-gun.ts';
import {
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE, NPC_HIT_BASE,
  NPC_HIT_CAP, NPC_HIT_FALLOFF, NPC_HIT_FLOOR, NPC_LASER_RANGE,
} from '../constants/npc-gun.ts';
import { playerPoolPoints, type PlayerPoolPoints } from './damage-units.ts';
import {
  eliteADamageToPlayer, eliteANpcLaserStrength, eliteAPlayerLaserHit,
} from './elite-a/combat-math.ts';
import type { EliteALaserType } from './elite-a/types.ts';
import {
  npcCombatProfileById, playerHull,
  type NpcCombatProfileId, type PlayerHullId,
} from './ship-identity.ts';

/**
 * How often a mount may fire, and what it costs the gun.
 *
 * PACING ONLY, and that is the split this file now keeps: how hard a shot HITS
 * is the released game's arithmetic, resolved from the hull the commander flies
 * and the laser fitted to it (`playerLaserHit`), where cadence and heat are
 * Harmless's and always have been. A `damage` column here would be a second
 * home for a number the catalogue already owns.
 */
export interface GunPacing {
  readonly cooldown: number;
  readonly heat: number;
}

/** A mount that can fire: its cadence, its heat, and what one hit is worth. */
export interface LaserSpec extends GunPacing {
  /** Source-scale hit strength BEFORE the target's multiplier and defence. */
  readonly hit: number;
  /** Which of the four the shot came out of, for a report that wants to say. */
  readonly type: EliteALaserType;
}

/** The assist allowance at a given range, in radians. */
export function assistAt(dist: number): number {
  if (dist <= ASSIST_FADE_START) return AIM_ASSIST;
  if (dist >= ASSIST_FADE_END) return 0;
  return AIM_ASSIST * (1 - (dist - ASSIST_FADE_START) / (ASSIST_FADE_END - ASSIST_FADE_START));
}

/** Half-angle within which a shot at `radius` at `dist` counts as a hit. */
export function hitCone(radius: number, dist: number): number {
  return Math.max(0.012, Math.atan((radius * LASER_GRAZE) / dist)) + assistAt(dist);
}

/** Half-angle for drifting cargo, which gets a flat tolerance and no assist. */
export function canisterCone(dist: number): number {
  return Math.max(0.012, Math.atan(CANISTER_GRAZE / dist));
}

/**
 * What one hit from `type`, fitted to `shipId`, is worth before the target's
 * defence — the released `(laserByte & 0x7f) >> 1`.
 *
 * The strength is a property of the HULL as much as the laser: an Anaconda's
 * military laser is a 63-point hit where a Cobra Mk III's is 12. The byte comes
 * from the catalogue and the shift from the oracle; there is no arithmetic
 * here. All four types are answered, `mining` included, because the profile API
 * is required to; live play cannot ask for it yet — see `LASER_PACING`.
 */
export function playerLaserHit(shipId: PlayerHullId, type: EliteALaserType): number {
  return eliteAPlayerLaserHit(playerHull(shipId).lasers[type].rawByte);
}

/** Fitted mounts, resolved once each — see `playerLaser`. */
const fitted = new Map<string, LaserSpec>();

/**
 * A fitted mount: the hull's hit strength, plus this laser's own cadence.
 *
 * Resolved once per (hull, laser) and shared, because `laserForView` is called
 * on every frame the trigger is held and the answer cannot change — a hull has
 * no shipyard to leave through yet, and the bytes are catalogue data. Every
 * field is readonly, so a shared record cannot be edited by a caller.
 */
export function playerLaser(shipId: PlayerHullId, type: LaserType): LaserSpec {
  const key = `${shipId}|${type}`;
  const known = fitted.get(key);
  if (known) return known;
  const spec: LaserSpec = { ...LASER_PACING[type], hit: playerLaserHit(shipId, type), type };
  fitted.set(key, spec);
  return spec;
}

/** The two things a gun is resolved from: what is fitted, and which hull. */
export interface ArmedCommander {
  equipment: Equipment;
  shipId: PlayerHullId;
}

/**
 * Which laser fires in the current view, or null when that mount is empty.
 *
 * The front mount carries whatever is fitted; rear, left and right are pulse
 * lasers if purchased. A simplification against the original: all mounts share
 * one cooldown and one heat budget.
 *
 * It takes the COMMANDER now rather than the equipment, because the hull is
 * half the answer: which of the 15 flyable ships is being flown decides how
 * hard the fitted laser hits (`playerLaserHit`). Fitting behaviour is untouched.
 */
export function laserForView(c: ArmedCommander, view: number): LaserSpec | null {
  if (view === 0) return playerLaser(c.shipId, c.equipment.laser);
  if (view === 1) return c.equipment.rearLaser ? playerLaser(c.shipId, 'pulse') : null;
  if (view === 2) return c.equipment.leftLaser ? playerLaser(c.shipId, 'pulse') : null;
  if (view === 3) return c.equipment.rightLaser ? playerLaser(c.shipId, 'pulse') : null;
  return null;
}

/**
 * The two fields a gun's readiness is made of: the reload and the heat.
 *
 * `ShipSystems` satisfies it, and so does the trainer's target hull, which
 * carries these two and none of the shields — which is the point of naming the
 * subset rather than demanding the whole ship. The trainer used to hand-roll
 * `cooldown > 0 || temp >= CUTOUT` then the two assignments, i.e. this
 * sequence written twice.
 */
export interface GunHeat {
  laserTemp: number;
  laserCooldown: number;
}

/** Cooled down and not overheated. */
export function canFire(sys: GunHeat): boolean {
  return sys.laserCooldown <= 0 && sys.laserTemp < LASER_CUTOUT;
}

/** Spend the shot: start the cooldown and add its heat. */
export function chargeShot(sys: GunHeat, laser: GunPacing): void {
  sys.laserCooldown = laser.cooldown;
  sys.laserTemp = Math.min(1, sys.laserTemp + laser.heat);
}


// --- the NPC's gun ---------------------------------------------------------
//
// gunnery.ts owned the player's laser and nothing owned the NPC's, which is how
// its numbers ended up as literals inside game.ts's resolveNpcFire. They are
// constants/npc-gun.ts now, with the account of the parallel simulator that once
// mirrored them; what is left here is the trigger sequence that spends them.

/**
 * The packed weapon byte one exact released build carries.
 *
 * Bits 3-5 are its laser power and bits 0-2 its missile rack; decoding either
 * is the oracle's job. Resolved once per build and shared, because it is
 * catalogue data and cannot change while a ship is flying.
 *
 * The two Harmless inventions get 0 — OUR policy, stated as ours, not read off
 * a source table that does not mention them. Neither ever pulls a trigger
 * (`NpcShip.update` returns before any gun is considered, and their roster rows
 * are unarmed), and 0 is a byte that fires nothing anyway.
 */
export function npcWeaponByte(profileId: NpcCombatProfileId): number {
  const known = weaponBytes.get(profileId);
  if (known !== undefined) return known;
  const record = npcCombatProfileById(profileId);
  const byte = record.source === 'elite-a' ? record.profile.weaponByte : 0;
  weaponBytes.set(profileId, byte);
  return byte;
}

const weaponBytes = new Map<NpcCombatProfileId, number>();

/**
 * What one registered NPC laser hit costs the commander, armour already off.
 *
 * The whole rule is the oracle's `eliteADamageToPlayer` — `laserPower << 2`,
 * then the flyable hull's per-hit armour once, floored at zero — and the pack
 * tabulates all 3,900 (build, hull) answers, which
 * `test/elite-a-live-defence.test.ts` drives THIS function over. The armour
 * comes from the hull the commander is actually flying, so all 15 profiles work
 * through here even though the UI cannot leave the Cobra Mk III yet.
 *
 * The `original` encoding (`weaponByte >> 1`, which lets missile bits add to
 * laser damage) is unreachable from here: gameplay only ever gets the clean
 * rule, which is why the argument is not passed on.
 */
export function npcLaserDamageToPlayer(
  weaponByte: number, shipId: PlayerHullId,
): PlayerPoolPoints {
  return playerPoolPoints(
    eliteADamageToPlayer(weaponByte, playerHull(shipId).perHitShieldArmour));
}

/** Hit strength before the player's armour: `laserPower << 2`, the clean rule. */
export const npcLaserStrength = (weaponByte: number): number =>
  eliteANpcLaserStrength(weaponByte);

/**
 * Pull an NPC's trigger: the gate, the range and the cooldown, in that order,
 * plus the cooldown the shot spends.
 *
 * The ORDER is the rule, not the numbers. Nothing is spent unless the shot
 * actually leaves — a ship out of the gate or out of range does not start a
 * reload, so it fires the instant it lines up — and the die is rolled only
 * then, which is what keeps a seeded run reproducible. That sequence was
 * written out three times (npc.ts `brainFly`, npc.ts `attack` and the
 * trainer's armed freighter) with a comment in the third asking the reader to
 * keep it in step with the first. It had already drifted once: `attack()` ran
 * a 0.22 gate and a 1.4+rand*1.8 cooldown against `brainFly`'s 0.25 and
 * 0.9+rand*0.8, on the path every police ship, bounty hunter and knife-range
 * pirate fires from.
 *
 * `rng` is passed in rather than imported so this file stays free of the PRNG —
 * and it is called ONLY when the shot leaves.
 *
 * @param cooldown  seconds left on the gun, already decremented for this step
 * @param angle     radians from the ship's nose to the target
 * @param rateScale multiplier on the reload (THARGOID_FIRE_RATE, or 1)
 * @returns the cooldown to start, or null when the trigger does nothing
 */
export function npcTriggerPull(
  cooldown: number,
  angle: number,
  dist: number,
  rng: () => number,
  rateScale = 1,
): number | null {
  if (cooldown > 0 || dist >= NPC_LASER_RANGE || angle >= NPC_FIRE_GATE) return null;
  return (NPC_COOLDOWN_LO + rng() * NPC_COOLDOWN_SPREAD) * rateScale;
}

/** Chance an NPC's shot connects at `dist`. */
export function npcHitChance(dist: number): number {
  return Math.min(NPC_HIT_CAP,
    Math.max(NPC_HIT_FLOOR, NPC_HIT_BASE - dist / NPC_HIT_FALLOFF));
}

