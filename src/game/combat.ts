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
//
// The two free functions at the bottom are the player's own gun and the
// player's own hull, taken over a GameState: they build the arguments
// `Combat.fire`/`hitPlayer` want out of the state and hand the events back to
// whoever asked. That is what lets a caller other than the Game pull the real
// trigger and take the real damage, and decide for itself what the events mean.

import * as THREE from 'three';
import type { World } from './world.ts';
import type { NpcShip } from './npc.ts';
import type { GameState } from './state.ts';
import type { ShipSystems } from './systems.ts';
import type { PlayerPoolPoints } from './damage-units.ts';
import { viewDirection } from './views.ts';
import { type CommanderData, formatCredits, killValue } from './commander.ts';
import { laserForView, canFire, chargeShot } from './gunnery.ts';
import { traceShot } from './shot.ts';
import { applyDamage } from './systems.ts';
import { offenceFor, OFFENDER, FUGITIVE } from './law.ts';
import { constrictorDestroyed } from './missions.ts';
import { random, randomInt } from './rng.ts';
import type { SoundEvent, SoundName } from './sounds.ts';

/** Cargo an ordinary wreck spills: food, textiles, liquor, machinery, alloys, furs, minerals. */
const WRECK_CARGO = [0, 1, 4, 8, 9, 11, 12];
/** A mined asteroid yields minerals and metals. */
const ORE = [12, 12, 12, 13, 14];
/** How often the pilot punches out before the hull goes. */
const ESCAPE_CHANCE = { trader: 0.45, other: 0.2 };
/** Seconds the cockpit beams stay lit after a shot. */
export const BEAM_FLASH = 0.12;

export type CombatEvent =
  | SoundEvent
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
const heard = (name: SoundName): CombatEvent => ({ kind: 'sound', name });

/**
 * What hurt the player. Five things can, and this is the whole list — the five
 * `StepHost.applyPlayerDamage` calls in world-step.ts.
 *
 * It exists because the source is a STATIC fact at each of those call sites and
 * was being guessed at afterwards from the size of the number:
 * test/combat-recorder.js classified 0.1-0.221 as a laser, 0.45 as a ram and
 * 1.3 as a missile, which cannot error — only be quietly wrong, as it already
 * was, since the old NPC-vs-NPC amount of 0.11 sat inside that laser window.
 * Any balance change to the ram or the shot roll rewrote the table with no
 * warning. The game knows; now it says.
 *
 * Those three magnitudes are gone with the scale that produced them: what each
 * of the five costs is a row of the inventory in docs/DAMAGE-PATHS.md.
 */
