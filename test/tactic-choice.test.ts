// The CHOICE: may this hull fly that tactic, which one does it take, and what
// makes it re-decide.
//
// `tactics.test.ts` beside this holds the table and flies each row. This holds
// the three rules `game/tactic-choice.ts` owns, in the order docs/TODO/68's
// acceptance asks for them:
//
//   - a hull is never offered a tactic it cannot physically execute, asserted
//     over the WHOLE roster and called out for the slowest hull in it
//   - a switching trigger fires on damage, asserted twice: once against the
//     pure rule and once against a ship that is actually being shot at
//   - a tactic is rolled from `rng.ts`, so the same seed gives the same sky
//   - ...and it survives a save/restore round trip, because `NpcState` is
//     walked generically and this is the assertion that says so for real

import * as THREE from 'three';
import { seedWorld } from '../src/game/rng.ts';
import { TACTICS, TACTIC_IDS, type TacticId } from '../src/constants/tactics.ts';
import {
  chooseTactic, tacticsFor, tacticSwitchReason,
  type TacticHull, type TacticReason,
} from '../src/game/tactic-choice.ts';
import {
  PASS_CLEARANCE, RAM_MIN_SPEED, TACTIC_HURT_HEALTH, TACTIC_LAST_STAND_HEALTH,
  TACTIC_MIN_DWELL, TACTIC_SLEEPER_SECONDS,
} from '../src/constants/tactic-choice.ts';
import { COMMANDER_HULL_RADIUS } from '../src/constants/collision.ts';
import { NpcShip } from '../src/game/npc.ts';
import { SPECS, CONSTRICTOR_SPEC, type NpcSpec } from '../src/game/ship-specs.ts';
import { registeredHull } from '../src/ships/registry.ts';
import { serialiseState, restoreState } from '../src/game/snapshot.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { check } from './harness.ts';

console.log('\nwhich tactic, and when');

// --- the capability gate -----------------------------------------------------

/** Every hull the roster flies, as the three numbers a tactic gate reads. */
const ROSTER: { name: string; role: string; hull: TacticHull }[] = [
  ...Object.entries(SPECS).flatMap(([role, list]) => (list as NpcSpec[]).map((s) => ({
    name: s.designId, role, hull: {
      radius: registeredHull(s.designId).targetRadius,
      maxSpeed: s.maxSpeed,
      turnRate: s.turnRate,
    },
  }))),
  {
    name: CONSTRICTOR_SPEC.designId,
    role: 'pirate',
    hull: {
      radius: registeredHull(CONSTRICTOR_SPEC.designId).targetRadius,
      maxSpeed: CONSTRICTOR_SPEC.maxSpeed,
      turnRate: CONSTRICTOR_SPEC.turnRate,
    },
  },
];

const REASONS: TacticReason[] = ['spawn', 'hurt', 'lastStand', 'sleeper'];
/** Fine enough to land in every weight band, including a 15-in-100 one. */
const ROLLS = Array.from({ length: 201 }, (_, i) => i / 200);

// The acceptance's first half: whatever the dice say, a ship only ever gets a
// tactic its own hull is on the list for. Everything below is a claim about
// `tacticsFor`; this is the claim that `chooseTactic` cannot escape it.
{
  let escaped = '';
  for (const { name, hull } of ROSTER) {
    for (const health of [1, 0.8, TACTIC_HURT_HEALTH, 0.3, TACTIC_LAST_STAND_HEALTH, 0.05]) {
      const offered = tacticsFor(hull, health);
      for (const reason of REASONS) {
        for (const roll of ROLLS) {
          for (const current of TACTIC_IDS) {
            const got = chooseTactic(hull, health, reason, roll, current);
            if (!offered.includes(got)) escaped = `${name} was given ${got} at hp ${health}`;
          }
        }
      }
    }
  }
  check(`no hull is ever given a tactic it is not offered${escaped && ` — ${escaped}`}`,
    escaped === '');
}

