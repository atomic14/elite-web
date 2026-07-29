// The world step: one slice of time, with nothing on screen.
//
// Everything that used to be `updateFlight` and its five phases lived as
// private methods of game.ts, which meant the simulation could only advance
// with a HUD, a keyboard and a WebGL context standing behind it. That is the
// one thing between this project and training its AI against the real engine
// instead of the parallel simulator in src/ai-training.
//
// So the phases moved here, and the fourteen `hud.showMessage` calls inside
// them became RETURNED EVENTS — the same pattern as combat.ts, ordnance.ts and
// trumbles.ts: *this decides and reports, the orchestrator applies*. The step
// draws nothing, reads no clock, touches no DOM and never asks who is calling
// it. `npm test` steps it under node with no Hud at all.
//
// What is NOT here, and why: the consequences that reach outside the sky —
// paying a bounty, moving your legal status, writing the save, opening the
// station menu, ending the run. Those are the Game's, and the step asks for
// them through `StepHost` (below). That interface is the remaining seam, and
// it is deliberately a list of verbs rather than "the Game": a test implements
// it in fifteen lines, which is what makes this file testable at all.
//
// The order of the phases is load-bearing and unchanged: ships move before
// they are separated, are separated before they are billed, and the player's
// systems recharge after everything that could have damaged them. So is the
// order of every `random()` draw — the world replays byte-identically from a
// seed, and moving a draw across a branch would silently change every seeded
// outcome (see game/rng.ts).

import * as THREE from 'three';

import { COMMODITIES, type StarSystem } from '../galaxy/galaxy.ts';
import { sfx } from '../audio.ts';
import type { FlightDemand } from '../player.ts';
import { cargoCapacity, cargoTonnes, MAX_FUEL } from './commander.ts';
import { carryingContraband, SCAN_RANGE } from './law.ts';
import { playerVsNpcs, npcVsNpcs, npcsVsStation, RAM_DAMAGE } from './collisions.ts';
import { assignNpcTargets } from './npc-targeting.ts';
import { stepEncounters, AMBUSH_STANDOFF } from './encounters.ts';
import { spawnArrivingTrader } from './spawning.ts';
import { TRADER_ARRIVAL_RANGE } from './world.ts';
import { planDocking, dockingOutcome } from './docking.ts';
import { regenerate, updateCabinTemp, scoopFuel } from './systems.ts';
import { stepTrumbles, trumbleMessage } from './trumbles.ts';
import { npcHitChance, npcShotDamage, NPC_VS_NPC_HIT, NPC_VS_NPC_DAMAGE } from './gunnery.ts';
import { Ordnance, ordnanceMessage, type OrdnanceReply } from './ordnance.ts';
import type { NpcShip, FireEvent } from './npc.ts';
import { random, randomInt, randomDirection } from './rng.ts';
import { AUTOSAVE_INTERVAL, type GameState } from './state.ts';

/** Fly this close to the sun and the ship is gone, temperature or not. */
export const SUN_KILL_DIST = 21_000;

/** view quaternions: front, rear, left, right (yaw about ship Y) */
export const VIEW_QUATS = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((a) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));

const ZERO = new THREE.Vector3();

/**
 * Direction the given view faces, in world space.
 *
 * Not where the NOSE points, which is why a rear-view shot hits what is behind
 * you. Lives here because the step needs it (the missile lock) and the Game
 * needs it for the gun, the sight and the dashboard — one home.
 */
export function viewDirection(
  quaternion: THREE.Quaternion, view: number, out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(0, 0, -1).applyQuaternion(VIEW_QUATS[view]).applyQuaternion(quaternion);
}

/**
 * Anything close enough to hold the torus drive down.
 *
 * A free function over the state, so the flight keys and the step share one
 * rule and `window.__game.massLocked()` keeps working for the harnesses.
 */
export function massLocked(state: GameState): boolean {
  const { player, world } = state;
  if (player.position.distanceTo(world.station.position) < 5000) return true;
  if (player.position.distanceTo(world.planetPos) - world.planetRadius < 4000) return true;
  for (const npc of world.npcs) {
    if (npc.alive && npc.role !== 'asteroid' &&
        npc.object.position.distanceTo(player.position) < 4500) return true;
  }
  return false;
}

