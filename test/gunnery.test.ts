// The guns: cadence, cone, what a shot hits, and the missiles.
//
// NPC_GUN and LASER are asserted EQUAL across the sim and the game rather than
// documented as a ratio (invariant 5). The 5.4x gap between them went undetected
// for six training rounds and is the most expensive bug in this project's history.

import * as THREE from 'three';
import { traceShot } from '../src/game/shot.ts';
import { Ordnance, ordnanceMessage, ECM_ENERGY_COST } from '../src/game/ordnance.ts';
import { World } from '../src/game/world.ts';
import type { CommanderData } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import {
  laserForView,
  canFire,
  chargeShot,
  assistAt,
  hitCone,
  canisterCone,
  LASERS,
  AIM_ASSIST,
  npcPrefersMissile,
  npcMissileLastStand,
  MISSILE_MIN_RANGE,
  MISSILE_MAX_RANGE,
  MISSILE_CHANCE,
  MISSILE_LAST_STAND_HULL,
  MISSILE_LAST_STAND_GATE,
  MISSILE_LAST_STAND_MIN_RANGE,
} from '../src/game/gunnery.ts';
import { freshSystems } from '../src/game/systems.ts';
import { check } from './harness.ts';

// --- the player's guns ------------------------------------------------------

// systems.ts owns the heat and the cooldown; gunnery.ts decides what pulling
// the trigger means. Finding what the shot hit stays in game.ts — that is a
// raycast against the scene graph, and there is no honest way to test it
// without the hulls.

console.log('\ngunnery');
{
  const equip = (over: Record<string, unknown> = {}) => ({
    laser: 'pulse', rearLaser: false, leftLaser: false, rightLaser: false, ...over,
  }) as Parameters<typeof laserForView>[0];

  check('the front mount carries whatever is fitted',
    laserForView(equip({ laser: 'military' }), 0)?.damage === LASERS.military.damage);
  check('an empty rear mount does not fire', laserForView(equip(), 1) === null);
  check('a purchased rear mount fires a PULSE laser, whatever is up front',
    laserForView(equip({ laser: 'military', rearLaser: true }), 1)?.damage === LASERS.pulse.damage);
  check('left and right mounts behave the same way',
    laserForView(equip({ leftLaser: true }), 2) !== null
    && laserForView(equip({ rightLaser: true }), 3) !== null
    && laserForView(equip({ leftLaser: true }), 3) === null);

  {
    const sys = freshSystems();
    check('a cool, ready laser fires', canFire(sys));
    chargeShot(sys, LASERS.pulse);
    check('...and then has to cool down', !canFire(sys));
    sys.laserCooldown = 0;
    check('...and fires again once it has', canFire(sys));
    sys.laserTemp = 0.99;
    check('an overheated laser cuts out', !canFire(sys));
  }
  {
    // all mounts share one heat budget — a documented simplification
    const sys = freshSystems();
    for (let i = 0; i < 30; i++) { sys.laserCooldown = 0; if (canFire(sys)) chargeShot(sys, LASERS.pulse); }
    check('held fire eventually overheats the gun', !canFire(sys));
  }
  {
    check('the assist is full at knife range', assistAt(0) === AIM_ASSIST);
    check('...tapers with distance',
      assistAt(1500) > 0 && assistAt(1500) < AIM_ASSIST);
    check('...and is gone by the fade-out range', assistAt(3000) === 0);
    check('a bigger ship is easier to hit at the same range',
      hitCone(34, 1000) > hitCone(18, 1000));
    check('the same ship is harder to hit further away',
      hitCone(18, 2000) < hitCone(18, 500));
    check('cargo gets a flat tolerance and no assist',
      canisterCone(500) > 0 && canisterCone(3000) < canisterCone(500));
  }
  {
    // ...and the NPC's choice of weapon, which is gunnery.ts's too. The
    // opportunistic launch: a comfortable band, and dice.
    const mid = (MISSILE_MIN_RANGE + MISSILE_MAX_RANGE) / 2;
    check('an NPC swaps a bolt for a missile at a comfortable range',
      npcPrefersMissile(mid, MISSILE_CHANCE - 0.01));
    check('...only sometimes', !npcPrefersMissile(mid, MISSILE_CHANCE + 0.01));
    check('...and never at knife range or across the system',
      !npcPrefersMissile(MISSILE_MIN_RANGE - 1, 0) && !npcPrefersMissile(MISSILE_MAX_RANGE + 1, 0));

    // The last stand: a pirate that is about to die should not take its
    // missiles down with it.
    const dying = MISSILE_LAST_STAND_HULL - 0.01;
    check('a healthy ship saves its missile for a better moment',
      !npcMissileLastStand(1, 800, 0));
    check('...and a ship this close to death spends it',
      npcMissileLastStand(dying, 800, 0));
    check('...exactly at the threshold, not just below it',
      npcMissileLastStand(MISSILE_LAST_STAND_HULL, 800, 0)
      && !npcMissileLastStand(MISSILE_LAST_STAND_HULL + 0.01, 800, 0));
    check('it launches where it would never bother with one otherwise',
      npcMissileLastStand(dying, MISSILE_MIN_RANGE - 100, 0)
      && !npcPrefersMissile(MISSILE_MIN_RANGE - 100, 0));
    check('...on a bearing rather than a firing line, because the seeker aims',
      npcMissileLastStand(dying, 800, MISSILE_LAST_STAND_GATE - 0.01));
    check('...but not at something behind it',
      !npcMissileLastStand(dying, 800, MISSILE_LAST_STAND_GATE + 0.01));
    check('...nor point blank, where the player could not answer it',
      !npcMissileLastStand(dying, MISSILE_LAST_STAND_MIN_RANGE - 1, 0));
    check('...nor from further out than the seeker is worth',
      !npcMissileLastStand(dying, MISSILE_MAX_RANGE + 1, 0));
  }
}