// ...and being OFFERED one means the pass physically clears both hulls. The
// factor is pass-aim.ts's measurement of what an intent actually delivers, not
// a margin somebody liked: at an intended 110 no merge on any hull closed
// inside 70, so the delivered floor is about 0.64 of the intent.
{
  let tooTight = '';
  for (const { name, hull } of ROSTER) {
    const contact = hull.radius + COMMANDER_HULL_RADIUS;
    for (const id of tacticsFor(hull, 0.01)) {
      const t = TACTICS[id];
      if (t.aimsToHit || id === 'run') continue;
      if (t.missDistance < contact * PASS_CLEARANCE) tooTight = `${name} offered ${id}`;
    }
  }
  check(`every gated tactic a hull is offered clears that hull${tooTight && ` — ${tooTight}`}`,
    tooTight === '');
}

// THE SLOWEST HULL IN THE ROSTER, called out by name because docs/TODO/68 asks
// for it by name. The failure it stands for is real and recorded: a Python
// making 0 passes in a wave-9 fight, loitering at 739 units because the
// behaviour it had been given was one it could not execute.
{
  const slowest = ROSTER.reduce((a, b) => (b.hull.maxSpeed < a.hull.maxSpeed ? b : a));
  const combat = ROSTER.filter(
    (r) => r.role === 'pirate' || r.role === 'police' || r.role === 'hunter'
      || r.role === 'thargoid' || r.role === 'thargon');
  const slowestFighter = combat.reduce((a, b) => (b.hull.maxSpeed < a.hull.maxSpeed ? b : a));
  const neverRams = (h: TacticHull): boolean =>
    [1, 0.3, TACTIC_LAST_STAND_HEALTH, 0].every((hp) => !tacticsFor(h, hp).includes('ram'))
    && REASONS.every((r) => ROLLS.every((roll) => chooseTactic(h, 0, r, roll) !== 'ram'));
  check(`the slowest hull in the roster (${slowest.name}, ${slowest.hull.maxSpeed} u/s)`
    + ' is never offered the ram, at any health, on any roll',
  neverRams(slowest.hull));
  check(`...nor the slowest hull that any combat role flies (${slowestFighter.name},`
    + ` ${slowestFighter.hull.maxSpeed} u/s, against a ${RAM_MIN_SPEED.toFixed(0)} floor)`,
  neverRams(slowestFighter.hull));
  // ...and it is not offered nothing, either. `run` is the floor: the behaviour
  // every hostile flies today, so it is the one tactic whose flyability is
  // established by having shipped.
  check('...but it is always offered the standard run',
    ROSTER.every((r) => tacticsFor(r.hull, 1).includes('run')));
}

// A gate has to BIND, or it is decoration — and the two do not bind equally,
// which is worth an assertion rather than a comment. The SPEED gate is the one
// with teeth: about half the roster is too slow to be given a ram. The SIZE
// gate only excludes the largest hulls, because the pass width where it would
// exclude many is a width the flight model rams at (see `TACTICS.knife`), so
// the honest state of it is "real, and rarely the binding constraint".
{
  const knifers = ROSTER.filter((r) => tacticsFor(r.hull, 1).includes('knife'));
  const rammers = ROSTER.filter((r) => tacticsFor(r.hull, 0).includes('ram'));
  check(`the speed gate bites hard: ${rammers.length} of ${ROSTER.length} roster hulls`
    + ' are fast enough to be offered a ram',
  rammers.length > 5 && rammers.length < ROSTER.length * 0.75);
  check(`the size gate bites, on the largest hulls only:`
    + ` ${ROSTER.length - knifers.length} of ${ROSTER.length} are too big to knife`,
  knifers.length < ROSTER.length && knifers.length > ROSTER.length * 0.75);
}

// --- the ram is reachable from one place only --------------------------------

