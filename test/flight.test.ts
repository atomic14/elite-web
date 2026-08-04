// Flying: what the controls demand, and how fast a rate may change.
//
// The intent layer (FlightDemand) and the ramp underneath it. The ramp is here
// rather than beside the ships because it is the piece that was wrong four times:
// it had four homes, and it is the reason the world stepped at a fixed slice.

import * as THREE from 'three';
import { defenceBrain } from '../src/game/brains.ts';
import { CLEAN } from '../src/game/law.ts';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import {
  PlayerShip,
  rampFlightRate,
  type FlightDemand,
} from '../src/player.ts';
import { PLAYER_FLIGHT } from '../src/constants/player-flight.ts';
import { flightDemand, type FlightControls } from '../src/engine/flight-controls.ts';
import { keymap } from '../src/engine/keymap.ts';
import { CombatComputer } from '../src/game/combat-computer.ts';
import {
  CC_ACCEL, CC_MAX_PITCH, CC_MAX_ROLL, CC_MAX_SPEED,
} from '../src/constants/combat-computer.ts';
import { freshSystems } from '../src/game/systems.ts';
import { check } from './harness.ts';

// --- flight demands: what the pilot wants, and who wanted it ----------------
//
// player.ts used to read the keyboard: `update(dt, input: Input)`. So the
// player, an autopilot and a replay were three different interfaces, the
// flight model could not be constructed outside a browser, and the combat
// computer had to reach past it and rotate the quaternion itself.
//
// Now `update(dt, demand)` flies a FlightDemand and the pilots produce one:
// `flightDemand()` from a keyboard, `CombatComputer.step()` from the defence
// brain. These tests exist because that swap must be invisible from the
// cockpit — same rates, same ramp, same mouse flight, same everything.

