// The commander's ship as a set of numbers: the banks, what a hit costs them,
// and how they come back.
//
// These lived at the bottom of npc.test.ts, which said so apologetically in its
// own header — "ship systems are here too". They are their own subsystem
// (src/game/systems.ts) and every balance claim this project makes rests on
// them, so they are their own file: one test file per subsystem, as the rest of
// the suite is organised.
//
// The banks are 255-point pools since TODO 27, so every number below is whole
// points rather than the old 1/1/4 fractions.

import { check, eq } from './harness.ts';
import { COBRA_MK_3_HULL_ID, PLAYER_HULL_IDS } from '../src/game/ship-identity.ts';
import {
  applyDamage,
  durability,
  energyRegenPerSecond,
  freshSystems,
  regenerate,
  repairAtStation,
  scoopFuel,
  updateCabinTemp,
  type RegenOptions,
  type ShipSystems,
} from '../src/game/systems.ts';
import {
  ENERGY_BANKS, LOW_ENERGY, MAX_ENERGY, MAX_SHIELD,
} from '../src/constants/pools.ts';
import { ENERGY_UNIT_MULTIPLIER } from '../src/constants/recharge.ts';
import {
  SUN_HEAT_MAX, SUN_HEAT_START, SUN_KILL_DIST, SUN_SCOOP_RANGE,
} from '../src/constants/sun.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';

/** The hull the recharge policy is anchored on — see systems.ts. */
const COBRA: RegenOptions = { shipId: COBRA_MK_3_HULL_ID, energyUnit: false };

