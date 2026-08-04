// The player's gun, as numbers: how far it reaches, how often it fires, how hot
// it gets and how much it forgives.
//
// The rules that spend these are `game/gunnery.ts` — which mount fires, whether
// it can, and what one hit is worth. What a hit is WORTH is deliberately absent
// here and always was: that is the released game's arithmetic, resolved from the
// hull and the fitting through the catalogue, and a strength column in this file
// would be a second home for a number the pack already owns.
//
// The NPC's gun is `npc-gun.ts`, and the separation is the point rather than
// filing. The two guns are asymmetric by design — see `LASER_GRAZE`, which says
// so about the one number they might most plausibly be assumed to share — and
// the one thing they genuinely DO share, the reach, is read from here by
// npc-gun.ts rather than written twice.

/**
 * How far the player's laser reaches, in world units.
 *
 * Both guns reach this far. `NPC_LASER_RANGE` is defined FROM this value rather
 * than restating it, and the measurement behind that is beside it in npc-gun.ts.
 */
export const LASER_RANGE = 3500;

/**
 * The cadence and heat of each fitted laser. Harmless's numbers, unchanged.
 *
 * `mining` is absent because Harmless has no mining MOUNT: the mining laser is
 * a fitting that changes what a destroyed rock yields (see `Combat.destroy`),
 * not a weapon you select. The equipment redesign that turns it into a real
 * fourth mount is DEFERRED by the combat plan — `playerLaserHit` already answers
 * for it, so when the redesign lands only a pacing row is missing.
 *
 * Its exhaustiveness over the three fittable mounts is enforced where it is
 * spent: `playerLaser` indexes it with a `LaserType`, so a fourth member of that
 * union with no row here is a compile error at the lookup. That is why the table
 * carries no `Record<LaserType, GunPacing>` annotation — this directory imports
 * nothing, and the check does not need it to.
 */
export const LASER_PACING = {
  pulse: { cooldown: 0.24, heat: 0.055 },
  beam: { cooldown: 0.09, heat: 0.035 },
  military: { cooldown: 0.09, heat: 0.03 },
} as const;

/** The laser cuts out at this temperature and will not fire again until it cools. */
export const LASER_CUTOUT = 0.98;

/**
 * ...and how fast it cools, in units of that same 0..1 scale per second.
 *
 * The other half of the heat model, and it lived in `game/systems.ts` because
 * that is where the ship's per-frame numbers are advanced. Heat is a property
 * of the GUN — `LASER_PACING` says how much each shot adds and `LASER_CUTOUT`
 * says when it stops firing — so the third number of the three belongs beside
 * them rather than beside the energy banks it shares a step with.
 *
 * It is what decides whether a mount can be held down. Against `LASER_PACING`:
 * the pulse adds 0.055 every 0.24s, which is 0.229 a second against 0.22 of
 * cooling — it nets +0.009 and takes about 107 seconds of continuous fire to
 * reach the cut-out, so in practice it never does. The beam nets +0.169 and
 * cuts out in 5.8 seconds; the military laser nets +0.113 and lasts 8.7. From
 * the cut-out, a cold gun is 4.5 seconds away.
 */
export const LASER_COOL_RATE = 0.22;

/**
 * How much of a target's silhouette counts as a hit, as a multiple of its
 * radius.
 *
 * THE PLAYER'S ONLY, and there is no NPC number it has to agree with: an NPC's
 * shot is not a ray through a cone at all, it is `npcHitChance`'s die roll
 * behind `NPC_FIRE_GATE`. The warning that used to stand here named the training
 * simulator's `LASER.aim` as the thing not to confuse this with, and that second
 * gun no longer exists — the trainer flies `npcTriggerPull` like everything else.
 */
export const LASER_GRAZE = 0.9;

/**
 * Grazing radius for drifting cargo, in world units. Canisters are ~12 units
 * across, so an exact ray needs 1.4 degrees at 500m and they felt unhittable.
 * They are not a skill target — shooting one is a deliberate act — so they get
 * a flat, generous tolerance.
 */
export const CANISTER_GRAZE = 20;

/**
 * Aim assist: an angular allowance ON TOP of the target's silhouette, so a
 * shot that is nearly right still connects.
 *
 * Chris's idea, and the player's half of the problem the NPCs have. A
 * Sidewinder at 500 units subtends 1.9 degrees; holding a human hand inside that
 * while both ships manoeuvre is most of why fights felt like flailing. Two
 * degrees at knife range, tapering to nothing by ASSIST_FADE_END so distance
 * shooting still demands precision and nobody snipes across three kilometres.
 *
 * The ring sight is drawn to this exact angle — see #crosshair in style.css.
 * If you change it, the reticle changes with it, which is the point: the
 * circle is not decoration, it is the envelope.
 */
export const AIM_ASSIST = 0.035;
export const ASSIST_FADE_START = 900;
export const ASSIST_FADE_END = 2400;
