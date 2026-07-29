// The human's hands, turned into a FlightDemand.
//
// This is the other half of the seam player.ts opens: a PURE function from
// "what is held down" to "what the pilot wants", so the same ship flies for a
// person, a policy and a replay. It reads no globals, mutates nothing, and
// runs under node — which is why the ramp it applies can finally be asserted
// against the model rather than described in a comment.
//
// The ramp lives HERE rather than in the ship because the ramp belongs to the
// pilot: this one is the classic keyboard-analogue feel (RATE_RAMP up,
// RATE_DECAY down, capped at MAX_ROLL/MAX_PITCH), and the combat computer's
// is deliberately a different one. See FlightDemand.
//
// Mouse DECAY is not done here: `decayMouse` mutates the Input, and a pure
// producer must not. The caller does it, immediately after reading — see
// Game.pilotDemand.
import { keymap } from './keymap.ts';
import { PLAYER_FLIGHT, rampFlightRate, type FlightDemand } from '../player.ts';

/**
 * Just enough of `Input` to fly by — structural, so `Input` satisfies it
 * without knowing this exists, and a test can pass a literal.
 */
export interface FlightControls {
  held(...codes: string[]): boolean;
  readonly mouseFlight: boolean;
  readonly mouseX: number;
  readonly mouseY: number;
  readonly mouseFire: boolean;
}

/** The ramped rates the demand continues from — the ship's own, in practice. */
export interface TurnRates {
  rollRate: number;
  pitchRate: number;
}

/**
 * What the pilot at the keyboard is asking for.
 *
 * @param c    what is held down, and where the mouse is
 * @param from the rates already being flown, which the ramp continues from
 */
export function flightDemand(c: FlightControls, from: TurnRates, dt: number): FlightDemand {
  const keys = keymap(); // classic (1984) by default, modern as a toggle
  let rollIn = (c.held(...keys.rollLeft) ? 1 : 0) - (c.held(...keys.rollRight) ? 1 : 0);
  let pitchIn = (c.held(...keys.pitchUp) ? 1 : 0) - (c.held(...keys.pitchDown) ? 1 : 0);

  // mouse flight: analogue axes, keyboard still overrides when touched
  if (c.mouseFlight) {
    if (rollIn === 0) rollIn = -c.mouseX;
    if (pitchIn === 0) pitchIn = c.mouseY;
  }

  // slash only decelerates unshifted — ? opens the controls guide
  const decelHeld = keys.decel.some((k) =>
    c.held(k) && (k !== 'Slash' || !c.held('ShiftLeft', 'ShiftRight')));

  return {
    rollRate: rampFlightRate(from.rollRate, rollIn * PLAYER_FLIGHT.maxRoll, rollIn !== 0, dt),
    pitchRate: rampFlightRate(from.pitchRate, pitchIn * PLAYER_FLIGHT.maxPitch, pitchIn !== 0, dt),
    throttle: (c.held(...keys.accel) ? 1 : 0) - (decelHeld ? 1 : 0),
    fire: c.held(...keys.fire) || c.mouseFire,
  };
}
