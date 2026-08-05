// The purchasable combat computer: the defence brain flying your ship.
//
// It is the same `jameson-defend` policy an armed trader uses, pointed at the
// nearest thing hostile to you. Buying it means buying a co-pilot who evades
// well and shoots adequately — which is exactly what the training measured, so
// it is honest about what it is.
//
// The module works out what the autopilot WANTS and reports it as a
// `FlightDemand` — the SAME thing a human's hands produce
// (engine/flight-controls.ts), flown by the same `PlayerShip.update`. The
// Game applies it and pulls the trigger, because firing has consequences —
// legal status, bounties, the station's Vipers — that an autopilot has no
// business deciding.

import type * as THREE from 'three';
import { rampToward, type FlightDemand } from '../player.ts';
import {
  act, makeScratch, MAX_OBS_SIZE, type Brain,
} from '../ai-training/policy.ts';
import {
  observeFor, shipView, writeView, type ThreatsView, type V3,
} from '../ai-training/observation.ts';
import { isHostileToPlayer, type NpcShip } from './npc.ts';
import { autopilotEcm } from './ordnance.ts';
import {
  aftShieldLeft, energyLeft, foreShieldLeft, poolsLeft, type ShipSystems,
} from './systems.ts';
import {
  BRAIN_RATE_DECAY, BRAIN_RATE_RAMP, DECISION_INTERVAL,
} from '../constants/brain-flight.ts';
import {
  CC_ACCEL, CC_MAX_PITCH, CC_MAX_ROLL, CC_MAX_SPEED, THREAT_RANGE,
} from '../constants/combat-computer.ts';
import { ThreatLock } from './threat-lock.ts';

export type AutopilotStep =
  /** hands off — the reason is for the player */
  | { kind: 'disengage'; reason: string }
  /**
   * What it wants — and, separately, whether it is reaching for the E.C.M.
   *
   * NOT a field of `FlightDemand`, which is deliberately the four things a pair
   * of hands produces and is flown by `PlayerShip.update`. The E.C.M. is a
   * COMMAND key, not a flight axis: it spends a quarter of the bank and wipes
   * the sky, which is a consequence, and consequences are the Game's (invariant
   * 15). So it is reported beside the demand and `game.ts` presses it through
   * `fireEcm` — the same call the player's own key makes.
   */
  | { kind: 'fly'; demand: FlightDemand; ecm: boolean };

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
  /**
   * The decision being acted on right now.
   *
   * `ecm` rides along with the other four for the reason the whole object
   * exists: it is held between decisions, so it is state, and state is saved.
   * `snapshot.ts` walks this generically, so the field costs nothing to persist.
   *
   * It is REQUIRED, like the other four. It was optional so that a save written
   * before the fourth head existed could restore a `control` without one and
   * read as "not pressing" — but `act()` returns `Control.ecm` unconditionally
   * (`ai-training/policy.ts`: always false for a brain with no logit for it), so
   * nothing this build can write omits it, and the optionality was tolerance for
   * a save that does not exist. Deleted 2026-08-04 with the other four.
   */
  control: {
    pitch: number; roll: number; throttle: number; fire: boolean; ecm: boolean;
  } | null;
}

export function freshAutopilot(): AutopilotState {
  return { pitch: 0, roll: 0, timer: 0, control: null };
}

export class CombatComputer {
  /** @see AutopilotState — public so the snapshot can walk it */
  readonly state: AutopilotState = freshAutopilot();
  // Wide enough for the WIDEST encoder, as npc.ts's buffer is, and for the
  // same reason: which encoder runs is `observeFor`'s decision from the
  // brain's own shape, so a buffer sized to today's shipped brain is a buffer
  // that reads past its end the day a wider one is promoted. It has happened
  // twice now (docs/TODO/71, /91); `MAX_OBS_SIZE` is policy.ts saying it
  // cannot happen again.
  private readonly obs = new Float32Array(MAX_OBS_SIZE);
  private readonly scratch = makeScratch();
  private readonly me = shipView(CC_MAX_SPEED, 0.5, 0);
  /**
   * The threat's speed WAS a constant 280, and is the real one now.
   *
   * game.ts initialised this view with 280 and never updated it, so every
   * defence policy up to `jameson-defend-g1` had only ever been flown against
   * that value — exactly like the 300 the pirate brains are still fed in
   * npc.ts. The comment here said, in as many words, "it is load-bearing until
   * the brain is retrained".
   *
   * docs/TODO/71 and /72 retrained it. `jameson-defend-g2` was fitted in
   * `Episode.observeTrader`, which has always written the attacker's REAL
   * speed, so the pin is now the divergence rather than the protection: the
   * constant is what would put the shipped policy out of distribution. The
   * envelope numbers stay — no encoder reads a target's `cls`.
   */
  private readonly target = shipView(300, 1.1, 0);

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
  /**
   * @param missilePos where the hostile warhead in the sky is, or null when
   * there is none — `Ordnance.hostileMissilePos`, the world's answer, read
   * once a frame by the step that calls this. Its EXISTENCE is slot 15 and
   * the E.C.M. gate (`autopilotEcm` — the policy decides whether to answer a
   * warhead, not whether there is one); its BEARING is slots 24-26.
   */
  /** the threat being fought — see game/threat-lock.ts for the rule */
  private readonly threatLock = new ThreatLock<NpcShip>();

