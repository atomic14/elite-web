// The commander's bank-to-turn steering: does it point the nose at the target,
// and does it get there by ROLL and PITCH rather than a yaw the ship has no
// axis for?
//
// The integration that matters — the run cycles under it — is in
// scripted-co-pilot.test.ts, which flies exactly what the Game applies. This
// file pins the steerer's own properties through the SAME pipeline the Game
// uses (bankToTurn -> the player's ramp -> PlayerShip.update): it converges
// from every direction, it never yaws, and it does not chatter near the
// horizontal plane, which is the limit cycle the sphere probe caught.

import * as THREE from 'three';
import { bankToTurn, freshSteerMemory } from '../src/game/pitch-roll-steer.ts';
import { PlayerShip, rampFlightRate } from '../src/player.ts';
import { PLAYER_FLIGHT } from '../src/constants/player-flight.ts';
import { check } from './harness.ts';

console.log('\nbank-to-turn steering');

const DT = 1 / 60;

/** Fly the FULL pipeline toward a fixed world point; return the final nose error. */
function flyToward(target: THREE.Vector3, frames: number): { end: number; lock: number } {
  const ship = new PlayerShip(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  ship.speed = 0; // hold position, this is a turning test
  const mem = freshSteerMemory();
  let pitch = 0; let roll = 0; let lock = -1;
  const dir = new THREE.Vector3();
  const nose = new THREE.Vector3();
  for (let i = 0; i < frames; i += 1) {
    dir.copy(target).sub(ship.position);
    const cmd = bankToTurn(ship.quaternion, dir, mem);
    pitch = rampFlightRate(pitch, cmd.pitch * PLAYER_FLIGHT.maxPitch, cmd.pitch !== 0, DT);
    roll = rampFlightRate(roll, cmd.roll * PLAYER_FLIGHT.maxRoll, cmd.roll !== 0, DT);
    ship.update(DT, { pitchRate: pitch, rollRate: roll, throttle: 0, fire: false });
    nose.set(0, 0, -1).applyQuaternion(ship.quaternion);
    if (nose.angleTo(dir) < 0.01 && lock < 0) lock = i;
  }
  nose.set(0, 0, -1).applyQuaternion(ship.quaternion);
  return { end: nose.angleTo(dir.copy(target).sub(ship.position)), lock };
}

// --- it converges from EVERY direction on the sphere ------------------------
//
// The whole point of the rewrite: the quaternion slew it replaced left 70 of
// these directions stuck (it rolled before it pitched, so a target behind and
// below never got the pitch). This sweeps azimuth and elevation and asserts the
// nose lands ON the target from every one.
//
// WITHIN A GUN CONE, not dead centre. The roll fades near the boresight
// (ROLL_FADE_ANGLE) to stop the seasick oscillation Chris flew, and the cost is
// that a few near-horizontal side directions settle ~2-3 degrees out rather
// than exactly on the pip. That is fine: the co-pilot fires through a cone and
// never needed dead centre (Chris: "we can hit the opponent, it need not be
// dead centre"). The threshold is a gun cone's worth — loose enough for the
// fade, still tight enough to catch a nose that is genuinely stuck, which is
// what this test exists for and what the tens-of-degrees slew failure looked
// like.
const WITHIN_A_GUN_CONE = 0.05; // ~2.9 degrees
{
  let stuck = 0;
  let worst = 0;
  let worstAt = '';
  for (let a = 0; a < 360; a += 15) {
    for (let b = -80; b <= 80; b += 10) {
      const az = (a * Math.PI) / 180; const el = (b * Math.PI) / 180;
      const t = new THREE.Vector3(
        Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az),
      ).multiplyScalar(1000);
      const { end } = flyToward(t, 1200);
      if (end > WITHIN_A_GUN_CONE) { stuck += 1; if (end > worst) { worst = end; worstAt = `az${a} el${b}`; } }
    }
  }
  check(`the nose reaches the target from all 475 directions (worst left ${(worst * 180 / Math.PI).toFixed(1)} deg${worstAt ? ` @ ${worstAt}` : ''})`,
    stuck === 0);
}

// --- a target off to the side is reached quickly ----------------------------
{
  const { lock } = flyToward(new THREE.Vector3(1000, 0, 0), 1200); // 90 deg right
  check(`a 90-degree target is on the nose within 4s (${(lock / 60).toFixed(2)}s)`,
    lock > 0 && lock < 240);
}

