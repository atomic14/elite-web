// Is something else flying the ship, and what does it want?
//
// Two pieces of equipment answer to that: the docking computer, which flies you
// into the slot (the approach itself is `docking.ts`, stepped by
// `world-step.ts`), and the combat computer, which is the `jameson-defend`
// policy flying your Cobra (`combat-computer.ts` does the thinking). They had
// nothing to do with each other in game.ts and everything to do with each other
// in fact: both are bought, both are engaged with one key, both hand the ship
// back the moment the pilot touches the controls, and both end up as a
// `FlightDemand` that `PlayerShip.update` flies.
//
// So they share a file, and it follows the project's pattern: this DECIDES and
// reports `AutopilotEvent`s, and the Game says them out loud. The sounds are
// events too — named sounds and the docking music, both `SoundEvent`s (sounds.ts) —
// which is what keeps the file free of `audio.ts` and therefore of the browser.
// Nothing here draws from the seeded rng, so there is no ordering to preserve.
//
// What this file does NOT own: the flying. The docking approach is docking.ts,
// the policy is combat-computer.ts, and pulling the trigger is the Game's,
// because firing has consequences — legal status, bounties, the station's
// Vipers — that an autopilot has no business deciding.

import type { FlightDemand } from '../player.ts';
import type { Brain } from '../ai-training/policy.ts';
import type { V3 } from '../ai-training/observation.ts';
import { hostilesNear } from './npc.ts';
import { defenceBrainNameFor } from './brain-names.ts';
import type { CombatComputer } from './combat-computer.ts';
import { ScriptedCoPilot } from './scripted-co-pilot.ts';
import type { SoundEvent } from './sounds.ts';
import type { GameState } from './state.ts';
import { DOCK_COMPUTER_RANGE } from '../constants/docking-computer.ts';

/** What an autopilot reports for the orchestrator to say and play. */
export type AutopilotEvent =
  | { kind: 'message'; text: string; seconds: number }
  | SoundEvent;

const say = (text: string, seconds: number): AutopilotEvent =>
  ({ kind: 'message', text, seconds });
/** The refusal noise shared by every rejected command in the game. */
const REFUSED: AutopilotEvent = { kind: 'sound', name: 'refused' };

/** What the combat computer decided this frame. */
export interface AutopilotDemand {
  /**
   * What it wants, or null when it has just handed the ship back — in which
   * case the pilot's own demand stands for this frame, exactly as it did when
   * the autopilot applied itself on top of manual flight.
   */
  demand: FlightDemand | null;
  /**
   * It is reaching for the E.C.M. this frame.
   *
   * Reported rather than done, like every other consequence in this file: the
   * burst spends a quarter of the bank and wipes the sky, and the Game presses
   * it through the same `fireEcm` the player's own key does.
   */
  ecm: boolean;
  events: AutopilotEvent[];
}

export class Autopilot {
  private readonly state: GameState;
  private readonly computer: CombatComputer;
  private readonly scripted: ScriptedCoPilot;

  constructor(
    state: GameState, computer: CombatComputer,
    scripted: ScriptedCoPilot = new ScriptedCoPilot(),
  ) {
    this.state = state;
    this.computer = computer;
    this.scripted = scripted;
  }

  /** The commander took a hit — the scripted co-pilot's only way to feel it. */
  noteUnderFire(): void {
    this.scripted.noteHit();
  }

  /**
   * The docking computer, on or off.
   *
   * It FLIES you in rather than teleporting you, using the same primitive the
   * traders do (game/docking.ts) — the hard part is roll, and it is the same
   * problem for both. Press C again, or touch the controls, to take over.
   */
  toggleDocking(): AutopilotEvent[] {
    const s = this.state;
    if (!s.commander.equipment.dockingComputer) {
      return [say('NO DOCKING COMPUTER FITTED', 3), REFUSED];
    }
    const dist = s.player.position.distanceTo(s.world.station.position);
    if (dist > DOCK_COMPUTER_RANGE) {
      return [say('STATION OUT OF RANGE', 3), REFUSED];
    }
    const on = !s.session.dcEngaged;
    s.session.dcEngaged = on;
    s.dockPlan.phase = 'gate'; // fresh approach each time it's engaged
    const events: AutopilotEvent[] = [
      say(on ? 'DOCKING COMPUTER ENGAGED' : 'DOCKING COMPUTER OFF', 2),
    ];
    if (on) events.push({ kind: 'sound', name: 'dockingComputerEngaged' });
    events.push({ kind: 'dockingMusic', on });
    return events;
  }

