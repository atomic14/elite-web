// Threading the slot: every threshold in constants/docking.ts and the docking
// computer's hand, held to the real functions.
//
// The shape throughout is the measured one (docs/TODO/90, slice 5): each
// boundary is BISECTED out of `dockingOutcome`/`planDocking` or SOLVED back
// out of a real `WorldStep` frame, then compared to the constant that claims
// to say it. Probing at `CONSTANT ± 1` would be vacuous — the probe moves with
// the constant — so none of these do; a re-inlined literal in the function
// goes red here however the constant moves. What an outcome MEANS (docked,
// slotMiss, hull) is test/world.test.ts's docking section; this file is about
// WHERE the edges are.

import * as THREE from 'three';
import {
  dockingOutcome, planDocking, makeDockPlan, type DockingOutcome,
} from '../src/game/docking.ts';
import {
  GATE_HALF_WIDTHS, LINED_UP_LATERAL, HULL_BOX_MARGIN, NPC_HULL_BOX_MARGIN,
  SLOT_HALF_ACROSS, SLOT_HALF_ALONG, SLOT_DEPTH, ROLL_TOLERANCE,
} from '../src/constants/docking.ts';
import {
  DC_TURN_RATE, DC_THROTTLE_GAIN,
} from '../src/constants/docking-computer.ts';
import { BOUNCE_STANDOFF } from '../src/constants/station.ts';
import { WorldStep, type StepHost } from '../src/game/world-step.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { slotNormal } from '../src/world/slot.ts';
import type { DamageSource } from '../src/game/combat.ts';
import { check } from './harness.ts';

/** The edge between `inside(lo)` and `!inside(hi)`, to a millionth of a unit. */
function bisect(lo: number, hi: number, inside: (x: number) => boolean): number {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) < tol;

// --- the slot's edges, bisected out of dockingOutcome ------------------------

console.log('\ndocking thresholds');
{
  const station = new THREE.Object3D();
  station.updateMatrixWorld(true);
  const DOCK_Z = 160;
  const scratch = { v: new THREE.Vector3(), q: new THREE.Quaternion(), r: new THREE.Vector3() };
  /** wings along the upright slot: the roll a docking wants */
  const quarter = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const at = (x: number, y: number, z: number, q = quarter): DockingOutcome =>
    dockingOutcome(new THREE.Vector3(x, y, z), q, station, DOCK_Z, scratch);

  const cube = bisect(DOCK_Z, DOCK_Z + 200, (x) => at(x, 0, 0) !== 'clear');
  check(`the bounding cube ends at dockZ + HULL_BOX_MARGIN (${cube.toFixed(3)})`,
    near(cube, DOCK_Z + HULL_BOX_MARGIN));

  const inMouth = -(DOCK_Z - 20);
  const across = bisect(0, 200, (x) => at(x, 0, inMouth) === 'docked');
  check(`the channel is SLOT_HALF_ACROSS wide (${across.toFixed(3)})`,
    near(across, SLOT_HALF_ACROSS));

  const along = bisect(0, 200, (y) => at(0, y, inMouth) === 'docked');
  check(`...and SLOT_HALF_ALONG tall (${along.toFixed(3)})`,
    near(along, SLOT_HALF_ALONG));

  // walking OUT of the slot mouth: docked until the channel's floor
  const depth = bisect(inMouth, 0, (z) => at(0, 0, z) === 'docked');
  check(`...and starts SLOT_DEPTH into the face (${(DOCK_Z + depth).toFixed(3)})`,
    near(DOCK_Z + depth, SLOT_DEPTH));

  const rolled = (off: number) => new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2 + off);
  const roll = bisect(0, Math.PI / 4, (off) => at(0, 0, inMouth, rolled(off)) === 'docked');
  check(`the roll edge is ROLL_TOLERANCE (${roll.toFixed(4)})`,
    near(roll, ROLL_TOLERANCE, 1e-4));
}

// --- the approach's two anchors, out of planDocking --------------------------

{
  const station = new THREE.Object3D();
  station.updateMatrixWorld(true);
  const DOCK_Z = 160;
  // identity quaternion: the slot normal is world -Z and 'across' is world +X
  const plan = (x: number, z: number) =>
    planDocking(new THREE.Vector3(x, 0, z), station, DOCK_Z, 400, makeDockPlan());

  // inside the slot mouth, walking off the axis until `arrived` lets go
  const lateral = bisect(0, 200, (x) => plan(x, -100).arrived);
  check(`a dock arrives within LINED_UP_LATERAL of the axis (${lateral.toFixed(3)})`,
    near(lateral, LINED_UP_LATERAL));

  // Solve the gate distance back out of the heading. From (B, 0, -A) the gate
  // phase aims at slotN * gateDist, so the heading's along/across ratio gives
  // gateDist = A - B * (h.along / h.across) with nothing probed at a constant.
  const A = 3000;
  const B = 500;
  const p = plan(B, -A);
  check('far off the axis is the gate phase', p.phase === 'gate');
  const hAlong = -p.heading.z;             // component along the slot normal
  const hAcross = p.heading.x;
  const gate = A - B * (hAlong / hAcross);
  check(`the gate sits GATE_HALF_WIDTHS half-widths out (${(gate / DOCK_Z).toFixed(4)})`,
    near(gate, DOCK_Z * GATE_HALF_WIDTHS, 1e-6));
}

