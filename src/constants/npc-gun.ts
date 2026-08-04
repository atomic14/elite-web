// The NPC's gun, as numbers: its reach, the gate it fires through, its cadence
// and the dice that decide whether a shot connects.
//
// A SEPARATE FILE FROM `player-gun.ts`, because they are separate rules. Only
// one number is shared and it is derived here rather than restated; everything
// else is a different mechanism answering a different question — the player's
// gun is a ray through a cone with an assist on it, and this one is a gate, a
// coin and a range curve. A pass that unified the two on the value they happen
// to share is exactly the failure this directory exists to make hard.
//
// These numbers are the balance levers for the game AND the trainer at once.
// They were once mirrored by an `NPC_GUN` in a training simulator, kept in step
// by hand, and were not: the sim handed every ship the player's pulse laser,
// 0.667 damage/second against this gun's 0.041, for six training rounds.
// Training flies `npcTriggerPull` now, so there is one gun and one home for it.

import { LASER_RANGE } from './player-gun.ts';

/**
 * How far an NPC can shoot. The player's reach, and it has to be: a brain
 * trained to open fire at 3000 units was silently refused the shot by a 2600
 * gate, so it sat there pointing straight at the target and never pulled the
 * trigger. Measured before the change, two tier-0 pirates over 45 seconds:
 * pointing at the player 90% of the time, inside 2600 only 51% of it.
 *
 * Written as `LASER_RANGE` rather than as a second 3500 because that is what the
 * comment above has always claimed and nothing enforced. A shorter NPC gun is a
 * deliberate handicap somebody could choose to give — but they would be choosing
 * it here, against the reach this derives from, rather than discovering it.
 */
export const NPC_LASER_RANGE = LASER_RANGE;

/**
 * Time between an NPC's shots. The player's pulse laser reloads in 0.24s; these
 * are the game's deliberate handicap, and they are NOT what limits an NPC's
 * damage. Tested at pulse-laser parity (five times faster): 3.7 shots a minute
 * per ship against the current 4.1, and no difference in damage, because a
 * pirate is only inside the 0.25 rad firing gate for about 5% of a fight. It is
 * not waiting on the cooldown; it is waiting to be aimed at you.
 */
export const NPC_COOLDOWN_LO = 0.9;
export const NPC_COOLDOWN_SPREAD = 0.8;

/** How near the nose a target must be before an NPC pulls the trigger. */
export const NPC_FIRE_GATE = 0.25;

/** Thargoids reload faster than anything else in the galaxy. */
export const THARGOID_FIRE_RATE = 0.7;

/** Hit chance falls off with range, clamped at both ends. */
export const NPC_HIT_BASE = 0.9;
/**
 * A DENOMINATOR, NOT A REACH — and the fact that it is a third 3,500 in this
 * subject is UNRESOLVED. It stays a literal deliberately.
 *
 * What is certain is that nothing happens at 3,500. `0.9 - d/3500` meets
 * `NPC_HIT_FLOOR` at d = 2,625, so the curve is already flat over the last 25%
 * of the gun's reach and the denominator is only the slope.
 *
 * What the history says (initial commit `3592b30`): the expression was inline in
 * game.ts as `Math.min(0.85, Math.max(0.15, 0.9 - dist / 3500))`, and at that
 * moment the NPC's own firing gate was `dist < 2600`. So the denominator was NOT
 * the NPC gun's reach when it was chosen. Two readings survive and they want
 * opposite things if the reach ever moves:
 *
 *   - it was the player's `LASER_RANGE`, the one 3,500 in scope in that file.
 *     Then it is the same rule as `NPC_LASER_RANGE`, and lines up with it today
 *     only because the NPC's gate was later raised to meet the player's.
 *   - it was shaped so the curve bottoms out at the edge of the NPC's own gun:
 *     0.75 x 3500 = 2,625 against a gate of 2,600, which is tight enough to be
 *     a choice. Then the honest expression is `NPC_LASER_RANGE / 0.75`, which
 *     today is 4,667 — a behaviour change, not a refactor.
 *
 * Writing `= NPC_LASER_RANGE` would assert the first and silently overrule the
 * second, and the reviewer who moved these constants could not establish which
 * is true. Settling it is a balance decision with a measurement attached.
 */
export const NPC_HIT_FALLOFF = 3500;
export const NPC_HIT_CAP = 0.85;
export const NPC_HIT_FLOOR = 0.15;

/**
 * Whether one ship's shot at another connects: a coin flip, and Harmless's.
 *
 * There is no damage constant beside it. What a crossfire hit is WORTH is
 * `npcCrossfireDamage` in npc-energy.ts — the firing build's own laser strength
 * against the target's own defence — where it used to be a flat 0.11 on the
 * pre-parity normalized scale that made a Thargoid's gun and a Worm's identical.
 * Whether it lands stays a die roll, exactly as the player-facing gun's does.
 */
export const NPC_VS_NPC_HIT = 0.5;
