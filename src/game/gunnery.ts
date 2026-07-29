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
