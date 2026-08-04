// Populating a system: who is here, who arrives, and docking.
//
// Pure rule modules with an injectable rng (population.ts, encounters.ts), so
// these drive them directly rather than through a Game. WHERE any of it ends up
// is test/spawning.test.ts, which flies the real spawner.

import * as THREE from 'three';
import { dockingOutcome, ROLL_TOLERANCE } from '../src/game/docking.ts';
import { freshTimers, stepEncounters } from '../src/game/encounters.ts';
import { planPopulation, policeFor } from '../src/game/population.ts';
import { World } from '../src/game/world.ts';
import { seedWorld } from '../src/game/rng.ts';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import { MAX_TRADERS, MIN_TRADERS } from '../src/constants/population.ts';
import {
  ANARCHY_GOVERNMENT, LAWLESS_GOVERNMENT, MAX_THARGONS, PRODUCTIVITY_PER_SECOND,
  THARGON_REDEPLOY, TRADER_GAP_BUSY_MAX, TRADER_GAP_FIRST, TRADER_GAP_FIRST_JITTER,
} from '../src/constants/encounters.ts';
import { g1 } from './fixtures.ts';
import { check, eq } from './harness.ts';

// --- how busy a system is ---------------------------------------------------

console.log('\nsystem population');
{
  const sys = (government: number) => ({ government, seed: [1, 2, 3] }) as unknown as Parameters<typeof planPopulation>[0];
  const half = () => 0.5;

  check('anarchies have NO police, which is what makes them worth the risk',
    policeFor(0) === 0);
  check('a feudal or multi-government system manages one patrol', policeFor(1) === 1);
  check('anything more organised runs two',
    policeFor(2) === 2 && policeFor(7) === 2);

  {
    // the living galaxy's convoys show up as traffic you can see
    const busy = planPopulation(sys(4), 'arrival', 3, null, half);
    check('convoys the living galaxy is sending become visible traders',
      busy.traders === 3);
    // The cap is BISECTED out of the real function rather than written down: a
    // probe at the constant moves with the constant and would pass on a
    // re-inlined literal. This is the pair docs/TODO/90 is named after —
    // population.ts and encounters.ts each held their own `MAX_TRADERS = 4`.
    const planned = (due: number) => planPopulation(sys(4), 'arrival', due, null, half).traders;
    let cap = 0;
    for (let due = 1; due <= 64; due++) cap = Math.max(cap, planned(due));
    eq('...capped so a system never drowns in them, at MAX_TRADERS itself',
      cap, MAX_TRADERS);
    eq('...and floored at MIN_TRADERS when the galaxy is sending nobody',
      planned(0), MIN_TRADERS);
  }
  {
    const threat = { count: 3 } as unknown as Parameters<typeof planPopulation>[3];
    const arriving = planPopulation(sys(0), 'arrival', 1, threat, half);
    check('a reception is waiting when you arrive', arriving.pirates === 3);
    const launching = planPopulation(sys(0), 'launch', 1, threat, half);
    check('LAUNCHING from a station is safe — nobody organised for you',
      launching.pirates === 0 && launching.threat === null);
  }
}

// --- what turns up, and when ------------------------------------------------

// Traders arriving, pirate waves, Thargon drones. These rules decide how
// dangerous every system in the galaxy feels and had no test, because they ran
// as timers inline in updateFlight. game/encounters.ts now.

