// Populating a system: who is here, who arrives, and docking.
//
// Pure rule modules with an injectable rng (population.ts, encounters.ts), so
// these drive them directly rather than through a Game.

import * as THREE from 'three';
import { dockingOutcome, ROLL_TOLERANCE } from '../src/game/docking.ts';
import { stepEncounters } from '../src/game/encounters.ts';
import { planPopulation, policeFor } from '../src/game/population.ts';
import { World } from '../src/game/world.ts';
import { seedWorld } from '../src/game/rng.ts';
import { launchStationDefence } from '../src/game/spawning.ts';
import { isHostileToPlayer, type NpcShip } from '../src/game/npc.ts';
import { g1 } from './fixtures.ts';
import { check } from './harness.ts';

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
    const swamped = planPopulation(sys(4), 'arrival', 99, null, half);
    check('...capped so a system never drowns in them', swamped.traders === 4);
    const quiet = planPopulation(sys(4), 'arrival', 0, null, half);
    check('...and there is always at least one', quiet.traders >= 1);
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
  check('...but not once the system is already busy',
    until({ trader: 1, pirateWave: 1e9, thargon: 1e9 }, conds({ traderCount: 4 }), 'trader', 400) === null);
  check('nothing arrives in witch-space',
    until({ trader: 1, pirateWave: 1, thargon: 1e9 }, conds({ witchspace: true }), 'trader', 400) === null);

  {
    const anarchy = until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
      conds({ government: 0 }), 'pirateWave');
    check('anarchies send pirates two at a time',
      anarchy !== null && (anarchy as { count: number }).count === 2);
    const rough = until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
      conds({ government: 3 }), 'pirateWave');
    check('a merely lawless system sends one',
      rough !== null && (rough as { count: number }).count === 1);
    check('a corporate state sends none',
      until({ trader: 1e9, pirateWave: 1, thargon: 1e9 }, conds({ government: 7 }), 'pirateWave', 600) === null);
    check('and nobody ambushes you on the station doorstep',
      until({ trader: 1e9, pirateWave: 1, thargon: 1e9 },
        conds({ government: 0, playerFarFromStation: false }), 'pirateWave', 600) === null);
  }
  {
    check('a mothership deploys drones',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds({ hasThargoidMother: true }), 'thargon') !== null);
    check('...up to a limit',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 },
        conds({ hasThargoidMother: true, activeThargons: 4 }), 'thargon', 200) === null);
    check('...and not at all without one',
      until({ trader: 1e9, pirateWave: 1e9, thargon: 1 }, conds(), 'thargon', 200) === null);
  }
  {
    // a productive system discounts the gap between arrivals
    const busy = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(busy, 0.1, conds({ productivity: 60_000 }), () => 0);
    const quiet = { trader: 0, pirateWave: 1e9, thargon: 1e9 };
    stepEncounters(quiet, 0.1, conds({ productivity: 0 }), () => 0);
    check('busy economies run busier lanes', busy.trader < quiet.trader);
  }
}

// --- docking has one rule ---------------------------------------------------

// It had two. `arrived` in docking.ts, which NPC traders dock on and which
// has NO roll test, and a re-implementation in game.ts checkStation() with a
// bounding box, a slot channel and a roll test. An NPC could thread a
// letterbox the player could not, and only the NPC's half was testable.

console.log('\ndocking');
{
  const station = new THREE.Object3D();
  station.updateMatrixWorld(true);
  const DOCK_Z = 160;
  const scratch = { v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3() };
  const level = new THREE.Quaternion();
  const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2);
  const at = (x: number, y: number, z: number, q = level) =>
    dockingOutcome(new THREE.Vector3(x, y, z), q, station, DOCK_Z, scratch);

  check('far away is clear', at(0, 0, 5000) === 'clear');
  check('lined up in the slot, level, is docked', at(0, 0, -(DOCK_Z - 20)) === 'docked');
  check('...and rolled 69 degrees is a slot miss',
    at(0, 0, -(DOCK_Z - 20), rolled) === 'slotMiss');
  check('off to the side of the face is the hull', at(120, 0, -(DOCK_Z - 20)) === 'hull');
  check('too high in the channel is the hull', at(0, 40, -(DOCK_Z - 20)) === 'hull');
  check('the far side of the station is the hull', at(0, 0, DOCK_Z - 20) === 'hull');
  {
    // the roll tolerance is a real edge, not a formality
    const just = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_TOLERANCE - 0.05);
    const over = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ROLL_TOLERANCE + 0.05);
    check('just inside the roll tolerance docks', at(0, 0, -(DOCK_Z - 20), just) === 'docked');
    check('just outside it does not', at(0, 0, -(DOCK_Z - 20), over) === 'slotMiss');
  }
}

console.log('\nstation defence');
{
// The station's own Vipers are launched AT you, so they must read hostile.
  //
  // This used to be a regex over game.ts looking for `provokedByPlayer = true`,
  // because the rule was written inline in a file that needs a canvas to build.
  // It is `launchStationDefence` in spawning.ts now, so the check can fly it:
  // the regex would have passed on a line that never ran.
  {
    seedWorld(5_150_515);
    const world = new World();
    world.build(g1[7]);
    const before = world.npcs.length;
    const vipers = launchStationDefence(world, new THREE.Vector3());
    check(`the station launches one or two Vipers (${vipers.length})`,
      vipers.length >= 1 && vipers.length <= 2);
    check('...which are actually in the sky', world.npcs.length === before + vipers.length);
    check('...all of them police', vipers.every((v: NpcShip) => v.role === 'police'));
    check('station defence vipers still come for you',
      vipers.every((v: NpcShip) => isHostileToPlayer(v, 0)));
    check('...and they are stacked down the slot, not spawned on each other',
      new Set(vipers.map((v: NpcShip) => v.object.position.toArray().join())).size === vipers.length);
  }
}
