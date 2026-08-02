// Writing the world down, and putting it back.
//
// The four methods here — capture, restore, autoSave, resume — were private to
// game.ts, which is why the shape of the save was only ever checkable by
// GREPPING game.ts for field names (test/run.ts did exactly that, and the
// comment it was checking against was wrong). They are the same four methods,
// moved intact: `snapshot.ts` says what a save LOOKS like, `storage.ts` says
// where it lives, and this says how the running world turns into one and back.
//
// The pattern is the project's: a module decides, the orchestrator applies.
// Restoring is the one place that cannot be purely declarative — putting a
// world back means REBUILDING it, and a rebuild spawns ships, opens the
// station menu and rerolls a market. Those reach outside the state, so they
// come in through `PersistenceHost` (below), exactly as the world step asks for
// its consequences through `StepHost`.
//
// TWO ORDERINGS ARE LOAD-BEARING and neither is obvious:
//
//   1. The galaxy is rebuilt BEFORE the ships are placed, because an NPC's
//      position is only meaningful against a station that exists.
//   2. `restoreRng` is LAST. Everything above it — buildWorld, enterWitchspace,
//      enterDocked — draws from the seeded stream, and the whole point of
//      saving the generator's *state* rather than its seed is that the next
//      draw after a reload is the draw the run was about to make.
//
// This file is NOT in the `purity` list in test/run.ts and should not be: it
// reaches persistence through its host. Everything it does to the state,
// though, it does without a renderer.

import { generateGalaxy, type MarketEntry } from '../galaxy/galaxy.ts';
import { LivingGalaxy } from '../galaxy/living.ts';
import type { Contract } from './commander.ts';
import type { PirateThreat } from './threat.ts';
import { CONSTRICTOR_SPEC, pirateSpecForTier, specForDesign } from './ship-specs.ts';
import type { NpcRole } from './ship-roles.ts';
import { migratedPlayerHullId } from './ship-identity.ts';
import { migratedSystems } from './systems.ts';
import type { CombatComputer } from './combat-computer.ts';
import type { Ordnance } from './ordnance.ts';
import { rngState, restoreRng } from './rng.ts';
import {
  SNAPSHOT_VERSION, v3, q4, serialiseState, restoreState,
  type WorldSnapshot,
} from './snapshot.ts';
import type { GameState } from './state.ts';

/**
 * What restoring a world needs the orchestrator to do.
 *
 * Restore verbs, lifecycle questions, and the narrow persistence operations
 * that reach outside `GameState`: rebuilding the scene, re-entering witch-space
 * (which SPAWNS, and therefore draws), the mode machine, and the store, all of
 * which belong to the Game. Still small enough for a test fixture to own.
 */
export interface PersistenceHost {
  /** where the ship is right now — a snapshot records flight or docked */
  baseMode(): 'docked' | 'flight' | 'dead';
  /**
   * Put the ship into the restored mode: clear the screen stack, and either
   * open the station or hand the sky back. The mode machine has one writer and
   * it is not this file.
   */
  enterMode(mode: 'docked' | 'flight'): void;
  /** rebuild the scene for the commander's current system */
  buildWorld(): void;
  /** back into mis-jump limbo — spawns Thargoids, so it DRAWS from the rng */
  enterWitchspace(): void;
  /** has the run ended? a dead commander's world must never be written */
  isDead(): boolean;
  /** something to say out loud */
  message(text: string, seconds: number): void;
  /**
   * The three writes, and they are three because a save says what it IS.
   *
   * `dock` is the checkpoint (docking, and immediately before launch), `flight`
   * is the ring that must never evict it, and `named` is the one the player
   * asked for and which no automatic write can address. storage.ts owns the
   * key shapes that make the last sentence true.
   */
  writeDockSave(career: string, world: WorldSnapshot): boolean;
  writeFlightSave(career: string, world: WorldSnapshot): boolean;
  writeNamedSave(name: string, career: string, world: WorldSnapshot): 'ok' | 'full' | 'failed';
  /** The world this session resumes, if the save it booted from carries one. */
  bootWorld(): WorldSnapshot | null;
  /** Drop a career's in-flight ring — on docking, and on death. */
  clearFlightSaves(career: string): void;
  /**
   * Refuse save writes for a span, returning the keys that would have changed.
   *
   * The storage implementation owns the guard; Persistence only needs this
   * narrow capability to restore a simulator entry without risking its career.
   */
  withoutSaving<T>(fn: () => T): { value: T; refused: string[] };
}

export class Persistence {
  private readonly state: GameState;
  private readonly ordnance: Ordnance;
  private readonly combatComputer: CombatComputer;
  private readonly host: PersistenceHost;

  constructor(
    state: GameState, ordnance: Ordnance,
    combatComputer: CombatComputer, host: PersistenceHost,
  ) {
    this.state = state;
    this.ordnance = ordnance;
    this.combatComputer = combatComputer;
    this.host = host;
  }

