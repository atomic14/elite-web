// Missiles, E.C.M. and the energy bomb — everything that is not the laser.
//
// This file owns missiles IN FLIGHT: spawn, homing, E.C.M. defeat, impact. It
// does NOT decide who launches one — whether an NPC reaches for a missile
// rather than its laser is `npcPrefersMissile` and `npcMissileLastStand` in
// gunnery.ts, applied by `NpcShip.chooseWeapon`, which reports the launch in
// its FireEvent; `Game.enemyLaunchMissile` spends the round and calls
// `launchHostile` below. "Ordnance" and "gunnery" are both
// period-correct words for the same thing, so this pointer is here because
// anyone hunting a missile rule starts in this file.
//
// One subsystem, previously eight methods scattered through game.ts between
// docking and the trumbles. It owns the missiles in flight and the target
// lock, because those are its state and nothing else writes them.
//
// Follows the house rule: it decides and reports, the Game applies. A missile
// reaching its target returns a `hit` for the Game to bill, because
// destroying a ship pays a bounty, moves your legal status and can scramble
// the station's Vipers — consequences an ordnance module has no business
// deciding.

import * as THREE from 'three';
import { buildShip, MISSILE } from '../ships/geometry.ts';
import type { NpcShip } from './npc.ts';
import type { CommanderData } from './commander.ts';
import type { World } from './world.ts';
import { random } from './rng.ts';
import { sfx } from '../audio.ts';
import type { MissileSnapshot } from './snapshot.ts';

/** Missile flight speed, world units per second. */
export const MISSILE_SPEED = 700;
/** How long a missile lives before it gives up and detonates. */
export const MISSILE_LIFE = 25;
/** A hostile missile lives longer — it has further to come. */
export const HOSTILE_MISSILE_LIFE = 30;
/** Turn rate while homing, radians per second. */
const MISSILE_TURN = 2.5;
/** Close enough to detonate. */
const MISSILE_HIT_RANGE = 50;
/** An E.C.M.-equipped target fries incoming missiles inside this. */
const ECM_RANGE = 2800;
/** ...at this chance per second. */
const ECM_RATE = 0.45;
/** Firing the E.C.M. costs this much energy. */
export const ECM_ENERGY_COST = 1;
/** The energy bomb reaches this far. */
export const ENERGY_BOMB_RANGE = 8000;
/** Lock cone: how near the crosshair a ship must be to be locked. */
const LOCK_CONE = 0.09;
/** ...and how far away it may be. */
const LOCK_RANGE = 5500;

export interface Missile {
  object: THREE.Object3D;
  /** null → a hostile missile homing on the player */
  target: NpcShip | null;
  life: number;
}

/** What the Game has to act on after a step. */
export type OrdnanceEvent =
  /** a missile reached an NPC — the Game bills the kill */
  | { kind: 'killed'; npc: NpcShip }
  /** a missile reached the player */
  | { kind: 'hitPlayer'; at: THREE.Vector3; damage: number }
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

export class Ordnance {
  readonly missiles: Missile[] = [];
  /** the ship a missile would fly at, also used by the HUD */
  targetLock: NpcShip | null = null;
  armed = false;

  private readonly world: World;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  /** Missiles live in the world: that is where they are drawn and what they hunt. */
  constructor(world: World) {
    this.world = world;
  }

  /** Arm a missile, if there is one to arm. */
  arm(commander: CommanderData): OrdnanceReply {
    if (commander.missiles <= 0) {
      sfx.beep(180);
      return 'noMissiles';
    }
    if (this.targetLock) return 'alreadyLocked';
    this.armed = !this.armed;
    sfx.beep(this.armed ? 700 : 400, 0.08);
    return this.armed ? 'armed' : 'unarmed';
  }

  disarm(): void {
    this.targetLock = null;
    this.armed = false;
  }

