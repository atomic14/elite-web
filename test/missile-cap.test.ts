// ONE WARHEAD IN THE AIR AT A TIME — the fairness cap, and nothing else.
//
// `test/missiles.test.ts` covers a missile LEAVING the rail: that both worlds
// resolve one launch identically, what it costs her, and that a pirate in a real
// fight actually reaches for one. This file covers the rule that says it may
// NOT: `WorldView.missileInbound`, read once per frame by the orchestrator and
// applied by `NpcShip.chooseWeapon`.
//
// It is its own file because it is its own rule, with its own recorded reason.
// E.C.M. destroys every missile in flight in one burst for a quarter of the
// bank, so it is a complete answer to one missile and no answer at all to five
// — which is how a wave-13 gang put three through in nine seconds. Capping the
// air is what makes the counterplay the player already owns work.
//
// docs/TODO/83: the rule has three cooperating parts and had no gate at all.
// Deleting the guard in `chooseWeapon` — `if (missileInbound && false) return
// shot;` — left the whole suite green; it fails 14 assertions in this file now.
// The other two parts are gated here as well, because each can drift on its
// own: moving the `missileInbound` read inside the NPC loop fails 2 here,
// putting the guard ahead of the reload tick fails 4, and putting it behind
// `npcMissileEmergency` fails 7. Only the loop mutation shows up anywhere else
// in `npm test`, and only as a symptom — `missiles.test.ts`'s "it kills her"
// goes red because a quarter as many warheads get away, which reports the
// lethality and not the rule.

import * as THREE from 'three';

import { NpcShip, type FireEvent } from '../src/game/npc.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { SPECS } from '../src/game/ship-specs.ts';
import { WorldStep, FIXED_DT, type StepEvent, type StepHost } from '../src/game/world-step.ts';
import { Combat, damagePlayer } from '../src/game/combat.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import {
  MISSILE_LAST_STAND_HULL, MISSILE_LAST_STAND_MIN_RANGE, MISSILE_MAX_RANGE, MISSILE_RELOAD,
} from '../src/game/missile-launch.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

/** The hull every pirate here flies: the only one that carries two rounds. */
const PYTHON = SPECS.pirate.find((s) => s.missiles === 2)!;

// --- the ship's half: asked twice, with the same everything else -------------
//
// `chooseWeapon` is public and takes the fact it cannot see — is the air
// occupied — as a scalar, which is the whole reason docs/TODO/62 made it so.
// That makes the guard directly askable: the same ship in the same state, asked
// with `false` and with `true`.
//
// The second half of the claim is the one a `return null` would quietly break.
// The design is "the gang loses nothing except the ability to saturate a
// countermeasure", so a capped ship must still fire the LASER the flight asked
// for and must keep the RELOAD it never started. The ROUND is not spent here at
// all — `chooseWeapon` decides and reports, `launchNpcMissile` spends — so the
// rack half of that claim is the gang case below, through a real resolver.