/**
 * What the step reports for the orchestrator to say out loud.
 *
 * One variant today — everything the phases used to put on the HUD directly.
 * A union rather than a bare list of strings because the next thing to come
 * out of the step belongs here too, and because it then reads the same as
 * CombatEvent and OrdnanceEvent, which is the point.
 */
export type StepEvent =
  | { kind: 'message'; text: string; seconds: number };

const say = (text: string, seconds: number): StepEvent => ({ kind: 'message', text, seconds });

/**
 * The consequences the step cannot own, and asks the orchestrator for.
 *
 * Every one of these reaches outside the sky: it pays a bounty, moves your
 * legal status, writes localStorage, opens a screen or ends the run. The rule
 * from ARCHITECTURE.md is that a module may not depend on the shape of its
 * caller — so this is not "the Game", it is the eleven verbs the world step
 * genuinely needs, small enough for a test to implement and stub.
 *
 * Two of them (`applyPlayerDamage`, `fireLaser`) keep their game.ts names on
 * purpose: test/combat-recorder.js monkey-patches those methods to measure a
 * fight a human flew, and renaming them would break the one harness that can.
 */
export interface StepHost {
  /** is the ship still flying? `Game.mode` is a screen-stack question */
  inFlight(): boolean;
  /** the player took a hit — shields, hull, the damage flash, and maybe death */
  applyPlayerDamage(amount: number, from: THREE.Vector3): void;
  /** a kill credited to the player: bounty, rating, contracts, the law */
  destroyNpc(npc: NpcShip): void;
  /** a ship out of the sky with no credit to anyone */
  wreckNpc(npc: NpcShip): void;
  /** pull the trigger in the current view */
  fireLaser(): void;
  /** an offence witnessed — which is what scrambles the station's Vipers */
  raiseLegal(level: number): void;
  /** the run ends */
  die(reason: string): void;
  /** we threaded the slot: the station takes over */
  dock(): void;
  /** the countdown reached zero */
  completeHyperspace(): void;
  /** the distress beacon was answered */
  completeRescue(): void;
  /** alongside a rock hermit, slow enough to trade */
  openHermitTrade(): void;
  /** write the world down */
  autoSave(): void;
}

/**
 * Who is flying, and whether the human has their hands on the controls.
 *
 * The demand is produced OUTSIDE the step — by a keyboard
 * (engine/flight-controls.ts), by the combat computer, or by a harness writing
 * four numbers down. `handsOn` is the only other thing the step needs to know
 * about the input device, and it is a boolean rather than an `Input`: touching
 * the controls drops the docking computer.
 */
export interface PilotInput {
  demand: FlightDemand;
  handsOn: boolean;
}

/**
 * One slice of the world, advanced.
 *
 * Holds the state, the missiles and the host — and its own scratch vectors, so
 * stepping at 60Hz allocates nothing.
 */
export class WorldStep {
  private readonly state: GameState;
  private readonly ordnance: Ordnance;
  private readonly host: StepHost;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpM = new THREE.Matrix4();
  /** scratch for collisions.ts, so a per-frame call allocates nothing */
  private readonly scratch = { a: new THREE.Vector3(), b: new THREE.Vector3() };

  constructor(state: GameState, ordnance: Ordnance, host: StepHost) {
    this.state = state;
    this.ordnance = ordnance;
    this.host = host;
  }

  /**
   * One frame of flight, in five phases. Each is a method so this reads as an
   * order of operations rather than a wall — and the order matters: ships move
   * before they are separated, are separated before they are billed, and the
   * player's systems recharge after everything that could have damaged them.
   */
  step(dt: number, elapsed: number, pilot: PilotInput): StepEvent[] {
    const out: StepEvent[] = [];
    this.flyPlayer(dt, elapsed, pilot, out);
    this.stepNpcs(dt, out);
    this.stepProjectilesAndEffects(dt, out);
    if (this.stepShipSystems(dt, pilot.demand, out)) return out;  // died in the attempt
    this.checkHazards(out);
    return out;
  }

  /** Anything close enough to hold the torus drive down. */
  massLocked(): boolean { return massLocked(this.state); }

