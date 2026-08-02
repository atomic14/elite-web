// The dashboard reads game state; it does not decide.
//
// The compass rule in particular used to decide where the needle points from
// inside a 100-line render method, so it had never been asserted.

import * as THREE from 'three';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { buildHudFrame, compassTarget, hasLaserInView } from '../src/hud/hud-binding.ts';
import { check } from './harness.ts';

console.log('\nhud binding');
{
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const sources = (over: Record<string, unknown>) => ({
    witchspace: false,
    playerPos: V(0, 0, 0),
    world: {
      planetPos: V(0, 0, 1e6), planetRadius: 1000,
      sunPos: V(0, 0, -1e6), station: { position: V(0, 0, 1e6) },
      npcs: [],
    },
    ...over,
  }) as unknown as Parameters<typeof compassTarget>[0];

  {
    const s = sources({});
    check('far from everything, the compass finds the planet',
      compassTarget(s) === s.world.planetPos);
  }
  {
    const s = sources({ playerPos: V(0, 0, -1e6 + 1000) });
    check('close to the sun it switches, so you can skim by compass',
      compassTarget(s) === s.world.sunPos);
  }
  {
    // inside three planet radii, the station takes over
    const s = sources({ playerPos: V(0, 0, 1e6 - 500) });
    check('near the planet it finds the station',
      compassTarget(s) === s.world.station.position);
  }
  {
    // witch-space banishes the scenery, so the needle hunts Thargoids instead
    const goid = {
      state: { alive: true, inert: false },
      role: 'thargoid',
      object: { position: V(1, 2, 3) },
    };
    const s = sources({ witchspace: true, world: { ...sources({}).world, npcs: [goid] } });
    check('in witch-space it tracks the nearest Thargoid',
      compassTarget(s) === goid.object.position);
    const dead = { ...goid, state: { ...goid.state, alive: false } };
    const s2 = sources({ witchspace: true, world: { ...sources({}).world, npcs: [dead] } });
    check('...and a dead one does not count',
      compassTarget(s2) !== dead.object.position);
  }
  {
    // the sun is 130k away here, but witch-space must win over the sun rule
    const s = sources({ witchspace: true, playerPos: V(0, 0, -1e6 + 1000) });
    check('witch-space beats the sun-skim rule', compassTarget(s) !== s.world.sunPos);
  }

  {
    const kit = (over: Record<string, boolean>) =>
      ({ equipment: { rearLaser: false, leftLaser: false, rightLaser: false, ...over } }) as never;
    check('the front mount always has a gun', hasLaserInView(kit({}), 0));
    check('...the others only when bought',
      !hasLaserInView(kit({}), 1) && hasLaserInView(kit({ rearLaser: true }), 1));
    check('...and each view reads its own mount',
      hasLaserInView(kit({ leftLaser: true }), 2)
      && !hasLaserInView(kit({ leftLaser: true }), 3));
  }

  {
    const state = freshState(newCommander());
    const playerPos = state.player.position;
    const playerQuat = state.player.quaternion;
    const planetPos = V(0, 0, 1e6);
    const stationPos = V(0, 0, 1e6);
    const world = {
      planetPos,
      planetRadius: 1000,
      sunPos: V(0, 0, -1e6),
      station: { position: stationPos },
      npcs: [],
    };
    const frame = buildHudFrame({
      commander: state.commander,
      sys: state.sys,
      world,
      camera: new THREE.PerspectiveCamera(),
      playerPos,
      playerQuat,
      playerForward: V(0, 0, -1),
      viewDir: V(0, 0, -1),
      speedFrac: 0.25,
      rollFrac: 0,
      pitchFrac: 0,
      view: 0,
      missiles: [],
      canisters: [],
      targetLock: null,
      missileArmed: false,
      inFlight: false,
      witchspace: false,
      assist: false,
      ecmDetected: false,
      messageText: 'FRAME COMPLETE',
      messageTimer: 1.5,
      exercise: null,
    } as unknown as Parameters<typeof buildHudFrame>[0], {
      a: V(0, 0, 0), b: V(0, 0, 0), c: V(0, 0, 0), q: new THREE.Quaternion(),
    });
    check('one HUD frame contains the message and every spatial painter input',
      frame.messageText === 'FRAME COMPLETE' && frame.messageTimer === 1.5
      && Array.isArray(frame.contacts) && Array.isArray(frame.targets));
    check('the HUD frame keeps live transforms and compass targets by reference',
      frame.playerPos === playerPos && frame.playerQuat === playerQuat
      && frame.compassTarget === planetPos
      && frame.contacts[0]?.position === stationPos);
    check('the complete HUD frame has no second nested state definition',
      !('state' in frame));

    // The exercise strip is HANDED to the dashboard, never decided by it: the
    // running exercise is the only thing that knows there is one
    // (game/combat-sim-strip.ts). Career flight is handed null, and gets null.
    check('career flight carries no exercise strip', frame.exercise === null);
    const strip = { scenario: 'Pirate gang', mode: 'waves' } as never;
    const flown = buildHudFrame({
      commander: state.commander, sys: state.sys, world,
      camera: new THREE.PerspectiveCamera(), playerPos, playerQuat,
      playerForward: V(0, 0, -1), viewDir: V(0, 0, -1),
      missiles: [], canisters: [], targetLock: null, inFlight: false,
      exercise: strip,
    } as unknown as Parameters<typeof buildHudFrame>[0], {
      a: V(0, 0, 0), b: V(0, 0, 0), c: V(0, 0, 0), q: new THREE.Quaternion(),
    });
    check('...and an exercise\'s own strip reaches the painter unchanged',
      flown.exercise === strip);
  }
}
