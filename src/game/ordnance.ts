// Missiles, E.C.M. and the energy bomb — everything that is not the laser.
//
// This file owns missiles IN FLIGHT: spawn, homing, E.C.M. defeat, impact. It
// does NOT decide who launches one — whether an NPC reaches for a missile
// rather than its laser is `npcMissileEmergency` in `missile-launch.ts`, not
// gunnery.ts, applied by `NpcShip.chooseWeapon`, which reports the launch in
// its FireEvent; `launchNpcMissile` below spends the round and puts the warhead
// in the sky. "Ordnance" and "gunnery" are both
// period-correct words for the same thing, so this pointer is here because
// anyone hunting a missile rule starts in this file.
//
// One subsystem, previously eight methods scattered through game.ts between
// docking and the trumbles. It owns the missiles in flight and the target
// lock, because those are its state and nothing else writes them.
//
// The numbers — the seeker's envelope, the E.C.M.'s reach and its price, the
// bomb's radius — are constants/ordnance.ts, one file for both halves of the
// weapon, and that is where the reasoning behind each of them lives.
//
// Follows the house rule: it decides and reports, the Game applies. A missile
// reaching its target returns a `hit` for the Game to bill, because
// destroying a ship pays a bounty, moves your legal status and can scramble
// the station's Vipers — consequences an ordnance module has no business
// deciding.

import * as THREE from 'three';
import { buildShip } from '../ships/geometry.ts';
import { OBJECT_DESIGNS, requireShipDef } from '../ships/registry.ts';
import {
  ECM_ENERGY_COST, ECM_RANGE, ECM_RATE, ENERGY_BOMB_RANGE, HOSTILE_MISSILE_LIFE,
  LOCK_CONE, LOCK_RANGE, MISSILE_HIT_RANGE, MISSILE_LIFE, MISSILE_SPEED,
  MISSILE_TURN,
} from '../constants/ordnance.ts';
import type { NpcShip } from './npc.ts';
import type { CommanderData } from './commander.ts';
import { random } from './rng.ts';
import type { MissileSnapshot } from './snapshot.ts';
import type { SoundEvent, SoundName } from './sounds.ts';

/** The released missile — one hull, resolved once. */
const MISSILE_HULL = requireShipDef(OBJECT_DESIGNS.missile);

export interface Missile {
  object: THREE.Object3D;
  /** null → a hostile missile homing on the player */
  target: NpcShip | null;
  life: number;
}

/**
 * What the Game has to act on after a step.
 *
 * A warhead reaching something REPORTS THE IMPACT and no longer carries a
 * number. It used to say `damage: 1.3` — a normalized literal, and the last
 * damage figure in the project written where the thing that spends it could not
 * see the scale — and `killed` was worse: an ordnance module deciding a ship was
 * destroyed, which is a consequence (a bounty, a legal status, a contract tick)
 * and therefore the Game's. What a warhead is worth is `IMPACT.warhead` in
 * constants/impact.ts, and the step spends it like any other hit.
 */
export type OrdnanceEvent =
  /** a missile reached an NPC — the Game applies the warhead and bills what follows */
  | { kind: 'hitNpc'; npc: NpcShip; at: THREE.Vector3 }
  /** a missile reached the player */
  | { kind: 'hitPlayer'; at: THREE.Vector3 }
  /** a target's E.C.M. destroyed one of ours */
  | { kind: 'ecmDefeated'; at: THREE.Vector3 }
  /** it ran out of life or its target died */
  | { kind: 'expired'; at: THREE.Vector3 };

/**
 * What a command did, for the Game to say out loud.
 *
 * This replaced a `message()` callback in a context interface. The callback
 * was the only thing here shaped like its caller: it meant ordnance could not
 * be used, or tested, without something that owned a HUD.
 */
export type OrdnanceReply =
  | 'noMissiles' | 'alreadyLocked' | 'armed' | 'unarmed' | 'locked'
  | 'noLock' | 'away' | 'incoming'
  | 'noEcm' | 'noEnergy' | 'ecmFired' | 'noBomb' | 'bombFired';

/** A command's semantic reply and every platform consequence it asks for. */
export interface OrdnanceOutcome {
  reply: OrdnanceReply | null;
  events: SoundEvent[];
}

const heard = (name: SoundName): SoundEvent => ({ kind: 'sound', name });

/**
 * One mapping from ordnance meaning to sound meaning. Callers apply these
 * events through the same sound path as every other rule module.
 */
