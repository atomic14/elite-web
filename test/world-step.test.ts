// The world step, headless: five phases in the order they must run.
//
// The whole point of this file is that it needs no browser. three.js maths works
// under node; what did not was module-scope side effects, extensionless imports
// and JSON without an attribute. All three are fixed, so the step is testable
// directly instead of by grepping its source.

import * as THREE from 'three';
import { viewDirection } from '../src/game/views.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { World } from '../src/game/world.ts';
import {
  WorldStep,
  massLocked,
  type StepEvent,
  type StepHost,
} from '../src/game/world-step.ts';
import { freshState } from '../src/game/state.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import { clearWorld, readWorld, saveCommander, saveWorld, withoutSaving } from '../src/game/storage.ts';
import type { WorldSnapshot } from '../src/game/snapshot.ts';
import { newCommander } from '../src/game/commander.ts';
import {
  Combat,
  firePlayerLaser,
  damagePlayer,
  type CombatEvent,
  type DamageSource,
} from '../src/game/combat.ts';
import { seedWorld, rngState, restoreRng } from '../src/game/rng.ts';
import { RAM_DAMAGE } from '../src/game/collisions.ts';
import { pirateSpecForTier } from '../src/game/ship-specs.ts';
import { CombatComputer } from '../src/game/combat-computer.ts';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import { check } from './harness.ts';

// --- the world builds without a browser --------------------------------------
//
// CLAUDE.md claimed everything needing a GPU was confined to
// engine/render-stack.ts. It was not: the corona texture painted a sprite into a
// document.createElement('canvas') at build time, so World.build() — the
// station, planet and sun that massLocked(), checkHazards(), the docking
// checks and the compass all read — threw under node. An audit found it.
//
// This is the drop-dead requirement for training against the real world step,
// so it gets a test rather than a paragraph.

console.log('\nheadless world');
{
  const sys = generateGalaxy(1)[7];
  const world = new World();
  world.build(sys);
  check('World.build() runs with no document', !!world.scene3d);
  check('...and the station exists to dock with', !!world.station);
  check('...and the planet has a radius the hazard checks can read',
    world.planetRadius > 0);
  check('...and the sun has a position to skim',
    world.sunPos instanceof THREE.Vector3);
  check('...and a launching ship has somewhere to appear',
    world.spawnPosition instanceof THREE.Vector3);

  // and it must still STEP, not just build
  world.spawn('pirate', new THREE.Vector3(0, 0, -900), 1);
  world.update(1 / 60, 0);
  check('...and the world steps headlessly', world.npcs.length === 1);

  world.banishScenery();
  check('witch-space banishes the scenery out of every check',
    world.planetPos.length() > 1e7);
}

// --- and the world STEPS without a browser -----------------------------------
//
// The sequel to the block above, and the drop-dead requirement for training
// against the real engine: the five phases of flight used to be private
// methods of game.ts that called `this.hud.showMessage` fourteen times, so the
// simulation could not advance without a HUD, a keyboard and a WebGL context.
//
// They are world-step.ts now. Everything below constructs the pieces by hand —
// a World, a freshState, an Ordnance and a twelve-method StepHost stub — and
// flies them under node. None of this was expressible before the extraction.

