// The orchestrator. Game owns the mode state machine (docked | flight |
// market | chart | local | equip | status | dead), routes input per mode,
// runs the fixed-timestep frame, and resolves every consequence the modules
// around it report: combat.ts says a ship was destroyed and this file pays the
// bounty, escalates legal status and launches the Vipers. Screens
// (ui/screens.ts) and the HUD (hud/hud.ts) are pure renderers fed from here.
//
// The world's own motion is NOT here. `world-step.ts` owns the five phases of
// flight and steps them with no HUD, no keyboard and no renderer; this file
// hands it a FlightDemand and applies the events it returns. Neither is the
// save (`persistence.ts`), the two station transitions (`station.ts`), the two
// computers that fly the ship for you (`autopilot.ts`), nor — since the
// command layer went in — the KEY BINDINGS (`controls.ts`). What that leaves
// behind is orchestration: the frame, the mode machine, the routing, and the
// consequences the modules report.
//
// The shape repeats deliberately. Each of those modules gets ONE host object
// literal — `stepHost()`, `persistenceHost()`, `stationHost()` — listing the
// verbs it may ask of the Game, and returns events the matching `apply*` puts
// on the HUD. Anything that DRAWS from the seeded rng is a host CALL and never
// a deferred event, because the order of draws is the world's determinism.
//
// Input follows the same split, and it is the one that opens a door: the
// player, a replay and an AI now reach the game through the same two verbs.
// `controls.ts` turns an input into `Command`s and `runCommand` below applies
// them, exactly as `flightDemand`/`PlayerShip.update` already did for flying.
//
// `__game` exposes the instance for the autopilot test harness (console.ts)
// (docs/JAMESON-TRIALS.md, train/jameson-autopilot.js) and console poking.
import { publish } from './console.ts';
import type { Shell, Presentation, ShellFactory } from '../engine/shell.ts';
import type { ChartState } from './chart-state.ts';
import { viewDirection, VIEW_QUATS } from './views.ts';
import * as THREE from 'three';

import { generateGalaxy, generateMarket, COMMODITIES, type MarketEntry, type StarSystem } from '../galaxy/galaxy.ts';
import { LivingGalaxy } from '../galaxy/living.ts';
import { generateContractOffers, acceptContract, settleContracts, contractMessage, type ContractEvent } from './contracts.ts';
import { pirateThreat, markOf, type PirateThreat } from './threat.ts';
import { createStarfield, SpaceDust } from '../world/starfield.ts';
import { PlayerShip, PLAYER_FLIGHT, type FlightDemand } from '../player.ts';
import { Input } from '../engine/input.ts';
import { flightDemand } from '../engine/flight-controls.ts';
import { layoutName, toggleLayout, manualFlightKeys, refreshHelpPanel } from '../engine/keymap.ts';
import { Hud } from '../hud/hud.ts';
import { buildHudFrame } from '../hud/hud-binding.ts';
import { TunnelEffect } from '../hud/tunnel.ts';
import { sfx } from '../audio.ts';
import { NpcShip } from './npc.ts';
import { installPolicyKit, DEFEND_BRAIN } from './brains.ts';
import {
  type NpcSpec, type NpcRole,
} from './ship-specs.ts';
import { type Canister } from './cargo.ts';
import { spawnPopulation, launchStationDefence } from './spawning.ts';
import { dumpCargo, offerBribe } from './jettison.ts';
import {
  Combat, BEAM_FLASH, firePlayerLaser, damagePlayer,
  type CombatEvent, type DamageSource,
} from './combat.ts';
import {
  checkJump, resolveJump, refusalMessage, COUNTDOWN,
  checkGalacticJump, resolveGalacticJump, galacticRefusalMessage,
} from './hyperspace.ts';
import { constrictorLurksHere } from './missions.ts';
import { World } from './world.ts';
import {
  WorldStep, massLocked, FIXED_DT,
  type StepEvent, type StepHost,
} from './world-step.ts';
import { random, randomInt, randomDirection, seedWorld } from './rng.ts';
import { clearWorld, loadCommander } from './storage.ts';
import { type WorldSnapshot } from './snapshot.ts';
import { Persistence, type PersistenceHost } from './persistence.ts';
import { Station, type StationHost, type StationEvent } from './station.ts';
import { CombatSim, type ExerciseFit, type SimHost } from './combat-sim.ts';
import { installSimLog, type CombatSimReport } from './combat-sim-report.ts';
import type { ExerciseSpec } from './combat-sim-scenarios.ts';
import { planPopulation } from './population.ts';
import { CombatComputer } from './combat-computer.ts';
import { Autopilot, type AutopilotEvent } from './autopilot.ts';
import type { SoundEvent } from './sounds.ts';
import {
  commandsFor, globalCommands, type Command, type ControlMode,
} from './controls.ts';
import {
  Ordnance, ordnanceMessage, ECM_ENERGY_COST,
  type Missile, type OrdnanceReply,
} from './ordnance.ts';
import { hitCone, LASER_RANGE, AIM_ASSIST } from './gunnery.ts';
import { freshTimers, type EncounterTimers } from './encounters.ts';
import { breachLoss, type ShipSystems } from './systems.ts';
import {
  SavesScreen, NamingScreen, exportCommanderFile, importCommanderFile, startNewCommander,
  type SavesContext,
} from './screens/saves.ts';
import {
  MarketScreen, EquipScreen, buyEquipment, type TradeContext,
} from './screens/trade.ts';
import { StatusScreen, type StatusContext } from './screens/status.ts';
import { DataScreen, type DataContext } from './screens/data.ts';
import { BriefingScreen } from './screens/briefing.ts';
import { ContractsScreen, type ContractsContext } from './screens/contracts.ts';
import { ChartScreen, type ChartContext } from './screens/chart.ts';
import { CombatSimScreen, type CombatSimContext } from './screens/combat-sim.ts';
import { ScreenHost } from '../ui/screen-host.ts';
import { BEAM_Z } from '../engine/render-stack.ts';

import {
  formatCredits,
  type CommanderData, type Contract,
} from './commander.ts';
import {
  LEGAL_NAMES, CLEAN, DEFENCE_RANGE,
} from './law.ts';
import {
  hideScreen, renderDockedMenu, renderNewGameConfirm,
  renderGameOver,
} from '../ui/screens.ts';
import { freshState, type GameState } from './state.ts';
import type { SessionState } from './session.ts';



type Mode = 'docked' | 'flight' | 'market' | 'chart' | 'local' | 'equip' | 'status' | 'data' | 'contracts' | 'saves' | 'naming' | 'briefing' | 'dead';

/**
 * The world advances in slices of exactly this — re-exported from
 * world-step.ts, which is where the world step lives and where a trainer can
 * import it without a browser.
 */
export { FIXED_DT };
/** Longest real interval we will try to simulate, before dropping the backlog. */
const MAX_FRAME_TIME = 0.25;
/** ...and the most steps one frame may run, so a stall cannot spiral. */
const MAX_STEPS_PER_FRAME = 5;

// Sun proximity tuning (ordered: heat starts < scooping < temp maxes < death).
// The sun itself orbits ~320k out (world/system-scene.ts).
/**
 * How far out of the planet you drop from witch-space, in planet radii.
 *
 * Was 12, which measured badly against what it is supposed to feel like: the
 * planet came out 9.6 degrees wide — a sixth of the screen height, a ball
 * hanging in front of you rather than a world you have yet to reach — and the
 * clean torus run to the station took 17.8 seconds.
 *
 * 24 turned out to be too far the other way — a 43 second cruise before
 * anything happens. 16 puts the planet at 7.2 degrees and the clean run at
 * about 28 seconds: still a journey you notice, no longer one you resent.
 * The arrival pirates scatter along the corridor proportionally
 * (populateSystem uses the route length) so the ambush spread scales with it.
 */
const WITCHPOINT_RADII = 16;

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Fields the autonomous playtest agent (test/playtest.js) reads or drives
// are public rather than private; they are otherwise internal.
export class Game {
  /**
   * The machine this is running on — see engine/shell.ts.
   *
   * Seven members, and they are exactly the eleven lines of DOM that used to be
   * scattered through this file. A desktop port writes another one; nothing
   * below this line names a browser API.
   */
  private readonly shell: Shell;
  /** what the game is SEEN through: a camera, the beams, and one draw call */
  private readonly render: Presentation;



  /**
   * Everything the world step may change, in ONE object — see state.ts.
   *
   * The accessors below delegate to it. They exist because ~500 call sites in
   * this file and every console harness say `g.commander` and `g.world`.
   *
   * An earlier version of this comment claimed "a field on `state` is one the
   * snapshot walks". That was FALSE — captureSnapshot below is a hand-written
   * list, and three fields (dockPlan, lastThreat, ecmDetectedTimer) were in
   * `state` and silently unsaved. It is still hand-written, because `world`
   * and `player` need bespoke handling; what changed is that `npm test` now
   * fails if a GameState field is missing from either side of it.
   */
  readonly state: GameState = freshState(loadCommander());