  step(
    dt: number,
    player: AutopilotShip,
    sys: ShipSystems,
    npcs: readonly NpcShip[],
    legalStatus: number,
    manualInput: boolean,
    brain: Brain | null,
    missilePos: V3 | null = null,
  ): AutopilotStep {
    if (manualInput) return { kind: 'disengage', reason: 'MANUAL OVERRIDE' };

    // COMMITTED, not merely nearest: a fresh-every-frame pick flipped the
    // fought ship up to 26.8 times a minute and the brain's bearing slots
    // jumped ~90 degrees each flip — the rule and the measurements are
    // game/threat-lock.ts's, shared with the armed trader and the trainer.
    const hostiles = npcs.filter((npc) => isHostileToPlayer(npc, legalStatus)
      && npc.object.position.distanceTo(player.position) < THREAT_RANGE);
    const threat = this.threatLock.pick(
      dt, hostiles, (npc) => npc.object.position.distanceTo(player.position),
    );
    if (!threat || !brain) {
      this.threatLock.clear();
      return { kind: 'disengage', reason: 'AREA CLEAR — COMBAT COMPUTER OFF' };
    }

    this.state.timer -= dt;
    if (!this.state.control || this.state.timer <= 0) {
      this.state.timer = DECISION_INTERVAL;
      writeView(this.me, player.position, player.quaternion);
      this.me.speed = player.speed;
      this.me.laserTemp = sys.laserTemp;
      this.me.laserCooldown = sys.laserCooldown;
      // HOW HURT SHE IS, and whether anything is coming — the two things
      // docs/TODO/71 and /72 found missing, from `systems.ts`'s own expressions
      // so the game and the trainer cannot come to compute them differently.
      // A 14-input brain never reads them; `observeFor` decides.
      this.me.hp = poolsLeft(sys);
      this.me.energy = energyLeft(sys);
      this.me.missileInbound = missilePos !== null;
      this.me.fore = foreShieldLeft(sys);
      this.me.aft = aftShieldLeft(sys);
      this.me.pitchRate = this.state.pitch;
      this.me.rollRate = this.state.roll;
      writeView(this.target, threat.object.position, threat.object.quaternion);
      // ...and how fast it is actually going, which the trainer has always fed
      // the policy and this file used to pin at 280. See `target` above.
      this.target.speed = threat.state.speed;
      // Which encoder this brain wants is policy.ts's question, asked the same
      // way npc.ts asks it. It was `observe()` outright, which was correct for
      // exactly as long as every defence policy had 14 inputs.
      const threats: ThreatsView = {
        others: hostiles.filter((npc) => npc !== threat)
          .map((npc) => ({ pos: npc.object.position })),
        count: hostiles.length,
        missilePos,
      };
      this.state.control = act(
        brain,
        observeFor(brain, this.me, this.target, null, this.obs, threats),
        this.scratch);
    }

    const c = this.state.control;
    this.state.pitch = ccRamp(this.state.pitch, c.pitch * CC_MAX_PITCH, c.pitch !== 0, dt);
    this.state.roll = ccRamp(this.state.roll, c.roll * CC_MAX_ROLL, c.roll !== 0, dt);
    return {
      kind: 'fly',
      ecm: autopilotEcm(c.ecm, missilePos !== null),
      demand: {
        pitchRate: this.state.pitch,
        rollRate: this.state.roll,
        throttle: c.throttle,
        fire: c.fire,
        // it cruises rather than sprints — see FlightDemand.limits
        limits: { accel: CC_ACCEL, maxSpeed: CC_MAX_SPEED },
      },
    };
  }
}

/**
 * The rate ramp an NPC's brain flies with, applied to the player's ship.
 *
 * The RULE is player.ts's `rampToward` — it was written out here a third time,
 * constants and all. Only the constants are this module's: the defence policy
 * was fitted at the NPC ramp, so the autopilot flies at the NPC ramp.
 *
 * Exported so train/jameson-autopilot.js — the console harness that stands in
 * for this autopilot — can use it instead of writing 4.0/5.0 out again.
 */
export function ccRamp(cur: number, target: number, active: boolean, dt: number): number {
  return rampToward(cur, target, active, dt, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY);
}