// --- what the shot hit ------------------------------------------------------

// I nearly left this in game.ts on the grounds that a raycast cannot be tested
// without the hulls. Wrong: three.js maths runs under node with no canvas, so
// the hulls can just be BUILT here. They are.

console.log('\nshot tracing');
{
  const box = (x: number, y: number, z: number, size = 40) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
    o.position.set(x, y, z);
    o.updateMatrixWorld(true);
    return o;
  };
  const ship = (x: number, y: number, z: number, over: Record<string, unknown> = {}) =>
    ({ object: box(x, y, z), state: { alive: true }, radius: 20, ...over });
  const ray = new THREE.Raycaster();
  const scratch = new THREE.Vector3();
  const origin = new THREE.Vector3(0, 0, 0);
  const ahead = new THREE.Vector3(0, 0, -1);
  const trace = (ships: unknown[], cargo: unknown[] = [], station: THREE.Object3D | null = null) =>
    traceShot(origin, ahead, ships as never, cargo as never, station, ray, scratch);

  check('a shot down the axis hits the ship in front of it',
    trace([ship(0, 0, -500)]).kind === 'ship');
  check('a shot into empty space misses',
    trace([ship(0, 6000, -500)]).kind === 'miss');
  check('a destroyed ship does not stop the beam',
    trace([ship(0, 0, -500, { state: { alive: false } })]).kind === 'miss');
  {
    const near = ship(0, 0, -300), far = ship(0, 0, -900);
    const hit = trace([far, near]);
    check('the NEAREST ship is hit, whatever order they are listed in',
      hit.kind === 'ship' && (hit as { ship: unknown }).ship === near);
  }
  check('beyond laser range, nothing is hit',
    trace([ship(0, 0, -9000)]).kind === 'miss');
  check('drifting cargo is solid',
    trace([], [{ object: box(0, 0, -400, 12) }]).kind === 'cargo');
  check('the station is solid',
    trace([], [], box(0, 0, -600, 300)).kind === 'station');
  {
    // the station wins a tie because anything at a shorter ray distance
    // "behind" it is in fact inside it
    const hit = trace([ship(0, 0, -700)], [], box(0, 0, -600, 400));
    check('the station stops a shot aimed at a ship inside it', hit.kind === 'station');
  }
  {
    // the graze pass: a near miss inside the assist cone still connects
    const offset = ship(14, 0, -400);
    check('a near miss inside the assist envelope still counts',
      trace([offset]).kind === 'ship');
    const wide = ship(300, 0, -400);
    check('...and a genuine miss does not', trace([wide]).kind === 'miss');
  }
}