{
  const quick: TacticHull = { radius: 15, maxSpeed: 330, turnRate: 1.1 };
  check('a healthy ship can never roll a ram, whatever the reason or the roll',
    REASONS.every((r) => ROLLS.every((roll) => chooseTactic(quick, 1, r, roll) !== 'ram')));
  check('...nor at any health above the last stand',
    REASONS.every((r) => ROLLS.every(
      (roll) => chooseTactic(quick, TACTIC_LAST_STAND_HEALTH + 0.01, r, roll) !== 'ram')));
  check('...but a dying one that can catch you does, on some rolls',
    ROLLS.some((roll) => chooseTactic(quick, 0.1, 'lastStand', roll) === 'ram'));
  // A last stand is a commitment: a ship that changed its mind halfway through
  // one would read as a bug rather than as a decision.
  check('...and once it has, nothing re-rolls it',
    tacticSwitchReason({
      tactic: 'ram', health: 0.05, underFire: 1, sinceChosen: 60, sinceShot: 60,
    }) === null);
}

// --- the switches ------------------------------------------------------------

{
  const situation = (over: Partial<Parameters<typeof tacticSwitchReason>[0]> = {}) => ({
    tactic: 'run' as TacticId, health: 1, underFire: 0, sinceChosen: 30, sinceShot: 0, ...over,
  });
  check('a ship left alone and shooting keeps the tactic it rolled',
    tacticSwitchReason(situation()) === null);

  // THE TRIGGER CHRIS ASKED FOR. Damage AND a hull going the wrong way, not
  // damage alone — every ship in a firefight is hit within seconds, so a bare
  // damage trigger re-rolls the whole sky and the spawn roll means nothing.
  check('being hit while hurt is a reason to rethink',
    tacticSwitchReason(situation({ underFire: 1.2, health: TACTIC_HURT_HEALTH })) === 'hurt');
  check('...and being hit while nearly dead is a different one',
    tacticSwitchReason(
      situation({ underFire: 1.2, health: TACTIC_LAST_STAND_HEALTH })) === 'lastStand');
  check('...while being hit at full strength is not a reason at all',
    tacticSwitchReason(situation({ underFire: 1.2, health: 1 })) === null);
  check('...and neither is being hurt by something that stopped shooting',
    tacticSwitchReason(situation({ underFire: 0, health: 0.2 })) === null);

  // THE SLEEPER: "this is not working, try something else". It is what would
  // have stopped the Python loitering for 22 seconds.
  check('a ship whose guns have been cold for a whole attack run tries something else',
    tacticSwitchReason(situation({ sinceShot: TACTIC_SLEEPER_SECONDS })) === 'sleeper');
  check('...and one that got a shot away this cycle does not',
    tacticSwitchReason(situation({ sinceShot: TACTIC_SLEEPER_SECONDS - 0.1 })) === null);
  check('...and it really does pick something else',
    ROLLS.every((roll) => chooseTactic(
      { radius: 15, maxSpeed: 330, turnRate: 1.1 }, 1, 'sleeper', roll, 'run') !== 'run'));

  // The dwell, both ways: long enough that a tactic is always seen, short
  // enough that a ship being hammered can change its mind more than once.
  check('nothing switches before the dwell is up',
    tacticSwitchReason(
      situation({ underFire: 1.2, health: 0.1, sinceChosen: TACTIC_MIN_DWELL - 0.01 })) === null);
  check('...and everything may once it is',
    tacticSwitchReason(
      situation({ underFire: 1.2, health: 0.1, sinceChosen: TACTIC_MIN_DWELL })) === 'lastStand');
}

// --- rolled from rng.ts, so the same seed gives the same sky ------------------

{
  const tacticsOf = (seed: number): string => {
    seedWorld(seed);
    return Array.from({ length: 30 }, (_, i) =>
      new NpcShip('pirate', new THREE.Vector3(i * 100, 0, 0), i).state.tactic).join(' ');
  };
  const first = tacticsOf(70_000_019);
  check('the same seed rolls the same tactics, ship for ship',
    tacticsOf(70_000_019) === first);
  check('...and a different seed does not', tacticsOf(70_000_023) !== first);
  // A vocabulary nobody speaks is not a vocabulary. This is the assertion that
  // the weights actually reach past the default.
  const spoken = new Set(first.split(' '));
  check(`...and a sky of 30 pirates speaks more than one of them (${[...spoken].join(', ')})`,
    spoken.size >= 2 && spoken.has('run'));
}

