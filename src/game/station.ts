// The station: arriving at one, leaving one, and the menu in between.
//
// `enterDocked` was a 66-line method of game.ts that did nine unrelated things
// in one breath — reset the shields, hand over survivors, pay a fine, clear the
// sky, roll a market, settle the work you were carrying, write the save, shut
// the bay door and paint a menu. Half of them are consequences of docking and
// half are the docked STATE being set up, and none of them could be read
// without reading all of them.
//
// So it moved, with the two transitions that pair with it (`launch`, and the
// base screen the two of them switch between). The pattern is the project's:
// this decides and reports — `StationEvent`s the Game says out loud — and what
// it cannot own it asks for through `StationHost`.
//
// TWO THINGS ARE DELIBERATELY NOT EVENTS, and both for the same reason
// (game/rng.ts): `populateSystem` and the Navy mission step DRAW from the
// seeded stream. A draw that moved across a branch would change every seeded
// outcome after it, so they are direct host calls made at exactly the point
// they were made before. The order of the four draws in a dock — the mission's
// target, the market's seed, the offers — is the order the stream saw them in.
//
// What this file is NOT: it does not own the rules. The fine is law.ts, the
// market is contracts.ts, the mission is missions.ts, the save is storage.ts.

import * as THREE from 'three';
import { slotNormal } from '../world/slot.ts';

import type { StarSystem } from '../galaxy/galaxy.ts';
import { formatCredits } from './commander.ts';
import { fineFor, CLEAN } from './law.ts';
import { generateContractOffers, makeLocalMarket, describeContract } from './contracts.ts';
import { stepMissionAtDock, missionHeadline, constrictorWarning } from './missions.ts';
import type { Ordnance } from './ordnance.ts';
import { repairAtStation } from './systems.ts';
import type { GameState } from './state.ts';
import type { SoundEvent, SoundName } from './sounds.ts';

/** How far off the slot you sit when the bay spits you out. */
const LAUNCH_STANDOFF = 450;
/** ...and how fast. */
const LAUNCH_SPEED = 120;

/**
 * World-space outward normal of the station's slot face.
 *
 * One home for it: launching pushes you along it, and the station's Vipers
 * scramble along it. Both used to compute it themselves.
 */


/** What the station reports for the orchestrator to say out loud. */
export type StationEvent =
  | SoundEvent
  | { kind: 'message'; text: string; seconds: number }
  | { kind: 'persistence'; action: 'clearWorld' | 'saveCommander' }
  | { kind: 'presentation'; action: 'releaseMouseFlight' }
  | { kind: 'presentation'; action: 'screen'; screen: 'docked' | 'hidden' }
  | { kind: 'presentation'; action: 'tunnel'; way: 'in' | 'out' };

const say = (text: string, seconds: number): StationEvent =>
  ({ kind: 'message', text, seconds });
const heard = (name: SoundName): StationEvent => ({ kind: 'sound', name });

/**
 * What docking and launching need the orchestrator to do.
 *
 * The mode machine and the operations that DRAW stay synchronous. Pointer
 * lock, bay-door theatre, screens, persistence and sound are returned events.
 * Everything else is a direct update to `GameState`.
 */
export interface StationHost {
  /** where the ship is — the base screen is the menu or the cockpit */
  baseMode(): 'docked' | 'flight' | 'dead';
  /** the mode machine has one writer, and it is the Game */
  setBaseMode(mode: 'docked' | 'flight'): void;
  /** point the nose down `dir` */
  lookAlong(dir: THREE.Vector3): void;
  /** the traffic you meet on the way out — DRAWS, so a call and not an event */
  populateSystem(situation: 'launch'): void;
  /** pay out and expire the work you were carrying, and say what it paid */
  settleContracts(): StationEvent[];
  /** the bulletin board's cursor lives on the contracts screen */
  resetContractSelection(): void;
}

export class Station {
  private readonly state: GameState;
  private readonly ordnance: Ordnance;
  private readonly host: StationHost;

  constructor(state: GameState, ordnance: Ordnance, host: StationHost) {
    this.state = state;
    this.ordnance = ordnance;
    this.host = host;
  }

  private get system(): StarSystem {
    return this.state.systems[this.state.commander.systemIndex];
  }

