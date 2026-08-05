// The cockpit console's game-facing rules: what the scanner and the compass
// can see, what the aim aid assumes, where the sight sits, and when a gauge
// turns red.
//
// docs/TODO/90's scope rule is "is this about the game, or about how it
// looks", and every number here is both — a range the simulation also has
// opinions about, or a display rule that quietly restates a live one. Pure
// drawing (bracket radii, arrow polygons, the phosphor colours) stays in
// `hud/hud.ts`, and the painters that spend these are `hud/hud.ts`,
// `hud/hud-binding.ts`, `hud/hud-model.ts` and `engine/render-stack.ts`.

/**
 * Scanner range — also the distance at which the console's 'S' lights.
 *
 * The same 6,000 as `PIRATE_HUNT_RANGE` and `HUNTER_RANGE` (hunt-ranges.ts)
 * and deliberately NOT merged with either: "they engage at scanner range" is a
 * plausible rule that nothing anywhere states, and hunt-ranges.ts's own header
 * records the same refusal from its side. If somebody decides it IS one rule,
 * both files are one edit apart on purpose.
 */
export const SCANNER_RANGE = 6000;

/** Ships further out than this get no bracket — the HUD would be a mess. */
export const TARGET_BRACKET_RANGE = 5000;

/** Closer than this to the sun, the compass switches to it for a sun-skim. */
export const SUNSKIM_COMPASS_RANGE = 130_000;

/** The station takes the compass within this many planet radii. */
export const STATION_COMPASS_RADII = 3;

/**
 * Assumed target cruise for the lead marker, in world units a second.
 *
 * THE WORST SINGLE BUG THE SURVEY FOUND, recorded rather than fixed: the HUD
 * leads every locked target at a freighter's 220, so it under-leads a
 * Fer-de-Lance by a third and a Thargon by more. Chris chose the real speed
 * plus a session at the stick — that is docs/TODO/92, a behaviour change with
 * flying attached, and it lands on its own. Until it does, this is what the
 * marker assumes about everything it brackets.
 */
export const ASSUMED_TARGET_SPEED = 220;

/** Notional bolt speed, for the lead marker only; real shots are instant. */
export const BOLT_SPEED = 8000;

/**
 * The laser gauge turns red above this fraction of the heat scale...
 *
 * A WARNING, deliberately well below the rule it warns about: the real
 * cut-out is `LASER_CUTOUT` (0.98, constants/player-gun.ts), and a bar that
 * only reddened at the cut-out would be telling you what has already
 * happened. Whether 0.8 was chosen as margin or merely guessed, the survey
 * could not tell; the value has shipped as long as the gauge has.
 */
export const LASER_GAUGE_WARN = 0.8;

/**
 * ...and the cabin gauge above this fraction, against a fatal
 * `CABIN_TEMP_FATAL` of 0.99 (constants/sun.ts) — the same early-warning
 * shape, with more margin because cabin heat climbs on its own while you fly
 * a sun-skim and a warning you can act on has to arrive before the act stops
 * being possible.
 */
export const CABIN_GAUGE_WARN = 0.72;

/**
 * The gun axis sits above the canvas centre, as a fraction of half the view's
 * height, because the console eats the bottom of the screen.
 *
 * MUST match `#crosshair { top: 42% }` in style.css, and CANNOT be expressed
 * there: CSS cannot import from this directory, so the twin stays duplicated
 * as a DECIDED exception (docs/TODO/90's scope section; docs/TODO/93 owns the
 * stylesheets). The beams' convergence depth (`BEAM_Z`) stays in
 * render-stack.ts — it is how the cockpit LOOKS — but it converges on the
 * camera axis the sight defines, which is why the sight is a game rule and
 * the depth is not: the shot goes where this says.
 */
export const SIGHT_Y = 0.42;
