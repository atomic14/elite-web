// The orchestrator. Game owns the mode state machine (docked | flight |
// market | chart | local | equip | status | dead), routes input per mode,
// steps the world and every NPC, and resolves all consequences: NPCs *ask*
// to fire (FireEvent) and this file rolls the dice, draws tracers, applies
// damage, pays bounties and escalates legal status. Screens (ui/screens.ts)
// and the HUD (hud/hud.ts) are pure renderers fed from here.
// `window.__game` exposes the instance for the autopilot test harness
// (docs/JAMESON-TRIALS.md, train/jameson-autopilot.js) and console poking.
import * as THREE from 'three';

import { generateGalaxy, generateMarket, COMMODITIES, type MarketEntry, type StarSystem } from '../galaxy/galaxy.ts';
import { LivingGalaxy } from '../galaxy/living.ts';
import {
  generateContractOffers, pirateThreat, markOf, MAX_CONTRACTS, type PirateThreat,
} from './contracts.ts';
import { createStarfield, SpaceDust } from '../world/starfield.ts';
import { PlayerShip } from '../player.ts';
import { Input } from '../engine/input.ts';
import { keymap, layoutName, toggleLayout, manualFlightKeys, refreshHelpPanel } from '../engine/keymap.ts';
import { Hud } from '../hud/hud.ts';
import { buildHudFrame, hostilesNear } from '../hud/hud-binding.ts';
import { TunnelEffect } from '../hud/tunnel.ts';
import { sfx } from '../audio.ts';
import { NpcShip, type FireEvent } from './npc.ts';
import { installPolicyKit, DEFEND_BRAIN } from './brains.ts';
import {
  CONSTRICTOR_SPEC, pirateSpecForTier, type NpcSpec, type NpcRole,
} from './ship-specs.ts';
import { planDocking, dockingOutcome, type DockPlan } from './docking.ts';
import { type Canister } from './cargo.ts';
import { spawnPopulation, spawnArrivingTrader } from './spawning.ts';
import { dumpCargo, offerBribe } from './jettison.ts';
import { Combat, BEAM_FLASH, type CombatEvent } from './combat.ts';
import { checkJump, resolveJump, refusalMessage, COUNTDOWN } from './hyperspace.ts';
import { stepTrumbles, trumbleMessage } from './trumbles.ts';
import {
  stepMissionAtDock, constrictorLurksHere, missionHeadline,
} from './missions.ts';
import { World, TRADER_ARRIVAL_RANGE } from './world.ts';
import { random, randomInt, randomDirection, seedWorld, rngState, restoreRng } from './rng.ts';
import { saveWorld, readWorld, clearWorld, loadCommander, saveCommander } from './storage.ts';
import {
  SNAPSHOT_VERSION, v3, q4, serialiseState, restoreState,
  type WorldSnapshot,
} from './snapshot.ts';
import { playerVsNpcs, npcVsNpcs, npcsVsStation, RAM_DAMAGE } from './collisions.ts';
import { assignNpcTargets } from './npc-targeting.ts';
import { planPopulation } from './population.ts';
import { CombatComputer, CC_MAX_SPEED, CC_ACCEL } from './combat-computer.ts';
import {
  Ordnance, ordnanceMessage, ECM_ENERGY_COST,
  type Missile, type OrdnanceReply,
} from './ordnance.ts';
import {
  hitCone, LASER_RANGE, AIM_ASSIST,
  npcHitChance, npcShotDamage, NPC_VS_NPC_HIT, NPC_VS_NPC_DAMAGE,
} from './gunnery.ts';
import {
  stepEncounters, freshTimers, AMBUSH_STANDOFF, type EncounterTimers,
} from './encounters.ts';
import {
  regenerate, updateCabinTemp, scoopFuel, breachLoss,
  type ShipSystems,
} from './systems.ts';
import {
  SavesScreen, NamingScreen, exportCommanderFile, importCommanderFile, startNewCommander,
  type SavesContext,
} from './screens/saves.ts';
import {
  MarketScreen, EquipScreen, buyEquipment, makeLocalMarket, type TradeContext,
} from './screens/trade.ts';
import { StatusScreen, type StatusContext } from './screens/status.ts';
import { DataScreen, type DataContext } from './screens/data.ts';
import { BriefingScreen } from './screens/briefing.ts';
import { ContractsScreen, type ContractsContext } from './screens/contracts.ts';
import { ChartScreen, type ChartContext } from './screens/chart.ts';
import { ScreenHost } from '../ui/screen-host.ts';
import { createRenderStack, BEAM_Z, type RenderStack } from '../engine/render-stack.ts';
import { nearestSystemTo } from '../galaxy/navigation.ts';
/**
 * Playtesting cheat: `window.__cheat = true` fits anything from the catalogue
 * anywhere, free and regardless of tech level. Deliberately a console handle
 * like `__scriptedPirates` and `__packBrain` rather than a key binding — it is
 * a development tool, and nobody should reach it by accident.
 */
function cheatMode(): boolean {
  return !!(globalThis as unknown as Record<string, unknown>).__cheat;
}


/**
 * Grazing radius for drifting cargo, in world units. Canisters are ~12 units
 * across, so an exact ray needs 1.4 degrees of accuracy at 500m and they felt
 * unhittable. They're not a skill target the way a fighter is — shooting one
 * is a deliberate act — so they get a flat, generous tolerance instead of the
 * silhouette-proportional one ships get.
 */

/**
 * Aim assist: an angular allowance ON TOP of the target's silhouette, so a
 * shot that is nearly right still connects.
 *
 * Chris's idea, and it is the player's half of the same problem the NPCs
 * have. A Sidewinder at 500 units subtends 1.9 degrees; holding a human hand
 * inside that while both ships manoeuvre is most of why fights felt like
 * flailing. The assist is a fixed 2 degrees at knife range, tapering to
 * nothing by ASSIST_FADE_END so that distance shooting still demands
 * precision and nobody snipes across three kilometres.
 *
 * The reticle is drawn to this exact angle (see #crosshair), which is the
 * point: the circle is not decoration, it is the envelope.
 */
/** Depth in camera space at which the cockpit beams converge. */


import {
  formatCredits, MAX_FUEL, cargoCapacity, cargoTonnes,
  type CommanderData, type Contract,
} from './commander.ts';
import {
  LEGAL_NAMES, carryingContraband, fineFor, CLEAN, SCAN_RANGE, DEFENCE_RANGE,
} from './law.ts';
import {
  hideScreen, renderDockedMenu, renderNewGameConfirm,
  renderGameOver, describeContract, type ChartState,
} from '../ui/screens.ts';
import { freshState, AUTOSAVE_INTERVAL, type GameState } from './state.ts';
import type { SessionState } from './session.ts';



type Mode = 'docked' | 'flight' | 'market' | 'chart' | 'local' | 'equip' | 'status' | 'data' | 'contracts' | 'saves' | 'naming' | 'briefing' | 'dead';

/**
 * The world advances in slices of exactly this. 60Hz, matching the rate the
 * NPC brains decide at (10Hz, every sixth step) and the rate every combat
 * number in this project was measured against.
 */
export const FIXED_DT = 1 / 60;
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

const SUN_KILL_DIST = 21_000;   // instant death
const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X_CC = new THREE.Vector3(1, 0, 0);
const AXIS_Z_CC = new THREE.Vector3(0, 0, 1);

