// The player's guns: which mount fires, whether it can, and how forgiving it is.
//
// The other half of the combat model that systems.ts owns — systems.ts holds
// the heat and the cooldown, this decides what pulling the trigger means.
//
// The *rules* are here and pure. Finding what the shot hit stays in game.ts,
// because it is a raycast against the scene graph, and there is no honest way
// to test "does this ray pass through that hull" without the hulls.

import type { Equipment, LaserType } from './commander.ts';
import type { ShipSystems } from './systems.ts';

export interface LaserSpec {
  damage: number;
  cooldown: number;
  heat: number;
}

export const LASER_RANGE = 3500;

export const LASERS: Record<LaserType, LaserSpec> = {
  pulse: { damage: 0.16, cooldown: 0.24, heat: 0.055 },
  beam: { damage: 0.13, cooldown: 0.09, heat: 0.035 },
  military: { damage: 0.25, cooldown: 0.09, heat: 0.03 },
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
 * across, so an exact ray needs 1.4 degrees of accuracy at 500m and they felt
 * unhittable. They are not a skill target the way a fighter is — shooting one
 * is a deliberate act — so they get a flat, generous tolerance.
 */
export const CANISTER_GRAZE = 20;

/**
 * Aim assist: an angular allowance ON TOP of the target's silhouette, so a
 * shot that is nearly right still connects.
 *
 * Chris's idea, and the player's half of the problem the NPCs have. A
 * Sidewinder at 500 units subtends 1.9 degrees; holding a human hand inside
 * that while both ships manoeuvre is most of why fights felt like flailing.
 * Two degrees at knife range, tapering to nothing by ASSIST_FADE_END so
 * distance shooting still demands precision and nobody snipes across three
 * kilometres.
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
 * Which laser fires in the current view, or null when that mount is empty.
 *
 * The front mount carries whatever is fitted; rear, left and right are pulse
 * lasers if purchased. A simplification against the original: all mounts share
 * one cooldown and one heat budget.
 */
export function laserForView(equipment: Equipment, view: number): LaserSpec | null {
  if (view === 0) return LASERS[equipment.laser];
  if (view === 1) return equipment.rearLaser ? LASERS.pulse : null;
  if (view === 2) return equipment.leftLaser ? LASERS.pulse : null;
  if (view === 3) return equipment.rightLaser ? LASERS.pulse : null;
  return null;
}

/** Cooled down and not overheated. */
export function canFire(sys: ShipSystems): boolean {
  return sys.laserCooldown <= 0 && sys.laserTemp < LASER_CUTOUT;
}

/** Spend the shot: start the cooldown and add its heat. */
export function chargeShot(sys: ShipSystems, laser: LaserSpec): void {
  sys.laserCooldown = laser.cooldown;
  sys.laserTemp = Math.min(1, sys.laserTemp + laser.heat);
}


// --- the NPC's gun ---------------------------------------------------------
//
// gunnery.ts owned the player's laser and nothing owned the NPC's, which is
// how its numbers ended up as literals inside game.ts's resolveNpcFire — the
// hit roll, the damage roll and the missile odds, all inline in the
// orchestrator. Two of the four were checked by the sim/game parity tests;
// the rest could drift silently.
//
// These were mirrored by an `NPC_GUN` in the training simulator, kept in step
// by hand — and were not, for six training rounds: the sim handed every ship
// the player's pulse laser, 0.24s through a ~0.027 rad cone against this gun's
// 1.30s through 0.25, which is 0.667 damage/second against 0.041. Training
// flies THIS gun now (ai-training/scenario.ts), so these numbers are the
// balance levers for the game and for the trainer at the same time.

/** Hit chance falls off with range, clamped at both ends. */
export const NPC_HIT_BASE = 0.9;
export const NPC_HIT_FALLOFF = 3500;
export const NPC_HIT_CAP = 0.85;
export const NPC_HIT_FLOOR = 0.15;
/** Damage per hit: 0.1 + up to 0.12. */
export const NPC_DAMAGE_LO = 0.1;
export const NPC_DAMAGE_SPREAD = 0.12;
/** NPC-vs-NPC is cruder: a coin flip for this much. */
export const NPC_VS_NPC_HIT = 0.5;
export const NPC_VS_NPC_DAMAGE = 0.11;
/** A missile is only worth launching in this band. */
export const MISSILE_MIN_RANGE = 1200;
export const MISSILE_MAX_RANGE = 3200;
export const MISSILE_CHANCE = 0.3;
/**
 * Hull fraction below which a ship stops saving its missiles for later.
 *
 * A pirate used to go down with them still on the rail, because the only way
 * one ever left was the opportunistic roll above: it fires at the moment the
 * ship takes a LASER shot, and a pirate that is nearly dead is usually not
 * lined up well enough to be taking one. A missile it never launches is worth
 * nothing to it, so below this it launches.
 */
export const MISSILE_LAST_STAND_HULL = 0.4;
/**
 * ...and it launches on a bearing rather than a firing line. A missile homes
 * (ordnance.ts turns it at 2.5 rad/s), so the only reason to ask for any aim
 * at all is that it leaves the nose: the target has to be in the half of the
 * sky the ship is pointing at. Compare NPC_FIRE_GATE's 0.25 rad for the gun.
 */
export const MISSILE_LAST_STAND_GATE = Math.PI / 2;
/**
 * Desperation widens the envelope INWARD — the knife-range launch a pirate
 * would never waste a missile on is the only one it has left — but not all the
 * way. Inside this the missile arrives before the player can reach the E.C.M.
 * or turn, and an undodgeable weapon is not a fight.
 */
export const MISSILE_LAST_STAND_MIN_RANGE = 250;
/** Gap between launches, so a Python does not empty both rails in one frame. */
export const MISSILE_RELOAD = 2;

/** Chance an NPC's shot connects at `dist`. */
export function npcHitChance(dist: number): number {
  return Math.min(NPC_HIT_CAP,
    Math.max(NPC_HIT_FLOOR, NPC_HIT_BASE - dist / NPC_HIT_FALLOFF));
}

/** Damage from one NPC hit. */
export function npcShotDamage(roll: number): number {
  return NPC_DAMAGE_LO + roll * NPC_DAMAGE_SPREAD;
}

/** Would an NPC rather send a missile than a laser bolt? */
export function npcPrefersMissile(dist: number, roll: number): boolean {
  return dist > MISSILE_MIN_RANGE && dist < MISSILE_MAX_RANGE && roll < MISSILE_CHANCE;
}

/**
 * Is this ship hurt enough to spend a missile it will otherwise die holding?
 *
 * No dice: a ship at this hull has under a second to live against a pulse
 * laser, and a chance roll per opportunity is a chance of nothing happening at
 * all. It launches at the first bearing it gets. `hull` is hp as a fraction of
 * the hull it spawned with, `bearing` the angle from its nose to the target.
 */
export function npcMissileLastStand(hull: number, dist: number, bearing: number): boolean {
  return hull <= MISSILE_LAST_STAND_HULL
    && dist > MISSILE_LAST_STAND_MIN_RANGE && dist < MISSILE_MAX_RANGE
    && bearing < MISSILE_LAST_STAND_GATE;
}
