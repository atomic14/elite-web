// Ordnance, as numbers: the warhead, the E.C.M. and the energy bomb — every
// value that is not the laser's.
//
// Both halves of a missile are here, and that is one subject rather than two.
// The code splits them because they are different KINDS of thing — a decision
// (`game/missile-launch.ts`, pure, testable without a world) and a simulation
// (`game/ordnance.ts`, a warhead in a sky) — but the numbers are one weapon's
// envelope: the range it will launch inside, the speed and turn it flies at, and
// the countermeasure that answers it. A reader asking "what governs a missile"
// should not have to know which side of that seam a value fell on.
//
// The E.C.M. and the bomb are here for the same reason gunnery and ordnance were
// ever one word: they are what a warhead is answered with.

import { ENERGY_BANK_POINTS } from './pools.ts';

// --- a warhead in flight -----------------------------------------------------

/** Missile flight speed, world units per second. */
export const MISSILE_SPEED = 700;
/** How long a missile lives before it gives up and detonates. */
export const MISSILE_LIFE = 25;
/** A hostile missile lives longer — it has further to come. */
export const HOSTILE_MISSILE_LIFE = 30;
/** Turn rate while homing, radians per second. */
export const MISSILE_TURN = 2.5;
/** Close enough to detonate. */
export const MISSILE_HIT_RANGE = 50;

/** Lock cone: how near the crosshair a ship must be to be locked. */
export const LOCK_CONE = 0.09;
/** ...and how far away it may be. */
export const LOCK_RANGE = 5500;

// --- when one leaves the rail ------------------------------------------------

/**
 * The far edge of the seeker's envelope — beyond this a missile is thrown away.
 *
 * There used to be a MIN of 1200 and a CHANCE of 0.3 beside it, and together
 * they made a standoff weapon: a ship 1,200 to 3,200 out rolled 30% to send a
 * missile instead of a bolt, so the launch window was exactly the range at
 * which nothing was engaging. See `npcMissileEmergency` for what that did to a
 * wave-13 fight and why both are gone. The inner edge is now
 * `MISSILE_LAST_STAND_MIN_RANGE` for every launch rather than only desperate
 * ones, because the reason it exists — an undodgeable weapon is not a fight —
 * was never specific to desperation.
 */
export const MISSILE_MAX_RANGE = 3200;
/**
 * Hull fraction below which a ship stops saving its missiles for later.
 *
 * A pirate used to go down with them still on the rail, because the only way one
 * ever left was the opportunistic roll above — which fires at the moment the
 * ship takes a LASER shot, and a nearly-dead pirate is usually not lined up
 * enough to be taking one. A missile it never launches is worth nothing.
 */
export const MISSILE_LAST_STAND_HULL = 0.4;
/**
 * ...and it launches on a bearing rather than a firing line. A missile homes, so
 * the only reason to ask for any aim is that it leaves the nose: the target has
 * to be in the half of the sky the ship points at. Compare NPC_FIRE_GATE.
 */
export const MISSILE_LAST_STAND_GATE = Math.PI / 2;
/**
 * Desperation widens the envelope INWARD — the knife-range launch a pirate would
 * never waste a missile on is the only one left — but not all the way: inside
 * this the missile arrives before the player can reach the E.C.M. or turn, and
 * an undodgeable weapon is not a fight.
 */
export const MISSILE_LAST_STAND_MIN_RANGE = 250;
/** Gap between launches, so a Python does not empty both rails in one frame. */
export const MISSILE_RELOAD = 2;

/**
 * How many passes a ship makes before it accepts this is not going its way.
 *
 * Chris: "missiles are expensive, they should be used in emergencies — e.g.
 * when your opponent turns out to be tougher than you thought." Two of them
 * IS that discovery: it has committed twice, put its guns on the target twice,
 * and the target is still there.
 */
export const MISSILE_COMMIT_PASSES = 2;

// --- what answers one --------------------------------------------------------

/** An E.C.M.-equipped target fries incoming missiles inside this. */
export const ECM_RANGE = 2800;
/** ...at this chance per second. */
export const ECM_RATE = 0.45;
/**
 * Firing the E.C.M. costs one bank of energy.
 *
 * Exactly what the literal `1` bought when the bank held 4 points, read off the
 * pools rather than restated so that growing them could not quietly make the
 * E.C.M. free. It was `Math.round(MAX_ENERGY / 4)` — which is `LOW_ENERGY`'s own
 * expression written a second time with the `4` left unnamed. Both were 64, both
 * meant "a quarter of the pool", and only one of them would have followed if
 * `ENERGY_BANKS` moved. The console's promise is that the gauge, the ENERGY LOW
 * warning and the shield cut-off move together; a burst has always cost one of
 * the banks the console draws, so it is the fourth thing that has to move too.
 */
export const ECM_ENERGY_COST = ENERGY_BANK_POINTS;

/** The energy bomb reaches this far. */
export const ENERGY_BOMB_RANGE = 8000;
