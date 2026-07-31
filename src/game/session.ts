// The flight session: what is happening right now.
//
// Split out of game.ts so the state has a home that is not the orchestrator.
// It is one object for the same reason NpcState is: a snapshot walks it
// generically, so adding a field here saves it and there is no list to keep
// in step.

/**
 * The flight session: every flag and timer that describes what is happening
 * right now, as opposed to who the commander is (commander.ts) or what is in
 * the sky (the entity arrays).
 *
 * One object for the same reason NpcState is one object — a snapshot is this,
 * walked generically. Written as separate fields on Game, the snapshot caught
 * five of twenty-three, and the twenty-three included `torusEngaged`: restore
 * a save taken under torus drive and the ship quietly flew at a different
 * speed from the run it came from.
 */
export interface SessionState {
  /** console message currently visible; empty once its lifetime expires */
  messageText: string;
  /** seconds remaining for `messageText` */
  messageTimer: number;
  hyperCountdown: number;
  torusEngaged: boolean;
  witchspace: boolean;
  npcTargetTimer: number;
  autoSaveTimer: number;
  energyLowTimer: number;
  policeScanned: boolean;
  defenceLaunched: boolean;
  hermitTrading: boolean;
  hermitCooldown: boolean;
  jettisonedValue: number;
  arrivalCargoValue: number;
  genShipSeen: boolean;
  trumbleTimer: number;
  beaconTimer: number;
  strandedHintTimer: number;
  paused: boolean;
  /**
   * 0 front, 1 rear, 2 left, 3 right. NOT a camera setting: laserForView()
   * picks the weapon from it and viewDir() aims the shot, so reloading in
   * rear view used to fire the FRONT laser at empty space ahead.
   */
  view: number;
  ccEngaged: boolean;
  beamTimer: number;
  dcEngaged: boolean;
}

/** Put a message in canonical state; the HUD only paints these fields. */
export function showMessage(state: SessionState, text: string, seconds = 3): void {
  state.messageText = text;
  state.messageTimer = seconds;
}

/** Advance the message lifetime as part of the fixed game step. */
export function tickMessage(state: SessionState, dt: number): void {
  if (!state.messageText) return;
  state.messageTimer -= dt;
  if (state.messageTimer <= 0) {
    state.messageText = '';
    state.messageTimer = 0;
  }
}

/**
 * Advance the cockpit beam lifetime as part of the fixed game step.
 *
 * Unlike messages, the beam has no companion payload to clear. Clamping still
 * matters because this state is snapshotted: an expired flash has one stable
 * representation rather than a frame-count-dependent negative value.
 */
export function tickBeam(state: SessionState, dt: number): void {
  state.beamTimer = Math.max(0, state.beamTimer - dt);
}