// view quaternions: front, rear, left, right (yaw about ship Y)
const VIEW_QUATS = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((a) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));

// Fields the autonomous playtest agent (test/playtest.js) reads or drives
// are public rather than private; they are otherwise internal.
export class Game {
  /** everything that needs a GPU — see engine/render-stack.ts */
  private readonly render: RenderStack;



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


  /** missile armed but not yet locked (the original's yellow pylon) */

  /** countdowns for arrivals, pirate waves and Thargon drops — see encounters.ts */
  private get encounterTimers(): EncounterTimers { return this.state.encounterTimers; }
  private set encounterTimers(v: EncounterTimers) { this.state.encounterTimers = v; }
  /** counts down to the next mid-flight world save — see autoSave() */
  /** the station only scrambles its defence fleet once per visit */
  /** trading with a rock hermit rather than a station */
  private get hermitMarket(): MarketEntry[] { return this.state.hermitMarket; }
  private set hermitMarket(v: MarketEntry[]) { this.state.hermitMarket = v; }
  /** true after leaving a hermit, until you fly clear of it */
  /** waiting on the player to confirm erasing their commander */
  private pendingNewGame = false;
  /** cursor position for arrow-key menu navigation (see handleMenuCursor) */
  /** page of the new pilot's briefing */
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
  /** cargo value dumped this encounter, tenths of a credit — resets on arrival */
  /** what the hold was worth on arrival — sets what the pirates think they're owed */
  /** seconds until a rescue answers the distress beacon (-1 = not sent) */
  get contractOffers(): Contract[] { return this.state.contractOffers; }
  set contractOffers(v: Contract[]) { this.state.contractOffers = v; }
  /**
   * Selected contract row. A property because it lives on ContractsScreen now,
   * and test/playtest.js assigns it before calling acceptContract().
   */
  /** @internal — driven by test/playtest.js */
  get contractSelected(): number { return this.contracts_.selected; }
  set contractSelected(v: number) { this.contracts_.selected = v; }
  /** where ESC returns to from the DATA ON screen */
  /** console 'E' dwell */
  private get ecmDetectedTimer(): number { return this.state.ecmDetectedTimer; }
  private set ecmDetectedTimer(v: number) { this.state.ecmDetectedTimer = v; }
  // combat computer: the jameson-defend policy flying the player's ship
  private readonly combatComputer = new CombatComputer();
  /** missiles, E.C.M. and the energy bomb — see ordnance.ts */
  private readonly ordnance = new Ordnance(this.world);
  /**
   * Resolving hits: shots, wrecks, bounties — see combat.ts. */
  private readonly combat = new Combat(this.world);

  /** Missiles in flight. Owned by `ordnance`; exposed for the HUD and saves. */
  get missiles(): Missile[] { return this.ordnance.missiles; }
  /** Cargo adrift. Owned by `cargo`; exposed for the HUD and the snapshot. */
  get canisters(): Canister[] { return this.world.cargo.items; }
  get targetLock(): NpcShip | null { return this.ordnance.targetLock; }
  set targetLock(v: NpcShip | null) { this.ordnance.targetLock = v; }
  get missileArmed(): boolean { return this.ordnance.armed; }
  set missileArmed(v: boolean) { this.ordnance.armed = v; }

  /** Apply what the ordnance did. It reports; the consequences are ours. */
  private applyOrdnance(dt: number): void {
    for (const e of this.ordnance.step(dt, this.player.position)) {
      if (e.kind === 'killed') {
        e.npc.takeDamage(99, undefined, true);
        this.destroyNpc(e.npc);
      } else if (e.kind === 'hitPlayer') {
        this.world.effects.explosion(e.at, 0xff8866);
        sfx.explosion();
        this.applyPlayerDamage(e.damage, e.at);
      } else if (e.kind === 'ecmDefeated') {
        this.world.effects.explosion(e.at, 0xffb444, { count: 12, duration: 0.8 });
        this.ecmDetectedTimer = 2;
        this.hud.showMessage('TARGET E.C.M. — MISSILE DESTROYED', 3);
        sfx.ecm();
      } else {
        this.world.effects.explosion(e.at, 0xffb444, { count: 12, duration: 0.8 });
      }
    }
  }

  /** Ordnance reports what it did; saying it is ours. */
  private say(reply: OrdnanceReply | null): void {
    if (!reply) return;
    const m = ordnanceMessage(reply);
    this.hud.showMessage(m.text, m.seconds);
  }

  private armMissile(): void { this.say(this.ordnance.arm(this.commander)); }