function outcome(reply: OrdnanceReply | null): OrdnanceOutcome {
  if (!reply || reply === 'alreadyLocked') return { reply, events: [] };
  const sounds: Record<Exclude<OrdnanceReply, 'alreadyLocked'>, SoundName> = {
    noMissiles: 'noMissiles',
    armed: 'missileArmed',
    unarmed: 'missileUnarmed',
    locked: 'missileLocked',
    noLock: 'refused',
    away: 'missile',
    incoming: 'missile',
    noEcm: 'refused',
    noEnergy: 'noEnergy',
    ecmFired: 'ecm',
    noBomb: 'refused',
    bombFired: 'explosion',
  };
  return { reply, events: [heard(sounds[reply])] };
}

/** The line for a reply, so the wording lives with the rule. */
export function ordnanceMessage(r: OrdnanceReply): { text: string; seconds: number } {
  switch (r) {
    case 'noMissiles': return { text: 'NO MISSILES', seconds: 2 };
    case 'alreadyLocked': return { text: 'ALREADY LOCKED — U TO UNARM', seconds: 2 };
    case 'armed': return { text: 'MISSILE ARMED', seconds: 2 };
    case 'unarmed': return { text: 'MISSILE UNARMED', seconds: 2 };
    case 'locked': return { text: 'MISSILE LOCKED', seconds: 2 };
    case 'noLock': return { text: 'NO TARGET LOCK', seconds: 2 };
    case 'away': return { text: 'MISSILE AWAY', seconds: 2 };
    case 'incoming': return { text: 'INCOMING MISSILE', seconds: 3 };
    case 'noEcm': return { text: 'NO E.C.M. FITTED', seconds: 2 };
    case 'noEnergy': return { text: 'INSUFFICIENT ENERGY FOR E.C.M.', seconds: 2 };
    case 'ecmFired': return { text: 'E.C.M. ACTIVATED', seconds: 2 };
    case 'noBomb': return { text: 'NO ENERGY BOMB FITTED', seconds: 3 };
    case 'bombFired': return { text: 'ENERGY BOMB DETONATED', seconds: 4 };
  }
}

/**
 * A sky, as much of one as ordnance needs: somewhere to put a warhead, and the
 * ships there are to lock onto or catch.
 *
 * `World` satisfies it and is the only thing in the game that does. It exists
 * because a TRAINING EPISODE is a sky too — a fleet and a target, with nothing
 * to draw into — and the missile model must not be written a second time for it
 * (docs/TODO/62). Same bargain as `engine/shell.ts`, `game/storage.ts` and
 * `sun.ts`: attaching a mesh to nothing is inert, not broken, because nothing
 * here reads the scene back. A missile's position is its own.
 */
export interface OrdnanceWorld {
  attach(object: THREE.Object3D): void;
  detach(object: THREE.Object3D): void;
  readonly npcs: readonly NpcShip[];
}

/**
 * An NPC spends a round, and it leaves the rail.
 *
 * ONE HOME for what a missile `FireEvent` MEANS, because there are two
 * resolvers — `world-step.ts` for the game and `ai-training/scenario.ts` for the
 * trainer — and the trainer's had neither half of this: it spent no round and
 * launched no missile (docs/TODO/62). The pair is a rule, not presentation, so
 * neither resolver may own it. It was the first slice of docs/TODO/64, which has
 * since closed the rest: the laser's dice, its damage and the shield face it
 * lands on live in `fire-resolution.ts`, and this is the call its missile branch
 * makes.
 */
export function launchNpcMissile(npc: NpcShip, ordnance: Ordnance): OrdnanceOutcome {
  npc.state.missiles -= 1;
  return ordnance.launchHostile(npc.nosePosition(new THREE.Vector3()));
}

/**
 * WHO IS PRESSING IT — everything `triggerEcm` needs to know about the ship.
 *
 * `CommanderData` satisfies it structurally and is the only thing in the GAME
 * that does. It exists because a training episode's target is not a commander —
 * it is a hull id and a `ShipSystems` — and it must still carry the one piece of
 * equipment that answers a warhead (docs/TODO/72). Same bargain as
 * `OrdnanceWorld` above and `FireWorld` in fire-resolution.ts: the narrowest
 * surface the rule reads, implemented by the game and by the trainer.
 */
export interface EcmFit {
  readonly equipment: { readonly ecm: boolean };
}

/**
 * The E.C.M. is pressed: the rule AND the price, in one call.
 *
 * The price was the orchestrator's — `game.ts` read the reply and took
 * `ECM_ENERGY_COST` off the bank — which was fine while there was one
 * orchestrator. There are two (`world-step.ts` and `ai-training/scenario.ts`)
 * and every rule split across them has drifted (docs/TODO/64), so the burst and
 * its price travel together and the caller's job is what it was: say the reply
 * and play the sound. Spent ONLY on `ecmFired` — a refusal costs nothing, which
 * is what makes an autopilot's hopeful press harmless rather than suicidal.
 */
