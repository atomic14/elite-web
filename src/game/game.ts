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
import { buildSystemScene, type SystemScene } from '../world/system-scene';
import { createStarfield, SpaceDust } from '../world/starfield';
import { buildShip, MISSILE, CANISTER } from '../ships/geometry';
import { PlayerShip } from '../player';
import { Input } from '../engine/input';
import { keymap, layoutName, toggleLayout, manualFlightKeys, refreshHelpPanel } from '../engine/keymap';
import { Hud, type ScannerContact } from '../hud/hud';
import { TunnelEffect } from '../hud/tunnel';
import { sfx } from '../audio';
import { NpcShip, Explosion, Tracer, CONSTRICTOR_SPEC, isHostileToPlayer, DEFEND_BRAIN, type NpcRole, type FireEvent } from './npc';
import { act, observe, makeScratch, type ObservableShip } from '../sim/policy';
import {
  loadCommander, saveCommander, formatCredits, MAX_FUEL, MAX_MISSILES,
  cargoCapacity, cargoTonnes, LEGAL_NAMES, ILLEGAL_GOODS,
  type CommanderData, type LaserType,
} from './commander';
import {
  hideScreen, renderDockedMenu, renderMarket, renderStatus, renderChart, drawChart,
  renderLocalChart, drawLocalChart, renderEquip, equipRows, renderMarketEstimate,
  renderGameOver, nearestSystem, distanceTenths, type ChartState,
} from '../ui/screens';

type Mode = 'docked' | 'flight' | 'market' | 'chart' | 'local' | 'equip' | 'status' | 'dead';