  /**
   * The player's own motion: one demand, applied. The docking computer still
   * steers on top (it asks for a HEADING, not a rate — the one pilot left
   * outside the seam) and the torus adds its own translation.
   */
  private flyPlayer(dt: number, elapsed: number, pilot: PilotInput, out: StepEvent[]): void {
    const { player, session, world } = this.state;
    player.update(dt, pilot.demand);
    if (session.dcEngaged) this.dockingComputerStep(dt, pilot.handsOn, out);

    // torus drive
    if (session.torusEngaged) {
      if (this.massLocked()) {
        session.torusEngaged = false;
        out.push(say('MASS LOCK — TORUS DISENGAGED', 3));
        sfx.beep(300);
      } else {
        player.position.addScaledVector(
          player.getForward(this.tmp), player.speed * 7 * dt);
      }
    }

    world.update(dt, elapsed);
  }

  /**
   * One frame of the docking computer. Steers and throttles only — the actual
   * docking is still decided by checkStation()'s slot and roll test, exactly
   * as it is when you fly in by hand. The autopilot has to genuinely thread
   * the letterbox; it gets no dispensation.
   */
  private dockingComputerStep(dt: number, handsOn: boolean, out: StepEvent[]): void {
    const { player, session, world } = this.state;
    if (handsOn) {
      session.dcEngaged = false;
      sfx.stopDockingMusic();
      out.push(say('MANUAL OVERRIDE', 2));
      return;
    }
    const station = world.station;
    const plan = planDocking(
      player.position, station, world.stationDockZ, player.maxSpeed, this.state.dockPlan);
    this.tmpM.lookAt(ZERO, plan.heading, plan.up);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    player.quaternion.rotateTowards(this.tmpQ, 1.2 * dt);
    player.speed += (plan.speed - player.speed) * Math.min(1, dt * 1.5);
  }

  /** Everyone else: decisions, despawns, collisions, and who else turns up. */
  private stepNpcs(dt: number, out: StepEvent[]): void {
    const s = this.state;
    const { world, player, session } = s;

    // periodic NPC-vs-NPC targeting: pirates prey on traders, the law hunts pirates
    session.npcTargetTimer -= dt;
    if (session.npcTargetTimer <= 0) {
      session.npcTargetTimer = 2;
      assignNpcTargets(world.npcs, player.position, s.commander.legalStatus);
    }

    // Snapshot: despawns and destructions below rebuild world.npcs, and the
    // fleet handed to update() should be consistent for every ship in the
    // frame rather than shrinking underneath the loop.
    for (const npc of [...world.npcs]) {
      const event = npc.update(dt, player, s.commander.legalStatus,
        world.station, world.npcs, world.stationDockZ);
      if (event) this.resolveNpcFire(npc, event, out);

      if (npc.wantsDespawn) {
        // A ship that JUMPED OUT gets the witch-flash. A ship that DOCKED gets
        // nothing: it flew into the slot, which is not an event that emits
        // particles. It used to get a smaller, paler burst from the same
        // explosion system, and from outside that is indistinguishable from
        // watching it blow up — reported as exactly that, by someone watching
        // a trader line up perfectly and then apparently detonate.
        if (!npc.docked) {
          world.effects.explosion(npc.object.position.clone(), 0x9adfff,
            { count: 10, speed: 120, duration: 0.7 });
        }
        world.despawn(npc);
        continue;
      }
    }

    // Ships are solid. The geometry lives in collisions.ts; what it costs is
    // decided here, because the price is not symmetric — the player's shields
    // absorb a ram, two NPCs bumping must not credit the player with anything,
    // and bouncing off the station is free.
    for (const npc of playerVsNpcs(
      player.position, (k) => { player.speed *= k; }, world.npcs, this.scratch)) {
      this.host.applyPlayerDamage(RAM_DAMAGE, npc.object.position);
      out.push(say('COLLISION', 2));
      if (npc.takeDamage(RAM_DAMAGE, player.position, true)) this.host.destroyNpc(npc);
    }

    const wrecked: NpcShip[] = [];
    for (const [a, b] of npcVsNpcs(world.npcs, this.scratch)) {
      const aPos = a.object.position.clone();
      if (a.takeDamage(RAM_DAMAGE, b.object.position, false)) wrecked.push(a);
      if (b.takeDamage(RAM_DAMAGE, aPos, false)) wrecked.push(b);
    }
    // wreckNpc, NOT destroyNpc — see npcVsNpcs
    for (const n of wrecked) this.host.wreckNpc(n);

    npcsVsStation(world.npcs, world.station, world.stationDockZ + 40, this.scratch);

    // What turns up, and when: rules in encounters.ts, spawning here.
    const here = this.system();
    for (const order of stepEncounters(s.encounterTimers, dt, {
      witchspace: session.witchspace,
      productivity: here.productivity,
      government: here.government,
      traderCount: world.npcs.filter((n) => n.role === 'trader').length,
      activeThargons: world.npcs.filter((n) => n.alive && n.role === 'thargon' && !n.inert).length,
      hasThargoidMother: world.npcs.some((n) => n.alive && n.role === 'thargoid'),
      playerFarFromStation:
        player.position.distanceTo(world.station.position) > AMBUSH_STANDOFF,
    })) {
      if (order.kind === 'trader') {
        spawnArrivingTrader(world, TRADER_ARRIVAL_RANGE);
      } else if (order.kind === 'pirateWave') {
        for (let i = 0; i < order.count; i++) {
          world.spawn('pirate',
            player.position.clone().add(randomDirection(new THREE.Vector3())
              .multiplyScalar(9000 + random() * 4000)),
            i + randomInt(4));
        }
        out.push(say('PIRATE SIGNATURES DETECTED', 4));
      } else {
        const mother = world.npcs.find((n) => n.alive && n.role === 'thargoid')!;
        world.spawn('thargon',
          mother.object.position.clone().add(
            randomDirection(new THREE.Vector3()).multiplyScalar(150)),
          randomInt(8));
      }
    }
  }