export function fireEcm(
  fit: EcmFit, sys: { energy: number }, ordnance: Ordnance,
): OrdnanceOutcome {
  const result = ordnance.triggerEcm(fit, sys.energy);
  if (result.reply === 'ecmFired') sys.energy -= ECM_ENERGY_COST;
  return result;
}

/**
 * Does an AUTOPILOT press it this frame? What the policy asked for, gated on
 * there being a warhead to answer.
 *
 * The twin of the gun gate in `NpcShip.brainFly` — "the brain decides where to
 * be, the gun decides when to shoot" — for the same two reasons. Whether
 * anything is in the sky is the world's fact, not the policy's guess; and the
 * trainer re-decides every step where the combat computer re-decides at 10 Hz,
 * so ungated the two worlds would spend a different number of bursts per
 * warhead — a second physics wearing a button. Gated it is one either way,
 * because a successful burst empties the sky.
 *
 * It does not stop a HUMAN wasting one on an empty sky: that is the player's
 * key and the player's bank to spend. It stops a co-pilot doing it.
 */
export function autopilotEcm(policyWantsIt: boolean, missileInbound: boolean): boolean {
  return policyWantsIt && missileInbound;
}

export class Ordnance {
  readonly missiles: Missile[] = [];
  /** the ship a missile would fly at, also used by the HUD */
  targetLock: NpcShip | null = null;
  armed = false;

  private readonly world: OrdnanceWorld;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  /** Missiles live in the world: that is where they are drawn and what they hunt. */
  constructor(world: OrdnanceWorld) {
    this.world = world;
  }

  /** Arm a missile, if there is one to arm. */
  arm(commander: CommanderData): OrdnanceOutcome {
    if (commander.missiles <= 0) {
      return outcome('noMissiles');
    }
    if (this.targetLock) return outcome('alreadyLocked');
    this.armed = !this.armed;
    return outcome(this.armed ? 'armed' : 'unarmed');
  }

  disarm(): void {
    this.targetLock = null;
    this.armed = false;
  }

  /**
   * While armed, lock onto whatever enters the sight.
   * @param viewDir where the current view points — the lock cone's axis.
   */
  updateLock(playerPos: THREE.Vector3, viewDir: THREE.Vector3): OrdnanceOutcome {
    if (!this.armed || this.targetLock) return outcome(null);
    let best: NpcShip | null = null;
    let bestAngle = LOCK_CONE;
    for (const npc of this.world.npcs) {
      if (!npc.state.alive || npc.role === 'asteroid') continue;
      const to = npc.object.position.clone().sub(playerPos);
      if (to.length() > LOCK_RANGE) continue;
      const angle = viewDir.angleTo(to.normalize());
      if (angle < bestAngle) { bestAngle = angle; best = npc; }
    }
    if (!best) return outcome(null);
    this.targetLock = best;
    return outcome('locked');
  }

  /** Fire at the locked target. */
  launch(commander: CommanderData, playerPos: THREE.Vector3): OrdnanceOutcome {
    if (commander.missiles <= 0) return { reply: null, events: [heard('noMissiles')] };
    if (!this.targetLock) {
      return outcome('noLock');
    }
    commander.missiles -= 1;
    this.spawn(playerPos, this.targetLock);
    this.targetLock = null;
    this.armed = false;
    return outcome('away');
  }

  /** An NPC fires one at the player. */
  launchHostile(from: THREE.Vector3): OrdnanceOutcome {
    this.spawn(from, null);
    return outcome('incoming');
  }

  private spawn(from: THREE.Vector3, target: NpcShip | null): void {
    const object = buildShip(MISSILE_HULL, target ? 0xffd0b0 : 0xff9a8a);
    object.position.copy(from);
    this.world.attach(object);
    this.missiles.push({ object, target, life: target ? MISSILE_LIFE : HOSTILE_MISSILE_LIFE });
  }

  /**
   * Fire the E.C.M.: every missile in the sky dies, ours included.
   * Reports whether it was used and the named sound to apply.
   */
  triggerEcm(commander: EcmFit, energy: number): OrdnanceOutcome {
    if (!commander.equipment.ecm) {
      return outcome('noEcm');
    }
    // `<=`, so the burst can never spend the LAST point: a bank at exactly 0
    // with the ship still flying is a state nothing else in the model can
    // reach, and it used to make an absorbed hit read as a kill (TODO 48).
    if (energy <= ECM_ENERGY_COST) {
      return outcome('noEnergy');
    }
    for (const m of [...this.missiles]) this.destroy(m);
    return outcome('ecmFired');
  }

  /**
   * Is a hostile missile already homing on the player?
   *
   * `target === null` IS what makes a missile hostile — see the field. Asked by
   * the world step so an NPC can be told, through its `WorldView`, that the air
   * is already occupied: one at a time, gang-wide, so a single E.C.M. press
   * remains a complete answer. It reads the list rather than keeping a count,
   * because the list is the truth and a counter beside it would be a second
   * home for the same fact.
   */
  get missileInbound(): boolean {
    return this.missiles.some((m) => m.target === null);
  }

