// The orchestrator. Game owns the mode state machine (docked | flight |
// market | chart | local | equip | status | dead), routes input per mode,
// steps the world and every NPC, and resolves all consequences: NPCs *ask*
// to fire (FireEvent) and this file rolls the dice, draws tracers, applies
// damage, pays bounties and escalates legal status. Screens (ui/screens.ts)
// and the HUD (hud/hud.ts) are pure renderers fed from here.
// `window.__game` exposes the instance for the autopilot test harness
// (docs/JAMESON-TRIALS.md, train/jameson-autopilot.js) and console poking.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { generateGalaxy, generateMarket, COMMODITIES, type MarketEntry, type StarSystem } from '../galaxy/galaxy';
import { LivingGalaxy } from '../galaxy/living';
import { generateContractOffers, pirateThreat, markOf, memberTier, type PirateThreat } from './contracts';
import { buildSystemScene, type SystemScene } from '../world/system-scene';
import { createStarfield, SpaceDust } from '../world/starfield';
import { buildShip, MISSILE, CANISTER } from '../ships/geometry';
import { PlayerShip } from '../player';
import { Input } from '../engine/input';
import { keymap, layoutName, toggleLayout, manualFlightKeys, refreshHelpPanel } from '../engine/keymap';
import { Hud, SCANNER_RANGE, type ScannerContact, type ScreenTarget } from '../hud/hud';
import { TunnelEffect } from '../hud/tunnel';
import { sfx } from '../audio';
import { NpcShip, Explosion, Tracer, CONSTRICTOR_SPEC, isHostileToPlayer, pirateSpecForTier, DEFEND_BRAIN, type NpcRole, type FireEvent } from './npc';
import { act, observe, makeScratch, type ObservableShip } from '../sim/policy';
import { planDocking, makeDockPlan } from './docking';
import {
  SavesScreen, NamingScreen, exportCommanderFile, importCommanderFile, startNewCommander,
  type SavesContext,
} from './screens/saves';
import {
  MarketScreen, EquipScreen, buyEquipment, makeLocalMarket, type TradeContext,
} from './screens/trade';
import { StatusScreen, type StatusContext } from './screens/status';
import { DataScreen, type DataContext } from './screens/data';
import { BriefingScreen } from './screens/briefing';
import { ContractsScreen, type ContractsContext } from './screens/contracts';
import { ScreenHost } from '../ui/screen-host';
import {
  daysForJump, nearestSystemTo, witchspaceChance, WITCHSPACE_ESCAPE_COST,
} from '../galaxy/navigation';
/**
 * Player gunnery: a real ray against the hull, plus a small graze tolerance.
 *
 * The old test was purely angular — `atan(radius * k / dist)` — where `radius`
 * is the hull's *maximum* extent, so the cone circumscribes the ship. That
 * grants hits on empty space beside a thin hull and, worse, makes every ship a
 * sphere: an Anaconda is no easier to hit down its 110-unit flank than
 * head-on, which is not what the player sees.
 *
 * So: cast the shot at the actual hull mesh first. GRAZE is then a genuine
 * aim-assist dial rather than a shape approximation — the beam has width, and
 * a shot that just clips the silhouette still counts.
 *
 * NOT shared with the sim, and deliberately so: sim/core.ts models NPC
 * gunnery, which stays the cone both sides use. The player's own gun is never
 * simulated in training, so this can't break parity (invariant 2).
 *
 * 0.9, raised from 0.35, because the ships you most want to shoot out-turn
 * you. A Sidewinder pitches and rolls at 106% of the player's rates, an Asp
 * 116%, a Viper 126% — they are SUPPOSED to weave, and that is the fight
 * working. At 0.35 the tolerance was the central 12% of a hull's area, so a
 * target doing its job correctly was close to unhittable.
 *
 * Measured rather than guessed, against a weaving pirate with 200ms of
 * reaction lag standing in for a human:
 *
 *              0.35            0.9
 *   tier 1     12% acc, 230    33% acc, 85 shots, killed 5 of 5
 *   tier 0      6% acc          7%
 *
 * The Sidewinder barely moves, and that is the honest limit of this dial: it
 * is small AND more agile than you, so its defence is tracking rather than
 * tolerance. Widening further would start granting hits on empty space.
 */
/**
 * Playtesting cheat: `window.__cheat = true` fits anything from the catalogue
 * anywhere, free and regardless of tech level. Deliberately a console handle
 * like `__scriptedPirates` and `__packBrain` rather than a key binding — it is
 * a development tool, and nobody should reach it by accident.
 */
function cheatMode(): boolean {
  return !!(window as unknown as Record<string, unknown>).__cheat;
}

const LASER_GRAZE = 0.9;

/**
 * Grazing radius for drifting cargo, in world units. Canisters are ~12 units
 * across, so an exact ray needs 1.4 degrees of accuracy at 500m and they felt
 * unhittable. They're not a skill target the way a fighter is — shooting one
 * is a deliberate act — so they get a flat, generous tolerance instead of the
 * silhouette-proportional one ships get.
 */
const CANISTER_GRAZE = 20;

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
const AIM_ASSIST = 0.035;
/** Depth in camera space at which the cockpit beams converge. */
const BEAM_Z = 2.6;
const ASSIST_FADE_START = 900;
const ASSIST_FADE_END = 2400;

/** The assist allowance at a given range, in radians. */
function assistAt(dist: number): number {
  if (dist <= ASSIST_FADE_START) return AIM_ASSIST;
  if (dist >= ASSIST_FADE_END) return 0;
  return AIM_ASSIST * (1 - (dist - ASSIST_FADE_START) / (ASSIST_FADE_END - ASSIST_FADE_START));
}

/**
 * Where the sight sits, as a fraction of canvas height. The cockpit console
 * covers the bottom ~22%, so the centre of what you can actually see is above
 * the middle of the canvas. The camera projection is shifted to match (see
 * resize), so this moves the gun axis and the crosshair together.
 */
const SIGHT_Y = 0.42;
import {
  loadCommander, saveCommander, formatCredits, MAX_FUEL,
  cargoCapacity, cargoTonnes, LEGAL_NAMES, ILLEGAL_GOODS, TRUMBLE_PURGE_TEMP, killValue,
  type CommanderData, type LaserType, type Contract,
} from './commander';
import {
  hideScreen, renderDockedMenu, renderNewGameConfirm, renderChart, drawChart,
  renderLocalChart, drawLocalChart, renderMarketEstimate,
  renderGameOver, renderContracts, describeContract, nearestSystem,
  distanceTenths, chartCoordsFromClick, localCoordsFromClick, LOCAL_SCALE, type ChartState,
} from '../ui/screens';

type Mode = 'docked' | 'flight' | 'market' | 'chart' | 'local' | 'equip' | 'status' | 'data' | 'contracts' | 'saves' | 'naming' | 'briefing' | 'dead';

const LASER_RANGE = 3500;
const LASERS: Record<LaserType, { damage: number; cooldown: number; heat: number }> = {
  pulse: { damage: 0.16, cooldown: 0.24, heat: 0.055 },
  beam: { damage: 0.13, cooldown: 0.09, heat: 0.035 },
  military: { damage: 0.25, cooldown: 0.09, heat: 0.03 },
};
const MISSILE_SPEED = 700;
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

const SUN_HEAT_START = 110_000; // cabin temp begins to climb
const SUN_SCOOP_RANGE = 80_000; // fuel scoops gather inside this
const SUN_HEAT_MAX = 26_000;    // cabin temp reaches 1.0 (death follows)
const SUN_KILL_DIST = 21_000;   // instant death
const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X_CC = new THREE.Vector3(1, 0, 0);
const AXIS_Z_CC = new THREE.Vector3(0, 0, 1);

// view quaternions: front, rear, left, right (yaw about ship Y)
const VIEW_QUATS = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((a) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));

interface Missile {
  object: THREE.Object3D;
  /** null → hostile missile homing on the player. */
  target: NpcShip | null;
  life: number;
}

interface Canister {
  object: THREE.Object3D;
  /** commodity index for cargo; ignored for capsules */
  commodity: number;
  kind: 'cargo' | 'capsule';
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
}