export type DamageSource =
  /** an NPC's gun found you */
  | 'laser'
  /** a missile got past the E.C.M. */
  | 'missile'
  /** a ship flew into you */
  | 'ram'
  /** you flew into the Coriolis */
  | 'station'
  /** a canister broke on the hull */
  | 'cargo';

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
    const laser = laserForView(commander, view);
    if (!laser || !canFire(sys)) return [];
    chargeShot(sys, laser);

    const sounds: CombatEvent[] = [heard('laser')];
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
      sounds.push(heard('hit'));
      // The HIT goes across, exactly as it does to a ship: the canister's own
      // released bank decides whether it breaks up (cargo.ts). Every laser a
      // flyable hull carries still does it in one, so this is the same game —
      // but it is the catalogue saying so rather than a `destroy()` call.
      const broke = this.world.cargo.takeLaserHit(shot.cargo, laser.hit);
      this.world.effects.explosion(shot.cargo.object.position.clone(), 0x8ad0ff,
        broke ? { count: 10, speed: 55, duration: 0.4 }
          : { count: 4, speed: 30, duration: 0.25 });
      if (!broke) return [...sounds, ...out];
      if (shot.cargo.kind === 'capsule') {
        // there is someone in that thing
        out.push(say('ESCAPE CAPSULE DESTROYED', 3), { kind: 'offence', level: FUGITIVE });
      } else {
        out.push(say('CARGO DESTROYED', 2));
      }
      return [...sounds, ...out];
    }

    if (shot.kind === 'station') {
      sounds.push(heard('hit'));
      // sparks off the hull, but the station itself shrugs it off
      const impact = playerPos.clone().addScaledVector(viewDir, shot.distance);
      this.world.effects.explosion(impact, 0xd8ffcc, { count: 10, speed: 60, duration: 0.4 });
      // Offender, not fugitive: a stray shot while lining up a dock is easy to
      // make, and fugitive means every police ship in the galaxy hunts you
      // forever. The Vipers are the real punishment — and shooting *them*
      // escalates you to fugitive the normal way.
      out.push(say('STATION HULL HIT — DEFENCES SCRAMBLING', 3),
        { kind: 'offence', level: OFFENDER });
      return [...sounds, ...out];
    }

    if (shot.kind === 'ship') {
      sounds.push(heard('hit'));
      // impact flash at the target so hits read clearly
      this.world.effects.explosion(shot.ship.object.position.clone(), 0xd8ffcc,
        { count: 8, speed: 70, duration: 0.35 });
      out.push({ kind: 'offence', level: offenceFor(shot.ship.role, false) });
      // The HIT goes across, not the damage: what a hit is worth depends on the
      // target's own defence, immunity and multiplier, and the ship applies its
      // own (npc.ts `takeLaserHit`). A station therefore shrugs this off with no
      // case here, and the Constrictor halves it without the mission knowing.
      if (shot.ship.takeLaserHit(laser.hit, playerPos, true)) {
        // destroy() reports its explosion before its semantic consequences.
        // Keep all sounds ahead of events the Game could only apply after this
        // call returned, matching the pre-extraction observable order.
        for (const event of this.destroy(commander, shot.ship)) {
          if (event.kind === 'sound'
              || event.kind === 'countdown'
              || event.kind === 'dockingMusic') sounds.push(event);
          else out.push(event);
        }
      }
    }
    return [...sounds, ...out];
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
      c.combatScore += killValue(npc.state.threatTier);
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
    if (npc.state.isMissionTarget) {
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
        && !this.world.npcs.some((n) => n.state.alive && n.role === 'thargoid')) {
      for (const t of this.world.npcs) {
        if (t.role === 'thargon') t.state.inert = true;
      }
      out.push(say('THARGONS DEACTIVATED', 3));
    }
    return [heard('explosion'), ...out];
  }

  /**
   * The player takes a hit of `damage` WHOLE POOL POINTS.
   *
   * Only the caller knows which way the ship is pointing, so the direction is
   * resolved here into the one bit the damage model wants: did it come from
   * ahead? And only the caller knows what hit them, which is why the number
   * arrives already finished and already in the commander's own unit: an NPC
   * laser has met the hull's armour once (`gunnery.ts`), and a ram, a canister,
   * the Coriolis wall or a warhead is a stated `IMPACT` (`impact-damage.ts`).
   */
  hitPlayer(
    sys: ShipSystems,
    damage: PlayerPoolPoints,
    from: THREE.Vector3,
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    scratch: CombatScratch,
  ): CombatEvent[] {
    scratch.a.copy(from).sub(playerPos)
      .applyQuaternion(scratch.q.copy(playerQuat).invert());
    const result = applyDamage(sys, damage, scratch.a.z < 0);

    const out: CombatEvent[] = [heard('damage')];
    if (result.wreckedSomething) out.push({ kind: 'breach' });
    if (result.destroyed) out.push({ kind: 'died', reason: 'SHIP DESTROYED' });
    return out;
  }
}

// --- the player's gun and the player's hull, over a state --------------------
//
// `Combat` takes each ingredient separately, deliberately — it is what makes it
// testable, and what lets `destroy()` be handed a different commander. But the
// player's own trigger always wants the same seven arguments and they all come
// out of one GameState, and that assembly was two methods of game.ts built from
// `this`. Here, it is assembly over an argument: the Game passes its state, and
// so can anything else holding one.
//
// Neither applies anything. The caller decides what the events mean — the HUD
// and the law for the Game, a report for a caller that wants the numbers.

/**
 * Pull the player's trigger, in whatever view they are looking through.
 *
 * @param scratch reused across frames; `b` carries the view direction, because
 * `Combat.fire` writes the trace's own working vector into `a`.
 */
export function firePlayerLaser(
  state: GameState, combat: Combat, scratch: CombatScratch,
): CombatEvent[] {
  const { commander, sys, player, session } = state;
  return combat.fire(
    commander, sys, player.position,
    viewDirection(player.quaternion, session.view, scratch.b),
    session.view, session.witchspace, scratch);
}

/**
 * The player takes a hit of `damage` pool points, from `from`.
 *
 * The source of the hit is NOT here: `Combat.hitPlayer` only needs to know
 * whether it came from ahead, and who is attributing the damage is the caller's
 * business — see `DamageSource` and `StepHost.applyPlayerDamage`.
 */
export function damagePlayer(
  state: GameState, combat: Combat, damage: PlayerPoolPoints, from: THREE.Vector3,
  scratch: CombatScratch,
): CombatEvent[] {
  const { sys, player } = state;
  return combat.hitPlayer(sys, damage, from, player.position, player.quaternion, scratch);
}