// --- it is state, so it saves ------------------------------------------------
//
// `NpcState` is walked generically by snapshot.ts, so a field added to it is
// saved for free. "For free" is a claim, and this is the assertion that pays
// it: the tactic and both of its clocks through a serialise, a JSON round trip
// and a restore into a ship that had rolled something else.

{
  seedWorld(70_000_031);
  const saved = new NpcShip('pirate', new THREE.Vector3(0, 0, 900), 3);
  saved.state.tactic = 'knife';
  saved.state.tacticClock = 3.25;
  saved.state.dryFor = 7.5;
  const wire = JSON.parse(JSON.stringify(
    serialiseState(saved.state as unknown as Record<string, unknown>))) as Record<string, unknown>;
  check('a tactic is in the snapshot by name, without anything listing it',
    wire.tactic === 'knife' && wire.tacticClock === 3.25 && wire.dryFor === 7.5);
  seedWorld(70_000_037);
  const restored = new NpcShip('pirate', new THREE.Vector3(0, 0, 900), 3);
  // Through a setter, so the compiler does not narrow the field to the literal
  // it was last assigned and then decide the assertion below cannot be true.
  const setTactic = (n: NpcShip, t: TacticId): void => { n.state.tactic = t; };
  setTactic(restored, 'slash');
  restoreState(restored.state as unknown as Record<string, unknown>, wire);
  const came: TacticId = restored.state.tactic;
  check('...and it comes back, over whatever the fresh ship had rolled',
    came === 'knife'
    && restored.state.tacticClock === 3.25 && restored.state.dryFor === 7.5);
}

// --- the damage trigger fires on a ship that is actually being shot at --------
//
// The pure rule is asserted above. This is the same claim observed where it has
// to be true: a hostile flying at a target, hurt while it flies, changing what
// it is doing. `tacticClock` resetting is the observable — a re-roll may land
// on the same tactic, and "it decided again" is the thing being asserted.

{
  const station = new THREE.Object3D();
  const view = (fleet: readonly NpcShip[]) => ({
    station, dockZ: 160, fleet, playerLegal: 2, brains: { scripted: true }, missileInbound: false,
  });
  const player = {
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), speed: 0,
  } as never;
  let switched = 0;
  let changedId = 0;
  for (let seed = 0; seed < 24; seed++) {
    seedWorld(80_000_009 + seed * 7919);
    // A police ship under the `scripted` selection, so it flies `attack()` —
    // the hand-written run the tactic machine governs — rather than the pursuit
    // dogfighter the opposition now flies by default (which has no tactic). This
    // is a test about the tactic, so it flies the pilot that has one.
    const npc = new NpcShip('police', new THREE.Vector3(0, 0, 700), seed);
    for (let i = 0; i < 60 * 8; i++) npc.update(FIXED_DT, player, view([npc]));
    const before = npc.state.tactic;
    // Hurt it. `takeDamage` is the one place every damage source funnels
    // through, so this is the same signal a laser bolt delivers.
    npc.state.energy = npc.maxEnergy * 0.15;
    npc.state.underFire = 1.2;
    npc.state.tacticClock = TACTIC_MIN_DWELL;
    npc.update(FIXED_DT, player, view([npc]));
    if (npc.state.tacticClock < FIXED_DT * 2) switched += 1;
    if (npc.state.tactic !== before) changedId += 1;
  }
  check(`a hostile hurt in flight re-decides how it is fighting (${switched} of 24)`,
    switched === 24);
  check(`...and most of them come out flying something else (${changedId} of 24)`,
    changedId >= 12);
}