  /**
   * WHERE the hostile warhead is, or null when the sky is clear — the same
   * `target === null` test as `missileInbound`, returning the missile instead
   * of the fact of it. The defence policy observes its bearing
   * (`observeDefend` slots 24-26); the cap of one hostile missile in the air
   * is what lets a single position be the whole answer.
   */
  get hostileMissilePos(): THREE.Vector3 | null {
    const m = this.missiles.find((m) => m.target === null);
    return m ? m.object.position : null;
  }

  /** Everything within range, gone. @returns the reply, and what it caught. */
  detonateEnergyBomb(
    commander: CommanderData, playerPos: THREE.Vector3,
  ): OrdnanceOutcome & { caught: NpcShip[] } {
    if (!commander.equipment.energyBomb) {
      return { ...outcome('noBomb'), caught: [] };
    }
    commander.equipment.energyBomb = false;
    const caught = this.world.npcs.filter((n) =>
      n.state.alive && n.role !== 'thargoid'   // thargoids shrug it off
      && n.object.position.distanceTo(playerPos) <= ENERGY_BOMB_RANGE);
    for (const m of [...this.missiles]) this.destroy(m);
    return { ...outcome('bombFired'), caught: [...caught] };
  }

  /** One frame of missile flight. @returns what the Game must act on. */
  step(dt: number, playerPos: THREE.Vector3): OrdnanceEvent[] {
    const events: OrdnanceEvent[] = [];
    for (const m of [...this.missiles]) {
      m.life -= dt;
      if ((m.target !== null && !m.target.state.alive) || m.life <= 0) {
        events.push({ kind: 'expired', at: m.object.position.clone() });
        this.destroy(m);
        continue;
      }
      const targetPos = m.target ? m.target.object.position : playerPos;
      const dir = this.tmp.copy(targetPos).sub(m.object.position);
      const dist = dir.length();

      if (m.target && m.target.state.hasEcm && dist < ECM_RANGE && random() < dt * ECM_RATE) {
        events.push({ kind: 'ecmDefeated', at: m.object.position.clone() });
        this.destroy(m);
        continue;
      }

      this.tmpM.lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
      this.tmpQ.setFromRotationMatrix(this.tmpM);
      m.object.quaternion.rotateTowards(this.tmpQ, MISSILE_TURN * dt);
      m.object.position.addScaledVector(
        this.tmp.set(0, 0, -1).applyQuaternion(m.object.quaternion), MISSILE_SPEED * dt);

      if (dist < MISSILE_HIT_RANGE) {
        const at = m.object.position.clone();
        const target = m.target;
        this.destroy(m);
        if (target) events.push({ kind: 'hitNpc', npc: target, at });
        else events.push({ kind: 'hitPlayer', at });
      }
    }
    return events;
  }

  /** Drop a missile without an event — the caller has already decided why. */
  destroy(m: Missile): void {
    this.world.detach(m.object);
    const i = this.missiles.indexOf(m);
    if (i >= 0) this.missiles.splice(i, 1);
  }

  /** Forget everything — a new system, or a restored snapshot. */
  clear(): void {
    for (const m of [...this.missiles]) this.destroy(m);
    this.targetLock = null;
    this.armed = false;
  }

  /** The missiles in flight, as plain data. `indexOf` resolves the targets. */
  capture(indexOf: (npc: NpcShip) => number): MissileSnapshot[] {
    return this.missiles.map((m) => ({
      pos: [m.object.position.x, m.object.position.y, m.object.position.z],
      quat: [m.object.quaternion.x, m.object.quaternion.y,
        m.object.quaternion.z, m.object.quaternion.w],
      targetIndex: m.target ? indexOf(m.target) : -1,
      life: m.life,
    } satisfies MissileSnapshot));
  }

  /** Replace what is in the sky with a captured set. */
  restoreAll(saved: readonly MissileSnapshot[], npcAt: (i: number) => NpcShip | null): void {
    this.clear();
    for (const m of saved) {
      this.restore(
        new THREE.Vector3(...m.pos), new THREE.Quaternion(...m.quat),
        m.targetIndex >= 0 ? npcAt(m.targetIndex) : null, m.life);
    }
  }

  /** Rebuild a missile from a snapshot. */
  restore(pos: THREE.Vector3, quat: THREE.Quaternion, target: NpcShip | null, life: number): void {
    const object = buildShip(MISSILE_HULL, target ? 0xffd0b0 : 0xff9a8a);
    object.position.copy(pos);
    object.quaternion.copy(quat);
    this.world.attach(object);
    this.missiles.push({ object, target, life });
  }
}