  get systems(): StarSystem[] { return this.state.systems; }
  set systems(v: StarSystem[]) { this.state.systems = v; }
  get commander(): CommanderData { return this.state.commander; }
  set commander(v: CommanderData) { this.state.commander = v; }
  get living(): LivingGalaxy { return this.state.living; }
  set living(v: LivingGalaxy) { this.state.living = v; }
  get world(): World { return this.state.world; }

  /**
   * The ships in the sky, and the scene they are in. Owned by `world`; kept
   * here because the console harnesses (test/playtest.js, gang-trial.js,
   * combat-recorder.js) and the docs reach for `g.npcs` and `g.scene` by name.
   */
  get npcs(): NpcShip[] { return this.world.npcs; }
  get scene(): THREE.Scene { return this.world.scene; }

  get player(): PlayerShip { return this.state.player; }
  readonly input = new Input();
  private readonly hud = new Hud();
  private readonly tunnel = new TunnelEffect();

  /**
   * Where the SHIP is. Flight, docked, or dead — the states that are not
   * screens. Overlays live on the screen stack; `mode` is the two combined.
   */
  get session(): SessionState { return this.state.session; }

  get hyperCountdown(): number { return this.session.hyperCountdown; }
  set hyperCountdown(v: number) { this.session.hyperCountdown = v; }
  get torusEngaged(): boolean { return this.session.torusEngaged; }
  set torusEngaged(v: boolean) { this.session.torusEngaged = v; }
  get witchspace(): boolean { return this.session.witchspace; }
  set witchspace(v: boolean) { this.session.witchspace = v; }
  get npcTargetTimer(): number { return this.session.npcTargetTimer; }
  set npcTargetTimer(v: number) { this.session.npcTargetTimer = v; }
  get autoSaveTimer(): number { return this.session.autoSaveTimer; }
  set autoSaveTimer(v: number) { this.session.autoSaveTimer = v; }
  get energyLowTimer(): number { return this.session.energyLowTimer; }
  set energyLowTimer(v: number) { this.session.energyLowTimer = v; }
  get policeScanned(): boolean { return this.session.policeScanned; }
  set policeScanned(v: boolean) { this.session.policeScanned = v; }
  get defenceLaunched(): boolean { return this.session.defenceLaunched; }
  set defenceLaunched(v: boolean) { this.session.defenceLaunched = v; }
  get hermitTrading(): boolean { return this.session.hermitTrading; }
  set hermitTrading(v: boolean) { this.session.hermitTrading = v; }
  get hermitCooldown(): boolean { return this.session.hermitCooldown; }
  set hermitCooldown(v: boolean) { this.session.hermitCooldown = v; }
  get jettisonedValue(): number { return this.session.jettisonedValue; }
  set jettisonedValue(v: number) { this.session.jettisonedValue = v; }
  get arrivalCargoValue(): number { return this.session.arrivalCargoValue; }
  set arrivalCargoValue(v: number) { this.session.arrivalCargoValue = v; }
  get genShipSeen(): boolean { return this.session.genShipSeen; }
  set genShipSeen(v: boolean) { this.session.genShipSeen = v; }
  get trumbleTimer(): number { return this.session.trumbleTimer; }
  set trumbleTimer(v: number) { this.session.trumbleTimer = v; }
  get beaconTimer(): number { return this.session.beaconTimer; }
  set beaconTimer(v: number) { this.session.beaconTimer = v; }
  get strandedHintTimer(): number { return this.session.strandedHintTimer; }
  set strandedHintTimer(v: number) { this.session.strandedHintTimer = v; }
  private get view(): number { return this.session.view; }
  private set view(v: number) { this.session.view = v; }
  get paused(): boolean { return this.session.paused; }
  set paused(v: boolean) { this.session.paused = v; }
  get ccEngaged(): boolean { return this.session.ccEngaged; }
  set ccEngaged(v: boolean) { this.session.ccEngaged = v; }
  get beamTimer(): number { return this.session.beamTimer; }
  set beamTimer(v: number) { this.session.beamTimer = v; }
  get dcEngaged(): boolean { return this.session.dcEngaged; }
  set dcEngaged(v: boolean) { this.session.dcEngaged = v; }

  private baseMode: 'docked' | 'flight' | 'dead' = 'docked';

  /**
   * The screen stack. Single source of truth for which overlay is open, and
   * for what Escape returns to — it replaced both `mode`'s overlay values and
   * the one-deep `dataReturn` hack that existed for the system-data screen.
   */
  readonly screens = new ScreenHost(() => this.showBaseScreen());

  /**
   * What is on screen: the top overlay, or the base state when there is none.
   * DERIVED — assign `baseMode` or push/pop the stack instead.
   */
  get mode(): Mode {
    return (this.screens.topId ?? this.baseMode) as Mode;
  }

  get chart(): ChartState { return this.state.chart; }
  get market(): MarketEntry[] { return this.state.market; }
  set market(v: MarketEntry[]) { this.state.market = v; }


  /** countdowns for arrivals, pirate waves and Thargon drops — see encounters.ts */
  private get encounterTimers(): EncounterTimers { return this.state.encounterTimers; }
  private set encounterTimers(v: EncounterTimers) { this.state.encounterTimers = v; }
  /** trading with a rock hermit rather than a station */
  private get hermitMarket(): MarketEntry[] { return this.state.hermitMarket; }
  private set hermitMarket(v: MarketEntry[]) { this.state.hermitMarket = v; }
  /** waiting on the player to confirm erasing their commander */
  private pendingNewGame = false;
  private readonly market_ = new MarketScreen(() => this.tradeContext());
  private readonly contracts_ = new ContractsScreen(() => ({
    commander: this.commander,
    system: this.system,
    systems: this.systems,
    offers: this.contractOffers,
    accept: (index) => { this.contracts_.selected = index; this.acceptContract(); },
  } satisfies ContractsContext));

  /** Which system the data screen is reading about. */
  private dataSubject: StarSystem | null = null;

  private chartContext(): ChartContext {
    return {
      commander: this.commander,
      systems: this.systems,
      system: this.system,
      chart: this.chart,
      viewData: (sys) => { this.dataSubject = sys; },
    };
  }
  /** the reception the current system laid on — surfaced for the HUD/tests */
  get lastThreat(): PirateThreat | null { return this.state.lastThreat; }
  set lastThreat(v: PirateThreat | null) { this.state.lastThreat = v; }
  get contractOffers(): Contract[] { return this.state.contractOffers; }
  set contractOffers(v: Contract[]) { this.state.contractOffers = v; }
  /**
   * Selected contract row. A property because it lives on ContractsScreen now,
   * and test/playtest.js assigns it before calling acceptContract().
   */
  /** @internal — driven by test/playtest.js */
  get contractSelected(): number { return this.contracts_.selected; }
  set contractSelected(v: number) { this.contracts_.selected = v; }
  /** console 'E' dwell */
  private get ecmDetectedTimer(): number { return this.state.ecmDetectedTimer; }
  private set ecmDetectedTimer(v: number) { this.state.ecmDetectedTimer = v; }
  // combat computer: the jameson-defend policy flying the player's ship
  private readonly combatComputer = new CombatComputer();
  /**
   * The two computers that fly the ship for you — see autopilot.ts.
   *
   * Kept beside `combatComputer` rather than owning it, because the SNAPSHOT
   * needs the policy's mid-thought state (persistence.ts) and the autopilot is
   * the thing that engages it.
   */
  private readonly autopilot = new Autopilot(this.state, this.combatComputer);
  /** missiles, E.C.M. and the energy bomb — see ordnance.ts */
  private readonly ordnance = new Ordnance(this.world);
  /**
   * Resolving hits: shots, wrecks, bounties — see combat.ts. */
  private readonly combat = new Combat(this.world);

  /**
   * The world advancing by one slice — see world-step.ts.
   *
   * It owns the five phases of flight and knows nothing about a HUD, a
   * keyboard or a renderer: it takes a demand, moves everything, and reports
   * what it did. `stepHost()` below is the whole of what it may ask of us.
   */
  private readonly worldStep = new WorldStep(this.state, this.ordnance, this.stepHost());

  /**
   * Saving the world and putting it back — see persistence.ts.
   *
   * The snapshot's shape lives in snapshot.ts and its home in storage.ts; this
   * is the part that knows how a running world becomes one, which is why it
   * needs the ordnance and the autopilot as well as the state.
   */
  private readonly persistence = new Persistence(
    this.state, this.ordnance, this.combatComputer, this.persistenceHost());

