// The exercise: a real fight that costs nothing.
//
// The third and last piece of the combat trainer (docs/COMBAT-SIM.md).
// combat-sim-scenarios.ts says WHO you fight and when it stops,
// combat-sim-report.ts counts what happened, spawning.ts puts the arena in the
// sky — and this runs the thing: the commander swap, the entry snapshot, its own
// `StepHost`, and the round loop that drives the two.
//
// **An exercise is not a screen.** `Game.mode` is derived (`screens.topId ??
// baseMode`) and `updateFlight()` runs only while it is `'flight'`, so the world
// does not step at all while an overlay is open. So this is ordinary flight with
// a different step behind it: same `WorldStep`, same brains, same guns, same
// seeded stream — and `updateFlight` chooses which of the two to run.
//
// ## The one rule, and why it takes three layers
//
// **Nothing that happens in here leaves it**, and the load-bearing case is that
// it must not advance you toward E L I T E: `commander.kills` and
// `commander.combatScore` are what `rating()` reads, and a training room that
// credited either would let a player grind the ladder for free, at a station,
// at no risk. The three layers are not interchangeable — the first two PREVENT
// and the third REPAIRS:
//
//  1. **The commander swap** (`exerciseCommander`). `Combat` takes the
//     commander per call, deliberately, and `Combat.fire()` calls
//     `this.destroy(commander, …)` INTERNALLY — a laser kill, which is the
//     commonest kill in the game, never passes through `StepHost.destroyNpc`.
//     No host-only defence can see it. Swapping `state.commander` for a clone
//     covers that call, the energy bomb's call from `runCommand`, and everything
//     the step writes without asking: `survivors`, `cargo` when you scoop,
//     `fuel` when you skim, and `missiles` when `Ordnance.launch` fires one.
//  2. **The alternative `StepHost`** (`stepHost()` below): 1 pass-through,
//     5 redirects, 6 refusals, each argued at its own line.
//  3. **The entry snapshot**, captured on entry and restored on exit — which
//     also puts the rng stream back exactly, because `Persistence.restore` does
//     that last.
//
// `die()` is the one that is data loss rather than a leak: `Game.die` calls
// `clearWorld()` on purpose, so death is not optional if you refresh, and a
// simulated death reaching it would delete the player's real saved world. It is
// redirected here and can never be reached.
//
// ## Where the session state lives, and why not in `GameState`
//
// It is a module instance owned by the Game, exactly as `station`, `ordnance`,
// `persistence` and `autopilot` are — not a field beside `GameState` and not a
// field inside it. Inside would be worse than untidy: a `GameState` field is
// obliged to appear in `capture()` and `restore()` (a test enforces it), so the
// SAVE would carry an in-progress exercise, and resuming a tab would drop the
// player back into a training room holding a snapshot of the career they were
// in the middle of restoring. An exercise is deliberately the one thing in this
// project that does NOT survive a reload: close the tab mid-exercise and you
// wake up at the station with your career untouched, which is the whole promise.
//
// Teardown is DEFERRED for a reason of the same kind. `applyPlayerDamage` is
// called from inside `stepNpcs`/`applyOrdnance`, so restoring the world there
// would rebuild the scene and teleport the player mid-frame while the step was
// still iterating. `finish()` records the outcome and flips a phase, `inFlight()`
// goes false so the frame unwinds, and `updateFlight` calls `settle()` after the
// step has returned.

import * as THREE from 'three';

import type { CommanderData, Equipment } from './commander.ts';
import {
  Combat, BEAM_FLASH, damagePlayer, firePlayerLaser,
  type CombatEvent, type CombatScratch, type DamageSource,
} from './combat.ts';
import {
  CombatSimRecorder, aimAngle, makeSimLog,
  type CombatSimReport, type ContactSample, type ExerciseSetup, type FrameSample,
  type OpponentSetup, type PlayerLoadout, type SimLog, type SimOutcome,
} from './combat-sim-report.ts';
import {
  MODES, allShips, describeOpposition, liveBrainFor, nextOpposition, roundOutcome,
  roundSeed, scenarioById,
  type BrainId, type ExerciseSession, type ExerciseSpec, type Opposition,
  type SimShip, type ThreatContext,
} from './combat-sim-scenarios.ts';
import type { NpcShip } from './npc.ts';
import type { Ordnance } from './ordnance.ts';
import type { Persistence } from './persistence.ts';
import { random, seedWorld } from './rng.ts';
import {
  exerciseCommander, exerciseStepHost, selectionForBrain,
} from './combat-sim-safety.ts';
import type { WorldSnapshot } from './snapshot.ts';
import { arenaCentre, spawnOpposition, type OppositionUnit } from './spawning.ts';
import { freshSession, type GameState } from './state.ts';
import { withoutSaving } from './storage.ts';
import { breachLoss, freshSystems } from './systems.ts';
import { type PilotInput, type StepEvent, type StepHost, WorldStep } from './world-step.ts';