  /**
   * The combat computer, on or off.
   *
   * It refuses to engage with nothing to fight, which is not a limitation: the
   * policy was trained to fly a defence, so with an empty sky it would simply
   * hold the ship while the player wondered why the controls felt odd.
   */
  toggleCombat(): AutopilotEvent[] {
    const s = this.state;
    if (!s.commander.equipment.combatComputer) {
      return [say('NO COMBAT COMPUTER FITTED', 3), REFUSED];
    }
    if (s.session.ccEngaged) {
      s.session.ccEngaged = false;
      return [say('COMBAT COMPUTER OFF', 2)];
    }
    if (!hostilesNear(s.world.npcs, s.player.position, s.commander.legalStatus)) {
      return [say('NO HOSTILES — COMBAT COMPUTER IDLE', 3), REFUSED];
    }
    // The LIVE BRAINS row can set the co-pilot to NONE outright — refusing
    // here, in the row's own words, beats engaging a pilot that immediately
    // hands back with a message about an empty sky that is not empty.
    if (defenceBrainNameFor(s.brains) === 'scripted') {
      return [say('COMBAT COMPUTER SET TO NONE — SEE THE COMBAT TRAINER', 4), REFUSED];
    }
    s.session.ccEngaged = true;
    s.session.view = 0; // it aims the front laser
    return [
      say('COMBAT COMPUTER ENGAGED — ANY FLIGHT KEY OVERRIDES', 4),
      { kind: 'sound', name: 'combatComputerEngaged' },
    ];
  }

  /**
   * What the combat computer wants this frame, at the trader-Cobra dynamics it
   * trained in. Manual flight input disengages instantly.
   *
   * It only DECIDES: what comes back is a `FlightDemand` exactly like the one a
   * pair of hands produces, and the same `PlayerShip.update` flies it.
   *
   * @param handsOn the pilot is touching the controls — always hands back.
   * @param brain the defence policy, or null if the weights failed to load.
   * @param missilePos the hostile warhead's position, or null for a clear sky
   * — `Ordnance.hostileMissilePos`, passed through to the policy's eyes.
   */
  combatDemand(
    dt: number, handsOn: boolean, brain: Brain | null,
    missilePos: V3 | null = null,
  ): AutopilotDemand {
    const s = this.state;
    const step = this.computer.step(
      dt, s.player, s.sys, s.world.npcs, s.commander.legalStatus, handsOn, brain,
      missilePos);
    if (step.kind === 'disengage') {
      s.session.ccEngaged = false;
      return {
        demand: null,
        ecm: false,
        events: [say(step.reason, step.reason === 'MANUAL OVERRIDE' ? 2 : 3)],
      };
    }
    return { demand: step.demand, ecm: step.ecm, events: [] };
  }

  /**
   * The SCRIPTED combat computer — the pirates' attack run flying your ship
   * (scripted-co-pilot.ts decides; the Game flies the demand and shoots). The
   * same engage key, the same manual override, the same disengage words as the
   * brain co-pilot, and — since it now returns a `FlightDemand` too — the same
   * `AutopilotDemand` shape, so game.ts flies both the same way. Which of the
   * two flies is the LIVE BRAINS selection, asked by game.ts through
   * `defenceBrainNameFor`.
   */
  combatSteer(dt: number, handsOn: boolean, missilePos: V3 | null): AutopilotDemand {
    const s = this.state;
    const step = this.scripted.step(
      dt, s.player, s.world.npcs, s.commander.legalStatus, handsOn, missilePos);
    if (step.kind === 'disengage') {
      s.session.ccEngaged = false;
      return {
        demand: null,
        ecm: false,
        events: [say(step.reason, step.reason === 'MANUAL OVERRIDE' ? 2 : 3)],
      };
    }
    return { demand: step.demand, ecm: step.ecm, events: [] };
  }
}