console.log('\nmissile cap: the ship, asked twice');
{
  /** A pirate with a rack, hurt past the last-stand line, nose on the target. */
  const desperate = (): NpcShip => {
    seedWorld(83_001);
    const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 83_001, PYTHON);
    npc.state.missiles = 2;
    npc.state.energy = Math.round(npc.maxEnergy * MISSILE_LAST_STAND_HULL) - 1;
    npc.faceToward(new THREE.Vector3());
    return npc;
  };
  const at = new THREE.Vector3();
  const dist = 1200;   // inside the seeker's envelope, both ends
  const laser: FireEvent = { at: 'player', weapon: 'laser' };

  check('the fixture is inside the envelope the launch rule gates on',
    dist > MISSILE_LAST_STAND_MIN_RANGE && dist < MISSILE_MAX_RANGE);

  const clear = desperate();
  const withClearSky = clear.chooseWeapon(laser, FIXED_DT, dist, at, false);
  eq('with the sky clear, a hurt pirate reaches for the rack',
    withClearSky?.weapon, 'missile');
  eq('...and starts the reload that gates the next one',
    clear.state.missileReload, MISSILE_RELOAD);

  const capped = desperate();
  const withOneUp = capped.chooseWeapon(laser, FIXED_DT, dist, at, true);
  check('with one already in the air, the same ship shoots instead',
    withOneUp === laser);
  eq('...and it is the LASER the flight asked for, not silence', withOneUp?.weapon, 'laser');
  eq('...and it spends none of the reload it never started', capped.state.missileReload, 0);

  // ...so the cap DELAYS a launch rather than cancelling it. The frame the sky
  // clears, the same ship — never rearmed, never reset — launches.
  const freed = capped.chooseWeapon(laser, FIXED_DT, dist, at, false);
  eq('...so the moment the sky clears it launches after all', freed?.weapon, 'missile');
  eq('...and only then does the reload start', capped.state.missileReload, MISSILE_RELOAD);

  // A ship with NO reason to launch is refused for a different reason, and the
  // cap must not be credited with that: this is the control that stops the two
  // assertions above passing on a fixture that could never have launched.
  seedWorld(83_002);
  const healthy = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 83_002, PYTHON);
  healthy.state.missiles = 2;
  healthy.faceToward(new THREE.Vector3());
  check('an unhurt pirate that has made no passes holds its fire with the sky CLEAR too',
    healthy.chooseWeapon(laser, FIXED_DT, dist, at, false) === laser
    && healthy.state.missileReload === 0);
}

// --- the world's half: a gang, through the real step -------------------------
//
// The unit case above cannot see the failure that matters. `missileInbound` is
// read ONCE per frame, outside the loop (world-step.ts, and scenario.ts says why
// in a comment) — every ship in a frame sees the same answer. A read moved
// inside the loop would let the first launcher silence the rest within the same
// step, which is a different program and one no test of `chooseWeapon` can tell
// apart.
//
// So this drives the real `WorldStep` over a gang that all wants to launch, and
// counts launches per frame off the `npcFired` events the step reports.

