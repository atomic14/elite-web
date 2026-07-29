// What happens when things get shot.
//
// The player pulls the trigger, something takes the hit, and a chain of
// consequences follows: an explosion, a legal offence, a bounty, a contract
// tick, cargo tumbling out, a Navy mission closing. All of it lived in four
// methods of game.ts totalling 142 lines, interleaved with HUD calls.
//
// It is one responsibility — resolving a hit — so it is one file. The pattern
// is the same as ordnance.ts and trumbles.ts: this decides and reports, the
// Game applies. That matters most for `offence`, because raising your legal
// status is what launches the station's Vipers, and combat has no business
// knowing that.
//
// The geometry of what a shot passes through is shot.ts; the numbers are
// gunnery.ts. This is the consequences.

import * as THREE from 'three';
import type { World } from './world.ts';
import type { NpcShip } from './npc.ts';
import type { ShipSystems } from './systems.ts';
import { type CommanderData, formatCredits, killValue } from './commander.ts';
import { laserForView, canFire, chargeShot } from './gunnery.ts';
import { traceShot } from './shot.ts';
import { applyDamage } from './systems.ts';
import { offenceFor, OFFENDER, FUGITIVE } from './law.ts';
import { constrictorDestroyed } from './missions.ts';
import { random, randomInt } from './rng.ts';
import { sfx } from '../audio.ts';

/** Cargo an ordinary wreck spills: food, textiles, liquor, machinery, alloys, furs, minerals. */
const WRECK_CARGO = [0, 1, 4, 8, 9, 11, 12];
/** A mined asteroid yields minerals and metals. */
const ORE = [12, 12, 12, 13, 14];
/** How often the pilot punches out before the hull goes. */
const ESCAPE_CHANCE = { trader: 0.45, other: 0.2 };
/** Seconds the cockpit beams stay lit after a shot. */
export const BEAM_FLASH = 0.12;

export type CombatEvent =
  | { kind: 'message'; text: string; seconds: number }
  /** raise the legal status — the Game does it, because it launches the Vipers */
  | { kind: 'offence'; level: number }
  /** this ship has left the sky; drop any missile lock on it */
  | { kind: 'wrecked'; npc: NpcShip }
  /** point the cockpit beams here, or straight ahead when null */
  | { kind: 'beam'; at: THREE.Vector3 | null }
  /** the gun actually went off */
  | { kind: 'fired' }
  /** a hull breach cost the commander cargo or a fitting */
  | { kind: 'breach' }
  | { kind: 'died'; reason: string };

const say = (text: string, seconds: number): CombatEvent => ({ kind: 'message', text, seconds });

/** Scratch vectors, so resolving a shot allocates nothing. */
export interface CombatScratch {
  a: THREE.Vector3;
  b: THREE.Vector3;
  q: THREE.Quaternion;
  ray: THREE.Raycaster;
}

export class Combat {
  private readonly world: World;

  /**
   * Holds the World and nothing else.
   *
   * The commander is passed per call, deliberately: `Game.commander` is
   * REPLACED on respawn and on loading a snapshot, so a held reference would
   * quietly start crediting bounties to a commander who no longer exists.
   * Ordnance takes it the same way for the same reason.
   */
  constructor(world: World) {
    this.world = world;
  }

  /**
   * Pull the trigger in the current view.
   *
   * @param viewDir where THIS view points — not where the nose does, which is
   * why rear-view shots hit what is behind you.
   */
  fire(
    commander: CommanderData,
    sys: ShipSystems,
    playerPos: THREE.Vector3,
    viewDir: THREE.Vector3,
    view: number,
    witchspace: boolean,
    scratch: CombatScratch,
  ): CombatEvent[] {
    const laser = laserForView(commander.equipment, view);
    if (!laser || !canFire(sys)) return [];
    chargeShot(sys, laser);
    sfx.laser();

    const out: CombatEvent[] = [{ kind: 'fired' }];
    const shot = traceShot(
      playerPos, viewDir, this.world.npcs, this.world.cargo.items,
      witchspace ? null : this.world.station, scratch.ray, scratch.a);

    // Aim assist, the visible half: bend the cockpit beams onto whatever the
    // shot found. Chris's point — an allowance that silently counts a near
    // miss as a hit reads as a bug, where beams that visibly converge on the
    // target read as the gunsight doing its job. The shot is already resolved;
    // this only makes the resolution legible.
    out.push({
      kind: 'beam',
      at: shot.kind === 'ship' ? shot.ship.object.position
        : shot.kind === 'cargo' ? shot.cargo.object.position : null,
    });

    if (shot.kind === 'cargo') {
      sfx.hit();
      this.world.effects.explosion(shot.cargo.object.position.clone(), 0x8ad0ff,
        { count: 10, speed: 55, duration: 0.4 });
      this.world.cargo.destroy(shot.cargo);
      if (shot.cargo.kind === 'capsule') {
        // there is someone in that thing
        out.push(say('ESCAPE CAPSULE DESTROYED', 3), { kind: 'offence', level: FUGITIVE });
      } else {
        out.push(say('CARGO DESTROYED', 2));
      }
      return out;
    }

    if (shot.kind === 'station') {
      sfx.hit();
      // sparks off the hull, but the station itself shrugs it off
      const impact = playerPos.clone().addScaledVector(viewDir, shot.distance);
      this.world.effects.explosion(impact, 0xd8ffcc, { count: 10, speed: 60, duration: 0.4 });
      // Offender, not fugitive: a stray shot while lining up a dock is easy to
      // make, and fugitive means every police ship in the galaxy hunts you
      // forever. The Vipers are the real punishment — and shooting *them*
      // escalates you to fugitive the normal way.
      out.push(say('STATION HULL HIT — DEFENCES SCRAMBLING', 3),
        { kind: 'offence', level: OFFENDER });
      return out;
    }

    if (shot.kind === 'ship') {
      sfx.hit();
      // impact flash at the target so hits read clearly
      this.world.effects.explosion(shot.ship.object.position.clone(), 0xd8ffcc,
        { count: 8, speed: 70, duration: 0.35 });
      out.push({ kind: 'offence', level: offenceFor(shot.ship.role, false) });
      if (shot.ship.takeDamage(laser.damage, playerPos, true)) {
        out.push(...this.destroy(commander, shot.ship));
      }
    }
    return out;
  }