  /** Cargo, missiles, and the things that are only ever seen. */
  private stepProjectilesAndEffects(dt: number, out: StepEvent[]): void {
    const { world, player, commander } = this.state;
    // The field drifts them and says what we reached; what it is worth is
    // ours to decide, because it touches the hold, legal status and damage.
    for (const { canister: c } of world.cargo.update(dt, player.position)) {
      if (!commander.equipment.scoops) {
        this.host.applyPlayerDamage(0.06, c.object.position);
        out.push(say('CANISTER DESTROYED ON HULL', 2));
      } else if (cargoTonnes(commander) >= cargoCapacity(commander)) {
        out.push(say(
          c.kind === 'capsule' ? 'HOLD FULL — CAPSULE LOST' : 'HOLD FULL — CANISTER LOST', 3));
      } else if (c.kind === 'capsule') {
        // A person, not stock. See CommanderData.survivors — this was
        // `cargo[3] += 1` and commodity 3 is Slaves, so rescuing someone made
        // you a smuggler and the next police scan made you an Offender.
        commander.survivors += 1;
        out.push(say('SURVIVOR ABOARD', 4));
        sfx.beep(600, 0.12);
      } else {
        commander.cargo[c.commodity] += 1;
        out.push(say(`SCOOPED 1t ${COMMODITIES[c.commodity].name.toUpperCase()}`, 3));
        sfx.beep(950, 0.08);
      }
    }
    this.updateEncounters(out);

    this.applyOrdnance(dt, out);
    world.effects.update(dt);
  }

  /** Apply what the ordnance did. It reports; the consequences are ours. */
  private applyOrdnance(dt: number, out: StepEvent[]): void {
    const { world, player } = this.state;
    for (const e of this.ordnance.step(dt, player.position)) {
      if (e.kind === 'killed') {
        e.npc.takeDamage(99, undefined, true);
        this.host.destroyNpc(e.npc);
      } else if (e.kind === 'hitPlayer') {
        world.effects.explosion(e.at, 0xff8866);
        sfx.explosion();
        this.host.applyPlayerDamage(e.damage, e.at);
      } else if (e.kind === 'ecmDefeated') {
        world.effects.explosion(e.at, 0xffb444, { count: 12, duration: 0.8 });
        this.state.ecmDetectedTimer = 2;
        out.push(say('TARGET E.C.M. — MISSILE DESTROYED', 3));
        sfx.ecm();
      } else {
        world.effects.explosion(e.at, 0xffb444, { count: 12, duration: 0.8 });
      }
    }
  }

