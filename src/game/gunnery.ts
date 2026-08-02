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
// ships its own byte per laser. So `LASER_PACING` holds the first,
// `playerLaserHit` looks up the second, and neither is a second home for the
// other. What that hit COSTS a target is game/npc-energy.ts's business.
//
// BOTH GUNS LIVE HERE, asymmetrically, because the released game is. Outgoing,
// this answers the STRENGTH and the target applies its own defence
// (`npc-energy.ts`); incoming, the pack tabulates the finished number for every
// (build, hull) pair, so `npcLaserDamageToPlayer` answers it in one call and
// `systems.ts` spends it. Neither restates a line of the oracle's arithmetic.

import type { Equipment, LaserType } from './commander.ts';
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

export const LASER_RANGE = 3500;

/**
 * The cadence and heat of each fitted laser. Harmless's numbers, unchanged.
 *
 * `mining` is absent because Harmless has no mining MOUNT: the mining laser is
 * a fitting that changes what a destroyed rock yields (see `Combat.destroy`),
 * not a weapon you select. The equipment redesign that turns it into a real
 * fourth mount is DEFERRED by the combat plan — `playerLaserHit` below already
 * answers for it, so when the redesign lands only a pacing row is missing.
 */
export const LASER_PACING: Record<LaserType, GunPacing> = {
  pulse: { cooldown: 0.24, heat: 0.055 },
  beam: { cooldown: 0.09, heat: 0.035 },
  military: { cooldown: 0.09, heat: 0.03 },
};

/** The laser cuts out at this temperature and will not fire again until it cools. */
export const LASER_CUTOUT = 0.98;

/**
 * How much of a target's silhouette counts as a hit, as a multiple of its
 * radius. Do NOT confuse with the sim's `LASER.aim`, which governs NPC gunnery
 * during training; this one is the player's, and the two are independent.
 */
export const LASER_GRAZE = 0.9;

/**
 * Grazing radius for drifting cargo, in world units. Canisters are ~12 units
 * across, so an exact ray needs 1.4 degrees at 500m and they felt unhittable.
 * They are not a skill target — shooting one is a deliberate act — so they get
 * a flat, generous tolerance.
 */
export const CANISTER_GRAZE = 20;

/**
 * Aim assist: an angular allowance ON TOP of the target's silhouette, so a
 * shot that is nearly right still connects.
 *
 * Chris's idea, and the player's half of the problem the NPCs have. A
 * Sidewinder at 500 units subtends 1.9 degrees; holding a human hand inside that
 * while both ships manoeuvre is most of why fights felt like flailing. Two
 * degrees at knife range, tapering to nothing by ASSIST_FADE_END so distance
 * shooting still demands precision and nobody snipes across three kilometres.
 *
 * The ring sight is drawn to this exact angle — see #crosshair in style.css.
 * If you change it, the reticle changes with it, which is the point: the
 * circle is not decoration, it is the envelope.
 */
export const AIM_ASSIST = 0.035;
export const ASSIST_FADE_START = 900;
export const ASSIST_FADE_END = 2400;

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
// its numbers ended up as literals inside game.ts's resolveNpcFire. They were
// also mirrored by an `NPC_GUN` in the training simulator, kept in step by hand
// — and were not, for six training rounds: the sim handed every ship the
// player's pulse laser, 0.667 damage/second against this gun's 0.041. Training
// flies THIS gun now, so these numbers are the balance levers for the game and
// the trainer at once.

/**
 * How far an NPC can shoot. Matches the player's LASER_RANGE above, and it has
 * to: a brain trained to open fire at 3000 units was silently refused the shot
 * by a 2600 gate, so it sat there pointing straight at the target and never
 * pulled the trigger. Measured before the change, two tier-0 pirates over 45
 * seconds: pointing at the player 90% of the time, inside 2600 only 51% of it.
 */
