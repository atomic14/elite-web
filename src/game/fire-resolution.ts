// A ship pulled its trigger: what happens.
//
// Invariant 15 splits the world in half — *NPCs return `FireEvent`s; the Game
// resolves all consequences* — and there are two Games: `world-step.ts` for the
// sky and `ai-training/scenario.ts` for a training episode. So the decision half
// had one home each (`NpcShip`, `gunnery.ts`, `collisions.ts`, `rng.ts`) and the
// RESOLUTION half had two, kept in step by hope. Four divergences were found one
// at a time, none of them chosen and none of them reported by anything:
// docs/TODO/62, docs/TODO/63, docs/TODO/73, and this file's own reason for
// existing — the laser's dice, its damage and the shield face it lands on.
//
// This is the rule. Spending a round, rolling whether a bolt connects, choosing
// what it is worth and pushing it into the target are the four things that
// decide a fight; a tracer, a bolt's sound and an explosion are what a fight
// looks like. THE SPLIT IS THE WHOLE DESIGN: everything below the line is here,
// everything above it stays with the caller, and neither caller may keep a copy
// of anything below.
//
// The seam is the one this codebase has used three times now — `engine/shell.ts`
// for the platform, `StepHost` for the orchestrator, `OrdnanceWorld` as of
// docs/TODO/62 — a narrow interface each side implements, with the rules above
// it in one file both call. It is deliberately NOT "the Game": `resolveNpcFire`
// used to reach for tracers, sounds, the station, despawn and the commander's
// equipment, and an episode has none of those. `FireWorld` is four members, and
// a test implements it in ten lines.
//
// WHAT IT REPORTS is a measurement, never an instruction: the caller counts the
// shot, draws the bolt and says it out loud, and a caller that wants none of
// those drops the value. Same bargain as `DealtEvent` and `OrdnanceOutcome`.

import type * as THREE from 'three';

import { NPC_VS_NPC_HIT } from '../constants/npc-gun.ts';
import { npcHitChance, npcLaserDamageToPlayer } from './gunnery.ts';
import { npcCrossfireDamage } from './npc-energy.ts';
import type { PlayerPoolPoints } from './damage-units.ts';
import type { FireEvent, NpcShip } from './npc.ts';
import { launchNpcMissile, type Ordnance, type OrdnanceOutcome } from './ordnance.ts';
import { random } from './rng.ts';
import type { PlayerHullId } from './ship-identity.ts';

/**
 * The ship an NPC is shooting AT, as much of one as a resolved shot needs.
 *
 * The commander in the sky, the episode's target in a training run — and the
 * only two things either has to be able to say are which hull it IS, because
 * that is the armour an NPC laser meets once (`gunnery.ts`), and where it is,
 * because that is the range the dice are rolled against.
 *
 * `damage()` is the seam and not the rule: WHICH pool a hit spends is
 * `shield-face.ts` and `systems.ts`, which both sides already run; what differs
 * is that the game also flashes the console, attributes the source and can end
 * the run, and an episode does none of that.
 */
export interface FireTarget {
  /** which of the flyable hulls it is — its per-hit armour and its pools */
  readonly hullId: PlayerHullId;
  /** where it is, for the range the hit curve reads */
  readonly pos: THREE.Vector3;
  /** it took `damage` finished pool points, from `from` */
  damage(damage: PlayerPoolPoints, from: THREE.Vector3): void;
}

/** The sky a resolved shot needs: something to shoot at, and somewhere to put a warhead. */
export interface FireWorld {
  readonly target: FireTarget;
  /** where a launched round goes — `ordnance.ts`, over either side's own sky */
  readonly ordnance: Ordnance;
  /**
   * An NPC shot another NPC out of the sky.
   *
   * WRECKED, never destroyed: nobody is credited for a fight they watched, and
   * an episode has no bounty to pay at all.
   */
  wreck(npc: NpcShip): void;
}

/**
 * What the shot DID — for a tracer, a tally, or nothing.
 *
 * The three cases are the three the `FireEvent` union already has, so a caller
 * that handles them all handles every shot the game can produce.
 */
export type NpcShot =
  /** a round left the rail: the rack is spent and the warhead is flying */
  | { weapon: 'missile'; launch: OrdnanceOutcome }
  /** a bolt at the ship being hunted, and what it cost her pools */
  | { weapon: 'laser'; at: 'target'; range: number; hit: boolean; damage: number }
  /** a bolt at another ship, and what came off its bank */
  | { weapon: 'laser'; at: NpcShip; hit: boolean; damage: number; destroyed: boolean };

/**
 * Resolve one `FireEvent`. The ship chose the weapon; this rolls the dice.
 *
 * THE ORDER OF THE DRAWS IS LOAD-BEARING and unchanged from the step this came
 * out of: the hit roll first and alone, then whatever the damage itself draws
 * (`applyDamage`'s one equipment roll, and a breach behind it). A caller that
 * wants randomness of its own — the game scatters a missed bolt so the tracer
 * goes wide — takes it AFTER this returns, or every seeded outcome in the
 * project moves (game/rng.ts).
 *
 * The range is measured here rather than passed in, because a range measured by
 * the caller is exactly how these two resolvers came to disagree: the step took
 * it after the ship had moved and the episode took it before.
 */
export function resolveNpcFire(
  npc: NpcShip, event: FireEvent, world: FireWorld,
): NpcShot {
  if (event.at === 'player') {
    // The SHIP chose the weapon (npc.ts `chooseWeapon`); "spend the round, put
    // it in the sky" is ordnance.ts's, and was the first slice of this file to
    // have one home (docs/TODO/62).
    if (event.weapon === 'missile') {
      return { weapon: 'missile', launch: launchNpcMissile(npc, world.ordnance) };
    }
    const range = npc.object.position.distanceTo(world.target.pos);
    const hit = random() < npcHitChance(range);
    if (!hit) return { weapon: 'laser', at: 'target', range, hit, damage: 0 };
    // WHETHER it lands is Harmless's dice, above; what it is WORTH is the
    // released game's, and it is not rolled at all. The firing ship's exact
    // build supplies the laser power and the target hull supplies the armour it
    // comes off — see gunnery.ts. A build whose power cannot beat that armour
    // still connects, still flashes and still costs nothing, which is what the
    // pack's zero rows say.
    const damage = npcLaserDamageToPlayer(npc.weaponByte, world.target.hullId);
    world.target.damage(damage, npc.object.position);
    return { weapon: 'laser', at: 'target', range, hit, damage };
  }

  // NPC shooting NPC. One flat chance rather than the range curve, because
  // crossfire is scenery a player watches rather than a fight they are in.
  const victim = event.at;
  if (random() >= NPC_VS_NPC_HIT) {
    return { weapon: 'laser', at: victim, hit: false, damage: 0, destroyed: false };
  }
  // WHAT A CROSSFIRE HIT IS WORTH is the same oracle the two player-facing
  // directions use: the FIRING ship's own laser strength against the TARGET's
  // own defence (`npcCrossfireDamage`).
  const points = npcCrossfireDamage(npc.weaponByte, victim.energyPolicy);
  const before = victim.state.energy;
  const destroyed = victim.takeDamage(points, npc.object.position);
  if (destroyed) world.wreck(victim);
  // What came OFF the bank, not what was spent on it — the same measurement
  // `dealToNpc` reports, so the two are comparable.
  return {
    weapon: 'laser', at: victim, hit: true,
    damage: before - victim.state.energy, destroyed,
  };
}
