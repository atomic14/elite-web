// The scripted combat computer: a PURSUIT DOGFIGHTER flying YOUR ship.
//
// Chris asked for this after the third trained-defence wall in a row
// (docs/TRAINING-LOG.md runs 20-21: a turret, a sprayer, a pacifist). The first
// cut flew the pirates' own three-phase attack run — close, fire on the pass,
// blow straight through, loop back — because that run had won the feel test as
// the OPPOSITION twice. Flown as the player's co-pilot it was wrong: the pass
// phase steers nowhere on purpose (go through on the heading that got you
// there), so the instant a target got close and crossing, the ship stopped
// tracking it — "it lines up, shoots, then doesn't follow" (Chris, flying it).
//
// So it diverged. What a person does is get on the opponent's six and shoot it
// up, hauling the throttle back to swing the nose round and stay on a crossing
// target. That is pure pursuit — point the nose AT the target (the laser is
// hitscan, so no lead: aim where it is), which curves you onto its tail as it
// turns and runs — plus a throttle that holds a gun-range standoff behind it and
// comes off hard when the nose has a long way to swing. It flies `attack-run.ts`
// no more; the pirates still do (npc.ts), which is a separate ship and a
// separate decision.
//
// It DECIDES and reports, like every module here: what comes back is a
// `FlightDemand` — ramped pitch and roll rates, a throttle, a trigger — and one
// E.C.M. request. The Game flies the demand through the same `PlayerShip.update`
// a human's keys do (which is what puts the co-pilot's turning on the HUD
// needles) and pulls the trigger with its legal consequences, exactly as it
// applies the brain co-pilot's demand.
//
// How it POINTS the nose is `pitch-roll-steer.ts`: the player's ship has no yaw
// axis, so it banks the target onto the pitch plane and pulls up to it, at the
// commander's OWN caps and ramp (PLAYER_FLIGHT), not the softer CC_* caps the
// trained brain was fitted to.

import * as THREE from 'three';
import { ThreatLock } from './threat-lock.ts';
import { isHostileToPlayer, type NpcShip } from './npc.ts';
import type { AutopilotShip } from './combat-computer.ts';
import { hitCone } from './gunnery.ts';
import { autopilotEcm } from './ordnance.ts';
import { bankToTurn, freshSteerMemory, type SteerMemory } from './pitch-roll-steer.ts';
import { rampFlightRate, type FlightDemand } from '../player.ts';
import { LASER_RANGE } from '../constants/player-gun.ts';
import { UNDER_FIRE_SECONDS } from '../constants/attack-run.ts';
import {
  THREAT_RANGE, PURSUIT_RANGE, PURSUIT_CLOSE_GAIN, PURSUIT_TURN_FLOOR,
  PURSUIT_SPEED_DEADBAND, ENGAGED_CONE, TARGET_DIST_WEIGHT,
} from '../constants/combat-computer.ts';
import { PLAYER_FLIGHT } from '../constants/player-flight.ts';
import type { V3 } from '../ai-training/observation.ts';

export type CoPilotStep =
  /** hands off — the reason is for the player */
  | { kind: 'disengage'; reason: string }
  /**
   * What the pursuit wants this frame, as the SAME FlightDemand a pair of hands
   * produces (player.ts) — ramped pitch/roll rates, a throttle, and a trigger.
   * `fire` and `ecm` are REQUESTS: shooting and spending the bank have
   * consequences, and consequences are the Game's (invariant 15). The demand
   * flows through the same `PlayerShip.update` a human's keys do, which is what
   * puts the co-pilot's turning on the HUD's pitch and roll needles.
   */
  | { kind: 'fly'; demand: FlightDemand; ecm: boolean };

export class ScriptedCoPilot {
  /** the same lock, the same margin, the same hold as the brain co-pilot */
  private readonly lock = new ThreatLock<NpcShip>();
  private readonly toThreat = new THREE.Vector3();
  private readonly nose = new THREE.Vector3();
  /** ramped turn rates, so the co-pilot's turn continues smoothly frame to frame */
  private pitchRate = 0;
  private rollRate = 0;
  /** which vertical the bank-to-turn is committed to — see pitch-roll-steer.ts */
  private readonly steerMem: SteerMemory = freshSteerMemory();
  /**
   * Seconds of "the commander is being hit" left — recorded from `noteHit`
   * (the Game's only way to tell the co-pilot it took damage) and decayed each
   * step. The pursuit does NOT read it yet: it kept fighting whether hit or not
   * even when it flew the attack run, and a dogfighter on the six should not
   * break off just because it is taking fire. Kept live end to end so an
   * evasive behaviour can be built on it later without re-plumbing.
   */
  private underFire = 0;

  noteHit(): void {
    this.underFire = UNDER_FIRE_SECONDS;
  }