  /**
   * Docking, launching, and the menu between them — see station.ts.
   *
   * The two transitions that switch `baseMode`, and the only two places the
   * station's own rules (the fine, the market roll, the bulletin board) are
   * applied.
   */
  private readonly station = new Station(this.state, this.ordnance, this.stationHost());

  /**
   * The combat training simulator — see combat-sim.ts.
   *
   * Owned the way `station`, `ordnance` and `persistence` are, and deliberately
   * NOT a field on `GameState`: a state field is obliged to appear in the save
   * (a test enforces it), and an exercise must not survive a reload — close the
   * tab mid-exercise and you wake up at the station with the career intact.
   *
   * An exercise is not a screen. It is ordinary flight with a different
   * `StepHost` behind it, and `updateFlight` picks which step to run.
   */
  private readonly combatSim = new CombatSim(
    this.state, this.ordnance, this.combat, this.persistence, this.simHost(),
    installSimLog());

  /**
   * What an exercise may ask of the Game. The rebuild and the mode machine are
   * not here: `Persistence` already owns both, and the exercise holds it.
   */
  private simHost(): SimHost {
    return {
      enterFlight: () => {
        this.screens.exit();
        this.baseMode = 'flight';
        hideScreen();
      },
      message: (text, seconds) => this.hud.showMessage(text, seconds),
      flashDamage: () => this.hud.flashDamage(),
      aimBeams: (at) => this.aimBeams(at),
      // The exercise has torn down and the career is back: hold the records and
      // put the report on screen. Ordering is not incidental — teardown restores
      // the mode first (`enterMode` clears the stack), so pushing the screen
      // afterwards leaves it sitting on the station menu it was launched from.
      finished: (reports) => {
        this.simReports = reports;
        if (reports.length === 0) return;
        this.combatSim_.showReport();
        this.screens.open('combat-sim');
      },
    };
  }

  /** The records the last exercise produced — what the report panel reads. */
  private simReports: readonly CombatSimReport[] = [];

  /** The picker and the report, behind one screen id. */
  private readonly combatSim_ = new CombatSimScreen(() => ({
    commander: this.commander,
    reports: this.simReports,
    begin: (spec, fit) => this.startExercise(spec, fit),
    message: (text, seconds) => this.hud.showMessage(text, seconds),
  } satisfies CombatSimContext));

  /**
   * Start a training exercise.
   *
   * @internal — the picker calls it through `CombatSimContext.begin`, and the
   * console harnesses call it directly.
   */
  startExercise(spec: ExerciseSpec, fit?: ExerciseFit): boolean {
    if (this.baseMode === 'dead') return false;
    return this.combatSim.begin(spec, fit);
  }

  /**
   * End one early, from anywhere. Returns the records it produced.
   *
   * Reached from the `simulator` binding table (Escape or Q) and from the
   * console harnesses.
   */
  endExercise(): readonly CombatSimReport[] | null { return this.combatSim.quit(); }

  /** Is an exercise running? The career's own rules are suspended while it is. */
  get exercising(): boolean { return this.combatSim.active; }

  /**
   * What the world step may ask of the Game — the consequences that reach
   * outside the sky, and nothing else it can get at.
   *
   * An object literal rather than `implements StepHost` on purpose: the
   * methods behind it stay private, so this list IS the surface, and adding to
   * it is a decision rather than an accident.
   */
  private stepHost(): StepHost {
    return {
      inFlight: () => this.mode === 'flight',
      applyPlayerDamage: (amount, from, source) =>
        this.applyPlayerDamage(amount, from, source),
      destroyNpc: (npc) => this.destroyNpc(npc),
      wreckNpc: (npc) => this.wreckNpc(npc),
      fireLaser: () => this.fireLaser(),
      raiseLegal: (level) => this.raiseLegal(level),
      die: (reason) => this.die(reason),
      dock: () => this.enterDocked(),
      completeHyperspace: () => this.completeHyperspace(),
      completeRescue: () => this.completeRescue(),
      openHermitTrade: () => this.openHermitTrade(),
      autoSave: () => this.autoSave(),
    };
  }

  /** Missiles in flight. Owned by `ordnance`; exposed for the HUD and saves. */
  get missiles(): Missile[] { return this.ordnance.missiles; }
  /** Cargo adrift. Owned by `cargo`; exposed for the HUD and the snapshot. */
  get canisters(): Canister[] { return this.world.cargo.items; }
  get targetLock(): NpcShip | null { return this.ordnance.targetLock; }
  set targetLock(v: NpcShip | null) { this.ordnance.targetLock = v; }
  get missileArmed(): boolean { return this.ordnance.armed; }
  set missileArmed(v: boolean) { this.ordnance.armed = v; }

  /** Ordnance reports what it did; saying it is ours. */
  private say(reply: OrdnanceReply | null): void {
    if (!reply) return;
    const m = ordnanceMessage(reply);
    this.hud.showMessage(m.text, m.seconds);
  }

  private armMissile(): void { this.say(this.ordnance.arm(this.commander)); }

  private launchMissile(): void {
    this.say(this.ordnance.launch(this.commander, this.player.position));
  }

  private triggerEcm(): void {
    const reply = this.ordnance.triggerEcm(this.commander, this.energy);
    if (reply === 'ecmFired') this.energy -= ECM_ENERGY_COST;
    this.say(reply);
  }

  private detonateEnergyBomb(): void {
    const { reply, caught } = this.ordnance.detonateEnergyBomb(
      this.commander, this.player.position);
    this.say(reply);
    if (reply !== 'bombFired') return;   // no bomb fitted: no flash either
    this.shell.flashBomb();
    for (const npc of caught) {
      npc.takeDamage(99, this.player.position, true);
      this.destroyNpc(npc);
    }
  }

  /**
   * Energy, shields, laser heat and cabin temperature. The model lives in
   * systems.ts; the accessors below keep `g.energy` working for the console
   * harnesses (test/gang-trial.js, test/combat-recorder.js) that read and
   * write them by name.
   */
  get sys(): ShipSystems { return this.state.sys; }

  get foreShield(): number { return this.sys.foreShield; }
  set foreShield(v: number) { this.sys.foreShield = v; }
  get aftShield(): number { return this.sys.aftShield; }
  set aftShield(v: number) { this.sys.aftShield = v; }
  get energy(): number { return this.sys.energy; }
  set energy(v: number) { this.sys.energy = v; }
  get laserTemp(): number { return this.sys.laserTemp; }
  set laserTemp(v: number) { this.sys.laserTemp = v; }
  get laserCooldown(): number { return this.sys.laserCooldown; }
  set laserCooldown(v: number) { this.sys.laserCooldown = v; }
  get cabinTemp(): number { return this.sys.cabinTemp; }
  set cabinTemp(v: number) { this.sys.cabinTemp = v; }