  /**
   * Down on the pad.
   *
   * `booting` is the load path — the world blob is not cleared (there may not
   * be one) and none of the arrival theatre plays, because nothing arrived.
   */
  dock(booting = false): StationEvent[] {
    const s = this.state;
    const c = s.commander;
    // Direct platform effects used to happen during this method, while HUD
    // messages were applied only after it returned. Preserve that observable
    // order by returning effects first and messages second.
    const effects: StationEvent[] = [{ kind: 'dockingMusic', on: false }];
    const messages: StationEvent[] = [];

    // whatever flew us in, we're down: drop the autopilot and cut the music
    s.session.dcEngaged = false;
    this.host.setBaseMode('docked');
    // Docking supersedes the mid-flight world. Leaving it behind meant a
    // reload resumed the snapshot from BEFORE the dock: the cargo you had
    // just sold was back in the hold, the equipment you bought was gone, and
    // the next dock wrote that rolled-back commander over the good one.
    if (!booting) effects.push({ kind: 'persistence', action: 'clearWorld' });
    s.world.clearNpcs();
    this.ordnance.clear();
    // Full pools and a cold laser, and what "full" is belongs to systems.ts —
    // this used to say it in three assignments of its own, which is a second
    // home for the capacities the moment they change.
    repairAtStation(s.sys);
    s.session.hyperCountdown = -1;
    s.session.torusEngaged = false;
    s.session.ccEngaged = false;
    this.ordnance.armed = false;
    effects.push({ kind: 'presentation', action: 'releaseMouseFlight' });
    // Hand over anyone you pulled out of a capsule. Without this they occupy
    // a bay for the rest of the career, which is the failure mode the old
    // `cargo[3]` at least avoided by being sellable.
    if (c.survivors > 0) {
      const n = c.survivors;
      c.survivors = 0;
      messages.push(say(`${n} SURVIVOR${n > 1 ? 'S' : ''} HANDED TO STATION MEDICAL`, 4));
    }

    const fine = fineFor(c.legalStatus, c.credits);
    if (fine > 0 || c.legalStatus > CLEAN) {
      c.credits -= fine;
      c.legalStatus = CLEAN;
      messages.push(say(`OFFENCE FINE PAID: ${formatCredits(fine)}`, 5));
    }
    s.session.policeScanned = false;
    s.session.defenceLaunched = false;
    s.session.view = 0;
    s.sys.cabinTemp = 0;
    s.session.witchspace = false;
    s.session.beaconTimer = -1;
    s.world.cargo.clear();
    // The Navy mission advances on docking. missions.ts owns the machine and
    // this owns the announcement, exactly as combat.ts announces the kill.
    // FIRST of the dock's rng draws — it picks the next target.
    for (const e of stepMissionAtDock(c, s.systems)) {
      if (e.kind === 'briefed') {
        messages.push(say('INCOMING NAVY TRANSMISSION', 5));
        // What the job NEEDS, not just where it is. The Constrictor's armour
        // halves a player hit before its own defence subtracts, so a beam laser
        // does literally nothing to it and the commander would find that out
        // forty light years from here. missions.ts derives the line from her
        // actual fitted gun through the oracle, and returns '' when it will do.
        const warning = constrictorWarning(c);
        if (warning) messages.push(say(warning, 8));
      }
      else if (e.kind === 'courierOrders') {
        messages.push(say('NAVY: COURIER RUN — EXPECT THARGOID INTERFERENCE', 6));
      } else if (e.kind === 'delivered') {
        messages.push(say(
          `PLANS DELIVERED — ${formatCredits(e.payment)}, RIGHT ON COMMANDER`, 6));
      }
    }
    s.session.hermitTrading = false;
    // SECOND draw: the market's seed.
    s.market = makeLocalMarket(this.system,
      (i) => s.living.priceMultiplier(c.systemIndex, i));
    for (const event of this.host.settleContracts()) {
      if (event.kind === 'message') messages.push(event);
      else effects.push(event);
    }
    // THIRD: the bulletin board.
    s.contractOffers = generateContractOffers(this.system, s.systems, c.day);
    this.host.resetContractSelection();
    c.galaxyState = s.living.save();
    effects.push({ kind: 'persistence', action: 'saveCommander' });
    if (!booting) {
      effects.push(
        { kind: 'dockingMusic', on: false },
        heard('dock'),
        heard('tunnel'),
        { kind: 'presentation', action: 'tunnel', way: 'in' },
      );
    }
    // park just outside the slot so the backdrop behind the menu is the station
    s.player.position.copy(s.world.spawnPosition);
    this.host.lookAlong(s.world.station.position.clone().sub(s.player.position));
    s.player.speed = 0;
    effects.push({ kind: 'presentation', action: 'screen', screen: 'docked' });
    return [...effects, ...messages];
  }

  /** Out of the slot, into policed traffic. */
  launch(): StationEvent[] {
    const s = this.state;
    const n = slotNormal(s.world.station);
    s.player.position.copy(s.world.station.position).addScaledVector(n, LAUNCH_STANDOFF);
    this.host.lookAlong(n);
    s.player.speed = LAUNCH_SPEED;
    this.host.setBaseMode('flight');
    s.session.view = 0;
    const effects: StationEvent[] = [
      { kind: 'presentation', action: 'screen', screen: 'hidden' },
    ];
    this.host.populateSystem('launch');
    effects.push(
      heard('launch'),
      heard('tunnel'),
      { kind: 'presentation', action: 'tunnel', way: 'out' },
    );
    return [...effects, say(`LEAVING ${this.system.name.toUpperCase()} STATION`, 3)];
  }

  /** Nothing on the screen stack: show the docked menu, or clear back to flight. */
  showBaseScreen(): StationEvent[] {
    if (this.host.baseMode() === 'docked') {
      return [{ kind: 'presentation', action: 'screen', screen: 'docked' }];
    }
    return [{ kind: 'presentation', action: 'screen', screen: 'hidden' }];
  }

  /** The one line of standing orders under the station menu's header. */
  missionText(): string {
    const c = this.state.commander;
    // contracts first — they're the everyday work
    const k = c.contracts[0];
    if (k) {
      const more = c.contracts.length - 1;
      return `${describeContract(k, this.state.systems).toUpperCase()}` +
        ` — ${k.deadlineDay - c.day} DAYS` +
        (more > 0 ? ` (+${more} MORE)` : '');
    }
    return missionHeadline(c, this.state.systems);
  }
}