export const NPC_LASER_RANGE = 3500;

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
 * Time between an NPC's shots. The player's pulse laser reloads in 0.24s; these
 * are the game's deliberate handicap, and they are NOT what limits an NPC's
 * damage. Tested at pulse-laser parity (five times faster): 3.7 shots a minute
 * per ship against the current 4.1, and no difference in damage, because a
 * pirate is only inside the 0.25 rad firing gate for about 5% of a fight. It is
 * not waiting on the cooldown; it is waiting to be aimed at you.
 */
export const NPC_COOLDOWN_LO = 0.9;
export const NPC_COOLDOWN_SPREAD = 0.8;
/** How near the nose a target must be before an NPC pulls the trigger. */
export const NPC_FIRE_GATE = 0.25;
/** Thargoids reload faster than anything else in the galaxy. */
export const THARGOID_FIRE_RATE = 0.7;

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

/** Hit chance falls off with range, clamped at both ends. */
export const NPC_HIT_BASE = 0.9;
export const NPC_HIT_FALLOFF = 3500;
export const NPC_HIT_CAP = 0.85;
export const NPC_HIT_FLOOR = 0.15;
/**
 * Whether one ship's shot at another connects: a coin flip, and Harmless's.
 *
 * There is no damage constant beside it any more. What a crossfire hit is
 * WORTH is `npcCrossfireDamage` in npc-energy.ts — the firing build's own laser
 * strength against the target's own defence — where it used to be a flat 0.11
 * on the pre-parity normalized scale that made a Thargoid's gun and a Worm's
 * identical. Whether it lands stays a die roll, exactly as the player-facing
 * gun's does.
 */
export const NPC_VS_NPC_HIT = 0.5;
/** A missile is only worth launching in this band. */
export const MISSILE_MIN_RANGE = 1200;
export const MISSILE_MAX_RANGE = 3200;
export const MISSILE_CHANCE = 0.3;
/**
 * Hull fraction below which a ship stops saving its missiles for later.
 *
 * A pirate used to go down with them still on the rail, because the only way one
 * ever left was the opportunistic roll above — which fires at the moment the
 * ship takes a LASER shot, and a nearly-dead pirate is usually not lined up
 * enough to be taking one. A missile it never launches is worth nothing.
 */
export const MISSILE_LAST_STAND_HULL = 0.4;
/**
 * ...and it launches on a bearing rather than a firing line. A missile homes, so
 * the only reason to ask for any aim is that it leaves the nose: the target has
 * to be in the half of the sky the ship points at. Compare NPC_FIRE_GATE.
 */
export const MISSILE_LAST_STAND_GATE = Math.PI / 2;
/**
 * Desperation widens the envelope INWARD — the knife-range launch a pirate would
 * never waste a missile on is the only one left — but not all the way: inside
 * this the missile arrives before the player can reach the E.C.M. or turn, and
 * an undodgeable weapon is not a fight.
 */
export const MISSILE_LAST_STAND_MIN_RANGE = 250;
/** Gap between launches, so a Python does not empty both rails in one frame. */
export const MISSILE_RELOAD = 2;

/** Chance an NPC's shot connects at `dist`. */
export function npcHitChance(dist: number): number {
  return Math.min(NPC_HIT_CAP,
    Math.max(NPC_HIT_FLOOR, NPC_HIT_BASE - dist / NPC_HIT_FALLOFF));
}

/** Would an NPC rather send a missile than a laser bolt? */
export function npcPrefersMissile(dist: number, roll: number): boolean {
  return dist > MISSILE_MIN_RANGE && dist < MISSILE_MAX_RANGE && roll < MISSILE_CHANCE;
}

/**
 * Is this ship hurt enough to spend a missile it will otherwise die holding?
 *
 * No dice: a ship this badly hurt has under a second to live against a pulse
 * laser, and a chance roll per opportunity is a chance of nothing at all. It
 * launches at the first bearing it gets. `hull` is a fraction of the bank it
 * spawned with, `bearing` the angle from its nose to the target.
 */
export function npcMissileLastStand(hull: number, dist: number, bearing: number): boolean {
  return hull <= MISSILE_LAST_STAND_HULL
    && dist > MISSILE_LAST_STAND_MIN_RANGE && dist < MISSILE_MAX_RANGE
    && bearing < MISSILE_LAST_STAND_GATE;
}
