// How close a hostile lets itself get before it turns away — and where a
// trained pilot hands the flying over.
//
// ONE distance, in ONE file, because it had two homes and they drifted. The
// number lived as a hardcoded `dist < 220` at the top of `NpcShip.attack` and
// again as `RAM_GUARD = 220` in brains.ts; the second was corrected and the
// first never was, which is exactly the failure CLAUDE.md is organised against
// — one rule with two homes, kept in step by hope. Both files import from here
// now, and `test/npc.test.ts` fails if the number reappears as a literal in
// either.
//
// STEERING AND FIRING ARE TWO DECISIONS. That is the other half of the bug and
// it is a design decision, not a refactor: `attack()` used to `return null` the
// moment it broke off, so breaking off and holding fire were one statement, and
// every police ship, bounty hunter, Thargoid and knife-range pirate went silent
// inside 220 units. Measured, a police ship nose-on to a stationary commander
// fired 16 times in 20 seconds from 240 out and ZERO at 210, 180 and 120 —
// which is Chris's "it feels almost like they stop shooting when they get
// close", because his recorded median engagement range is 260 and his 10th
// percentile 214.
//
// Nothing ever argued for the silence. A ship turning away that has you in its
// gate should shoot, so `attack()` steers away AND runs `npcTriggerPull`, which
// already applies the gate, the range and the cooldown. A ship that cannot get
// its nose on you still does not fire — that is the honest version of what the
// player is feeling, and it is one gate, not a second one.
//
// THE RULE IS THE SAME FOR EVERY HOSTILE. A pirate, a police ship, a bounty
// hunter and a Thargoid all reach `attack()` and all break off and shoot at the
// same distance. The only difference any of them gets is the one that was
// already there: a Thargoid's `THARGOID_FIRE_RATE` multiplier on the shared
// cooldown, stated in gunnery.ts as a fire rate rather than as a second range.

/**
 * A ship this close to what it is fighting stops closing and turns away.
 *
 * It does NOT stop shooting — see the header. This is a steering rule and
 * nothing else.
 *
 * 220 units, and it is the range the scripted chase has always broken off at.
 * The two hulls in a knife fight are around 68 units of radius before they
 * touch and a ship re-decides its heading at 10 Hz, so the margin here is
 * several decision ticks of turning room at closing speeds the game can
 * actually produce.
 */
export const BREAK_OFF_RANGE = 220;

/**
 * Range at which a trained pilot stops flying its own policy and hands the
 * ship over to the scripted break-off above.
 *
 * The simulator the pre-generation policies were fitted in had NO collision
 * model, so flying straight through the target was free and the optimal learnt
 * behaviour was to close to zero range and sit there shooting. In the game,
 * where ships are solid, that reads as deliberate ramming: the pirate slides
 * past you and kamikazes. Collisions were added to the simulator and then, with
 * the simulator's deletion, stopped being a model at all — episodes call
 * collisions.ts. The hand-over remains for brains fitted before either
 * (docs/TRAINING-LOG.md).
 *
 * The generation brains do not need it as wide: they destroy themselves in 1-9%
 * of engagements against 36-73% for the brain they replace, so they keep flying
 * their own policy until a collision is genuinely imminent.
 *
 * 150, and the number is arithmetic rather than taste. It was 90 for one wave
 * and both of Chris's arena fights had ships fly into him. A pirate re-decides
 * at 10 Hz, so a head-on closure — 300 for the pirate against the player's 400
 * — covers 70 units between decisions, and the two hulls are 68 units of radius
 * before they touch. A 90-unit guard leaves 22 units of margin: less than one
 * decision tick, so breaking off is not something the ship is physically able
 * to do. 150 gives it a tick to turn.
 *
 * It is no longer a dead zone for the gun. Handing over used to switch the guns
 * off, which is why this number had to clear the range a human fights at; it
 * still does, but `attack()` shoots now, so what is handed over is the flying
 * and only the flying.
 *
 * EVERY shipped policy hands over here. There used to be one exception —
 * `pirate-attack-r2` kept the full `BREAK_OFF_RANGE` because it is the brain
 * that kamikazes — and it went with the other unshipped weights in TODO 57, so
 * `pirateBrainFor` returns this number and no other.
 */