  /**
   * The commander's own ship: guns, recharge, heat, and the warnings that go
   * with them. @returns true if the frame ended in death.
   */
  private stepShipSystems(dt: number, demand: FlightDemand, out: StepEvent[]): boolean {
    const s = this.state;
    const { commander, session, sys, player, world } = s;
    // laser + systems. The trigger came in with the rest of the demand — from
    // the hands, the combat computer, or both — and is pulled HERE because
    // this is where the gun's heat and energy live.
    if (demand.fire) this.host.fireLaser();
    regenerate(sys, dt, { energyUnit: commander.equipment.energyUnit });

    const sunDist = player.position.distanceTo(world.sunPos);
    if (updateCabinTemp(sys, dt, sunDist)) {
      this.host.die('CABIN TEMPERATURE CRITICAL');
      return true;
    }
    const scooped = scoopFuel(
      dt, sunDist, commander.equipment.scoops, commander.fuel, MAX_FUEL);
    if (scooped > 0) {
      commander.fuel += scooped;
      out.push(say('FUEL SCOOPING', 0.4));
    }

    session.autoSaveTimer -= dt;
    if (session.autoSaveTimer <= 0) {
      session.autoSaveTimer = AUTOSAVE_INTERVAL;
      this.host.autoSave();
    }

    if (s.ecmDetectedTimer > 0) s.ecmDetectedTimer -= dt;
    this.updateTrumbles(dt, out);

    if (session.beaconTimer > 0) {
      session.beaconTimer -= dt;
      if (session.beaconTimer <= 0) this.host.completeRescue();
    } else if (session.witchspace && commander.fuel < 10 && session.beaconTimer < 0) {
      session.strandedHintTimer -= dt;
      if (session.strandedHintTimer <= 0) {
        session.strandedHintTimer = 8;
        out.push(say('NO FUEL TO JUMP — PRESS B FOR THE DISTRESS BEACON', 5));
      }
    }

    // flashing low-energy warning
    if (sys.energy < 1) {
      session.energyLowTimer -= dt;
      if (session.energyLowTimer <= 0) {
        session.energyLowTimer = 1.2;
        out.push(say('ENERGY LOW', 0.6));
        sfx.beep(320, 0.1);
      }
    }

    // police scan for illegal cargo
    if (!session.policeScanned && !session.witchspace) {
      if (carryingContraband(commander.cargo)) {
        const policeNear = world.npcs.some((n) =>
          n.alive && n.role === 'police' &&
          n.object.position.distanceTo(player.position) < SCAN_RANGE);
        if (policeNear) {
          session.policeScanned = true;
          this.host.raiseLegal(1);
          out.push(say('POLICE SCAN: CONTRABAND DETECTED', 4));
        }
      }
    }

    // hyperspace countdown
    if (session.hyperCountdown >= 0) {
      const prev = Math.ceil(session.hyperCountdown);
      session.hyperCountdown -= dt;
      const now = Math.ceil(session.hyperCountdown);
      if (now !== prev && now > 0) {
        out.push(say(`HYPERSPACE IN ${now}`, 1.2));
        sfx.beep(700 + (5 - now) * 100, 0.07);
      }
      if (session.hyperCountdown <= 0) {
        session.hyperCountdown = -1;
        this.host.completeHyperspace();
        return true;
      }
    }

    return !this.host.inFlight();
  }

  /** Trumbles breed and eat; heat drives them out. Rules in trumbles.ts. */
  private updateTrumbles(dt: number, out: StepEvent[]): void {
    const s = this.state;
    const r = stepTrumbles(s.commander, dt, s.sys.cabinTemp, s.session.trumbleTimer);
    s.session.trumbleTimer = r.timer;
    for (const e of r.events) {
      const secs = e.kind === 'purged' ? 5 : e.kind === 'fleeing' ? 1.5 : e.kind === 'ate' ? 4 : 2;
      out.push(say(trumbleMessage(e), secs));
      if (e.kind === 'ate') sfx.beep(500, 0.1);
    }
  }

  /** Ground, sun and station — the ways a leg ends without a countdown. */
  private checkHazards(out: StepEvent[]): void {
    const { player, world } = this.state;
    const sunDist = player.position.distanceTo(world.sunPos);
    const altitude = player.position.distanceTo(world.planetPos) - world.planetRadius;
    if (altitude < 80) {
      this.host.die('CRASHED INTO THE PLANET');
      return;
    }
    if (sunDist < SUN_KILL_DIST) {
      this.host.die('FLEW INTO THE SUN');
      return;
    }
    this.checkStation(out);

    const lock = this.ordnance.targetLock;
    if (lock && !lock.alive) this.ordnance.targetLock = null;
    this.updateMissileLock(out);
  }

