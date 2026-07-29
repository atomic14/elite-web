// The purchasable combat computer: the defence brain flying your ship.
//
// It is the same `jameson-defend` policy an armed trader uses, pointed at the
// nearest thing hostile to you. Buying it means buying a co-pilot who evades
// well and shoots adequately — which is exactly what the training measured, so
// it is honest about what it is.
//
// The module works out what the autopilot WANTS (pitch, roll, throttle,
// trigger) and reports it; the Game applies it to the ship and pulls the
// trigger, because firing has consequences — legal status, bounties, the
// station's Vipers — that an autopilot has no business deciding.

import type * as THREE from 'three';
import {
  act, observe, makeScratch, type ObservableShip, type Brain,
} from '../ai-training/policy.ts';
import { isHostileToPlayer, type NpcShip } from './npc.ts';
import type { ShipSystems } from './systems.ts';

/** How far out it will look for something to fight. */
export const THREAT_RANGE = 6500;
/**
 * Turn caps, matching the trader-Cobra the defence brain was trained in. Fly
 * the policy on a more agile ship than it learned on and it oversteers.
 */
export const CC_MAX_PITCH = 0.5 * 1.4;
export const CC_MAX_ROLL = 0.5 * 2.4;
/** The autopilot cruises rather than sprints. */
export const CC_MAX_SPEED = 220;
export const CC_ACCEL = 100;
/** Decisions per second, as the NPCs get. */
const DECISION_INTERVAL = 0.1;

export interface AutopilotDemand {
  pitchRate: number;
  rollRate: number;
  /** -1, 0 or +1 */
  throttle: number;
  fire: boolean;
}

export type AutopilotStep =
  /** hands off — the reason is for the player */
  | { kind: 'disengage'; reason: string }
  | { kind: 'fly'; demand: AutopilotDemand };

/** Minimal view of a ship, so this needs no PlayerShip and no scene. */
export interface AutopilotShip {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
}

/**
 * What the autopilot is mid-thought.
 *
 * A state object rather than four private fields, for the reason npc.ts
 * learned the hard way: `brainControl` was left out of the NPC snapshot as
 * "not really state", and a restored world flew a different fight from the one
 * it was saved from. This is the same cache and the same ramped rates, on the
 * PLAYER's ship — it was still unsaved until an audit found it.
 */
export interface AutopilotState {
  /** ramped turn rates, so a restored turn continues instead of snapping level */
  pitch: number;
  roll: number;
  /** counts down to the next 10Hz decision */
  timer: number;
  /** the decision being acted on right now */
  control: { pitch: number; roll: number; throttle: number; fire: boolean } | null;
}

export function freshAutopilot(): AutopilotState {
  return { pitch: 0, roll: 0, timer: 0, control: null };
}

export class CombatComputer {
  /** @see AutopilotState — public so the snapshot can walk it */
  readonly state: AutopilotState = freshAutopilot();
  // 18 wide, matching what game.ts allocated: observe() fills 14, and the
  // spare tail costs nothing but avoids a surprise if a pack observation is
  // ever fed through here.
  private readonly obs = new Float32Array(18);
  private readonly scratch = makeScratch();
  private readonly me = blankShip(CC_MAX_SPEED, 0.5, 0);
  /**
   * The threat's speed is a CONSTANT 280, and it has to stay one.
   *
   * game.ts initialised this view with speed 280 and never updated it, so the
   * defence policy has only ever been flown against that value — exactly like
   * the 300 the pirate brains are fed in npc.ts, and for the same reason. Feed
   * it a real speed and the observation goes out of distribution. It reads as
   * an oversight; it is load-bearing until the brain is retrained.
   */
  private readonly target = blankShip(300, 1.1, 280);

  /** Forget the ramped rates, so re-engaging starts from level flight. */
  reset(): void {
    this.state.pitch = 0;
    this.state.roll = 0;
    this.state.timer = 0;
    this.state.control = null;
  }

  /**
   * @param manualInput the pilot touched the controls — always hands back.
   * @param brain the defence policy, or null if the weights failed to load.
   */
  step(
    dt: number,
    player: AutopilotShip,
    sys: ShipSystems,
    npcs: readonly NpcShip[],
    legalStatus: number,
    manualInput: boolean,
    brain: Brain | null,
  ): AutopilotStep {
    if (manualInput) return { kind: 'disengage', reason: 'MANUAL OVERRIDE' };

    let threat: NpcShip | null = null;
    let bestD = THREAT_RANGE;
    for (const npc of npcs) {
      if (!isHostileToPlayer(npc, legalStatus)) continue;
      const d = npc.object.position.distanceTo(player.position);
      if (d < bestD) { bestD = d; threat = npc; }
    }
    if (!threat || !brain) {
      return { kind: 'disengage', reason: 'AREA CLEAR — COMBAT COMPUTER OFF' };
    }

    this.state.timer -= dt;
    if (!this.state.control || this.state.timer <= 0) {
      this.state.timer = DECISION_INTERVAL;
      copyInto(this.me, player.position, player.quaternion);
      this.me.speed = player.speed;
      this.me.laserTemp = sys.laserTemp;
      this.me.laserCooldown = sys.laserCooldown;
      this.me.pitchRate = this.state.pitch;
      this.me.rollRate = this.state.roll;
      copyInto(this.target, threat.object.position, threat.object.quaternion);
      this.state.control = act(brain,
        observe(this.me as ObservableShip, this.target as ObservableShip, this.obs), this.scratch);
    }

    const c = this.state.control;
    this.state.pitch = ccRamp(this.state.pitch, c.pitch * CC_MAX_PITCH, c.pitch !== 0, dt);
    this.state.roll = ccRamp(this.state.roll, c.roll * CC_MAX_ROLL, c.roll !== 0, dt);
    return {
      kind: 'fly',
      demand: { pitchRate: this.state.pitch, rollRate: this.state.roll, throttle: c.throttle, fire: c.fire },
    };
  }
}

/**
 * Mirrors the rate ramp in npc.ts brainFly and ai-training/core.ts stepShip.
 *
 * Exported so train/jameson-autopilot.js — the console harness that stands in
 * for this autopilot — can use it instead of writing 4.0/5.0 out again.
 */
export function ccRamp(cur: number, target: number, active: boolean, dt: number): number {
  const rate = active ? 4.0 : 5.0;
  const next = cur + (target - cur) * Math.min(1, rate * dt);
  return Math.abs(next) < 0.001 && !active ? 0 : next;
}

interface MutableShip {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
  speed: number;
  laserTemp: number;
  laserCooldown: number;
  pitchRate: number;
  rollRate: number;
  cls: { maxSpeed: number; turnRate: number };
}

function blankShip(maxSpeed: number, turnRate: number, speed: number): MutableShip {
  return {
    pos: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    speed, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
    cls: { maxSpeed, turnRate },
  };
}

function copyInto(s: MutableShip, p: THREE.Vector3, q: THREE.Quaternion): void {
  s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
  s.quat.x = q.x; s.quat.y = q.y; s.quat.z = q.z; s.quat.w = q.w;
}