/**
 * How far out the encounter timers are pushed while an exercise runs.
 *
 * Without this `stepEncounters` keeps doing its job — traders warp in, and a
 * lawless system throws a pirate wave at you — and the arena fills up with
 * ships the scenario never asked for. `test/gang-trial.js` hit exactly this and
 * reported "4 of 3 alive".
 *
 * A big finite number rather than `Infinity`, because the timers are in
 * `GameState` and therefore in the SAVE, and `JSON.stringify(Infinity)` is
 * `null`. Thirty-one years of exercise is enough.
 */
const NO_AMBIENT_TRAFFIC = 1e9;

/** Where the exercise starts you, as a fraction of the ship's top speed. */
const ENTRY_THROTTLE = 0.25;

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);


/**
 * The fit-out an exercise may lend you — `window.__cheat` made legitimate and
 * scoped, and applied to the CLONE only.
 *
 * Fit-out, not hull: the player's hull is four constants in player.ts with no
 * roster, and `ai-training/scenario.ts` reads `PLAYER_FLIGHT` as the target
 * every pirate brain was fitted against (docs/COMBAT-SIM.md).
 */
export interface ExerciseFit {
  equipment?: Partial<Equipment>;
  /** rack size for the exercise; the career's own by default */
  missiles?: number;
}

/**
 * What an exercise needs the orchestrator to do.
 *
 * The same shape and the same reason as `StepHost` and `PersistenceHost`: five
 * verbs, not "the Game", so a test implements it in five lines. Everything the
 * exercise does to the world it does to `GameState`; the world REBUILD and the
 * mode machine come in through `Persistence`, which already owns both.
 */
export interface SimHost {
  /** the ship is in the sky now: clear the overlays and hand over the cockpit */
  enterFlight(): void;
  /** something to say out loud */
  message(text: string, seconds: number): void;
  /** the damage flash — a simulated hit should look like a real one */
  flashDamage(): void;
  /** point the cockpit beams at what the shot found, or straight ahead */
  aimBeams(at: THREE.Vector3 | null): void;
  /** the exercise is over and the records are ready to read */
  finished(reports: readonly CombatSimReport[]): void;
}

/** Idle, flying an exercise, or waiting for the frame to unwind so it can restore. */
type Phase = 'idle' | 'fighting' | 'ending';

/** One opponent, and whether it has left the sky. */
interface Opponent {
  /** index into the round's `ExerciseSetup.opponents`, which the report quotes */
  index: number;
  ship: NpcShip;
  down: boolean;
}

export class CombatSim {
  private readonly state: GameState;
  private readonly ordnance: Ordnance;
  private readonly combat: Combat;
  private readonly persistence: Persistence;
  private readonly host: SimHost;
  private readonly log: SimLog;

  /**
   * The exercise's own world step.
   *
   * The SAME class the career flies, over the same state — only the host behind
   * it differs. That is the whole trick: there is no second simulation to keep
   * in step with the first.
   */
  private readonly step: WorldStep;

  /** The second layer, built once — see `stepHost()`. */
  private readonly hostVerbs: StepHost = this.stepHost();