  /**
   * The whole world as plain data — see snapshot.ts.
   *
   * This is what lets a commander be saved anywhere rather than only at a
   * station: the station save is the commander alone, and mid-flight there is
   * a great deal more that matters.
   */
  capture(): WorldSnapshot {
    const s = this.state;
    return {
      version: SNAPSHOT_VERSION,
      mode: this.host.baseMode() === 'flight' ? 'flight' : 'docked',
      commander: structuredClone(s.commander),
      // `s.career` is NOT written down here. It is the record's, not the
      // world's — see the note on `career` below and snapshot.ts's header.
      galaxyState: s.living.save(),
      player: {
        pos: v3(s.player.position),
        quat: q4(s.player.quaternion),
        speed: s.player.speed,
        pitchRate: s.player.pitchRate,
        rollRate: s.player.rollRate,
      },
      systems: { ...s.sys },
      // Each object saves ITSELF. These three methods were written months ago
      // and had ZERO callers, because captureSnapshot hand-inlined all three
      // while the restore side used the module methods. Capture and restore
      // living in different files is precisely the failure this keeps having.
      npcs: s.world.captureNpcs(),
      canisters: s.world.cargo.capture(),
      encounterTimers: { ...s.encounterTimers },
      dockPlan: serialiseState(s.dockPlan as unknown as Record<string, unknown>),
      combatComputer: serialiseState(
        this.combatComputer.state as unknown as Record<string, unknown>),
      lastThreat: s.lastThreat ? { ...s.lastThreat } : null,
      ecmDetectedTimer: s.ecmDetectedTimer,
      // Which brains the NPCs fly. In the snapshot because it is state the step
      // READS: as a `window.__` flag, a save restored in a fresh tab silently
      // flew the shipped brains instead of the ones the run was made with.
      brains: { ...s.brains },
      cheat: s.cheat,
      session: serialiseState(s.session as unknown as Record<string, unknown>),
      rng: rngState(),
      chartTarget: s.chart.targetIndex,
      chartCursor: [s.chart.cursorX, s.chart.cursorY],
      stationQuat: q4(s.world.station.quaternion),
      missiles: this.ordnance.capture((npc) => s.world.npcs.indexOf(npc)),
      market: structuredClone(s.market),
      hermitMarket: structuredClone(s.hermitMarket),
      contractOffers: structuredClone(s.contractOffers),
      targetLock: this.ordnance.targetLock
        ? s.world.npcs.indexOf(this.ordnance.targetLock) : -1,
      missileArmed: this.ordnance.armed,
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
  restore(snap: WorldSnapshot): void {
    if (snap.version !== SNAPSHOT_VERSION) {
      throw new Error(`snapshot version ${snap.version}, expected ${SNAPSHOT_VERSION}`);
    }
    const s = this.state;
    s.commander = structuredClone(snap.commander);
    // A world written before ships had ids carries a commander that has none.
    // Same rule as the station save (storage.ts): missing or unresolvable means
    // the Cobra Mk III every legacy career flew, never a failure to load.
    s.commander.shipId = migratedPlayerHullId(s.commander.shipId);
    // `s.career` IS NOT TOUCHED HERE, and that is the fix in docs/TODO/43.
    // Restoring a world does not change whose autosave group this session
    // writes: that was decided at boot by `bootCareer()` from the record the
    // save came off the shelf in, and for a snapshot handed straight to a
    // running session (the combat trainer, a console harness) the answer is
    // simply the career already flying. A `snap.career` assignment here
    // overwrote the record's answer one step later, so an imported file — whose
    // record is given a career nothing else is using precisely so it cannot
    // collide — pointed its autosaves at the exporting career instead.
    s.systems = generateGalaxy(s.commander.galaxy);
    s.living = new LivingGalaxy(s.systems);
    s.living.load(snap.galaxyState as Parameters<LivingGalaxy['load']>[0]);
    restoreState(s.session as unknown as Record<string, unknown>, snap.session);
    this.host.buildWorld();
    if (s.session.witchspace) this.host.enterWitchspace();

    s.player.position.set(...snap.player.pos);
    s.player.quaternion.set(...snap.player.quat);
    s.player.speed = snap.player.speed;
    s.player.pitchRate = snap.player.pitchRate;
    s.player.rollRate = snap.player.rollRate;
    // A world written before TODO 27 carries the banks on their old 1/1/4
    // maxima; one written after carries whole points on 255 and comes back
    // untouched. Same rule as the commander's hull id above: migrate, never
    // fail to load. systems.ts owns the arithmetic.
    Object.assign(s.sys, migratedSystems(snap.systems));

    // Which hull each ship gets is a GAME rule — the roster, the tier tables
    // and the Constrictor — so the World asks rather than deciding.
    //
    // THE SAVED DESIGN WINS. This used to send every pirate straight through
    // `pirateSpecForTier`, which is right for one spawned by the galaxy and
    // wrong for one that never came from a tier table: the combat trainer's
    // hull picker can put any pirate hull in the sky, and such a ship came back
    // wearing a tier hull while keeping its saved identity — so what it WAS and
    // what it looked like disagreed for the rest of the session. Looking the
    // roster row up by the design the snapshot recorded cannot disagree with
    // it. The tier is still the answer for a save written before ships had ids,
    // which carries no design to look up.
    this.ordnance.clear();
    s.world.restoreNpcs(snap.npcs, (n) => {
      if (n.state.isMissionTarget) return CONSTRICTOR_SPEC;
      const role = n.role as NpcRole;
      return specForDesign(role, n.designId)
        ?? (role === 'pirate'
          ? pirateSpecForTier(Number(n.state.threatTier ?? 0), n.seed) : undefined);
    });
    s.world.cargo.restoreAll(snap.canisters);
    this.ordnance.restoreAll(snap.missiles, (i) => s.world.npcs[i] ?? null);

    s.encounterTimers = { ...snap.encounterTimers };
    restoreState(s.dockPlan as unknown as Record<string, unknown>, snap.dockPlan);
    restoreState(
      this.combatComputer.state as unknown as Record<string, unknown>, snap.combatComputer);
    s.lastThreat = snap.lastThreat as PirateThreat | null;
    s.ecmDetectedTimer = snap.ecmDetectedTimer;
    s.chart.targetIndex = snap.chartTarget;
    [s.chart.cursorX, s.chart.cursorY] = snap.chartCursor;
    s.market = structuredClone(snap.market) as MarketEntry[];
    s.hermitMarket = structuredClone(snap.hermitMarket) as MarketEntry[];
    s.contractOffers = structuredClone(snap.contractOffers) as Contract[];
    this.ordnance.targetLock = snap.targetLock >= 0
      ? (s.world.npcs[snap.targetLock] ?? null) : null;
    this.ordnance.armed = snap.missileArmed;
    s.brains = { ...snap.brains };
    s.cheat = snap.cheat;
    s.world.station.quaternion.set(...snap.stationQuat);
    s.world.station.updateMatrixWorld(true);
    this.host.enterMode(snap.mode);

    // LAST: anything above that spawns or builds draws from the stream
    restoreRng(snap.rng);
  }

  /**
   * Restore while refusing every persistence write the rebuild may trigger.
   *
   * Returning the refused keys proves the guard was load-bearing to callers
   * such as the combat simulator, without making them know the storage module.
   */
  restoreWithoutSaving(snap: WorldSnapshot): string[] {
    return this.host.withoutSaving(() => this.restore(snap)).refused;
  }

  /**
   * Which career's autosaves this session writes. One home for the read.
   *
   * And one home for the VALUE, which is `SaveRecord.career` — `state.career`
   * is `bootCareer()`'s answer, read off the record this session booted from
   * and never written again. Every automatic write below addresses a key built
   * from it, which is why a second home for it is data loss rather than
   * untidiness: the loser of the two decides where the bytes land.
   */
  private get career(): string {
    return this.state.career;
  }

  /**
   * The docked checkpoint: written on docking and immediately before launch,
   * and again whenever something at the station moves the career (a purchase).
   *
   * It is by construction the state you left the station in, which is what the
   * death rule leans on — see `Game.die`.
   */
  checkpoint(): boolean {
    if (this.host.isDead()) return false;
    try {
      return this.host.writeDockSave(this.career, this.capture());
    } catch {
      return false;   // a world that will not serialise must not take the tab down
    }
  }

  /**
   * Write the world down mid-flight. Cheap enough to do on a timer, because the
   * whole point is that closing the tab mid-fight is not punished.
   *
   * Into the RING, never over the docked checkpoint (decision 2): a quiet three
   * minutes of flying must not evict the station you came from.
   */
  autoSave(): void {
    if (this.host.isDead()) return;
    try {
      this.host.writeFlightSave(this.career, this.capture());
    } catch { /* see checkpoint() */ }
  }

  /**
   * Save under a name the player typed. Carries the world like every other
   * save, so loading one never puts you somewhere you have never been.
   */
  saveNamed(name: string): 'ok' | 'full' | 'failed' {
    try {
      return this.host.writeNamedSave(name, this.career, this.capture());
    } catch {
      return 'failed';
    }
  }

  /** The run just ended: the last twenty seconds of it are not a save. */
  forgetFlight(): void {
    this.host.clearFlightSaves(this.career);
  }

  /**
   * Pick up exactly where the last session stopped, mid-flight if that is
   * where it was.
   *
   * @returns false if there was nothing to resume, so the caller boots
   * normally at the station.
   */
  resume(): boolean {
    const snap = this.host.bootWorld();
    if (!snap) return false;
    try {
      if (snap.version !== SNAPSHOT_VERSION) return false;
      this.restore(snap);
      if (snap.mode === 'flight') this.host.message('RESUMING FLIGHT', 3);
      return true;
    } catch {
      // a world that will not come back must never cost you the commander, and
      // it is NOT deleted for it: the save is still the player's to look at.
      return false;
    }
  }
}
