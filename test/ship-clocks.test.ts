// The clocks a ship runs whatever it is doing — `NpcShip.tickClocks`.
//
// Its own file because it is its own rule, and because the rule is precisely
// that these do NOT belong to any one branch. Everything else in the suite tests
// a ship DOING something; this tests what is true of it while it does anything
// at all, and the failure it exists to catch is a clock that only ticks down one
// of the paths through `update()`.
//
// That failure has happened twice, which is why the clocks were gathered into
// one call (docs/TODO/77):
//
//   `underFire`      decremented inside `attack()`, the SCRIPTED run. So for
//                    anything flying a trained policy it was a LATCH, not the
//                    decay `UNDER_FIRE_SECONDS` documents: one hit and it sat at
//                    1.2 for the rest of the ship's life.
//   `missileReload`  ticked inside `chooseWeapon`, which `update()` reaches only
//                    down the `aggressiveToPlayer` branch. So a rack froze
//                    mid-reload the moment the pirate stopped being
//                    hostile-and-in-range, and the two-second gap between
//                    launches measured time spent hunting rather than time.
//
// The generator, `regenerate`, is the third and was always correct; what it does
// with elapsed time is `systems.test.ts` and `elite-a-live-combat.test.ts`, and
// what is here is only that the frame runs it. WHAT the two clocks above gate is
// elsewhere too — `break-off.test.ts` for the phase a set `underFire` forces and
// `missile-cap.test.ts` for the reload the cap must not stall. This file is the
// one that says the clocks run.

import * as THREE from 'three';

