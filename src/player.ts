import * as THREE from 'three';
import type { Input } from './engine/input';
import { keymap } from './engine/keymap';

// Elite-style flight: no inertia sliding, the ship goes where the nose
// points. Roll/pitch rates ramp while a key is held and decay when released,
// which gives the classic "keyboard analogue" feel.

const MAX_SPEED = 400;
const ACCEL = 220;
const MAX_ROLL = 2.0;
const MAX_PITCH = 1.1;
const RATE_RAMP = 4.0;
const RATE_DECAY = 5.0;

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

  update(dt: number, input: Input): void {
    const keys = keymap(); // classic (1984) by default, modern as a toggle
    const rollIn =
      (input.held(...keys.rollLeft) ? 1 : 0) - (input.held(...keys.rollRight) ? 1 : 0);
    const pitchIn =
      (input.held(...keys.pitchUp) ? 1 : 0) - (input.held(...keys.pitchDown) ? 1 : 0);

    this.rollRate = ramp(this.rollRate, rollIn * MAX_ROLL, rollIn !== 0, dt);
    this.pitchRate = ramp(this.pitchRate, pitchIn * MAX_PITCH, pitchIn !== 0, dt);

    if (input.held(...keys.accel)) this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    // slash only decelerates unshifted — ? opens the controls guide
    const decelHeld = keys.decel.some((k) =>
      input.held(k) && (k !== 'Slash' || !input.held('ShiftLeft', 'ShiftRight')));
    if (decelHeld) this.speed = Math.max(0, this.speed - ACCEL * dt);

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

function ramp(current: number, target: number, active: boolean, dt: number): number {
  const rate = active ? RATE_RAMP : RATE_DECAY;
  const next = current + (target - current) * Math.min(1, rate * dt);
  return Math.abs(next) < 0.001 && !active ? 0 : next;
}