  private readonly scratch: CombatScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
  };
  private readonly tmp = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();

  private phase: Phase = 'idle';
  /** layer 3: the whole world as it was the instant before the exercise began */
  private entry: WorldSnapshot | null = null;
  /** the captured career commander as JSON — what the restore has to give back */
  private entryCommander = '';
  /** the live career commander, for the questions only it may answer */
  private career: CommanderData | null = null;
  private spec: ExerciseSpec | null = null;
  private startMissiles = 0;
  private round = 0;
  private roundElapsed = 0;
  private spawned = 0;
  private playerAlive = true;
  private quitting = false;
  private opponents: Opponent[] = [];
  private recorder: CombatSimRecorder | null = null;
  private records: CombatSimReport[] = [];
  private outcome: SimOutcome = 'quit';
  /** brains this exercise asked for that the game cannot load */
  /** complaints about the requested brain, carried into every round's record */
  private brainWarnings: string[] = [];
  private refused: string[] = [];

  constructor(
    state: GameState, ordnance: Ordnance, combat: Combat,
    persistence: Persistence, host: SimHost, log: SimLog = makeSimLog(),
  ) {
    this.state = state;
    this.ordnance = ordnance;
    this.combat = combat;
    this.persistence = persistence;
    this.host = host;
    this.log = log;
    this.step = new WorldStep(state, ordnance, this.hostVerbs);
  }

  // --- what the Game and the screens may ask -------------------------------

  /** Is an exercise running, in either phase? */
  get active(): boolean { return this.phase !== 'idle'; }
  /** Is it still a fight, rather than a frame unwinding? */
  get fighting(): boolean { return this.phase === 'fighting'; }
  /** What was asked for, or null when nothing is running. */
  get exercise(): ExerciseSpec | null { return this.spec; }
  /**
   * The commander the exercise is flying — the CLONE.
   *
   * Exposed so a test can prove the credit went somewhere: its `kills` climb
   * while the career's do not.
   */
  get commander(): CommanderData | null {
    return this.phase === 'idle' ? null : this.state.commander;
  }
  /**
   * Save writes the last teardown REFUSED, by key.
   *
   * `Station.dock` writes the commander at the end of the restore path, and this
   * is the evidence that the suppression is load-bearing rather than vacuous.
   */
  get refusedWrites(): readonly string[] { return this.refused; }
  /** Records from exercises this session, oldest first. */
  get simLog(): SimLog { return this.log; }
  /**
   * The second layer, as the twelve verbs it is.
   *
   * @internal — `npm test` calls every member of it directly. A defence whose
   * only evidence is that one fight happened to come out safe is not a tested
   * defence, and this is the layer that has to hold when the fight is strange.
   */
  get verbs(): StepHost { return this.hostVerbs; }

  /**
   * Start an exercise. Returns false if one is already running.
   *
   * @param fit the fit-out to lend the commander — applied to the clone only.
   */
  begin(spec: ExerciseSpec, fit: ExerciseFit = {}): boolean {
    if (this.phase !== 'idle') return false;
    const s = this.state;

    // LAYER 3 FIRST, before anything has moved: the snapshot is what the career
    // is put back from, including the rng state it was about to draw on.
    this.career = s.commander;
    this.entry = this.persistence.capture();
    this.entryCommander = JSON.stringify(this.entry.commander);

    this.spec = spec;
    this.round = 0;
    this.records = [];
    this.refused = [];
    this.playerAlive = true;
    this.quitting = false;
    this.outcome = 'quit';
    this.selectBrains(spec.brain);

    // A fresh stream for the fight, so a seed quoted in a report rebuilds it —
    // and the career's stream is restored on exit, so the exercise costs it
    // nothing (docs/COMBAT-SIM.md: "do not shift the career's rng stream").
    seedWorld(spec.seed);

    // LAYER 1. Everything downstream of here — the step, the gun, the ordnance,
    // the law — reads `state.commander`, and from now until teardown that is a
    // clone nobody will ever load.
    s.commander = exerciseCommander(this.career, fit);
    this.startMissiles = s.commander.missiles;

    this.clearSky();
    this.resetFlight();
    this.placePlayer();
    this.phase = 'fighting';
    this.host.enterFlight();

    if (!this.beginRound()) {   // no opposition: nothing to practise against
      this.finish('quit');
      this.settle();
      return false;
    }
    const name = spec.custom ? 'CUSTOM EXERCISE' : scenarioById(spec.scenario).name.toUpperCase();
    this.host.message(`COMBAT SIMULATION — ${name}`, 4);
    return true;
  }

  /**
   * One frame of exercise: the real world step, then the measurement, then the
   * rules. Returns what the step reported, for the Game to say out loud.
   */
  tick(dt: number, elapsed: number, pilot: PilotInput): StepEvent[] {
    if (this.phase !== 'fighting') return [];
    const events = this.step.step(dt, elapsed, pilot);
    this.roundElapsed += dt;

    // Only the step knows a shot was fired at all: it rolls the hit itself and
    // the host hears about the hits alone. Shots are every accuracy denominator
    // in the report.
    for (const e of events) {
      if (e.kind === 'npcFired') this.npcFired(e.npc, e.weapon, e.atPlayer);
    }
    this.reap();
    this.recorder?.tick(dt, () => this.sample());

    // The phase may already have flipped — a death inside the step calls
    // finish() — in which case the rules have nothing left to decide.
    if (this.phase === 'fighting') {
      const where = roundOutcome(this.session());
      if (where === 'roundOver') this.nextRound();
      else if (where === 'over') this.finish(this.verdict());
    }
    return events;
  }

  /**
   * Put the career back, if the exercise has finished.
   *
   * Called by `updateFlight` AFTER the step has returned — see the header on
   * deferred teardown. A no-op at any other time, so it is safe to call every
   * frame.
   */
  settle(): CombatSimReport[] | null {
    return this.phase === 'ending' ? this.teardown() : null;
  }

  /**
   * The pilot ended it.
   *
   * Safe to call straight from input handling, and it tears down THERE rather
   * than waiting for a frame: a screen opened over the top would stop the world
   * stepping, and an exercise that can only end from inside a step it is no
   * longer running would never end at all.
   */
  quit(): CombatSimReport[] | null {
    if (this.phase === 'idle') return null;
    if (this.phase === 'fighting') this.finish('quit');
    return this.settle();
  }

  /**
   * A kill the Game was asked for while an exercise is running.
   *
   * The energy bomb reaches `Game.destroyNpc` from `runCommand`, not through the
   * step, so the Game hands it here instead of crediting itself. It is layer 1
   * that makes it harmless either way — the clone takes the credit — and this is
   * what makes it show up in the RECORD.
   */
  destroyNpc(npc: NpcShip): void {
    this.applySimCombat(this.combat.destroy(this.state.commander, npc), true);
  }

  // --- the alternative StepHost --------------------------------------------

  /**
   * What the exercise's world step may ask of it — the second layer.
   *
   * Every member of `StepHost` is here with a decision against it, and the
   * decisions are the interesting part of this file:
   *
   *   PASS-THROUGH (1) — `wreckNpc`. A ship out of the sky with credit to
   *     nobody is the same act in an exercise as in the galaxy: the Game's
   *     version is `combat.wreck(npc)` and so is this one. It takes no
   *     commander, so there is nothing to leak.
   *
   *   REDIRECTED (5) — `inFlight` (the exercise's own liveness, and the flag
   *     that unwinds the frame), `applyPlayerDamage` (real damage, no HUD flash
   *     of the career's, and death ends the exercise), `destroyNpc` and
   *     `fireLaser` (real kills and real shots, credited to the clone and
   *     counted in the record), and `die` — which the plan called a refusal and
   *     is not: the spec says "death ends the exercise, not the career", so it
   *     has to DO something, and refusing it outright would leave you flying a
   *     dead ship in a fight that could never end.
   *
   *   REFUSED (6) — `raiseLegal`, `dock`, `completeHyperspace`,
   *     `completeRescue`, `openHermitTrade`, `autoSave`. Each one reaches the
   *     career: your legal status and the station's Vipers; the station save,
   *     the fine and a cleared world blob; fuel, days and a system index; your
   *     whole hold as salvage; a market screen that stops the world mid-fight;
   *     and the save itself.
   */
  private stepHost(): StepHost {
    // The table itself is in combat-sim-safety.ts, beside the commander clone
    // and the brain selection — the three layers of "nothing leaves the
    // exercise" read together there rather than a third of the way down a
    // 900-line file.
    return exerciseStepHost({
      fighting: () => this.phase === 'fighting',
      takeHit: (amount, from, source) => this.takeHit(amount, from, source),
      destroyNpc: (npc) => this.destroyNpc(npc),
      wreckNpc: (npc) => this.applySimCombat(this.combat.wreck(npc), false),
      pullTrigger: () => this.pullTrigger(),
      die: (reason) => this.simDeath(reason),
      say: (text, seconds) => this.host.message(text, seconds),
    });
  }


  // --- the round loop ------------------------------------------------------

  /** The facts the rules need. Plain data, and they never reach back. */
  private session(): ExerciseSession {
    return {
      spec: this.spec!,
      round: this.round,
      spawned: this.spawned,
      alive: this.opponents.filter((o) => !o.down).length,
      roundElapsed: this.roundElapsed,
      playerAlive: this.playerAlive,
      quitting: this.quitting,
      ...(this.career ? { threat: this.threatContext(this.career) } : {}),
    };
  }

  /**
   * What the live galaxy knows about you when it decides who to send.
   *
   * The CAREER commander, not the clone: asking a clone with an empty hold and a
   * clean record what it is worth robbing would send Sidewinders at a Dangerous
   * commander in a full Python (combat-sim-scenarios.ts says so).
   */
  private threatContext(career: CommanderData): ThreatContext {
    const s = this.state;
    const sys = s.systems[career.systemIndex];
    return {
      sys,
      danger: s.living.danger(sys.index),
      commander: career,
      notoriety: s.living.notoriety(sys.index),
    };
  }

  /** Build the coming round, or report that there is not one. */
  private beginRound(): boolean {
    const list = nextOpposition(this.session(), random);
    if (!list || list.length === 0) return false;
    const ships = allShips(list);
    if (ships.length === 0) return false;

    this.opponents = this.spawn(ships);
    this.spawned = this.opponents.length;
    this.roundElapsed = 0;
    this.recorder = new CombatSimRecorder(this.setupFor(list, ships));
    this.recorder.event(describeOpposition(list));
    for (const w of this.brainWarnings) this.recorder.warn(w);
    return true;
  }

  /** Put the round in the sky, pointed at the commander. */
  private spawn(ships: readonly SimShip[]): Opponent[] {
    const units: OppositionUnit[] = ships.map((sh) => ({
      role: sh.role,
      count: 1,
      hull: sh.spec,
      tier: sh.tier,
      // The one per-ship lever there is: an organised gang flies the pack
      // policy, everyone else the solo one (invariant 8, via brains.ts).
      brain: sh.organised ? 'pack' : 'solo',
      // Police and bounty hunters attack a clean commander only if provoked
      // (`isHostileToPlayer`), and an authored interdiction says it was.
      hostile: true,
    }));
    const spawned = spawnOpposition(
      this.state.world, units, this.state.player.position,
      { facing: this.state.player.getForward(this.tmp) });
    // A ship spawned this frame has no world matrix yet, and `traceShot`
    // raycasts against `matrixWorld` — without this the commander's first shot
    // is tested against the origin. The renderer does it every frame after
    // this one.
    for (const npc of spawned) npc.object.updateMatrixWorld(true);
    return spawned.map((ship, index) => ({ index, ship, down: false }));
  }

  /** Everything fixed about the round, as the report will quote it. */
  private setupFor(list: readonly Opposition[], ships: readonly SimShip[]): ExerciseSetup {
    const spec = this.spec!;
    const endless = MODES[spec.mode].endless;
    const opponents: OpponentSetup[] = ships.map((sh) => ({
      hull: sh.spec.def?.name ?? sh.role,
      brain: this.flownBrain(sh),
      role: sh.role,
      tier: sh.tier,
    }));
    return {
      seed: roundSeed(spec.seed, this.round),
      scenario: spec.custom
        ? `custom: ${describeOpposition(list)}`
        : scenarioById(spec.scenario).name,
      mode: spec.mode,
      player: this.loadout(),
      opponents,
      ...(endless ? { wave: this.round + 1 } : {}),
    };
  }

  /**
   * Which policy this ship will ACTUALLY fly.
   *
   * The table's answer unless the A/B override was refused, in which case the
   * report must say what flew rather than what was asked for.
   */
  private flownBrain(sh: SimShip): BrainId {
    if (this.spec?.brain && this.brainWarnings.length === 0) return sh.brain;
    return liveBrainFor(sh.role, sh.organised);
  }

  /** What the commander flew, for the record. Description, not simulation. */
  private loadout(): PlayerLoadout {
    const c = this.state.commander;
    return {
      laser: c.equipment.laser,
      rearLaser: c.equipment.rearLaser,
      missiles: c.missiles,
      ecm: c.equipment.ecm,
      energyUnit: c.equipment.energyUnit,
      energyBomb: c.equipment.energyBomb,
    };
  }

  /** A round is over and another follows: close the record and build it. */
  private nextRound(): void {
    this.close('cleared');
    this.round += 1;
    if (MODES[this.spec!.mode].restoreBetweenRounds) {
      // Sparring is for learning a hull, and attrition just ends the lesson
      // early. Waves do NOT get this: attrition is the question they ask.
      Object.assign(this.state.sys, freshSystems());
      this.state.commander.missiles = this.startMissiles;
      this.ordnance.clear();
    }
    if (!this.beginRound()) { this.finish('cleared'); return; }
    const setup = this.recorder!.setup;
    this.host.message(
      setup.wave === undefined ? 'NEXT OPPONENT' : `WAVE ${setup.wave}`, 3);
  }

  /** How this ended, for a round that ran out rather than being ended. */
  private verdict(): SimOutcome {
    if (!this.playerAlive) return 'destroyed';
    if (this.quitting) return 'quit';
    return this.opponents.some((o) => !o.down) ? 'timeout' : 'cleared';
  }

  /**
   * The exercise is over — but NOT torn down.
   *
   * All this does is record the verdict and flip the phase, which makes
   * `inFlight()` false so the frame that is still inside `stepNpcs` unwinds
   * without a rebuilt world underneath it.
   */
  private finish(outcome: SimOutcome): void {
    if (this.phase !== 'fighting') return;
    this.outcome = outcome;
    this.phase = 'ending';
  }

  /** Close the round's record, into the run and into the ring. */
  private close(outcome: SimOutcome): void {
    if (!this.recorder) return;
    const report = this.recorder.report(outcome);
    this.records.push(report);
    // Pushed as each round finishes rather than at the end, so a long sparring
    // session is usable data even if the tab goes away.
    this.log.push(report);
    this.recorder = null;
  }

  /**
   * Put the career back. The only place that undoes any of the three layers,
   * and the order inside it is the whole safety argument.
   */
  private teardown(): CombatSimReport[] {
    this.close(this.outcome);

    // 1. The world, the commander, the brain selection and the rng stream, all
    //    out of the entry
    //    snapshot — with saving SUSPENDED, because the restore path ends at
    //    `Station.dock`, which calls `saveCommander`. In the happy path those
    //    bytes are identical to what is already on disk; if `restore()` were
    //    ever subtly wrong, that write would persist the corruption OVER a good
    //    save. Fail safe first.
    const snap = this.entry!;
    const suspended = withoutSaving(() => this.persistence.restore(snap));
    this.refused = suspended.refused;

    // 3. Verify second. The career that came back has to be the career that
    //    went in, to the byte; if it is not, take the snapshot's copy — it is
    //    the last thing known to be right — and say so in the record and out
    //    loud, because a silent repair is how a corruption ships.
    if (JSON.stringify(this.state.commander) !== this.entryCommander) {
      this.state.commander = JSON.parse(this.entryCommander) as CommanderData;
      const complaint = 'the exercise restored a commander that did not match the '
        + 'entry snapshot — the career was rebuilt from the snapshot and NOTHING '
        + 'was written to storage. This is a bug in persistence.ts, not in the fight.';
      for (const r of this.records) r.warnings.push(complaint);
      this.host.message('SIMULATOR: CAREER RESTORED FROM SNAPSHOT', 6);
    }

    const done = this.records;
    this.records = [];
    this.entry = null;
    this.career = null;
    this.spec = null;
    this.opponents = [];
    this.phase = 'idle';

    const last = done[done.length - 1];
    if (last) {
      this.host.message(
        `SIMULATION ${last.outcome.toUpperCase()} — `
        + `${last.kills.yours} KILL${last.kills.yours === 1 ? '' : 'S'}`
        + ` IN ${last.seconds}s`, 6);
    }
    this.host.finished(done);
    return done;
  }

  // --- what happens in the fight -------------------------------------------

  /**
   * The commander pulls the trigger.
   *
   * The gun is the real one — `firePlayerLaser` over the real state — and the
   * hit is read back out of the target's hull rather than guessed: a DISCHARGE
   * is what the recorder counts, and `firePlayerLaser` is called every frame the
   * trigger is held and refuses internally while the laser is hot.
   */
  private pullTrigger(): void {
    const before = this.opponents.map((o) => o.ship.state.hp);
    const events = firePlayerLaser(this.state, this.combat, this.scratch);
    if (!events.some((e) => e.kind === 'fired')) return;   // hot gun, or no mount

    let landed: { opponent: number; damage: number } | null = null;
    for (let k = 0; k < this.opponents.length; k++) {
      const dealt = before[k] - this.opponents[k].ship.state.hp;
      if (dealt > 0) landed = { opponent: this.opponents[k].index, damage: dealt };
    }
    this.recorder?.playerShot(landed);
    this.applySimCombat(events, true);
  }

  /**
   * The commander takes a hit — the real damage model, on the real systems.
   *
   * `from` is how the hit is attributed: world-step.ts passes the attacker's own
   * `object.position`, which IS the ship's state vector, so identity is exact
   * where a magnitude table was only ever a guess (see `DamageSource`).
   */
  private takeHit(amount: number, from: THREE.Vector3, source: DamageSource): void {
    const hit = this.opponents.find((o) => o.ship.object.position === from);
    this.recorder?.taken(amount, source, hit?.index);
    this.host.flashDamage();
    this.applySimCombat(
      damagePlayer(this.state, this.combat, amount, from, this.scratch), false);
  }

  /** An opponent pulled its trigger. Lasers and missiles are counted apart. */
  private npcFired(npc: NpcShip, weapon: 'laser' | 'missile', atPlayer: boolean): void {
    if (!atPlayer) return;   // a shot at another ship is not a shot at you
    const o = this.opponents.find((x) => x.ship === npc);
    if (o) this.recorder?.npcShot(o.index, weapon);
  }

  /**
   * Combat decides; the exercise pays — and pays into a record instead of into a
   * career. The Game's `applyCombat` beside this one is the whole difference
   * between an exercise and a fight.
   */
  private applySimCombat(events: readonly CombatEvent[], credited: boolean): void {
    for (const e of events) {
      switch (e.kind) {
        case 'message': this.host.message(e.text, e.seconds); break;
        // REFUSED. The clone's legal status is nobody's business, and raising
        // the career's is what launches the Vipers.
        case 'offence': break;
        case 'wrecked':
          if (this.ordnance.targetLock === e.npc) this.ordnance.targetLock = null;
          this.down(e.npc, credited);
          break;
        case 'beam': this.host.aimBeams(e.at); break;
        case 'fired': this.state.session.beamTimer = BEAM_FLASH; break;
        case 'breach': this.breach(); break;
        case 'died': this.simDeath(e.reason); break;
      }
    }
  }

  /**
   * A hull breach really does cost you a tonne or a fitting — and the hold it
   * empties is the CLONE's. That is layer 1 doing exactly the job it is for: the
   * fight stays honest and the career loses nothing.
   */
  private breach(): void {
    const lost = breachLoss(this.state.commander, random);
    if (lost.kind === 'equipment') {
      this.state.session.ccEngaged = false;
      this.recorder?.event(`hull breach: ${lost.name.toLowerCase()} destroyed`);
      this.host.message(`${lost.name} DESTROYED`, 4);
    } else if (lost.kind === 'cargo') {
      this.recorder?.event('hull breach: cargo lost');
    }
  }

  /** The commander's hull failed — in the simulator, so it costs nothing. */
  private simDeath(reason: string): void {
    if (!this.playerAlive) return;
    this.playerAlive = false;
    this.recorder?.event(`you were destroyed: ${reason.toLowerCase()}`);
    this.host.message(`SIMULATION: ${reason}`, 5);
    this.finish('destroyed');
  }

  /** An opponent has left the sky, by whatever means. */
  private down(npc: NpcShip, credited: boolean): void {
    const o = this.opponents.find((x) => x.ship === npc);
    if (!o || o.down) return;
    o.down = true;
    this.recorder?.opponentDown(o.index, credited);
  }

  /**
   * Anything that left without being killed — a trader that jumped out, a ship
   * that despawned. Without this the round's `alive` count never falls and an
   * endless mode never advances.
   */
  private reap(): void {
    const live = this.state.world.npcs;
    for (const o of this.opponents) {
      if (o.down) continue;
      if (o.ship.state.alive && live.includes(o.ship)) continue;
      o.down = true;
      this.recorder?.opponentDown(o.index, false);
    }
  }

  /** The commander and every hostile, at one sample instant. */
  private sample(): FrameSample {
    const { player, sys } = this.state;
    const contacts: ContactSample[] = [];
    for (const o of this.opponents) {
      if (o.down) continue;
      const at = o.ship.object.position;
      contacts.push({
        opponent: o.index,
        dist: at.distanceTo(player.position),
        theirAim: aimAngle(at, o.ship.object.quaternion, player.position),
        yourAim: aimAngle(player.position, player.quaternion, at),
      });
    }
    return {
      speed: player.speed,
      pitch: player.pitchRate,
      roll: player.rollRate,
      foreShield: sys.foreShield,
      aftShield: sys.aftShield,
      energy: sys.energy,
      contacts,
    };
  }

  // --- entering the arena --------------------------------------------------

  /** Nothing in the sky but what the scenario asks for. */
  private clearSky(): void {
    const s = this.state;
    s.world.clearNpcs();
    s.world.cargo.clear();
    s.world.effects.clear();
    this.ordnance.clear();
  }

  /**
   * A fresh flight, and the ambient traffic switched off.
   *
   * `freshSession()` rather than a hand-written list of fields, because a
   * hand-written list is the bug this project has shipped five times: a field
   * added to `SessionState` would be reset where the career starts a leg and
   * inherited here. One home for what a fresh flight is, and it is state.ts.
   */
  private resetFlight(): void {
    const s = this.state;
    Object.assign(s.session, freshSession());
    Object.assign(s.sys, freshSystems());
    s.ecmDetectedTimer = 0;
    s.lastThreat = null;
    // Nothing to be awed by in an arena, and no derelict to announce.
    s.session.genShipSeen = true;
    s.encounterTimers = {
      trader: NO_AMBIENT_TRAFFIC,
      pirateWave: NO_AMBIENT_TRAFFIC,
      thargon: NO_AMBIENT_TRAFFIC,
    };
  }

  /** Out at the arena, with the planet ahead of you and the sun behind. */
  private placePlayer(): void {
    const { player, world } = this.state;
    const centre = arenaCentre(world);
    player.position.copy(centre);
    this.lookAlong(this.tmp.copy(world.planetPos).sub(centre));
    player.speed = player.maxSpeed * ENTRY_THROTTLE;
    player.pitchRate = 0;
    player.rollRate = 0;
  }

  /** Point the nose down `dir`. Matrix4.lookAt is camera convention: −Z leads. */
  private lookAlong(dir: THREE.Vector3): void {
    this.tmpM.lookAt(ZERO, dir, UP);
    this.state.player.quaternion.setFromRotationMatrix(this.tmpM);
  }

  // --- which brain the opposition flies ------------------------------------

  /**
   * Point `state.brains` at the exercise's choice.
   *
   * There is no put-it-back half, and that is the point: `state.brains` is in
   * the entry snapshot, so `teardown`'s restore returns the career's selection
   * along with its world. This used to set four `window.__` globals and undo
   * them by hand, FIRST in teardown, because a career left flying an exercise's
   * A/B brain is a leak nobody would ever notice. Making it state deleted the
   * hazard rather than guarding it.
   */
  private selectBrains(brain: BrainId | undefined): void {
    this.brainWarnings = [];
    if (!brain) return;
    const sel = selectionForBrain(brain);
    if (sel === undefined) {
      // The shipped solo brain IS the default selection; anything else without
      // an entry is a brain brains.ts does not load, so the game cannot fly it.
      if (brain !== 'pirate-attack-g3') {
        this.brainWarnings.push(`this exercise asked for ${brain}, which the game does `
          + 'not load — the opposition flew what the live game flies, and the '
          + 'per-opponent brain names say so.');
      }
      return;
    }
    this.state.brains = { ...sel };
  }
}