// Fields the autonomous playtest agent (test/playtest.js) reads or drives
// are public rather than private; they are otherwise internal.
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 1_000_000);

  systems: StarSystem[];
  commander: CommanderData;
  /** level-1 simulation: trade flowing between all 256 systems */
  readonly living: LivingGalaxy;
  world!: SystemScene;
  npcs: NpcShip[] = [];
  private explosions: Explosion[] = [];
  private missiles: Missile[] = [];

  readonly player: PlayerShip;
  readonly input = new Input();
  private readonly hud = new Hud();
  private readonly tunnel = new TunnelEffect();

  /**
   * Where the SHIP is. Flight, docked, or dead — the states that are not
   * screens. Overlays live on the screen stack; `mode` is the two combined.
   */
  private baseMode: 'docked' | 'flight' | 'dead' = 'docked';

  /**
   * The screen stack. Single source of truth for which overlay is open, and
   * for what Escape returns to — it replaced both `mode`'s overlay values and
   * the one-deep `dataReturn` hack that existed for the system-data screen.
   */
  readonly screens = new ScreenHost(
    () => this.showBaseScreen(),
    (id) => this.repaintLegacyScreen(id),
  );

  /**
   * What is on screen: the top overlay, or the base state when there is none.
   * DERIVED — assign `baseMode` or push/pop the stack instead.
   */
  get mode(): Mode {
    return (this.screens.topId ?? this.baseMode) as Mode;
  }

  readonly chart: ChartState = { cursorX: 0, cursorY: 0, targetIndex: null };
  market: MarketEntry[] = [];

  private tracers: Tracer[] = [];

  targetLock: NpcShip | null = null;
  /** missile armed but not yet locked (the original's yellow pylon) */
  missileArmed = false;
  private hyperCountdown = -1;
  torusEngaged = false;
  witchspace = false;
  private view = 0; // 0 front, 1 rear, 2 left, 3 right
  cabinTemp = 0;
  canisters: Canister[] = [];
  private thargonTimer = 0;
  private npcTargetTimer = 0;
  private traderSpawnTimer = 30;
  private pirateWaveTimer = 60;
  private energyLowTimer = 0;
  private policeScanned = false;
  /** the station only scrambles its defence fleet once per visit */
  defenceLaunched = false;
  /** trading with a rock hermit rather than a station */
  hermitTrading = false;
  private hermitMarket: MarketEntry[] = [];
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
  /** the reception the current system laid on — surfaced for the HUD/tests */
  lastThreat: PirateThreat | null = null;
  /** cargo value dumped this encounter, tenths of a credit — resets on arrival */
  jettisonedValue = 0;
  /** what the hold was worth on arrival — sets what the pirates think they're owed */
  arrivalCargoValue = 0;
  hermitCooldown = false;
  genShipSeen = false;
  trumbleTimer = 20;
  /** seconds until a rescue answers the distress beacon (-1 = not sent) */
  beaconTimer = -1;
  private strandedHintTimer = 2;
  contractOffers: Contract[] = [];
  /**
   * Selected contract row. A property because it lives on ContractsScreen now,
   * and test/playtest.js assigns it before calling acceptContract().
   */
  /** @internal — driven by test/playtest.js */
  get contractSelected(): number { return this.contracts_.selected; }
  set contractSelected(v: number) { this.contracts_.selected = v; }
  private chartFind: string | null = null;
  private paused = false;
  private chartEstimate = false;
  /** where ESC returns to from the DATA ON screen */
  private ecmDetectedTimer = 0; // console 'E' dwell
  // combat computer: the jameson-defend policy flying the player's ship
  ccEngaged = false;
  private ccPitch = 0;
  private ccRoll = 0;
  private ccTimer = 0;
  private ccControl: { pitch: number; roll: number; throttle: number; fire: boolean } | null = null;
  private static readonly ccObs = new Float32Array(18);
  private static readonly ccScratch = makeScratch();
  private static readonly ccMe = {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 0,
    cls: { maxSpeed: 220, turnRate: 0.5 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
  };
  private static readonly ccTarget = {
    pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 280,
    cls: { maxSpeed: 300, turnRate: 1.1 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0,
  };

  foreShield = 1;
  aftShield = 1;
  energy = 4;
  laserTemp = 0;
  laserCooldown = 0;
  private beamTimer = 0;
  private readonly beams: THREE.LineSegments;

  private readonly dust = new SpaceDust();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  /** reused for player gunnery — see LASER_GRAZE */
  private readonly shotRay = new THREE.Raycaster();
  /** docking computer flying the ship in — see dockingComputerStep */
  dcEngaged = false;
  private readonly dockPlan = makeDockPlan();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    // No logarithmic depth buffer: it would defeat the polygonOffset trick
    // that keeps hull fills behind wireframe edges.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.15));
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.commander = loadCommander();
    this.systems = generateGalaxy(this.commander.galaxy);
    this.living = new LivingGalaxy(this.systems);
    this.living.load(this.commander.galaxyState);
    // catch the galaxy up if this save has been away a while
    if (this.living.day < this.commander.day) {
      this.living.advance(
        Math.min(60, this.commander.day - this.living.day),
        COMMODITIES.map((c) => c.gradient));
    }

    this.scene.add(createStarfield());
    this.scene.add(this.dust.points, this.dust.streaks);
    this.scene.add(this.camera);

    // Cockpit laser beams, drawn in camera space. They converge ON THE CAMERA
    // AXIS (0, 0, -z) because that is where the shot goes and where the
    // crosshair sits. They previously met at y = +0.21 at z = -2.6 —
    // atan(0.21/2.6) = 4.6 degrees high — which lined them up with the old
    // mis-placed crosshair (#crosshair was top: 42%, not 50%). With the sight
    // corrected the beams had to come down to match.
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.85, -0.75, -1.2, 0, 0, -BEAM_Z,
      0.85, -0.75, -1.2, 0, 0, -BEAM_Z,
    ], 3));
    this.beams = new THREE.LineSegments(
      beamGeo,
      new THREE.LineBasicMaterial({ color: 0xd8ffcc, transparent: true, opacity: 0.9 }),
    );
    this.beams.frustumCulled = false;
    this.beams.visible = false;
    this.camera.add(this.beams);

    this.player = new PlayerShip(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    this.buildWorld();
    this.enterDocked(true);
    refreshHelpPanel();
    this.hud.showMessage(
      `PRESS ? FOR CONTROLS — ${layoutName().toUpperCase()} LAYOUT (B TO SWITCH)`, 8);

    // all screens accept mouse input; the listener lives on the persistent
    // overlay container, since screen contents are re-rendered wholesale
    document.getElementById('screen')!.addEventListener('click', (e) => this.handleScreenClick(e));

    // test-harness handle: the Jameson autopilot (train/jameson-autopilot.js,
    // docs/JAMESON-TRIALS.md) drives the whole game through this
    (window as unknown as Record<string, unknown>).__game = this;

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
    ]) this.screens.register(screen);

    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.update(dt, now / 1000);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Lift the gun axis to SIGHT_Y before building the projection: the console
    // eats the bottom of the screen, so the eye's centre is above the canvas
    // centre. setViewOffset shifts the frustum (a lens shift) rather than the
    // sight, which keeps the crosshair, the beams and the shot on one axis —
    // moving the *crosshair* up instead is what put the sight 4.6 degrees
    // above the shot for so long.
    // +lift: the view window starts BELOW the virtual image top, which pushes
    // the frustum centre up the screen. (Negative moves it down — measured.)
    const lift = (0.5 - SIGHT_Y) * h;
    this.camera.setViewOffset(w, h, 0, lift, w, h);
    this.camera.updateProjectionMatrix();
    this.hud.resizeOverlay(w, h);

    // Draw the sight to the assist envelope, so the circle means something:
    // a target inside it is a target the shot will reach for. Derived from the
    // real projection rather than picked by eye, so it stays honest if the
    // fov or the assist angle ever change.
    const pxPerRad = (h / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
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
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
    }
    this.clearNpcs();
    for (const e of this.explosions) {
      this.scene.remove(e.object);
      e.dispose();
    }
    this.explosions = [];
    for (const t of this.tracers) {
      this.scene.remove(t.object);
      t.dispose();
    }
    this.tracers = [];
    this.clearCanisters();
    this.world = buildSystemScene(this.system);
    this.scene.add(this.world.root);
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
    this.world.planet.mesh.position.set(1e8, 1e8, 0);
    this.world.station.position.set(1e8, -1e8, 0);
    this.world.sun.group.position.set(-1e8, 1e8, 0);
    this.player.position.set(0, 0, 0);
    this.player.speed = 200;
    const n = 2 + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.spawnNpc('thargoid',
        new THREE.Vector3().randomDirection().multiplyScalar(3500 + Math.random() * 2500), i);
    }
    this.thargonTimer = 4;
    sfx.hyperspace();
    this.tunnel.start(1.1);
    this.hud.showMessage('WITCH-SPACE — THARGOID AMBUSH', 6);
  }

  private clearNpcs(): void {
    for (const n of this.npcs) this.scene.remove(n.object);
    for (const m of this.missiles) this.scene.remove(m.object);
    this.npcs = [];
    this.missiles = [];
    this.targetLock = null;
  }

  /** @internal — driven by test/playtest.js */
  spawnNpc(
    role: NpcRole,
    position: THREE.Vector3,
    seed: number,
    specOverride?: typeof CONSTRICTOR_SPEC,
  ): NpcShip {
    const npc = new NpcShip(role, position, seed, specOverride);
    this.npcs.push(npc);
    this.scene.add(npc.object);
    return npc;
  }

  private clearCanisters(): void {
    for (const c of this.canisters) this.scene.remove(c.object);
    this.canisters = [];
  }

  private spawnCanisters(at: THREE.Vector3, count: number, commodities: number[]): void {
    for (let i = 0; i < count; i++) {
      const object = buildShip(CANISTER, 0x8ad0ff);
      object.position.copy(at).add(new THREE.Vector3().randomDirection().multiplyScalar(20 + i * 15));
      this.canisters.push({
        object,
        kind: 'cargo',
        commodity: commodities[Math.floor(Math.random() * commodities.length)],
        velocity: new THREE.Vector3().randomDirection().multiplyScalar(15 + Math.random() * 30),
        spinAxis: new THREE.Vector3().randomDirection(),
      });
      this.scene.add(object);
    }
  }

  /**
   * "Most wily traders, and many pirates, have this device fitted" — a
   * destroyed ship may eject its crew, leaving cargo and equipment behind.
   * Scoop the capsule and the occupant becomes, regrettably, cargo.
   */
  private spawnEscapeCapsule(at: THREE.Vector3): void {
    const object = buildShip(CANISTER, 0xffd24d);
    object.scale.setScalar(0.8);
    object.position.copy(at);
    this.canisters.push({
      object,
      kind: 'capsule',
      commodity: 3, // slaves
      velocity: new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 30),
      spinAxis: new THREE.Vector3().randomDirection(),
    });
    this.scene.add(object);
    this.hud.showMessage('ESCAPE CAPSULE LAUNCHED', 3);
  }

  /** A fresh trader warps in at the system edge and heads for the station. */
  private spawnArrivingTrader(): void {
    const home = this.world.station.position;
    const pos = home.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(22000));
    const trader = this.spawnNpc('trader', pos, Math.floor(Math.random() * 100));
    trader.traderPhase = 'arriving';
    this.addExplosion(pos.clone(), 0x9adfff, { count: 10, speed: 120, duration: 0.7 }); // arrival flash
  }

  /**
   * Station space is policed: launching only meets legitimate traffic.
   * Arriving from hyperspace drops pirates along the corridor to the station.
   */
  private populateSystem(situation: 'launch' | 'arrival'): void {
    const sys = this.system;
    const home = this.world.station.position;
    const rnd = (range: number) =>
      new THREE.Vector3().randomDirection().multiplyScalar(range * (0.5 + Math.random()));

    // traders here are the convoys the living galaxy says are arriving
    const arrivals = this.living.imminentArrivals(sys.index);
    const traders = Math.max(1, Math.min(4, arrivals.length || (Math.random() < 0.5 ? 2 : 1)));
    for (let i = 0; i < traders; i++) {
      this.spawnNpc('trader', home.clone().add(rnd(1800)), i + sys.index);
    }
    const police = sys.government >= 2 ? 2 : sys.government >= 1 ? 1 : 0;
    for (let i = 0; i < police; i++) {
      this.spawnNpc('police', home.clone().add(rnd(1200)), i);
    }
    const rocks = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rocks; i++) {
      this.spawnNpc('asteroid', home.clone().add(rnd(5000)), sys.seed[0] + i * 37);
    }

    if (situation === 'arrival') {
      // pirate pressure: government lawlessness plus whatever the living
      // galaxy has recorded happening to convoys around here lately
      // Pirates are businesses: lawlessness and the living galaxy set how many
      // are out here, but what you're visibly worth sets who they are and
      // whether they bothered to organise.
      const threat = pirateThreat(
        sys,
        this.living.danger(sys.index),
        markOf(this.commander, this.living.notoriety(sys.index)),
      );
      this.lastThreat = threat;
      this.jettisonedValue = 0;
      this.arrivalCargoValue = markOf(this.commander).cargoValue;
      const pirates = threat.count;
      const toStation = home.clone().sub(this.player.position);
      const routeLen = toStation.length();
      const route = toStation.normalize();
      for (let i = 0; i < pirates; i++) {
        // scattered along the whole witchpoint→station corridor
        const along = routeLen * (0.1 + Math.random() * 0.75);
        const pos = this.player.position
          .clone()
          .addScaledVector(route, along)
          .add(rnd(2500));
        // ringleaders first, then the hangers-on they brought
        const mt = memberTier(threat.tier, i);
        const npc = this.spawnNpc('pirate', pos, i + sys.index * 3,
          pirateSpecForTier(mt, i + sys.index * 3));
        npc.organised = threat.organised;
        npc.threatTier = mt;
      }
    }

    // a lone bounty hunter is sometimes working the system
    if (Math.random() < (situation === 'arrival' ? 0.35 : 0.2)) {
      this.spawnNpc('hunter', home.clone().add(rnd(6000)), sys.index);
    }

    // a rock hermit hides out among the asteroids (homage to Oolite):
    // a hollowed-out rock that trades ore and asks no questions
    if (Math.random() < 0.3) {
      this.spawnNpc('hermit', home.clone().add(rnd(14000).addScaledVector(rnd(1), 2)), sys.index);
    }

    // very rarely, a generation ship crosses the system, still under way
    // after centuries, its hull shedding cargo
    if (situation === 'arrival' && Math.random() < 0.08) {
      const pos = this.player.position.clone()
        .add(new THREE.Vector3().randomDirection().multiplyScalar(14000 + Math.random() * 8000));
      const gen = this.spawnNpc('generation', pos, 0);
      gen.object.lookAt(home);
      this.spawnCanisters(pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(700)),
        3 + Math.floor(Math.random() * 4), [0, 1, 4, 8, 9, 12]);
      this.genShipSeen = false;
    }

    // mission: the Constrictor lurks at its last-known system
    const m = this.commander.mission;
    if (situation === 'arrival' && m.stage === 1 && m.targetIndex === this.commander.systemIndex) {
      const pos = this.player.position.clone().add(
        new THREE.Vector3().randomDirection().multiplyScalar(4000 + Math.random() * 4000));
      const constrictor = this.spawnNpc('pirate', pos, 0, CONSTRICTOR_SPEC);
      constrictor.isMissionTarget = true;
      this.hud.showMessage('SCANNER: UNREGISTERED PROTOTYPE DETECTED', 5);
    }
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, duration = 0.18): void {
    const t = new Tracer(from, to, color, duration);
    this.tracers.push(t);
    this.scene.add(t.object);
  }

  // --- mode transitions ----------------------------------------------------

  /** @internal — driven by test/playtest.js */
  enterDocked(booting = false): void {
    // whatever flew us in, we're down: drop the autopilot and cut the music
    this.dcEngaged = false;
    sfx.stopDockingMusic();
    this.baseMode = 'docked';
    this.baseMode = 'docked';
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
    if (this.commander.legalStatus > 0) {
      const fine = Math.min(this.commander.credits, this.commander.legalStatus >= 2 ? 750 : 250);
      this.commander.credits -= fine;
      this.commander.legalStatus = 0;
      this.hud.showMessage(`OFFENCE FINE PAID: ${formatCredits(fine)}`, 5);
    }
    this.policeScanned = false;
    this.defenceLaunched = false;
    this.view = 0;
    this.cabinTemp = 0;
    this.witchspace = false;
    this.beaconTimer = -1;
    this.clearCanisters();
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

  /** @internal — driven by test/playtest.js */
  launch(): void {
    const n = this.slotNormal();
    this.player.position.copy(this.world.station.position).addScaledVector(n, 450);
    this.lookAlong(n);
    this.player.speed = 120;
    this.baseMode = 'flight';
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
    sfx.explosion();
    this.addExplosion(this.player.position.clone(), 0xff8866);
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
    if (this.commander.contracts.length >= 3) {
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
    const m = this.commander.mission;
    if (m.stage === 1 && m.targetIndex !== null) {
      return `NAVY MISSION: DESTROY THE CONSTRICTOR — LAST SEEN AT ${this.systems[m.targetIndex].name.toUpperCase()}`;
    }
    if (m.stage === 3 && m.targetIndex !== null) {
      return `NAVY MISSION: DELIVER THE PLANS TO ${this.systems[m.targetIndex].name.toUpperCase()}`;
    }
    return '';
  }

  private checkMissionAtDock(): void {
    const m = this.commander.mission;
    if (m.stage === 0 && this.commander.kills >= 16 && this.commander.galaxy === 1) {
      m.targetIndex = this.pickMissionTarget(30, 80);
      if (m.targetIndex !== null) {
        m.stage = 1;
        this.hud.showMessage('INCOMING NAVY TRANSMISSION', 5);
      }
    } else if (m.stage === 2) {
      m.targetIndex = this.pickMissionTarget(50, 90);
      if (m.targetIndex !== null) {
        m.stage = 3;
        this.hud.showMessage('NAVY: COURIER RUN — EXPECT THARGOID INTERFERENCE', 6);
      }
    } else if (m.stage === 3 && m.targetIndex === this.commander.systemIndex) {
      m.stage = 4;
      m.targetIndex = null;
      this.commander.credits += 15000;
      this.hud.showMessage('PLANS DELIVERED — 1500.0 Cr, RIGHT ON COMMANDER', 6);
    }
  }

  private pickMissionTarget(minD: number, maxD: number): number | null {
    const candidates = this.systems.filter((s) => {
      const d = distanceTenths(this.system, s);
      return s.index !== this.commander.systemIndex && d >= minD && d <= maxD;
    });
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)].index;
  }

  /** @internal — driven by test/playtest.js */
  startHyperspace(): void {
    if (this.hyperCountdown >= 0) return;
    const t = this.chart.targetIndex;
    if (t === null || t === this.commander.systemIndex) {
      this.hud.showMessage('NO HYPERSPACE TARGET SET', 3);
      sfx.beep(220);
      return;
    }
    const cost = this.witchspace
      ? WITCHSPACE_ESCAPE_COST : distanceTenths(this.system, this.systems[t]);
    if (cost > this.commander.fuel) {
      this.hud.showMessage(
        this.witchspace ? 'INSUFFICIENT FUEL — STRANDED IN WITCH-SPACE' : 'TARGET OUT OF FUEL RANGE', 4);
      sfx.beep(220);
      return;
    }
    this.hyperCountdown = 5;
    this.hud.showMessage('HYPERSPACE IN 5', 1.2);
    sfx.beep(700, 0.07);
  }

  private completeHyperspace(): void {
    const t = this.chart.targetIndex!;
    if (this.witchspace) {
      // escaping the mis-jump costs a flat 1.0 LY
      this.commander.fuel -= Math.min(this.commander.fuel, WITCHSPACE_ESCAPE_COST);
    } else {
      this.commander.fuel -= distanceTenths(this.system, this.systems[t]);
      if (Math.random() < witchspaceChance(this.commander.mission.stage)) {
        this.enterWitchspace(); // target retained for the escape jump
        return;
      }
    }
    const daysPassed = daysForJump(distanceTenths(this.system, this.systems[t]));
    this.commander.day += daysPassed;
    this.living.advance(daysPassed, COMMODITIES.map((c) => c.gradient));
    this.commander.systemIndex = t;
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(`ARRIVED: ${this.system.name.toUpperCase()}`, 4);
  }

  /** @internal — driven by test/playtest.js */
  arriveInSystem(): void {
    this.witchspace = false; // any arrival leaves witch-space (incl. galactic jump)
    this.buildWorld();
    // Arrive at the witchpoint, well out — the classic long torus cruise in.
    // Bearing is biased to the station's side of the planet (~30° cone) so
    // the planet never blocks the run.
    const stationDir = this.world.station.position.clone().normalize();
    const dir = stationDir
      .add(new THREE.Vector3().randomDirection().multiplyScalar(0.5))
      .normalize();
    this.player.position.copy(dir.multiplyScalar(this.world.planetRadius * WITCHPOINT_RADII));
    this.lookAlong(this.tmp.copy(this.player.position).negate());
    this.player.speed = 250;
    this.policeScanned = false;
    this.traderSpawnTimer = 20 + Math.random() * 40;
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
    if (this.player.position.distanceTo(station.position) > 9000) return;
    this.defenceLaunched = true;
    const slotN = this.tmp.set(0, 0, -1).applyQuaternion(station.quaternion);
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const pos = station.position.clone()
        .addScaledVector(slotN, 500 + i * 120)
        .add(new THREE.Vector3().randomDirection().multiplyScalar(80));
      const viper = this.spawnNpc('police', pos, i);
      // launched specifically for you, so this one IS your business
      viper.provoked = true;
      viper.provokedByPlayer = true;
    }
    this.hud.showMessage('STATION DEFENCE LAUNCHED', 4);
    sfx.beep(300, 0.18);
  }

  /** @internal — driven by test/playtest.js */
  fireLaser(): void {
    // front mount carries the fitted laser; rear/left/right are pulse
    // lasers if purchased. Simplification vs the original: all mounts share
    // one cooldown/heat.
    let laser = LASERS[this.commander.equipment.laser];
    if (this.view === 1) {
      if (!this.commander.equipment.rearLaser) return;
      laser = LASERS.pulse;
    } else if (this.view === 2) {
      if (!this.commander.equipment.leftLaser) return;
      laser = LASERS.pulse;
    } else if (this.view === 3) {
      if (!this.commander.equipment.rightLaser) return;
      laser = LASERS.pulse;
    }
    if (this.laserCooldown > 0 || this.laserTemp >= 0.98) return;
    this.laserCooldown = laser.cooldown;
    this.laserTemp = Math.min(1, this.laserTemp + laser.heat);
    this.beamTimer = 0.12;
    sfx.laser();

    const forward = this.viewDir(this.tmp);
    let best: NpcShip | null = null;
    let bestDist = LASER_RANGE;

    // 1. the honest test: does the shot actually pass through the hull?
    this.shotRay.set(this.player.position, forward);
    this.shotRay.far = LASER_RANGE;
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const dist = npc.object.position.distanceTo(this.player.position);
      // cheap reject before touching triangles
      if (dist > bestDist + npc.radius) continue;
      // Raycaster reads matrixWorld, which three.js only refreshes during
      // render — without this the shot is tested against the ship's position
      // one frame ago, and against the ORIGIN for anything spawned this frame.
      npc.object.updateMatrixWorld(true);
      const hits = this.shotRay.intersectObject(npc.object, true);
      for (const h of hits) {
        if (h.distance < bestDist) {
          bestDist = h.distance;
          best = npc;
        }
      }
    }

    // Drifting cargo is solid too, and was in the same blind spot as the
    // station: canisters live in this.canisters, not this.npcs, so shots
    // passed straight through them and nothing happened at all.
    let hitCanister: (typeof this.canisters)[number] | null = null;
    for (const c of this.canisters) {
      c.object.updateMatrixWorld(true);
      for (const h of this.shotRay.intersectObject(c.object, true)) {
        if (h.distance < bestDist) {
          bestDist = h.distance;
          best = null;
          hitCanister = c;
        }
      }
    }

    // The station is solid too. Shooting it is a serious offence — GalCop
    // does not take kindly to it — and previously did nothing at all because
    // fireLaser only ever tested NPCs.
    let hitStation = false;
    if (!this.witchspace) {
      const st = this.world.station;
      st.updateMatrixWorld(true);
      for (const h of this.shotRay.intersectObject(st, true)) {
        if (h.distance < bestDist) {
          bestDist = h.distance;
          best = null;
          hitCanister = null;
          hitStation = true;
        }
      }
    }

    // 2. grazing shots: the beam has width, so a near-miss that clips the
    //    silhouette still counts. Only consulted if the ray missed everything.
    if (!best && !hitStation && !hitCanister) {
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > bestDist) continue;
        const cone = Math.max(0.012, Math.atan((npc.radius * LASER_GRAZE) / dist)) + assistAt(dist);
        if (forward.angleTo(to.normalize()) < cone) {
          best = npc;
          bestDist = dist;
        }
      }
      for (const c of this.canisters) {
        const to = this.tmp2.copy(c.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > bestDist) continue;
        const cone = Math.max(0.012, Math.atan(CANISTER_GRAZE / dist));
        if (forward.angleTo(to.normalize()) < cone) {
          best = null;
          hitCanister = c;
          bestDist = dist;
        }
      }
    }
    // Aim assist, the visible half: bend the cockpit beams onto whatever the
    // shot found. Chris's point — an allowance that silently counts a near
    // miss as a hit reads as a bug, where beams that visibly converge on the
    // target read as the gunsight doing its job. The shot has already been
    // resolved above; this only makes the resolution legible.
    this.aimBeams(best ? best.object.position : hitCanister ? hitCanister.object.position : null);

    if (hitCanister) {
      sfx.hit();
      this.addExplosion(hitCanister.object.position.clone(), 0x8ad0ff,
        { count: 10, speed: 55, duration: 0.4 });
      this.scene.remove(hitCanister.object);
      this.canisters = this.canisters.filter((x) => x !== hitCanister);
      if (hitCanister.kind === 'capsule') {
        // there is someone in that thing
        this.hud.showMessage('ESCAPE CAPSULE DESTROYED', 3);
        this.raiseLegal(2);
      } else {
        this.hud.showMessage('CARGO DESTROYED', 2);
      }
      return;
    }
    if (hitStation) {
      sfx.hit();
      // sparks off the hull, but the station itself shrugs it off
      const impact = this.player.position.clone().addScaledVector(forward, bestDist);
      this.addExplosion(impact, 0xd8ffcc, { count: 10, speed: 60, duration: 0.4 });
      this.hud.showMessage('STATION HULL HIT — DEFENCES SCRAMBLING', 3);
      // Offender, not fugitive: a stray shot while lining up a dock is easy to
      // make, and fugitive means every police ship in the galaxy hunts you
      // forever. The Vipers are the real punishment — and shooting *them*
      // escalates you to fugitive the normal way. raiseLegal launches them.
      this.raiseLegal(1);
      return;
    }
    if (best) {
      sfx.hit();
      // impact flash at the target so hits read clearly
      this.addExplosion(best.object.position.clone(), 0xd8ffcc, { count: 8, speed: 70, duration: 0.35 });
      if (best.role === 'police' || best.role === 'trader' || best.role === 'hunter') this.raiseLegal(1);
      if (best.takeDamage(laser.damage, this.player.position, true)) this.destroyNpc(best);
    }
  }

  /** Destruction credited to the player (bounty, kills, legal, mission). */
  /** @internal — driven by test/playtest.js */
  destroyNpc(npc: NpcShip): void {
    this.wreckNpc(npc);
    if (npc.role !== 'asteroid') {
      this.commander.kills += 1;
      // rating counts difficulty, not bodies: see killValue()
      this.commander.combatScore += killValue(npc.threatTier);
    }
    if (npc.role === 'pirate') {
      for (const k of this.commander.contracts) {
        if (k.kind === 'bounty' && k.destination === this.commander.systemIndex && k.progress < k.qty) {
          k.progress += 1;
          if (k.progress >= k.qty) this.hud.showMessage('BOUNTY CONTRACT COMPLETE — RETURN TO A STATION', 5);
        }
      }
    }
    if (npc.role === 'police' || npc.role === 'trader' || npc.role === 'hunter') this.raiseLegal(2);
    if (npc.bounty > 0) {
      this.commander.credits += npc.bounty;
      this.hud.showMessage(`BOUNTY: ${formatCredits(npc.bounty)}`, 3);
    }
    if (npc.role === 'asteroid' && this.commander.equipment.miningLaser) {
      this.spawnCanisters(npc.object.position, 1 + Math.floor(Math.random() * 3), [12, 12, 12, 13, 14]);
    }
    if (npc.isMissionTarget && this.commander.mission.stage === 1) {
      this.commander.mission.stage = 2;
      this.commander.mission.targetIndex = null;
      this.commander.credits += 25000;
      this.hud.showMessage('CONSTRICTOR DESTROYED — 2500.0 Cr NAVY BOUNTY', 6);
    }
  }

  /** Shared removal path (also used for NPC-vs-NPC kills — no player credit). */
  private wreckNpc(npc: NpcShip): void {
    this.addExplosion(npc.object.position.clone());
    sfx.explosion();
    this.scene.remove(npc.object);
    this.npcs = this.npcs.filter((n) => n !== npc);
    if (this.targetLock === npc) this.targetLock = null;
    // wily traders and many pirates punch out at the last moment
    if (npc.role === 'trader' || npc.role === 'pirate' || npc.role === 'hunter') {
      const chance = npc.role === 'trader' ? 0.45 : 0.2;
      if (Math.random() < chance) this.spawnEscapeCapsule(npc.object.position.clone());
    }
    if (npc.cargoDrop > 0) {
      this.spawnCanisters(
        npc.object.position,
        Math.floor(Math.random() * (npc.cargoDrop + 1)),
        [0, 1, 4, 8, 9, 11, 12], // food, textiles, liquor, machinery, alloys, furs, minerals
      );
    }
    if (npc.role === 'thargoid' && !this.npcs.some((n) => n.alive && n.role === 'thargoid')) {
      for (const t of this.npcs) {
        if (t.role === 'thargon') t.inert = true;
      }
      this.hud.showMessage('THARGONS DEACTIVATED', 3);
    }
  }

  private addExplosion(
    at: THREE.Vector3,
    color: THREE.ColorRepresentation = 0xffe9a8,
    opts?: { count?: number; speed?: number; duration?: number },
  ): void {
    const e = new Explosion(at, color, opts);
    this.explosions.push(e);
    this.scene.add(e.object);
  }

  /** T arms a missile; it locks itself when a target enters the sights. */
  private armMissile(): void {
    if (this.commander.missiles <= 0) {
      this.hud.showMessage('NO MISSILES', 2);
      sfx.beep(180);
      return;
    }
    if (this.targetLock) {
      this.hud.showMessage('ALREADY LOCKED — U TO UNARM', 2);
      return;
    }
    this.missileArmed = !this.missileArmed;
    this.hud.showMessage(this.missileArmed ? 'MISSILE ARMED' : 'MISSILE UNARMED', 2);
    sfx.beep(this.missileArmed ? 700 : 400, 0.08);
  }

  /** While armed, lock onto whatever enters the crosshairs. */
  private updateMissileLock(): void {
    if (!this.missileArmed || this.targetLock) return;
    const forward = this.viewDir(this.tmp);
    let best: NpcShip | null = null;
    let bestAngle = 0.09; // the crosshair region, tighter than the old snap
    for (const npc of this.npcs) {
      if (!npc.alive || npc.role === 'asteroid') continue;
      const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
      if (to.length() > 5500) continue;
      const angle = forward.angleTo(to.normalize());
      if (angle < bestAngle) {
        bestAngle = angle;
        best = npc;
      }
    }
    if (best) {
      this.targetLock = best;
      this.missileArmed = false;
      this.hud.showMessage('MISSILE LOCKED', 2);
      sfx.beep(1200, 0.12);
    }
  }

  private launchMissile(): void {
    if (this.commander.missiles <= 0) {
      sfx.beep(180);
      return;
    }
    if (!this.targetLock || !this.targetLock.alive) {
      this.hud.showMessage('NO TARGET LOCK', 2);
      sfx.beep(220);
      return;
    }
    this.commander.missiles -= 1;
    const obj = buildShip(MISSILE, 0xffd0a0);
    obj.position.copy(this.player.position).addScaledVector(this.player.getForward(this.tmp), 30);
    obj.quaternion.copy(this.player.quaternion);
    this.scene.add(obj);
    this.missiles.push({ object: obj, target: this.targetLock, life: 25 });
    this.targetLock = null;
    sfx.missile();
  }

  private updateMissiles(dt: number): void {
    for (const m of [...this.missiles]) {
      m.life -= dt;
      const dead = (m.target !== null && !m.target.alive) || m.life <= 0;
      if (dead) {
        this.removeMissile(m, true);
        continue;
      }
      const targetPos = m.target ? m.target.object.position : this.player.position;
      const dir = this.tmp.copy(targetPos).sub(m.object.position);
      const dist = dir.length();
      // ECM-equipped targets can fry an incoming missile
      if (m.target && m.target.hasEcm && dist < 2800 && Math.random() < dt * 0.45) {
        this.removeMissile(m, true);
        this.ecmDetectedTimer = 2;
        this.hud.showMessage('TARGET E.C.M. — MISSILE DESTROYED', 3);
        sfx.ecm();
        continue;
      }
      this.tmpM.lookAt(ZERO, dir, UP);
      this.tmpQ.setFromRotationMatrix(this.tmpM);
      m.object.quaternion.rotateTowards(this.tmpQ, 2.5 * dt);
      this.tmp.set(0, 0, -1).applyQuaternion(m.object.quaternion);
      m.object.position.addScaledVector(this.tmp, MISSILE_SPEED * dt);
      if (dist < 50) {
        const target = m.target;
        this.removeMissile(m, false);
        if (target) {
          target.takeDamage(99, undefined, true);
          this.destroyNpc(target);
        } else {
          this.addExplosion(m.object.position.clone(), 0xff8866);
          sfx.explosion();
          this.applyPlayerDamage(1.3, m.object.position);
        }
      }
    }
  }

  private removeMissile(m: Missile, withExplosion: boolean): void {
    if (withExplosion) this.addExplosion(m.object.position.clone(), 0xffb444, { count: 12, duration: 0.8 });
    this.scene.remove(m.object);
    this.missiles = this.missiles.filter((x) => x !== m);
  }

  /** ECM: fries every missile currently in flight, at an energy cost. */
  private triggerEcm(): void {
    if (!this.commander.equipment.ecm) {
      this.hud.showMessage('NO E.C.M. FITTED', 2);
      sfx.beep(220);
      return;
    }
    if (this.energy < 1) {
      sfx.beep(180);
      return;
    }
    this.energy -= 1;
    for (const m of [...this.missiles]) this.removeMissile(m, true);
    this.ecmDetectedTimer = 2;
    this.hud.showMessage('E.C.M. ACTIVATED', 2);
    sfx.ecm();
  }

  /** The Medusa Pandora: everything smaller than a station dies. */
  private detonateEnergyBomb(): void {
    if (!this.commander.equipment.energyBomb) {
      this.hud.showMessage('NO ENERGY BOMB FITTED', 3);
      sfx.beep(220);
      return;
    }
    this.commander.equipment.energyBomb = false;
    sfx.bomb();
    const flash = document.getElementById('bomb-flash')!;
    flash.classList.add('boom');
    void flash.offsetWidth;
    flash.classList.remove('boom');
    for (const npc of [...this.npcs]) {
      if (!npc.alive || npc.role === 'thargoid') continue; // thargoids shrug it off
      if (npc.object.position.distanceTo(this.player.position) > 8000) continue;
      npc.takeDamage(99, this.player.position);
      this.destroyNpc(npc);
    }
    for (const m of [...this.missiles]) this.removeMissile(m, true);
    this.hud.showMessage('ENERGY BOMB DETONATED', 4);
  }

  private enemyLaunchMissile(npc: NpcShip): void {
    npc.missiles -= 1;
    const obj = buildShip(MISSILE, 0xff9a8a);
    npc.nosePosition(this.tmp);
    obj.position.copy(this.tmp);
    obj.quaternion.copy(npc.object.quaternion);
    this.scene.add(obj);
    this.missiles.push({ object: obj, target: null, life: 30 });
    this.hud.showMessage('INCOMING MISSILE', 3);
    sfx.missile();
  }

  /** @internal — driven by test/playtest.js */
  applyPlayerDamage(amount: number, from: THREE.Vector3): void {
    this.tmp.copy(from).sub(this.player.position).applyQuaternion(this.tmpQ.copy(this.player.quaternion).invert());
    const fromFront = this.tmp.z < 0;
    let remaining = amount;
    if (fromFront) {
      const absorbed = Math.min(this.foreShield, remaining);
      this.foreShield -= absorbed;
      remaining -= absorbed;
    } else {
      const absorbed = Math.min(this.aftShield, remaining);
      this.aftShield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) {
      // shield was already down: energy takes it, and the hit may wreck
      // cargo or a fitting — "the ship's computer will keep you informed"
      this.energy -= remaining * 2;
      if (Math.random() < 0.25) this.damageSomething();
    }
    this.hud.flashDamage();
    sfx.damage();
    if (this.energy <= 0) this.die('SHIP DESTROYED');
  }

  /**
   * Trumbles breed exponentially and eat the hold. Cabin heat drives them
   * out — which means a sun-skim, the same manoeuvre that refuels you.
   */
  private updateTrumbles(dt: number): void {
    const c = this.commander;
    if (c.trumbles <= 0) return;

    if (this.cabinTemp > TRUMBLE_PURGE_TEMP) {
      this.trumbleTimer = 0;
      const before = c.trumbles;
      c.trumbles = Math.max(0, c.trumbles - Math.ceil(c.trumbles * dt));
      if (c.trumbles === 0) {
        this.hud.showMessage('THE LAST TRUMBLE FLEES THE HEAT. PEACE AT LAST.', 5);
      } else if (before !== c.trumbles) {
        this.hud.showMessage(`TRUMBLES FLEEING THE HEAT — ${c.trumbles} LEFT`, 1.5);
      }
      return;
    }

    this.trumbleTimer -= dt;
    if (this.trumbleTimer > 0) return;
    this.trumbleTimer = 20;
    c.trumbles = Math.min(999, Math.round(c.trumbles * 1.6) + 1);
    // they are always hungry
    const carried = c.cargo.map((qty, i) => ({ qty, i })).filter((x) => x.qty > 0);
    const appetite = Math.floor(c.trumbles / 8);
    if (appetite > 0 && carried.length) {
      const pick = carried[Math.floor(Math.random() * carried.length)];
      const eaten = Math.min(pick.qty, appetite);
      c.cargo[pick.i] -= eaten;
      this.hud.showMessage(
        `TRUMBLES (${c.trumbles}) ATE ${eaten}${COMMODITIES[pick.i].unit} ${COMMODITIES[pick.i].name.toUpperCase()}`, 4);
      sfx.beep(500, 0.1);
    } else if (c.trumbles > 4) {
      this.hud.showMessage(`TRUMBLES ABOARD: ${c.trumbles}`, 2);
    }
  }

  /** A hull hit destroys a tonne of cargo, or knocks out a fitting. */
  private damageSomething(): void {
    const e = this.commander.equipment;
    const carried = this.commander.cargo
      .map((qty, i) => ({ qty, i }))
      .filter((x) => x.qty > 0);
    // equipment is rarer to lose than cargo
    const fittings: { name: string; clear: () => void }[] = [];
    if (e.ecm) fittings.push({ name: 'E.C.M. SYSTEM', clear: () => { e.ecm = false; } });
    if (e.scoops) fittings.push({ name: 'FUEL SCOOPS', clear: () => { e.scoops = false; } });
    if (e.rearLaser) fittings.push({ name: 'REAR LASER', clear: () => { e.rearLaser = false; } });
    if (e.leftLaser) fittings.push({ name: 'LEFT LASER', clear: () => { e.leftLaser = false; } });
    if (e.rightLaser) fittings.push({ name: 'RIGHT LASER', clear: () => { e.rightLaser = false; } });
    if (e.dockingComputer) fittings.push({ name: 'DOCKING COMPUTER', clear: () => { e.dockingComputer = false; } });
    if (e.combatComputer) fittings.push({ name: 'COMBAT COMPUTER', clear: () => { e.combatComputer = false; } });

    if (carried.length && (!fittings.length || Math.random() < 0.7)) {
      const pick = carried[Math.floor(Math.random() * carried.length)];
      this.commander.cargo[pick.i] -= 1;
      this.hud.showMessage(`CARGO LOST: 1${COMMODITIES[pick.i].unit} ${COMMODITIES[pick.i].name.toUpperCase()}`, 3);
      sfx.beep(300, 0.12);
    } else if (fittings.length) {
      const pick = fittings[Math.floor(Math.random() * fittings.length)];
      pick.clear();
      if (this.ccEngaged) this.ccEngaged = false;
      this.hud.showMessage(`${pick.name} DESTROYED`, 4);
      sfx.beep(240, 0.2);
    }
  }

  // --- docking -------------------------------------------------------------

  private checkStation(): void {
    const station = this.world.station;
    const dockZ = this.world.stationDockZ;
    const box = dockZ + 45;
    const local = this.tmp.copy(this.player.position);
    station.worldToLocal(local);
    // deliberately cheap: an axis-aligned cube, slightly larger than the hull
    if (Math.abs(local.x) > box || Math.abs(local.y) > box || Math.abs(local.z) > box) return;

    // slot channel on the local -Z face; the visual slot is 96x20 but the
    // test is padded (124x52) as tolerance for the player's hull size
    const inSlot = local.z < -(dockZ - 60) && Math.abs(local.x) < 62 && Math.abs(local.y) < 26;
    if (inSlot) {
      // roll alignment: our wings vs the slot's long axis
      this.tmpQ.copy(station.quaternion).invert().multiply(this.player.quaternion);
      const right = this.tmp2.set(1, 0, 0).applyQuaternion(this.tmpQ);
      const rollOff = Math.atan2(Math.abs(right.y), Math.abs(right.x));
      if (rollOff < 0.65) {
        this.enterDocked();
        return;
      }
    }
    // hit the hull (or fluffed the slot)
    const away = this.tmp2.copy(this.player.position).sub(station.position).normalize();
    this.player.position.copy(station.position).addScaledVector(away, 420);
    this.player.speed = 0;
    this.applyPlayerDamage(0.9, station.position);
    this.hud.showMessage(inSlot ? 'DOCKING FAILURE — MATCH SLOT ROTATION' : 'COLLISION', 3);
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
    if (!this.hostilesNear()) {
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
  private combatComputerStep(dt: number): void {
    if (this.input.held(...manualFlightKeys()) ||
        Math.abs(this.input.mouseX) > 0.15 || Math.abs(this.input.mouseY) > 0.15) {
      this.ccEngaged = false;
      this.hud.showMessage('MANUAL OVERRIDE', 2);
      return;
    }
    let threat: NpcShip | null = null;
    let bestD = 6500;
    for (const npc of this.npcs) {
      if (!isHostileToPlayer(npc, this.commander.legalStatus)) continue;
      const d = npc.object.position.distanceTo(this.player.position);
      if (d < bestD) { bestD = d; threat = npc; }
    }
    if (!threat || !DEFEND_BRAIN) {
      this.ccEngaged = false;
      this.hud.showMessage('AREA CLEAR — COMBAT COMPUTER OFF', 3);
      return;
    }

    this.ccTimer -= dt;
    if (!this.ccControl || this.ccTimer <= 0) {
      this.ccTimer = 0.1;
      const me = Game.ccMe;
      const tv = Game.ccTarget;
      const p = this.player.position, q = this.player.quaternion;
      me.pos.x = p.x; me.pos.y = p.y; me.pos.z = p.z;
      me.quat.x = q.x; me.quat.y = q.y; me.quat.z = q.z; me.quat.w = q.w;
      me.speed = this.player.speed;
      me.laserTemp = this.laserTemp;
      me.laserCooldown = this.laserCooldown;
      me.pitchRate = this.ccPitch;
      me.rollRate = this.ccRoll;
      const tp = threat.object.position, tq = threat.object.quaternion;
      tv.pos.x = tp.x; tv.pos.y = tp.y; tv.pos.z = tp.z;
      tv.quat.x = tq.x; tv.quat.y = tq.y; tv.quat.z = tq.z; tv.quat.w = tq.w;
      this.ccControl = act(DEFEND_BRAIN,
        observe(me as ObservableShip, tv as ObservableShip, Game.ccObs), Game.ccScratch);
    }
    const c = this.ccControl;
    const maxPitch = 0.5 * 1.4, maxRoll = 0.5 * 2.4; // trader-Cobra caps (training match)
    const ramp = (cur: number, tgt: number, active: boolean): number => {
      const r = active ? 4.0 : 5.0;
      const nx = cur + (tgt - cur) * Math.min(1, r * dt);
      return Math.abs(nx) < 0.001 && !active ? 0 : nx;
    };
    this.ccPitch = ramp(this.ccPitch, c.pitch * maxPitch, c.pitch !== 0);
    this.ccRoll = ramp(this.ccRoll, c.roll * maxRoll, c.roll !== 0);
    if (c.throttle > 0) this.player.speed = Math.min(220, this.player.speed + 100 * dt);
    if (c.throttle < 0) this.player.speed = Math.max(0, this.player.speed - 100 * dt);
    if (this.ccRoll !== 0) this.player.quaternion.multiply(this.tmpQ.setFromAxisAngle(AXIS_Z_CC, this.ccRoll * dt));
    if (this.ccPitch !== 0) this.player.quaternion.multiply(this.tmpQ.setFromAxisAngle(AXIS_X_CC, this.ccPitch * dt));
    if (c.fire) this.fireLaser();
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
  update(dt: number, elapsed: number): void {
    // pause (flight only — everything else is inherently paused)
    if (this.mode === 'flight' && this.input.pressed('KeyP')) this.paused = !this.paused;
    if (this.mode !== 'flight') this.paused = false;
    if (this.paused) {
      this.hud.showMessage('PAUSED — P TO RESUME', 0.4);
      this.composer.render();
      this.renderHud(dt);
      this.input.endFrame();
      return;
    }
    if (!this.tunnel.active) this.handleInput(dt);
    else this.input.endFrame();
    this.tunnel.update(dt);

    if (this.mode === 'flight') {
      this.updateFlight(dt, elapsed);
    }

    if ((this.mode === 'chart' || this.mode === 'local') && this.chartFind === null && !this.chartEstimate) {
      this.updateChartCursor(dt);
    }

    this.camera.position.copy(this.player.position);
    this.camera.quaternion.copy(this.player.quaternion).multiply(VIEW_QUATS[this.view]);
    this.beamTimer -= dt;
    this.beams.visible = this.beamTimer > 0;
    this.composer.render();
    this.renderHud(dt);
    this.input.endFrame();
  }

  private updateFlight(dt: number, elapsed: number): void {
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

    // periodic NPC-vs-NPC targeting: pirates prey on traders, the law hunts pirates
    this.npcTargetTimer -= dt;
    if (this.npcTargetTimer <= 0) {
      this.npcTargetTimer = 2;
      this.assignNpcTargets();
    }

    // Snapshot: despawns and destructions below rebuild this.npcs, and the
    // fleet handed to update() should be consistent for every ship in the
    // frame rather than shrinking underneath the loop.
    for (const npc of [...this.npcs]) {
      const event = npc.update(dt, this.player, this.commander.legalStatus,
        this.world.station, this.npcs, this.world.stationDockZ);
      if (event) this.resolveNpcFire(npc, event);

      if (npc.wantsDespawn) {
        // A ship that JUMPED OUT gets the witch-flash. A ship that DOCKED gets
        // nothing: it flew into the slot, which is not an event that emits
        // particles. It used to get a smaller, paler burst from the same
        // explosion system, and from outside that is indistinguishable from
        // watching it blow up — reported as exactly that, by someone watching
        // a trader line up perfectly and then apparently detonate.
        if (!npc.docked) {
          this.addExplosion(npc.object.position.clone(), 0x9adfff,
            { count: 10, speed: 120, duration: 0.7 });
        }
        this.scene.remove(npc.object);
        this.npcs = this.npcs.filter((n) => n !== npc);
        continue;
      }

      // ramming: ships are solid
      if (npc.alive) {
        const gap = npc.object.position.distanceTo(this.player.position);
        if (gap < npc.radius + 25) {
          const away = this.tmp2.copy(this.player.position).sub(npc.object.position).normalize();
          this.player.position.copy(npc.object.position).addScaledVector(away, npc.radius + 120);
          this.player.speed *= 0.3;
          this.applyPlayerDamage(0.45, npc.object.position);
          this.hud.showMessage('COLLISION', 2);
          if (npc.takeDamage(0.45, this.player.position, true)) this.destroyNpc(npc);
        }
      }
    }

    // ...and solid to each other, not just to the player. Without this, ships
    // visibly fly through one another in a dogfight. Mirrors the sim's
    // pirate-vs-pirate rule (resolveCollision in sim/core.ts): symmetric,
    // because neither party has the player's shields.
    // Snapshot the list: wrecking a ship rebuilds this.npcs, and mutating it
    // mid-loop would shift the indices we're iterating.
    const fleet = this.npcs;
    const wrecked: NpcShip[] = [];
    for (let i = 0; i < fleet.length; i++) {
      const a = fleet[i];
      if (!a.alive || a.inert || a.role === 'hermit' || a.role === 'generation') continue;
      for (let j = i + 1; j < fleet.length; j++) {
        const b = fleet[j];
        if (!b.alive || b.inert || b.role === 'hermit' || b.role === 'generation') continue;
        const contact = a.radius + b.radius;
        const gap = a.object.position.distanceTo(b.object.position);
        if (gap >= contact) continue;
        // shove them apart around their midpoint, then bill them both
        this.tmp2.copy(a.object.position).sub(b.object.position);
        if (this.tmp2.lengthSq() < 1e-6) this.tmp2.set(1, 0, 0);
        this.tmp2.normalize();
        this.tmp3.copy(a.object.position).add(b.object.position).multiplyScalar(0.5);
        const push = (contact + 40) / 2;
        a.object.position.copy(this.tmp3).addScaledVector(this.tmp2, push);
        b.object.position.copy(this.tmp3).addScaledVector(this.tmp2, -push);
        a.speed *= 0.3;
        b.speed *= 0.3;
        const aPos = a.object.position.clone();
        // wreckNpc, NOT destroyNpc: two NPCs colliding has nothing to do with
        // the player. destroyNpc credits kills, pays the bounty and — the part
        // that actually bit — calls raiseLegal(2) when the casualty is a
        // trader, police or bounty hunter. Two ships in a dogfight bumping
        // into each other was making the player a FUGITIVE and scrambling the
        // station's Vipers at them, for something they had no part in.
        if (a.takeDamage(0.45, b.object.position, false)) wrecked.push(a);
        if (b.takeDamage(0.45, aPos, false)) wrecked.push(b);
      }
    }
    for (const n of wrecked) this.wreckNpc(n);

    // ...and solid to the station, which they were flying straight through.
    // A bounce only, deliberately: damaging them here would kill traffic at
    // random right outside the docking slot, and the problem being fixed is
    // that ships visibly passed through the hull.
    const stn = this.world.station;
    const stBox = this.world.stationDockZ + 40;
    for (const npc of fleet) {
      if (!npc.alive || npc.inert || npc.role === 'hermit') continue;
      if (npc.docking) continue; // a trader on final approach is *meant* to go in
      const local = this.tmp2.copy(npc.object.position);
      stn.worldToLocal(local);
      if (Math.abs(local.x) > stBox || Math.abs(local.y) > stBox || Math.abs(local.z) > stBox) continue;
      this.tmp3.copy(npc.object.position).sub(stn.position);
      if (this.tmp3.lengthSq() < 1e-6) this.tmp3.set(0, 1, 0);
      npc.object.position.copy(stn.position)
        .addScaledVector(this.tmp3.normalize(), stBox + npc.radius);
      npc.speed *= 0.4;
    }

    // occasional new trader arriving from deep space keeps the lanes alive —
    // busier at productive systems (the living-galaxy Level-1 hook)
    if (!this.witchspace) {
      this.traderSpawnTimer -= dt;
      if (this.traderSpawnTimer <= 0) {
        const busyness = Math.min(50, this.system.productivity / 1200); // 0..50s discount
        this.traderSpawnTimer = 100 - busyness + Math.random() * 60;
        if (this.npcs.filter((n) => n.role === 'trader').length < 4) this.spawnArrivingTrader();
      }

      // piracy pressure scales with lawlessness: anarchies breed pirate waves
      this.pirateWaveTimer -= dt;
      if (this.pirateWaveTimer <= 0) {
        const gov = this.system.government;
        this.pirateWaveTimer = 60 + gov * 40 + Math.random() * 90;
        const farFromStation =
          this.player.position.distanceTo(this.world.station.position) > 7000;
        if (gov <= 3 && farFromStation) {
          const n = gov <= 1 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            this.spawnNpc('pirate',
              this.player.position.clone().add(
                new THREE.Vector3().randomDirection().multiplyScalar(9000 + Math.random() * 4000)),
              i + Math.floor(Math.random() * 4));
          }
          this.hud.showMessage('PIRATE SIGNATURES DETECTED', 4);
        }
      }
    }

    // Thargoid motherships deploy Thargon drones
    if (this.npcs.some((n) => n.alive && n.role === 'thargoid')) {
      this.thargonTimer -= dt;
      const thargons = this.npcs.filter((n) => n.alive && n.role === 'thargon' && !n.inert).length;
      if (this.thargonTimer <= 0 && thargons < 4) {
        this.thargonTimer = 5;
        const mother = this.npcs.find((n) => n.alive && n.role === 'thargoid')!;
        this.spawnNpc('thargon',
          mother.object.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(150)),
          Math.floor(Math.random() * 8));
      }
    }

    this.updateCanisters(dt);
    this.updateEncounters();

    this.updateMissiles(dt);
    this.explosions = this.explosions.filter((e) => {
      if (e.update(dt)) return true;
      this.scene.remove(e.object);
      e.dispose();
      return false;
    });
    this.tracers = this.tracers.filter((t) => {
      if (t.update(dt)) return true;
      this.scene.remove(t.object);
      t.dispose();
      return false;
    });

    // laser + systems
    if (this.input.held(...keymap().fire) || this.input.mouseFire) this.fireLaser();
    this.laserCooldown -= dt;
    this.laserTemp = Math.max(0, this.laserTemp - 0.22 * dt);
    this.energy = Math.min(4, this.energy + (this.commander.equipment.energyUnit ? 0.2 : 0.1) * dt);
    if (this.energy > 1) {
      this.foreShield = Math.min(1, this.foreShield + 0.035 * dt);
      this.aftShield = Math.min(1, this.aftShield + 0.035 * dt);
    }

    // cabin temperature: the sun cooks you gradually — and sun-skimming
    // with scoops means riding the hot zone on purpose
    const sunDist = this.player.position.distanceTo(this.world.sun.group.position);
    const targetTemp = Math.max(0, Math.min(1, (SUN_HEAT_START - sunDist) / (SUN_HEAT_START - SUN_HEAT_MAX)));
    this.cabinTemp += (targetTemp - this.cabinTemp) * Math.min(1, dt * 1.2);
    if (this.cabinTemp >= 0.99) {
      this.die('CABIN TEMPERATURE CRITICAL');
      return;
    }
    if (this.commander.equipment.scoops && this.commander.fuel < MAX_FUEL && sunDist < SUN_SCOOP_RANGE) {
      this.commander.fuel = Math.min(MAX_FUEL, this.commander.fuel + 5 * dt);
      this.hud.showMessage('FUEL SCOOPING', 0.4);
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
      const carryingContraband = ILLEGAL_GOODS.some((i) => this.commander.cargo[i] > 0);
      if (carryingContraband) {
        const policeNear = this.npcs.some((n) =>
          n.alive && n.role === 'police' &&
          n.object.position.distanceTo(this.player.position) < 2600);
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
        return;
      }
    }

    // collisions
    const altitude =
      this.player.position.distanceTo(this.world.planet.mesh.position) - this.world.planetRadius;
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
    for (const npc of this.npcs) {
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
    this.hermitMarket = generateMarket(this.system, Math.floor(Math.random() * 256))
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

  private assignNpcTargets(): void {
    const playerFar = (npc: NpcShip) =>
      npc.object.position.distanceTo(this.player.position) > 9000;
    const nearest = (from: NpcShip, role: NpcRole, range: number): NpcShip | null => {
      let best: NpcShip | null = null;
      let bestD = range;
      for (const other of this.npcs) {
        if (!other.alive || other.role !== role) continue;
        const d = other.object.position.distanceTo(from.object.position);
        if (d < bestD) {
          bestD = d;
          best = other;
        }
      }
      return best;
    };
    // prune stale attacker links (dead pirates, or ones that retargeted)
    for (const npc of this.npcs) {
      if (npc.attackers.length) {
        const live = npc.attackers.filter((a) => a.alive && a.npcTarget === npc);
        npc.attackers.length = 0;
        npc.attackers.push(...live);
      }
    }
    for (const npc of this.npcs) {
      if (!npc.alive || (npc.npcTarget && npc.npcTarget.alive)) continue;
      if (npc.role === 'pirate' && playerFar(npc)) {
        npc.npcTarget = nearest(npc, 'trader', 6000);
        if (npc.npcTarget && !npc.npcTarget.attackers.includes(npc)) {
          npc.npcTarget.attackers.push(npc);
        }
      } else if (npc.role === 'police') {
        npc.npcTarget = nearest(npc, 'pirate', 6500);
      } else if (npc.role === 'hunter' && this.commander.legalStatus === 0) {
        npc.npcTarget = nearest(npc, 'pirate', 6000);
      }
    }
  }

  private resolveNpcFire(npc: NpcShip, event: FireEvent): void {
    if (event.at === 'player') {
      const dist = npc.object.position.distanceTo(this.player.position);
      if (npc.missiles > 0 && dist > 1200 && dist < 3200 && Math.random() < 0.3) {
        this.enemyLaunchMissile(npc);
        return;
      }
      sfx.enemyLaser();
      const hit = Math.random() < Math.min(0.85, Math.max(0.15, 0.9 - dist / 3500));
      // visible bolt: to us on a hit, wide of us on a miss
      const to = hit
        ? this.player.position.clone()
        : this.player.position.clone().add(
            new THREE.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 140));
      this.addTracer(
        npc.nosePosition(this.tmp).clone(), to,
        npc.role === 'thargoid' || npc.role === 'thargon' ? 0xd05cff : 0xff5c40, 0.22);
      if (hit) this.applyPlayerDamage(0.1 + Math.random() * 0.12, npc.object.position);
      return;
    }
    // NPC shooting NPC
    const target = event.at;
    this.addTracer(
      npc.nosePosition(this.tmp).clone(), target.object.position.clone(), 0xffaa55, 0.18);
    if (Math.random() < 0.5) {
      if (target.takeDamage(0.11, npc.object.position)) {
        this.wreckNpc(target); // no player credit
      }
    }
  }

  private updateCanisters(dt: number): void {
    for (const c of [...this.canisters]) {
      c.object.position.addScaledVector(c.velocity, dt);
      c.object.rotateOnAxis(c.spinAxis, dt * 0.8);
      const dist = c.object.position.distanceTo(this.player.position);
      if (dist > 45) continue;
      this.scene.remove(c.object);
      this.canisters = this.canisters.filter((x) => x !== c);
      if (this.commander.equipment.scoops) {
        if (cargoTonnes(this.commander) >= cargoCapacity(this.commander)) {
          this.hud.showMessage(c.kind === 'capsule' ? 'HOLD FULL — CAPSULE LOST' : 'HOLD FULL — CANISTER LOST', 3);
        } else if (c.kind === 'capsule') {
          this.commander.cargo[3] += 1; // the occupant, now inventory
          this.hud.showMessage('CAPSULE ABOARD — SURVIVOR LOGGED AS CARGO', 4);
          sfx.beep(600, 0.12);
        } else {
          this.commander.cargo[c.commodity] += 1;
          this.hud.showMessage(`SCOOPED 1t ${COMMODITIES[c.commodity].name.toUpperCase()}`, 3);
          sfx.beep(950, 0.08);
        }
      } else {
        this.applyPlayerDamage(0.06, c.object.position);
        this.hud.showMessage('CANISTER DESTROYED ON HULL', 2);
      }
    }
  }

  /** @internal — driven by test/playtest.js */
  massLocked(): boolean {
    if (this.player.position.distanceTo(this.world.station.position) < 5000) return true;
    if (this.player.position.distanceTo(this.world.planet.mesh.position) - this.world.planetRadius < 4000) return true;
    for (const npc of this.npcs) {
      if (npc.alive && npc.role !== 'asteroid' &&
          npc.object.position.distanceTo(this.player.position) < 4500) return true;
    }
    return false;
  }

  private hostilesNear(): boolean {
    return this.npcs.some((npc) =>
      isHostileToPlayer(npc, this.commander.legalStatus) &&
      npc.object.position.distanceTo(this.player.position) < 9000);
  }

  // --- input ---------------------------------------------------------------

  private handleInput(dt: number): void {
    void dt;
    const i = this.input;
    // ? toggles the controls guide (plain / is the classic decelerate key)
    if (i.pressed('Question')) {
      document.getElementById('help')!.classList.toggle('hidden');
    }

    // The host runs the menu cursor and gives the frame to the top screen.
    // It returns false for screens that have not migrated to the Screen
    // contract yet, which fall through to the switch below. That switch
    // shrinks with every screen that moves; when it is empty, this method is
    // just flight keys.
    if (this.screens.update(i)) return;

    switch (this.mode) {
      case 'docked':
        // the erase-your-career confirmation swallows every other key
        if (this.pendingNewGame) {
          if (i.pressed('KeyY')) this.newCommanderGame();
          else if (i.pressed('KeyX')) this.exportSave(); // back it up first
          else if (i.pressed('Escape') || i.pressed('KeyQ')) {
            this.pendingNewGame = false;
            renderDockedMenu(this.system, this.commander, this.missionText());
          }
          break;
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
        break;

      case 'market':
        break;

      case 'equip':
        break;

      case 'saves':
        break;

      case 'naming':
        break;

      case 'chart':
      case 'local':
        if (this.chartEstimate) {
          if (i.pressed('Escape') || i.pressed('KeyM')) {
            this.chartEstimate = false;
            if (this.mode === 'local') renderLocalChart(this.systems, this.commander, this.chart);
            else renderChart(this.systems, this.commander, this.chart);
          }
          break;
        }
        if (this.chartFind !== null) {
          this.handleChartFind();
          break;
        }
        if (i.pressed('KeyM')) {
          const near = nearestSystem(this.systems, this.chart.cursorX, this.chart.cursorY);
          if (near) {
            this.chartEstimate = true;
            renderMarketEstimate(near, this.commander);
          }
          break;
        }
        if (i.pressed('KeyD')) {
          const near = nearestSystem(this.systems, this.chart.cursorX, this.chart.cursorY);
          if (near) this.openSystemData(near, this.mode === 'local' ? 'local' : 'chart');
          break;
        }
        if (i.pressed('KeyF')) {
          this.chartFind = '';
          this.redrawChart();
          break;
        }
        if (i.pressed('Enter')) {
          const near = nearestSystem(this.systems, this.chart.cursorX, this.chart.cursorY);
          if (near) {
            this.chart.targetIndex = near.index;
            sfx.beep(900, 0.1);
            this.redrawChart();
          }
        }
        if (i.pressed('Escape')) this.closeOverlay();
        break;

      case 'flight':
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
        break;

      case 'dead':
        if (i.pressed('Enter')) this.respawn();
        break;
    }
  }

  /** @internal — driven by test/playtest.js */
  openChart(from: 'docked' | 'flight'): void {
    this.input.releaseMouseFlight();
    this.screens.open('chart');
    this.baseMode = from;
    this.chartFind = null;
    this.chartEstimate = false;
    const cur = this.system;
    this.chart.cursorX = cur.x;
    this.chart.cursorY = cur.y;
    renderChart(this.systems, this.commander, this.chart);
  }

  /** @internal — driven by test/playtest.js */
  openLocalChart(from: 'docked' | 'flight'): void {
    this.input.releaseMouseFlight();
    this.screens.open('local');
    this.baseMode = from;
    this.chartFind = null;
    this.chartEstimate = false;
    const cur = this.system;
    this.chart.cursorX = cur.x;
    this.chart.cursorY = cur.y;
    renderLocalChart(this.systems, this.commander, this.chart);
  }

  /**
   * Mouse input for the overlay screens. Buttons and menu rows carry a
   * `data-key`, which is injected as a synthetic key press so clicks and
   * the keyboard run through exactly the same handlers; table rows carry a
   * `data-row` selection index; charts map clicks back to chart coordinates.
   */
  private handleScreenClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-key],[data-row]') as HTMLElement | null;
    if (el) {
      // The host owns this: data-key becomes a keystroke so a click and the
      // printed shortcut take the same path, and data-row goes to the top
      // screen's select(). Screens that have not migrated yet fall through to
      // the per-mode handling below.
      if (this.screens.click(el, this.input)) return;
      const row = el.dataset.row;
      if (row !== undefined && this.mode === 'contracts') {
        this.contractSelected = Number(row);
        renderContracts(this.system, this.systems, this.commander, this.contractOffers, this.contractSelected);
      }
      return;
    }
    this.handleChartClick(e);
  }

  private handleChartClick(e: MouseEvent): void {
    if (this.mode !== 'chart' && this.mode !== 'local') return;
    if (this.chartEstimate || this.chartFind !== null) return;
    const canvas = e.target as HTMLElement;
    if (!(canvas instanceof HTMLCanvasElement)) return;

    const local = this.mode === 'local';
    const coords = local
      ? localCoordsFromClick(canvas, e.clientX, e.clientY, this.system)
      : chartCoordsFromClick(canvas, e.clientX, e.clientY);
    this.chart.cursorX = Math.max(0, Math.min(255, coords.x));
    this.chart.cursorY = Math.max(0, Math.min(255, coords.y));

    // snap radius of ~28 screen px on either chart, so clicking a star
    // targets it while clicking empty sky just moves the cursor
    const pxPerUnit = local ? LOCAL_SCALE : canvas.width / 256;
    const near = nearestSystem(
      this.systems, this.chart.cursorX, this.chart.cursorY, 28 / pxPerUnit);
    if (near) {
      this.chart.cursorX = near.x;
      this.chart.cursorY = near.y;
      this.chart.targetIndex = near.index;
      sfx.beep(900, 0.1);
    }
    this.redrawChart();
  }

  private redrawChart(): void {
    if (this.mode === 'local') drawLocalChart(this.systems, this.commander, this.chart);
    else drawChart(this.systems, this.commander, this.chart);
    if (this.chartFind !== null) {
      const info = document.getElementById(this.mode === 'local' ? 'local-info' : 'chart-info');
      if (info) info.textContent = `FIND: ${this.chartFind}_`;
    }
  }

  private setView(v: number): void {
    if (this.view === v) return;
    this.view = v;
    sfx.beep(600, 0.04);
  }

  /** Type-to-find on the charts: letters filter, the cursor jumps to matches. */
  private handleChartFind(): void {
    const i = this.input;
    let changed = false;
    for (const code of i.drainPresses()) {
      if (code.startsWith('Key')) {
        this.chartFind += code.slice(3);
        changed = true;
      } else if (code === 'Backspace') {
        this.chartFind = this.chartFind!.slice(0, -1);
        changed = true;
      } else if (code === 'Enter' || code === 'Escape') {
        this.chartFind = null;
        this.redrawChart();
        return;
      }
    }
    if (changed && this.chartFind) {
      const match = this.systems.find((s) =>
        s.name.toUpperCase().startsWith(this.chartFind!.toUpperCase()));
      if (match) {
        this.chart.cursorX = match.x;
        this.chart.cursorY = match.y;
      }
    }
    if (changed) this.redrawChart();
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

  /**
   * Repaint a screen that has not migrated to the Screen contract, after
   * something on top of it closed. Goes away with the last legacy screen.
   */
  private repaintLegacyScreen(id: string): void {
    if (id === 'chart') renderChart(this.systems, this.commander, this.chart);
    else if (id === 'local') renderLocalChart(this.systems, this.commander, this.chart);
  }

  /** Nothing on the stack: show the docked menu, or clear back to flight. */
  private showBaseScreen(): void {
    if (this.baseMode === 'docked') {
      renderDockedMenu(this.system, this.commander, this.missionText());
    } else {
      hideScreen();
    }
  }

  private closeOverlay(): void {
    // the host calls showBaseScreen() as the last screen pops
    if (this.screens.depth) this.screens.exit();
    else this.showBaseScreen();
  }

  private updateChartCursor(dt: number): void {
    const i = this.input;
    // the local chart is ~13x zoomed, so the cursor moves proportionally finer
    const tapStep = this.mode === 'local' ? 1 : 3;
    const speed = (this.mode === 'local' ? 12 : 55) * dt;
    let moved = false;
    // discrete step per tap + continuous motion while held
    const taps = {
      left: i.pressedCount('ArrowLeft'),
      right: i.pressedCount('ArrowRight'),
      up: i.pressedCount('ArrowUp'),
      down: i.pressedCount('ArrowDown'),
    };
    if (taps.left) { this.chart.cursorX -= tapStep * taps.left; moved = true; }
    if (taps.right) { this.chart.cursorX += tapStep * taps.right; moved = true; }
    if (taps.up) { this.chart.cursorY -= 2 * tapStep * taps.up; moved = true; }
    if (taps.down) { this.chart.cursorY += 2 * tapStep * taps.down; moved = true; }
    if (i.held('ArrowLeft', 'KeyA')) { this.chart.cursorX -= speed; moved = true; }
    if (i.held('ArrowRight', 'KeyD')) { this.chart.cursorX += speed; moved = true; }
    if (i.held('ArrowUp', 'KeyW')) { this.chart.cursorY -= speed * 2; moved = true; }
    if (i.held('ArrowDown', 'KeyS')) { this.chart.cursorY += speed * 2; moved = true; }
    if (moved) {
      this.chart.cursorX = Math.max(0, Math.min(255, this.chart.cursorX));
      this.chart.cursorY = Math.max(0, Math.min(255, this.chart.cursorY));
      this.redrawChart();
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
    let dumped = 0;
    let lastName = '';
    for (let t = 0; t < tonnes; t++) {
      // dump the most valuable thing aboard first — that's what buys you peace
      let best = -1;
      let bestValue = 0;
      for (let i = 0; i < this.commander.cargo.length; i++) {
        if (this.commander.cargo[i] <= 0) continue;
        const value = COMMODITIES[i].basePrice;
        if (value > bestValue) { bestValue = value; best = i; }
      }
      if (best < 0) break;
      this.commander.cargo[best] -= 1;
      this.jettisonedValue += bestValue * 4; // tenths of a credit, as markOf values it
      this.spawnCanisters(this.player.position.clone(), 1, [best]);
      lastName = COMMODITIES[best].name.toUpperCase();
      dumped += 1;
    }
    if (dumped === 0) {
      this.hud.showMessage('HOLD EMPTY', 1.5);
      sfx.beep(220);
      return;
    }
    sfx.beep(320, 0.08);

    // Does it buy them off? They wanted a share of what you arrived carrying,
    // so the demand scales with the prize rather than being a flat toll — and
    // a gang that organised for you wants considerably more than an
    // opportunist who happened to be passing.
    let bought = 0;
    let stillWant = Infinity;
    for (const npc of this.npcs) {
      if (!npc.alive || npc.role !== 'pirate') continue;
      if (npc.satisfied) continue;
      const share = npc.organised ? 0.3 : 0.12;
      const appetite = Math.max(npc.organised ? 1_500 : 400, this.arrivalCargoValue * share);
      if (this.jettisonedValue >= appetite) {
        npc.satisfied = true;
        bought += 1;
      } else {
        stillWant = Math.min(stillWant, appetite - this.jettisonedValue);
      }
    }
    if (bought > 0) {
      this.hud.showMessage(`${bought} ATTACKER${bought > 1 ? 'S' : ''} BREAKING OFF`, 3);
    } else if (Number.isFinite(stillWant)) {
      this.hud.showMessage(
        `JETTISONED ${dumped}t ${lastName} — THEY WANT MORE (${formatCredits(Math.ceil(stillWant))})`, 3);
    } else {
      this.hud.showMessage(`JETTISONED ${dumped}t ${lastName}`, 2);
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
      for (const npc of this.npcs) {
        if (!npc.alive || npc.role === 'asteroid') continue;
        const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > LASER_RANGE) continue;
        const cone = Math.max(0.012, Math.atan((npc.radius * LASER_GRAZE) / dist)) + assistAt(dist);
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
    const pos = this.beams.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let x = 0, y = 0, z = -BEAM_Z;
    if (target) {
      const local = this.camera.worldToLocal(this.tmp2.copy(target));
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
    const contacts: ScannerContact[] = [{ position: this.world.station.position, kind: 'station' }];
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const kind =
        npc.role === 'asteroid' ? 'asteroid'
        : npc.role === 'thargoid' || npc.role === 'thargon' ? 'thargoid'
        : isHostileToPlayer(npc, this.commander.legalStatus) ? 'hostile'
        : 'ship';
      contacts.push({ position: npc.object.position, kind });
    }
    for (const m of this.missiles) contacts.push({ position: m.object.position, kind: 'missile' });
    for (const c of this.canisters) contacts.push({ position: c.object.position, kind: 'cargo' });

    const altitude =
      this.player.position.distanceTo(this.world.planet.mesh.position) - this.world.planetRadius;
    const condition = this.mode !== 'flight' ? 'GREEN' : this.hostilesNear() ? 'RED' : 'YELLOW';
    // in witch-space the compass tracks the nearest Thargoid instead
    const nearestHostile = this.witchspace
      ? this.npcs.find((n) => n.alive && !n.inert && (n.role === 'thargoid' || n.role === 'thargon'))
          ?.object.position
      : undefined;
    const sunDistNow = this.player.position.distanceTo(this.world.sun.group.position);
    const compassTarget = nearestHostile ??
      (sunDistNow < 130000 && !this.witchspace
        ? this.world.sun.group.position // sun-skimming: navigate the heat by compass
        : this.player.position.distanceTo(this.world.station.position) < this.world.planetRadius * 3
          ? this.world.station.position
          : this.world.planet.mesh.position);

    // auto ship-ID: name the ship nearest the current view axis
    let shipId = '';
    if (this.mode === 'flight') {
      const dir = this.viewDir(this.tmp);
      let bestAngle = 0.06;
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > 4500) continue;
        const angle = dir.angleTo(to.normalize());
        if (angle < bestAngle) {
          bestAngle = angle;
          shipId = `${(npc.object.name || 'ASTEROID').toUpperCase()} ${(dist / 1000).toFixed(1)}KM`;
        }
      }
    }
    const e = this.commander.equipment;
    const hasLaser =
      this.view === 0 ||
      (this.view === 1 && e.rearLaser) ||
      (this.view === 2 && e.leftLaser) ||
      (this.view === 3 && e.rightLaser);

    // docking aid: only while actually lining up — near the slot side AND
    // flying toward the station (departures launch facing away, so the aid
    // stays out of the way after lift-off)
    let dockAid: import('../hud/hud').HudState['dockAid'] = null;
    let slotMarker: import('../hud/hud').HudState['slotMarker'] = null;
    if (this.mode === 'flight' && !this.witchspace) {
      const st = this.world.station;
      const dist = this.player.position.distanceTo(st.position);
      const facingStation = this.player
        .getForward(this.tmp)
        .dot(this.tmp2.copy(st.position).sub(this.player.position).normalize()) > 0.35;
      const slotN = this.tmp.set(0, 0, -1).applyQuaternion(st.quaternion);
      const onSlotSide = this.tmp2.copy(this.player.position).sub(st.position).dot(slotN) > 0;
      if (dist < 3000 && onSlotSide) {
        // Where the slot actually IS, on screen. Close in the station fills the
        // view and the entrance can sit off to one side, or off-frame entirely
        // — you end up staring at a blank black face concluding there is no
        // entrance. Deliberately NOT gated on facing the station: "which way is
        // the slot" is precisely the question you have when looking the wrong
        // way. The alignment aid below stays gated, so it still only appears
        // when you're actually lining up.
        this.tmp3.set(0, 0, -this.world.stationDockZ);
        st.localToWorld(this.tmp3);
        const behind = this.tmp3.clone().sub(this.player.position)
          .dot(this.player.getForward(this.tmp2)) <= 0;
        this.tmp3.project(this.camera);
        slotMarker = {
          x: behind ? -this.tmp3.x : this.tmp3.x,
          y: behind ? -this.tmp3.y : this.tmp3.y,
          behind,
        };

        if (facingStation) {
          const local = this.tmp2.copy(this.player.position);
          st.worldToLocal(local);
          this.tmpQ.copy(st.quaternion).invert().multiply(this.player.quaternion);
          const right = this.tmp.set(1, 0, 0).applyQuaternion(this.tmpQ);
          const roll = Math.atan2(right.y, right.x);
          dockAid = {
            x: local.x,
            y: local.y,
            roll,
            inSlot: Math.abs(local.x) < 62 && Math.abs(local.y) < 26,
            rollOk: Math.atan2(Math.abs(right.y), Math.abs(right.x)) < 0.65,
          };
        }
      }
    }

    // Nearest hostile, for the off-screen threat arrow. Same projection as
    // the docking port marker: project into clip space, and mirror it when the
    // ship is behind us so the arrow points backwards rather than at its
    // reflection through the camera.
    let threatMarker: import('../hud/hud').HudState['threatMarker'] = null;
    if (this.mode === 'flight' && !this.witchspace) {
      let nearest: NpcShip | null = null;
      let best = Infinity;
      let count = 0;
      for (const npc of this.npcs) {
        if (!isHostileToPlayer(npc, this.commander.legalStatus)) continue;
        const d = npc.object.position.distanceTo(this.player.position);
        if (d > 9000) continue;
        count += 1;
        if (d < best) { best = d; nearest = npc; }
      }
      if (nearest) {
        this.tmp3.copy(nearest.object.position);
        const toward = this.tmp2.copy(this.tmp3).sub(this.player.position);
        const behind = toward.dot(this.player.getForward(this.tmp)) <= 0;
        this.tmp3.project(this.camera);
        threatMarker = {
          x: behind ? -this.tmp3.x : this.tmp3.x,
          y: behind ? -this.tmp3.y : this.tmp3.y,
          behind,
          count,
        };
      }
    }

    // target brackets: ships in front of the current view, plus a lead
    // marker on the locked one (laser bolts are instant, but the target
    // keeps moving while you line up, so show where it will be)
    const targets: ScreenTarget[] = [];
    if (this.mode === 'flight') {
      const viewQuat = this.tmpQ.copy(this.player.quaternion).multiply(VIEW_QUATS[this.view]);
      const camDir = this.tmp.set(0, 0, -1).applyQuaternion(viewQuat);
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
        const dist = to.length();
        if (dist > 5000) continue;
        if (camDir.dot(to.clone().normalize()) < 0.3) continue; // behind / far off-view
        const ndc = npc.object.position.clone().project(this.camera);
        if (ndc.z > 1) continue;
        const locked = this.targetLock === npc;
        const target: ScreenTarget = {
          x: ndc.x,
          y: ndc.y,
          size: Math.min(0.5, (npc.radius * 2.2) / dist),
          hostile: isHostileToPlayer(npc, this.commander.legalStatus),
          locked,
          hp: npc.hp / npc.maxHp,
          label: `${(npc.object.name || 'ASTEROID').toUpperCase()}  ${(dist / 1000).toFixed(1)}KM`,
        };
        if (locked && npc.role !== 'asteroid') {
          // lead point: where the target will be after the bolt's flight time
          const flight = dist / 8000;
          const vel = this.tmp2.set(0, 0, -1).applyQuaternion(npc.object.quaternion).multiplyScalar(220);
          const leadPos = npc.object.position.clone().addScaledVector(vel, flight);
          const lead = leadPos.project(this.camera);
          if (lead.z <= 1) target.lead = { x: lead.x, y: lead.y };
        }
        targets.push(target);
      }
    }
    this.hud.drawTargets(targets);

    this.hud.render(
      dt,
      {
        speedFrac: this.player.speed / this.player.maxSpeed,
        rollFrac: this.player.rollRate / 2.0,
        pitchFrac: this.player.pitchRate / 1.1,
        foreShield: this.foreShield,
        aftShield: this.aftShield,
        energy: this.energy,
        fuelFrac: this.commander.fuel / MAX_FUEL,
        laserTemp: this.laserTemp,
        altitudeFrac: altitude / (this.world.planetRadius * 2),
        cabinTemp: this.cabinTemp,
        missiles: this.commander.missiles,
        locked: this.targetLock !== null,
        condition,
        credits: this.commander.credits,
        view: this.view,
        hasLaser,
        shipId,
        dockAid,
        slotMarker,
        threatMarker,
        assist: this.ccEngaged,
        armed: this.missileArmed,
        stationInRange:
          this.mode === 'flight' && !this.witchspace &&
          this.player.position.distanceTo(this.world.station.position) < SCANNER_RANGE,
        ecmDetected: this.ecmDetectedTimer > 0,
      },
      this.player.position,
      this.player.quaternion,
      contacts,
      compassTarget,
    );
  }
}
