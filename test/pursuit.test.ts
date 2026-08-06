// The pursuit dogfighter's shipless decisions: hold gun range, and break off
// before ramming. Flown by both the combat computer (scripted-co-pilot.ts) and
// a pursuit pirate (npc.ts), so the rule is pinned here once.

import * as THREE from 'three';
import {
  pursuitSpeed, pursuitAim, freshPursuitBreak,
} from '../src/game/pursuit.ts';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import { describeFlight } from '../src/game/break-off.ts';
import { SHIPPED_BRAINS } from '../src/game/brain-names.ts';
import {
  PURSUIT_RANGE, PURSUIT_BREAK_RANGE, PURSUIT_CLEAR_RANGE,
} from '../src/constants/combat-computer.ts';
import { check } from './harness.ts';

console.log('\npursuit');

// --- the speed holds a gun-range standoff -----------------------------------
{
  const maxSpeed = 400;
  // beyond the hold range, dead ahead: close (want faster than the target)
  check('beyond the hold range it closes',
    pursuitSpeed(200, PURSUIT_RANGE + 400, 0, maxSpeed) > 200);
  // inside the hold range, dead ahead: back off (slower than the target)
  check('inside the hold range it opens',
    pursuitSpeed(200, PURSUIT_RANGE - 200, 0, maxSpeed) < 200);
  // at the hold range, dead ahead: match the target
  check('at the hold range it matches the target',
    Math.abs(pursuitSpeed(200, PURSUIT_RANGE, 0, maxSpeed) - 200) < 1);
  // a hard turn (nose 90 deg off) throttles back below the matched speed
  check('a hard turn throttles back',
    pursuitSpeed(200, PURSUIT_RANGE, Math.PI / 2, maxSpeed)
    < pursuitSpeed(200, PURSUIT_RANGE, 0, maxSpeed));
  // never above the chaser's own top speed
  check('never faster than the chaser can fly',
    pursuitSpeed(400, 9999, 0, maxSpeed) === maxSpeed);
}

// --- the break-off: chase far, turn away close, with hysteresis -------------
{
  const at = (z: number) => new THREE.Vector3(0, 0, z);
  const out = new THREE.Vector3();
  const pos = at(0);

  // far out: aim straight at the target (pure pursuit)
  {
    const brk = freshPursuitBreak();
    const target = at(-PURSUIT_CLEAR_RANGE - 100);
    const aim = pursuitAim(brk, pos, target, target.length(), out);
    check('far out it chases the target itself',
      !brk.breaking && aim.equals(target));
  }

  // inside the break range: commit to a break, and aim AWAY (nearer than the
  // target, on the chaser's side) rather than toward it
  {
    const brk = freshPursuitBreak();
    const target = at(-(PURSUIT_BREAK_RANGE - 40));
    const aim = pursuitAim(brk, pos, target, target.length(), out.clone()).clone();
    const distAimToTarget = aim.distanceTo(target);
    const distPosToTarget = pos.distanceTo(target);
    check('inside the break range it breaks off',
      brk.breaking === true);
    check('...aiming away from the target, not into it',
      distAimToTarget > distPosToTarget);
  }

  // hysteresis: once breaking, it keeps breaking between BREAK and CLEAR range,
  // and only resumes the chase once past CLEAR
  {
    const brk = freshPursuitBreak();
    const target = at(-(PURSUIT_BREAK_RANGE - 20));
    pursuitAim(brk, pos, target, target.length(), out); // enter break
    const mid = at(-((PURSUIT_BREAK_RANGE + PURSUIT_CLEAR_RANGE) / 2));
    pursuitAim(brk, pos, mid, mid.length(), out);
    check('it stays broken between the break and clear ranges', brk.breaking === true);
    const far = at(-(PURSUIT_CLEAR_RANGE + 50));
    const aim = pursuitAim(brk, pos, far, far.length(), out);
    check('...and resumes the chase past the clear range',
      !brk.breaking && aim.equals(far));
  }
}

