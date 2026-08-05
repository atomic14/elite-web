// The station as a place in the sky: which hull a system gets, how it spins,
// and where it puts your ship when you leave, fluff the slot, or sit in the
// docked menu.
//
// The scene that spends the spin and the backdrop is `world/system-scene.ts`;
// launching is `Station.launch` (game/station.ts) and the bounce is
// `checkStation` in game/world-step.ts. The slot geometry itself is
// ./docking.ts, and how near the station holds the torus drive down is
// `MASS_LOCK_STATION` in ./torus.ts.

/**
 * How fast the station spins about its slot axis, in radians a second.
 *
 * This is the difficulty of docking: the slot is a letterbox on a hull turning
 * at this rate, so it is the roll a ship must match to thread it —
 * `planDocking` takes its up-hint from the station so NPCs match it for free,
 * and `ROLL_TOLERANCE` (./docking.ts) is how far off you may be. A full turn
 * every 24 seconds, close to the original's stately spin.
 */
export const STATION_SPIN = 0.26;

/**
 * The tech level, in the SHOWN one-based units every screen quotes, at which a
 * system's station is the dodecahedral Dodo rather than the Coriolis.
 *
 * The raw `techLevel` the 1984 algorithm computes is zero-based and every
 * reader adds one before showing it (see ./tech-level.ts), so the scene's test
 * is `techLevel + 1 >= DODO_TECH_LEVEL`. Shown tech runs 1-15, so roughly the
 * top third of systems rate the bigger station.
 */
export const DODO_TECH_LEVEL = 10;

// THE NEXT THREE ARE ONE PHRASE — "just outside the slot" — WITH THREE ANSWERS,
// and they are kept adjacent so the disagreement stays visible (the survey
// found them as a diverged trio; docs/TODO/90-constants-cleanup.md holds the
// decision). Three different events, three distances: a fluffed docking
// bounces you to 420, the bay spits you out at 450, and the docked menu parks
// you 900 out for the backdrop. The oddity is the ORDER of the first two: the
// bounce leaves you NEARER the hull than the bay ever does. Whether that is a
// deliberate bit of menace or a drift nobody chose is not written down
// anywhere, and choosing moves where every failed docking puts the player —
// so the values stand and the question is recorded rather than answered.

/**
 * Where a fluffed docking bounces you to — distance from the station's CENTRE,
 * in world units, with your speed zeroed. What the scrape costs in points is
 * `IMPACT.stationScrape`.
 */
export const BOUNCE_STANDOFF = 420;

/** How far off the slot you sit when the bay spits you out, in world units. */
export const LAUNCH_STANDOFF = 450;

/** ...and how fast, in world units a second — a firm push, not a cruise. */
export const LAUNCH_SPEED = 120;

/**
 * Where the docked menu parks your ship, along the slot normal in world units
 * — far enough out that the station fills the backdrop behind the menu rather
 * than clipping through the camera. A BACKDROP, not the launch point: its old
 * comment claimed "launch/respawn point", which stopped being true when
 * `LAUNCH_STANDOFF` was introduced at 450.
 */
export const DOCKED_BACKDROP_DISTANCE = 900;
