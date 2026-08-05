// The game state: one object holding everything the world step may change.
//
// This is the missing half of "state lives in one place". SessionState already
// collected the flight flags and NpcState the per-ship ones, but the rest —
// the galaxy you are in, the commander, the sky, the market, the charts — sat
// as fifteen separate properties of Game. That is what made game.ts hard to
// break up: no extracted function could be given "the state", only fifteen
// arguments, so every phase of the step had to stay a method with `this`.
//
// Chris's framing from the start of the refactor: *you have the game state
// objects, and you have the physics/world simulator, and you have the
// renderer*. This is the first of the three.
//
// The rule for what belongs here is unchanged: anything that drives behaviour
// and is not a constant. Renderer handles (the HUD, the tunnel, the dust) and
// scratch vectors are NOT state — deleting them changes nothing about what
// happens next, only about what you see.

import type { StarSystem, MarketEntry } from '../galaxy/galaxy.ts';
import type { CommanderData, Contract } from './commander.ts';
import type { PirateThreat } from './threat.ts';
import type { EncounterTimers } from './encounters.ts';
import type { ShipSystems } from './systems.ts';
import type { DockPlan } from './docking.ts';
import type { ChartState } from './chart-state.ts';
import type { SessionState } from './session.ts';
import { World } from './world.ts';
import { PlayerShip } from '../player.ts';
import * as THREE from 'three';
import { freshSystems } from './systems.ts';
import { makeDockPlan } from './docking.ts';
import { freshTimers } from './encounters.ts';
import { generateGalaxy } from '../galaxy/galaxy.ts';
import { LivingGalaxy } from '../galaxy/living.ts';
import { SHIPPED_BRAINS, type BrainSelection } from './brain-names.ts';
import { BREED_INTERVAL } from '../constants/trumbles.ts';
import { AUTOSAVE_INTERVAL } from '../constants/saves.ts';
import { STRANDED_HINT_FIRST } from '../constants/witchspace.ts';

export interface GameState {
  // --- where and who ------------------------------------------------------
  /** the 256 systems of the current galaxy, generated not stored */
  systems: StarSystem[];
  commander: CommanderData;
  /**
   * Which commander's autosaves this session writes — see save-file.ts, where
   * the word is argued and where the one home for it lives.
   *
   * STATE and not a module variable, for invariant 12's reason: it decides
   * where an automatic write LANDS, and a rule read from ambient state is a
   * rule nothing can test as an argument.
   *
   * It is a READ of `SaveRecord.career`, not a second home for it (TODO 43).
   * `bootCareer()` takes it off the record this session booted from, once, and
   * nothing writes it again — not even `restore()`, which used to assign the
   * snapshot's copy over it one step after boot and so let an imported file
   * redirect a stranger's autosaves onto yours. The snapshot carries none at
   * all now; the record it lives in is the answer.
   *
   * It is the name the player chose for this commander — and still NOT
   * `commander.name`, which is what they are called today. Renaming changes
   * that one and leaves this one where it is (TODO 56), so a rename can never
   * move a save from one group to another underneath a player who only meant
   * to change what they are called.
   */
  career: string;
  /** level-1 simulation: trade flowing between all 256 systems */
  living: LivingGalaxy;

  // --- the sky ------------------------------------------------------------
  /** the ships, the cargo, the effects and the scenery */
  readonly world: World;
  readonly player: PlayerShip;

  // --- this flight --------------------------------------------------------
  /** every flight flag and timer — see session.ts */
  readonly session: SessionState;
  /** shields, energy, laser heat, cabin temperature */
  readonly sys: ShipSystems;
  /** the docking computer's approach, mid-manoeuvre */
  readonly dockPlan: DockPlan;
  /** countdowns for arrivals, pirate waves and Thargon drops */
  encounterTimers: EncounterTimers;
  /** the reception this system laid on */
  lastThreat: PirateThreat | null;
  /** seconds the console 'E' light stays lit after an E.C.M. burst */
  ecmDetectedTimer: number;
  /**
   * Which brains the NPCs fly — the shipped ones unless a playtest or a combat
   * exercise says otherwise. Here rather than in four `window.__` flags
   * because the step reads it, so it is state (brains.ts, BrainSelection).
   */
  brains: BrainSelection;
  /**
   * Playtesting: fit anything from the catalogue, free and at any tech level.
   *
   * Beside `brains` because it is the same kind of thing — a development
   * override that changes what the game allows — and in the state for the same
   * reason: it was `window.__cheat`, and an ambient global is not somewhere a
   * rule can be found, tested, or saved. `TradeContext` already took it as a
   * field, so only its SOURCE was ever the problem.
   */
  cheat: boolean;

  // --- what is on offer ---------------------------------------------------
  market: MarketEntry[];
  /** a rock hermit's stock, which is not the system's */
  hermitMarket: MarketEntry[];
  contractOffers: Contract[];
  /** cursor and target on the galactic chart */
  readonly chart: ChartState;
}

/**
 * A fresh flight: every session flag and timer at the value it starts a leg on.
 *
 * Split out of `freshState` because it has a second caller — the combat
 * simulator resets one when an exercise begins (combat-sim.ts) — and a
 * hand-written list of fields over there is precisely the bug this project has
 * shipped five times: a field added to `SessionState` would be reset in one
 * place and inherited in the other. One home for what "a fresh flight" is.
 */
export function freshSession(): SessionState {
  return {
    messageText: '',
    messageTimer: 0,
    hyperCountdown: -1,
    torusEngaged: false,
    witchspace: false,
    npcTargetTimer: 0,
    autoSaveTimer: AUTOSAVE_INTERVAL,
    energyLowTimer: 0,
    policeScanned: false,
    defenceLaunched: false,
    hermitTrading: false,
    hermitCooldown: false,
    jettisonedValue: 0,
    arrivalCargoValue: 0,
    genShipSeen: false,
    // a fresh infestation is one full brood away, the same clock it breeds on
    trumbleTimer: BREED_INTERVAL,
    beaconTimer: -1,
    strandedHintTimer: STRANDED_HINT_FIRST,
    paused: false,
    view: 0,
    ccEngaged: false,
    beamTimer: 0,
    dcEngaged: false,
  };
}

/**
 * A fresh session for a given commander.
 *
 * The commander is a PARAMETER, not something this reaches for. The first
 * version called loadCommander() itself and therefore needed localStorage,
 * which defeated the whole point of the file — `npm test` caught it
 * immediately. Everything here is buildable under node with no canvas, no
 * renderer and no browser.
 */
export function freshState(commander: CommanderData): GameState {
  const systems = generateGalaxy(commander.galaxy);
  return {
    systems,
    commander,
    // The orchestrator sets this from the save it booted; a state built for a
    // test or the campaign has no shelf to read one off, and writes nothing.
    career: '',
    living: new LivingGalaxy(systems),
    world: new World(),
    player: new PlayerShip(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)),
    session: freshSession(),
    sys: freshSystems(),
    dockPlan: makeDockPlan(),
    encounterTimers: freshTimers(),
    lastThreat: null,
    ecmDetectedTimer: 0,
    brains: { ...SHIPPED_BRAINS },
    cheat: false,
    market: [],
    hermitMarket: [],
    contractOffers: [],
    chart: { cursorX: 0, cursorY: 0, targetIndex: null },
  };
}
