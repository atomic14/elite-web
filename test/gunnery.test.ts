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
  LASER_PACING,
  playerLaser,
  playerLaserHit,
  AIM_ASSIST,
} from '../src/game/gunnery.ts';
import {
  npcMissileEmergency, MISSILE_COMMIT_PASSES, MISSILE_MAX_RANGE,
  MISSILE_LAST_STAND_HULL, MISSILE_LAST_STAND_GATE, MISSILE_LAST_STAND_MIN_RANGE,
} from '../src/game/missile-launch.ts';
import { freshSystems } from '../src/game/systems.ts';
import { COBRA_MK_3_HULL_ID, PLAYER_HULL_IDS } from '../src/game/ship-identity.ts';
import { check, eq } from './harness.ts';

// --- the player's guns ------------------------------------------------------

// systems.ts owns the heat and the cooldown; gunnery.ts decides what pulling
// the trigger means. Finding what the shot hit stays in game.ts — that is a
// raycast against the scene graph, and there is no honest way to test it
// without the hulls.

console.log('\ngunnery');
{
  // A commander now, not an equipment list: which of the 15 flyable hulls is
  // being flown is half of what a fitted laser hits for (TODO 26).
  const equip = (over: Record<string, unknown> = {}) => ({
    shipId: COBRA_MK_3_HULL_ID,
    equipment: {
      laser: 'pulse', rearLaser: false, leftLaser: false, rightLaser: false, ...over,
    },
  }) as Parameters<typeof laserForView>[0];

  check('the front mount carries whatever is fitted',
    laserForView(equip({ laser: 'military' }), 0)?.type === 'military');
  check('an empty rear mount does not fire', laserForView(equip(), 1) === null);
  check('a purchased rear mount fires a PULSE laser, whatever is up front',
    laserForView(equip({ laser: 'military', rearLaser: true }), 1)?.type === 'pulse');
  check('left and right mounts behave the same way',
    laserForView(equip({ leftLaser: true }), 2) !== null
    && laserForView(equip({ rightLaser: true }), 3) !== null
    && laserForView(equip({ leftLaser: true }), 3) === null);
  check('...and every mount carries its own cadence and heat, unchanged',
    laserForView(equip({ laser: 'beam' }), 0)?.cooldown === LASER_PACING.beam.cooldown
    && laserForView(equip({ laser: 'beam' }), 0)?.heat === LASER_PACING.beam.heat);

  // The exact hit, resolved from (hull, fitted laser) — the pack's own bytes.
  // A Cobra Mk III's pulse is an 18-byte, so 9; its military is 24, so 12.
  eq('a Cobra Mk III pulse laser is a 9-point hit',
    laserForView(equip(), 0)?.hit, 9);
  eq('...and its military laser a 12-point one',
    laserForView(equip({ laser: 'military' }), 0)?.hit, 12);
  eq('the HULL decides too: an Anaconda military laser is a 63-point hit',
    playerLaserHit(PLAYER_HULL_IDS[14], 'military'), 63);
  eq('...and all four source laser types answer, mining included',
    playerLaserHit(COBRA_MK_3_HULL_ID, 'mining'), 25);
  check('the mining laser has no live MOUNT yet — the redesign is deferred',
    !Object.prototype.hasOwnProperty.call(LASER_PACING, 'mining'));
  eq('a fitted mount is its pacing plus its hit', JSON.stringify(playerLaser(COBRA_MK_3_HULL_ID, 'pulse')),
    JSON.stringify({ ...LASER_PACING.pulse, hit: 9, type: 'pulse' }));

  {
    const sys = freshSystems();
    check('a cool, ready laser fires', canFire(sys));
    chargeShot(sys, LASER_PACING.pulse);
    check('...and then has to cool down', !canFire(sys));
    sys.laserCooldown = 0;
    check('...and fires again once it has', canFire(sys));
    sys.laserTemp = 0.99;
    check('an overheated laser cuts out', !canFire(sys));
  }
  {
    // all mounts share one heat budget — a documented simplification
    const sys = freshSystems();
    for (let i = 0; i < 30; i++) { sys.laserCooldown = 0; if (canFire(sys)) chargeShot(sys, LASER_PACING.pulse); }
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
    // ...and the NPC's choice of weapon, which is gunnery.ts's too.
    //
    // A missile is EXPENSIVE and there is no resupply, so it is spent for a
    // reason rather than rolled for in a comfortable band. Chris: "missiles are
    // expensive, they should be used in emergencies — e.g. when your opponent
    // turns out to be tougher than you thought."
    //
    // The band-and-dice rule this replaced is worth stating, because deleting
    // it was the fix rather than a tidy-up: an NPC preferred a missile at
    // 1,200-3,200 units, which is exactly the range at which it is NOT
    // engaging. Six organised pirates duly sat at a median of 2,705, made zero
    // passes, and killed a commander in 9.1 seconds without ever being fought.
    const healthy = 1;
    const dying = MISSILE_LAST_STAND_HULL - 0.01;
    const OK_RANGE = 800;

    check('a healthy ship on its first run keeps its missile',
      !npcMissileEmergency(healthy, 0, 0, OK_RANGE, 0));
    check('...and still keeps it on the second run',
      !npcMissileEmergency(healthy, MISSILE_COMMIT_PASSES - 1, 0, OK_RANGE, 0));

    // Reason 1: about to die. The old `npcMissileLastStand`, folded in.
    check('a ship about to die spends it rather than take it down',
      npcMissileEmergency(dying, 0, 0, OK_RANGE, 0));
    check('...exactly at the threshold, not just below it',
      npcMissileEmergency(MISSILE_LAST_STAND_HULL, 0, 0, OK_RANGE, 0)
      && !npcMissileEmergency(MISSILE_LAST_STAND_HULL + 0.01, 0, 0, OK_RANGE, 0));

    // Reason 2: this is not working. It has flown at the target and the target
    // is still there — the discovery that it is tougher than expected.
    check('a ship that has committed twice and got nowhere spends one',
      npcMissileEmergency(healthy, MISSILE_COMMIT_PASSES, 0, OK_RANGE, 0));

    // Reason 3: the gang is losing.
    check('a ship whose wingman is already dead spends one',
      npcMissileEmergency(healthy, 0, 1, OK_RANGE, 0));

    // The geometry gates apply to EVERY reason, not only the desperate one.
    // That is the point of there being one function: the reasons cannot drift
    // apart from the envelope.
    check('never point blank, whatever the reason — the player could not answer',
      !npcMissileEmergency(dying, 9, 9, MISSILE_LAST_STAND_MIN_RANGE - 1, 0));
    check('never from further out than the seeker is worth',
      !npcMissileEmergency(dying, 9, 9, MISSILE_MAX_RANGE + 1, 0));
    check('on a bearing rather than a firing line, because the seeker aims',
      npcMissileEmergency(dying, 0, 0, OK_RANGE, MISSILE_LAST_STAND_GATE - 0.01));
    check('...but never at something behind it',
      !npcMissileEmergency(dying, 9, 9, OK_RANGE, MISSILE_LAST_STAND_GATE + 0.01));

    // THE REGRESSION. This is the wave-13 fight, as a number: a healthy ship
    // that has not engaged, sitting where the old rule paid it to sit.
    check('a healthy ship standing off at 2,705 cannot launch at all',
      !npcMissileEmergency(healthy, 0, 0, 2705, 0));
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
  const reply = (r: ReturnType<Ordnance['arm']>) => r.reply;

  {
    const { ord, cmdr } = armed();
    const armedResult = ord.arm(cmdr);
    const unarmedResult = ord.arm(cmdr);
    check('arming is a toggle',
      reply(armedResult) === 'armed' && reply(unarmedResult) === 'unarmed');
    eq('arming reports its named sound alongside the reply',
      `${armedResult.events[0]?.kind}:${armedResult.events[0]?.kind === 'sound'
        ? armedResult.events[0].name : ''}|${armedResult.reply}`,
      'sound:missileArmed|armed');
    cmdr.missiles = 0;
    check('...but not with an empty rack', reply(ord.arm(cmdr)) === 'noMissiles');
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a ship in the sight locks',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)).reply === 'locked'
      && ord.targetLock === npc);
    check('...and re-arming says so, rather than dropping it',
      ord.arm(cmdr).reply === 'alreadyLocked' && ord.targetLock === npc);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('asteroid', at(0, 0, -800), 1);
    ord.arm(cmdr);
    check('a rock does not', ord.updateLock(at(0, 0, 0), at(0, 0, -1)).reply === null);
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, 800), 1); // behind
    ord.arm(cmdr);
    check('nor does something behind you',
      ord.updateLock(at(0, 0, 0), at(0, 0, -1)).reply === null);
  }
  {
    const { world, ord, cmdr } = armed();
    const npc = world.spawn('pirate', at(0, 0, -800), 1);
    const refused = ord.launch(cmdr, at(0, 0, 0));
    check('firing without a lock is refused',
      refused.reply === 'noLock' && cmdr.missiles === 4);
    eq('a refused launch reports sound before its message is applied',
      `${refused.events[0]?.kind === 'sound' ? refused.events[0].name : ''}|${refused.reply}`,
      'refused|noLock');
    ord.arm(cmdr);
    ord.updateLock(at(0, 0, 0), at(0, 0, -1));
    check('firing with one spends a missile and puts it in the sky',
      ord.launch(cmdr, at(0, 0, 0)).reply === 'away'
      && cmdr.missiles === 3 && ord.missiles.length === 1);
    check('...and leaves the launcher empty-handed',
      ord.targetLock === null && !ord.armed);

    // it should reach an 800-unit target well inside its life
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 600 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    check('a missile runs its target down',
      events.some((e) => e.kind === 'hitNpc' && e.npc === npc));
    check('...and is gone from the sky afterwards', ord.missiles.length === 0);
  }
  {
    const { ord, cmdr } = armed();
    ord.launchHostile(at(0, 0, -2000));
    check('an incoming missile hits the player',
      ord.missiles.length === 1);
    let events: ReturnType<typeof ord.step> = [];
    for (let i = 0; i < 900 && !events.length; i++) events = ord.step(1 / 60, at(0, 0, 0));
    // The event reports the IMPACT; what a warhead is worth is the step's, from
    // `IMPACT.warhead` — see game/impact-damage.ts.
    check('...and reports the impact for the step to bill',
      events.some((e) => e.kind === 'hitPlayer'));

    // E.C.M. kills everything in the sky, ours included
    ord.launchHostile(at(0, 0, -2000));
    const low = ord.triggerEcm(cmdr, ECM_ENERGY_COST - 0.01);
    check('E.C.M. needs energy',
      low.reply === 'noEnergy' && ord.missiles.length === 1);
    // ...and it may not spend the LAST of it. A burst at exactly its cost left
    // the bank at 0 with the ship still flying — a state nothing else in the
    // model can reach, and one in which a hit a full shield swallowed read as a
    // kill (TODO 48). The whole walk is test/energy-low.test.ts.
    const exact = ord.triggerEcm(cmdr, ECM_ENERGY_COST);
    check('...and will not spend the last point of the bank',
      exact.reply === 'noEnergy' && ord.missiles.length === 1);
    const fired = ord.triggerEcm(cmdr, ECM_ENERGY_COST + 1);
    check('...and clears the sky when it has it',
      fired.reply === 'ecmFired' && ord.missiles.length === 0);
    eq('E.C.M. reports its named outcome without raw audio details',
      `${fired.events[0]?.kind === 'sound' ? fired.events[0].name : ''}|${fired.reply}`,
      'ecm|ecmFired');
    cmdr.equipment.ecm = false;
    check('...and is refused when not fitted', ord.triggerEcm(cmdr, 10).reply === 'noEcm');
  }
  {
    const { world, ord, cmdr } = armed();
    world.spawn('pirate', at(0, 0, -100), 1);
    world.spawn('thargoid', at(0, 0, -100), 2);
    world.spawn('pirate', at(0, 0, -900_000), 3);
    const r = ord.detonateEnergyBomb(cmdr, at(0, 0, 0));
    check('the energy bomb catches what is close', r.reply === 'bombFired' && r.caught.length === 1);
    eq('the bomb reports explosion before the caught ships are applied',
      `${r.events[0]?.kind === 'sound' ? r.events[0].name : ''}|${r.reply}`,
      'explosion|bombFired');
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