  private readonly dust = new SpaceDust();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** the shot's ray and scratch vectors, reused every trigger pull */
  private readonly combatScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
  };
  /** scratch for the per-frame dashboard read, so it allocates nothing */
  private readonly hudScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    c: new THREE.Vector3(), q: new THREE.Quaternion(),
  };
  private readonly tmpM = new THREE.Matrix4();

  constructor(makeShell: ShellFactory) {
    // The shell is built HERE, not passed in ready-made, because it needs the
    // scene and the scene belongs to the world this object just constructed.
    this.shell = makeShell(this.world.scene);
    this.render = this.shell.view;
    this.shell.onResize(() => this.resize());
    this.resize();

    this.living.load(this.commander.galaxyState);
    // catch the galaxy up if this save has been away a while
    if (this.living.day < this.commander.day) {
      this.living.advance(
        Math.min(60, this.commander.day - this.living.day),
        COMMODITIES.map((c) => c.gradient));
    }

    this.world.scene.add(createStarfield());
    this.world.scene.add(this.dust.points, this.dust.streaks);
    this.world.scene.add(this.render.camera);


    this.buildWorld();
    // Resume mid-flight if the last session ended there; otherwise the
    // station, as Elite always did.
    if (!this.resumeSavedWorld()) this.enterDocked(true);
    refreshHelpPanel();
    this.hud.showMessage(
      `PRESS ? FOR CONTROLS — ${layoutName().toUpperCase()} LAYOUT (B TO SWITCH)`, 8);

    // all screens accept mouse input; the shell owns the listener and hands
    // back the element that carries data-key/data-row
    this.shell.onScreenClick((el, e) => this.handleScreenClick(el, e));

    // test-harness handle: the Jameson autopilot (train/jameson-autopilot.js,
    // docs/JAMESON-TRIALS.md) drives the whole game through this
    publish('__game', this);
    installPolicyKit();

    // Screens register themselves with the host and are addressed by id from
    // then on. Adding one is a new file plus a line here and a line in
    // ScreenId — deliberately the whole shared surface.
    for (const screen of [
      this.market_,
      new EquipScreen(() => this.tradeContext()),
      new SavesScreen(() => this.savesContext()),
      new NamingScreen(() => this.savesContext()),
      new StatusScreen(() => ({
        commander: this.commander,
        systems: this.systems,
        targetIndex: this.chart.targetIndex,
      } satisfies StatusContext)),
      new DataScreen(() => ({
        subject: this.dataSubject ?? this.system,
        here: this.system,
        galaxy: this.commander.galaxy,
        headline: (index) => this.living.headline(index),
      } satisfies DataContext)),
      new BriefingScreen(),
      this.contracts_,
      new ChartScreen('chart', () => this.chartContext()),
      new ChartScreen('local', () => this.chartContext()),
      this.combatSim_,
    ]) this.screens.register(screen);

    // Fixed timestep, decoupled from the frame rate.
    //
    // The world only ever advances in FIXED_DT slices, whatever the display is
    // doing. A variable dt means a 144Hz machine and a 30Hz one get different
    // physics from the same inputs — which is a bug on its own, and fatal to
    // the thing this is for: a run that cannot be reproduced cannot be
    // replayed, tested against, or trained on.
    //
    // The clamp stops the spiral of death: after a long stall (a tab in the
    // background, a hyperspace hitch) we drop the backlog rather than trying
    // to catch up, because catching up costs more time than we lost.
    let last = performance.now();
    let accumulator = 0;
    let simTime = 0;
    this.shell.runLoop((now: number): void => {
      accumulator += Math.min((now - last) / 1000, MAX_FRAME_TIME);
      last = now;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        simTime += FIXED_DT;
        this.step(FIXED_DT, simTime);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0; // gave up catching up
      this.draw(FIXED_DT);
    });
  }

  private resize(): void {
    const { width: w, height: h } = this.shell.size();
    const pxPerRad = this.render.resize(w, h);
    this.hud.resizeOverlay(w, h);
    // Draw the sight to the assist envelope, so the circle means something: a
    // target inside it is a target the shot will reach for. Derived from the
    // real projection rather than picked by eye, so it stays honest if the fov
    // or the assist angle ever change.
    this.shell.setSightRadius(Math.tan(AIM_ASSIST) * pxPerRad);
  }

  private get system(): StarSystem {
    return this.systems[this.commander.systemIndex];
  }

  /** The only slice of the Game the market and outfitters are allowed to see. */
  private tradeContext(): TradeContext {
    return {
      commander: this.commander,
      system: this.system,
      market: this.market,
      atHermit: this.hermitTrading,
      cheat: this.state.cheat,
      message: (text, seconds) => this.hud.showMessage(text, seconds),
      addNotoriety: (amount) => this.living.addNotoriety(this.commander.systemIndex, amount),
      leaveHermit: () => {
        this.hermitTrading = false;
        this.hermitCooldown = true;
        this.hud.showMessage('LEAVING THE HERMIT', 3);
      },
    };
  }

  /**
   * Selected market row. A property rather than a field because it now lives
   * on TradeScreen, and test/playtest.js assigns it before calling buyCargo.
   */
  /** @internal — driven by test/playtest.js */
  get marketSelected(): number { return this.market_.selected; }
  set marketSelected(v: number) { this.market_.selected = v; }

  /** @internal — driven by test/playtest.js */
  buyCargo(want: number): void { this.market_.buy(want); }

  /** @internal — driven by test/playtest.js */
  sellCargo(want: number): void { this.market_.sell(want); }

  /** @internal — driven by test/playtest.js */
  buyEquipment(id: string): void { buyEquipment(id, this.tradeContext()); }

  // --- world lifecycle -----------------------------------------------------

  /** @internal — driven by test/playtest.js */
  buildWorld(): void {
    this.world.build(this.system);
    this.hud.setSystem(this.system);
  }

  /**
   * Witch-space: mis-jump limbo. We reuse the system scene but banish the
   * planet, station and sun beyond reach — just stars, and Thargoids.
   */
  /** @internal — driven by test/playtest.js */
  enterWitchspace(): void {
    this.witchspace = true;
    this.buildWorld();
    this.world.banishScenery();
    this.player.position.set(0, 0, 0);
    this.player.speed = 200;
    const n = 2 + (random() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.world.spawn('thargoid',
        randomDirection(new THREE.Vector3()).multiplyScalar(3500 + random() * 2500), i);
    }
    this.encounterTimers.thargon = 4;
    sfx.hyperspace();
    this.tunnel.start(1.1);
    this.hud.showMessage('WITCH-SPACE — THARGOID AMBUSH', 6);
  }

  /** @internal — driven by test/playtest.js */
  spawnNpc(role: NpcRole, position: THREE.Vector3, seed: number, spec?: NpcSpec): NpcShip {
    return this.world.spawn(role, position, seed, spec);
  }





  /**
   * Station space is policed: launching only meets legitimate traffic.
   * Arriving from hyperspace drops pirates along the corridor to the station.
   */
  /**
   * Station space is policed: launching only meets legitimate traffic.
   * Arriving from hyperspace drops pirates along the corridor to the station.
   *
   * The rules are in population.ts, the placement in spawning.ts. This is the
   * wiring plus the consequences — the arrival bookkeeping that jettisonCargo
   * later reads, and the two announcements.
   */
  private populateSystem(situation: 'launch' | 'arrival'): void {
    const sys = this.system;
    const plan = planPopulation(
      sys, situation,
      this.living.imminentArrivals(sys.index).length,
      // Pirates are businesses: lawlessness and the living galaxy set how many
      // are out here, but what you're visibly worth sets who they are and
      // whether they bothered to organise.
      situation === 'arrival'
        ? pirateThreat(sys, this.living.danger(sys.index),
          markOf(this.commander, this.living.notoriety(sys.index)))
        : null,
    );

    const constrictorHere = situation === 'arrival' && constrictorLurksHere(this.commander);

    const built = spawnPopulation(
      this.world, plan, sys, this.player.position, constrictorHere);

    if (plan.threat) {
      this.lastThreat = plan.threat;
      this.jettisonedValue = 0;
      this.arrivalCargoValue = markOf(this.commander).cargoValue;
    }
    if (built.generationShip) this.genShipSeen = false;
    if (built.missionTarget) {
      this.hud.showMessage('SCANNER: UNREGISTERED PROTOTYPE DETECTED', 5);
    }
  }

  // --- mode transitions ----------------------------------------------------

  /**
   * What the station transitions may ask of the Game.
   *
   * Same shape and same reason as `stepHost()` and `persistenceHost()`.
   * `populateSystem` is a call rather than a returned event because it DRAWS
   * from the seeded stream (see station.ts); `settleContracts` is one because
   * paying a contract beeps, and contracts.ts has never heard of an
   * the audio context.
   */
  private stationHost(): StationHost {
    return {
      baseMode: () => this.baseMode,
      setBaseMode: (mode) => { this.baseMode = mode; },
      lookAlong: (dir) => this.lookAlong(dir),
      tunnel: (way) => this.tunnel.start(1.4, way),
      releaseMouseFlight: () => this.input.releaseMouseFlight(),
      populateSystem: (situation) => this.populateSystem(situation),
      settleContracts: () => this.settleContracts(),
      resetContractSelection: () => { this.contractSelected = 0; },
    };
  }

  /** The station decides; the Game says it. Same shape as applyStep. */
  private applyStation(events: readonly StationEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'message': this.hud.showMessage(e.text, e.seconds); break;
      }
    }
  }

  /** @internal — driven by test/playtest.js */
  enterDocked(booting = false): void {
    this.applyStation(this.station.dock(booting));
  }

  /** Download the commander as a JSON file (portable saves, bug reports). */
  /** @internal — driven by test/playtest.js */
  newCommanderGame(): void {
    startNewCommander();
  }

  openSaves(): void {
    this.screens.open('saves');
  }

  /** The only slice of the Game the saves screens are allowed to see. */
  private exportSave(): void {
    exportCommanderFile(this.commander, this.system.name,
      (text, seconds) => this.hud.showMessage(text, seconds));
  }

  private importSave(): void {
    importCommanderFile(() => {
      this.hud.showMessage('IMPORT FAILED — NOT A COMMANDER FILE', 4);
      sfx.beep(220);
    });
  }

  /** The only slice of the Game the saves screens are allowed to see. */
  private savesContext(): SavesContext {
    return {
      commander: this.commander,
      systems: this.systems,
      message: (text, seconds) => this.hud.showMessage(text, seconds),
    };
  }

  /**
   * What saving and restoring a world may ask of the Game.
   *
   * The same shape and the same reason as `stepHost()`: an object literal, so
   * the methods behind it stay private and this list IS the surface. Four of
   * the six are the mode machine and the scene rebuild, which are the two
   * things a snapshot cannot put back by assignment.
   */
  private persistenceHost(): PersistenceHost {
    return {
      baseMode: () => this.baseMode,
      enterMode: (mode) => {
        this.baseMode = mode;
        this.screens.exit();
        if (mode === 'docked') this.enterDocked(true);
        else hideScreen();
      },
      buildWorld: () => this.buildWorld(),
      enterWitchspace: () => this.enterWitchspace(),
      isDead: () => this.mode === 'dead',
      message: (text, seconds) => this.hud.showMessage(text, seconds),
    };
  }

  /** @internal — driven by test/playtest.js and the console harnesses */
  captureSnapshot(): WorldSnapshot { return this.persistence.capture(); }

  /** @internal — driven by test/playtest.js and the console harnesses */
  restoreSnapshot(snap: WorldSnapshot): void { this.persistence.restore(snap); }

  private autoSave(): void { this.persistence.autoSave(); }

  private resumeSavedWorld(): boolean { return this.persistence.resume(); }


  /** @internal — driven by test/playtest.js */
  launch(): void {
    this.applyStation(this.station.launch());
  }

  /** @internal — driven by test/playtest.js */
  lookAlong(dir: THREE.Vector3): void {
    // Matrix4.lookAt uses camera convention: -Z (our nose) points at target.
    this.tmpM.lookAt(ZERO, dir, UP);
    this.player.quaternion.setFromRotationMatrix(this.tmpM);
  }

  private die(reason: string): void {
    if (this.mode === 'dead' || this.mode === 'docked') return;
    // A death in the simulator ends the SIMULATION. The exercise's own StepHost
    // already redirects this, so no path reaches here with one running — but the
    // next line deletes the player's saved world, and that is data loss rather
    // than a leak, so it is worth being unreachable twice over.
    if (this.combatSim.active) { this.combatSim.quit(); return; }
    // The mid-flight world must not outlive the ship. Without this a reload
    // resumed the snapshot taken seconds BEFORE the death, cargo and all —
    // death was optional if you refreshed.
    clearWorld();
    sfx.explosion();
    this.world.effects.explosion(this.player.position.clone(), 0xff8866);
    if (this.commander.equipment.escapePod) {
      // the pod gets you to the local station; ship and cargo are gone
      this.commander.equipment.escapePod = false;
      this.commander.cargo = this.commander.cargo.map(() => 0);
      this.enterDocked();
      this.hud.showMessage('ESCAPE POD DEPLOYED — CARGO LOST', 6);
      return;
    }
    this.baseMode = 'dead';
    this.hud.showMessage(reason, 6);
    renderGameOver(this.commander);
  }

  /** @internal — driven by test/playtest.js */
  respawn(): void {
    this.commander = loadCommander();
    // The loaded commander may name a DIFFERENT galaxy than the one we died
    // in — jump to galaxy 2, die before docking, and the last save is still
    // galaxy 1. Without these, `systems` stayed galaxy 2's and every lookup
    // through `get system()` read the wrong star. restoreSnapshot always did
    // this; respawn never did.
    this.systems = generateGalaxy(this.commander.galaxy);
    this.living = new LivingGalaxy(this.systems);
    this.living.load(this.commander.galaxyState);
    this.combatComputer.reset();
    this.chart.targetIndex = null;
    this.witchspace = false;
    this.buildWorld();
    this.enterDocked(true);
  }

  // --- contracts (station bulletin board) ----------------------------------

  /**
   * Work on offer here today. Deliberately generous compared to the
   * original, which gated every mission behind a high combat rating —
   * a new commander should always have somewhere to be.
   */
  /** @internal — driven by test/playtest.js */
  generateContractOffers(): Contract[] {
    return generateContractOffers(this.system, this.systems, this.commander.day);
  }

  /**
   * The bulletin board decides; the Game says it and beeps it.
   *
   * Messages come back as StationEvents rather than going straight to the HUD
   * because docking says several things in a row and the last one is the one
   * the player reads — see station.ts.
   */
  private applyContracts(events: readonly ContractEvent[]): StationEvent[] {
    return events.map((e) => {
      const m = contractMessage(e, this.systems);
      if (m.beep) sfx.beep(m.beep.hz, m.beep.seconds);
      return { kind: 'message', text: m.text, seconds: m.seconds } satisfies StationEvent;
    });
  }

  /** @internal — driven by test/playtest.js */
  acceptContract(): void {
    const events = acceptContract(this.commander, this.contractOffers, this.contractSelected);
    if (events.some((e) => e.kind === 'accepted')) {
      this.contractSelected = Math.max(0, this.contractSelected - 1);
    }
    this.applyStation(this.applyContracts(events));
  }

  /** Pay out anything delivered here; drop anything overdue. */
  private settleContracts(): StationEvent[] {
    return this.applyContracts(settleContracts(this.commander));
  }


  /** @internal — driven by test/playtest.js */
  startHyperspace(): void {
    // The simulator is a room at the station, not a place you can leave: the
    // exercise's StepHost refuses `completeHyperspace` anyway, so without this
    // the countdown would run and then silently do nothing.
    if (this.combatSim.active) {
      this.hud.showMessage('HYPERSPACE IS OFFLINE IN THE SIMULATOR', 3);
      sfx.beep(220);
      return;
    }
    const check = checkJump(this.commander, this.systems, this.chart.targetIndex,
      this.witchspace, this.hyperCountdown >= 0);
    if (!check.ok) {
      if (check.reason === 'alreadyJumping') return;
      this.hud.showMessage(refusalMessage(check.reason, this.witchspace), 4);
      sfx.beep(220);
      return;
    }
    this.hyperCountdown = COUNTDOWN;
    this.hud.showMessage(`HYPERSPACE IN ${COUNTDOWN}`, 1.2);
    sfx.beep(700, 0.07);
  }

  private completeHyperspace(): void {
    const target = this.chart.targetIndex!;
    const jump = resolveJump(this.commander, this.systems, target, this.witchspace);
    if (jump.misjump) {
      this.enterWitchspace(); // target retained for the escape jump
      return;
    }
    this.living.advance(jump.days, COMMODITIES.map((c) => c.gradient));
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(`ARRIVED: ${this.system.name.toUpperCase()}`, 4);
  }

  /** @internal — driven by test/playtest.js */
  arriveInSystem(): void {
    // Seed the world from WHERE and WHEN you are, so a given save arriving in
    // a given system on a given day meets the same reception twice. Without
    // this the fixed timestep buys repeatable physics and nothing else.
    seedWorld(this.commander.galaxy * 0x9e3779b1
      ^ (this.commander.systemIndex << 8) ^ this.commander.day);
    this.witchspace = false; // any arrival leaves witch-space (incl. galactic jump)
    this.buildWorld();
    // Arrive at the witchpoint, well out — the classic long torus cruise in.
    // Bearing is biased to the station's side of the planet (~30° cone) so
    // the planet never blocks the run.
    const stationDir = this.world.station.position.clone().normalize();
    const dir = stationDir
      .add(randomDirection(new THREE.Vector3()).multiplyScalar(0.5))
      .normalize();
    this.player.position.copy(dir.multiplyScalar(this.world.planetRadius * WITCHPOINT_RADII));
    this.lookAlong(this.tmp.copy(this.player.position).negate());
    this.player.speed = 250;
    this.policeScanned = false;
    this.encounterTimers = freshTimers();
    this.populateSystem('arrival');
    sfx.hyperspace();
    this.tunnel.start(1.1);
  }

  // --- combat --------------------------------------------------------------

  /** Direction the current view faces, in world space. The maths is the step's. */
  private viewDir(out: THREE.Vector3): THREE.Vector3 {
    return viewDirection(this.player.quaternion, this.view, out);
  }

  /**
   * Anything close enough to hold the torus drive down.
   *
   * @internal — driven by test/playtest.js and train/jameson-autopilot.js
   */
  massLocked(): boolean { return massLocked(this.state); }

  /** @internal — driven by test/playtest.js */
  raiseLegal(level: number): void {
    if (level <= CLEAN) return;   // shooting a pirate is nobody's business
    if (this.commander.legalStatus < level) {
      this.commander.legalStatus = level;
      this.hud.showMessage(`LEGAL STATUS: ${LEGAL_NAMES[level].toUpperCase()}`, 3);
    }
    this.callStationDefence();
  }

  /**
   * Stations keep "a small fleet of ships for their own defence, which they
   * may risk to assist a trader if they see him attacked" — misbehave in
   * sight of the station and Vipers launch from the slot.
   */
  private callStationDefence(): void {
    if (this.witchspace || this.defenceLaunched) return;
    if (this.player.position.distanceTo(this.world.station.position) > DEFENCE_RANGE) return;
    this.defenceLaunched = true;
    launchStationDefence(this.world, this.tmp);
    this.hud.showMessage('STATION DEFENCE LAUNCHED', 4);
    sfx.beep(300, 0.18);
  }

  /**
   * Pull the trigger. The arguments are built from the state by combat.ts, so
   * the same gun can be fired against a state that is not this Game's; what
   * lands on the HUD and in the law is what makes this one the Game's.
   *
   * @internal — driven by test/playtest.js, wrapped by test/combat-recorder.js
   */
  fireLaser(): void {
    this.applyCombat(firePlayerLaser(this.state, this.combat, this.combatScratch));
  }

  /** Destruction credited to the player. @internal — driven by test/playtest.js */
  destroyNpc(npc: NpcShip): void {
    // The ENERGY BOMB reaches this from runCommand rather than through the step,
    // so it is the one kill an exercise cannot see through its own StepHost. An
    // exercise credits its clone and its record instead (see combat-sim.ts).
    if (this.combatSim.active) { this.combatSim.destroyNpc(npc); return; }
    this.applyCombat(this.combat.destroy(this.commander, npc));
  }

  /** Removal with no credit — an NPC-vs-NPC kill, or a collision. */
  private wreckNpc(npc: NpcShip): void {
    this.applyCombat(this.combat.wreck(npc));
  }

  /**
   * The player takes a hit.
   *
   * `source` says what did it and this implementation ignores it — the flash is
   * the same whatever hit you. It is on the signature because a caller wrapping
   * this method is the only place the fact is still available: see
   * `DamageSource`, and test/combat-recorder.js, which reads it off argument
   * three instead of guessing from `amount`.
   *
   * @internal — wrapped by test/combat-recorder.js
   */
  applyPlayerDamage(amount: number, from: THREE.Vector3, _source: DamageSource): void {
    this.hud.flashDamage();
    this.applyCombat(damagePlayer(this.state, this.combat, amount, from, this.combatScratch));
  }

  /**
   * Combat decides; the Game pays. Every consequence that reaches outside the
   * world — the HUD, the law, the missile lock, the death screen — lands here.
   */
  private applyCombat(events: readonly CombatEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'message': this.hud.showMessage(e.text, e.seconds); break;
        case 'offence': this.raiseLegal(e.level); break;
        case 'wrecked': if (this.targetLock === e.npc) this.targetLock = null; break;
        case 'beam': this.aimBeams(e.at); break;
        case 'fired': this.beamTimer = BEAM_FLASH; break;
        case 'breach': this.damageSomething(); break;
        case 'died': this.die(e.reason); break;
      }
    }
  }

  /** A hull hit destroys a tonne of cargo, or knocks out a fitting. */
  private damageSomething(): void {
    const lost = breachLoss(this.commander, random);
    if (lost.kind === 'cargo') {
      const c = COMMODITIES[lost.commodity];
      this.hud.showMessage(`CARGO LOST: 1${c.unit} ${c.name.toUpperCase()}`, 3);
      sfx.beep(300, 0.12);
    } else if (lost.kind === 'equipment') {
      // Losing ANY fitting hands control back, which is how this behaved
      // before it moved to systems.ts — narrowing it to `combatComputer` was
      // an unflagged behaviour change that an audit caught. A hit hard enough
      // to knock out equipment is a moment the player should be flying.
      this.ccEngaged = false;
      this.hud.showMessage(`${lost.name} DESTROYED`, 4);
      sfx.beep(240, 0.2);
    }
  }

  // --- the ship's autopilots -----------------------------------------------

  /**
   * The autopilots decide; the Game says it and plays it. Same shape as
   * applyStep and applyStation — and the sounds are events here because that
   * is what keeps autopilot.ts clear of audio.ts, and therefore node-safe.
   */
  private applyAutopilot(events: readonly AutopilotEvent[]): void {
    for (const e of events) {
      if (e.kind === 'message') this.hud.showMessage(e.text, e.seconds);
      else this.playSound(e);
    }
  }

  /**
   * The ONE place a `SoundEvent` becomes a noise.
   *
   * Both the world step and the autopilots return them (sounds.ts), and both
   * `apply*` end up here rather than carrying a switch each — two near-identical
   * `beep` arms in two switches is how a rule grows a second home.
   */
  private playSound(e: SoundEvent): void {
    switch (e.kind) {
      case 'beep': sfx.beep(e.hz, e.seconds); break;
      case 'countdown': sfx.countdown(e.n); break;
      case 'dockingMusic':
        if (e.on) sfx.dockingMusic();
        else sfx.stopDockingMusic();
        break;
      case 'sound': sfx[e.name](); break;
    }
  }

  private dockingComputer(): void {
    this.applyAutopilot(this.autopilot.toggleDocking());
  }

  /** @internal — driven by test/playtest.js */
  toggleCombatComputer(): void {
    this.applyAutopilot(this.autopilot.toggleCombat());
  }

  /**
   * Stranded in witch-space without the fuel to jump clear used to be a
   * slow, unrecoverable death — the autonomous playtest agent found it by
   * getting stuck there. GalCop will come for you, at a price: your cargo
   * pays the salvage fee.
   */
  sendDistressBeacon(): void {
    if (!this.witchspace) {
      this.hud.showMessage('DISTRESS BEACON IS FOR EMERGENCIES ONLY', 3);
      sfx.beep(220);
      return;
    }
    if (this.beaconTimer >= 0) {
      this.hud.showMessage('BEACON ALREADY BROADCASTING', 2);
      return;
    }
    this.beaconTimer = 20;
    this.hud.showMessage('DISTRESS BEACON BROADCAST — HOLD ON, COMMANDER', 6);
    sfx.beep(500, 0.4);
  }

  private completeRescue(): void {
    const c = this.commander;
    const salvage = c.cargo.reduce((s, q) => s + q, 0);
    c.cargo = c.cargo.map(() => 0);
    c.fuel = Math.max(c.fuel, 10); // enough for one jump clear
    this.beaconTimer = -1;
    // dumped at the nearest system to where the mis-jump left us
    const target = this.chart.targetIndex ?? c.systemIndex;
    c.systemIndex = target;
    c.day += 3; // the tow takes a while
    this.living.advance(3, COMMODITIES.map((cm) => cm.gradient));
    this.chart.targetIndex = null;
    this.witchspace = false;
    this.arriveInSystem();
    this.hud.showMessage(
      salvage > 0
        ? `RESCUED — ${salvage}t OF CARGO TAKEN AS SALVAGE`
        : 'RESCUED — NOTHING ABOARD WORTH TAKING',
      6);
  }

  /** One-shot jump to the next galaxy; lands at the nearest system to our coords. */
  private galacticJump(): void {
    const may = checkGalacticJump(this.commander, this.combatSim.active);
    if (!may.ok) {
      this.hud.showMessage(galacticRefusalMessage(may.reason), 3);
      sfx.beep(220);
      return;
    }
    const jump = resolveGalacticJump(this.commander, this.system);
    this.systems = jump.systems;
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(
      `GALAXY ${jump.galaxy} — ${this.system.name.toUpperCase()}`, 5);
  }

  // --- per-frame -----------------------------------------------------------

  /** @internal — driven by test/playtest.js */
  /**
   * One simulation step and one frame drawn.
   *
   * Kept as a single call because the console harnesses drive the game with it
   * (test/playtest.js, test/gang-trial.js) — the real loop separates them, and
   * steps a FIXED dt however long the frame took.
   */
  update(dt: number, elapsed: number): void {
    this.step(dt, elapsed);
    this.draw(dt);
  }

  /**
   * Advance the world by exactly `dt`.
   *
   * Draws nothing and reads no clock. Everything about the world that can
   * change lives downstream of this call, which is what makes a fixed
   * timestep worth having: the same inputs and the same seed produce the same
   * outcome regardless of frame rate.
   */
  step(dt: number, elapsed: number): void {
    // pause (flight only — everything else is inherently paused)
    if (this.mode === 'flight' && this.input.pressed('KeyP')) this.paused = !this.paused;
    if (this.mode !== 'flight') this.paused = false;
    if (this.paused) {
      this.hud.showMessage('PAUSED — P TO RESUME', 0.4);
      this.input.endFrame();
      return;
    }
    if (!this.tunnel.active) this.handleInput(dt);
    else this.input.endFrame();
    this.tunnel.update(dt);
    if (this.mode === 'flight') this.updateFlight(dt, elapsed);
    this.input.endFrame();
  }

  /** Put the current world on screen. Changes nothing about it. */
  draw(dt: number): void {
    this.render.camera.position.copy(this.player.position);
    this.render.camera.quaternion.copy(this.player.quaternion).multiply(VIEW_QUATS[this.view]);
    this.beamTimer -= dt;
    this.render.beams.visible = this.beamTimer > 0;
    this.render.draw();
    this.renderHud(dt);
  }

  /**
   * One frame of flight: produce a demand, advance the world, apply what it
   * reports.
   *
   * The five phases live in world-step.ts now — they step under node with no
   * HUD, no keyboard and no renderer, which is the whole point. What is left
   * here is the two things the world genuinely cannot do for itself: read the
   * hands at the controls, and say things out loud.
   */
  private updateFlight(dt: number, elapsed: number): void {
    const demand = this.pilotDemand(dt);
    const pilot = { demand, handsOn: this.handsOn() };

    // WHICH step. An exercise is ordinary flight with a different StepHost
    // behind it (combat-sim.ts), and its teardown is DEFERRED — `settle()` puts
    // the career back HERE, after the step has returned, because restoring from
    // inside `stepNpcs` would rebuild the scene while the step was still
    // iterating over it.
    if (this.combatSim.active) {
      this.applyStep(this.combatSim.tick(dt, elapsed, pilot));
      this.combatSim.settle();
    } else {
      this.applyStep(this.worldStep.step(dt, elapsed, pilot));
    }

    // The dust is seen, never simulated — so it is updated out here, from
    // wherever the step left the ship. It needs our actual velocity to streak:
    // the torus drive multiplies our travel by 8, and that is what smears the
    // stars.
    this.dust.update(
      this.player.position,
      this.player.getForward(this.tmp)
        .multiplyScalar(this.player.speed * (this.torusEngaged && !this.massLocked() ? 8 : 1)),
    );
  }

  /**
   * The step decides; the Game says it and plays it. Same shape as applyCombat,
   * and for the same reason: a phase that called the HUD — or the AudioContext
   * — could not run in a trainer.
   *
   * `npcFired` is deliberately dropped here: it is for a measuring caller
   * (combat-sim.ts), and the cockpit already hears the shot.
   */
  private applyStep(events: readonly StepEvent[]): void {
    for (const e of events) {
      if (e.kind === 'message') this.hud.showMessage(e.text, e.seconds);
      else if (e.kind !== 'npcFired') this.playSound(e);
    }
  }

  /**
   * Is the human touching the controls? Both autopilots let go when they are —
   * the combat computer hands the ship back, the docking computer breaks off.
   */
  private handsOn(): boolean {
    return this.input.held(...manualFlightKeys())
      || Math.abs(this.input.mouseX) > 0.15 || Math.abs(this.input.mouseY) > 0.15;
  }

  /**
   * Who is flying, and what they want.
   *
   * ONE producer per frame: the hands at the keyboard, or the combat computer
   * when it is engaged and still willing. The trigger is the union of the two
   * — a fitted combat computer flies the ship, it does not take your gun off
   * you.
   */
  private pilotDemand(dt: number): FlightDemand {
    const hands = flightDemand(this.input, this.player, dt);
    // the virtual stick self-centres; the producer is pure, so the mutation
    // is ours to do, immediately after reading it
    if (this.input.mouseFlight) this.input.decayMouse(dt);
    if (!this.ccEngaged) return hands;
    const auto = this.autopilot.combatDemand(dt, this.handsOn(), DEFEND_BRAIN);
    this.applyAutopilot(auto.events);
    return auto.demand
      ? { ...auto.demand, fire: auto.demand.fire || hands.fire }
      : hands;
  }


  /**
   * Hermits deal in ore and ask no questions — the one place to sell
   * contraband without a police scan, at the cost of finding them.
   */
  /** @internal — driven by test/playtest.js */
  openHermitTrade(): void {
    this.hermitTrading = true;
    this.hermitMarket = generateMarket(this.system, randomInt(256))
      .map((m, i) => {
        // miners are flush with ore and pay over the odds for supplies
        if (i === 12 || i === 13 || i === 14 || i === 15) {
          return { ...m, quantity: m.quantity + 20, price: +(m.price * 0.75).toFixed(1) };
        }
        if (i === 0 || i === 4 || i === 8) return { ...m, price: +(m.price * 1.3).toFixed(1) };
        return m;
      });
    this.market = this.hermitMarket;

    this.screens.open('market');
    this.baseMode = 'flight';
    this.player.speed = 0;
    sfx.dock();
    this.screens.open('market');
  }



  // --- input ---------------------------------------------------------------

  /**
   * Read the controls, and do what they asked for.
   *
   * The bindings are a table in controls.ts and the consequences are
   * `runCommand` below — the same decides/applies split as the world step and
   * the station, applied to the keyboard. What is left here is the routing
   * that genuinely belongs to the orchestrator: the help panel is global, the
   * screen stack gets first refusal, and only then does the base state get the
   * frame.
   */
  private handleInput(dt: number): void {
    const i = this.input;
    for (const c of globalCommands(i)) this.runCommand(c);

    // The host runs the menu cursor and gives the frame to the top screen.
    // Every overlay has migrated to the Screen contract, so if one is open it
    // handles the frame and we are done — what is left below is the three
    // states that are NOT screens.
    if (this.screens.update(i, dt)) return;

    const mode = this.controlMode();
    if (!mode) return;
    for (const c of commandsFor(mode, i)) this.runCommand(c);
  }

  /**
   * Which binding table is live.
   *
   * Null for a screen id with no registered screen: the old chain simply had
   * no branch for it, and an unmigrated overlay must not fall through to the
   * cockpit's keys.
   */
  private controlMode(): ControlMode | null {
    if (this.mode === 'docked') return this.pendingNewGame ? 'confirmNewGame' : 'docked';
    // An exercise is ordinary flight with a different StepHost, so it is the
    // same mode to the world and a different TABLE to the keyboard: no
    // hyperspace, no beacon, no jettison, no docking computer — and Escape or Q
    // ends it (controls.ts, NOT_IN_THE_SIMULATOR).
    if (this.mode === 'flight') return this.combatSim.active ? 'simulator' : 'flight';
    if (this.mode === 'dead') return 'dead';
    return null;
  }

  /**
   * Every command, as data.
   *
   * A `Record<Command, ...>` rather than a switch, and the difference is not
   * style: the compiler now REFUSES a Command with no entry. The switch could
   * not — a missing case fell through and the key silently did nothing, which
   * is why a test had to grep this file for `case '...'` to check none was
   * missing. That test is a type error now.
   *
   * It also took the worst cyclomatic complexity in src/ (39, by lizard) down
   * to nothing, because a lookup has no branches.
   *
   * Deliberately one-liners: anything longer than a line belongs in the module
   * that owns the rule. This is the whole surface a replay, an AI or a test
   * drives the game through — the same one a pair of hands does, since the
   * keyboard reaches it only through controls.ts.
   */
  private readonly commands: Record<Command, () => void> = {
    // --- global -----------------------------------------------------------
    toggleHelp: () => this.shell.toggleHelp(),
    // --- the station menu -------------------------------------------------
    launch: () => this.launch(),
    openMarket: () => this.screens.open('market'),
    openContracts: () => this.screens.open('contracts'),
    openEquip: () => this.screens.open('equip'),
    openBriefing: () => this.screens.open('briefing'),
    openSaves: () => this.openSaves(),
    openSystemData: () => this.openSystemData(this.system, 'docked'),
    openCombatSim: () => this.screens.open('combat-sim'),
    exportSave: () => this.exportSave(),
    importSave: () => this.importSave(),
    toggleLayout: () => this.switchLayout(),
    // --- erasing a career -------------------------------------------------
    askNewGame: () => {
      this.pendingNewGame = true;
      renderNewGameConfirm(this.system, this.commander);
    },
    newGame: () => this.newCommanderGame(),
    cancelNewGame: () => {
      this.pendingNewGame = false;
      renderDockedMenu(this.system, this.commander, this.station.missionText());
    },
    // --- shared between the menu and the cockpit --------------------------
    openChart: () => this.openChart(this.cameFrom()),
    openLocalChart: () => this.openLocalChart(this.cameFrom()),
    openStatus: () => this.openStatus(this.cameFrom()),
    // --- the cockpit ------------------------------------------------------
    view0: () => this.setView(0),
    view1: () => this.setView(1),
    view2: () => this.setView(2),
    view3: () => this.setView(3),
    armMissile: () => this.armMissile(),
    launchMissile: () => this.launchMissile(),
    disarmMissile: () => this.disarmMissile(),
    fireEcm: () => this.triggerEcm(),
    detonateEnergyBomb: () => this.detonateEnergyBomb(),
    toggleCombatComputer: () => this.toggleCombatComputer(),
    toggleDockingComputer: () => this.dockingComputer(),
    toggleMouseFlight: () => this.toggleMouseFlight(),
    toggleTorus: () => this.toggleTorus(),
    startHyperspace: () => this.startHyperspace(),
    galacticJump: () => this.galacticJump(),
    distressBeacon: () => this.sendDistressBeacon(),
    jettison1: () => this.jettisonCargo(1),
    jettison5: () => this.jettisonCargo(5),
    // --- the training simulator -------------------------------------------
    endExercise: () => this.endExercise(),
    // --- after the end ----------------------------------------------------
    respawn: () => this.respawn(),
  };

  private runCommand(c: Command): void {
    this.commands[c]();
  }


  /**
   * Where an overlay was opened from, so Escape puts the ship back.
   * Only ever asked while docked or in flight — the dead press one key.
   */
  private cameFrom(): 'docked' | 'flight' {
    return this.baseMode === 'docked' ? 'docked' : 'flight';
  }

  private switchLayout(): void {
    const layout = toggleLayout();
    this.hud.showMessage(`KEYBOARD: ${layout.toUpperCase()} LAYOUT`, 3);
    renderDockedMenu(this.system, this.commander, this.station.missionText());
  }

  private disarmMissile(): void {
    if (!this.targetLock && !this.missileArmed) return;
    this.ordnance.disarm();   // one home for "no lock, no pylon" — ordnance.ts
    this.hud.showMessage('MISSILE DISARMED', 2);
    sfx.beep(500, 0.06);
  }

  private toggleMouseFlight(): void {
    if (this.input.mouseFlight) {
      this.input.releaseMouseFlight();
      this.hud.showMessage('MOUSE FLIGHT OFF', 2);
    } else {
      this.input.requestMouseFlight();
      this.hud.showMessage('MOUSE FLIGHT — ESC OR V TO RELEASE', 4);
    }
  }

  private toggleTorus(): void {
    if (this.massLocked()) {
      this.hud.showMessage('MASS LOCKED', 2);
      sfx.beep(220);
      return;
    }
    this.torusEngaged = !this.torusEngaged;
    // Engaging the drive opens the throttle. Nobody engages a jump drive in
    // order to crawl, and having to hold the accelerator afterwards was
    // busywork with one sensible answer.
    if (this.torusEngaged) this.player.speed = this.player.maxSpeed;
    this.hud.showMessage(this.torusEngaged ? 'TORUS DRIVE ENGAGED' : 'TORUS DRIVE OFF', 2);
    if (this.torusEngaged) sfx.beep(1000, 0.15);
  }

  /** @internal — driven by test/playtest.js */
  openChart(from: 'docked' | 'flight'): void {
    this.input.releaseMouseFlight();
    this.baseMode = from;
    this.screens.open('chart');
  }

  /** @internal — driven by test/playtest.js */
  openLocalChart(from: 'docked' | 'flight'): void {
    this.input.releaseMouseFlight();
    this.baseMode = from;
    this.screens.open('local');
  }

  /**
   * Mouse input for the overlay screens. Buttons and menu rows carry a
   * `data-key`, which is injected as a synthetic key press so clicks and
   * the keyboard run through exactly the same handlers; table rows carry a
   * `data-row` selection index; charts map clicks back to chart coordinates.
   */
  private handleScreenClick(el: unknown, e: unknown): void {
    // The host owns all of it: data-key becomes a keystroke so a click and the
    // printed shortcut take exactly the same path, data-row goes to the top
    // screen's select(), and anything else — a chart canvas — reaches its
    // clickAt() with the raw event so it can map pixels to its own space.
    this.screens.click(el, this.input, e);
  }



  private setView(v: number): void {
    if (this.view === v) return;
    this.view = v;
    sfx.beep(600, 0.04);
  }


  /** @internal — driven by test/playtest.js */
  /**
   * `from` is no longer read: the stack remembers where you came from, because
   * data is pushed ON TOP of the chart rather than replacing it. Kept in the
   * signature for test/playtest.js.
   */
  openSystemData(sys: StarSystem, from?: 'docked' | 'chart' | 'local'): void {
    void from;
    this.dataSubject = sys;
    this.screens.open('data');
  }

  private openStatus(from: 'docked' | 'flight'): void {
    this.input.releaseMouseFlight();
    this.baseMode = from;
    this.screens.open('status');
  }

  /** Nothing on the stack: show the docked menu, or clear back to flight. */
  private showBaseScreen(): void { this.station.showBaseScreen(); }



  /**
   * Dump a tonne over the side. Pirates came for cargo, not for you — give
   * them enough of it and the opportunists break off and go collect, which
   * turns "I can't win this fight" into a decision rather than a death.
   * Organised gangs want considerably more convincing.
   */
  /** @internal — driven by test/playtest.js */
  jettisonCargo(tonnes = 1): void {
    if (this.mode !== 'flight') { sfx.beep(220); return; }

    const dumped = dumpCargo(this.commander.cargo, tonnes);
    if (dumped.tonnes.length === 0) {
      this.hud.showMessage('HOLD EMPTY', 1.5);
      sfx.beep(220);
      return;
    }
    for (const commodity of dumped.tonnes) {
      this.world.cargo.spawn(this.player.position.clone(), 1, [commodity]);
    }
    this.jettisonedValue += dumped.value;
    sfx.beep(320, 0.08);

    const n = dumped.tonnes.length;
    const bribe = offerBribe(
      this.world.npcs.filter((npc) => npc.role === 'pirate'),
      this.jettisonedValue, this.arrivalCargoValue);
    if (bribe.bought > 0) {
      this.hud.showMessage(
        `${bribe.bought} ATTACKER${bribe.bought > 1 ? 'S' : ''} BREAKING OFF`, 3);
    } else if (bribe.stillWant !== null) {
      this.hud.showMessage(
        `JETTISONED ${n}t ${dumped.lastName} — THEY WANT MORE `
        + `(${formatCredits(Math.ceil(bribe.stillWant))})`, 3);
    } else {
      this.hud.showMessage(`JETTISONED ${n}t ${dumped.lastName}`, 2);
    }
  }

  // --- HUD -----------------------------------------------------------------

  /**
   * Light the sight when the aim assist would actually reach the target.
   *
   * The circle shows the envelope at knife range; this tells the truth for
   * the target in front of you right now, since the assist tapers with
   * distance. Together they answer "will this shot land?" without the player
   * having to learn the numbers.
   */
  private updateSight(): void {
    let on = false;
    if (this.mode === 'flight') {
      const forward = this.viewDir(this.tmp);
      for (const npc of this.world.npcs) {
        if (!npc.alive || npc.role === 'asteroid') continue;
        const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > LASER_RANGE) continue;
        const cone = hitCone(npc.radius, dist);
        if (forward.angleTo(to.normalize()) < cone) { on = true; break; }
      }
    }
    this.shell.setSightLit(on);
  }

  /**
   * Point the cockpit beams at `target`, or straight down the gun axis when
   * there is nothing to converge on.
   *
   * The beams are children of the camera and meet at (0, 0, -BEAM_Z), so the
   * convergence point is simply the target direction in camera space at the
   * same depth. Only the meeting point moves — the emitters stay on the hull
   * corners, which is what sells the beams as bending.
   */
  private aimBeams(target: THREE.Vector3 | null): void {
    const pos = this.render.beams.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let x = 0, y = 0, z = -BEAM_Z;
    if (target) {
      const local = this.render.camera.worldToLocal(this.tmp2.copy(target));
      const len = local.length();
      if (len > 1e-3) {
        x = (local.x / len) * BEAM_Z;
        y = (local.y / len) * BEAM_Z;
        z = (local.z / len) * BEAM_Z;
      }
    }
    // vertices 1 and 3 are the convergence point (0 and 2 are the emitters)
    arr[3] = x; arr[4] = y; arr[5] = z;
    arr[9] = x; arr[10] = y; arr[11] = z;
    pos.needsUpdate = true;
  }

  private renderHud(dt: number): void {
    this.updateSight();
    const frame = buildHudFrame({
      commander: this.commander,
      sys: this.sys,
      world: this.world,
      camera: this.render.camera,
      playerPos: this.player.position,
      playerQuat: this.player.quaternion,
      playerForward: this.player.getForward(this.tmp),
      viewDir: this.viewDir(this.tmp2),
      speedFrac: this.player.speed / this.player.maxSpeed,
      rollFrac: this.player.rollRate / PLAYER_FLIGHT.maxRoll,
      pitchFrac: this.player.pitchRate / PLAYER_FLIGHT.maxPitch,
      view: this.view,
      missiles: this.missiles,
      canisters: this.canisters,
      targetLock: this.targetLock,
      missileArmed: this.missileArmed,
      inFlight: this.mode === 'flight',
      witchspace: this.witchspace,
      assist: this.ccEngaged,
      ecmDetected: this.ecmDetectedTimer > 0,
    }, this.hudScratch);

    this.hud.drawTargets(frame.targets);
    this.hud.render(dt, frame.state, this.player.position, this.player.quaternion,
      frame.contacts, frame.compassTarget);
  }
}
