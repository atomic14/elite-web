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