export const BRAIN_HANDOVER_RANGE = 150;

/**
 * The longest a ship lets a run get before turning back, and the default the
 * pure phase function assumes when nobody has rolled one.
 *
 * It USED to be a single fixed range for every ship, and equal to
 * `combat-sim-report.ts`'s `PASS_FAR` on the argument that a flight model
 * producing runs and a measurement counting them should use one number. That
 * argument was right about the coupling and wrong about the shape: one number
 * meant every ship in a gang turned at the same place and came back as a wave.
 * See `EXTEND_RANGE_MIN`/`MAX` below for what replaced it, and `PASS_FAR` for
 * what the coupling became — a threshold that has to sit BELOW the tightest
 * turn any ship makes, rather than equal to a range nothing is obliged to
 * reach.
 */
export const EXTEND_RANGE = 900;

/**
 * The band a ship's own turn-back range is rolled from, each time it extends.
 *
 * Chris, having flown the fixed version: "they fly quite far before turning for
 * another run", and then "I think we should have some randomness in the
 * behaviour." Those are two requests and only the second one is met here. The
 * measurements are why.
 *
 * With ONE number every ship in a gang turns at the same range, so five that
 * arrive together stay together — they merge as a wave, all extend, all turn,
 * and all come back at once. A band breaks that up.
 *
 * SHORTENING the run is the part that does not work, and it is not a tuning
 * failure. A ship does all of its turning in the CLOSING leg: `extending` flies
 * straight. So the closing leg has to contain both a 180 and the run-in that
 * settles the ship onto `PASS_MISS_DISTANCE`, and below about 700 there is no
 * longer room for both — the ship arrives at the merge still pointed at the
 * middle and flies into it. Over 60 episodes against a target that holds still,
 * contact damage per episode:
 *
 *   band        450-900   700-1100   750-1250   800-1400   900 fixed
 *   rammed         22.7        4.4        8.8        3.7         2.9
 *   passes/ep      4.77       5.30       4.98       4.63        5.25
 *   median apex     906       1126       1236       1331        1134
 *
 * 700 to 1100: the most passes of any band tried, a ram figure close to the
 * fixed version's, and 355 units of real spread in where ships turn. Its median
 * apex is 1126 against the fixed 1134, so runs are the same LENGTH as before —
 * they are just no longer all the same length.
 *
 * Making short runs actually flyable means giving the extend a curve, so the
 * ship is already coming round before the phase flips. Steering it at the
 * target during the extend does NOT do that: it cancels the extend outright,
 * measured at 0.90 passes an episode with the range spread collapsed to
 * 274/366/709, which is the turret shape this whole cycle exists to avoid.
 *
 * The roll is re-taken on every extend rather than fixed at spawn — a per-ship
 * disposition would destagger the gang but leave each individual ship as
 * metronomic as before.
 */
export const EXTEND_RANGE_MIN = 700;
export const EXTEND_RANGE_MAX = 1100;

/**
 * Turn a 0..1 roll into a turn-back range.
 *
 * Takes the roll rather than calling `random()` so it stays pure and the whole
 * band is assertable without seeding anything — `rng.ts` is the only source of
 * chance in the program and the caller in npc.ts is where that lives.
 */
export function rollExtendRange(roll: number): number {
  return EXTEND_RANGE_MIN + (EXTEND_RANGE_MAX - EXTEND_RANGE_MIN) * roll;
}

/**
 * Where an attack run is in its cycle.
 *
 * `closing` — nose on the target, throttle up, shooting when the gate allows.
 * `passing` — inside `BREAK_OFF_RANGE`: hold the heading and go THROUGH, still
 *   shooting. This is the half that was missing.
 * `extending` — past the target and opening the range; turn back at
 *   `EXTEND_RANGE` and close again.
 */
export type AttackPhase = 'closing' | 'passing' | 'extending';