import { seedWorld } from '../src/game/rng.ts';
import { NpcShip, type FireEvent } from '../src/game/npc.ts';
import { describeFlight } from '../src/game/break-off.ts';
import { UNDER_FIRE_SECONDS } from '../src/constants/attack-run.ts';
import { npcImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { defendShaped } from './fixtures.ts';
import { SHIPPED_BRAINS, type BrainSelection } from '../src/game/brain-names.ts';
import { SPECS } from '../src/game/ship-specs.ts';
import { MISSILE_LAST_STAND_HULL, MISSILE_RELOAD } from '../src/constants/ordnance.ts';
import { PLAYER_INTEREST_RANGE } from '../src/constants/player-interest.ts';
import { check } from './harness.ts';

const FRAME = 1 / 60;
const origin = new THREE.Vector3();
const level = new THREE.Quaternion();

/** The frames in `UNDER_FIRE_SECONDS` — 72, and it lands exactly on zero. */
const LAST = Math.round(UNDER_FIRE_SECONDS * 60);

const flown = (n: NpcShip): string => describeFlight(
  n.state.attackPhase, n.state.underFire, n.state.fleeing, n.state.flownBy, n.state.tactic);

// A live `WorldView`, for the assertions that go through `update()` rather than
// driving a flight directly. `playerLegal: 2` — a fugitive — is what makes a
// pirate hostile, so which branch of `update()` a ship takes is decided by the
// range and the role and nothing else.
const station = new THREE.Object3D();
station.position.set(0, 0, 30_000);
const player = { position: origin, quaternion: level, speed: 200 };
const fly = (npc: NpcShip, brains: BrainSelection, frames: number): NpcShip => {
  const view = {
    station, dockZ: 160, fleet: [npc], playerLegal: 2, missileInbound: false, brains,
  };
  for (let i = 0; i < frames; i += 1) npc.update(FRAME, player as never, view as never);
  return npc;
};

// --- underFire is a decay, not a latch, on BOTH flights ----------------------
//
// `UNDER_FIRE_SECONDS` says it in words: "It is a decay, not a latch, so a ship
// that is genuinely being shot at stays evasive for as long as that is true."
//
// The brain assertions are the ones that matter. The scripted path passed before
// the fix and would pass again if the decay moved back inside `attack()`, so a
// fixture that only flew the scripted run would be green either way — which is
// how this survived the audit that added `flownBy` for the same defect.

console.log('\nship clocks: under fire is a decay, not a latch');
{
  // A defence-shaped genome: `brainFly` is brain-agnostic — the decay under
  // test is the ship's, not any particular genome's, and since 2026-08-05
  // there are no shipped weights to borrow (the trained line was discarded).
  const brain = defendShaped;

  /**
   * A pirate hit once and then flown for `frames`, exactly as an orchestrator
   * flies it: the frame's clocks first, then whichever flight it is on.
   */
  const hitThenFly = (frames: number, path: 'brain' | 'scripted'): NpcShip => {
    seedWorld(77_100);
    const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, 3000), 77_100);
    npc.takeDamage(npcImpactDamage(IMPACT.ram), origin, true);
    for (let i = 0; i < frames; i += 1) {
      npc.tickClocks(FRAME);
      const dist = npc.object.position.distanceTo(origin);
      if (path === 'brain') npc.brainFly(brain!, FRAME, origin, level, 300, dist, 'player');
      else npc.attack(FRAME, origin, dist, true);
    }
    return npc;
  };

  for (const path of ['brain', 'scripted'] as const) {
    check(`${path}: one hit and it is evading`,
      hitThenFly(0, path).state.underFire === UNDER_FIRE_SECONDS);
    check(`${path}: ...still evading one frame short of ${UNDER_FIRE_SECONDS}s`,
      hitThenFly(LAST - 1, path).state.underFire > 0,
      `got ${hitThenFly(LAST - 1, path).state.underFire}`);
    check(`${path}: ...and stopped by ${UNDER_FIRE_SECONDS}s after the last hit`,
      hitThenFly(LAST, path).state.underFire === 0,
      `got ${hitThenFly(LAST, path).state.underFire}`);
    // The latch's signature is 1.2 for the whole of the ship's life. Ten seconds
    // is eight decays' worth, so this cannot pass on a flag that ticks only
    // sometimes.
    check(`${path}: ...and it is still 0 ten seconds later, not ${UNDER_FIRE_SECONDS}`,
      hitThenFly(600, path).state.underFire === 0,
      `got ${hitThenFly(600, path).state.underFire}`);
  }

  // The readout is what a human sees, and it is the thing that lied: the
  // trainer's SPENT ITS TIME column had exactly two values for a brain-flown
  // ship, `own policy` before its first hit and `evading` for ever after.
  check('a brain-flown ship reads `evading` while it is being hit',
    flown(hitThenFly(LAST - 1, 'brain')) === 'evading');
  check(`...and goes back to \`own policy\` ${UNDER_FIRE_SECONDS}s after the hit`,
    flown(hitThenFly(LAST, 'brain')) === 'own policy',
    `got ${flown(hitThenFly(LAST, 'brain'))}`);
}

// --- and through the real update(), because that is where it bit -------------
//
// The block above drives the flights directly, which is what a training episode
// does. This one goes through `NpcShip.update` — the live sky — for the two
// ships that reach `brainFly` in a shipped build, plus one that reaches neither
// flight at all.