  /** Let go of the fight entirely — the next step starts from nothing. */
  reset(): void {
    this.lock.clear();
    this.pitchRate = 0;
    this.rollRate = 0;
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
    // How far off the nose a candidate is — the turn it would cost to lock.
    const offNose = (npc: NpcShip): number => this.nose.set(0, 0, -1)
      .applyQuaternion(player.quaternion)
      .angleTo(this.toThreat.copy(npc.object.position).sub(player.position));
    const threat = this.lock.pick(
      dt,
      npcs.filter((npc) => isHostileToPlayer(npc, legalStatus)
        && npc.object.position.distanceTo(player.position) < THREAT_RANGE),
      // EASIEST to lock, not nearest: rank by the off-nose angle (the turn it
      // costs to get guns on) plus distance as a secondary tiebreak. Chris
      // asked for this, and it also sidesteps the distance roll-spin at its
      // source — with a wave of ships the co-pilot shoots the one already near
      // the crosshair and moves to the next-easiest, rather than banking hard
      // onto a far off-axis target and spinning. `TARGET_DIST_WEIGHT` sets how
      // many units of range weigh as much as a radian of turn.
      (npc) => offNose(npc)
        + npc.object.position.distanceTo(player.position) / TARGET_DIST_WEIGHT,
      // ENGAGED means don't switch: the target is in front and roughly on the
      // nose, so we are making the kill, not merely easiest to lock. A pilot
      // does not drop a ship it is lined up on because another became easier
      // (Chris). Only when NOT engaged — the current target has run wide or
      // behind — does the ranking get to hand us a better one.
      (npc) => offNose(npc) < ENGAGED_CONE,
    );
    if (!threat) {
      this.reset();
      return { kind: 'disengage', reason: 'AREA CLEAR — COMBAT COMPUTER OFF' };
    }
    const targetPos = threat.object.position;
    const dist = targetPos.distanceTo(player.position);
    // the angle the target fills — the gun's hit cone, WIDE up close. Both the
    // trigger and the roll-fade read it: you may fire anywhere in it, and you
    // need not bank to centre a target already inside it.
    const cone = hitCone(threat.radius, dist);

    // PURE PURSUIT: bank-to-turn straight at where the target IS. The gun is
    // hitscan, so there is nothing to lead — and aiming at the target rather
    // than ahead of it is what walks the nose onto the six as the target turns
    // and runs. Ramped through the commander's own envelope (PLAYER_FLIGHT), so
    // the co-pilot flies your ship as your hands would.
    const cmd = bankToTurn(player.quaternion,
      this.toThreat.copy(targetPos).sub(player.position), this.steerMem, cone);
    this.pitchRate = rampFlightRate(
      this.pitchRate, cmd.pitch * PLAYER_FLIGHT.maxPitch, cmd.pitch !== 0, dt);
    this.rollRate = rampFlightRate(
      this.rollRate, cmd.roll * PLAYER_FLIGHT.maxRoll, cmd.roll !== 0, dt);

    // How far off the nose the target is, AFTER this frame's ramp is decided but
    // before the Game integrates it — one frame's turn is ~0.02 rad, which
    // neither the throttle nor the fire cone can see.
    const facing = this.nose.set(0, 0, -1).applyQuaternion(player.quaternion)
      .angleTo(this.toThreat.copy(targetPos).sub(player.position));

    return {
      kind: 'fly',
      demand: {
        pitchRate: this.pitchRate,
        rollRate: this.rollRate,
        throttle: this.pursuitThrottle(player.speed, threat.state.speed, dist, facing),
        // the trigger only when the shot would count: the player gun's own cone
        // and range (gunnery.ts) — the laser's heat and cooldown pace it from
        // there, which is what makes this a marksman rather than a sprayer
        fire: dist <= LASER_RANGE && facing < cone,
      },
      // a warhead is always answered; whether one is coming is the world's
      // fact, and the gate is the same one every E.C.M. press goes through
      ecm: autopilotEcm(true, missilePos !== null),
    };
  }

  /**
   * Hold a gun-range standoff on the target's six: match its speed, plus close
   * (or open) the gap toward `PURSUIT_RANGE`, throttled back hard while the nose
   * still has a long way to swing so the ship can pivot instead of sailing wide.
   * Returns a throttle SIGN (−1/0/+1) with a deadband, because that is all
   * `FlightDemand.throttle` is and the ship's own accel does the rest.
   */
  private pursuitThrottle(
    ownSpeed: number, targetSpeed: number, dist: number, facing: number,
  ): number {
    const turnScale = PURSUIT_TURN_FLOOR
      + (1 - PURSUIT_TURN_FLOOR) * Math.max(0, Math.cos(facing));
    const want = Math.max(0, Math.min(PLAYER_FLIGHT.maxSpeed,
      (targetSpeed + PURSUIT_CLOSE_GAIN * (dist - PURSUIT_RANGE)) * turnScale));
    const diff = want - ownSpeed;
    return Math.abs(diff) < PURSUIT_SPEED_DEADBAND ? 0 : Math.sign(diff);
  }
}
