// One combat model: the trainer flies the game, not a copy of it.
//
// Invariant 5, enforced. src/ai-training/core.ts used to be a second physics
// implementation with its own numbers, kept in step by hope; it is deleted, and
// these tests are what stop it growing back. The arena block measures the player's
// flight envelope, which is the input scenario.ts fits its target hulls to.

import * as THREE from 'three';
import { existsSync } from 'node:fs';
import {
  npcHitChance,
} from '../src/game/gunnery.ts';
import {
  NPC_COOLDOWN_LO, NPC_COOLDOWN_SPREAD, NPC_FIRE_GATE, NPC_HIT_CAP, NPC_HIT_FLOOR,
  NPC_LASER_RANGE,
} from '../src/constants/npc-gun.ts';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import { MIN_CRUISE_FRACTION } from '../src/constants/attack-run.ts';
import { BRAIN_RATE_RAMP, BRAIN_RATE_DECAY } from '../src/constants/brain-flight.ts';
import { PLAYER_SPEED_KEPT, NPC_SPEED_KEPT } from '../src/constants/collision.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { shipTargetRadius } from '../src/ships/registry.ts';
import {
  SPECS,
  type NpcSpec,
  shipAccel,
} from '../src/game/ship-specs.ts';
import { ACCEL_FRACTION, TURN } from '../src/constants/hull-motion.ts';
import {
  PlayerShip, rampFlightRate, type FlightDemand,
} from '../src/player.ts';
import { PLAYER_FLIGHT } from '../src/constants/player-flight.ts';
import { LOW_ENERGY, MAX_ENERGY, MAX_SHIELD } from '../src/constants/pools.ts';
import {
  applyDamage, energyLow, freshSystems, regenerate, type ShipSystems,
} from '../src/game/systems.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';
import { ccRamp } from '../src/game/combat-computer.ts';
import { CC_MAX_PITCH, CC_MAX_ROLL } from '../src/constants/combat-computer.ts';
import { COBRA_MK_3_HULL_ID, shipDesignIdOf } from '../src/game/ship-identity.ts';
import { npcMaxEnergy } from '../src/game/npc-energy.ts';
import { Episode } from '../src/ai-training/scenario.ts';
import { check } from './harness.ts';
import { defendShaped as jameson } from './fixtures.ts';

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

  // 2. The pirates in a training episode ARE roster hulls — the WHOLE roster,
  //    sampled by the game's own threat-tier rule since TODO 29. It used to
  //    alternate between two hand-picked rows, which is a narrow world to fit a
  //    pursuit curve in when the roster holds sixteen.
  //
  // By DESIGN ID, never by comparing hulls: two roster rows can share a mesh,
  // and ship-identity.ts is the only thing that says what a ship is.
  const seen = new Set<string>();
  const strangers: string[] = [];
  for (let seed = 10; seed < 40; seed++) {
    const ep = new Episode({
      seed,
      pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
      trader: { kind: 'scripted' },
    });
    for (const p of ep.setup().pirates) {
      seen.add(p.designId);
      const spec = SPECS.pirate.find((s) => s.designId === p.designId);
      // A fresh pirate is at FULL health and carries the exact released bank
      // its own profile names — the fraction alone would pass for any hull.
      if (!spec || spec.profileId !== p.profileId
        || npcMaxEnergy(spec.profileId) !== p.maxEnergy) {
        strangers.push(`${p.name} ${p.profileId}`);
      }
    }
    if (!ep.pirates.every((p) => p.hp === 1)) strangers.push(`seed ${seed} not whole`);
  }
  check('every episode pirate is a roster row, on its own released bank',
    strangers.length === 0, strangers.join(', '));
  check(`...drawn from across the roster, not two hulls (${seen.size} designs in 30 seeds)`,
    seen.size >= 6);
  const cobraSpec = SPECS.pirate.find((s) => s.designId === shipDesignIdOf(10))!;
  const sideSpec = SPECS.pirate.find((s) => s.designId === shipDesignIdOf(17))!;
  check(`the Cobra Mk III (r ${shipTargetRadius(cobraSpec.designId).toFixed(2)}) and`
    + ` the Sidewinder (r ${shipTargetRadius(sideSpec.designId).toFixed(2)}) are both in it`,
  seen.has(cobraSpec.designId) && seen.has(sideSpec.designId));

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
  // It is the load-bearing rule of "threat is not fun" — a fighter that can stop dead
  // becomes a turret — and it used to be checked by comparing a `minSpeed`
  // field in the simulator against MIN_CRUISE_FRACTION here. Now it is checked
  // by asking a ship to stop and watching it refuse.
  // Three blocks below fly a brain-flown ship at a control of their own
  // choosing, and `brainControl`/`brainTimer` are private — so ONE home for the
  // cast, and one place that re-imposes the control every step so the 10 Hz
  // decision cache cannot re-decide it mid-run.
  const pin = (ship: NpcShip, control: {
    pitch: number; roll: number; throttle: number; fire: boolean;
  }): void => {
    const s = (ship as unknown as {
      state: { brainControl: unknown; brainTimer: number };
    }).state;
    s.brainControl = control;
    s.brainTimer = 1;
  };
  const brakeToStop = (role: 'pirate' | 'trader', spec: NpcSpec): number => {
    const ship = new NpcShip(role, new THREE.Vector3(), 5, spec);
    const ahead = new THREE.Vector3(0, 0, -5000);
    const level = new THREE.Quaternion();
    for (let i = 0; i < 900; i++) {
      pin(ship, { pitch: 0, roll: 0, throttle: -1, fire: false }); // full brake
      ship.brainFly(jameson, 1 / 60, ahead, level, 300, 5000, null);
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
    ship.faceToward(new THREE.Vector3(0, 0, -1000)); // nose along -Z, target off it
    let shots = 0;
    for (let i = 0; i < seconds * 60; i++) {
      pin(ship, { pitch: 0, roll: 0, throttle: 0, fire: true });
      ship.object.position.set(0, 0, 0); // hold station, so only the gun varies
      if (ship.brainFly(jameson, 1 / 60, target, new THREE.Quaternion(),
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
  //
  // Which is what the two checks that stood here did NOT do: each compared a
  // wrapper against the `rampToward` call it expands to, so both sides were the
  // same expression and the pair passed for any constants and any curve —
  // including one that returned its input untouched (docs/TODO/87).
  //
  // The expectation has to come from OUTSIDE the implementation, and there is
  // one to hand: the exponential form was introduced as an exact re-fit, at
  // 1/60, of the linear rule it replaced (`cur + (target - cur) * rate * dt`).
  // 4.1396, 13.3886 and 5.2207 are what 4, 12 and 5 per second were solved for,
  // so a step is measured against the OLD rule at the OLD numbers. 1e-6 admits
  // the re-fit residual (1.0e-7 at worst) and rejects a 1% move in any of them
  // (3.2e-4 at worst).
  //
  // All FOUR constants here, including the commander's, though this is a file
  // about NPCs: they are one rule — the re-fit — and half of it lived in
  // test/flight.test.ts, which is one rule with two homes again. That file
  // keeps the ramp's SHAPE, which is what its section is titled: the same
  // handling at 15, 30, 60 and 144Hz, and the snap to zero.
  const oldRule = (cur: number, target: number, rate: number) =>
    cur + (target - cur) * rate * (1 / 60);
  const near = (name: string, got: number, want: number, tol = 1e-6) =>
    check(name, Math.abs(got - want) < tol, `got ${got}, want ${want} +/- ${tol}`);
  near(`the commander holds a turn at 4/s (rateRamp ${PLAYER_FLIGHT.rateRamp})`,
    rampFlightRate(0.4, 1.2, true, 1 / 60), oldRule(0.4, 1.2, 4));
  near(`...and lets it go at 12/s (rateDecay ${PLAYER_FLIGHT.rateDecay})`,
    rampFlightRate(0.4, 0, false, 1 / 60), oldRule(0.4, 0, 12));
  near(`a brain-flown ship holds at the same 4/s (BRAIN_RATE_RAMP ${BRAIN_RATE_RAMP})`,
    ccRamp(0.4, 1.2, true, 1 / 60), oldRule(0.4, 1.2, 4));
  near('...and lets go at 5/s, less than half the commander\'s 12'
    + ` (BRAIN_RATE_DECAY ${BRAIN_RATE_DECAY})`,
  ccRamp(0.4, 0, false, 1 / 60), oldRule(0.4, 0, 5));

  // ...and the ramp a brain-flown NPC integrates its controls with IS the one
  // the combat computer flies, which is the claim the second check was making
  // and could not test. `brainFly` and `ccRamp` are two call sites of the
  // shared rule: the two numbers above pin what each must be, this drives one
  // and predicts it with the other. One second held, one second released, so
  // both branches are compared over 120 steps rather than at a point.
  {
    const ship = new NpcShip('pirate', new THREE.Vector3(), 5, cobraSpec);
    const far = new THREE.Vector3(0, 0, -5000);
    const level = new THREE.Quaternion();
    const cap = cobraSpec.turnRate * TURN.pitch;
    let predicted = 0, worst = 0, peak = 0;
    for (let i = 0; i < 120; i++) {
      const pitch = i < 60 ? 1 : 0;
      pin(ship, { pitch, roll: 0, throttle: 0, fire: false });
      ship.brainFly(jameson, 1 / 60, far, level, 300, 5000, null);
      predicted = ccRamp(predicted, pitch * cap, pitch !== 0, 1 / 60);
      worst = Math.max(worst, Math.abs(ship.state.brainPitchRate - predicted));
      peak = Math.max(peak, ship.state.brainPitchRate);
    }
    check('a brain-flown ship ramps and bleeds off exactly as ccRamp says'
      + ` (peak ${peak.toFixed(3)} of ${cap.toFixed(3)}, worst error ${worst})`,
    worst === 0 && peak > cap * 0.9);
  }

  // 7. TURN is the roster's shared multiplier now (constants/hull-motion.ts;
  // npc.ts used to import it from the simulator), and the combat computer's
  // caps are the trader Cobra's roster row times TURN — the hull the defence
  // policy was fitted in.
  //
  // Against the ROW, and against the numbers, rather than against
  // `0.5 * TURN.pitch` — the right-hand side of the definition with the `0.5`
  // written out a second time. That version could see the literal move in
  // combat-computer.ts and NOT the thing it says it tracks: the roster row's
  // `turnRate` was moved 1% and no assertion in the project failed
  // (docs/TODO/87). By design id, because "the row is the Cobra Mk III" is the
  // other half of the claim and a reordered roster would otherwise move the cap
  // with nothing noticing. Both numbers are written out as well, because a cap
  // that moves invalidates every brain fitted at it — that is a retrain, and it
  // should cost a red line to decide on.
  const traderCobra = SPECS.trader.find((s) => s.designId === shipDesignIdOf(10))!;
  check('the combat computer flies the trader Cobra\'s row x TURN'
    + ` (${CC_MAX_PITCH} / ${CC_MAX_ROLL} from turnRate ${traderCobra.turnRate})`,
  CC_MAX_PITCH === traderCobra.turnRate * TURN.pitch
    && CC_MAX_ROLL === traderCobra.turnRate * TURN.roll);
  near('...and that hull still pitches at the 0.7 the brain was trained against',
    CC_MAX_PITCH, 0.7, 1e-9);
  near('...and rolls at 1.2', CC_MAX_ROLL, 1.2, 1e-9);

  // 7b. THE COMMANDER'S PITCH CAP IS ARGUED FOR AGAINST FOUR PIRATE HULLS, and
  // the argument is four numbers transcribed out of the roster into a comment
  // in another file. One of them had already gone stale — it named an Asp Mk II
  // at 1.68, and the Asp left the pirate roster (ship-specs.ts states why), so
  // the reasoning cited a ship the player cannot meet. Now that PLAYER_FLIGHT
  // and TURN are in one directory the products can be re-derived, which is what
  // this does: every figure the comment quotes comes from the row it names.
  //
  // The CLAIM, not the arithmetic: you out-turn the two heavier hulls, and the
  // two lightest still edge you. That is what "as it should be — those are far
  // smaller ships" means, and it is what a change to any of the five numbers
  // has to be checked against.
  {
    const pitchOf = (designId: number) => {
      const row = SPECS.pirate.find((s) => s.designId === shipDesignIdOf(designId))!;
      return row.turnRate * TURN.pitch;
    };
    const [cobra, krait, mamba, sidewinder] = [10, 19, 18, 17].map(pitchOf);
    check('the commander out-turns a pirate Cobra and a Krait'
      + ` (${PLAYER_FLIGHT.maxPitch} against ${cobra.toFixed(2)} and ${krait.toFixed(2)})`,
    PLAYER_FLIGHT.maxPitch > cobra && PLAYER_FLIGHT.maxPitch > krait);
    check(`...matches a Mamba (${mamba.toFixed(2)})`,
      Math.abs(PLAYER_FLIGHT.maxPitch - mamba) < 0.05);
    check(`...and is still edged by a Sidewinder (${sidewinder.toFixed(2)})`,
      sidewinder > PLAYER_FLIGHT.maxPitch);
    check('...and the Asp Mk II the comment used to cite is not a pirate at all',
      !SPECS.pirate.some((s) => s.designId === shipDesignIdOf(23)));
  }

  // 8. Ramming: one constant, one speed rule, billed by the episode the way
  // world-step.ts bills it.
  check('ramming costs each side its own stated points, and both the same speed',
    IMPACT.ram.ship === 44 && IMPACT.ram.commander === 115
    && PLAYER_SPEED_KEPT === NPC_SPEED_KEPT);

  // 9. THE TARGET'S POOLS COME BACK, by systems.ts's rule and no other.
  //
  // The trainer ran two lines of `regenerate` — the laser's cooldown and heat —
  // and called them "the only half a target has". The other half is the half a
  // fight is about: the bank recharges every tick and both shield faces come
  // back once it is out of its last quarter, so a commander loses a face on a
  // pass and has it again before the next one. Without it damage was permanent
  // and the only strategy that survived an episode was never being hit, which
  // is the policy that shipped (docs/TODO/63).
  //
  // Asserted as EQUIVALENCE with the game's own function over the same inputs,
  // not as "the number went up": a second recharge rule that merely climbed
  // would pass the second kind of check and is exactly what this file exists to
  // stop. The target is flown for the whole ten seconds — `fly()` is the frame
  // every controller in scenario.ts comes through — with no pirate shooting at
  // it, because a hit landing mid-run would be measuring the dice instead.
  {
    const demand = (): FlightDemand => ({
      pitchRate: 0, rollRate: 0, throttle: 0, fire: false,
      limits: { accel: 220, maxSpeed: 400 },
    });
    const flown = (hit: number, seconds: number, energyUnit = false) => {
      const ep = new Episode({
        seed: 4242, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
        traderClass: 'playerCobra', targetEnergyUnit: energyUnit,
      });
      ep.trader.takeDamage(playerPoolPoints(hit), true);
      for (let i = 0; i < seconds * 60; i++) ep.trader.fly(1 / 60, demand());
      return ep.trader.sys;
    };
    const reference = (hit: number, seconds: number, energyUnit = false): ShipSystems => {
      const sys = freshSystems();
      applyDamage(sys, playerPoolPoints(hit), true, () => 1);
      for (let i = 0; i < seconds * 60; i++) {
        regenerate(sys, 1 / 60, { shipId: COBRA_MK_3_HULL_ID, energyUnit });
      }
      return sys;
    };
    const same = (a: ShipSystems, b: ShipSystems): boolean =>
      JSON.stringify(a) === JSON.stringify(b);

    // A face gone and a bite out of the bank, and neither pool near its ceiling:
    // both branches of `regenerate` run, and a cap would not hide a wrong rate.
    const HIT = MAX_SHIELD + 145;
    const hurt = flown(HIT, 10);
    check('a damaged target at t+10s is exactly what the game\'s regenerate gives'
      + ` (fore ${hurt.foreShield}, aft ${hurt.aftShield}, energy ${hurt.energy})`,
    same(hurt, reference(HIT, 10)));
    check('...and it really did recover: both pools are above where the hit left them',
      hurt.foreShield > 0 && hurt.energy > MAX_ENERGY - 145
      && hurt.foreShield < MAX_SHIELD && hurt.energy < MAX_ENERGY);

    // Beaten down past the console light: the bank climbs, the shields wait for
    // it. The rule that makes disengaging a decision rather than a formality —
    // and a five-second window, because at this rate the bank climbs back over
    // LOW_ENERGY in about eight and a half.
    const beaten = flown(MAX_SHIELD + MAX_ENERGY - 10, 5);
    check('a target below ENERGY LOW gets its bank back and no shields'
      + ` (energy ${beaten.energy}, fore ${beaten.foreShield})`,
    same(beaten, reference(MAX_SHIELD + MAX_ENERGY - 10, 5))
      && beaten.foreShield === 0 && beaten.energy > 10 && energyLow(beaten.energy));
    check(`...and ${LOW_ENERGY} points is where energyLow stops saying so`,
      energyLow(LOW_ENERGY) && !energyLow(LOW_ENERGY + 1));

    // The fit-out is an INPUT, not a constant: an energy unit doubles the bank's
    // recharge, and the episode has to carry which one the commander flew or the
    // record cannot say what was measured.
    const boosted = flown(HIT, 10, true);
    check(`the extra energy unit reaches the rule (energy ${hurt.energy}`
      + ` -> ${boosted.energy})`,
    same(boosted, reference(HIT, 10, true)) && boosted.energy > hurt.energy);
    const ep = new Episode({
      seed: 7, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
      traderClass: 'playerCobra', traderLaser: 'military', targetEnergyUnit: true,
    });
    check('...and the setup record says so, with the laser it actually fires',
      ep.setup().target.energyUnit === true && ep.setup().target.laser === 'military');
  }

  // ...and it happens inside a real episode, not only when a test drives the
  // target's frame. A fight where nothing came back would leave exactly
  // `damageTaken` missing from the pools.
  {
    const ep = new Episode({
      seed: 31, pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
      trader: { kind: 'scripted' }, traderClass: 'playerCobra',
    });
    while (!ep.done) ep.step(1 / 60);
    const permanent = ep.trader.maxPool - ep.trader.damageTaken;
    check(`an episode's target ends above what permanent damage would leave`
      + ` (${ep.trader.pool} of ${ep.trader.maxPool}, ${ep.trader.damageTaken} taken)`,
    ep.trader.damageTaken > 0 && ep.trader.pool > permanent);
  }
}