/**
 * The next phase of an attack run, from where the ship is now.
 *
 * A pure function of the range and the phase, so the whole cycle can be
 * asserted without flying anything — `test/npc.test.ts` walks a ship in and out
 * and checks it comes back round.
 *
 * WHY A FLY-PAST RATHER THAN A REVERSAL. The scripted chase used to steer to
 * `own * 2 - target` the moment it came inside 220: directly away, a 180 turn.
 * That is the slowest turn there is and the range does not allow it. A Krait
 * pitches at 1.4 rad/s, so a reversal takes 2.24s and covers 651 units of
 * travel — begun at 220 units from a target it is pointed straight at. It flies
 * through. Every hull in the roster has the same arithmetic and a Python, at
 * 0.49 rad/s, needs 1,026 units to turn around inside 220.
 *
 * Chris, having flown all of them: "the break off by turning 180 is not right —
 * the correct thing would be to do an attack run and fly past, then turn for
 * another attack run." That is this. The ship commits to the pass instead of
 * fighting it, which costs no turn at all, and does its turning out at
 * `EXTEND_RANGE` where there is room for it.
 */
/**
 * How long a ship keeps flying evasively after the last time it was hit.
 *
 * Chris, having watched one extend in a straight line while he sat on its six:
 * "an NPC should switch modes if it's getting hit — so flying in a straight
 * line just absorbing damage is not something a normal person would do."
 *
 * 1.2s is long enough that a single laser hit changes the ship's mind and short
 * enough that it goes back to fighting rather than jinking forever once you
 * stop landing them. It is a decay, not a latch, so a ship that is genuinely
 * being shot at stays evasive for as long as that is true.
 */
export const UNDER_FIRE_SECONDS = 1.2;

/**
 * The phase to fly given the range AND whether the ship is being shot at.
 *
 * Extending is the only phase being hit changes, and it is the only one where
 * being hit makes no sense: `closing` is already turning, `passing` is over in
 * a fraction of a second, but a ship that has made its pass and is opening the
 * range holds ONE heading for as long as it takes to reach EXTEND_RANGE. If
 * somebody is hitting it during that, holding the line is the one thing a pilot
 * would not do — so it stops extending and comes back round.
 *
 * That also makes the fight answer the player: getting on its six and landing
 * shots is what breaks the pattern, rather than the pattern running to a fixed
 * distance whatever happens.
 */
/**
 * The slowest an attacking ship throttles back to in order to turn.
 *
 * 0.45, and it sits DELIBERATELY just above `MIN_CRUISE_FRACTION`'s 0.43 in
 * npc.ts. That floor is a backstop against a fighter that can stop dead — a
 * ship that can come to rest holds a firing line for free and becomes a turret,
 * which is what generation 2 learnt and what Chris played and rejected. Keeping
 * this rule's slowest setting above the floor means the two never argue: the
 * rule does the flying across its whole range, and the floor is only ever the
 * thing that catches a bug.
 */
export const CLOSING_THROTTLE_MIN = 0.45;

/**
 * How far to the SIDE of its target a ship aims its attack run.
 *
 * An attack run passes BESIDE the target, not through it. The first cut of the
 * three-phase run aimed at the target itself and then committed to the heading
 * — "go through, no steering" — which is correct for the steering and wrong for
 * the aim point, because the heading it commits to is the one pointed at the
 * hull. Measured over 60 episodes against a target that holds still, that is
 * not a near miss:
 *
 *   scripted, aiming at the target   collision damage 104.1 per episode
 *   scripted, aiming 110 to the side              (see the test)
 *   the old 180-degree break-off                             5.1
 *
 * The old reversal took almost no contact damage because it never went in — it
 * orbited at exactly 220 units at 137 speed, which is the turret reading
 * `train/flight-probe.ts` exists to catch. So both of the first two attempts
 * were wrong in opposite directions and the miss distance is what separates
 * them: commit to the run, but commit to a line that clears the hull.
 *
 * 110 units. The two hulls in a knife fight are about 68 units of radius before
 * they touch, so this clears contact with roughly half again as much room, and
 * it is small enough that the gun's gate — which is an angle, not an offset —
 * still opens on the way in.
 */