// --- the computer's hand, solved out of a real WorldStep frame ---------------

// A stub host and a real world: these three blocks fly the actual step, so the
// constants are pinned where they are SPENT — a re-inlined 1.2 or 40 in
// world-step.ts fails here even though planDocking never sees either.

function makeRun() {
  seedWorld(90_101);
  const state = freshState(newCommander());
  state.world.build(state.systems[state.commander.systemIndex]);
  const hits: DamageSource[] = [];
  const host: StepHost = {
    inFlight: () => true,
    applyPlayerDamage: (_amount, _from, source) => { hits.push(source); },
    destroyNpc: () => {},
    wreckNpc: () => {},
    fireLaser: () => {},
    raiseLegal: () => {},
    die: () => {},
    dock: () => {},
    completeHyperspace: () => {},
    completeRescue: () => {},
    openHermitTrade: () => {},
    autoSave: () => {},
  };
  const step = new WorldStep(state, new Ordnance(state.world), host);
  const coast = { rollRate: 0, pitchRate: 0, throttle: 0, fire: false };
  return { state, step, hits, coast };
}

{
  const { state, step, coast } = makeRun();
  const station = state.world.station;
  const n = slotNormal(station);
  const perp = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize();
  state.player.position.copy(station.position)
    .addScaledVector(n, 3000).addScaledVector(perp, 500);
  state.player.speed = 0;
  state.session.dcEngaged = true;

  // predict the target orientation from the same public plan the step reads
  const plan = planDocking(
    state.player.position, station, state.world.stationDockZ, state.player.maxSpeed,
    makeDockPlan());
  const target = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), plan.heading, plan.up));
  const q0 = state.player.quaternion.clone();
  const dt = 1 / 60;
  check('the fixture opens far enough off-heading that the turn cap binds',
    q0.angleTo(target) > DC_TURN_RATE * dt * 2);
  check('...and with a plan speed to throttle toward', plan.speed > 1);

  step.step(dt, 0, { demand: coast, handsOn: false });

  const turned = q0.angleTo(state.player.quaternion);
  check(`the computer turns at DC_TURN_RATE (${(turned / dt).toFixed(6)} rad/s)`,
    near(turned / dt, DC_TURN_RATE, 1e-6));

  const gain = state.player.speed / (plan.speed * dt);
  check(`...and closes the speed gap at DC_THROTTLE_GAIN (${gain.toFixed(6)}/s)`,
    near(gain, DC_THROTTLE_GAIN, 1e-6));
}

// --- what a fluffed slot does to you, through the same step ------------------

{
  const { state, step, hits, coast } = makeRun();
  const station = state.world.station;
  // deep inside the bounding cube, nowhere near the channel: 'hull'
  state.player.position.copy(station.localToWorld(new THREE.Vector3(100, 0, -150)));
  state.player.speed = 0;

  step.step(1 / 60, 0, { demand: coast, handsOn: false });

  const dist = state.player.position.distanceTo(station.position);
  check(`hitting the hull bounces you to BOUNCE_STANDOFF (${dist.toFixed(3)})`,
    near(dist, BOUNCE_STANDOFF, 1e-6));
  check('...with your run ended', state.player.speed === 0);
  check('...and the scrape billed as station damage',
    hits.length === 1 && hits[0] === 'station');
}

// --- the NPCs' smaller cube, bisected out of the same step -------------------

// The 40 is a recorded divergence from the player's 50 (see
// NPC_HULL_BOX_MARGIN); this holds world-step.ts to the constant so that
// FIXING the divergence is one edit and one red test, not an archaeology dig.

{
  const { state, step, coast } = makeRun();
  const station = state.world.station;
  const dockZ = state.world.stationDockZ;
  // parked out of everything's way: no ram, no hazard, no interest
  state.player.position.copy(station.position).addScaledVector(
    slotNormal(station), 20_000);
  state.player.speed = 0;

  const bounced = (d: number): boolean => {
    state.world.clearNpcs();
    const npc = state.world.spawn(
      'pirate', station.localToWorld(new THREE.Vector3(d, 0, 0)), 3);
    step.step(0.001, 0, { demand: coast, handsOn: false });
    // a bounce throws the ship to the cube face plus its radius; one 1ms step
    // of flying moves it a fraction of a unit
    return Math.abs(npc.object.position.distanceTo(station.position) - d) > 5;
  };

  check('the fixture can tell a bounce from a frame of flying',
    bounced(dockZ + 5) && !bounced(dockZ + 150));
  const edge = bisect(dockZ + 5, dockZ + 150, bounced);
  check(`an NPC is solid to the station within dockZ + NPC_HULL_BOX_MARGIN`
    + ` (${(edge - dockZ).toFixed(3)})`,
  near(edge, dockZ + NPC_HULL_BOX_MARGIN, 0.5));
}