console.log('\nship clocks: through the live update()');
{
  const hit = (npc: NpcShip): NpcShip => {
    npc.takeDamage(npcImpactDamage(IMPACT.ram), origin, true);
    return npc;
  };

  // There is no A/B trained pirate any more (the weights left the bundle,
  // 2026-08-05): the one ship that reaches `brainFly` in a shipped build is
  // the armed trader below, and the direct-drive block above covers the
  // brain path for any genome.

  // The armed trader on `jameson-defend-g2` reaches `brainFly` down the
  // `fleeing` branch and never runs `attack()` at ALL, so nothing was ever going
  // to unstick its flag. Its readout says `fleeing` either way — that word
  // outranks `evading` in `describeFlight` — so the flag itself is the
  // assertion, and the flag is what `nextAttackPhase` and `tacticSwitchReason`
  // read the moment this ship does hand over.
  seedWorld(77_102);
  const trader = new NpcShip('trader', new THREE.Vector3(0, 0, 2500), 77_102,
    SPECS.trader.find((s) => s.armed));
  trader.state.fleeing = true;
  trader.state.provokedByPlayer = true;
  fly(hit(trader), SHIPPED_BRAINS, LAST);
  check('the armed trader flies the defence policy', trader.state.flownBy === 'brain');
  check(`...and its underFire is 0 ${UNDER_FIRE_SECONDS}s after the hit,`
    + ` not latched at ${UNDER_FIRE_SECONDS}`,
  trader.state.underFire === 0, `got ${trader.state.underFire}`);

  // A ship flying NEITHER: hit at long range, so `update()` takes the amble
  // branch and no attack run runs. Under the old rule the flag was still 1.2
  // when the player came back into range, and cut the first run-out short.
  seedWorld(77_103);
  const idle = new NpcShip('pirate', new THREE.Vector3(0, 0, 4 * PLAYER_INTEREST_RANGE), 77_103);
  idle.state.threatTier = 1;
  fly(hit(idle), SHIPPED_BRAINS, LAST);
  check('a ship flying no attack run at all still cools off',
    idle.state.underFire === 0, `got ${idle.state.underFire}`);
}

// --- the rack reloads whatever the ship is doing -----------------------------
//
// Same defect, smaller blast radius, and it needs its own assertion because
// `missile-cap.test.ts` cannot see it: every fixture there is a ship being asked
// to launch, and a reload that ticks only when the ship is being asked to launch
// is exactly the bug. So this arms the reload the only way anything can — a real
// launch through `chooseWeapon` — and then flies the ship somewhere it will not
// be asked again.

console.log('\nship clocks: the rack reloads whatever the ship is doing');
{
  /** A pirate with a rack, hurt past the last-stand line, nose on the target. */
  const PYTHON = SPECS.pirate.find((s) => s.missiles === 2)!;
  seedWorld(77_200);
  const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 77_200, PYTHON);
  npc.state.missiles = 2;
  npc.state.energy = Math.round(npc.maxEnergy * MISSILE_LAST_STAND_HULL) - 1;
  npc.faceToward(origin);
  const laser: FireEvent = { at: 'player', weapon: 'laser' };
  check('the fixture launches, which is the only thing that arms the reload',
    npc.chooseWeapon(laser, 1200, origin, false)?.weapon === 'missile'
    && npc.state.missileReload === MISSILE_RELOAD);

  // Out past PLAYER_INTEREST_RANGE the pirate is scenery: `update()` takes the
  // amble branch, never calls `chooseWeapon`, and under the old rule the rack
  // stayed 2 seconds from ready for as long as the player stayed away.
  npc.object.position.set(0, 0, 4 * PLAYER_INTEREST_RANGE);
  const seconds = MISSILE_RELOAD + 1;
  fly(npc, SHIPPED_BRAINS, Math.round(seconds * 60));
  check(`${seconds}s of doing something else reloads the rack`,
    npc.state.missileReload === 0, `got ${npc.state.missileReload}`);

  // ...and the clock is a clock, not a reset: half a reload's worth of doing
  // something else leaves half a reload to go.
  seedWorld(77_201);
  const half = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 77_201, PYTHON);
  half.state.missiles = 2;
  half.state.energy = Math.round(half.maxEnergy * MISSILE_LAST_STAND_HULL) - 1;
  half.faceToward(origin);
  half.chooseWeapon(laser, 1200, origin, false);
  half.object.position.set(0, 0, 4 * PLAYER_INTEREST_RANGE);
  const halfFrames = Math.round((MISSILE_RELOAD / 2) * 60);
  fly(half, SHIPPED_BRAINS, halfFrames);
  check('...and half of one leaves half of one to go',
    Math.abs(half.state.missileReload - MISSILE_RELOAD / 2) < FRAME,
    `got ${half.state.missileReload}`);
}
