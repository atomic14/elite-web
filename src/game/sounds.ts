// What a rule module asks to be HEARD — without knowing how a sound is made.
//
// The world step and the autopilots both reach moments that should make a
// noise, and neither may call `audio.ts` to do it: that import is a browser
// import, and it was the only thing left standing between the deepest module in
// the project and running under node. It survived at all because `audio.ts`
// swallows a constructor failure, which is a load-bearing accident rather than
// a seam.
//
// So they return a `SoundEvent` and the orchestrator plays it — the same
// "decides and reports" split as every other `apply*`.
//
// ONE type, included by both `StepEvent` and `AutopilotEvent`, so `game.ts` has
// ONE place that turns a sound event into a call. Two near-identical `beep`
// kinds applied in two switches would be a smaller copy of the problem this
// file exists to remove.

/** A sound `audio.ts` names for its occasion rather than its construction. */
export type SoundName =
  | 'explosion'
  | 'ecm'
  | 'enemyLaser'
  | 'refused'
  | 'torusDropped'
  | 'lowEnergy'
  | 'survivorScooped'
  | 'cargoScooped'
  | 'trumbleAte'
  | 'generationShipFound'
  | 'contractPaid'
  | 'contractExpired'
  | 'contractAccepted'
  | 'dockingComputerEngaged'
  | 'combatComputerEngaged';

/** A sound a rule module asks for. `game.ts` is the only thing that plays one. */
export type SoundEvent =
  /**
   * The hyperspace countdown, `n` seconds to go.
   *
   * Named rather than beeped because the pitch was `700 + (5 - n) * 100`
   * computed inside the world step — audio design expressed as arithmetic in
   * the simulation. `audio.ts` owns the sweep now.
   */
  { kind: 'countdown'; n: number }
  /** the C64 tradition, synthesised — see audio.ts */
  | { kind: 'dockingMusic'; on: boolean }
  | { kind: 'sound'; name: SoundName };