console.log('\nship systems');
{
  // The warning, the shield cut-off and the console's segments are the same
  // reading of one pool (TODO 38): ENERGY_BANKS says how many banks a pilot
  // sees, and LOW_ENERGY is the last of them. They were equal by coincidence
  // while the console drew a four-point bank's worth of segments over a
  // 255-point pool; now one is defined from the other.
  check('the pool reads as four banks, as the original console showed',
    ENERGY_BANKS === 4);
  check('ENERGY LOW is exactly the last of those banks',
    LOW_ENERGY === Math.round(MAX_ENERGY / ENERGY_BANKS));
  check('...so a full pool is that many banks and no more',
    Math.round(MAX_ENERGY / LOW_ENERGY) === ENERGY_BANKS);

  check('durability from the front is one 255 shield plus a 255 bank',
    durability(false) === MAX_SHIELD + MAX_ENERGY);
  check('manoeuvring so both faces take hits is worth a second shield',
    durability(true) === MAX_SHIELD * 2 + MAX_ENERGY);

  {
    const s = freshSystems();
    const r = applyDamage(s, playerPoolPoints(40), true, () => 1);
    check('a hit from ahead is absorbed by the FORE shield',
      s.foreShield === MAX_SHIELD - 40 && s.aftShield === MAX_SHIELD
        && s.energy === MAX_ENERGY);
    check('...and does not reach the hull', !r.reachedHull && !r.destroyed);
  }
  {
    const s = freshSystems();
    applyDamage(s, playerPoolPoints(40), false, () => 1);
    check('a hit from behind is absorbed by the AFT shield',
      s.aftShield === MAX_SHIELD - 40 && s.foreShield === MAX_SHIELD);
  }
  {
    const s = freshSystems();
    applyDamage(s, playerPoolPoints(MAX_SHIELD + 30), true, () => 1);   // the whole shield + 30
    check('overflow past a flattened shield comes straight out of energy',
      s.foreShield === 0 && s.energy === MAX_ENERGY - 30);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, playerPoolPoints(durability(false)), true, () => 1);
    check('exactly one face-full of durability destroys the ship',
      r.destroyed && s.energy === 0);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, playerPoolPoints(durability(false) - 1), true, () => 1);
    check('...and one point less does not', !r.destroyed && s.energy === 1);
  }
  {
    const s = freshSystems();
    const never = applyDamage(s, playerPoolPoints(MAX_SHIELD + 1), true, () => 0.99);
    const always = applyDamage(freshSystems(), playerPoolPoints(MAX_SHIELD + 1), true, () => 0.01);
    check('a hull hit rolls for wrecking a fitting',
      !never.wreckedSomething && always.wreckedSomething);
  }
  {
    // The trap the unit conversion sets: the chance belongs to the HIT, not to
    // the number of points in it. A 255x bigger hit must not be 255 rolls.
    let rolls = 0;
    const s = freshSystems();
    s.foreShield = 0;
    applyDamage(s, playerPoolPoints(200), true, () => { rolls += 1; return 1; });
    check('...exactly once per penetrating hit, however large the hit is',
      rolls === 1);
    let none = 0;
    applyDamage(freshSystems(), playerPoolPoints(10), true, () => { none += 1; return 1; });
    check('...and not at all when the shield swallowed it', none === 0);
  }

  {
    // shields only come back once energy is healthy — a beaten ship has to
    // break off before it gets them back, which is the whole tactical point
    const s = freshSystems();
    s.energy = Math.round(LOW_ENERGY / 2); s.foreShield = 0; s.aftShield = 0;
    regenerate(s, 1, COBRA);
    check('shields do NOT regenerate while energy is below a quarter bank',
      s.foreShield === 0 && s.aftShield === 0);
    s.energy = MAX_ENERGY / 2;
    regenerate(s, 1, COBRA);
    check('...and do once it recovers', s.foreShield > 0 && s.aftShield > 0);
  }
  {
    const plain = freshSystems(); plain.energy = 0;
    const boosted = freshSystems(); boosted.energy = 0;
    for (let i = 0; i < 60; i += 1) {
      regenerate(plain, 1 / 60, COBRA);
      regenerate(boosted, 1 / 60, { ...COBRA, energyUnit: true });
    }
    check(`an energy unit doubles the recharge rate (${plain.energy} -> ${boosted.energy})`,
      boosted.energy === plain.energy * 2);
    check('...and a Cobra Mk III recovers what it always did: a 40-second bank',
      plain.energy === Math.round(MAX_ENERGY / 40));
  }
  {
    // Frame-rate independence, the same claim the NPC banks make: the carry is
    // whole sub-ticks, not a float sum of dt.
    const run = (hz: number, seconds: number) => {
      const s = freshSystems();
      s.energy = 0; s.foreShield = 0; s.aftShield = 0;
      for (let i = 0; i < hz * seconds; i += 1) regenerate(s, 1 / hz, COBRA);
      return `${s.energy}:${s.energyCarry}:${s.foreShield}:${s.foreShieldCarry}`;
    };
    check('ten seconds of recharge is the same at 15, 60 and 144 Hz',
      run(15, 10) === run(60, 10) && run(60, 10) === run(144, 10));
    const s = freshSystems();
    s.energy = 100;
    regenerate(s, -30, COBRA);
    check('...and a rewound clock gives nothing back', s.energy === 100);
  }
  {
    // The hull's own recharge rating, applied exactly once: a Fer-de-Lance is
    // rated 2 against the Cobra's 1.
    const cobra = freshSystems(); cobra.energy = 0;
    const fdl = freshSystems(); fdl.energy = 0;
    for (let i = 0; i < 60; i += 1) {
      regenerate(cobra, 1 / 60, COBRA);
      regenerate(fdl, 1 / 60, { shipId: PLAYER_HULL_IDS[8], energyUnit: false });
    }
    check(`a rating-2 hull recharges twice as fast (${cobra.energy} -> ${fdl.energy})`,
      fdl.energy === cobra.energy * 2);
  }
  {
    const s = freshSystems();
    check('deep space is cold', !updateCabinTemp(s, 1, 1_000_000) && s.cabinTemp === 0);
    let dead = false;
    for (let i = 0; i < 600 && !dead; i++) dead = updateCabinTemp(s, 1 / 60, 0);
    check('sitting in the sun eventually kills you', dead);
  }
  {
    check('no scoops, no fuel', scoopFuel(1, 1000, false, 0, 70) === 0);
    check('scoops but too far out gathers nothing', scoopFuel(1, 200_000, true, 0, 70) === 0);
    check('scooping close in gathers fuel', scoopFuel(1, 1000, true, 0, 70) > 0);
    check('a full tank never overfills', scoopFuel(1, 1000, true, 70, 70) === 0);
    check('...and a nearly-full one fills exactly to the top',
      Math.abs(scoopFuel(1, 1000, true, 69.5, 70) - 0.5) < 1e-9);
  }
}

// --- the sun's ladder --------------------------------------------------------
//
// Four distances, met in this order flying in from deep space: the cabin starts
// to warm (110,000), the scoops start to gather (80,000), the cabin passes the
// fatal temperature (26,840, off `SUN_HEAT_MAX`'s ramp), and the ship is gone
// regardless (21,000). They were four literals in two files and NOTHING held
// them in that order — game.ts carried a comment describing the ordering for
// constants that had already left it, which is a comment nobody can fail.
//
// So each rung is asserted by what it BUYS, walked in through the real
// `scoopFuel` and `updateCabinTemp` rather than by sorting four numbers. Swap
// any two and one of these goes red.

