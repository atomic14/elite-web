// The player's flight model, and the language it is flown in.
//
// Elite-style flight: no inertia sliding, the ship goes where the nose
// points. Roll/pitch rates ramp while a key is held and decay when released,
// which gives the classic "keyboard analogue" feel.
//
// It knows nothing about keyboards. `update()` takes a FlightDemand — what
// the pilot WANTS — and whoever is flying produces one: the human through
// engine/flight-controls.ts, the defence policy through
// game/combat-computer.ts, a harness or a replay by writing four numbers
// down. That is the whole seam, and it is why no browser reaches this file.
import * as THREE from 'three';

/**
 * What a pilot is asking of the ship this frame.
 *
 * Turn RATES rather than stick deflection, because the ramp belongs to the
 * pilot and not to the hull: the human ramps against MAX_ROLL/MAX_PITCH with
 * RATE_RAMP/RATE_DECAY, and the combat computer deliberately ramps against
 * the softer caps the defence brain was trained at (CC_MAX_*, ccRamp). Both
 * hand the ship a rate in rad/s; the ship turns at it and asks nothing.
 */
export interface FlightDemand {
  /** roll rate, rad/s, about the ship's own Z */
  rollRate: number;
  /** pitch rate, rad/s, about the ship's own X (+ is nose up) */
  pitchRate: number;
  /** −1 brake · 0 coast · +1 open the throttle */
  throttle: number;
  /**
   * The trigger. The ship does NOT fire — firing has consequences (legal
   * status, bounties, the station's Vipers), so the Game reads this and
   * decides, exactly as it does with an NPC's FireEvent.
   */
  fire: boolean;
  /**
   * Throttle envelope to fly this demand at; the ship's own when omitted.
   *
   * The one widening of the old `AutopilotDemand`, and it earns its keep: the
   * combat computer cruises rather than sprints (CC_ACCEL 100 to a cap of
   * 220, against the commander's 220 to 400). Routing its demand through the
   * ship without this would quietly fly the autopilot at full commander
   * throttle — a behaviour change smuggled in by a refactor.
   */
  limits?: { accel: number; maxSpeed: number };
}

const MAX_SPEED = 400;
const ACCEL = 220;
/**
 * The player's Cobra. Raised from 1.1/2.0 so you can actually hold a bead on
 * a fighter: NPC pitch is turnRate × 1.4 (ai-training/core.ts TURN), so a Sidewinder
 * pitches at 1.54 and a Krait at 1.40 — against 1.1 they simply turned inside
 * you and combat felt unwinnable. At 1.45 you out-turn a pirate Cobra (1.12)
 * and a Krait, match a Mamba, and are still edged by a Sidewinder (1.54) and
 * an Asp (1.68), which is as it should be — those are far smaller ships.
 *
 * Changed here rather than in ai-training/core.ts on purpose: the player's flight
 * model is not simulated in training, so this costs no retrain and cannot
 * break sim/game parity.
 */
const MAX_ROLL = 2.5;
const MAX_PITCH = 1.45;
const RATE_RAMP = 4.0;
/**
 * How fast the turn rate bleeds off when you let go. Was 5.0, which made a
 * light tap far bigger than it should be: most of the movement came AFTER
 * the key was released, not during it. Measured on a 100ms tap at 1/60s, the
 * ship swung 6.9 degrees, of which 5.5 was coast-down — against target hit
 * windows of 1-2.5 degrees. At 12 the same tap is 3.7 degrees and stops when
 * you stop. Peak rates are untouched, so sustained turns are as quick as
 * before; only the tail is tightened.
 */
const RATE_DECAY = 12.0;

/**
 * The player's flight envelope, in one place a harness can read.
 *
 * `engine/flight-controls.ts` reads it to turn a keyboard into a demand, and
 * `update()` below reads the constants directly.
 * It also exists because the console harnesses that fly the player's ship with a
 * trained policy (test/playtest.js, test/gang-trial.js) each hand-copied these
 * numbers, and both had drifted to roughly HALF the real pitch and roll —
 * 0.7/1.2 against 1.45/2.5, ramping 4/5 against 4/12. Every "can a commander
 * survive this?" figure they produced was measured on a ship that does not
 * ship. One rule, one home; this is the home.
 */
export const PLAYER_FLIGHT = {
  maxSpeed: MAX_SPEED,
  accel: ACCEL,
  maxRoll: MAX_ROLL,
  maxPitch: MAX_PITCH,
  rateRamp: RATE_RAMP,
  rateDecay: RATE_DECAY,
} as const;

/**
 * The rate ramp the player's controls use, exported for the same reason as
 * PLAYER_FLIGHT: a harness that copies the caps but not the ramp is still
 * flying a different ship.
 */
export function rampFlightRate(
  current: number, target: number, active: boolean, dt: number,
): number {
  const rate = active ? RATE_RAMP : RATE_DECAY;
  const next = current + (target - current) * Math.min(1, rate * dt);
  return Math.abs(next) < 0.001 && !active ? 0 : next;
}

export class PlayerShip {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  speed = 0;
  rollRate = 0;
  pitchRate = 0;

  private readonly forward = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(spawn: THREE.Vector3, lookAt: THREE.Vector3) {
    this.position.copy(spawn);
    const m = new THREE.Matrix4().lookAt(spawn, lookAt, new THREE.Vector3(0, 1, 0));
    this.quaternion.setFromRotationMatrix(m);
    this.speed = MAX_SPEED * 0.25;
  }

  get maxSpeed(): number {
    return MAX_SPEED;
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  /**
   * Fly one step of whatever the pilot asked for.
   *
   * The order is load-bearing and unchanged: rates, then throttle, then roll,
   * then pitch, then normalise, then move. Rotating before moving is what
   * makes a turn bite on the frame you asked for it.
   */
  update(dt: number, demand: FlightDemand): void {
    this.rollRate = demand.rollRate;
    this.pitchRate = demand.pitchRate;

    const accel = demand.limits?.accel ?? ACCEL;
    const maxSpeed = demand.limits?.maxSpeed ?? MAX_SPEED;
    if (demand.throttle > 0) this.speed = Math.min(maxSpeed, this.speed + accel * dt);
    if (demand.throttle < 0) this.speed = Math.max(0, this.speed - accel * dt);

    if (this.rollRate !== 0) {
      this.tmpQ.setFromAxisAngle(AXIS_Z, this.rollRate * dt);
      this.quaternion.multiply(this.tmpQ);
    }
    if (this.pitchRate !== 0) {
      this.tmpQ.setFromAxisAngle(AXIS_X, this.pitchRate * dt);
      this.quaternion.multiply(this.tmpQ);
    }
    this.quaternion.normalize();

    this.getForward(this.forward);
    this.position.addScaledVector(this.forward, this.speed * dt);
  }
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
