// One combat model: the trainer flies the game, not a copy of it.
//
// Invariant 5, enforced. src/ai-training/core.ts used to be a second physics
// implementation with its own numbers, kept in step by hope; it is deleted, and
// these tests are what stop it growing back. The arena block measures the player's
// flight envelope, which is the input scenario.ts fits its target hulls to.

import * as THREE from 'three';
import { existsSync } from 'node:fs';
import {
  npcHitChance, NPC_HIT_CAP, NPC_HIT_FLOOR,
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE, NPC_LASER_RANGE,
} from '../src/game/gunnery.ts';
import { seedWorld } from '../src/game/rng.ts';
import {
  NpcShip,
  MIN_CRUISE_FRACTION,
  BRAIN_RATE_RAMP,
  BRAIN_RATE_DECAY,
} from '../src/game/npc.ts';
import { PLAYER_SPEED_KEPT, NPC_SPEED_KEPT } from '../src/game/collisions.ts';
import { IMPACT } from '../src/game/impact-damage.ts';
import { shipTargetRadius } from '../src/ships/registry.ts';
import {
  SPECS,
  type NpcSpec,
  TURN,
  ACCEL_FRACTION,
  shipAccel,
} from '../src/game/ship-specs.ts';
import { PlayerShip, PLAYER_FLIGHT, rampFlightRate, rampToward } from '../src/player.ts';
import { ccRamp, CC_MAX_PITCH, CC_MAX_ROLL } from '../src/game/combat-computer.ts';
import { shipDesignIdOf } from '../src/game/ship-identity.ts';
import { npcMaxEnergy } from '../src/game/npc-energy.ts';
import { Episode } from '../src/ai-training/scenario.ts';
import { check } from './harness.ts';
import { shippedPirate } from './fixtures.ts';

// --- one combat model, and the trainer flies it -----------------------------
//
// WHAT WAS HERE: about twenty checks comparing `src/ai-training/core.ts` to
// `src/game/{npc,gunnery,collisions}.ts` and `src/player.ts`, field by field —
// laser damage, cooldown, heat and range, the NPC gun's gate, cadence and hit
// curve, ram damage, the speed floor, per-hull hp/speed/turn/radius, two rate
// ramps and two decays. They existed because the combat model was written
// twice, and they were worth having: the block caught an NPC gun firing 5.4x
// too fast, an `accel: 120` against the player's real 220, and a turn decay
// that had drifted 35% at the two files' respective step rates.
//
// The duplication is gone. `ai-training/core.ts` is deleted and a training
// episode flies `NpcShip`, `PlayerShip`, `gunnery.ts`, `collisions.ts` and
// `rng.ts` — the game itself, with the sky emptied. A check that a number
// equals itself is not a test, so these checks are not replaced by other
// checks; they are replaced by there being one number.
//
// What survives is a different question, and a better one: does the trainer
// really fly the game? That is a property of the code now rather than of a
// promise in CLAUDE.md, and this is where it is asserted.

