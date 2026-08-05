// The scripted combat computer: the pirates' own attack run, flying YOUR ship.
//
// Chris asked for this after the third trained-defence wall in a row
// (docs/TRAINING-LOG.md runs 20-21: a turret, a sprayer, a pacifist). The
// scripted three-phase run already won the feel test as the opposition twice,
// and it aims — so the option the picker never offered is now a pilot: the
// SAME `attack-run.ts` composition every pirate flies, pointed at whatever is
// hostile to you, holding the same threat lock the brain co-pilot holds.
//
// It DECIDES and reports, like every module here: what comes back is a steer
// point, a speed, and two requests (trigger, E.C.M.). The Game applies them —
// the slew, the throttle, the shot and its legal consequences — exactly as it
// applies the docking computer's plan and the brain co-pilot's demand.
//
// What it deliberately is NOT:
//  - It does not fly through pitch/roll demands. The player's ship has no yaw
//    axis, so a rate-demand pilot would fly a visibly different run from the
//    pirates it is imitating; the Game slews the quaternion the way
//    `steerQuatToward` turns every scripted ship, the docking computer's own
//    precedent for the commander's hull.
//  - It has no tactic switch. A pirate re-rolls its tactic off its own hull
//    and hurt; the co-pilot flies the standard run (`TACTICS.run`) until
//    flying it says otherwise — feel first, knobs later.
//  - Its run state is not saved. A reload re-locks the nearest hostile and
//    opens with a fresh closing leg — a defensible opening move from cold
//    (Chris, 2026-08-05: exact-continuation on restore is not a requirement;
//    docs/TODO/95).

import * as THREE from 'three';
import { attackRunSteer, attackRunSpeed, type AttackRunState } from './attack-run.ts';
import { ThreatLock } from './threat-lock.ts';
import { isHostileToPlayer, type NpcShip } from './npc.ts';
import type { AutopilotShip } from './combat-computer.ts';
import { hitCone } from './gunnery.ts';
import { autopilotEcm } from './ordnance.ts';
import { LASER_RANGE } from '../constants/player-gun.ts';
import { THREAT_RANGE } from '../constants/combat-computer.ts';
import { EXTEND_RANGE_MAX, UNDER_FIRE_SECONDS } from '../constants/attack-run.ts';
import { TACTICS } from '../constants/tactics.ts';
import { random } from './rng.ts';
import { PLAYER_FLIGHT } from '../constants/player-flight.ts';
import type { V3 } from '../ai-training/observation.ts';

export type CoPilotStep =
  /** hands off — the reason is for the player */
  | { kind: 'disengage'; reason: string }
  /**
   * What the run wants this frame. `point` is where to slew the nose — null
   * during a pass, which steers for nothing on purpose (attack-run.ts).
   * `fire` and `ecm` are REQUESTS: shooting and spending the bank have
   * consequences, and consequences are the Game's (invariant 15).
   */
  | { kind: 'steer'; point: THREE.Vector3 | null; speed: number; fire: boolean; ecm: boolean };

export class ScriptedCoPilot {
  /** the same lock, the same margin, the same hold as the brain co-pilot */
  private readonly lock = new ThreatLock<NpcShip>();
  private readonly run: AttackRunState = {
    attackPhase: 'closing', extendRange: EXTEND_RANGE_MAX, passSide: 1, passesMade: 0,
  };
  /**
   * Seconds of "I am being hit" left — the same signal, with the same
   * constant, that aborts a pirate's pass early (break-off.ts). The Game
   * calls `noteHit` where it applies the commander's damage, because the
   * co-pilot has no other way to feel it.
   */
  private underFire = 0;
  private readonly vel = new THREE.Vector3();
  private readonly toThreat = new THREE.Vector3();
  private readonly nose = new THREE.Vector3();

  noteHit(): void {
    this.underFire = UNDER_FIRE_SECONDS;
  }

  /** Let go of the fight entirely — the next step starts from nothing. */
  reset(): void {
    this.lock.clear();
    this.run.attackPhase = 'closing';
    this.run.extendRange = EXTEND_RANGE_MAX;
    this.underFire = 0;
  }

  step(
    dt: number,
    player: AutopilotShip,
    npcs: readonly NpcShip[],
    legalStatus: number,
    manualInput: boolean,
    missilePos: V3 | null,
  ): CoPilotStep {
    if (manualInput) return { kind: 'disengage', reason: 'MANUAL OVERRIDE' };
    this.underFire = Math.max(0, this.underFire - dt);
    const threat = this.lock.pick(
      dt,
      npcs.filter((npc) => isHostileToPlayer(npc, legalStatus)
        && npc.object.position.distanceTo(player.position) < THREAT_RANGE),
      (npc) => npc.object.position.distanceTo(player.position),
    );
    if (!threat) {
      this.reset();
      return { kind: 'disengage', reason: 'AREA CLEAR — COMBAT COMPUTER OFF' };
    }
    const targetPos = threat.object.position;
    const dist = targetPos.distanceTo(player.position);
    // nose-times-speed IS a ship's velocity in this game — advance() is the
    // same two lines for everything that flies
    const vel = this.vel.set(0, 0, -1)
      .applyQuaternion(threat.object.quaternion).multiplyScalar(threat.state.speed);
    const point = attackRunSteer(
      this.run, player.position, player.quaternion, player.speed,
      targetPos, vel, dist, this.underFire > 0,
      null, // no gang, no approach bearing
      TACTICS.run, random);
    // pre-slew facing: one frame of turning moves it by at most maxPitch*dt
    // (~0.02 rad), which neither the throttle curve nor the fire cone can see
    const facing = this.nose.set(0, 0, -1).applyQuaternion(player.quaternion)
      .angleTo(this.toThreat.copy(targetPos).sub(player.position));
    return {
      kind: 'steer',
      point,
      // the ship's OWN envelope, as a pirate flies its own — the brain
      // co-pilot's softer CC_* caps are that policy's fitted world, not this
      // pilot's
      speed: attackRunSpeed(this.run.attackPhase, facing, PLAYER_FLIGHT.maxSpeed, TACTICS.run),
      // the trigger only when the shot would count: the player gun's own cone
      // and range (gunnery.ts) — the laser's heat and cooldown pace it from
      // there, which is what makes this a marksman where the trained brain
      // was a sprayer
      fire: dist <= LASER_RANGE && facing < hitCone(threat.radius, dist),
      // a warhead is always answered; whether one is coming is the world's
      // fact, and the gate is the same one every E.C.M. press goes through
      ecm: autopilotEcm(true, missilePos !== null),
    };
  }
}