console.log('\nencounters');
{
  const conds = (over: Record<string, unknown> = {}) => ({
    witchspace: false, productivity: 10_000, government: 7,
    traderCount: 0, activeThargons: 0, hasThargoidMother: false,
    playerFarFromStation: true, ...over,
  }) as Parameters<typeof stepEncounters>[2];
  /** run until something is produced, or give up */
  const until = (t: Parameters<typeof stepEncounters>[0], c: Parameters<typeof stepEncounters>[2],
                 want: string, secs = 2000) => {
    for (let i = 0; i < secs * 10; i++) {
      for (const o of stepEncounters(t, 0.1, c, () => 0.5)) if (o.kind === want) return o;
    }
    return null;
  };

  check('traders arrive to keep the lanes alive',
    until({ trader: 1, pirateWave: 1e9, thargon: 1e9 }, conds(), 'trader') !== null);
  check('nothing arrives in witch-space',
    until({ trader: 1, pirateWave: 1, thargon: 1e9 }, conds({ witchspace: true }), 'trader', 400) === null);

  {
    // ...and the number it stops at is the SAME MAX_TRADERS the arrival plan
    // caps on. Bisected, so re-inlining a literal in either half goes red —
    // which is the whole of docs/TODO/90's founding bug.
    let busiest = 0;
    while (busiest < 64 && until({ trader: 1, pirateWave: 1e9, thargon: 1e9 },
      conds({ traderCount: busiest }), 'trader', 400) !== null) busiest++;
    eq('...but not once the system already holds MAX_TRADERS of them',
      busiest, MAX_TRADERS);
  }

  {
    const waveAt = (government: number) => until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
      conds({ government }), 'pirateWave', 600) as { count: number } | null;
    check('anarchies send pirates two at a time', waveAt(0)?.count === 2);
    check('a merely lawless system sends one', waveAt(LAWLESS_GOVERNMENT)?.count === 1);
    // Both government lines bisected out of the real rule. Probing at the
    // constant would move with it; walking up the ladder finds where the
    // behaviour actually changes and compares THAT to the constant.
    let quiet = 0;
    while (quiet <= 7 && waveAt(quiet) !== null) quiet++;
    eq('a corporate state sends none — waves stop above LAWLESS_GOVERNMENT',
      quiet - 1, LAWLESS_GOVERNMENT);
    let pairs = 0;
    while (pairs <= 7 && waveAt(pairs)?.count === 2) pairs++;
    eq('...and stop coming in pairs above ANARCHY_GOVERNMENT',
      pairs - 1, ANARCHY_GOVERNMENT);
    check('and nobody ambushes you on the station doorstep',
      until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
        conds({ government: 0, playerFarFromStation: false }), 'pirateWave', 600) === null);
  }
  {
    check('a mothership deploys drones',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds({ hasThargoidMother: true }), 'thargon') !== null);
    let flying = 0;
    while (flying < 32 && until({ trader: 1e9, pirateWave: 1e9, thargon: 1 },
      conds({ hasThargoidMother: true, activeThargons: flying }), 'thargon', 200) !== null) flying++;
    eq('...up to MAX_THARGONS of them at once', flying, MAX_THARGONS);
    check('...and not at all without one',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds(), 'thargon', 200) === null);

    // How long between one drone and the next, timed through the real rule
    // rather than read off the timer it sets. The tolerance is the tick and
    // nothing else.
    const t = { trader: 1e9, pirateWave: 1e9, thargon: 0.05 };
    const c = conds({ hasThargoidMother: true });
    let seen = 0, elapsed = 0, gap = -1;
    for (let i = 0; i < 10_000 && gap < 0; i++) {
      elapsed += 0.1;
      if (stepEncounters(t, 0.1, c, () => 0.5).some((o) => o.kind === 'thargon')) {
        if (seen === 0) { seen = 1; elapsed = 0; } else gap = elapsed;
      }
    }
    check(`...replacing one every THARGON_REDEPLOY seconds (measured ${gap.toFixed(1)})`,
      Math.abs(gap - THARGON_REDEPLOY) <= 0.1);
    eq('...and the wait for the FIRST one is the same number, not a second copy of it',
      freshTimers(() => 0.5).thargon, THARGON_REDEPLOY);
  }
  {
    // a productive system discounts the gap between arrivals
    const busy = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(busy, 0.1, conds({ productivity: 60_000 }), () => 0);
    const quiet = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(quiet, 0.1, conds({ productivity: 0 }), () => 0);
    check('busy economies run busier lanes', busy.trader < quiet.trader);

    // TRADER_GAP_BUSY_MAX's doc says no system in the game reaches the cap —
    // it is a guard against a re-scaled productivity rather than a live rung.
    // That is a claim about the whole galaxy, so it is asked of the whole galaxy.
    let richest = 0;
    for (let g = 1; g <= 8; g++) {
      for (const s of generateGalaxy(g)) richest = Math.max(richest, s.productivity);
    }
    const bought = richest / PRODUCTIVITY_PER_SECOND;
    check(`...and none of the 2048 systems reaches the discount cap `
      + `(richest buys ${bought.toFixed(1)}s of a possible ${TRADER_GAP_BUSY_MAX})`,
    bought < TRADER_GAP_BUSY_MAX);
  }
  {
    // The first trader is the one wait a player actually experiences on
    // arrival, and it is a base plus a flat jitter — both ends, so neither can
    // drift into the other.
    eq('the first trader can arrive as early as TRADER_GAP_FIRST',
      freshTimers(() => 0).trader, TRADER_GAP_FIRST);
    eq('...and as late as that plus the whole jitter',
      freshTimers(() => 1).trader, TRADER_GAP_FIRST + TRADER_GAP_FIRST_JITTER);
  }
}