console.log('\none combat model (the trainer flies the game)');
{
  check('the parallel simulator is gone',
    !existsSync(new URL('../src/ai-training/core.ts', import.meta.url)));

  // 1. The target in a training episode IS the commander's ship.
  //
  // The old simulator modelled it as `CLASSES.playerCobra`, a hand-copied row
  // whose accel said 120 against the real 220 for every brain up to generation
  // 1, and whose roll cap was turnRate x TURN.roll = 2.4864 against the
  // player's 2.5. Both were REPORTED by this block and neither could be fixed
  // by it. There is nothing to copy now — the hull reads PLAYER_FLIGHT — so
  // this asserts the reading, once.
  const playerEp = new Episode({
    seed: 11, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    traderClass: 'playerCobra',
  });
  const hull = playerEp.trader.hull;
  check(`training target flies the player's envelope: speed ${hull.maxSpeed},`
    + ` accel ${hull.accel}, pitch ${hull.maxPitch}, roll ${hull.maxRoll}`,
  hull.maxSpeed === PLAYER_FLIGHT.maxSpeed && hull.accel === PLAYER_FLIGHT.accel
    && hull.maxPitch === PLAYER_FLIGHT.maxPitch && hull.maxRoll === PLAYER_FLIGHT.maxRoll);
  check('...ramping and decaying at the player\'s rates',
    hull.rateRamp === PLAYER_FLIGHT.rateRamp && hull.rateDecay === PLAYER_FLIGHT.rateDecay);
  check('...and it really is a PlayerShip, flown by a FlightDemand',
    playerEp.trader.ship instanceof PlayerShip);

  // 2. The pirates in a training episode ARE roster hulls.
  const gangEp = new Episode({
    seed: 12,
    pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
    trader: { kind: 'scripted' },
  });
  // By DESIGN ID, never by comparing hulls: two roster rows can share a mesh,
  // and ship-identity.ts is the only thing that says what a ship is.
  const cobraSpec = SPECS.pirate.find((s) => s.designId === shipDesignIdOf(10))!;
  const sideSpec = SPECS.pirate.find((s) => s.designId === shipDesignIdOf(17))!;
  const cobraR = shipTargetRadius(cobraSpec.designId);
  const sideR = shipTargetRadius(sideSpec.designId);
  // A fresh pirate is at FULL health — a fraction of 1 — and carries the exact
  // released bank its profile names. Both, because the fraction alone would
  // pass for any hull and the bank alone would not say it started whole.
  const cobraE = npcMaxEnergy(cobraSpec.profileId);
  const sideE = npcMaxEnergy(sideSpec.profileId);
  check(`episode pirate 1 is the roster Cobra (energy ${cobraE}, r ${cobraR})`,
    gangEp.pirates[0].hp === 1 && gangEp.pirates[0].radius === cobraR
    && (gangEp.pirates[0] as { npc: { maxEnergy: number } }).npc.maxEnergy === cobraE);
  check(`episode pirate 2 is the roster Sidewinder (energy ${sideE}, r ${sideR})`,
    gangEp.pirates[1].hp === 1 && gangEp.pirates[1].radius === sideR
    && (gangEp.pirates[1] as { npc: { maxEnergy: number } }).npc.maxEnergy === sideE);

  // 3. Per-hull accel — the omission the merge exposed.
  //
  // npc.ts threw every brain-flown ship at a flat BRAIN_ACCEL = 120 while the
  // simulator gave each hull its own (140 / 120 / 100), so a Sidewinder was
  // trained with 17% more throttle authority than the game gave it and armed
  // traders with 17% less. This block carried a TODO asking an owner to pick a
  // side. The side is: hulls have accel, and it is a fraction of top speed.
  check('a Sidewinder now out-accelerates a pirate Cobra'
    + ` (${shipAccel(sideSpec).toFixed(0)} vs ${shipAccel(cobraSpec).toFixed(0)})`,
  shipAccel(sideSpec) > shipAccel(cobraSpec));
  check('...and the simulator\'s three hand-written accels are within a step of the rule',
    Math.abs(shipAccel(sideSpec) - 140) < 3
    && Math.abs(shipAccel(cobraSpec) - 120) < 3
    && Math.abs(shipAccel(SPECS.trader[0]) - 100) < 3);
  check(`every roster hull accelerates at ${ACCEL_FRACTION} of top speed unless told otherwise`,
    Object.values(SPECS).every((list) => list.every((s) =>
      s.accel !== undefined || shipAccel(s) === s.maxSpeed * ACCEL_FRACTION)));

  // 4. The speed floor, as BEHAVIOUR rather than as two constants agreeing.
  //
  // It is invariant 8's load-bearing rule — a fighter that can stop dead
  // becomes a turret — and it used to be checked by comparing a `minSpeed`
  // field in the simulator against MIN_CRUISE_FRACTION here. Now it is checked
  // by asking a ship to stop and watching it refuse.
  const brakeToStop = (role: 'pirate' | 'trader', spec: NpcSpec): number => {
    const ship = new NpcShip(role, new THREE.Vector3(), 5, spec);
    const state = (ship as unknown as {
      state: { brainControl: unknown; brainTimer: number };
    }).state;
    const ahead = new THREE.Vector3(0, 0, -5000);
    const level = new THREE.Quaternion();
    for (let i = 0; i < 900; i++) {
      // full brake, re-imposed each step so the 10 Hz cache cannot re-decide
      state.brainControl = { pitch: 0, roll: 0, throttle: -1, fire: false };
      state.brainTimer = 1;
      ship.brainFly(shippedPirate, 1 / 60, ahead, level, 300, 5000, null);
    }
    return ship.state.speed;
  };
  const pirateFloor = brakeToStop('pirate', cobraSpec);
  check(`a braking pirate stops at ${pirateFloor.toFixed(0)},`
    + ` its ${MIN_CRUISE_FRACTION} floor of ${cobraSpec.maxSpeed}`,
  Math.abs(pirateFloor - cobraSpec.maxSpeed * MIN_CRUISE_FRACTION) < 0.5);
  const traderFloor = brakeToStop('trader', SPECS.trader[0]);
  check(`...where a trader is allowed to come to rest (${traderFloor.toFixed(0)})`,
    traderFloor === 0);

  // 5. The gun an NPC actually carries, as behaviour.
  //
  // The old block asserted its cadence and gate by comparing two copies of the
  // numbers, and that is how the drift it was watching for got in anyway: the
  // check read the FIRST match in npc.ts, which was brainFly's 0.25, while
  // attack()'s 0.22 sat forty lines below on the path every police ship and
  // knife-range pirate fires from. Both paths are exercised here instead.
  const shotsIn = (bearing: number, range: number, seconds: number): number => {
    seedWorld(99);
    const ship = new NpcShip('pirate', new THREE.Vector3(), 5, cobraSpec);
    const target = new THREE.Vector3(
      Math.sin(bearing) * range, 0, -Math.cos(bearing) * range);
    const state = (ship as unknown as {
      state: { brainControl: unknown; brainTimer: number };
    }).state;
    ship.faceToward(new THREE.Vector3(0, 0, -1000)); // nose along -Z, target off it
    let shots = 0;
    for (let i = 0; i < seconds * 60; i++) {
      state.brainControl = { pitch: 0, roll: 0, throttle: 0, fire: true };
      state.brainTimer = 1;
      ship.object.position.set(0, 0, 0); // hold station, so only the gun varies
      if (ship.brainFly(shippedPirate, 1 / 60, target, new THREE.Quaternion(),
        300, range, 'player', null)) shots += 1;
    }
    return shots;
  };
  const insideGate = shotsIn(NPC_FIRE_GATE * 0.5, 800, 20);
  check(`an NPC lined up inside the ${NPC_FIRE_GATE} rad gate shoots (${insideGate} in 20s)`,
    insideGate > 0);
  check(`...at its own cadence, not faster than ${NPC_COOLDOWN_LO}s allows`,
    insideGate <= 20 / NPC_COOLDOWN_LO);
  check('...and mean cadence sits inside the cooldown spread',
    insideGate >= 20 / (NPC_COOLDOWN_LO + NPC_COOLDOWN_SPREAD));
  check('an NPC outside the gate never pulls the trigger',
    shotsIn(NPC_FIRE_GATE * 1.1, 800, 20) === 0);
  check(`...nor beyond ${NPC_LASER_RANGE} units, however well aimed`,
    shotsIn(0, NPC_LASER_RANGE + 10, 20) === 0);

  // ...and the hit curve, at both clamps and in between.
  check('an NPC shot at point blank is capped, not certain', npcHitChance(0) === NPC_HIT_CAP);
  check('...and at extreme range it floors rather than reaching zero',
    npcHitChance(99_999) === NPC_HIT_FLOOR);
  check('...and falls off with distance between them',
    npcHitChance(500) > npcHitChance(2500));

  // 6. The rate ramp had FOUR homes — player.ts, npc.ts, combat-computer.ts
  // and the simulator's stepShip — each with the constants written out again.
  // That is how the simulator sat at decay 5.0 while the player moved to 12.0,
  // and how "correcting" it silently broke the NPC half. One rule now, with
  // the constants passed in, so assert the rule rather than the copies.
  check('the shared ramp is what the player\'s controls use',
    rampFlightRate(0.4, 1.2, true, 1 / 60)
      === rampToward(0.4, 1.2, true, 1 / 60, PLAYER_FLIGHT.rateRamp, PLAYER_FLIGHT.rateDecay));
  check('...and what the combat computer uses, at the NPC constants',
    ccRamp(0.4, 1.2, false, 1 / 60)
      === rampToward(0.4, 1.2, false, 1 / 60, BRAIN_RATE_RAMP, BRAIN_RATE_DECAY));

  // 7. TURN belongs to the roster now (npc.ts used to import it from the
  // simulator), and the combat computer's caps derive from it rather than from
  // two multiplied literals.
  check(`combat computer caps track TURN (${CC_MAX_PITCH} / ${CC_MAX_ROLL})`,
    CC_MAX_PITCH === 0.5 * TURN.pitch && CC_MAX_ROLL === 0.5 * TURN.roll);

  // 8. Ramming: one constant, one speed rule, billed by the episode the way
  // world-step.ts bills it.
  check('ramming costs each side its own stated points, and both the same speed',
    IMPACT.ram.ship === 44 && IMPACT.ram.commander === 115
    && PLAYER_SPEED_KEPT === NPC_SPEED_KEPT);
}