  /**
   * Are we down, bounced, or clear? The geometry is docking.ts's; what it
   * costs is ours.
   */
  private checkStation(out: StepEvent[]): void {
    const { player, world } = this.state;
    const station = world.station;
    const outcome = dockingOutcome(
      player.position, player.quaternion, station, world.stationDockZ,
      { v: this.tmp, q: this.tmpQ, r: this.tmp2 });
    if (outcome === 'clear') return;
    if (outcome === 'docked') {
      this.host.dock();
      return;
    }
    // hit the hull, or fluffed the slot
    const away = this.tmp2.copy(player.position).sub(station.position).normalize();
    player.position.copy(station.position).addScaledVector(away, 420);
    player.speed = 0;
    this.host.applyPlayerDamage(0.9, station.position);
    out.push(say(
      outcome === 'slotMiss' ? 'DOCKING FAILURE — MATCH SLOT ROTATION' : 'COLLISION', 3));
  }

  /** While armed, lock onto whatever enters the sight. Ordnance reports; we say it. */
  private updateMissileLock(out: StepEvent[]): void {
    const { player, session } = this.state;
    this.reply(this.ordnance.updateLock(
      player.position, viewDirection(player.quaternion, session.view, this.tmp)), out);
  }

  /** Rock hermits offer trade; generation ships offer only awe. */
  private updateEncounters(out: StepEvent[]): void {
    const { world, player, session } = this.state;
    for (const npc of world.npcs) {
      if (!npc.alive) continue;
      const dist = npc.object.position.distanceTo(player.position);
      if (npc.role === 'hermit') {
        // must leave and come back before trading again, or you'd be stuck
        // in a docking loop while parked alongside
        if (dist > 900) session.hermitCooldown = false;
        if (dist < 900 && !session.hermitCooldown) {
          out.push(say('ROCK HERMIT — SLOW TO 20 AND CLOSE TO TRADE', 2));
        }
        if (dist < 320 && player.speed < 40 && this.host.inFlight() && !session.hermitCooldown) {
          this.host.openHermitTrade();
        }
      } else if (npc.role === 'generation' && dist < 6000 && !session.genShipSeen) {
        session.genShipSeen = true;
        out.push(say('DERELICT GENERATION SHIP — NO LIFE SIGNS', 6));
        sfx.beep(140, 0.5);
      }
    }
  }

  /** An NPC asked to fire. The ship chose the weapon; we roll the dice. */
  private resolveNpcFire(npc: NpcShip, event: FireEvent, out: StepEvent[]): void {
    const { world, player } = this.state;
    if (event.at === 'player') {
      // The SHIP chose the weapon (npc.ts chooseWeapon); we only apply it.
      if (event.weapon === 'missile') {
        npc.missiles -= 1;
        this.reply(this.ordnance.launchHostile(npc.nosePosition(this.tmp).clone()), out);
        return;
      }
      const dist = npc.object.position.distanceTo(player.position);
      sfx.enemyLaser();
      const hit = random() < npcHitChance(dist);
      // visible bolt: to us on a hit, wide of us on a miss
      const to = hit
        ? player.position.clone()
        : player.position.clone().add(
            randomDirection(new THREE.Vector3()).multiplyScalar(80 + random() * 140));
      world.effects.tracer(
        npc.nosePosition(this.tmp).clone(), to,
        npc.role === 'thargoid' || npc.role === 'thargon' ? 0xd05cff : 0xff5c40, 0.22);
      if (hit) this.host.applyPlayerDamage(npcShotDamage(random()), npc.object.position);
      return;
    }
    // NPC shooting NPC
    const target = event.at;
    world.effects.tracer(
      npc.nosePosition(this.tmp).clone(), target.object.position.clone(), 0xffaa55, 0.18);
    if (random() < NPC_VS_NPC_HIT) {
      if (target.takeDamage(NPC_VS_NPC_DAMAGE, npc.object.position)) {
        this.host.wreckNpc(target); // no player credit
      }
    }
  }

  /** Ordnance reports what it did; saying it is ours. */
  private reply(r: OrdnanceReply | null, out: StepEvent[]): void {
    if (!r) return;
    const m = ordnanceMessage(r);
    out.push(say(m.text, m.seconds));
  }

  /** Where we are, for the encounter rules. */
  private system(): StarSystem {
    return this.state.systems[this.state.commander.systemIndex];
  }
}