console.log('\nmissile cap: the gang, through the step');
{
  /** What one frame did: was the air already occupied, and who launched. */
  interface Frame { inbound: boolean; launches: number }

  /**
   * A hurt gang closing on the commander, and optionally a warhead already up.
   *
   * The decoy is launched through `Ordnance.launchHostile` — the real path, the
   * same one `launchNpcMissile` takes — from 30,000 units out, so that it
   * occupies the sky for the whole run instead of arriving and clearing it.
   * `occupiedFrames === FRAMES` below is what says it lasted, rather than a
   * flight-time sum in a comment.
   */
  const fight = (seed: number, frames: number, decoy: boolean) => {
    seedWorld(seed);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    const combat = new Combat(state.world);
    const ordnance = new Ordnance(state.world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const host: StepHost = {
      inFlight: () => true,
      applyPlayerDamage: (amount, from) => {
        damagePlayer(state, combat, amount, from, scratch);
      },
      destroyNpc: (npc) => { combat.destroy(state.commander, npc); },
      wreckNpc: (npc) => { combat.wreck(npc); },
      fireLaser: () => {},
      raiseLegal: () => {},
      die: () => {},
      dock: () => {},
      completeHyperspace: () => {},
      completeRescue: () => {},
      openHermitTrade: () => {},
      autoSave: () => {},
    };

    // Out at the witchpoint, clear of the planet, the sun and the mass lock —
    // the same placement test/world-step.test.ts's arrival fixture uses.
    state.player.position.copy(state.world.station.position).normalize()
      .multiplyScalar(state.world.planetRadius * 16);
    state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
      state.player.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    state.player.speed = 100;

    const gang: NpcShip[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const npc = state.world.spawn('pirate', state.player.position.clone().add(
        new THREE.Vector3(Math.cos(a) * 700, Math.sin(a) * 200, -1200 - i * 90)),
      83 + i * 13, PYTHON);
      npc.state.threatTier = 2;
      npc.state.missiles = 2;
      // Below MISSILE_LAST_STAND_HULL from the first frame, so every ship has a
      // reason before anything has had time to happen.
      npc.state.energy = Math.round(npc.maxEnergy * 0.3);
      npc.faceToward(state.player.position);
      gang.push(npc);
    }
    // There used to be a fifth ship here, spawned dead, so that `matesLost > 0`
    // kept a reason alive after the survivors healed back past the hull line.
    // That reason is deleted (docs/TODO/75) and so is the corpse: it was a state
    // the live game cannot produce, since every kill despawns in the same
    // statement. What holds the rails open now is the hull line alone — a ship
    // at 0.3 regenerates slowly enough to still be under 0.4 when its rail
    // cycles, which is what `open.launched === open.carried` below measures.
    // A freshly spawned NPC's world matrix is stale until something updates it,
    // and shot.ts raycasts against it — CLAUDE.md's own settling caveat.
    state.world.scene.updateMatrixWorld(true);

    if (decoy) {
      ordnance.launchHostile(state.player.position.clone()
        .add(new THREE.Vector3(0, 30_000, 0)));
    }

    const step = new WorldStep(state, ordnance, host);
    const carried = gang.reduce((n, s) => n + s.state.missiles, 0);
    const log: Frame[] = [];
    for (let f = 0; f < frames; f++) {
      const inbound = ordnance.missileInbound;
      const events: StepEvent[] = step.step(FIXED_DT, f * FIXED_DT,
        { demand: { rollRate: 0, pitchRate: 0, throttle: 0.5, fire: false }, handsOn: false });
      log.push({
        inbound,
        launches: events.filter((e) => e.kind === 'npcFired' && e.weapon === 'missile').length,
      });
    }
    // The longest stretch of consecutive occupied frames in which nobody
    // launched. Compared against MISSILE_RELOAD, this separates "held by the
    // sky" from "held by its own rail".
    let silence = 0;
    let longestSilence = 0;
    for (const fr of log) {
      silence = fr.inbound && fr.launches === 0 ? silence + 1 : 0;
      longestSilence = Math.max(longestSilence, silence);
    }
    return {
      carried,
      longestSilence,
      launched: log.reduce((n, fr) => n + fr.launches, 0),
      whileOccupied: log.reduce((n, fr) => n + (fr.inbound ? fr.launches : 0), 0),
      occupiedFrames: log.filter((fr) => fr.inbound).length,
      mostInOneFrame: log.reduce((n, fr) => Math.max(n, fr.launches), 0),
      racks: gang.map((s) => s.state.missiles).join(','),
    };
  };

  const FRAMES = 900;
  const open = fight(83_100, FRAMES, false);
  check(`a gang with the sky to itself empties its rails (${open.launched} of`
    + ` ${open.carried} rounds over ${(FRAMES * FIXED_DT).toFixed(1)}s)`,
  open.launched === open.carried);

  // THE GATE. Not "the cap is on" but "no ship ever launched into an occupied
  // sky", asserted across every frame of a fight that spends nearly all of them
  // occupied. This is the assertion the deleted guard makes false.
  check('...and not one of them launched into an occupied sky'
    + ` (${open.occupiedFrames} of ${FRAMES} frames had a warhead up,`
    + ` ${open.whileOccupied} launches in them)`,
  open.occupiedFrames > 0 && open.whileOccupied === 0);

  // GANG-WIDE, and not the launching ship's own reload doing the work: the
  // silence runs far longer than the 2s a rail takes to cycle, so the ships
  // held are ships that were ready and had a reason.
  check(`...for ${(open.longestSilence * FIXED_DT).toFixed(1)}s at a stretch,`
    + ` which is ${(open.longestSilence * FIXED_DT / MISSILE_RELOAD).toFixed(1)}x the`
    + ` ${MISSILE_RELOAD}s reload — it is the sky holding them, not their rails`,
  open.longestSilence * FIXED_DT > MISSILE_RELOAD * 2);

  // ONCE PER FRAME, OUTSIDE THE LOOP. Every ship in a frame sees the same
  // answer, so several may launch on a frame that began clear — that is the
  // program both orchestrators run, and moving either read inside the loop
  // would cap it at one and still pass every other check in this file.
  check('...while a frame that began CLEAR can carry more than one launch'
    + ` (${open.mostInOneFrame} at once), because the read is once per frame`,
  open.mostInOneFrame > 1);

  // The acceptance case: the same gang, same seed, with a warhead already up.
  const capped = fight(83_100, FRAMES, true);
  check('the same gang with a warhead already in the sky launches nothing'
    + ` (${capped.launched}, against ${open.launched})`,
  capped.launched === 0);
  check('...and it is the sky that stopped them, not the fixture:'
    + ` the decoy occupied all ${FRAMES} frames`,
  capped.occupiedFrames === FRAMES);
  eq('...so every round is still on the rails', capped.racks, '2,2,2,2');

  // READ THE SET, NOT THE SAMPLE. One seed is one fight, and a cap that held on
  // 83,100 by luck would look exactly like this. The same pair of runs over a
  // sweep of seeds, with the same two answers each time.
  const SEEDS = 12;
  const swept = { open: 0, occupied: 0, whileOccupied: 0, capped: 0, cappedRacks: 0 };
  for (let s = 0; s < SEEDS; s++) {
    const seed = 83_100 + s * 977;
    const a = fight(seed, FRAMES, false);
    const b = fight(seed, FRAMES, true);
    swept.open += a.launched;
    swept.occupied += a.occupiedFrames;
    swept.whileOccupied += a.whileOccupied;
    swept.capped += b.launched;
    swept.cappedRacks += b.racks === '2,2,2,2' ? 1 : 0;
  }
  check(`over ${SEEDS} seeds the gang launches ${swept.open} warheads with the sky`
    + ` to itself and ${swept.capped} with one already up`,
  swept.open > 0 && swept.capped === 0);
  check(`...and in ${swept.occupied} occupied frames across those fights, ${swept.whileOccupied}`
    + ' launches happened', swept.occupied > 0 && swept.whileOccupied === 0);
  eq(`...with all ${SEEDS} capped gangs still holding a full rack`,
    swept.cappedRacks, SEEDS);
}

// --- and the reload is not spent on a refusal --------------------------------
//
// The guard sits AFTER the reload tick and BEFORE `npcMissileEmergency`,
// deliberately. Ahead of the tick, a capped ship's reload would freeze; behind
// the reasons, a refusal would arm the 2s timer and cost the gang a round of
// nothing. Both are one-line reorderings that change no other assertion here.

console.log('\nmissile cap: where the guard sits');
{
  seedWorld(83_200);
  const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, -1200), 83_200, PYTHON);
  npc.state.missiles = 2;
  npc.state.energy = Math.round(npc.maxEnergy * MISSILE_LAST_STAND_HULL) - 1;
  npc.faceToward(new THREE.Vector3());
  const at = new THREE.Vector3();
  const laser: FireEvent = { at: 'player', weapon: 'laser' };

  npc.chooseWeapon(laser, FIXED_DT, 1200, at, false);
  eq('a launch arms the reload', npc.state.missileReload, MISSILE_RELOAD);

  // Held under the cap for the whole reload: the clock must still run down, or
  // a ship silenced by the sky would come out of it still reloading.
  let ticks = 0;
  while (npc.state.missileReload > 0 && ticks < 60 * 10) {
    npc.chooseWeapon(laser, FIXED_DT, 1200, at, true);
    ticks += 1;
  }
  check('...and the clock runs down UNDER the cap, not despite it'
    + ` (${(ticks * FIXED_DT).toFixed(2)}s of ${MISSILE_RELOAD}s)`,
  Math.abs(ticks * FIXED_DT - MISSILE_RELOAD) < 2 * FIXED_DT);
  eq('...and the cap outlasts the reload: reloaded, and still shooting',
    npc.chooseWeapon(laser, FIXED_DT, 1200, at, true), laser);
  eq('...having spent none of the reload it just finished', npc.state.missileReload, 0);
  eq('...and then the sky clears and the next round goes',
    npc.chooseWeapon(laser, FIXED_DT, 1200, at, false)?.weapon, 'missile');
}
