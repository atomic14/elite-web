// The one rule: nothing that happens in the simulator leaves it.
//
// A simulated kill must not touch commander.kills or commander.combatScore —
// Chris's constraint, and the one thing here that would be unforgivable to get
// wrong, because a player could grind the E L I T E ladder in a training room for
// free. Three layers enforce it (the commander clone, the alternative StepHost,
// the entry snapshot) and this file asserts all three, mid-exercise as well as
// after settle() — an earlier version only checked afterwards, where the snapshot
// restore masked a broken swap.

import * as THREE from 'three';
import { Ordnance } from '../src/game/ordnance.ts';
import { WorldStep, type StepHost } from '../src/game/world-step.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { freshState } from '../src/game/state.ts';
import { Persistence, type PersistenceHost } from '../src/game/persistence.ts';
import {
  newCommander, recordFurthestWave, MAX_FUEL, defaultEquipment,
} from '../src/game/commander.ts';
import {
  clearFlightSaves, makeRecord, saveNamespace, withoutSaving,
  writeDockSave, writeFlightSave, writeNamedSave,
} from '../src/game/storage.ts';
import { commanderOf, dockId, flightIds, type SaveRecord } from '../src/game/save-file.ts';
import { Combat, firePlayerLaser, damagePlayer } from '../src/game/combat.ts';
import { MAX_ENERGY } from '../src/constants/pools.ts';
import { durability } from '../src/game/systems.ts';
import { CONTRABAND, CLEAN, FUGITIVE } from '../src/game/law.ts';
import type { CommanderData } from '../src/game/commander.ts';
import { seedWorld, rngState, restoreRng } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import { pirateSpecForTier } from '../src/game/ship-specs.ts';
import { CombatSim, type SimHost } from '../src/game/combat-sim.ts';
import { furthestWave, makeSimLog } from '../src/game/combat-sim-report.ts';
import {
  SHIPPED_SOLO_BRAIN,
  type Opposition,
  type ExerciseSpec,
} from '../src/game/combat-sim-scenarios.ts';
import { type FlightDemand } from '../src/player.ts';
import { CombatComputer } from '../src/game/combat-computer.ts';
import { COMMODITIES } from '../src/galaxy/galaxy.ts';
import { check } from './harness.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';
import { npcImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { dealToNpc } from '../src/game/damage-dealt.ts';

// --- the exercise cannot touch the career ------------------------------------
//
// The safety-critical half of the combat simulator (docs/COMBAT-SIM.md). The one
// rule is that **nothing that happens in the simulator leaves it**, and the load
// -bearing case is that it must not advance you toward E L I T E: a training room
// that credited `kills` or `combatScore` would let a player grind the ladder for
// free, at a station, at no risk.
//
// This runs a FULL exercise headlessly — the real world step, the real gun, the
// real damage model — and kills by every route the game has, dies, breaches a
// hull and collects a bounty. Then it asks four things:
//
//   1. every field of the career commander is unchanged, to the byte
//   2. nothing was written to `elite-web-commander:*` or `elite-web-world:*`,
//      and nothing was REMOVED either — `Game.die` calls `clearWorld()` on
//      purpose, and a simulated death reaching it is data loss, not a leak
//   3. the rng stream is exactly where it was, so the career's next draw is the
//      draw it was about to make
//   4. the career, CONTINUED for 200 steps, is byte-identical to the same 200
//      steps with no excursion at all. A field-by-field comparison passes
//      through every historical snapshot bug in this project; continuing the run
//      does not.
//
// Plus a vacuity guard, which is not optional: the exercise's own record has to
// show kills, shots, damage taken, and an exercise commander whose kill count is
// ABOVE the career's. Without it, "unchanged" proves only that nothing happened.

console.log('\ncombat simulator: nothing leaves the exercise');
{
  /** A career worth protecting: rich, ranked, wanted, and carrying contraband. */
  const career = (): CommanderData => ({
    ...newCommander(),
    name: 'TEST COMMANDER',
    systemIndex: 7,
    credits: 123_456,
    fuel: 51,
    missiles: 3,
    kills: 137,
    combatScore: 642,
    cargo: COMMODITIES.map((_, i) =>
      (i === CONTRABAND[0] ? 4 : i === 0 ? 7 : i === 12 ? 3 : 0)),
    survivors: 1,
    legalStatus: FUGITIVE,
    equipment: {
      ...defaultEquipment(),
      laser: 'beam', rearLaser: true, ecm: true, scoops: true,
      energyBomb: true, energyUnit: true, escapePod: true, largeBay: true,
    },
    mission: { stage: 1, targetIndex: 42 },
    trumbles: 2,
    day: 88,
    contracts: [
      { kind: 'bounty', destination: 7, commodity: 0, qty: 4, reward: 5000,
        deadlineDay: 120, progress: 1 },
      { kind: 'cargo', destination: 12, commodity: 3, qty: 5, reward: 2200,
        deadlineDay: 130, progress: 0 },
    ],
  });

  // --- the fake save, and the spy over it ------------------------------------
  //
  // Node has no localStorage, and this is where the whole safety property is
  // observed, so it is a real object with real counters rather than a mock that
  // returns undefined. There are no numbered slots to stay out of any more:
  // `test/harness.ts` has already called `useHarnessSaves()` (invariant 3), so
  // no key this process can compute is a player's — and this one is a Map in
  // this process anyway, out of reach of a real browser's storage entirely.
  const held = new Map<string, string>();
  const writes: string[] = [];
  const removes: string[] = [];
  const fakeStorage = {
    get length() { return held.size; },
    key: (i: number) => [...held.keys()][i] ?? null,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); held.set(k, v); },
    removeItem: (k: string) => { removes.push(k); held.delete(k); },
    clear: () => { held.clear(); },
  };
  const globals = globalThis as unknown as { localStorage?: unknown };
  const hadStorage = 'localStorage' in globals;
  const previousStorage = globals.localStorage;
  globals.localStorage = fakeStorage;
  /**
   * The career under test, and every key it occupies: the docked checkpoint and
   * the in-flight ring (save-file.ts). `test/harness.ts` has already put this
   * process in the HARNESS namespace, so none of these can be a player's key.
   */
  const CAREER = 'TEST CAREER';
  const DOCK_KEY = saveNamespace() + dockId(CAREER);
  const FLY_KEYS = flightIds(CAREER).map((id) => saveNamespace() + id);
  const CAREER_KEYS = [DOCK_KEY, ...FLY_KEYS];
  // a good save already on disk — the thing a wrong restore would overwrite
  held.set(DOCK_KEY, JSON.stringify(
    makeRecord(CAREER, CAREER, 'dock', null, career())));

  const careerKeyTouched = (log: string[], from: number) =>
    log.slice(from).filter((k) => CAREER_KEYS.includes(k));
  /** Whichever ring slot the career's own flying last wrote. */
  const flightBlob = (): string | undefined =>
    FLY_KEYS.map((k) => held.get(k)).find((v) => v !== undefined);

  // --- a career, and an exercise it can start -------------------------------

  interface Rig {
    state: ReturnType<typeof freshState>;
    ordnance: Ordnance;
    combat: Combat;
    persistence: Persistence;
    sim: CombatSim;
    said: string[];
    flashes: number;
    baseMode: 'docked' | 'flight' | 'dead';
    /** the CAREER's own step, for the flying either side of an excursion */
    step: WorldStep;
    t: number;
    dead: string[];
  }

  const rig = (seed: number, mode: 'docked' | 'flight' = 'docked'): Rig => {
    seedWorld(seed);
    const state = freshState(career());
    state.career = CAREER;
    state.world.build(state.systems[state.commander.systemIndex]);
    const ordnance = new Ordnance(state.world);
    const combat = new Combat(state.world);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(),
      q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
    };
    const r = {
      state, ordnance, combat, said: [] as string[], flashes: 0,
      baseMode: mode, t: 0, dead: [] as string[],
    } as Rig;

    // The persistence host mimics the Game's, INCLUDING the one write that
    // matters: `enterMode('docked')` reaches `Station.dock`, which calls
    // `saveCommander`. That write is the whole reason the restore path is
    // suspended, so a stub that quietly left it out would test nothing.
    const pHost: PersistenceHost = {
      baseMode: () => r.baseMode,
      enterMode: (m) => {
        r.baseMode = m;
        // What the Game does: docking writes the career's checkpoint, through
        // the real storage path. That write is the whole reason the restore is
        // suspended, so a stub that quietly left it out would test nothing.
        if (m === 'docked') r.persistence.checkpoint();
      },
      buildWorld: () => { state.world.build(state.systems[state.commander.systemIndex]); },
      enterWitchspace: () => { state.world.banishScenery(); },
      isDead: () => r.baseMode === 'dead',
      message: (text) => r.said.push(text),
      writeDockSave,
      writeFlightSave,
      writeNamedSave: (name, c, world) => writeNamedSave(name, c, world, 20),
      bootWorld: () => null,
      clearFlightSaves,
      withoutSaving,
    };
    r.persistence = new Persistence(state, ordnance, new CombatComputer(), pHost);

    const simHost: SimHost = {
      enterFlight: () => { r.baseMode = 'flight'; },
      message: (text) => r.said.push(text),
      sound: () => {},
      flashDamage: () => { r.flashes += 1; },
      aimBeams: () => {},
      // Exactly what game.ts does, and it has to be real here: the ONE number a
      // run may leave behind is only worth asserting against a host that
      // actually applies it. The rule is commander.ts's, so this is a wire.
      recordFurthestWave: (wave) => {
        if (recordFurthestWave(state.commander, wave)) r.persistence.checkpoint();
      },
      finished: () => {},
    };
    r.sim = new CombatSim(state, ordnance, combat, r.persistence, simHost, makeSimLog());

    // The career's own host: what the Game does, minus the browser. It really
    // writes the save, so the storage spy is not vacuous — a career that never
    // wrote anything would make "nothing was written during the exercise" true
    // for the wrong reason.
    const careerHost: StepHost = {
      inFlight: () => r.baseMode === 'flight' && r.dead.length === 0,
      applyPlayerDamage: (amount, from) => {
        damagePlayer(state, combat, amount, from, scratch);
      },
      destroyNpc: (npc) => { combat.destroy(state.commander, npc); },
      wreckNpc: (npc) => { combat.wreck(npc); },
      fireLaser: () => { firePlayerLaser(state, combat, scratch); },
      raiseLegal: (level) => {
        if (level > state.commander.legalStatus) state.commander.legalStatus = level;
      },
      die: (reason) => { r.dead.push(reason); },
      dock: () => {},
      completeHyperspace: () => {},
      completeRescue: () => {},
      openHermitTrade: () => {},
      autoSave: () => { r.persistence.autoSave(); },
    };
    r.step = new WorldStep(state, ordnance, careerHost);
    return r;
  };

  const CRUISE: FlightDemand = { rollRate: 0, pitchRate: 0, throttle: 0, fire: false };

  /**
   * three.js updates world matrices at RENDER time, and `traceShot` raycasts
   * against them — so headless, the harness has to do the renderer's one job or
   * every shot is tested against the origin.
   */
  const settleMatrices = (r: Rig) => { r.state.world.scene.updateMatrixWorld(true); };

  /** Frames of exercise, with the career's teardown checked after each. */
  const beat = (r: Rig, steps: number, demand: FlightDemand = CRUISE,
    aim?: () => THREE.Vector3 | null) => {
    for (let i = 0; i < steps; i++) {
      if (aim) {
        const at = aim();
        if (at) {
          r.state.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
            r.state.player.position, at, new THREE.Vector3(0, 1, 0)));
        }
      }
      r.sim.tick(FIXED_DT, r.t, { demand, handsOn: false });
      r.t += FIXED_DT;
      r.sim.settle();
      settleMatrices(r);
    }
  };

  /** Frames of ordinary career flight, through the career's own step. */
  const flyCareer = (r: Rig, steps: number, demand: FlightDemand) => {
    for (let i = 0; i < steps; i++) {
      r.step.step(FIXED_DT, r.t, { demand, handsOn: false });
      r.t += FIXED_DT;
      settleMatrices(r);
    }
  };

  /** Read `baseMode` without narrowing: the exercise changes it through a host. */
  const whereShipIs = (r: Rig): string => r.baseMode;

  const park = (npc: NpcShip, at: THREE.Vector3) => {
    npc.object.position.copy(at);
    npc.object.updateMatrixWorld(true);
  };

  /** Which fields of two commanders differ, by name. */
  const commanderDiff = (a: CommanderData, b: CommanderData): string[] =>
    Object.keys(a).filter((k) => JSON.stringify((a as unknown as Record<string, unknown>)[k])
      !== JSON.stringify((b as unknown as Record<string, unknown>)[k]));

  // --- one full exercise: every kill route, a death, a breach, a bounty ------

  {
    const r = rig(20_260_730, 'docked');
    const s = r.state;
    // A career that has been flying: the world blob exists, so a stray
    // `clearWorld()` would have something to destroy.
    r.baseMode = 'flight';
    s.player.position.copy(s.world.station.position).normalize()
      .multiplyScalar(s.world.planetRadius * 16);
    s.player.speed = 180;
    s.session.autoSaveTimer = 0.5;
    flyCareer(r, 120, CRUISE);
    r.baseMode = 'docked';
    // ...and then docks, which is what writes the checkpoint. Both halves of
    // the career's own saving are exercised before the excursion, so "nothing
    // was written during it" cannot be true for the wrong reason.
    const flewBlob = flightBlob();
    r.persistence.checkpoint();
    check('the career writes its own save, so the storage spy is not vacuous',
      careerKeyTouched(writes, 0).length >= 2 && !!flewBlob && !!held.get(DOCK_KEY));
    // …and traffic in the sky, so "the sky came back" has something to come back
    for (let i = 0; i < 3; i++) {
      const t = s.world.spawn('trader',
        s.player.position.clone().add(new THREE.Vector3(900 * (i - 1), 200, -2400)), i);
      t.state.energy = 300 + i;
    }
    settleMatrices(r);

    const before = structuredClone(s.commander);
    // the career OBJECT itself, so a mid-exercise check can prove the swap
    // happened rather than that the teardown repaired it
    const careerObj = s.commander;
    const playerBefore = s.player.position.clone();
    const rngBefore = rngState();
    const skyBefore = s.world.npcs.map((n) => [n.role, n.state.energy,
      n.object.position.toArray().join()].join('|'));
    const writeMark = writes.length;
    const removeMark = removes.length;
    const worldBlob = flightBlob();
    const savedCommander = held.get(DOCK_KEY);

    // Five pirates, so there is still opposition alive when the commander dies.
    const custom: Opposition[] = [{
      role: 'pirate', count: 5, tier: 1, organised: false,
      brain: SHIPPED_SOLO_BRAIN, mixed: false, seed: 31,
    }];
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'single-pirate', tier: 1, seed: 4242, custom,
    };
    check('an exercise starts', r.sim.begin(spec));
    check('...and it is ordinary FLIGHT, not a screen', whereShipIs(r) === 'flight');
    check('...flying a commander that is not the career',
      r.sim.commander !== null && r.sim.commander !== before
      && s.commander !== before);
    check('...with no cargo, no contracts and a clean record aboard',
      r.sim.commander!.cargo.every((q) => q === 0)
      && r.sim.commander!.contracts.length === 0
      && r.sim.commander!.legalStatus === CLEAN);
    check('...and the career\'s kill count copied across, so credit is visible',
      r.sim.commander!.kills === before.kills);
    check('...in an arena with nothing in it but the opposition',
      s.world.npcs.length === 5 && s.world.npcs.every((n) => n.role === 'pirate'));
    check('...and the ambient traffic switched off',
      s.encounterTimers.pirateWave > 1e6 && s.encounterTimers.trader > 1e6
      && Number.isFinite(s.encounterTimers.trader));

    const foes = [...s.world.npcs];
    const fwd = s.player.getForward(new THREE.Vector3()).clone();
    // Out of the way until they are wanted — and each to its OWN corner, or
    // three ships sharing a coordinate ram each other to death and the round
    // clears itself while the harness is looking elsewhere.
    const corners = [
      new THREE.Vector3(30_000, 0, 0),
      new THREE.Vector3(0, 30_000, 0),
      new THREE.Vector3(0, 0, 30_000),
    ];
    [2, 3, 4].forEach((f, k) => park(foes[f], s.player.position.clone().add(corners[k])));

    // 1. A LASER kill — the path a host-only defence cannot see, because
    //    `Combat.fire` calls `destroy(commander, …)` internally.
    foes[0].state.energy = 1;   // one bolt's worth: a pulse laser does 7-8 points
    park(foes[0], s.player.position.clone().addScaledVector(fwd, 420));
    beat(r, 20, { ...CRUISE, fire: true }, () => foes[0].object.position);
    check('a kill by laser leaves the sky', !foes[0].state.alive);
    check('...and is credited to the EXERCISE commander, not the career',
      r.sim.commander!.kills === before.kills + 1 && before.kills === 137);

    // 2. A RAM kill — through the step's collision phase.
    foes[1].state.energy = 2;
    park(foes[1], s.player.position.clone().addScaledVector(fwd, 10));
    beat(r, 4);
    check('a kill by ram leaves the sky too', !foes[1].state.alive);

    // 3. A MISSILE kill — through `applyOrdnance`, and it spends the clone's rack.
    const rackBefore = r.sim.commander!.missiles;
    park(foes[2], s.player.position.clone().addScaledVector(fwd, 900));
    r.ordnance.targetLock = foes[2];
    r.ordnance.armed = true;
    r.ordnance.launch(r.sim.commander!, s.player.position);
    check('the missile came off the EXERCISE commander\'s rack',
      r.sim.commander!.missiles === rackBefore - 1);
    beat(r, 150, CRUISE, () => foes[2].object.position);
    check('a kill by missile leaves the sky', !foes[2].state.alive);

    // 4. An ENERGY BOMB kill — which reaches `Game.destroyNpc` from
    //    `runCommand`, not through the step at all. This is what the Game's
    //    two-line redirect into the exercise is for: the damage, then the kill.
    //    Both lines are copied from `Game.detonateEnergyBomb`, because a bomb
    //    resolved any other way here would be testing this harness.
    park(foes[3], s.player.position.clone().addScaledVector(fwd, 1500));
    const bomb = r.ordnance.detonateEnergyBomb(r.sim.commander!, s.player.position);
    check('the bomb came off the exercise commander\'s hull', bomb.reply === 'bombFired');
    for (const npc of bomb.caught) {
      const hit = dealToNpc(
        npc, npcImpactDamage(IMPACT.energyBomb), s.player.position, 'bomb');
      r.sim.playerDealt(hit.event);
      r.sim.destroyNpc(npc);
    }
    beat(r, 2);
    check('a kill by energy bomb leaves the sky', !foes[3].state.alive);
    check('...and four kills went to the clone, which the career never sees',
      r.sim.commander!.kills === before.kills + 4);
    check('...as did the bounties on them',
      r.sim.commander!.credits > before.credits);
    check('...and the combat score that the E L I T E ladder reads',
      r.sim.commander!.combatScore > before.combatScore);

    // 5. A HULL BREACH — which costs a fitting, off the CLONE's hull.
    let breached = false;
    for (let i = 0; i < 60 && !breached; i++) {
      s.sys.foreShield = 0;
      s.sys.aftShield = 0;
      s.sys.energy = MAX_ENERGY;
      // shields flat, so a single point is a hull hit and rolls for a fitting
      r.sim.verbs.applyPlayerDamage(
        playerPoolPoints(1), foes[4].object.position, 'laser');
      breached = !r.sim.commander!.equipment.ecm
        || !r.sim.commander!.equipment.scoops
        || !r.sim.commander!.equipment.rearLaser;
    }
    check('a hull breach costs the exercise commander a fitting', breached);

    // PREVENTION, not repair — asserted here, mid-exercise, ON PURPOSE.
    //
    // Every other career assertion in this block runs after settle(), and by
    // then the entry snapshot has restored the commander. So a BROKEN commander
    // swap would still pass them: the repair layer masks the prevention layer.
    // Verified by mutation — pointing the exercise at the career commander
    // instead of a clone left "every field of the career commander is
    // unchanged" green.
    //
    // The three layers are not interchangeable. The swap and the host refusals
    // PREVENT; the snapshot REPAIRS. Prevention is what protects a player,
    // because it is the layer that still holds when the other one has a bug.
    // So: the career object must be untouched WHILE the fight is running, four
    // kills and a bounty and a breach in.
    check('the career commander is untouched DURING the exercise, not just after',
      careerObj.kills === before.kills
      && careerObj.combatScore === before.combatScore
      && careerObj.credits === before.credits
      && careerObj.legalStatus === before.legalStatus);
    check('...and the exercise is flying a different object entirely',
      r.sim.commander !== careerObj);

    // 6. And a DEATH, which must never reach `Game.die` and its clearWorld().
    const clone = structuredClone(r.sim.commander!);
    s.sys.energy = 1;
    r.sim.verbs.applyPlayerDamage(
      playerPoolPoints(durability(false)), foes[4].object.position, 'laser');
    check('a simulated death ends the exercise', !r.sim.fighting);
    const records = r.sim.settle() ?? [];
    check('...and the teardown produced a record', records.length === 1);

    // --- the vacuity guard ---------------------------------------------------
    const rec = records[0];
    check(`the record is of a real fight (${rec.you.kills} kills, `
      + `${rec.you.shots} shots, ${rec.them.damageToYou} damage taken)`,
      rec.you.kills >= 1 && rec.you.shots >= 1 && rec.them.damageToYou > 0);
    // Four kills by four routes, and the damage that bought each of them is on
    // the record — the laser is the only one that used to be (TODO 47). The
    // figures themselves are asserted in test/combat-sim-dealt.test.ts; what
    // this adds is that all four routes credit in ONE fight.
    check(`...with the damage that won it, by source `
      + `(${Object.keys(rec.you.damageBySource).join('/') || 'none'})`,
      rec.you.damageDealt > 0
      && (['laser', 'ram', 'missile', 'bomb'] as const)
        .every((k) => (rec.you.damageBySource[k]?.damage ?? 0) > 0));
    check('...that the commander lost', rec.outcome === 'destroyed');
    check('...with the exercise commander\'s kills above the career\'s',
      clone.kills > before.kills && clone.kills === before.kills + 4);
    check('...and every opponent named with the brain it flew',
      rec.opponents.length === 5
      && rec.opponents.every((o) => !!o.hull && o.brain === SHIPPED_SOLO_BRAIN));
    check('...and the geometry was sampled', rec.envelope.samples > 10);

    // --- and now the four properties ----------------------------------------
    const diff = commanderDiff(before, s.commander);
    check(`every field of the career commander is unchanged (${diff.join() || 'none differ'})`,
      diff.length === 0);
    check('...including the two the whole rule is about',
      s.commander.kills === 137 && s.commander.combatScore === 642);
    check('...and its credits, missiles, cargo and equipment',
      s.commander.credits === 123_456 && s.commander.missiles === 3
      && s.commander.equipment.energyBomb && s.commander.equipment.ecm
      && s.commander.cargo[CONTRABAND[0]] === 4);
    check('...and its legal status, which a simulated offence cannot move',
      s.commander.legalStatus === FUGITIVE);

    check('nothing was WRITTEN to the commander or the world during the exercise',
      careerKeyTouched(writes, writeMark).length === 0);
    check('...and nothing was REMOVED either — die() drops the in-flight ring',
      careerKeyTouched(removes, removeMark).length === 0
      && flightBlob() === worldBlob);
    check('...so the save on disk is the one that was there before',
      held.get(DOCK_KEY) === savedCommander);
    check('...and the write the restore path DOES attempt was refused, '
      + 'which is what makes the suppression load-bearing',
      r.sim.refusedWrites.includes(DOCK_KEY));

    check('the rng stream is exactly where the career left it',
      JSON.stringify(rngState()) === JSON.stringify(rngBefore));
    check('the sky came back',
      s.world.npcs.map((n) => [n.role, n.state.energy,
        n.object.position.toArray().join()].join('|')).join('#') === skyBefore.join('#')
      && skyBefore.length > 0);
    check('...and the ship is where it was, not out in the arena',
      whereShipIs(r) === 'docked'
      && s.player.position.distanceTo(playerBefore) === 0);
    check('the exercise is over and holds nothing', !r.sim.active);
    check('...and its record went into the ring for the trainer to read',
      r.sim.simLog.records.length === 1 && r.sim.simLog.last() === rec);
  }

  // --- every member of the alternative StepHost, driven directly ------------
  //
  // The second layer is a list of twelve verbs, and a defence whose only test is
  // that one fight happened to come out safe is not a tested defence. So: start
  // an exercise and call every one of them.

  {
    const r = rig(555_666, 'docked');
    const s = r.state;
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'pirate-pair', tier: 1, seed: 77,
    };
    r.sim.begin(spec);
    const clone = s.commander;
    const foes = [...s.world.npcs];
    const writeMark = writes.length;
    const removeMark = removes.length;
    const at = foes[0].object.position;

    check('StepHost.inFlight — true while the exercise is a fight',
      r.sim.verbs.inFlight() === true);

    r.sim.verbs.autoSave();
    check('StepHost.autoSave — REFUSED: the save is the career\'s',
      writes.length === writeMark && removes.length === removeMark);

    r.sim.verbs.dock();
    check('StepHost.dock — REFUSED: docking pays a fine and writes the save',
      r.sim.fighting && r.baseMode === 'flight' && writes.length === writeMark);

    r.sim.verbs.raiseLegal(FUGITIVE);
    check('StepHost.raiseLegal — REFUSED: an exercise cannot make you a Fugitive',
      clone.legalStatus === CLEAN);

    const wasSystem = clone.systemIndex;
    r.sim.verbs.completeHyperspace();
    check('StepHost.completeHyperspace — REFUSED: no fuel spent, no day passed',
      clone.systemIndex === wasSystem && clone.fuel === MAX_FUEL && clone.day === 88);

    r.sim.verbs.completeRescue();
    check('StepHost.completeRescue — REFUSED: nothing taken as salvage',
      clone.cargo.every((q) => q === 0) && clone.systemIndex === wasSystem);

    r.sim.verbs.openHermitTrade();
    check('StepHost.openHermitTrade — REFUSED: a market would stop the world',
      !s.session.hermitTrading && s.market.length === 0);

    const flashes = r.flashes;
    const shieldWas = s.sys.foreShield;
    r.sim.verbs.applyPlayerDamage(playerPoolPoints(10), at, 'laser');
    check('StepHost.applyPlayerDamage — REDIRECTED: real damage, real flash',
      s.sys.foreShield < shieldWas && r.flashes === flashes + 1);

    r.sim.verbs.fireLaser();
    check('StepHost.fireLaser — REDIRECTED: the real gun, and the gun got hot',
      s.sys.laserTemp > 0);

    const killsWas = clone.kills;
    r.sim.verbs.wreckNpc(foes[0]);
    check('StepHost.wreckNpc — PASS-THROUGH: out of the sky, credited to nobody',
      !s.world.npcs.includes(foes[0]) && clone.kills === killsWas);

    r.sim.verbs.destroyNpc(foes[1]);
    check('StepHost.destroyNpc — REDIRECTED: credited to the clone',
      clone.kills === killsWas + 1 && !s.world.npcs.includes(foes[1]));

    r.sim.verbs.die('CABIN TEMPERATURE CRITICAL');
    check('StepHost.die — REDIRECTED: it ends the exercise…', !r.sim.fighting);
    check('…and NOT the career, whose world blob is untouched',
      careerKeyTouched(removes, removeMark).length === 0);

    const records = r.sim.settle() ?? [];
    check('the verb battery still left the career alone',
      commanderDiff(career(), s.commander).length === 0 && records.length === 1);
    check('...and the record says what the fight was worth',
      records[0].you.shots >= 1 && records[0].kills.total === 2);
  }

  // --- the stronger form: the career CONTINUES as if nothing happened -------

  {
    const demand: FlightDemand = { rollRate: 0.3, pitchRate: 0.15, throttle: 1, fire: true };
    /**
     * What the run LOOKED like, to the byte — minus the ONE field a run of
     * waves is allowed to move.
     *
     * `furthestWave` is left out here and asserted on its own below, which is
     * the honest shape of the promise: the career after an excursion is
     * byte-identical to a career that never took one EXCEPT for the number the
     * exercise is allowed to leave behind, and that number is checked by name
     * rather than excused by a looser comparison.
     */
    const trace = (r: Rig) => JSON.stringify({
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
      commander: { ...r.state.commander, furthestWave: 'CHECKED SEPARATELY' },
    });

    /** A career mid-flight, with a reception around it. */
    const flying = (seed: number): Rig => {
      const r = rig(seed, 'flight');
      const s = r.state;
      s.player.position.copy(s.world.station.position).normalize()
        .multiplyScalar(s.world.planetRadius * 16);
      s.player.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(
        s.player.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
      s.player.speed = 200;
      for (let i = 0; i < 3; i++) {
        const p = s.world.spawn('pirate',
          s.player.position.clone().add(new THREE.Vector3(320 * (i - 1), 140, -1500)),
          i, pirateSpecForTier(1, i));
        p.state.threatTier = 1;
      }
      settleMatrices(r);
      return r;
    };

    const control = flying(9_090_909);
    const mark = rngState();
    flyCareer(control, 200, demand);
    const wanted = trace(control);

    const excursion = flying(9_090_909);
    restoreRng(mark);
    // …and 400 frames of a live exercise in the middle of it, which spawns
    // ships, fires guns, spends missiles, draws from the stream and rebuilds the
    // world on the way out.
    excursion.sim.begin({ mode: 'waves', scenario: 'single-pirate', tier: 2, seed: 8_675_309 });
    beat(excursion, 600, { rollRate: 0.2, pitchRate: -0.1, throttle: 1, fire: true });
    const excursionRecords = excursion.sim.quit() ?? [];
    const flown = excursionRecords.reduce((n, x) => n + x.envelope.samples, 0);
    const fired = excursionRecords.reduce((n, x) => n + x.you.shots, 0);
    check(`the excursion was a real fight, not a formality (${excursionRecords.length} `
      + `records, ${flown} samples, ${fired} shots)`,
      excursionRecords.length >= 1 && flown > 60 && fired > 10);
    check('...and it was flying in FLIGHT mode, so it restored to flight',
      excursion.baseMode === 'flight');

    flyCareer(excursion, 200, demand);
    check('200 steps of career after an excursion are byte-identical to 200 with none',
      trace(excursion) === wanted);
    check('...and the fixture is not vacuously empty',
      wanted.length > 1000 && control.state.world.npcs.length > 0);

    // --- the ONE thing a run of waves is allowed to leave behind -------------
    //
    // TODO 39: a run needs a result worth coming back to, so the furthest wave
    // it reached is kept with the commander. Everything else about the run is
    // still gone — the check above is over every other field of the commander,
    // by name, and it is that check which makes this one an exception rather
    // than a hole. It is not a rating, a kill or a credit, and nothing in the
    // career reads it.
    {
      const best = excursion.state.commander.furthestWave;
      check(`a run of waves leaves its furthest wave on the career (wave ${best})`,
        best >= 1 && best === furthestWave(excursionRecords));
      check('...and a career that never flew one has none',
        control.state.commander.furthestWave === 0);
      check('...and it is SAVED, not just held — a best that dies with the tab is not one',
        commanderOf(JSON.parse(held.get(DOCK_KEY) ?? '{}') as SaveRecord)
          ?.furthestWave === best);
      check('...while the two fields the whole rule is about did not move',
        excursion.state.commander.kills === 137
        && excursion.state.commander.combatScore === 642);
      // ...and it only ever grows: a bad run does not cost you a good one.
      recordFurthestWave(excursion.state.commander, 1);
      check('...and a worse run later cannot take it away',
        excursion.state.commander.furthestWave === best);
    }

    // the negative control: a career that took a DIFFERENT excursion is allowed
    // to differ from neither of them — what must not differ is the one above
    const naive = flying(9_090_909);
    restoreRng(mark);
    flyCareer(naive, 199, demand);
    check('...while 199 steps do not (the control)', trace(naive) !== wanted);

    // --- the career's own brain selection survives an exercise --------------
    //
    // Which brain an NPC flies used to be four ambient `window.__` globals,
    // which cost this three ways: the flag was not in the snapshot, so a save
    // restored in a fresh tab flew DIFFERENT brains than the run it came from;
    // a test leaked its choice into the next unless it cleared up by hand; and
    // the trainer needed a save-the-old-value/put-it-back dance, run FIRST in
    // teardown, because a career left flying an exercise's A/B brain is a leak
    // nobody would ever notice.
    //
    // `state.brains` is a field of GameState, so it is in the entry snapshot
    // and the ordinary restore puts it back. The hazard is deleted rather than
    // guarded — which is only true if it is really in the snapshot, so: drop
    // `brains` from Persistence.capture() and the LAST check here fails. That
    // mutation passes every other test in this file, including the
    // name-presence grep above, which sees the field name and not the value.
    const ab = flying(5_150_515);
    ab.state.brains = { scripted: true };
    ab.sim.begin({
      mode: 'sparring', scenario: 'single-pirate', tier: 2, seed: 4_242,
      brain: 'pirate-pack-r4-selectonly',
    });
    check('an exercise flies the brain IT asked for, not the career\'s',
      ab.state.brains.pack === true && ab.state.brains.scripted === undefined);
    beat(ab, 120, demand);
    ab.sim.quit();
    check('...and the career\'s own selection is back when the exercise ends',
      ab.state.brains.scripted === true && !ab.state.brains.pack);
  }

  if (hadStorage) globals.localStorage = previousStorage;
  else delete globals.localStorage;
}

// A FOURTH THING AN EXERCISE COULD LEAVE BEHIND is asserted in
// test/persistence.test.ts rather than here, and it is the exception that
// names its home: the room reaching OUT and rerolling the station's market and
// bulletin board on the way past (docs/TODO/46). It is a claim about
// `Persistence.restore` beating the `Station.dock` that follows it — the rig
// below has a persistence host that sets `baseMode` itself and never reaches
// the station, which is exactly why this file could not have caught it — and
// it needs a whole Game, which cannot be built after test/ui.test.ts installs
// its partial `document`.


// --- result -----------------------------------------------------------------