// --- docking has one rule ---------------------------------------------------

// It had two. `arrived` in docking.ts, which NPC traders dock on and which
// has NO roll test, and a re-implementation in game.ts checkStation() with a
// bounding box, a slot channel and a roll test. An NPC could thread a
// letterbox the player could not, and only the NPC's half was testable.
//
// The letterbox stands UPRIGHT in station-local coordinates — the released
// Coriolis slot is 20 wide by 60 tall — so a ship docks with its wings along
// the station's local Y, and a level ship is the one that misses.

console.log('\ndocking');
{
  const station = new THREE.Object3D();
  station.updateMatrixWorld(true);
  const DOCK_Z = 160;
  const scratch = { v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3() };
  const level = new THREE.Quaternion();
  /** wings across the slot's long axis: the roll a Coriolis approach wants */
  const quarter = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const rolledFrom = (off: number) => new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2 + off);
  const at = (x: number, y: number, z: number, q = quarter) =>
    dockingOutcome(new THREE.Vector3(x, y, z), q, station, DOCK_Z, scratch);

  check('far away is clear', at(0, 0, 5000) === 'clear');
  check('lined up in the slot, rolled with it, is docked',
    at(0, 0, -(DOCK_Z - 20)) === 'docked');
  check('...and level — across the upright slot — is a slot miss',
    at(0, 0, -(DOCK_Z - 20), level) === 'slotMiss');
  check('off to the side of the face is the hull', at(120, 0, -(DOCK_Z - 20)) === 'hull');
  check('too far along the channel is the hull', at(0, 90, -(DOCK_Z - 20)) === 'hull');
  check('...and a little off it either way is not',
    at(0, 40, -(DOCK_Z - 20)) === 'docked' && at(20, 0, -(DOCK_Z - 20)) === 'docked');
  check('the far side of the station is the hull', at(0, 0, DOCK_Z - 20) === 'hull');
  {
    // the roll tolerance is a real edge, not a formality
    check('just inside the roll tolerance docks',
      at(0, 0, -(DOCK_Z - 20), rolledFrom(ROLL_TOLERANCE - 0.05)) === 'docked');
    check('just outside it does not',
      at(0, 0, -(DOCK_Z - 20), rolledFrom(ROLL_TOLERANCE + 0.05)) === 'slotMiss');
    check('...and the tolerance is unchanged either side of the quarter turn',
      at(0, 0, -(DOCK_Z - 20), rolledFrom(-(ROLL_TOLERANCE - 0.05))) === 'docked'
      && at(0, 0, -(DOCK_Z - 20), rolledFrom(-(ROLL_TOLERANCE + 0.05))) === 'slotMiss');
  }
}

// --- who is hunting whom, across a reload -----------------------------------

// The hunting links are the one part of a ship that is not in NpcState: they
// are references, so they are saved as indices and rebuilt here. The bug this
// guards is on record — a reloaded fleeing trader had no attackers, so
// nearestAttacker() returned null and the prey stopped running.

console.log('\nhunting links survive a reload');
{
  seedWorld(6_070_809);
  const world = new World();
  world.build(g1[7]);
  world.clearNpcs();
  const trader = world.spawn('trader', new THREE.Vector3(0, 0, 0), 11);
  const pirate = world.spawn('pirate', new THREE.Vector3(500, 0, 0), 13);
  const police = world.spawn('police', new THREE.Vector3(-500, 0, 0), 17);
  pirate.npcTarget = trader;
  trader.addAttacker(pirate);
  police.npcTarget = pirate;   // the law registers nothing — see world.ts
  trader.state.fleeing = true;

  const saved = world.captureNpcs();
  world.restoreNpcs(saved, () => undefined);
  const [t2, p2, c2] = world.npcs;

  check('the fleet comes back whole', world.npcs.length === 3
    && t2.role === 'trader' && p2.role === 'pirate' && c2.role === 'police');
  check('the pirate is still hunting the trader', p2.npcTarget === t2);
  check('...and the trader still knows it — the reload that broke this once',
    t2.hasAttacker(p2));
  check('...and is still running', t2.state.fleeing);
  check('the police still chase the pirate', c2.npcTarget === p2);
  check('...but do NOT register as its attackers, as in a live run',
    !p2.hasAttacker(c2));
}