  /**
   * While armed, lock onto whatever enters the sight.
   * @param viewDir where the current view points — the lock cone's axis.
   */
  updateLock(playerPos: THREE.Vector3, viewDir: THREE.Vector3): OrdnanceReply | null {
    if (!this.armed || this.targetLock) return null;
    let best: NpcShip | null = null;
    let bestAngle = LOCK_CONE;
    for (const npc of this.world.npcs) {
      if (!npc.alive || npc.role === 'asteroid') continue;
      const to = npc.object.position.clone().sub(playerPos);
      if (to.length() > LOCK_RANGE) continue;
      const angle = viewDir.angleTo(to.normalize());
      if (angle < bestAngle) { bestAngle = angle; best = npc; }
    }
    if (!best) return null;
    this.targetLock = best;
    sfx.beep(1200, 0.12);
    return 'locked';
  }

  /** Fire at the locked target. */
  launch(commander: CommanderData, playerPos: THREE.Vector3): OrdnanceReply | null {
    if (commander.missiles <= 0) { sfx.beep(180); return null; }
    if (!this.targetLock) {
      sfx.beep(220);
      return 'noLock';
    }
    commander.missiles -= 1;
    this.spawn(playerPos, this.targetLock);
    this.targetLock = null;
    this.armed = false;
    sfx.missile();
    return 'away';
  }

  /** An NPC fires one at the player. */
  launchHostile(from: THREE.Vector3): OrdnanceReply {
    this.spawn(from, null);
    sfx.missile();
    return 'incoming';
  }

  private spawn(from: THREE.Vector3, target: NpcShip | null): void {
    const object = buildShip(MISSILE, target ? 0xffd0b0 : 0xff9a8a);
    object.position.copy(from);
    this.world.attach(object);
    this.missiles.push({ object, target, life: target ? MISSILE_LIFE : HOSTILE_MISSILE_LIFE });
  }

  /**
   * Fire the E.C.M.: every missile in the sky dies, ours included.
   * @returns true if it was actually used.
   */
  triggerEcm(commander: CommanderData, energy: number): OrdnanceReply {
    if (!commander.equipment.ecm) {
      sfx.beep(220);
      return 'noEcm';
    }
    if (energy < ECM_ENERGY_COST) {
      sfx.beep(180);
      return 'noEnergy';
    }
    for (const m of [...this.missiles]) this.destroy(m);
    sfx.ecm();
    return 'ecmFired';
  }

  /** Everything within range, gone. @returns the reply, and what it caught. */
  detonateEnergyBomb(
    commander: CommanderData, playerPos: THREE.Vector3,
  ): { reply: OrdnanceReply; caught: NpcShip[] } {
    if (!commander.equipment.energyBomb) {
      sfx.beep(220);
      return { reply: 'noBomb', caught: [] };
    }
    commander.equipment.energyBomb = false;
    const caught = this.world.npcs.filter((n) =>
      n.alive && n.role !== 'thargoid'   // thargoids shrug it off
      && n.object.position.distanceTo(playerPos) <= ENERGY_BOMB_RANGE);
    for (const m of [...this.missiles]) this.destroy(m);
    sfx.explosion();
    return { reply: 'bombFired', caught: [...caught] };
  }

  /** One frame of missile flight. @returns what the Game must act on. */
  step(dt: number, playerPos: THREE.Vector3): OrdnanceEvent[] {
    const events: OrdnanceEvent[] = [];
    for (const m of [...this.missiles]) {
      m.life -= dt;
      if ((m.target !== null && !m.target.alive) || m.life <= 0) {
        events.push({ kind: 'expired', at: m.object.position.clone() });
        this.destroy(m);
        continue;
      }
      const targetPos = m.target ? m.target.object.position : playerPos;
      const dir = this.tmp.copy(targetPos).sub(m.object.position);
      const dist = dir.length();

      if (m.target && m.target.hasEcm && dist < ECM_RANGE && random() < dt * ECM_RATE) {
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
        if (target) events.push({ kind: 'killed', npc: target });
        else events.push({ kind: 'hitPlayer', at, damage: 1.3 });
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
    const object = buildShip(MISSILE, target ? 0xffd0b0 : 0xff9a8a);
    object.position.copy(pos);
    object.quaternion.copy(quat);
    this.world.attach(object);
    this.missiles.push({ object, target, life });
  }
}