const LASER_RANGE = 3500;
const LASERS: Record<LaserType, { damage: number; cooldown: number; heat: number }> = {
  pulse: { damage: 0.16, cooldown: 0.24, heat: 0.055 },
  beam: { damage: 0.13, cooldown: 0.09, heat: 0.035 },
  military: { damage: 0.25, cooldown: 0.09, heat: 0.03 },
};
const MISSILE_SPEED = 700;
// Sun proximity tuning (ordered: heat starts < scooping < temp maxes < death).
// The sun itself orbits ~320k out (world/system-scene.ts).
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
  commodity: number;
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 1, 1_000_000);

  private systems: StarSystem[];
  private commander: CommanderData;
  private world!: SystemScene;
  private npcs: NpcShip[] = [];
  private explosions: Explosion[] = [];
  private missiles: Missile[] = [];

  private readonly player: PlayerShip;
  private readonly input = new Input();
  private readonly hud = new Hud();
  private readonly tunnel = new TunnelEffect();

  private mode: Mode = 'docked';
  private returnMode: 'docked' | 'flight' = 'docked';
  private readonly chart: ChartState = { cursorX: 0, cursorY: 0, targetIndex: null };
  private market: MarketEntry[] = [];
  private marketSelected = 0;
  private equipSelected = 0;
  private tracers: Tracer[] = [];

  private targetLock: NpcShip | null = null;
  private hyperCountdown = -1;
  private torusEngaged = false;
  private witchspace = false;
  private view = 0; // 0 front, 1 rear, 2 left, 3 right
  private cabinTemp = 0;
  private canisters: Canister[] = [];
  private thargonTimer = 0;
  private npcTargetTimer = 0;
  private traderSpawnTimer = 30;
  private pirateWaveTimer = 60;
  private energyLowTimer = 0;
  private policeScanned = false;
  private chartFind: string | null = null;
  private paused = false;
  private chartEstimate = false;
  // combat computer: the jameson-defend policy flying the player's ship
  private ccEngaged = false;
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

  private foreShield = 1;
  private aftShield = 1;
  private energy = 4;
  private laserTemp = 0;
  private laserCooldown = 0;
  private beamTimer = 0;
  private readonly beams: THREE.LineSegments;

  private readonly dust = new SpaceDust();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
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

    this.scene.add(createStarfield());
    this.scene.add(this.dust.points);
    this.scene.add(this.camera);

    // cockpit laser beams, drawn in camera space
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.85, -0.75, -1.2, 0, 0.21, -2.6,
      0.85, -0.75, -1.2, 0, 0.21, -2.6,
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

    // test-harness handle: the Jameson autopilot (train/jameson-autopilot.js,
    // docs/JAMESON-TRIALS.md) drives the whole game through this
    (window as unknown as Record<string, unknown>).__game = this;

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
    this.camera.updateProjectionMatrix();
  }

  private get system(): StarSystem {
    return this.systems[this.commander.systemIndex];
  }

  // --- world lifecycle -----------------------------------------------------

  private buildWorld(): void {
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
  private enterWitchspace(): void {
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

  private spawnNpc(
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
        commodity: commodities[Math.floor(Math.random() * commodities.length)],
        velocity: new THREE.Vector3().randomDirection().multiplyScalar(15 + Math.random() * 30),
        spinAxis: new THREE.Vector3().randomDirection(),
      });
      this.scene.add(object);
    }
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

    const traders = 1 + (Math.random() < 0.5 ? 1 : 0);
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
      const pirates = Math.max(0, Math.round((7 - sys.government) / 2 + Math.random() * 2 - 1));
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
        this.spawnNpc('pirate', pos, i + sys.index * 3);
      }
    }

    // a lone bounty hunter is sometimes working the system
    if (Math.random() < (situation === 'arrival' ? 0.35 : 0.2)) {
      this.spawnNpc('hunter', home.clone().add(rnd(6000)), sys.index);
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

  private enterDocked(booting = false): void {
    this.mode = 'docked';
    this.returnMode = 'docked';
    this.clearNpcs();
    this.foreShield = 1;
    this.aftShield = 1;
    this.energy = 4;
    this.laserTemp = 0;
    this.hyperCountdown = -1;
    this.torusEngaged = false;
    this.ccEngaged = false;
    if (this.commander.legalStatus > 0) {
      const fine = Math.min(this.commander.credits, this.commander.legalStatus >= 2 ? 750 : 250);
      this.commander.credits -= fine;
      this.commander.legalStatus = 0;
      this.hud.showMessage(`OFFENCE FINE PAID: ${formatCredits(fine)}`, 5);
    }
    this.policeScanned = false;
    this.view = 0;
    this.cabinTemp = 0;
    this.witchspace = false;
    this.clearCanisters();
    this.checkMissionAtDock();
    this.market = generateMarket(this.system, Math.floor(Math.random() * 256));
    saveCommander(this.commander);
    if (!booting) {
      sfx.dock();
      sfx.tunnel();
      this.tunnel.start();
    }
    // park just outside the slot so the backdrop behind the menu is the station
    this.player.position.copy(this.world.spawnPosition);
    this.lookAlong(this.world.station.position.clone().sub(this.player.position));
    this.player.speed = 0;
    renderDockedMenu(this.system, this.commander, this.missionText());
  }

  /** Download the commander as a JSON file (portable saves, bug reports). */
  private exportSave(): void {
    const blob = new Blob([JSON.stringify(this.commander, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `elite-commander-${this.system.name.toLowerCase()}-${formatCredits(this.commander.credits).replace(' ', '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.hud.showMessage('COMMANDER EXPORTED', 3);
  }

  /** Load a commander from a JSON file (replaces the current save). */
  private importSave(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as Partial<CommanderData>;
        if (typeof parsed.credits !== 'number' || typeof parsed.systemIndex !== 'number') {
          throw new Error('not a commander file');
        }
        localStorage.setItem('elite-web-commander', JSON.stringify(parsed));
        location.reload(); // boot cleanly from the imported save
      } catch {
        this.hud.showMessage('IMPORT FAILED — NOT A COMMANDER FILE', 4);
        sfx.beep(220);
      }
    };
    input.click();
  }

  private launch(): void {
    const n = this.slotNormal();
    this.player.position.copy(this.world.station.position).addScaledVector(n, 450);
    this.lookAlong(n);
    this.player.speed = 120;
    this.mode = 'flight';
    this.returnMode = 'flight';
    this.view = 0;
    hideScreen();
    this.populateSystem('launch');
    sfx.launch();
    sfx.tunnel();
    this.tunnel.start();
    this.hud.showMessage(`LEAVING ${this.system.name.toUpperCase()} STATION`, 3);
  }

  private lookAlong(dir: THREE.Vector3): void {
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
    this.mode = 'dead';
    this.hud.showMessage(reason, 6);
    renderGameOver(this.commander);
  }

  private respawn(): void {
    this.commander = loadCommander();
    this.chart.targetIndex = null;
    this.witchspace = false;
    this.buildWorld();
    this.enterDocked(true);
  }

  // --- missions ------------------------------------------------------------

  private missionText(): string {
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

  private startHyperspace(): void {
    if (this.hyperCountdown >= 0) return;
    const t = this.chart.targetIndex;
    if (t === null || t === this.commander.systemIndex) {
      this.hud.showMessage('NO HYPERSPACE TARGET SET', 3);
      sfx.beep(220);
      return;
    }
    const cost = this.witchspace ? 10 : distanceTenths(this.system, this.systems[t]);
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
      this.commander.fuel -= Math.min(this.commander.fuel, 10);
    } else {
      this.commander.fuel -= distanceTenths(this.system, this.systems[t]);
      const witchChance = this.commander.mission.stage === 3 ? 0.22 : 0.09;
      if (Math.random() < witchChance) {
        this.enterWitchspace(); // target retained for the escape jump
        return;
      }
    }
    this.commander.systemIndex = t;
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(`ARRIVED: ${this.system.name.toUpperCase()}`, 4);
  }

  private arriveInSystem(): void {
    this.witchspace = false; // any arrival leaves witch-space (incl. galactic jump)
    this.buildWorld();
    // Arrive at the witchpoint, well out — the classic long torus cruise in.
    // Bearing is biased to the station's side of the planet (~30° cone) so
    // the planet never blocks the run.
    const stationDir = this.world.station.position.clone().normalize();
    const dir = stationDir
      .add(new THREE.Vector3().randomDirection().multiplyScalar(0.5))
      .normalize();
    this.player.position.copy(dir.multiplyScalar(this.world.planetRadius * 12));
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

  private raiseLegal(level: number): void {
    if (this.commander.legalStatus < level) {
      this.commander.legalStatus = level;
      this.hud.showMessage(`LEGAL STATUS: ${LEGAL_NAMES[level].toUpperCase()}`, 3);
    }
  }

  private fireLaser(): void {
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
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const to = this.tmp2.copy(npc.object.position).sub(this.player.position);
      const dist = to.length();
      if (dist > bestDist) continue;
      const cone = Math.max(0.02, Math.atan((npc.radius * 1.6) / dist));
      if (forward.angleTo(to.normalize()) < cone) {
        best = npc;
        bestDist = dist;
      }
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
  private destroyNpc(npc: NpcShip): void {
    this.wreckNpc(npc);
    if (npc.role !== 'asteroid') this.commander.kills += 1;
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

  private acquireLock(): void {
    const forward = this.viewDir(this.tmp); // lockable from any view, as per the manual
    let best: NpcShip | null = null;
    let bestAngle = 0.16;
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
    this.targetLock = best;
    if (best) {
      sfx.beep(1200, 0.12);
    } else {
      this.hud.showMessage('NO TARGET', 2);
      sfx.beep(220);
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
    obj.position.copy(npc.object.position);
    obj.quaternion.copy(npc.object.quaternion);
    this.scene.add(obj);
    this.missiles.push({ object: obj, target: null, life: 30 });
    this.hud.showMessage('INCOMING MISSILE', 3);
    sfx.missile();
  }

  private applyPlayerDamage(amount: number, from: THREE.Vector3): void {
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
    this.energy -= remaining * 2;
    this.hud.flashDamage();
    sfx.damage();
    if (this.energy <= 0) this.die('SHIP DESTROYED');
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
    this.hud.showMessage('DOCKING COMPUTER ENGAGED', 2);
    this.enterDocked();
  }

  private toggleCombatComputer(): void {
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
    if (this.input.held(...manualFlightKeys())) {
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
    let best = 0;
    let bestD = Infinity;
    for (const s of this.systems) {
      // same half-weight-y chart metric as ui/screens.ts distanceTenths
      const dx = s.x - from.x;
      const dy = (s.y - from.y) / 2;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = s.index;
      }
    }
    this.commander.systemIndex = best;
    this.chart.targetIndex = null;
    this.arriveInSystem();
    this.hud.showMessage(`GALAXY ${this.commander.galaxy} — ${this.system.name.toUpperCase()}`, 5);
  }

  // --- per-frame -----------------------------------------------------------

  private update(dt: number, elapsed: number): void {
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
    this.dust.update(this.player.position);

    // periodic NPC-vs-NPC targeting: pirates prey on traders, the law hunts pirates
    this.npcTargetTimer -= dt;
    if (this.npcTargetTimer <= 0) {
      this.npcTargetTimer = 2;
      this.assignNpcTargets();
    }

    for (const npc of this.npcs) {
      const event = npc.update(dt, this.player, this.commander.legalStatus, this.world.station.position);
      if (event) this.resolveNpcFire(npc, event);

      if (npc.wantsDespawn) {
        // trader jumps out — witch-flash and gone
        this.addExplosion(npc.object.position.clone(), 0x9adfff, { count: 10, speed: 120, duration: 0.7 });
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
    if (this.input.held(...keymap().fire)) this.fireLaser();
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
      this.addTracer(npc.object.position.clone(), to, npc.role === 'thargoid' || npc.role === 'thargon' ? 0xd05cff : 0xff5c40, 0.22);
      if (hit) this.applyPlayerDamage(0.1 + Math.random() * 0.12, npc.object.position);
      return;
    }
    // NPC shooting NPC
    const target = event.at;
    this.addTracer(npc.object.position.clone(), target.object.position.clone(), 0xffaa55, 0.18);
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
          this.hud.showMessage('HOLD FULL — CANISTER LOST', 3);
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

  private massLocked(): boolean {
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

    switch (this.mode) {
      case 'docked':
        if (i.pressed('KeyL')) this.launch();
        else if (i.pressed('KeyM')) {
          this.mode = 'market';
          this.marketSelected = 0;
          renderMarket(this.system, this.market, this.commander, this.marketSelected);
        } else if (i.pressed('KeyE')) {
          this.mode = 'equip';
          this.equipSelected = 0;
          renderEquip(this.system, this.commander, this.equipSelected);
        } else if (i.pressed('KeyN')) this.openLocalChart('docked');
        else if (i.pressed('KeyG')) this.openChart('docked');
        else if (i.pressed('KeyI')) this.openStatus('docked');
        else if (i.pressed('KeyX')) this.exportSave();
        else if (i.pressed('KeyZ')) this.importSave();
        else if (i.pressed('KeyB')) {
          const layout = toggleLayout();
          this.hud.showMessage(`KEYBOARD: ${layout.toUpperCase()} LAYOUT`, 3);
          renderDockedMenu(this.system, this.commander, this.missionText());
        }
        break;

      case 'market':
        this.handleMarketInput();
        break;

      case 'equip':
        this.handleEquipInput();
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

      case 'status':
        if (i.pressed('Escape')) this.closeOverlay();
        break;

      case 'flight':
        for (let v = 0; v < 4; v++) {
          if (i.pressed(`Digit${v + 1}`)) this.setView(v);
        }
        if (i.pressed('KeyG')) this.openChart('flight');
        else if (i.pressed('KeyN')) this.openLocalChart('flight');
        else if (i.pressed('KeyI')) this.openStatus('flight');
        else if (i.pressed('KeyT')) this.acquireLock();
        else if (i.pressed('KeyM')) this.launchMissile();
        else if (i.pressed('KeyU')) {
          if (this.targetLock) {
            this.targetLock = null;
            this.hud.showMessage('MISSILE DISARMED', 2);
            sfx.beep(500, 0.06);
          }
        } else if (i.pressed('KeyE')) this.triggerEcm();
        else if (i.pressed('KeyK')) this.toggleCombatComputer();
        else if (i.pressed('Tab')) this.detonateEnergyBomb();
        else if (i.pressed('KeyC')) this.dockingComputer();
        else if (i.pressed('KeyH')) {
          if (i.held('ShiftLeft', 'ShiftRight')) this.galacticJump();
          else this.startHyperspace();
        }
        else if (i.pressed('KeyJ')) {
          if (this.massLocked()) {
            this.hud.showMessage('MASS LOCKED', 2);
            sfx.beep(220);
          } else {
            this.torusEngaged = !this.torusEngaged;
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

  private openChart(from: 'docked' | 'flight'): void {
    this.mode = 'chart';
    this.returnMode = from;
    this.chartFind = null;
    this.chartEstimate = false;
    const cur = this.system;
    this.chart.cursorX = cur.x;
    this.chart.cursorY = cur.y;
    renderChart(this.systems, this.commander, this.chart);
  }

  private openLocalChart(from: 'docked' | 'flight'): void {
    this.mode = 'local';
    this.returnMode = from;
    this.chartFind = null;
    this.chartEstimate = false;
    const cur = this.system;
    this.chart.cursorX = cur.x;
    this.chart.cursorY = cur.y;
    renderLocalChart(this.systems, this.commander, this.chart);
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

  private openStatus(from: 'docked' | 'flight'): void {
    this.mode = 'status';
    this.returnMode = from;
    renderStatus(this.systems, this.commander, this.chart.targetIndex, LEGAL_NAMES[this.commander.legalStatus]);
  }

  private closeOverlay(): void {
    if (this.returnMode === 'docked') {
      this.mode = 'docked';
      renderDockedMenu(this.system, this.commander, this.missionText());
    } else {
      this.mode = 'flight';
      hideScreen();
    }
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

  private handleMarketInput(): void {
    const i = this.input;
    let changed = false;
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.marketSelected = (this.marketSelected + this.market.length - 1) % this.market.length;
      changed = true;
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.marketSelected = (this.marketSelected + 1) % this.market.length;
      changed = true;
    }
    if (i.pressed('KeyB')) {
      const m = this.market[this.marketSelected];
      const cost = Math.round(m.price * 10);
      const isTonnes = m.unit === 't';
      if (m.quantity <= 0) sfx.beep(220);
      else if (this.commander.credits < cost) sfx.beep(220);
      else if (isTonnes && cargoTonnes(this.commander) >= cargoCapacity(this.commander)) sfx.beep(220);
      else {
        m.quantity -= 1;
        this.commander.cargo[this.marketSelected] += 1;
        this.commander.credits -= cost;
        sfx.beep(900, 0.05);
      }
      changed = true;
    }
    if (i.pressed('KeyV')) {
      const m = this.market[this.marketSelected];
      if (this.commander.cargo[this.marketSelected] > 0) {
        this.commander.cargo[this.marketSelected] -= 1;
        m.quantity += 1;
        this.commander.credits += Math.round(m.price * 10);
        sfx.beep(700, 0.05);
      } else {
        sfx.beep(220);
      }
      changed = true;
    }
    if (i.pressed('Escape')) {
      this.closeOverlay();
      return;
    }
    if (changed) renderMarket(this.system, this.market, this.commander, this.marketSelected);
  }

  private handleEquipInput(): void {
    const i = this.input;
    const rows = equipRows(this.system, this.commander);
    let changed = false;
    if (i.pressed('ArrowUp') || i.pressed('KeyW')) {
      this.equipSelected = (this.equipSelected + rows.length - 1) % rows.length;
      changed = true;
    }
    if (i.pressed('ArrowDown') || i.pressed('KeyS')) {
      this.equipSelected = (this.equipSelected + 1) % rows.length;
      changed = true;
    }
    if (i.pressed('KeyB') || i.pressed('Enter')) {
      this.buyEquipment(rows[this.equipSelected].id);
      changed = true;
    }
    if (i.pressed('Escape')) {
      this.closeOverlay();
      return;
    }
    if (changed) renderEquip(this.system, this.commander, this.equipSelected);
  }

  private buyEquipment(id: string): void {
    const c = this.commander;
    const row = equipRows(this.system, c).find((r) => r.id === id)!;
    if (row.status !== '' || (row.price <= 0 && id !== 'fuel')) {
      sfx.beep(220);
      return;
    }
    if (c.credits < row.price) {
      this.hud.showMessage('INSUFFICIENT CREDITS', 2);
      sfx.beep(220);
      return;
    }
    c.credits -= row.price;
    switch (id) {
      case 'fuel': c.fuel = MAX_FUEL; break;
      case 'missile': c.missiles = Math.min(MAX_MISSILES, c.missiles + 1); break;
      case 'largeBay': c.equipment.largeBay = true; break;
      case 'ecm': c.equipment.ecm = true; break;
      case 'rearLaser': c.equipment.rearLaser = true; break;
      case 'leftLaser': c.equipment.leftLaser = true; break;
      case 'rightLaser': c.equipment.rightLaser = true; break;
      case 'beam':
        c.credits += 4000; // pulse laser refunded, as per the manual
        c.equipment.laser = 'beam';
        break;
      case 'military':
        c.credits += c.equipment.laser === 'beam' ? 10000 : 4000; // old laser refunded
        c.equipment.laser = 'military';
        break;
      case 'scoops': c.equipment.scoops = true; break;
      case 'escapePod': c.equipment.escapePod = true; break;
      case 'energyBomb': c.equipment.energyBomb = true; break;
      case 'energyUnit': c.equipment.energyUnit = true; break;
      case 'dockingComputer': c.equipment.dockingComputer = true; break;
      case 'miningLaser': c.equipment.miningLaser = true; break;
      case 'combatComputer': c.equipment.combatComputer = true; break;
      case 'galacticDrive': c.equipment.galacticDrive = true; break;
    }
    saveCommander(c);
    sfx.beep(600, 0.08);
  }

  // --- HUD -----------------------------------------------------------------

  private renderHud(dt: number): void {
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

    // docking aid: shown approaching the slot side within 3km
    let dockAid: import('../hud/hud').HudState['dockAid'] = null;
    if (this.mode === 'flight' && !this.witchspace) {
      const st = this.world.station;
      const dist = this.player.position.distanceTo(st.position);
      if (dist < 3000) {
        const slotN = this.tmp.set(0, 0, -1).applyQuaternion(st.quaternion);
        const onSlotSide = this.tmp2.copy(this.player.position).sub(st.position).dot(slotN) > 0;
        if (onSlotSide) {
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
        assist: this.ccEngaged,
      },
      this.player.position,
      this.player.quaternion,
      contacts,
      compassTarget,
    );
  }
}