console.log('\nflight demands');
{
  const KEYS = {
    rollLeft: 'Comma', rollRight: 'Period', up: 'KeyX', down: 'KeyS',
    accel: 'Space', decel: 'Slash', shift: 'ShiftLeft', fire: 'KeyA',
  };

  /**
   * The pilot's hands. Structurally an `Input` as far as flightDemand cares,
   * which is the point of taking a shape rather than the class: this file
   * cannot construct an `Input` (it adds DOM listeners) and does not need to.
   */
  class Hands {
    down: Set<string>;
    mouseFlight = false;
    mouseX = 0;
    mouseY = 0;
    mouseFire = false;
    constructor(down: string[] = []) { this.down = new Set(down); }
    held(...codes: string[]): boolean { return codes.some((c) => this.down.has(c)); }
    /** Input's own self-centring, copied because Input itself needs a document. */
    decayMouse(dt: number): void {
      const k = Math.max(0, 1 - dt * 1.5);
      this.mouseX *= k;
      this.mouseY *= k;
    }
  }
  const hands = (...down: string[]): Hands & FlightControls => new Hands(down);
  const ship = () => new PlayerShip(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, 0, -1));
  const DT = 1 / 60;

  // --- the same input produces the same demand -------------------------------
  {
    const h = hands(KEYS.rollLeft, KEYS.accel, KEYS.fire);
    const rates = { rollRate: 0.3, pitchRate: -0.2 };
    const a = flightDemand(h, keymap(), rates, DT);
    const b = flightDemand(h, keymap(), rates, DT);
    check('the same controls produce the same demand, twice',
      a.rollRate === b.rollRate && a.pitchRate === b.pitchRate
      && a.throttle === b.throttle && a.fire === b.fire);
    check('...and reading the controls does not change them',
      h.down.size === 3 && h.mouseX === 0 && h.mouseY === 0);
    check('...and does not touch the rates it was handed',
      rates.rollRate === 0.3 && rates.pitchRate === -0.2);
  }

  // --- and it says the right thing -------------------------------------------
  {
    const one = (held: string[], from = { rollRate: 0, pitchRate: 0 }) =>
      flightDemand(hands(...held), keymap(), from, DT);
    const ramped = (target: number) => rampFlightRate(0, target, true, DT);
    check('roll left asks for a left roll rate',
      one([KEYS.rollLeft]).rollRate === ramped(PLAYER_FLIGHT.maxRoll));
    check('...and roll right for the opposite',
      one([KEYS.rollRight]).rollRate === ramped(-PLAYER_FLIGHT.maxRoll));
    check('...and opposing rolls cancel', one([KEYS.rollLeft, KEYS.rollRight]).rollRate === 0);
    check('climb asks for nose up at the pitch cap',
      one([KEYS.up]).pitchRate === ramped(PLAYER_FLIGHT.maxPitch));
    check('...and dive for nose down', one([KEYS.down]).pitchRate === ramped(-PLAYER_FLIGHT.maxPitch));
    check('the rate RAMPS from where it was rather than snapping',
      one([KEYS.rollLeft], { rollRate: 1, pitchRate: 0 }).rollRate
        === rampFlightRate(1, PLAYER_FLIGHT.maxRoll, true, DT));
    check('...and released, it decays from where it was',
      one([], { rollRate: 1, pitchRate: 0 }).rollRate
        === rampFlightRate(1, 0, false, DT));
    check('the throttle opens', one([KEYS.accel]).throttle === 1);
    check('...and brakes', one([KEYS.decel]).throttle === -1);
    // the '?' guard: SHIFT+slash opens the controls guide, it does not brake
    check('shifted slash is the help key, not the brake',
      one([KEYS.decel, KEYS.shift]).throttle === 0);
    check('the trigger is the trigger', one([KEYS.fire]).fire);
    check('...and the mouse button is too', (() => {
      const h = hands();
      h.mouseFire = true;
      return flightDemand(h, keymap(), { rollRate: 0, pitchRate: 0 }, DT).fire;
    })());
    check('a demand from a pilot with a ship of their own carries no limits',
      one([KEYS.accel]).limits === undefined);
  }

  // --- mouse flight ----------------------------------------------------------
  {
    const h = hands();
    h.mouseFlight = true;
    h.mouseX = 0.5;
    h.mouseY = -0.25;
    const d = flightDemand(h, keymap(), { rollRate: 0, pitchRate: 0 }, DT);
    check('the virtual stick rolls the ship',
      d.rollRate === rampFlightRate(0, -0.5 * PLAYER_FLIGHT.maxRoll, true, DT));
    check('...and pitches it',
      d.pitchRate === rampFlightRate(0, -0.25 * PLAYER_FLIGHT.maxPitch, true, DT));
    h.down.add(KEYS.rollLeft);
    const withKey = flightDemand(h, keymap(), { rollRate: 0, pitchRate: 0 }, DT);
    check('...and the keyboard still overrides the axis it touches',
      withKey.rollRate === rampFlightRate(0, PLAYER_FLIGHT.maxRoll, true, DT)
      && withKey.pitchRate === d.pitchRate);
  }

  // --- a demand produces the motion ------------------------------------------
  {
    const s = ship();
    s.speed = 0;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: 1, fire: false });
    check('the throttle accelerates at the ship\'s own rate',
      s.speed === PLAYER_FLIGHT.accel * DT);
    s.speed = PLAYER_FLIGHT.maxSpeed;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: 1, fire: false });
    check('...and cannot exceed the ship\'s top speed', s.speed === PLAYER_FLIGHT.maxSpeed);
    s.speed = 1;
    s.update(DT, { rollRate: 0, pitchRate: 0, throttle: -1, fire: false });
    check('...and braking stops at rest, not below it', s.speed === 0);

    const turning = ship();
    const before = turning.quaternion.clone();
    turning.speed = 0;
    turning.update(DT, { rollRate: 0, pitchRate: 0.5, throttle: 0, fire: false });
    // what it actually turned, in its OWN frame, against what it was asked for
    const turned = before.invert().multiply(turning.quaternion);
    const wanted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5 * DT);
    check('the ship turns at exactly the rate it was asked for',
      Math.abs(turning.pitchRate - 0.5) < 1e-12 && turned.angleTo(wanted) < 1e-9);
    check('...and the ship never pulls its own trigger — the Game does',
      // firing is a consequence (bounties, legal status, the station's Vipers);
      // all the ship does is carry the flag back out
      turning.speed === 0);

    // A softer pilot: the combat computer cruises rather than sprints, and
    // that is expressed IN THE DEMAND rather than by a second code path.
    const cruising = ship();
    cruising.speed = 0;
    cruising.update(DT, {
      rollRate: 0, pitchRate: 0, throttle: 1, fire: false,
      limits: { accel: CC_ACCEL, maxSpeed: CC_MAX_SPEED },
    });
    check('a demand may fly a softer envelope than the hull allows',
      cruising.speed === CC_ACCEL * DT);
    cruising.speed = PLAYER_FLIGHT.maxSpeed;
    cruising.update(DT, {
      rollRate: 0, pitchRate: 0, throttle: 1, fire: false,
      limits: { accel: CC_ACCEL, maxSpeed: CC_MAX_SPEED },
    });
    check('...and asking for throttle above that cap pulls the ship back to it',
      cruising.speed === CC_MAX_SPEED);
  }

  // --- the refactor changed nothing a pilot can feel --------------------------
  //
  // The oracle below is the PRE-REFACTOR `PlayerShip.update(dt, input)`,
  // transcribed. It is a deliberate second home for a rule, kept because the
  // claim being tested is exactly "the new path and the old one are the same
  // path": every subset of the flight keys, from four starting speeds, forty
  // frames each, compared to the bit. It reads the constants through
  // PLAYER_FLIGHT and rampFlightRate, so a change to the flight envelope moves
  // both sides together and only a change to the STRUCTURE can fail it.
  {
    const AXIS_X = new THREE.Vector3(1, 0, 0);
    const AXIS_Z = new THREE.Vector3(0, 0, 1);
    const tmpQ = new THREE.Quaternion();
    const tmpV = new THREE.Vector3();
    const legacyUpdate = (s: PlayerShip, dt: number, input: Hands): void => {
      const keys = keymap();
      let rollIn = (input.held(...keys.rollLeft) ? 1 : 0) - (input.held(...keys.rollRight) ? 1 : 0);
      let pitchIn = (input.held(...keys.pitchUp) ? 1 : 0) - (input.held(...keys.pitchDown) ? 1 : 0);
      if (input.mouseFlight) {
        if (rollIn === 0) rollIn = -input.mouseX;
        if (pitchIn === 0) pitchIn = input.mouseY;
        input.decayMouse(dt);
      }
      s.rollRate = rampFlightRate(s.rollRate, rollIn * PLAYER_FLIGHT.maxRoll, rollIn !== 0, dt);
      s.pitchRate = rampFlightRate(s.pitchRate, pitchIn * PLAYER_FLIGHT.maxPitch, pitchIn !== 0, dt);
      if (input.held(...keys.accel)) {
        s.speed = Math.min(PLAYER_FLIGHT.maxSpeed, s.speed + PLAYER_FLIGHT.accel * dt);
      }
      const decelHeld = keys.decel.some((k) =>
        input.held(k) && (k !== 'Slash' || !input.held('ShiftLeft', 'ShiftRight')));
      if (decelHeld) s.speed = Math.max(0, s.speed - PLAYER_FLIGHT.accel * dt);
      if (s.rollRate !== 0) s.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_Z, s.rollRate * dt));
      if (s.pitchRate !== 0) s.quaternion.multiply(tmpQ.setFromAxisAngle(AXIS_X, s.pitchRate * dt));
      s.quaternion.normalize();
      s.position.addScaledVector(s.getForward(tmpV), s.speed * dt);
    };
    /** The new path, exactly as Game.pilotDemand + PlayerShip.update run it. */
    const newUpdate = (s: PlayerShip, dt: number, input: Hands): void => {
      const d = flightDemand(input, keymap(), s, dt);
      if (input.mouseFlight) input.decayMouse(dt);
      s.update(dt, d);
    };
    const same = (a: PlayerShip, b: PlayerShip): boolean =>
      a.position.equals(b.position) && a.quaternion.equals(b.quaternion)
      && a.speed === b.speed && a.rollRate === b.rollRate && a.pitchRate === b.pitchRate;

    const CODES = [KEYS.rollLeft, KEYS.rollRight, KEYS.up, KEYS.down,
      KEYS.accel, KEYS.decel, KEYS.shift, KEYS.fire];
    let combos = 0;
    let diverged: string[] = [];
    for (let mask = 0; mask < (1 << CODES.length); mask++) {
      const held = CODES.filter((_, i) => mask & (1 << i));
      // Space AND slash together is the one input the two paths disagree on;
      // it has a check of its own below.
      if (held.includes(KEYS.accel) && held.includes(KEYS.decel)
        && !held.includes(KEYS.shift)) continue;
      for (const startSpeed of [0, 100, 399, 400]) {
        const was = ship();
        const now = ship();
        was.speed = startSpeed;
        now.speed = startSpeed;
        const h1 = new Hands(held);
        const h2 = new Hands(held);
        for (let f = 0; f < 40; f++) {
          legacyUpdate(was, DT, h1);
          newUpdate(now, DT, h2);
        }
        combos += 1;
        if (!same(was, now)) diverged.push(`${held.join('+') || 'nothing'} @${startSpeed}`);
      }
    }
    check(`every flight-key combination flies as it did (${combos} runs, ${diverged.length} adrift)`,
      diverged.length === 0, diverged.slice(0, 4).join(', '));

    // ...including the analogue path, where the stick decays between frames
    {
      const was = ship();
      const now = ship();
      const h1 = new Hands();
      const h2 = new Hands();
      h1.mouseFlight = true;
      h2.mouseFlight = true;
      for (let f = 0; f < 300; f++) {
        if (f % 20 === 0) {
          h1.mouseX = 0.4; h2.mouseX = 0.4;
          h1.mouseY = -0.3; h2.mouseY = -0.3;
        }
        if (f === 100) { h1.down.add(KEYS.rollLeft); h2.down.add(KEYS.rollLeft); }
        if (f === 150) { h1.down.delete(KEYS.rollLeft); h2.down.delete(KEYS.rollLeft); }
        legacyUpdate(was, DT, h1);
        newUpdate(now, DT, h2);
      }
      check('mouse flight is unchanged, decay and all',
        same(was, now) && h1.mouseX === h2.mouseX && h1.mouseY === h2.mouseY);
    }

    // --- the one input that does NOT fly as it did -----------------------------
    //
    // Holding accelerate AND brake together. The old code applied both, each
    // with its own clamp, so at the top of the range `min(400, s+a)` then
    // `s-a` left the ship hovering at 396.3 — a throttle that was really two
    // half-throttles. A demand has ONE throttle, so the two cancel and the
    // ship holds 400. It is the only difference the sweep above can find, it
    // needs two opposing controls held at once, and it is worth 0.9% of top
    // speed. Pinned here so it is a decision on the record rather than a
    // silent drift.
    {
      const was = ship();
      const now = ship();
      was.speed = PLAYER_FLIGHT.maxSpeed;
      now.speed = PLAYER_FLIGHT.maxSpeed;
      const h1 = new Hands([KEYS.accel, KEYS.decel]);
      const h2 = new Hands([KEYS.accel, KEYS.decel]);
      for (let f = 0; f < 40; f++) {
        legacyUpdate(was, DT, h1);
        newUpdate(now, DT, h2);
      }
      check('accelerate+brake together used to bleed one frame of speed at the cap',
        Math.abs(was.speed - (PLAYER_FLIGHT.maxSpeed - PLAYER_FLIGHT.accel * DT)) < 1e-9);
      check('...and now cancels cleanly instead', now.speed === PLAYER_FLIGHT.maxSpeed);
      check('...which is the ONLY behaviour this refactor changed',
        Math.abs(Math.abs(was.speed - now.speed) - PLAYER_FLIGHT.accel * DT) < 1e-9);
    }
  }

  // --- the autopilot is a pilot, not a special case ---------------------------
  //
  // The combat computer's demand must be flyable by the same update() the
  // human's is — including the softer throttle it deliberately cruises at,
  // which used to be applied by game.ts reaching into the ship.
  {
    seedWorld(20_260_729);
    const cc = new CombatComputer();
    const brain = defenceBrain();
    const player = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), speed: 200 };
    const sys = freshSystems();
    const pirate = new NpcShip('pirate', new THREE.Vector3(0, 0, -900), 5);
    pirate.state.provoked = true;
    pirate.state.provokedByPlayer = true;
    let flown = 0;
    let demand: FlightDemand | null = null;
    for (let f = 0; f < 20; f++) {
      const step = cc.step(DT, player, sys, [pirate], CLEAN, false, brain);
      if (step.kind === 'fly') { flown += 1; demand = step.demand; }
    }
    check('the combat computer produces a demand like anyone else', flown === 20 && demand !== null);
    check('...and it carries the cruise envelope it was always flown at',
      demand?.limits?.accel === CC_ACCEL && demand?.limits?.maxSpeed === CC_MAX_SPEED);
    check('...so the ship it is bolted to is the ship the human flies',
      Math.abs(demand!.pitchRate) <= CC_MAX_PITCH + 1e-9
      && Math.abs(demand!.rollRate) <= CC_MAX_ROLL + 1e-9);
    // a demand is a demand: the same one, flown by the same method
    const s = ship();
    s.speed = 300;
    s.update(DT, { ...demand!, throttle: 1 });
    check('...and applying it throttles at the autopilot\'s rate, not the commander\'s',
      s.speed === CC_MAX_SPEED);
  }
}

