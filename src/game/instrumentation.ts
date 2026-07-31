// Optional, outside-in observation of a live game.
//
// The human-flight combat recorder used to replace Game methods at runtime:
// applyPlayerDamage, fireLaser and update, plus NpcShip.update on its prototype.
// That recorder has since been absorbed by the typed CombatSimRecorder.  This
// small seam keeps the one fact only production can publish — what damaged the
// player — available to future console recorders without making a Game method's
// name, visibility or argument order into an instrumentation API.

import * as THREE from 'three';

import type { DamageSource } from './combat.ts';

/**
 * Events a live-combat recorder may observe.
 *
 * The position is a snapshot owned by the notification. Callers may retain it
 * or mutate it without changing the world or a scratch vector used by the
 * simulation.
 */
export interface CombatObserver {
  onPlayerDamaged?(amount: number, from: THREE.Vector3, source: DamageSource): void;
}

/**
 * The optional observer slot, separate from Game so its no-observer behaviour
 * and the lifetime of a registration can be tested without constructing the
 * renderer, HUD or a world.
 */
export class CombatInstrumentation {
  private observer: CombatObserver | null = null;

  /**
   * Replace the current observer and return a safe disposer for this exact
   * registration. Passing null explicitly disables instrumentation.
   */
  setObserver(observer: CombatObserver | null): () => void {
    this.observer = observer;
    return () => {
      if (this.observer === observer) this.observer = null;
    };
  }

  playerDamaged(amount: number, from: THREE.Vector3, source: DamageSource): void {
    this.observer?.onPlayerDamaged?.(amount, from.clone(), source);
  }
}