// --- the no-yaw property: reaching a side target ROLLS the ship -------------
//
// A yaw would swing the nose flat and leave local up parallel to world up. The
// ship has no yaw axis, so it must ROLL — after aiming at a purely-right
// target, local up has tilted well away from world up.
{
  const ship = new PlayerShip(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  ship.speed = 0;
  const mem = freshSteerMemory();
  let pitch = 0; let roll = 0;
  const target = new THREE.Vector3(1000, 0, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < 20; i += 1) {
    dir.copy(target).sub(ship.position);
    const cmd = bankToTurn(ship.quaternion, dir, mem);
    pitch = rampFlightRate(pitch, cmd.pitch * PLAYER_FLIGHT.maxPitch, cmd.pitch !== 0, DT);
    roll = rampFlightRate(roll, cmd.roll * PLAYER_FLIGHT.maxRoll, cmd.roll !== 0, DT);
    ship.update(DT, { pitchRate: pitch, rollRate: roll, throttle: 0, fire: false });
  }
  const tilt = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion)
    .angleTo(new THREE.Vector3(0, 1, 0));
  check(`aiming at a side target rolls the ship (up tilted ${(tilt * 180 / Math.PI).toFixed(0)} deg, not a flat yaw)`,
    tilt > 0.2);
}

// --- it does not chatter near the horizontal plane --------------------------
//
// The failure the sticky-side memory exists to prevent: a target near the
// ship's own horizontal used to flip the up/down choice every frame and the
// nose stalled ~30 degrees out. Fly one such case and assert it arrives, then
// assert the memory holds a side rather than flipping.
{
  const target = new THREE.Vector3(Math.sin(-0.52), 0, -Math.cos(-0.52)).multiplyScalar(1000);
  const { end } = flyToward(target, 1200);
  check(`a near-horizontal target is reached, not orbited (${(end * 180 / Math.PI).toFixed(2)} deg)`,
    end < 0.02);
}

// --- a zero direction is a no-op, not a NaN ---------------------------------
{
  const mem = freshSteerMemory();
  const cmd = bankToTurn(new THREE.Quaternion(), new THREE.Vector3(0, 0, 0), mem);
  check('a zero direction asks for nothing', cmd.pitch === 0 && cmd.roll === 0);
}

// --- the null band holds steady when the target is already on the nose ------
//
// The seasickness fix (Chris flew it): a target inside the gun cone is ON the
// nose, and steering to centre it exactly chatters the roll axis for a
// correction the gun does not need — worst when the target is large up close
// and the cone is wide. Inside the band the controller asks for nothing; a hair
// outside it, it still steers.
{
  const mem = freshSteerMemory();
  // a target 3 degrees off the nose, off to one side so the old law would roll
  const off = new THREE.Vector3(Math.sin(0.052), 0, -Math.cos(0.052));
  const inside = bankToTurn(new THREE.Quaternion(), off, mem, 0.09); // 5 deg cone
  check('inside the null band it holds steady', inside.pitch === 0 && inside.roll === 0);
  const outside = bankToTurn(new THREE.Quaternion(), off, mem, 0.02); // 1 deg cone
  check('...but outside it, it still steers',
    outside.pitch !== 0 || outside.roll !== 0);
}

// --- pitch is STRONG on a near, ahead target --------------------------------
//
// Chris, flying it: a target a few degrees above the sights got only a fraction
// of pitch and was never dragged into the cone. Pitch saturates on a much
// tighter angle than roll when the target is ahead, so a small vertical error
// still commands most of the pitch stick. A target 5 degrees straight above
// (directly up, so no roll needed and the pitch is not gated) must ask for
// nearly full pitch.
{
  const mem = freshSteerMemory();
  const up5 = new THREE.Vector3(0, Math.sin(0.087), -Math.cos(0.087)); // 5 deg up, dead ahead
  const cmd = bankToTurn(new THREE.Quaternion(), up5, mem);
  check(`a target 5 degrees above gets strong pitch (${cmd.pitch.toFixed(2)})`,
    Math.abs(cmd.pitch) > 0.6);
}

// --- roll FADES near the boresight, but stays full for a hard target --------
//
// The seasick-roll fix (Chris, flying it): a target only a few degrees off the
// nose but off to the SIDE needs a ~90-degree roll to bank it vertical, and at
// full authority the ship overshoots and reverses as the target moves. Roll
// authority ramps in over ROLL_FADE_ANGLE down to a floor, so a near-boresight
// side target rolls GENTLY (the floor) while a genuinely off-axis one still gets
// FULL roll — which is what keeps the sphere convergence above. Both targets sit
// dead on the 3-o'clock line (bearing horizontal), so the bearing saturates the
// roll stick and the only thing left moving the number is the fade.
{
  const near = new THREE.Vector3(Math.sin(0.05), 0, -Math.cos(0.05)); // ~3 deg to the side
  const far = new THREE.Vector3(Math.sin(0.6), 0, -Math.cos(0.6)); // ~34 deg to the side
  const nearRoll = bankToTurn(new THREE.Quaternion(), near, freshSteerMemory()).roll;
  const farRoll = bankToTurn(new THREE.Quaternion(), far, freshSteerMemory()).roll;
  check(`a near-boresight side target banks gently, not full over (${nearRoll.toFixed(2)})`,
    Math.abs(nearRoll) > 0 && Math.abs(nearRoll) < 0.6);
  check(`...but a hard off-axis target still gets full roll (${farRoll.toFixed(2)})`,
    Math.abs(farRoll) > 0.99);
}