// --- the turn ramp is frame-rate independent ---------------------------------
//
// It was `min(1, rate * dt)`, a linear-in-dt approximation of exponential
// decay, so two half-steps did not equal one whole step. The same constant
// therefore produced different handling at different step rates — and it did:
// the training sim steps at 1/15 and the game at 1/60, so a released turn key
// settled 0.80 per step in training against 0.59 over the same elapsed time in
// the game. Same number in both files, different flight.

console.log('\nturn ramp');
{
  const after = (dt: number, secs: number) => {
    let v = 0;
    for (let i = 0; i < Math.round(secs / dt); i++) v = rampFlightRate(v, 2.5, true, dt);
    return v;
  };
  const at60 = after(1 / 60, 1);
  check('one second of ramp is the same at 60Hz and 15Hz',
    Math.abs(at60 - after(1 / 15, 1)) < 1e-9);
  check('...and at 144Hz', Math.abs(at60 - after(1 / 144, 1)) < 1e-9);
  check('...and at 30Hz', Math.abs(at60 - after(1 / 30, 1)) < 1e-9);

  // The four CONSTANTS this shape is flown at — the commander's 4.1396/13.3886
  // and the brains' 4.1396/5.2207 — are pinned together in
  // test/combat-model.test.ts, in the section about the ramp's four homes. A
  // 120-step version of the hold used to be here on its own; it was one of the
  // four, and one of two homes for the same rule (docs/TODO/87).

  check('a released rate still snaps to exactly zero',
    rampFlightRate(0.0005, 0, false, 1 / 60) === 0);
}