  /**
   * Destruction credited to the player: bounty, kills, rating, legal status,
   * contract progress and the Navy mission.
   */
  destroy(commander: CommanderData, npc: NpcShip): CombatEvent[] {
    const out = this.wreck(npc);
    const c = commander;

    if (npc.role !== 'asteroid') {
      c.kills += 1;
      // rating counts difficulty, not bodies: see killValue()
      c.combatScore += killValue(npc.threatTier);
    }

    if (npc.role === 'pirate') {
      for (const k of c.contracts) {
        if (k.kind !== 'bounty' || k.destination !== c.systemIndex) continue;
        if (k.progress >= k.qty) continue;
        k.progress += 1;
        if (k.progress >= k.qty) {
          out.push(say('BOUNTY CONTRACT COMPLETE — RETURN TO A STATION', 5));
        }
      }
    }

    out.push({ kind: 'offence', level: offenceFor(npc.role, true) });

    if (npc.bounty > 0) {
      c.credits += npc.bounty;
      out.push(say(`BOUNTY: ${formatCredits(npc.bounty)}`, 3));
    }
    if (npc.role === 'asteroid' && c.equipment.miningLaser) {
      this.world.cargo.spawn(npc.object.position, 1 + randomInt(3), ORE);
    }
    if (npc.isMissionTarget) {
      const e = constrictorDestroyed(c);
      if (e) {
        out.push(say(`CONSTRICTOR DESTROYED — ${formatCredits(e.bounty)} NAVY BOUNTY`, 6));
      }
    }
    return out;
  }

  /**
   * Take a ship out of the sky, with no credit to anyone.
   *
   * The shared path: an NPC killed by another NPC, or by a collision, goes
   * through here and NOT through destroy(), which is what stops you being paid
   * a bounty for a fight you watched.
   */
  wreck(npc: NpcShip): CombatEvent[] {
    const out: CombatEvent[] = [{ kind: 'wrecked', npc }];
    this.world.effects.explosion(npc.object.position.clone());
    sfx.explosion();
    this.world.despawn(npc);

    // wily traders and many pirates punch out at the last moment
    if (npc.role === 'trader' || npc.role === 'pirate' || npc.role === 'hunter') {
      const chance = npc.role === 'trader' ? ESCAPE_CHANCE.trader : ESCAPE_CHANCE.other;
      if (random() < chance) this.world.cargo.spawnCapsule(npc.object.position.clone());
    }
    if (npc.cargoDrop > 0) {
      this.world.cargo.spawn(npc.object.position,
        Math.floor(random() * (npc.cargoDrop + 1)), WRECK_CARGO);
    }
    // the drones go dead when the last mothership does
    if (npc.role === 'thargoid'
        && !this.world.npcs.some((n) => n.alive && n.role === 'thargoid')) {
      for (const t of this.world.npcs) {
        if (t.role === 'thargon') t.inert = true;
      }
      out.push(say('THARGONS DEACTIVATED', 3));
    }
    return out;
  }

  /**
   * The player takes a hit.
   *
   * Only the caller knows which way the ship is pointing, so the direction is
   * resolved here into the one bit the damage model wants: did it come from
   * ahead?
   */
  hitPlayer(
    sys: ShipSystems,
    amount: number,
    from: THREE.Vector3,
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    scratch: CombatScratch,
  ): CombatEvent[] {
    scratch.a.copy(from).sub(playerPos)
      .applyQuaternion(scratch.q.copy(playerQuat).invert());
    const result = applyDamage(sys, amount, scratch.a.z < 0);
    sfx.damage();

    const out: CombatEvent[] = [];
    if (result.wreckedSomething) out.push({ kind: 'breach' });
    if (result.destroyed) out.push({ kind: 'died', reason: 'SHIP DESTROYED' });
    return out;
  }
}