console.log('\nheadless world step');
{
  /** Everything a step needs, plus a log of what it asked the host to do. */
  const arrival = (seed: number) => {
    seedWorld(seed);
    const state = freshState(newCommander());
    state.world.build(state.systems[state.commander.systemIndex]);
    const combat = new Combat(state.world);
    const ordnance = new Ordnance(state.world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const log = {
      deaths: [] as string[], saves: 0, docks: 0, shots: 0, damage: 0, hermits: 0,
      /** every hit the player took, and what the step said did it */
      hits: [] as { amount: number; source: DamageSource }[],
    };
    // The host is the ONLY thing standing behind the step, and it is a stub:
    // no Hud, no screens, no localStorage, no renderer.
    const host: StepHost = {
      inFlight: () => log.deaths.length === 0 && log.docks === 0,
      applyPlayerDamage: (amount, from, source) => {
        log.damage += amount;
        log.hits.push({ amount, source });
        damagePlayer(state, combat, amount, from, scratch);
      },
      destroyNpc: (npc) => { combat.destroy(state.commander, npc); },
      wreckNpc: (npc) => { combat.wreck(npc); },
      fireLaser: () => { log.shots += 1; },
      raiseLegal: () => {},
      die: (reason) => { log.deaths.push(reason); },
      dock: () => { log.docks += 1; },
      completeHyperspace: () => {},
      completeRescue: () => {},
      openHermitTrade: () => { log.hermits += 1; },
      autoSave: () => { log.saves += 1; },
    };

    // out at the witchpoint with the planet ahead, which is where an arrival
    // starts — and well clear of the sun, the station and the ground
    state.player.position.copy(state.world.station.position).normalize()
      .multiplyScalar(state.world.planetRadius * 16);
    state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
      state.player.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    state.player.speed = 200;
    for (let i = 0; i < 3; i++) {
      state.world.spawn('pirate',
        state.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)), i);
    }
    state.world.spawn('trader',
      state.player.position.clone().add(new THREE.Vector3(-900, -200, -2600)), 7);
    return { state, ordnance, log, step: new WorldStep(state, ordnance, host) };
  };

  const fly = (r: ReturnType<typeof arrival>, steps: number) => {
    const events: StepEvent[] = [];
    for (let i = 0; i < steps; i++) {
      events.push(...r.step.step(1 / 60, i / 60,
        { demand: { rollRate: 0.3, pitchRate: 0.15, throttle: 1, fire: true }, handsOn: false }));
    }
    return events;
  };

  /** What the run LOOKED like, to the byte — the determinism fixture. */
  const trace = (r: ReturnType<typeof arrival>) => JSON.stringify({
    npcs: r.state.world.npcs.map((n) => [
      n.role, n.state.energy,
      n.object.position.toArray().map((v) => v.toFixed(6)),
      n.object.quaternion.toArray().map((v) => v.toFixed(6)),
    ]),
    player: [
      r.state.player.position.toArray().map((v) => v.toFixed(6)),
      r.state.player.quaternion.toArray().map((v) => v.toFixed(6)),
      r.state.player.speed,
    ],
    sys: r.state.sys,
    session: r.state.session,
  });

  {
    const run = arrival(20_260_729);
    run.state.session.autoSaveTimer = 0.5;   // 600 steps is 10s; the timer is 20
    const before = run.state.player.position.clone();
    const flew = run.state.world.npcs.map((n) => n.object.position.clone());
    const events = fly(run, 600);

    check('600 steps of the real world run with no Hud, no Input and no renderer',
      run.state.player.position.distanceTo(before) > 100);
    check('...with ships still flying in it', run.state.world.npcs.length >= 3);
    check('...that have actually moved',
      run.state.world.npcs.some((n, i) => flew[i] && n.object.position.distanceTo(flew[i]) > 10));
    check('...the trigger reached the gun through the host', run.log.shots === 600);
    check('...the autosave asked the host rather than localStorage', run.log.saves >= 1);
    check('...and nothing it reported is anything but an event',
      events.every((e) => {
        switch (e.kind) {
          case 'message': return typeof e.text === 'string' && typeof e.seconds === 'number';
          case 'npcFired': return typeof e.atPlayer === 'boolean';
          case 'countdown': return typeof e.n === 'number';
          case 'dockingMusic': return typeof e.on === 'boolean';
          case 'sound': return typeof e.name === 'string';
        }
      }));
  }

  // the fourteen hud.showMessage calls: the step REPORTS them now
  {
    const run = arrival(4242);
    run.state.session.torusEngaged = true;
    run.state.player.position.copy(run.state.world.station.position)
      .add(new THREE.Vector3(0, 0, 3000));   // inside the 5000-unit mass lock
    const events = fly(run, 1);
    check('a mass lock returns a message instead of calling a HUD',
      events.some((e) => e.kind === 'message' && e.text.startsWith('MASS LOCK')));
    // ...and the same for the noise it makes. The step reached straight into
    // the audio singleton for this one until sounds became events too.
    check('...and the named sound with it, rather than reaching for an AudioContext',
      events.some((e) => e.kind === 'sound' && e.name === 'torusDropped'));
    check('...and the torus really disengaged', !run.state.session.torusEngaged);
  }
  {
    const run = arrival(4243);
    run.state.player.position.copy(run.state.world.planetPos);   // straight down
    fly(run, 1);
    check('flying into the ground ends the run through the host',
      run.log.deaths[0] === 'CRASHED INTO THE PLANET');
  }
  {
    const run = arrival(4244);
    run.state.player.position.copy(run.state.world.sunPos);
    fly(run, 1);
    check('...and so does flying into the sun', run.log.deaths[0] === 'FLEW INTO THE SUN');
  }

  // The countdown blip: the step used to compute `700 + (5 - n) * 100` itself,
  // which is audio design written into the simulation. It reports the SECOND
  // and audio.ts owns the pitch.
  {
    const run = arrival(4245);
    run.state.session.hyperCountdown = 4.001;
    const events = fly(run, 1);
    check('the hyperspace countdown reports the second, not a frequency',
      events.some((e) => e.kind === 'countdown' && e.n === 4));
    check('...alongside the message it has always shown',
      events.some((e) => e.kind === 'message' && e.text === 'HYPERSPACE IN 4'));
    check('...and no event carries a hertz value',
      !events.some((e) => 'hz' in e));
  }

  // --- determinism: same seed, same inputs, same run -------------------------
  //
  // The step draws from ONE seeded stream (game/rng.ts) — NPC decisions, hit
  // rolls, misses, wrecks, encounter timers. Extracting it must not move a
  // single draw across a branch, and this is what says so.
  {
    const a = arrival(7_777_777);
    fly(a, 600);
    const first = trace(a);
    const b = arrival(7_777_777);
    fly(b, 600);
    check('the same seed and the same inputs give a byte-identical run',
      trace(b) === first);
    check('...and the fixture is not vacuously empty',
      a.state.world.npcs.length > 0 && first.length > 500);
    const c = arrival(8_888_888);
    fly(c, 600);
    check('...while a different seed does not', trace(c) !== first);
  }

  // --- the player's gun and hull, assembled from a state ---------------------
  //
  // `Combat.fire` wants seven arguments and `hitPlayer` six, and game.ts built
  // every one of them out of `this` — so the player's own trigger could only be
  // pulled by a Game. combat.ts's firePlayerLaser/damagePlayer do the assembly
  // over a GameState instead, which is what lets another caller fire the real
  // gun and hand the events somewhere other than the HUD.
  //
  // The property that matters is not that the new functions work: it is that
  // they are the SAME call. So each of these runs the shot twice from an
  // identical seeded state — once with the arguments spelled out as game.ts
  // spelled them, once through the extraction — and demands the events, the
  // target's hp and the ship's systems all come out identical.
  {
    /** the same state twice: a pirate parked dead ahead, tough enough to live */
    const dueller = () => {
      seedWorld(60_606);
      const state = freshState(newCommander());
      state.world.build(state.systems[state.commander.systemIndex]);
      state.player.position.set(0, 0, 0);
      state.player.quaternion.identity();          // nose along -Z
      const npc = state.world.spawn('pirate', new THREE.Vector3(0, 0, -400), 1);
      npc.state.energy = 90;                             // takes the hit, survives it
      // a ship spawned this frame has no world matrix yet, and the raycast
      // reads matrixWorld — without this the shot is tested against the origin
      npc.object.updateMatrixWorld(true);
      return {
        state, npc,
        combat: new Combat(state.world),
        scratch: {
          a: new THREE.Vector3(), b: new THREE.Vector3(),
          q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
        },
      };
    };

    /** an event list as comparable text: kinds, and the numbers inside them */
    const digest = (events: readonly CombatEvent[]) => JSON.stringify(events.map((e) =>
      e.kind === 'message' ? [e.kind, e.text, e.seconds]
        : e.kind === 'offence' ? [e.kind, e.level]
          : e.kind === 'wrecked' ? [e.kind, e.npc.role]
            : e.kind === 'beam' ? [e.kind, e.at ? e.at.toArray() : null]
              : e.kind === 'died' ? [e.kind, e.reason] : [e.kind]));
    /** what the shot LEFT behind: the target's energy and the ship's systems */
    const after = (d: ReturnType<typeof dueller>) =>
      JSON.stringify([d.npc.state.energy, d.state.sys]);

    const tmp = new THREE.Vector3();
    const byHand = dueller();
    const handEvents = digest(byHand.combat.fire(
      byHand.state.commander, byHand.state.sys, byHand.state.player.position,
      viewDirection(byHand.state.player.quaternion, byHand.state.session.view, tmp),
      byHand.state.session.view, byHand.state.session.witchspace, byHand.scratch));

    const extracted = dueller();
    const outEvents = digest(
      firePlayerLaser(extracted.state, extracted.combat, extracted.scratch));

    check('the extracted trigger reports what game.ts\'s seven arguments did',
      handEvents === outEvents);
    check('...and it was a hit, so the comparison is not of two empty lists',
      handEvents.includes('"offence"') && byHand.npc.state.energy < 90);
    check('...leaving the same energy on the target and the same heat in the gun',
      after(byHand) === after(extracted));

    // The view is read from the state, not assumed to be the nose: a rear-view
    // shot hits what is BEHIND you, and that is the one argument of the seven
    // that was easiest to lose in the move.
    const rear = dueller();
    rear.npc.object.position.set(0, 0, 400);
    rear.npc.object.updateMatrixWorld(true);
    rear.state.session.view = 1;                   // looking aft
    rear.state.commander.equipment.rearLaser = true;
    const aft = digest(firePlayerLaser(rear.state, rear.combat, rear.scratch));
    check('a rear-view shot still hits what is behind you',
      aft.includes('"offence"') && rear.npc.state.energy < 90);
    // ...and without the mount there is nothing to fire, which is the other
    // half of the view reaching the gun
    const noMount = dueller();
    noMount.npc.object.position.set(0, 0, 400);
    noMount.npc.object.updateMatrixWorld(true);
    noMount.state.session.view = 1;
    check('...and with no rear mount fitted, nothing happens at all',
      firePlayerLaser(noMount.state, noMount.combat, noMount.scratch).length === 0
        && noMount.npc.state.energy === 90);

    // ...and the damage model, the same way. The shield absorbs it, so
    // applyDamage draws no rng and the two calls are directly comparable.
    const hitByHand = dueller();
    const shieldWas = hitByHand.state.sys.foreShield;
    const hitFrom = new THREE.Vector3(0, 0, -400);
    const handHit = digest(hitByHand.combat.hitPlayer(
      hitByHand.state.sys, 0.5, hitFrom,
      hitByHand.state.player.position, hitByHand.state.player.quaternion,
      hitByHand.scratch));
    const hitExtracted = dueller();
    const outHit = digest(
      damagePlayer(hitExtracted.state, hitExtracted.combat, 0.5, hitFrom,
        hitExtracted.scratch));
    check('the extracted damage path reports the same as the hand-built call',
      handHit === outHit);
    check('...and takes it off the same shield, which really did drop',
      JSON.stringify(hitByHand.state.sys) === JSON.stringify(hitExtracted.state.sys)
        && hitExtracted.state.sys.foreShield < shieldWas);

    // From behind it is the AFT shield. Which shield takes a hit is the one
    // thing hitPlayer resolves out of the player's transform, so it is the bit
    // the extraction could most easily have got wrong.
    const fromAft = dueller();
    damagePlayer(fromAft.state, fromAft.combat, 0.5, new THREE.Vector3(0, 0, 400),
      fromAft.scratch);
    check('a hit from astern lands on the aft shield',
      fromAft.state.sys.aftShield < shieldWas
        && fromAft.state.sys.foreShield === shieldWas);
  }

  // --- and every hit says what did it ----------------------------------------
  //
  // Five things can hurt the player and the step knows which one it is at each
  // call. It used to pass only the amount and a position, so anything wanting
  // to attribute the damage — test/combat-recorder.js, and the report a combat
  // simulator owes — had to classify it by magnitude: 0.1-0.221 laser, 0.45
  // ram, 1.3 missile. That cannot error, only be quietly wrong, and it already
  // overlapped (NPC_VS_NPC_DAMAGE is 0.11). `source` replaces the guess.
  {
    const SOURCES: DamageSource[] = ['laser', 'missile', 'ram', 'station', 'cargo'];
    const seen = new Set<DamageSource>();
    const tag = (r: ReturnType<typeof arrival>) => r.log.hits.map((h) => h.source);

    // an NPC's gun, over a long enough fight to connect
    const fight = arrival(4_246);
    fly(fight, 600);
    for (const s of tag(fight)) seen.add(s);
    check('an NPC laser hit is tagged "laser"',
      fight.log.hits.length > 0 && tag(fight).includes('laser'));
    check('...with the amount npcShotDamage produces, not a name for a number',
      fight.log.hits.filter((h) => h.source === 'laser')
        .every((h) => h.amount >= 0.1 && h.amount <= 0.221));

    // a canister on the hull, with no scoop fitted
    const canister = arrival(4_247);
    canister.state.commander.equipment.scoops = false;
    canister.state.world.cargo.spawn(canister.state.player.position.clone(), 1, [0]);
    fly(canister, 2);
    const onHull = canister.log.hits.filter((h) => h.source === 'cargo');
    check('a canister breaking on the hull is tagged "cargo"', onHull.length === 1);
    check('...at 0.06', onHull[0]?.amount === 0.06);
    for (const s of tag(canister)) seen.add(s);

    // a ship flying into you
    const ram = arrival(4_248);
    ram.state.world.spawn('pirate', ram.state.player.position.clone(), 2);
    fly(ram, 1);
    const rammed = ram.log.hits.filter((h) => h.source === 'ram');
    check('a ram is tagged "ram"', rammed.length >= 1);
    check(`...at RAM_DAMAGE (${RAM_DAMAGE})`,
      rammed.every((h) => h.amount === RAM_DAMAGE));
    for (const s of tag(ram)) seen.add(s);

    // the Coriolis wall
    const wall = arrival(4_249);
    wall.state.player.position.copy(wall.state.world.station.position);
    fly(wall, 1);
    const scraped = wall.log.hits.filter((h) => h.source === 'station');
    check('flying into the station is tagged "station"', scraped.length === 1);
    check('...at 0.9', scraped[0]?.amount === 0.9);
    for (const s of tag(wall)) seen.add(s);

    // a missile that got through
    const missile = arrival(4_250);
    missile.ordnance.launchHostile(
      missile.state.player.position.clone().add(new THREE.Vector3(0, 0, -600)));
    fly(missile, 300);
    const hit = missile.log.hits.filter((h) => h.source === 'missile');
    check('a missile getting through is tagged "missile"', hit.length >= 1);
    for (const s of tag(missile)) seen.add(s);

    check('all five ways to be hurt are named, and nothing else is',
      SOURCES.every((s) => seen.has(s)) && seen.size === SOURCES.length);
  }

  // massLocked() is the flight keys' rule and the torus drive's, and it is one
  // function over the state now rather than a method on the Game.
  {
    const run = arrival(4245);
    run.state.player.position.copy(run.state.world.station.position);
    check('mass lock is a free function over the state', massLocked(run.state));
    run.state.player.position.set(1e7, 1e7, 1e7);
    check('...and out in the deep it is clear', !massLocked(run.state));
  }

  // --- ...and it SAVES without a browser -------------------------------------
  //
  // captureSnapshot/restoreSnapshot were private methods of game.ts, so the
  // only thing this file could say about the save was a grep for field NAMES —
  // which is exactly the check that passed through all four historical "two
  // reloads agree with each other but not with the run they came from" bugs.
  //
  // They are persistence.ts now, behind a six-method host, so the real save can
  // be taken and put back under node: fly a world, capture it THROUGH JSON,
  // restore into a FRESH state, and demand the restored world continues the run
  // rather than merely resembling it.
  {
    const stubHost = (state: ReturnType<typeof freshState>, log: string[]): PersistenceHost => ({
      baseMode: () => 'flight',
      enterMode: (mode) => { log.push(`mode:${mode}`); },
      buildWorld: () => {
        state.world.build(state.systems[state.commander.systemIndex]);
        log.push('build');
      },
      enterWitchspace: () => { log.push('witchspace'); },
      isDead: () => false,
      message: (text) => { log.push(`say:${text}`); },
      saveCommander,
      saveWorld,
      readWorld,
      clearWorld,
      withoutSaving,
    });

    const a = arrival(31_337);
    // Re-spawn the pirates the way the GAME spawns them: with the hull their
    // threat tier calls for. The restore picks a pirate's hull back out of
    // `pirateSpecForTier(state.threatTier, seed)` — the tier is saved, the hull
    // is not — so a pirate spawned off the default roster comes back with a
    // different turn rate and flies a different fight. That is a real property
    // of the save, and the harness has to spawn the way the game does to test
    // it rather than trip over it.
    a.state.world.clearNpcs();
    for (let i = 0; i < 3; i++) {
      const p = a.state.world.spawn('pirate',
        a.state.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)),
        i, pirateSpecForTier(1, i));
      p.state.threatTier = 1;
    }
    a.state.world.spawn('trader',
      a.state.player.position.clone().add(new THREE.Vector3(-900, -200, -2600)), 7);
    a.state.commander.credits = 12_345;
    a.state.chart.targetIndex = 42;
    fly(a, 300);
    const aLog: string[] = [];
    const snap = new Persistence(a.state, a.ordnance, new CombatComputer(), stubHost(a.state, aLog))
      .capture();

    check('the real save is taken with no Hud, no screens and no localStorage',
      snap.mode === 'flight' && snap.npcs.length > 0 && aLog.length === 0);
    // through JSON, because that is what a save IS
    const wire = JSON.stringify(snap);
    check('...and it is plain JSON', wire.length > 1000 && !wire.includes('undefined'));

    seedWorld(1);   // deliberately the WRONG stream: the restore must fix it
    const b = arrival(99);
    const bLog: string[] = [];
    new Persistence(b.state, b.ordnance, new CombatComputer(), stubHost(b.state, bLog))
      .restore(JSON.parse(wire) as WorldSnapshot);

    check('restoring rebuilds the scene before it places the ships',
      bLog[0] === 'build');
    check('...and hands the mode back to the orchestrator',
      bLog.includes('mode:flight'));
    check('...the commander came back', b.state.commander.credits === 12_345);
    check('...every flight flag and timer came back',
      JSON.stringify(b.state.session) === JSON.stringify(a.state.session));
    check('...the chart came back', b.state.chart.targetIndex === 42);
    check('...the sky came back',
      b.state.world.npcs.length === a.state.world.npcs.length
      && b.state.world.npcs.every((n, i) => n.role === a.state.world.npcs[i].role
        && n.object.position.distanceTo(a.state.world.npcs[i].object.position) === 0));
    check('...and the ship is where it was',
      b.state.player.position.distanceTo(a.state.player.position) === 0
      && b.state.player.speed === a.state.player.speed);
    check('...including the station\'s own orientation, which lives in the scene',
      b.state.world.station.quaternion.toArray().join()
      === a.state.world.station.quaternion.toArray().join());

    // THE property. A field-by-field comparison passes through every bug this
    // has ever had; continuing the run does not.
    const mark = rngState();
    fly(a, 200);
    restoreRng(mark);
    fly(b, 200);
    check('a restored world replays the run it came from, byte for byte',
      trace(b) === trace(a));

    // the negative control: an unrestored world must NOT match
    {
      const c = arrival(99);
      restoreRng(mark);
      fly(c, 200);
      check('...and a world that was not restored does not (the control)',
        trace(c) !== trace(a));
    }
  }
}