console.log('\nthe sun — heat, scooping and the order they arrive in');

{
  /** Where the cabin settles after `seconds` of holding station at `dist`. */
  const settlesAt = (dist: number, seconds: number): number => {
    const s = freshSystems();
    for (let i = 0; i < seconds * 60; i += 1) updateCabinTemp(s, 1 / 60, dist);
    return s.cabinTemp;
  };
  /** ...and whether it ever reaches a fatal one. */
  const cooks = (dist: number, seconds: number): boolean => {
    const s = freshSystems();
    for (let i = 0; i < seconds * 60; i += 1) {
      if (updateCabinTemp(s, 1 / 60, dist)) return true;
    }
    return false;
  };
  const scoops = (dist: number): number => scoopFuel(1, dist, true, 0, 70);

  check('outside the top of the ladder the cabin never warms at all',
    settlesAt(SUN_HEAT_START + 1, 60) === 0 && scoops(SUN_HEAT_START) === 0);
  check('you are warm before you can earn — the scoops start inside the heat',
    scoops(SUN_SCOOP_RANGE - 1) > 0 && settlesAt(SUN_SCOOP_RANGE - 1, 60) > 0.3);
  check('...and that outer edge is survivable, which is what sun-skimming IS',
    !cooks(SUN_SCOOP_RANGE - 1, 300));
  check('the whole fatal band is inside the scoop range, so the risk buys fuel',
    scoops(SUN_HEAT_MAX) > 0 && cooks(SUN_HEAT_MAX, 30));
  check('the heat kills you before the sun does, so the gauge is a real warning',
    cooks(SUN_KILL_DIST + 1, 30));

  // What the trade is worth, end to end: a full tank off the outer edge.
  let fuel = 0;
  let t = 0;
  while (fuel < 70 && t < 120) {
    fuel += scoopFuel(1 / 60, SUN_SCOOP_RANGE - 1, true, fuel, 70);
    t += 1 / 60;
  }
  check(`...and a dry tank fills in 14 seconds of it (${t.toFixed(1)}s)`,
    Math.abs(t - 14) < 0.1);
}

console.log('\nship systems — recharge, and the TODO 28 bridge');