// --- the wiring: the LIVE BRAINS choice reaches a pirate, and the readout ----
//
// The pure block above pins pursuit.ts's decisions; this pins that selecting
// `pursuit` actually routes a hostile pirate through `pursue()` — the dispatch
// at npc.ts's `update()` — and that the strip then SAYS so. Both halves matter:
// the flight was correct before this change and the readout still lied ("KNIFE
// CLOSING" for a ship on the six), so a test of the words alone would have gone
// green while the screen was wrong.
{
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const station = new THREE.Object3D();
  const doing = (n: NpcShip): string => describeFlight(
    n.state.attackPhase, n.state.underFire, n.state.fleeing,
    n.state.flownBy, n.state.tactic, n.breakingOff);

  /** Fly a pirate at a player flying forward for `secs`, under one brain choice. */
  const flyAtPlayer = (brains: object, secs: number) => {
    seedWorld(20_260_806);
    const npc = new NpcShip('pirate', at(0, 0, 3000), 3);
    const player = { position: at(0, 0, 0), quaternion: new THREE.Quaternion(), speed: 100 };
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    const view = {
      station, dockZ: 160, fleet: [npc], playerLegal: 0, brains, missileInbound: false,
    };
    const words = new Set<string>();
    let closest = Infinity;
    for (let i = 0; i < secs * 60; i++) {
      player.position.addScaledVector(forward, player.speed / 60);
      npc.update(1 / 60, player as never, view);
      words.add(doing(npc));
      closest = Math.min(closest, npc.object.position.distanceTo(player.position));
    }
    return { npc, player, words, closest };
  };

  const pursued = flyAtPlayer({ pursuit: true }, 20);
  const jousted = flyAtPlayer(SHIPPED_BRAINS, 20);

  check('choosing pursuit routes the pirate through pursue(): flownBy says so',
    pursued.npc.state.flownBy === 'pursuit');
  check('...and the default sky still flies the scripted attack run',
    jousted.npc.state.flownBy === 'scripted');

  // The readout: the pursuit pilot only ever names its own two states, and the
  // attack-run pilot only ever names a phase. If the fix regressed, the pursuit
  // set would contain "... closing" — the exact word this change removed.
  const pursuitWords = ['on your six', 'breaking off'];
  check(`the pursuit pirate reads only its own words (${[...pursued.words].join(', ')})`,
    [...pursued.words].every((w) => pursuitWords.includes(w)));
  check(`...and never an attack-run phase (${[...jousted.words].join(', ')})`,
    [...jousted.words].some((w) => w.endsWith('closing') || w.endsWith('passing')
      || w.endsWith('extending')));

  // The flight, not just the label: a pursuit pirate holds a gun-range standoff
  // and never bores in, an attack-run pirate repeatedly closes to knife range.
  // So their CLOSEST approaches sit a long way apart — which is what makes "it
  // flies differently" more than a claim about a string. Final-frame distance
  // will not do it: the attack run's range swings with its phase, so a single
  // frame catches it anywhere from knife range to the top of its run-out.
  check(`the pursuit pirate never knife-fights, the attack run does`
    + ` (closest ${pursued.closest.toFixed(0)} vs ${jousted.closest.toFixed(0)} units)`,
  pursued.closest > jousted.closest + PURSUIT_RANGE / 2);
}

// --- the mode switch: hold the six astern, slash when the commander faces it -
//
// A pursuit pirate parked ahead of the commander's guns was a duck (Chris:
// "they can just sit in front of us holding still — sitting ducks"). So it
// holds the six only while it is ASTERN and breaks into the attack run when the
// commander turns onto it. This pins both ends of that switch through the real
// `update()`, and reuses the readout as the witness: `flownBy` and the strip
// word ARE the mode, so a regression that stopped it switching shows up here.
{
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const station = new THREE.Object3D();
  const doing = (n: NpcShip): string => describeFlight(
    n.state.attackPhase, n.state.underFire, n.state.fleeing,
    n.state.flownBy, n.state.tactic, n.breakingOff);

  seedWorld(20_260_806);
  const npc = new NpcShip('pirate', at(0, 0, 3000), 3);
  const player = { position: at(0, 0, 0), quaternion: new THREE.Quaternion(), speed: 100 };
  const view = {
    station, dockZ: 160, fleet: [npc], playerLegal: 0, brains: { pursuit: true }, missileInbound: false,
  };
  const fwd = new THREE.Vector3(0, 0, -1);
  const toPirate = new THREE.Vector3();

  // Point the commander's nose toward the pirate, or dead away from it, and fly
  // a window at that facing. Returns what the pirate settled into by the end.
  const flyFacing = (towards: boolean, secs: number) => {
    for (let i = 0; i < secs * 60; i++) {
      toPirate.copy(npc.object.position).sub(player.position).normalize();
      player.quaternion.setFromUnitVectors(fwd, towards ? toPirate : toPirate.negate());
      npc.update(1 / 60, player as never, view);
    }
    return { flownBy: npc.state.flownBy, doing: doing(npc) };
  };

  flyFacing(false, 8); // settle onto the six with the commander looking away
  const astern = flyFacing(false, 4);
  const faced = flyFacing(true, 6); // turn the nose onto it
  const asternAgain = flyFacing(false, 8); // and away once more

  check(`astern of the commander it holds the six (${astern.flownBy}: "${astern.doing}")`,
    astern.flownBy === 'pursuit' && astern.doing === 'on your six');
  check(`...faced by the commander it flies the attack run (${faced.flownBy}: "${faced.doing}")`,
    faced.flownBy === 'scripted'
    && (faced.doing.endsWith('closing') || faced.doing.endsWith('passing')
      || faced.doing.endsWith('extending')));
  check(`...and it switches BACK to the six when the commander looks away again`
    + ` (${asternAgain.flownBy})`,
  asternAgain.flownBy === 'pursuit');
}