// --- ordnance ---------------------------------------------------------------
//
// The point of these: there is no Game here, and no HUD. Ordnance used to need
// a context object with a message() callback, so none of this was reachable.

console.log('\nordnance');
{
  // Seeded: World.spawn and wreck() both draw from the global stream, so
  // without this the block inherits whatever position the tests above left.
  // The ordnance block in particular survives today only because pirate hulls
  // happen to have no ecmChance — give them one and a missile test becomes a
  // coin flip on stream position.
  seedWorld(7_070_707);
  const armed = () => {
    const world = new World();
    const ord = new Ordnance(world);
    const cmdr = {
      missiles: 4, equipment: { ecm: true, energyBomb: true },
    } as unknown as CommanderData;
    return { world, ord, cmdr };
  };
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  {
    const { ord, cmdr } = armed();
    check('arming is a toggle', ord.arm(cmdr) === 'armed' && ord.arm(cmdr) === 'unarmed');
    cmdr.missiles = 0;
    check('...but not with an empty rack', ord.arm(cmdr) === 'noMissiles');
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a ship in the sight locks',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === 'locked' && ord.targetLock === npc);
    check('...and re-arming says so, rather than dropping it',
      ord.arm(cmdr) === 'alreadyLocked' && ord.targetLock === npc);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('asteroid', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a rock does not', ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === null);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, 800), 1); // behind
    ord.arm(cmdr);
    check('nor does something behind you',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)) === null);
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    check('firing without a lock is refused',
      ord.launch(cmdr, at(0, 0, 0)) === 'noLock' && cmdr.missiles === 4);
    ord.arm(cmdr);
    ord.updateLock(at(0, 0, 0), at(0, 0, -1));
    check('firing with one spends a missile and puts it in the sky',
      ord.launch(cmdr, at(0, 0, 0)) === 'away'
      && cmdr.missiles === 3 && ord.missiles.length === 1);
    check('...and leaves the launcher empty-handed',
      ord.targetLock === null && !ord.armed);

    // it should reach an 800-unit target well inside its life
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 600 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    check('a missile runs its target down',
      events.some((e) => e.kind === 'killed' && e.npc === npc));
    check('...and is gone from the sky afterwards', ord.missiles.length === 0);
  }
  {
    const { ord, cmdr } = armed();
    ord.launchHostile(at(0, 0, -2000));
    check('an incoming missile hits the player',
      ord.missiles.length === 1);
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 900 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    check('...for real damage', events.some((e) => e.kind === 'hitPlayer' && e.damage > 0));

    // E.C.M. kills everything in the sky, ours included
    ord.launchHostile(at(0, 0, -2000));
    check('E.C.M. needs energy',
      ord.triggerEcm(cmdr, ECM_ENERGY_COST - 0.01) === 'noEnergy' && ord.missiles.length === 1);
    check('...and clears the sky when it has it',
      ord.triggerEcm(cmdr, ECM_ENERGY_COST) === 'ecmFired' && ord.missiles.length === 0);
    cmdr.equipment.ecm = false;
    check('...and is refused when not fitted', ord.triggerEcm(cmdr, 10) === 'noEcm');
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, -100), 1);
    world.spawn('thargoid', at(0, 0, -100), 2);
    world.spawn('pirate', at(0, 0, -900_000), 3);
    const r = ord.detonateEnergyBomb(cmdr, at(0, 0, 0));
    check('the energy bomb catches what is close', r.reply === 'bombFired' && r.caught.length === 1);
    check('...thargoids shrug it off',
      !r.caught.some((n) => n.role === 'thargoid'));
    check('...and it is a one-shot',
      ord.detonateEnergyBomb(cmdr, at(0, 0, 0)).reply === 'noBomb');
  }
  check('every reply has a line', ([
    'noMissiles', 'alreadyLocked', 'armed', 'unarmed', 'locked', 'noLock', 'away',
    'incoming', 'noEcm', 'noEnergy', 'ecmFired', 'noBomb', 'bombFired',
  ] as const).every((r) => ordnanceMessage(r).text.length > 0));
}