{
  // FRAME-RATE INDEPENDENT, on the same integer sub-tick clock the NPC banks
  // use: a float sum of dt gives three different answers to "ten seconds".
  const run = (hz: number, seconds: number, opts = COBRA): string => {
    const sys = freshSystems();
    sys.energy = 0; sys.foreShield = 0; sys.aftShield = 0;
    for (let i = 0; i < hz * seconds; i += 1) regenerate(sys, 1 / hz, opts);
    return `${sys.energy}:${sys.energyCarry}:${sys.foreShield}:${sys.foreShieldCarry}`;
  };
  eq('ten seconds of recharge is identical at 15, 60 and 144 Hz',
    [run(15, 10), run(60, 10), run(144, 10)].join(' '),
    `${run(60, 10)} ${run(60, 10)} ${run(60, 10)}`);
  eq('...and so is a third of a second, sub-tick carry included',
    [run(15, 1 / 3), run(60, 1 / 3), run(144, 1 / 3)].join(' '),
    `${run(60, 1 / 3)} ${run(60, 1 / 3)} ${run(60, 1 / 3)}`);
  check('two short frames and one twice as long agree', (() => {
    const two = freshSystems(); two.energy = 0;
    regenerate(two, 1 / 60, COBRA); regenerate(two, 1 / 60, COBRA);
    const one = freshSystems(); one.energy = 0;
    regenerate(one, 2 / 60, COBRA);
    return two.energy === one.energy && two.energyCarry === one.energyCarry;
  })());

  // ANCHORED ON THE COBRA MK III: the bank still fills in 40 seconds and a
  // shield face in 1/0.035, exactly as they did on the old 4-point scale.
  const seconds = (fill: (s: ShipSystems) => number, startEnergy: number): number => {
    const sys = freshSystems();
    sys.energy = startEnergy; sys.foreShield = 0; sys.aftShield = 0;
    let t = 0;
    while (fill(sys) < MAX_ENERGY && t < 600) { regenerate(sys, 1 / 60, COBRA); t += 1 / 60; }
    return t;
  };
  // The two figures are written out rather than recomputed from the fractions
  // they are timing: `1 / ENERGY_REGEN_FRACTION` would be this loop's own input
  // handed back to it, and would pass at any rate. 40 and 28.6 are the claim —
  // "a Cobra flies the recharge it flew before the pools grew" — so moving
  // either fraction has to cost a red line here.
  //
  // The tolerance is 0.1s, which is the tick quantisation and nothing else: the
  // bank measures 40.03 against an arithmetic 40.0 and the face 28.55 against
  // 28.57, because `recharge` awards whole points on a sub-tick clock. A
  // quarter of a percent off either fraction fails this — 0.025 to 0.0251 puts
  // the bank at 39.8. It was 0.2s and did not.
  const bank = seconds((s) => s.energy, 0);
  check(`a Cobra Mk III still refills its bank in ~40s (${bank.toFixed(2)}s)`,
    Math.abs(bank - 40) < 0.1);
  // from a HEALTHY bank: the shields wait for one, which is the tactical rule
  // and not the recharge rate.
  const face = seconds((s) => s.foreShield, MAX_ENERGY);
  check(`...and a shield face in ~28.6s (${face.toFixed(2)}s)`,
    Math.abs(face - 28.6) < 0.1);

  // The hull's rating and the energy unit, each applied EXACTLY ONCE.
  const cobraRate = energyRegenPerSecond(COBRA_MK_3_HULL_ID, false);
  eq('an energy unit multiplies the rate once, not twice',
    energyRegenPerSecond(COBRA_MK_3_HULL_ID, true), cobraRate * ENERGY_UNIT_MULTIPLIER);
  eq('...and the Fer-de-Lance\'s recharge rating of 2 likewise',
    energyRegenPerSecond(PLAYER_HULL_IDS[8], false), cobraRate * 2);
  eq('...and the two compose rather than colliding',
    energyRegenPerSecond(PLAYER_HULL_IDS[8], true),
    cobraRate * 2 * ENERGY_UNIT_MULTIPLIER);

  // Shields wait for a healthy bank, and a full pool banks nothing.
  {
    const beaten = freshSystems();
    beaten.energy = LOW_ENERGY - 20; beaten.foreShield = 0; beaten.aftShield = 0;
    regenerate(beaten, 1, COBRA);
    check('a beaten ship gets no shields back until the bank recovers',
      beaten.foreShield === 0 && beaten.aftShield === 0);
    const full = freshSystems();
    for (let i = 0; i < 600; i += 1) regenerate(full, 1 / 60, COBRA);
    check('a full ship banks nothing, so damage does not come straight back',
      full.energy === MAX_ENERGY && full.energyCarry === 0
      && full.foreShield === MAX_SHIELD && full.foreShieldCarry === 0);
  }
}

// The pools take POOL POINTS and nothing else. What may be spent against them,
// where those numbers come from and which call sites are allowed to mint one is
// test/damage-paths.test.ts — the whole damage inventory in one place, rather
// than half an argument here and half of it beside the NPC banks.
{
  const s = freshSystems();
  const r = applyDamage(s, playerPoolPoints(0), true, () => 1);
  check('a zero-point hit costs nothing and reaches nothing',
    !r.reachedHull && !r.destroyed && s.foreShield === MAX_SHIELD);
  let threw = false;
  try {
    applyDamage(freshSystems(), playerPoolPoints(0.45), true, () => 1);
  } catch { threw = true; }
  check('...and a fractional amount cannot be minted as pool points at all', threw);
}

console.log('\nship systems — the banks a station hands back');

{
  // There were four checks above this one, on `migratedSystems`: an exact save
  // round-tripping, a pre-TODO-27 save keeping its fractions, its carries
  // starting clean, and an empty save coming back whole. The function is gone
  // (2026-08-04) — the pools have not been 1/1/4 for a long time and no save on
  // that scale exists, so `Persistence.restore` assigns the snapshot's
  // `ShipSystems` straight across. The round trip is still covered, by
  // test/world-step.test.ts's whole-world save and by test/snapshot.test.ts.

  // Docking is the other place "full" is stated, and it is stated once.
  const worn = freshSystems();
  worn.energy = 3; worn.foreShield = 0; worn.aftShield = 7;
  worn.energyCarry = 99; worn.laserTemp = 0.8; worn.cabinTemp = 0.3;
  repairAtStation(worn);
  check('a station hands back full pools and a cold laser',
    worn.energy === MAX_ENERGY && worn.foreShield === MAX_SHIELD
    && worn.aftShield === MAX_SHIELD && worn.energyCarry === 0
    && worn.laserTemp === 0);
  check('...and leaves the cabin temperature to the dock, which clears it after',
    worn.cabinTemp === 0.3);
}
