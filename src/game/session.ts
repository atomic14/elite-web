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