export const PASS_MISS_DISTANCE = 110;


/**
 * How hard a closing ship pulls the throttle back, given how far off its nose
 * is — 1 when it is pointed at the target, `CLOSING_THROTTLE_MIN` when it is
 * 90 degrees or more off.
 *
 * Chris: "if an NPC needs to turn quickly, it should slow down? And then speed
 * up?" — which is right, but NOT for the usual reason, and the difference
 * decides whether the rule does anything.
 *
 * **Slowing does not raise the turn rate.** `steerToward` rotates by
 * `turnRate * dt` and `turnRate` is a constant off the ship's spec; speed
 * appears nowhere in it. A Krait pitches at 1.4 rad/s stopped and 1.4 rad/s
 * flat out. So if this rule were an attempt to buy angular velocity it would
 * buy exactly none.
 *
 * What it buys is the other two, and both matter here:
 *
 *   - **Turn radius.** r = v/omega. Half the speed is half the radius, so a
 *     slow ship comes round inside its own turn instead of sailing wide of it.
 *     This is the whole reason the turn-in at EXTEND_RANGE works.
 *   - **Relative angular rate.** The rate a ship must MATCH to hold its nose on
 *     something is v_rel/range, so its own speed is part of the number it is
 *     chasing. Backing off does not make it turn faster, it makes the thing it
 *     is tracking sweep slower — which is why Chris found a low throttle let
 *     him hold NPCs at close range and full throttle did not, and it is the
 *     same arithmetic that says nothing can track a 280 u/s target inside 193
 *     units at any throttle.
 *
 * Cosine rather than a distance band because the quantity that decides it is an
 * angle: a ship 900 units out and dead on its line has no reason to slow down,
 * and one 300 out and 80 degrees off has every reason. The band this replaced
 * (`dist > 700 ? max : max * 0.45`) got both of those backwards.
 */
export function closingThrottle(headingErrorRad: number): number {
  const aligned = Math.max(0, Math.cos(headingErrorRad));
  return CLOSING_THROTTLE_MIN + (1 - CLOSING_THROTTLE_MIN) * aligned;
}

export function nextAttackPhase(
  phase: AttackPhase, dist: number, underFire = false, extendRange = EXTEND_RANGE,
): AttackPhase {
  // Knife range wins over everything, and it is FIRST for a reason: a ship
  // extending from one pass that finds the target on top of it again — because
  // the target chased it down — commits to another pass rather than holding a
  // straight line at someone sitting on its six.
  if (dist < BREAK_OFF_RANGE) return 'passing';
  // Cleared it. The pass is over the moment the range opens at all.
  if (phase === 'passing') return 'extending';
  // Still opening: hold the run out until there is room to turn in — UNLESS
  // somebody is landing shots, in which case stop running in a straight line.
  if (phase === 'extending') return dist > extendRange || underFire ? 'closing' : 'extending';
  return 'closing';
}

/**
 * What a ship is doing, as one word for a record or a readout.
 *
 * Its own function because two samplers ask — the game's trainer and
 * `train/flight-probe.ts` — and a phrase invented twice is a phrase that drifts.
 * It reads the SAME fields the flight reads, so it cannot describe a ship doing
 * something the ship is not doing.
 *
 * `evading` outranks the phase because it is the answer to "why has it stopped
 * flying the run": a ship that is being hit breaks off whatever it had planned,
 * and that is the interesting thing to see in a log.
 */
export function describeFlight(
  phase: AttackPhase, underFire: number, fleeing: boolean,
  flownBy: 'brain' | 'scripted' = 'scripted',
): string {
  if (fleeing) return 'fleeing';
  if (underFire > 0) return 'evading';
  // A brain-flown ship is not IN a phase — `attackPhase` is only touched by the
  // scripted run, so reporting it here would quote a stale word. It flies its
  // own policy and that is the honest name for what it is doing. This is not a
  // hypothetical: the first cut of this readout said `closing 45s` for a g3
  // pirate that never ran the closing logic at all.
  if (flownBy === 'brain') return 'own policy';
  return phase;
}
