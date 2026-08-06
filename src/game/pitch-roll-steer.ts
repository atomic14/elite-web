// Bank-to-turn: how the commander's ship points its nose at a place using only
// the two axes the stick has — pitch and roll, never yaw.
//
// The player's Cobra has no yaw axis: the stick pitches and rolls, and that is
// all (player.ts). To bring the nose onto something off to one side you ROLL
// until it is above or below you, then PITCH up to it — the same two moves a
// hand on the stick makes. This returns those two moves as STICK COMMANDS in
// −1..1, exactly what a human's keys produce (engine/flight-controls.ts), so
// the scripted combat computer flies through the same ramp and the same
// `PlayerShip.update` a person does. The Game ramps the commands into rates,
// which is why the HUD's pitch and roll needles read a co-pilot's flying too.
//
// It replaced a quaternion slew that turned the ship directly toward a look-at
// orientation. That slew rolled the target into the pitch plane and only THEN
// measured pitch, so while it was still rolling it asked for no pitch at all —
// the ship visibly "just rotated" and, for targets behind and below, never
// finished. Rolling and pitching TOGETHER, each off the current geometry, is
// what fixes both: a sphere-convergence probe went from 70 stuck directions to
// none.
//
// Pure and allocation-free on a shared scratch. The caller owns the ramp and
// the caps; this only decides which way, and how hard, to move each stick.

import * as THREE from 'three';
import { STEER_SATURATION, STEER_PITCH_SATURATION } from '../constants/combat-computer.ts';

export interface StickCommand {
  /** pitch stick, −1 (nose down) .. +1 (nose up) */
  pitch: number;
  /** roll stick, −1 .. +1 */
  roll: number;
}

/**
 * The one thing the controller remembers between frames: which vertical it is
 * rolling the target onto, +1 for the top (nose pitches up) or −1 for the
 * bottom. Without it, a target sitting near the horizontal plane flips the
 * choice every frame — the roll and pitch sticks slam hard over in alternating
 * directions and the nose never arrives (a limit cycle the sphere probe caught
 * dead astern-ish at ~30 degrees out). The caller owns one per engagement.
 */
export interface SteerMemory {
  side: 1 | -1;
}

export function freshSteerMemory(): SteerMemory {
  return { side: 1 };
}

const dirNorm = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const fwd = new THREE.Vector3();

/** A proportional ask that saturates to ±1 at `STEER_SATURATION` radians. */
function stick(errorRad: number): number {
  return Math.max(-1, Math.min(1, errorRad / STEER_SATURATION));
}

/** Wrap an angle to −pi..pi. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The pitch and roll a pilot would ask for this frame to bring `quat`'s nose
 * (−Z) toward `dir`, using only pitch and roll.
 *
 * Bank first, then pull. ROLL swings the target onto the vertical (pitch)
 * plane; PITCH raises the nose to it — but pitch is GATED by how far the roll
 * still has to go (`cos` of the roll error). Pitching at full while still
 * rolling makes the nose trace a cone that orbits the target instead of
 * closing (the sphere probe caught it stuck at ~30 degrees out); gating pitch
 * on roll alignment is what makes it converge. Roll is fast enough
 * (`PLAYER_FLIGHT.maxRoll` > maxPitch) that the wait costs little.
 *
 * The vertical it banks toward is STICKY (`mem`): whichever is the shorter roll
 * to begin with, flipped only when the other becomes shorter by a clear margin.
 * A target near the horizontal plane is otherwise a coin-toss that lands
 * differently every frame, and the sticks chatter instead of turning.
 *
 * `nullBand` is the angle (radians) inside which the nose counts as ON the
 * target — the caller's gun cone, which is WIDE up close because a near target
 * subtends a wide angle. Inside it the controller asks for NOTHING. This is the
 * seasickness fix: a target already filling the gun still has a bearing that
 * swings as it drifts a hair off centre, and banking to chase that centring
 * chatters the roll axis for a correction the gun does not need. A sweep of the
 * whole control law showed every attempt to damp the chatter in the GEOMETRY
 * (softer roll, decoupled axes) broke convergence — the aggressive bank is what
 * gets the nose onto hard targets — while this deadzone leaves convergence from
 * all 475 sphere directions intact and cuts roll amplitude by an order of
 * magnitude. Pass 0 to steer all the way to dead centre.
 */
export function bankToTurn(
  quat: THREE.Quaternion, dir: THREE.Vector3, mem: SteerMemory, nullBand = 0,
): StickCommand {
  if (dir.lengthSq() < 1e-12) return { pitch: 0, roll: 0 };
  dirNorm.copy(dir).normalize();

  // Where the target lies in the ship's own frame.
  right.set(1, 0, 0).applyQuaternion(quat);
  up.set(0, 1, 0).applyQuaternion(quat);
  fwd.set(0, 0, -1).applyQuaternion(quat);
  const localX = dirNorm.dot(right);
  const localY = dirNorm.dot(up);
  const localZ = dirNorm.dot(fwd);

  const offPlane = Math.hypot(localX, localY);
  const theta = Math.atan2(offPlane, localZ); // off-nose angle, 0..pi
  // On the target already — inside the gun cone — so hold steady (see nullBand).
  if (theta < Math.max(1e-6, nullBand)) return { pitch: 0, roll: 0 };

  // The roll to bank the target onto each vertical. A frame roll of r about
  // local +Z shifts the target's X-Y bearing (`alpha`, from "right") by −r, so
  // reaching the top (bearing +pi/2) costs `alpha - pi/2` and the bottom
  // (−pi/2) costs `alpha + pi/2`. When the target is dead ahead/astern
  // (offPlane ~ 0) there is no bearing and no roll to make.
  const alpha = offPlane > 1e-6 ? Math.atan2(localY, localX) : Math.PI / 2;
  const toTop = wrap(alpha - Math.PI / 2);
  const toBottom = wrap(alpha + Math.PI / 2);

  // Flip the committed side only when the other is shorter by more than the
  // saturation band — enough to break the every-frame tie near the horizontal
  // plane without lagging a genuine change of side.
  const here = mem.side === 1 ? toTop : toBottom;
  const other = mem.side === 1 ? toBottom : toTop;
  if (Math.abs(other) + STEER_SATURATION < Math.abs(here)) mem.side = mem.side === 1 ? -1 : 1;
  const rollErr = mem.side === 1 ? toTop : toBottom;

  const roll = stick(rollErr);

  // PITCH the nose onto the target. Gated by `cos(rollErr)` — pull once banked,
  // not while still 90 degrees off the plane — which is what keeps a far target
  // from being pitched the wrong way before the roll brings it in (convergence).
  //
  // STRONGER when the target is AHEAD: a shared saturation with roll left a
  // near, slightly-off target commanding only a fraction of pitch, too weak to
  // drag a weaving target into the gun (Chris, flying it: "the pitch is not
  // strong enough"). `pitchSat` tightens toward `STEER_PITCH_SATURATION` as
  // `localZ` -> 1, blending back to the roll band as the target moves abeam or
  // behind (where hard pitch would cost convergence). This alone tripled
  // time-on-target close up and — crucially — held it at distance; a roll
  // derivative term tried alongside it damped close-up chatter but drove
  // sustained banking on a far target and was dropped.
  const pitchSat = localZ > 0
    ? STEER_PITCH_SATURATION + (STEER_SATURATION - STEER_PITCH_SATURATION) * (1 - localZ)
    : STEER_SATURATION;
  const pitch = Math.max(-1, Math.min(1, theta / pitchSat))
    * mem.side * Math.max(0, Math.cos(rollErr));

  return { pitch, roll };
}