  private updateMissileLock(): void {
    this.say(this.ordnance.updateLock(this.player.position, this.viewDir(this.tmp)));
  }

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
    const flash = document.getElementById('bomb-flash');
    if (flash) {
      flash.classList.add('boom');
      void flash.offsetWidth;
      flash.classList.remove('boom');
    }
    for (const npc of caught) {
      npc.takeDamage(99, this.player.position, true);
      this.destroyNpc(npc);
    }
  }

  private enemyLaunchMissile(npc: NpcShip): void {
    npc.missiles -= 1;
    this.say(this.ordnance.launchHostile(npc.nosePosition(this.tmp).clone()));
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
  /** scratch for collisions.ts, so a per-frame call allocates nothing */
  private readonly scratch = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  /** reused for player gunnery — see LASER_GRAZE */
  /** the shot's ray and scratch vectors, reused every trigger pull */
  private readonly combatScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
  };
  /** docking computer flying the ship in — see dockingComputerStep */
  private get dockPlan(): DockPlan { return this.state.dockPlan; }
  private readonly tmpQ = new THREE.Quaternion();
  /** scratch for the per-frame dashboard read, so it allocates nothing */
  private readonly hudScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    c: new THREE.Vector3(), q: new THREE.Quaternion(),
  };
  private readonly tmpM = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.render = createRenderStack(canvas, this.world.scene);
    window.addEventListener('resize', () => this.resize());
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

    // all screens accept mouse input; the listener lives on the persistent
    // overlay container, since screen contents are re-rendered wholesale
    document.getElementById('screen')!.addEventListener('click', (e) => this.handleScreenClick(e));

    // test-harness handle: the Jameson autopilot (train/jameson-autopilot.js,
    // docs/JAMESON-TRIALS.md) drives the whole game through this
    (globalThis as unknown as Record<string, unknown>).__game = this;
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
    const frame = (now: number): void => {
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
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pxPerRad = this.render.resize(w, h);
    this.hud.resizeOverlay(w, h);
    // Draw the sight to the assist envelope, so the circle means something: a
    // target inside it is a target the shot will reach for. Derived from the
    // real projection rather than picked by eye, so it stays honest if the fov
    // or the assist angle ever change.
    document.documentElement.style.setProperty(
      '--sight-r', `${Math.round(Math.tan(AIM_ASSIST) * pxPerRad)}px`);
  }

  private get system(): StarSystem {
    return this.systems[this.commander.systemIndex];
  }

  /**
   * The 1984 market, nudged by the living galaxy: supply that actually
   * arrived makes things cheaper here, cargo lost to pirates makes them
   * dearer. Baseline prices are untouched — this is a ±25% delta.
   */
  private localMarket(): MarketEntry[] {
    return makeLocalMarket(this.system,
      (i) => this.living.priceMultiplier(this.commander.systemIndex, i));
  }

  /** The only slice of the Game the market and outfitters are allowed to see. */
  private tradeContext(): TradeContext {
    return {
      commander: this.commander,
      system: this.system,
      market: this.market,
      atHermit: this.hermitTrading,
      cheat: cheatMode(),
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

  private clearNpcs(): void {
    this.world.clearNpcs();
    this.ordnance.clear();
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

  /** @internal — driven by test/playtest.js */
  enterDocked(booting = false): void {
    // whatever flew us in, we're down: drop the autopilot and cut the music
    this.dcEngaged = false;
    sfx.stopDockingMusic();
    this.baseMode = 'docked';
    // Docking supersedes the mid-flight world. Leaving it behind meant a
    // reload resumed the snapshot from BEFORE the dock: the cargo you had
    // just sold was back in the hold, the equipment you bought was gone, and
    // the next dock wrote that rolled-back commander over the good one.
    if (!booting) clearWorld();
    this.clearNpcs();
    this.foreShield = 1;
    this.aftShield = 1;
    this.energy = 4;
    this.laserTemp = 0;
    this.hyperCountdown = -1;
    this.torusEngaged = false;
    this.ccEngaged = false;
    this.missileArmed = false;
    this.input.releaseMouseFlight();
    // Hand over anyone you pulled out of a capsule. Without this they occupy
    // a bay for the rest of the career, which is the failure mode the old
    // `cargo[3]` at least avoided by being sellable.
    if (this.commander.survivors > 0) {
      const n = this.commander.survivors;
      this.commander.survivors = 0;
      this.hud.showMessage(
        `${n} SURVIVOR${n > 1 ? 'S' : ''} HANDED TO STATION MEDICAL`, 4);
    }

    const fine = fineFor(this.commander.legalStatus, this.commander.credits);
    if (fine > 0 || this.commander.legalStatus > CLEAN) {
      this.commander.credits -= fine;
      this.commander.legalStatus = CLEAN;
      this.hud.showMessage(`OFFENCE FINE PAID: ${formatCredits(fine)}`, 5);
    }
    this.policeScanned = false;
    this.defenceLaunched = false;
    this.view = 0;
    this.cabinTemp = 0;
    this.witchspace = false;
    this.beaconTimer = -1;
    this.world.cargo.clear();
    this.checkMissionAtDock();
    this.hermitTrading = false;
    this.market = this.localMarket();
    this.settleContracts();
    this.contractOffers = this.generateContractOffers();
    this.contractSelected = 0;
    this.commander.galaxyState = this.living.save();
    saveCommander(this.commander);
    if (!booting) {
      sfx.stopDockingMusic();
      sfx.dock();
      sfx.tunnel();
      this.tunnel.start(1.4, 'in'); // the bay shuts around you
    }
    // park just outside the slot so the backdrop behind the menu is the station
    this.player.position.copy(this.world.spawnPosition);
    this.lookAlong(this.world.station.position.clone().sub(this.player.position));
    this.player.speed = 0;
    renderDockedMenu(this.system, this.commander, this.missionText());
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
   * The whole world as plain data — see snapshot.ts.
   *
   * This is what lets a commander be saved anywhere rather than only at a
   * station: the station save is the commander alone, and mid-flight there is
   * a great deal more that matters.
   */
  captureSnapshot(): WorldSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      mode: this.baseMode === 'flight' ? 'flight' : 'docked',
      commander: structuredClone(this.commander),
      galaxyState: this.living.save(),
      player: {
        pos: v3(this.player.position),
        quat: q4(this.player.quaternion),
        speed: this.player.speed,
        pitchRate: this.player.pitchRate,
        rollRate: this.player.rollRate,
      },
      systems: { ...this.sys },
      // Each object saves ITSELF. These three methods were written months ago
      // and had ZERO callers, because captureSnapshot hand-inlined all three
      // while the restore side used the module methods. Capture and restore
      // living in different files is precisely the failure this keeps having.
      npcs: this.world.captureNpcs(),
      canisters: this.world.cargo.capture(),
      encounterTimers: { ...this.encounterTimers },
      dockPlan: serialiseState(this.dockPlan as unknown as Record<string, unknown>),
      combatComputer: serialiseState(
        this.combatComputer.state as unknown as Record<string, unknown>),
      lastThreat: this.lastThreat ? { ...this.lastThreat } : null,
      ecmDetectedTimer: this.ecmDetectedTimer,
      session: serialiseState(this.session as unknown as Record<string, unknown>),
      rng: rngState(),
      chartTarget: this.chart.targetIndex,
      chartCursor: [this.chart.cursorX, this.chart.cursorY],
      stationQuat: q4(this.world.station.quaternion),
      missiles: this.ordnance.capture((npc) => this.world.npcs.indexOf(npc)),
      market: structuredClone(this.market),
      hermitMarket: structuredClone(this.hermitMarket),
      contractOffers: structuredClone(this.contractOffers),
      targetLock: this.targetLock ? this.world.npcs.indexOf(this.targetLock) : -1,
      missileArmed: this.missileArmed,
    };
  }

  /**
   * Put the world back exactly as a snapshot found it.
   *
   * Order matters: the galaxy is rebuilt first because NPCs are placed
   * relative to a station that has to exist, and the rng is restored LAST so
   * that nothing rebuilt along the way consumes from the stream the snapshot
   * was about to use.
   */
  restoreSnapshot(snap: WorldSnapshot): void {
    if (snap.version !== SNAPSHOT_VERSION) {
      throw new Error(`snapshot version ${snap.version}, expected ${SNAPSHOT_VERSION}`);
    }
    this.commander = structuredClone(snap.commander);
    this.systems = generateGalaxy(this.commander.galaxy);
    this.living = new LivingGalaxy(this.systems);
    this.living.load(snap.galaxyState as Parameters<LivingGalaxy['load']>[0]);
    restoreState(this.session as unknown as Record<string, unknown>, snap.session);
    this.buildWorld();
    if (this.witchspace) this.enterWitchspace();

    this.player.position.set(...snap.player.pos);
    this.player.quaternion.set(...snap.player.quat);
    this.player.speed = snap.player.speed;
    this.player.pitchRate = snap.player.pitchRate;
    this.player.rollRate = snap.player.rollRate;
    Object.assign(this.sys, snap.systems);

    // Which hull each ship gets is a GAME rule — the tier tables and the
    // Constrictor — so the World asks rather than deciding. Both inputs are
    // in the state about to be applied, so no extra snapshot field is needed;
    // without this a restored tier-2 ship came back as the default hull, with
    // a different flight envelope and a fraction of the bounty.
    this.ordnance.clear();
    this.world.restoreNpcs(snap.npcs, (n) => (
      n.state.isMissionTarget ? CONSTRICTOR_SPEC
        : n.role === 'pirate' ? pirateSpecForTier(Number(n.state.threatTier ?? 0), n.seed)
          : undefined));
    this.world.cargo.restoreAll(snap.canisters);
    this.ordnance.restoreAll(snap.missiles, (i) => this.world.npcs[i] ?? null);

    this.encounterTimers = { ...snap.encounterTimers };
    restoreState(this.dockPlan as unknown as Record<string, unknown>, snap.dockPlan);
    restoreState(
      this.combatComputer.state as unknown as Record<string, unknown>, snap.combatComputer);
    this.lastThreat = snap.lastThreat as PirateThreat | null;
    this.ecmDetectedTimer = snap.ecmDetectedTimer;
    this.chart.targetIndex = snap.chartTarget;
    [this.chart.cursorX, this.chart.cursorY] = snap.chartCursor;
    this.market = structuredClone(snap.market) as MarketEntry[];
    this.hermitMarket = structuredClone(snap.hermitMarket) as MarketEntry[];
    this.contractOffers = structuredClone(snap.contractOffers) as Contract[];
    this.targetLock = snap.targetLock >= 0 ? (this.world.npcs[snap.targetLock] ?? null) : null;
    this.missileArmed = snap.missileArmed;
    this.world.station.quaternion.set(...snap.stationQuat);
    this.world.station.updateMatrixWorld(true);
    this.baseMode = snap.mode;
    this.screens.exit();
    if (snap.mode === 'docked') this.enterDocked(true);
    else hideScreen();

    // LAST: anything above that spawns or builds draws from the stream
    restoreRng(snap.rng);
  }

  /**
   * Write the world down. Cheap enough to do on a timer, because the whole
   * point is that closing the tab mid-fight is not punished.
   */
  private autoSave(): void {
    if (this.mode === 'dead') return;
    saveCommander(this.commander);
    try {
      saveWorld(JSON.stringify(this.captureSnapshot()));
    } catch {
      // a world that will not serialise is a bug, but it must never take the
      // session down — the commander save above is already safe
    }
  }

  /**
   * Pick up exactly where the last session stopped, mid-flight if that is
   * where it was.
   *
   * @returns false if there was nothing to resume, so the caller boots
   * normally at the station.
   */
  private resumeSavedWorld(): boolean {
    const json = readWorld();
    if (!json) return false;
    try {
      const snap = JSON.parse(json) as WorldSnapshot;
      if (snap.version !== SNAPSHOT_VERSION) return false;
      if (snap.commander.name !== this.commander.name) return false; // different career
      this.restoreSnapshot(snap);
      if (snap.mode === 'flight') {
        this.hud.showMessage('RESUMING FLIGHT', 3);
      }
      return true;
    } catch {
      // a corrupt or stale world must never cost you the commander
      clearWorld();
      return false;
    }
  }


  /** @internal — driven by test/playtest.js */
  launch(): void {
    const n = this.slotNormal();
    this.player.position.copy(this.world.station.position).addScaledVector(n, 450);
    this.lookAlong(n);
    this.player.speed = 120;
    this.baseMode = 'flight';
    this.view = 0;
    hideScreen();
    this.populateSystem('launch');
    sfx.launch();
    sfx.tunnel();
    this.tunnel.start(1.4, 'out'); // and opens again on the way out
    this.hud.showMessage(`LEAVING ${this.system.name.toUpperCase()} STATION`, 3);
  }

  /** @internal — driven by test/playtest.js */
  lookAlong(dir: THREE.Vector3): void {
    // Matrix4.lookAt uses camera convention: -Z (our nose) points at target.
    this.tmpM.lookAt(ZERO, dir, UP);
    this.player.quaternion.setFromRotationMatrix(this.tmpM);
  }

  /** World-space outward normal of the station's slot face. */
  private slotNormal(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.world.station.quaternion);
  }

  private die(reason: string): void {
    if (this.mode === 'dead' || this.mode === 'docked') return;
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

  /** @internal — driven by test/playtest.js */
  acceptContract(): void {
    const k = this.contractOffers[this.contractSelected];
    if (!k) return;
    if (this.commander.contracts.length >= MAX_CONTRACTS) {
      this.hud.showMessage('YOU ARE CARRYING ENOUGH WORK ALREADY', 3);
      sfx.beep(220);
      return;
    }
    if (k.kind === 'cargo') {
      if (cargoTonnes(this.commander) + k.qty > cargoCapacity(this.commander)) {
        this.hud.showMessage('NOT ENOUGH HOLD SPACE FOR THAT CONSIGNMENT', 3);
        sfx.beep(220);
        return;
      }
      this.commander.cargo[k.commodity] += k.qty;
    }
    this.commander.contracts.push(k);
    this.contractOffers.splice(this.contractSelected, 1);
    this.contractSelected = Math.max(0, this.contractSelected - 1);
    this.hud.showMessage(`ACCEPTED: ${describeContract(k, this.systems).toUpperCase()}`, 4);
    sfx.beep(900, 0.1);
  }

  /** Pay out anything delivered here; drop anything overdue. */
  /** @internal — driven by test/playtest.js */
  settleContracts(): void {
    const c = this.commander;
    const kept: Contract[] = [];
    for (const k of c.contracts) {
      const here = k.destination === c.systemIndex;
      const late = c.day > k.deadlineDay;
      if (here && !late && (k.kind !== 'bounty' || k.progress >= k.qty)) {
        if (k.kind === 'cargo') {
          // the consignment must still be aboard
          if (c.cargo[k.commodity] < k.qty) {
            this.hud.showMessage('CONSIGNMENT INCOMPLETE — CONTRACT VOID', 5);
            continue;
          }
          c.cargo[k.commodity] -= k.qty;
        }
        c.credits += k.reward;
        this.hud.showMessage(`CONTRACT PAID: ${formatCredits(k.reward)}`, 5);
        sfx.beep(1100, 0.15);
        continue;
      }
      if (late) {
        this.hud.showMessage('CONTRACT EXPIRED', 4);
        sfx.beep(220, 0.2);
        continue;
      }
      kept.push(k);
    }
    c.contracts = kept;
  }

  // --- missions ------------------------------------------------------------

  private missionText(): string {
    // contracts first — they're the everyday work
    const k = this.commander.contracts[0];
    if (k) {
      const more = this.commander.contracts.length - 1;
      return `${describeContract(k, this.systems).toUpperCase()}` +
        ` — ${k.deadlineDay - this.commander.day} DAYS` +
        (more > 0 ? ` (+${more} MORE)` : '');
    }
    return missionHeadline(this.commander, this.systems);
  }

  /** Advance the Navy mission on docking, and say so. */
  private checkMissionAtDock(): void {
    for (const e of stepMissionAtDock(this.commander, this.systems)) {
      if (e.kind === 'briefed') this.hud.showMessage('INCOMING NAVY TRANSMISSION', 5);
      else if (e.kind === 'courierOrders') {
        this.hud.showMessage('NAVY: COURIER RUN — EXPECT THARGOID INTERFERENCE', 6);
      } else if (e.kind === 'delivered') {
        this.hud.showMessage(
          `PLANS DELIVERED — ${formatCredits(e.payment)}, RIGHT ON COMMANDER`, 6);
      }
    }
  }



  /** @internal — driven by test/playtest.js */
  startHyperspace(): void {
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

  /** Direction the current view faces, in world space. */
  private viewDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1)
      .applyQuaternion(VIEW_QUATS[this.view])
      .applyQuaternion(this.player.quaternion);
  }

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
    const station = this.world.station;
    if (this.player.position.distanceTo(station.position) > DEFENCE_RANGE) return;
    this.defenceLaunched = true;
    const slotN = this.tmp.set(0, 0, -1).applyQuaternion(station.quaternion);
    const count = 1 + randomInt(2);
    for (let i = 0; i < count; i++) {
      const pos = station.position.clone()
        .addScaledVector(slotN, 500 + i * 120)
        .add(randomDirection(new THREE.Vector3()).multiplyScalar(80));
      const viper = this.world.spawn('police', pos, i);
      // launched specifically for you, so this one IS your business
      viper.provoked = true;
      viper.provokedByPlayer = true;
    }
    this.hud.showMessage('STATION DEFENCE LAUNCHED', 4);
    sfx.beep(300, 0.18);
  }

  /** @internal — driven by test/playtest.js */
  fireLaser(): void {
    this.applyCombat(this.combat.fire(
      this.commander, this.sys, this.player.position, this.viewDir(this.tmp),
      this.view, this.witchspace, this.combatScratch));
  }

  /** Destruction credited to the player. @internal — driven by test/playtest.js */
  destroyNpc(npc: NpcShip): void {
    this.applyCombat(this.combat.destroy(this.commander, npc));
  }

  /** Removal with no credit — an NPC-vs-NPC kill, or a collision. */
  private wreckNpc(npc: NpcShip): void {
    this.applyCombat(this.combat.wreck(npc));
  }

  /** @internal — driven by test/playtest.js */
  applyPlayerDamage(amount: number, from: THREE.Vector3): void {
    this.hud.flashDamage();
    this.applyCombat(this.combat.hitPlayer(
      this.sys, amount, from, this.player.position, this.player.quaternion,
      this.combatScratch));
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

  /** Trumbles breed and eat; heat drives them out. Rules in trumbles.ts. */
  private updateTrumbles(dt: number): void {
    const r = stepTrumbles(this.commander, dt, this.cabinTemp, this.trumbleTimer);
    this.trumbleTimer = r.timer;
    for (const e of r.events) {
      const secs = e.kind === 'purged' ? 5 : e.kind === 'fleeing' ? 1.5 : e.kind === 'ate' ? 4 : 2;
      this.hud.showMessage(trumbleMessage(e), secs);
      if (e.kind === 'ate') sfx.beep(500, 0.1);
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

  // --- docking -------------------------------------------------------------

  /**
   * Are we down, bounced, or clear? The geometry is docking.ts's; what it
   * costs is ours.
   */
  private checkStation(): void {
    const station = this.world.station;
    const outcome = dockingOutcome(
      this.player.position, this.player.quaternion, station, this.world.stationDockZ,
      { v: this.tmp, q: this.tmpQ, r: this.tmp2 });
    if (outcome === 'clear') return;
    if (outcome === 'docked') {
      this.enterDocked();
      return;
    }
    // hit the hull, or fluffed the slot
    const away = this.tmp2.copy(this.player.position).sub(station.position).normalize();
    this.player.position.copy(station.position).addScaledVector(away, 420);
    this.player.speed = 0;
    this.applyPlayerDamage(0.9, station.position);
    this.hud.showMessage(
      outcome === 'slotMiss' ? 'DOCKING FAILURE — MATCH SLOT ROTATION' : 'COLLISION', 3);
  }

  private dockingComputer(): void {
    if (!this.commander.equipment.dockingComputer) {
      this.hud.showMessage('NO DOCKING COMPUTER FITTED', 3);
      sfx.beep(220);
      return;
    }
    const dist = this.player.position.distanceTo(this.world.station.position);
    if (dist > 3500) {
      this.hud.showMessage('STATION OUT OF RANGE', 3);
      sfx.beep(220);
      return;
    }
    // Fly it in, rather than teleporting. Uses the same primitive the traders
    // do (game/docking.ts) — the hard part is roll, and it is the same problem
    // for both. Press C again, or touch the controls, to take over.
    this.dcEngaged = !this.dcEngaged;
    this.dockPlan.phase = 'gate'; // fresh approach each time it's engaged
    this.hud.showMessage(
      this.dcEngaged ? 'DOCKING COMPUTER ENGAGED' : 'DOCKING COMPUTER OFF', 2);
    if (this.dcEngaged) {
      sfx.beep(700, 0.12);
      sfx.dockingMusic(); // the C64 tradition, synthesised — see audio.ts
    } else {
      sfx.stopDockingMusic();
    }
  }

  /**
   * One frame of the docking computer. Steers and throttles only — the actual
   * docking is still decided by checkStation()'s slot and roll test, exactly
   * as it is when you fly in by hand. The autopilot has to genuinely thread
   * the letterbox; it gets no dispensation.
   */
  private dockingComputerStep(dt: number): void {
    if (this.input.held(...manualFlightKeys()) ||
        Math.abs(this.input.mouseX) > 0.15 || Math.abs(this.input.mouseY) > 0.15) {
      this.dcEngaged = false;
      sfx.stopDockingMusic();
      this.hud.showMessage('MANUAL OVERRIDE', 2);
      return;
    }
    const station = this.world.station;
    const plan = planDocking(
      this.player.position, station, this.world.stationDockZ, this.player.maxSpeed, this.dockPlan);
    this.tmpM.lookAt(ZERO, plan.heading, plan.up);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    this.player.quaternion.rotateTowards(this.tmpQ, 1.2 * dt);
    this.player.speed += (plan.speed - this.player.speed) * Math.min(1, dt * 1.5);
  }

  /** @internal — driven by test/playtest.js */
  toggleCombatComputer(): void {
    if (!this.commander.equipment.combatComputer) {
      this.hud.showMessage('NO COMBAT COMPUTER FITTED', 3);
      sfx.beep(220);
      return;
    }
    if (this.ccEngaged) {
      this.ccEngaged = false;
      this.hud.showMessage('COMBAT COMPUTER OFF', 2);
      return;
    }
    if (!hostilesNear(this.world.npcs, this.player.position, this.commander.legalStatus)) {
      this.hud.showMessage('NO HOSTILES — COMBAT COMPUTER IDLE', 3);
      sfx.beep(220);
      return;
    }
    this.ccEngaged = true;
    this.view = 0; // it aims the front laser
    this.hud.showMessage('COMBAT COMPUTER ENGAGED — ANY FLIGHT KEY OVERRIDES', 4);
    sfx.beep(1000, 0.12);
  }

  /**
   * The jameson-defend policy flies the player's ship (at the trader-Cobra
   * dynamics it trained in). Manual flight input disengages instantly.
   */
  /**
   * One frame of the combat computer. The policy decides how to fly; the Game
   * applies it and pulls the trigger, because firing has consequences an
   * autopilot has no business deciding.
   */
  private combatComputerStep(dt: number): void {
    const manual = this.input.held(...manualFlightKeys())
      || Math.abs(this.input.mouseX) > 0.15 || Math.abs(this.input.mouseY) > 0.15;
    const step = this.combatComputer.step(
      dt, this.player, this.sys, this.world.npcs, this.commander.legalStatus, manual, DEFEND_BRAIN);
    if (step.kind === 'disengage') {
      this.ccEngaged = false;
      this.hud.showMessage(step.reason, step.reason === 'MANUAL OVERRIDE' ? 2 : 3);
      return;
    }
    const d = step.demand;
    if (d.throttle > 0) this.player.speed = Math.min(CC_MAX_SPEED, this.player.speed + CC_ACCEL * dt);
    if (d.throttle < 0) this.player.speed = Math.max(0, this.player.speed - CC_ACCEL * dt);
    if (d.rollRate !== 0) {
      this.player.quaternion.multiply(this.tmpQ.setFromAxisAngle(AXIS_Z_CC, d.rollRate * dt));
    }
    if (d.pitchRate !== 0) {
      this.player.quaternion.multiply(this.tmpQ.setFromAxisAngle(AXIS_X_CC, d.pitchRate * dt));
    }
    if (d.fire) this.fireLaser();
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
    if (!this.commander.equipment.galacticDrive) {
      this.hud.showMessage('NO GALACTIC HYPERDRIVE FITTED', 3);
      sfx.beep(220);
      return;
    }
    const from = this.system;
    this.commander.equipment.galacticDrive = false;
    this.commander.galaxy = (this.commander.galaxy % 8) + 1;
    this.systems = generateGalaxy(this.commander.galaxy);
    // you arrive at whichever system in the new galaxy sits nearest the
    // coordinates you left from
    this.commander.systemIndex = nearestSystemTo(from, this.systems).index;
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(`GALAXY ${this.commander.galaxy} — ${this.system.name.toUpperCase()}`, 5);
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
    this.render.composer.render();
    this.renderHud(dt);
  }

  /**
   * One frame of flight, in five phases. Each is a method so the loop reads as
   * an order of operations rather than a wall — and the order matters: ships
   * move before they are separated, are separated before they are billed, and
   * the player's systems recharge after everything that could have damaged
   * them.
   */
  private updateFlight(dt: number, elapsed: number): void {
    this.flyPlayer(dt, elapsed);
    this.stepNpcs(dt);
    this.stepProjectilesAndEffects(dt);
    if (this.stepShipSystems(dt)) return;   // died in the attempt
    this.checkHazards();
  }

  /** The player's own motion: manual, autopilot, or torus. */
  private flyPlayer(dt: number, elapsed: number): void {
    this.player.update(dt, this.input);
    if (this.ccEngaged) this.combatComputerStep(dt);
    if (this.dcEngaged) this.dockingComputerStep(dt);

    // torus drive
    if (this.torusEngaged) {
      if (this.massLocked()) {
        this.torusEngaged = false;
        this.hud.showMessage('MASS LOCK — TORUS DISENGAGED', 3);
        sfx.beep(300);
      } else {
        this.player.position.addScaledVector(this.player.getForward(this.tmp), this.player.speed * 7 * dt);
      }
    }

    this.world.update(dt, elapsed);
    // hand the dust our actual velocity so it can streak — the torus drive
    // multiplies our travel by 8, and that is what makes the stars smear
    this.dust.update(
      this.player.position,
      this.player.getForward(this.tmp)
        .multiplyScalar(this.player.speed * (this.torusEngaged && !this.massLocked() ? 8 : 1)),
    );

  }

  /** Everyone else: decisions, despawns, collisions, and who else turns up. */
  private stepNpcs(dt: number): void {
    // periodic NPC-vs-NPC targeting: pirates prey on traders, the law hunts pirates
    this.npcTargetTimer -= dt;
    if (this.npcTargetTimer <= 0) {
      this.npcTargetTimer = 2;
      assignNpcTargets(this.world.npcs, this.player.position, this.commander.legalStatus);
    }

    // Snapshot: despawns and destructions below rebuild this.world.npcs, and the
    // fleet handed to update() should be consistent for every ship in the
    // frame rather than shrinking underneath the loop.
    for (const npc of [...this.world.npcs]) {
      const event = npc.update(dt, this.player, this.commander.legalStatus,
        this.world.station, this.world.npcs, this.world.stationDockZ);
      if (event) this.resolveNpcFire(npc, event);

      if (npc.wantsDespawn) {
        // A ship that JUMPED OUT gets the witch-flash. A ship that DOCKED gets
        // nothing: it flew into the slot, which is not an event that emits
        // particles. It used to get a smaller, paler burst from the same
        // explosion system, and from outside that is indistinguishable from
        // watching it blow up — reported as exactly that, by someone watching
        // a trader line up perfectly and then apparently detonate.
        if (!npc.docked) {
          this.world.effects.explosion(npc.object.position.clone(), 0x9adfff,
            { count: 10, speed: 120, duration: 0.7 });
        }
        this.world.despawn(npc);
        continue;
      }

    }

    // Ships are solid. The geometry lives in collisions.ts; what it costs is
    // decided here, because the price is not symmetric — the player's shields
    // absorb a ram, two NPCs bumping must not credit the player with anything,
    // and bouncing off the station is free.
    for (const npc of playerVsNpcs(
      this.player.position, (k) => { this.player.speed *= k; }, this.world.npcs, this.scratch)) {
      this.applyPlayerDamage(RAM_DAMAGE, npc.object.position);
      this.hud.showMessage('COLLISION', 2);
      if (npc.takeDamage(RAM_DAMAGE, this.player.position, true)) this.destroyNpc(npc);
    }

    const wrecked: NpcShip[] = [];
    for (const [a, b] of npcVsNpcs(this.world.npcs, this.scratch)) {
      const aPos = a.object.position.clone();
      if (a.takeDamage(RAM_DAMAGE, b.object.position, false)) wrecked.push(a);
      if (b.takeDamage(RAM_DAMAGE, aPos, false)) wrecked.push(b);
    }
    // wreckNpc, NOT destroyNpc — see npcVsNpcs
    for (const n of wrecked) this.wreckNpc(n);

    npcsVsStation(this.world.npcs, this.world.station, this.world.stationDockZ + 40, this.scratch);

    // What turns up, and when: rules in encounters.ts, spawning here.
    for (const order of stepEncounters(this.encounterTimers, dt, {
      witchspace: this.witchspace,
      productivity: this.system.productivity,
      government: this.system.government,
      traderCount: this.world.npcs.filter((n) => n.role === 'trader').length,
      activeThargons: this.world.npcs.filter((n) => n.alive && n.role === 'thargon' && !n.inert).length,
      hasThargoidMother: this.world.npcs.some((n) => n.alive && n.role === 'thargoid'),
      playerFarFromStation:
        this.player.position.distanceTo(this.world.station.position) > AMBUSH_STANDOFF,
    })) {
      if (order.kind === 'trader') {
        spawnArrivingTrader(this.world, TRADER_ARRIVAL_RANGE);
      } else if (order.kind === 'pirateWave') {
        for (let i = 0; i < order.count; i++) {
          this.world.spawn('pirate',
            this.player.position.clone().add(randomDirection(new THREE.Vector3())
              .multiplyScalar(9000 + random() * 4000)),
            i + randomInt(4));
        }
        this.hud.showMessage('PIRATE SIGNATURES DETECTED', 4);
      } else {
        const mother = this.world.npcs.find((n) => n.alive && n.role === 'thargoid')!;
        this.world.spawn('thargon',
          mother.object.position.clone().add(
            randomDirection(new THREE.Vector3()).multiplyScalar(150)),
          randomInt(8));
      }
    }

  }

  /** Cargo, missiles, and the things that are only ever seen. */
  private stepProjectilesAndEffects(dt: number): void {
    // The field drifts them and says what we reached; what it is worth is
    // ours to decide, because it touches the hold, legal status and damage.
    for (const { canister: c } of this.world.cargo.update(dt, this.player.position)) {
      if (!this.commander.equipment.scoops) {
        this.applyPlayerDamage(0.06, c.object.position);
        this.hud.showMessage('CANISTER DESTROYED ON HULL', 2);
      } else if (cargoTonnes(this.commander) >= cargoCapacity(this.commander)) {
        this.hud.showMessage(
          c.kind === 'capsule' ? 'HOLD FULL — CAPSULE LOST' : 'HOLD FULL — CANISTER LOST', 3);
      } else if (c.kind === 'capsule') {
        // A person, not stock. See CommanderData.survivors — this was
        // `cargo[3] += 1` and commodity 3 is Slaves, so rescuing someone made
        // you a smuggler and the next police scan made you an Offender.
        this.commander.survivors += 1;
        this.hud.showMessage('SURVIVOR ABOARD', 4);
        sfx.beep(600, 0.12);
      } else {
        this.commander.cargo[c.commodity] += 1;
        this.hud.showMessage(`SCOOPED 1t ${COMMODITIES[c.commodity].name.toUpperCase()}`, 3);
        sfx.beep(950, 0.08);
      }
    }
    this.updateEncounters();

    this.applyOrdnance(dt);
    this.world.effects.update(dt);

  }

  /**
   * The commander's own ship: guns, recharge, heat, and the warnings that go
   * with them. @returns true if the frame ended in death.
   */
  private stepShipSystems(dt: number): boolean {
    // laser + systems
    if (this.input.held(...keymap().fire) || this.input.mouseFire) this.fireLaser();
    regenerate(this.sys, dt, { energyUnit: this.commander.equipment.energyUnit });

    const sunDist = this.player.position.distanceTo(this.world.sunPos);
    if (updateCabinTemp(this.sys, dt, sunDist)) {
      this.die('CABIN TEMPERATURE CRITICAL');
      return true;
    }
    const scooped = scoopFuel(
      dt, sunDist, this.commander.equipment.scoops, this.commander.fuel, MAX_FUEL);
    if (scooped > 0) {
      this.commander.fuel += scooped;
      this.hud.showMessage('FUEL SCOOPING', 0.4);
    }

    this.autoSaveTimer -= dt;
    if (this.autoSaveTimer <= 0) {
      this.autoSaveTimer = AUTOSAVE_INTERVAL;
      this.autoSave();
    }

    if (this.ecmDetectedTimer > 0) this.ecmDetectedTimer -= dt;
    this.updateTrumbles(dt);

    if (this.beaconTimer > 0) {
      this.beaconTimer -= dt;
      if (this.beaconTimer <= 0) this.completeRescue();
    } else if (this.witchspace && this.commander.fuel < 10 && this.beaconTimer < 0) {
      this.strandedHintTimer -= dt;
      if (this.strandedHintTimer <= 0) {
        this.strandedHintTimer = 8;
        this.hud.showMessage('NO FUEL TO JUMP — PRESS B FOR THE DISTRESS BEACON', 5);
      }
    }

    // flashing low-energy warning
    if (this.energy < 1) {
      this.energyLowTimer -= dt;
      if (this.energyLowTimer <= 0) {
        this.energyLowTimer = 1.2;
        this.hud.showMessage('ENERGY LOW', 0.6);
        sfx.beep(320, 0.1);
      }
    }

    // police scan for illegal cargo
    if (!this.policeScanned && !this.witchspace) {
      if (carryingContraband(this.commander.cargo)) {
        const policeNear = this.world.npcs.some((n) =>
          n.alive && n.role === 'police' &&
          n.object.position.distanceTo(this.player.position) < SCAN_RANGE);
        if (policeNear) {
          this.policeScanned = true;
          this.raiseLegal(1);
          this.hud.showMessage('POLICE SCAN: CONTRABAND DETECTED', 4);
        }
      }
    }

    // hyperspace countdown
    if (this.hyperCountdown >= 0) {
      const prev = Math.ceil(this.hyperCountdown);
      this.hyperCountdown -= dt;
      const now = Math.ceil(this.hyperCountdown);
      if (now !== prev && now > 0) {
        this.hud.showMessage(`HYPERSPACE IN ${now}`, 1.2);
        sfx.beep(700 + (5 - now) * 100, 0.07);
      }
      if (this.hyperCountdown <= 0) {
        this.hyperCountdown = -1;
        this.completeHyperspace();
        return true;
      }
    }

    return this.mode !== 'flight';
  }

  /** Ground, sun and station — the ways a leg ends without a countdown. */
  private checkHazards(): void {
    const sunDist = this.player.position.distanceTo(this.world.sunPos);
    const altitude =
      this.player.position.distanceTo(this.world.planetPos) - this.world.planetRadius;
    if (altitude < 80) {
      this.die('CRASHED INTO THE PLANET');
      return;
    }
    if (sunDist < SUN_KILL_DIST) {
      this.die('FLEW INTO THE SUN');
      return;
    }
    this.checkStation();

    if (this.targetLock && !this.targetLock.alive) this.targetLock = null;
    this.updateMissileLock();
  }

  /** Rock hermits offer trade; generation ships offer only awe. */
  private updateEncounters(): void {
    for (const npc of this.world.npcs) {
      if (!npc.alive) continue;
      const dist = npc.object.position.distanceTo(this.player.position);
      if (npc.role === 'hermit') {
        // must leave and come back before trading again, or you'd be stuck
        // in a docking loop while parked alongside
        if (dist > 900) this.hermitCooldown = false;
        if (dist < 900 && !this.hermitCooldown) {
          this.hud.showMessage('ROCK HERMIT — SLOW TO 20 AND CLOSE TO TRADE', 2);
        }
        if (dist < 320 && this.player.speed < 40 && this.mode === 'flight' && !this.hermitCooldown) {
          this.openHermitTrade();
        }
      } else if (npc.role === 'generation' && dist < 6000 && !this.genShipSeen) {
        this.genShipSeen = true;
        this.hud.showMessage('DERELICT GENERATION SHIP — NO LIFE SIGNS', 6);
        sfx.beep(140, 0.5);
      }
    }
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


  private resolveNpcFire(npc: NpcShip, event: FireEvent): void {
    if (event.at === 'player') {
      // The SHIP chose the weapon (npc.ts chooseWeapon); we only apply it.
      if (event.weapon === 'missile') {
        this.enemyLaunchMissile(npc);
        return;
      }
      const dist = npc.object.position.distanceTo(this.player.position);
      sfx.enemyLaser();
      const hit = random() < npcHitChance(dist);
      // visible bolt: to us on a hit, wide of us on a miss
      const to = hit
        ? this.player.position.clone()
        : this.player.position.clone().add(
            randomDirection(new THREE.Vector3()).multiplyScalar(80 + random() * 140));
      this.world.effects.tracer(
        npc.nosePosition(this.tmp).clone(), to,
        npc.role === 'thargoid' || npc.role === 'thargon' ? 0xd05cff : 0xff5c40, 0.22);
      if (hit) this.applyPlayerDamage(npcShotDamage(random()), npc.object.position);
      return;
    }
    // NPC shooting NPC
    const target = event.at;
    this.world.effects.tracer(
      npc.nosePosition(this.tmp).clone(), target.object.position.clone(), 0xffaa55, 0.18);
    if (random() < NPC_VS_NPC_HIT) {
      if (target.takeDamage(NPC_VS_NPC_DAMAGE, npc.object.position)) {
        this.wreckNpc(target); // no player credit
      }
    }
  }


  /** @internal — driven by test/playtest.js */
  massLocked(): boolean {
    if (this.player.position.distanceTo(this.world.station.position) < 5000) return true;
    if (this.player.position.distanceTo(this.world.planetPos) - this.world.planetRadius < 4000) return true;
    for (const npc of this.world.npcs) {
      if (npc.alive && npc.role !== 'asteroid' &&
          npc.object.position.distanceTo(this.player.position) < 4500) return true;
    }
    return false;
  }

  // --- input ---------------------------------------------------------------

  private handleInput(dt: number): void {
    const i = this.input;
    // ? toggles the controls guide (plain / is the classic decelerate key)
    if (i.pressed('Question')) {
      document.getElementById('help')!.classList.toggle('hidden');
    }

    // The host runs the menu cursor and gives the frame to the top screen.
    // Every overlay has migrated to the Screen contract, so if one is open it
    // handles the frame and we are done — what is left below is the three
    // states that are NOT screens.
    if (this.screens.update(i, dt)) return;

    if (this.mode === 'docked') this.handleDockedKeys(i);
    else if (this.mode === 'flight') this.handleFlightKeys(i);
    else if (this.mode === 'dead') this.handleDeadKeys(i);
  }

  /** The station menu: trade, outfit, take work, and leave. */
  private handleDockedKeys(i: Input): void {
    // the erase-your-career confirmation swallows every other key
    if (this.pendingNewGame) {
      if (i.pressed('KeyY')) this.newCommanderGame();
      else if (i.pressed('KeyX')) this.exportSave(); // back it up first
      else if (i.pressed('Escape') || i.pressed('KeyQ')) {
        this.pendingNewGame = false;
        renderDockedMenu(this.system, this.commander, this.missionText());
      }
      return;
    }
    if (i.pressed('KeyL')) this.launch();
    else if (i.pressed('KeyM')) {
      this.screens.open('market');
    } else if (i.pressed('KeyC')) {
      this.screens.open('contracts');
    } else if (i.pressed('KeyE')) {
      this.screens.open('equip');
    // Q, not a shifted N. ⇧N shared a key with the local chart, and
    // cancelling the confirm with N while still holding shift re-opened it
    // on the very next tap — you could get stuck in a loop you couldn't
    // type your way out of. A destructive action should not share a key
    // with anything, modifier or not.
    } else if (i.pressed('KeyQ')) {
      this.pendingNewGame = true;
      renderNewGameConfirm(this.system, this.commander);
    }
    else if (i.pressed('KeyH')) this.screens.open('briefing');
    else if (i.pressed('KeyS')) this.openSaves();
    else if (i.pressed('KeyN')) this.openLocalChart('docked');
    else if (i.pressed('KeyG')) this.openChart('docked');
    else if (i.pressed('KeyI')) this.openStatus('docked');
    // The menu has advertised "D DATA ON SYSTEM" all along with nothing
    // behind it while docked — the only KeyD handlers were on the charts
    // and the save screen. Reports the system you are standing on.
    else if (i.pressed('KeyD')) this.openSystemData(this.system, 'docked');
    else if (i.pressed('KeyX')) this.exportSave();
    else if (i.pressed('KeyZ')) this.importSave();
    else if (i.pressed('KeyB')) {
      const layout = toggleLayout();
      this.hud.showMessage(`KEYBOARD: ${layout.toUpperCase()} LAYOUT`, 3);
      renderDockedMenu(this.system, this.commander, this.missionText());
    }
  }

  /** The cockpit: views, weapons, the ship's computers, and the charts. */
  private handleFlightKeys(i: Input): void {
    for (let v = 0; v < 4; v++) {
      if (i.pressed(`Digit${v + 1}`)) this.setView(v);
    }
    if (i.pressed('KeyG')) this.openChart('flight');
    else if (i.pressed('KeyN')) this.openLocalChart('flight');
    else if (i.pressed('KeyI')) this.openStatus('flight');
    else if (i.pressed('KeyT')) this.armMissile();
    else if (i.pressed('KeyM')) this.launchMissile();
    else if (i.pressed('KeyU')) {
      if (this.targetLock || this.missileArmed) {
        this.targetLock = null;
        this.missileArmed = false;
        this.hud.showMessage('MISSILE DISARMED', 2);
        sfx.beep(500, 0.06);
      }
    } else if (i.pressed('KeyE')) this.triggerEcm();
    else if (i.pressed('KeyK')) this.toggleCombatComputer();
    else if (i.pressed('KeyV')) {
      if (this.input.mouseFlight) {
        this.input.releaseMouseFlight();
        this.hud.showMessage('MOUSE FLIGHT OFF', 2);
      } else {
        this.input.requestMouseFlight();
        this.hud.showMessage('MOUSE FLIGHT — ESC OR V TO RELEASE', 4);
      }
    }
    else if (i.pressed('Tab')) this.detonateEnergyBomb();
    else if (i.pressed('KeyC')) this.dockingComputer();
    else if (i.pressed('KeyH')) {
      if (i.held('ShiftLeft', 'ShiftRight')) this.galacticJump();
      else this.startHyperspace();
    }
    else if (i.pressed('KeyB')) this.sendDistressBeacon();
    else if (i.pressed('KeyY')) this.jettisonCargo(i.held('ShiftLeft', 'ShiftRight') ? 5 : 1);
    else if (i.pressed('KeyJ')) {
      if (this.massLocked()) {
        this.hud.showMessage('MASS LOCKED', 2);
        sfx.beep(220);
      } else {
        this.torusEngaged = !this.torusEngaged;
        // Engaging the drive opens the throttle. Nobody engages a jump
        // drive in order to crawl, and having to hold the accelerator
        // afterwards was busywork with one sensible answer.
        if (this.torusEngaged) this.player.speed = this.player.maxSpeed;
        this.hud.showMessage(this.torusEngaged ? 'TORUS DRIVE ENGAGED' : 'TORUS DRIVE OFF', 2);
        if (this.torusEngaged) sfx.beep(1000, 0.15);
      }
    }
  }

  /** The only key that matters after you have been destroyed. */
  private handleDeadKeys(i: Input): void {
if (i.pressed('Enter')) this.respawn();
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
  private handleScreenClick(e: MouseEvent): void {
    // The host owns all of it: data-key becomes a keystroke so a click and the
    // printed shortcut take exactly the same path, data-row goes to the top
    // screen's select(), and anything else — a chart canvas — reaches its
    // clickAt() with the raw event so it can map pixels to its own space.
    const el = (e.target as HTMLElement).closest('[data-key],[data-row]') as HTMLElement | null;
    this.screens.click(el ?? (e.target as HTMLElement), this.input, e);
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
  private showBaseScreen(): void {
    if (this.baseMode === 'docked') {
      renderDockedMenu(this.system, this.commander, this.missionText());
    } else {
      hideScreen();
    }
  }



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
    const el = document.getElementById('crosshair');
    if (!el) return;
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
    el.classList.toggle('locked', on);
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
      rollFrac: this.player.rollRate / 2.0,
      pitchFrac: this.player.pitchRate / 1.1,
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
