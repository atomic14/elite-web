// Missiles, E.C.M. and the energy bomb — everything that is not the laser.
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

export interface OrdnanceContext {
  readonly commander: CommanderData;
  readonly npcs: readonly NpcShip[];
  readonly playerPos: THREE.Vector3;
  /** where the current view is pointing, for the lock cone */
  viewDir(out: THREE.Vector3): THREE.Vector3;
  message(text: string, seconds: number): void;
  add(object: THREE.Object3D): void;
  remove(object: THREE.Object3D): void;
}

export class Ordnance {
  readonly missiles: Missile[] = [];
  /** the ship a missile would fly at, also used by the HUD */
  targetLock: NpcShip | null = null;
  armed = false;

  private readonly ctx: () => OrdnanceContext;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  constructor(ctx: () => OrdnanceContext) {
    this.ctx = ctx;
  }

  /** Arm a missile, if there is one to arm. */
  arm(): void {
    const ctx = this.ctx();
    if (ctx.commander.missiles <= 0) {
      ctx.message('NO MISSILES', 2);
      sfx.beep(180);
      return;
    }
    if (this.targetLock) {
      ctx.message('ALREADY LOCKED — U TO UNARM', 2);
      return;
    }
    this.armed = !this.armed;
    ctx.message(this.armed ? 'MISSILE ARMED' : 'MISSILE UNARMED', 2);
    sfx.beep(this.armed ? 700 : 400, 0.08);
  }

  disarm(): void {
    this.targetLock = null;
    this.armed = false;
  }

  /** While armed, lock onto whatever enters the sight. */
  updateLock(): void {
    if (!this.armed || this.targetLock) return;
    const ctx = this.ctx();
    const forward = ctx.viewDir(this.tmp);
    let best: NpcShip | null = null;
    let bestAngle = LOCK_CONE;
    for (const npc of ctx.npcs) {
      if (!npc.alive || npc.role === 'asteroid') continue;
      const to = npc.object.position.clone().sub(ctx.playerPos);
      if (to.length() > LOCK_RANGE) continue;
      const angle = forward.angleTo(to.normalize());
      if (angle < bestAngle) { bestAngle = angle; best = npc; }
    }
    if (best) {
      this.targetLock = best;
      ctx.message('MISSILE LOCKED', 2);
      sfx.beep(1200, 0.12);
    }
  }

  /** Fire at the locked target. @returns true if one left the rail. */
  launch(): boolean {
    const ctx = this.ctx();
    if (ctx.commander.missiles <= 0) { sfx.beep(180); return false; }
    if (!this.targetLock) {
      ctx.message('NO TARGET LOCK', 2);
      sfx.beep(220);
      return false;
    }
    ctx.commander.missiles -= 1;
    this.spawn(ctx, ctx.playerPos, this.targetLock);
    this.targetLock = null;
    this.armed = false;
    ctx.message('MISSILE AWAY', 2);
    sfx.missile();
    return true;
  }

  /** An NPC fires one at the player. */
  launchHostile(from: THREE.Vector3): void {
    const ctx = this.ctx();
    this.spawn(ctx, from, null);
    ctx.message('INCOMING MISSILE', 3);
    sfx.missile();
  }

  private spawn(ctx: OrdnanceContext, from: THREE.Vector3, target: NpcShip | null): void {
    const object = buildShip(MISSILE, target ? 0xffd0b0 : 0xff9a8a);
    object.position.copy(from);
    ctx.add(object);
    this.missiles.push({ object, target, life: target ? MISSILE_LIFE : HOSTILE_MISSILE_LIFE });
  }

  /**
   * Fire the E.C.M.: every missile in the sky dies, ours included.
   * @returns true if it was actually used.
   */
  triggerEcm(energy: number): boolean {
    const ctx = this.ctx();
    if (!ctx.commander.equipment.ecm) {
      ctx.message('NO E.C.M. FITTED', 2);
      sfx.beep(220);
      return false;
    }
    if (energy < ECM_ENERGY_COST) {
      ctx.message('INSUFFICIENT ENERGY FOR E.C.M.', 2);
      sfx.beep(180);
      return false;
    }
    for (const m of [...this.missiles]) this.destroy(m);
    ctx.message('E.C.M. ACTIVATED', 2);
    sfx.ecm();
    return true;
  }

  /** Everything within range, gone. @returns what it caught. */
  detonateEnergyBomb(): NpcShip[] {
    const ctx = this.ctx();
    if (!ctx.commander.equipment.energyBomb) {
      ctx.message('NO ENERGY BOMB FITTED', 3);
      sfx.beep(220);
      return [];
    }
    ctx.commander.equipment.energyBomb = false;
    const caught = ctx.npcs.filter((n) =>
      n.alive && n.role !== 'thargoid'   // thargoids shrug it off
      && n.object.position.distanceTo(ctx.playerPos) <= ENERGY_BOMB_RANGE);
    for (const m of [...this.missiles]) this.destroy(m);
    ctx.message('ENERGY BOMB DETONATED', 4);
    sfx.explosion();
    return [...caught];
  }

  /** One frame of missile flight. @returns what the Game must act on. */
  step(dt: number): OrdnanceEvent[] {
    const ctx = this.ctx();
    const events: OrdnanceEvent[] = [];
    for (const m of [...this.missiles]) {
      m.life -= dt;
      if ((m.target !== null && !m.target.alive) || m.life <= 0) {
        events.push({ kind: 'expired', at: m.object.position.clone() });
        this.destroy(m);
        continue;
      }
      const targetPos = m.target ? m.target.object.position : ctx.playerPos;
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
    this.ctx().remove(m.object);
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
    this.ctx().add(object);
    this.missiles.push({ object, target, life });
  }
}


