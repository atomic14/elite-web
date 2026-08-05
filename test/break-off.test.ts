// The attack run: closing, the pass, extending, and what interrupts it.
//
// Its own file because `game/break-off.ts` is its own module and this section
// grew from one steering rule into a whole cycle. It was the middle third of
// `npc.test.ts`, which reached 440 lines — and "it is long" is not a reason to
// allowlist, so it split where the subsystem already had a seam.
//
// What it holds: that a hostile shoots at every range a fight happens at (the
// TODO 42 regression), that the ship flies THROUGH the pass rather than
// attempting a 180 it has no room for, that the cycle comes back round, and
// that being shot at while extending breaks the straight line.
//
// WHERE the closing leg aims is `pass-aim.test.ts`, beside `game/pass-aim.ts`,
// for the same reason this file exists: it is its own module now.


import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip, hostilesNear } from '../src/game/npc.ts';
import {
  nextAttackPhase, closingThrottle, describeFlight, type AttackPhase,
  rollExtendRange,
} from '../src/game/break-off.ts';
import {
  BREAK_OFF_RANGE, CLOSING_THROTTLE_MIN, EXTEND_RANGE_MAX, EXTEND_RANGE_MIN,
  MIN_CRUISE_FRACTION, UNDER_FIRE_SECONDS,
} from '../src/constants/attack-run.ts';
import { TACTIC_IDS } from '../src/constants/tactics.ts';
import { PLAYER_INTEREST_RANGE } from '../src/constants/player-interest.ts';
import { SHIPPED_BRAINS } from '../src/game/brain-names.ts';
import type { NpcRole } from '../src/game/ship-roles.ts';
import { PASS_FAR } from '../src/constants/combat-record.ts';
import { check } from './harness.ts';


// --- the break-off does not switch the guns off -----------------------------
//
// TODO 42, and the measurement that found it: a hostile PINNED nose-on to a
// stationary commander, shots in 20 seconds, by range. Pinning takes the flight
// out of the measurement, so what is left is the gun — the gate, the range and
// the cooldown — which is the thing that was broken. Before the fix:
//
//   range :   120  180  210  240  300  500  900 1500 2500 3400
//   police:     0    0    0   16   16   16   16   16   16   16
//
// Zero inside 220, because `attack()` steered away and `return null`ed in one
// statement. Chris's recorded median engagement range is 260 and his 10th
// percentile 214, so the dead zone was exactly where he fights.

console.log('\nNPC break-off');
{
  const origin = new THREE.Vector3(0, 0, 0);
  const station = new THREE.Object3D();
  /** Shots this role gets away in 20s, held nose-on at `range`. */
  const pinnedShots = (role: NpcRole, range: number, seed: number): number => {
    seedWorld(seed);
    const npc = new NpcShip(role, new THREE.Vector3(0, 0, range), seed % 17);
    // Lasers only: a missile REPLACES the bolt it was going to fire
    // (chooseWeapon), so a loaded rack would undercount the gun.
    npc.state.missiles = 0;
    const player = { position: origin, quaternion: new THREE.Quaternion(), speed: 0 } as never;
    // A fugitive, so police and hunters are hostile too — one rule, every role.
    const view = {
      station, dockZ: 160, fleet: [npc], playerLegal: 2, brains: SHIPPED_BRAINS, missileInbound: false,
    };
    let n = 0;
    for (let i = 0; i < 20 * 60; i++) {
      npc.object.position.set(0, 0, range);   // pin: hold the range...
      npc.faceToward(origin);                 // ...and the firing line
      const ev = npc.update(1 / 60, player, view);
      if (ev && ev.at === 'player' && ev.weapon === 'laser') n += 1;
    }
    return n;
  };

  // Inside the break-off, at it, and well outside it. The first three are the
  // ranges that read zero.
  const BANDS = [120, 180, 210, 240, 900, 3400];
  for (const role of ['pirate', 'police', 'hunter', 'thargoid'] as const) {
    const row = BANDS.map((r) => pinnedShots(role, r, 4200 + r));
    check(`a ${role} shoots at every range a fight happens at (${row.join('/')} at ${BANDS.join('/')})`,
      row.every((n) => n > 0));
  }
  // ...and it is the SAME rule for all four: nobody has a range band of their
  // own. A Thargoid still shoots more often, which is THARGOID_FIRE_RATE on the
  // shared cooldown and not a second range.
  //
  // ...and inside the break-off it FLIES THROUGH rather than turning away.
  //
  // This asserted the opposite until Chris flew every AI in the game and said
  // the scripted one felt best except that it kept colliding with him: "the
  // break off by turning 180 is not right — the correct thing would be to do an
  // attack run and fly past, then turn for another attack run." The old rule
  // steered to `own * 2 - target`, a reversal, at 220 units — and no hull can
  // complete one in that room. A Krait needs 651 units of travel to come about
  // and a Python 1,026, so the "turn away" was a ship rotating while it flew
  // into you. break-off.ts has the arithmetic.
  //
  // So the nose STAYS on the target through the pass — the heading that got
  // here is the one that carries it past — and the turning happens out at
  // EXTEND_RANGE where there is room. The half of the old `return null` that
  // was always right is the shooting, and that is asserted below unchanged.
  {
    seedWorld(99);
    const npc = new NpcShip('police', new THREE.Vector3(0, 0, BREAK_OFF_RANGE - 40), 3);
    npc.faceToward(origin);
    let shots = 0;
    for (let i = 0; i < 30; i++) {
      if (npc.attack(1 / 60, origin, npc.object.position.distanceTo(origin), true)) shots += 1;
    }
    check(`a ship inside the break-off commits to the pass (${npc.facing(origin).toFixed(2)} rad)`,
      npc.facing(origin) < 0.5);
    check('...and that is what the phase says it is doing',
      npc.state.attackPhase === 'passing');
    check(`...and shot on the way through (${shots})`, shots > 0);
  }

  // TWO DISTANCES, ONE HOME EACH — the same bug one rule apart. Break-off was
  // a literal in npc.ts and a constant in brains.ts, and only the constant got
  // corrected. 9,000 had THREE names for whether a hostile engages, whether the
  // light is red, and whether the combat computer you paid for flies your ship.
  const code = (path: string) =>
    readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ONE_HOME = [
    ['constants/attack-run.ts', BREAK_OFF_RANGE, ['game/npc.ts', 'game/brains.ts']],
    ['constants/player-interest.ts', PLAYER_INTEREST_RANGE,
      ['game/npc.ts', 'game/npc-targeting.ts', 'hud/hud-model.ts']],
  ] as const;
  for (const [home, value, consumers] of ONE_HOME) {
    const literal = new RegExp(`\\b${value}\\b`), base = home.split('/').pop()!;
    check(`${home} states its distance`, literal.test(code(home)));
    for (const f of consumers) {
      // Match the file NAME: the import is relative ('./break-off.ts').
      check(`${f} takes it from ${home} rather than restating it`,
        code(f).includes(base) && !literal.test(code(f)));
    }
    // ...and it can say no: the file allowed to state it fails both terms.
    check(`...and the ban is not vacuous — ${home} fails both halves of it`,
      !code(home).includes(`from './${base}'`) && literal.test(code(home)));
  }
  // And the light really reads the value rather than agreeing by coincidence.
  seedWorld(4242);
  const hostile = new NpcShip('pirate', new THREE.Vector3(0, 0, 0), 0);
  Object.assign(hostile.state, { provoked: true, provokedByPlayer: true });
  check('the condition light is red just inside the range',
    hostilesNear([hostile], new THREE.Vector3(0, 0, PLAYER_INTEREST_RANGE - 10), 0));
  check('...and yellow just outside it',
    !hostilesNear([hostile], new THREE.Vector3(0, 0, PLAYER_INTEREST_RANGE + 10), 0));
}

// --- who hunts whom ---------------------------------------------------------

// --- an attack run, and what breaks it --------------------------------------

// The run is a cycle and `nextAttackPhase` is pure so it can be walked without
// flying anything. `EXTEND_RANGE` is only the DEFAULT — the middle of the band
// — since every ship rolls its own; it used to be the report's own `PASS_FAR`,
// and combat-sim-report.ts has what became of that coupling.
{
  const walk = (start: AttackPhase, ds: number[], fire = false) =>
    ds.reduce((p, d) => nextAttackPhase(p, d, fire), start);

  check('a run closes, passes, extends and comes round again',
    walk('closing', [4000, 900, 219, 260, 500, 901]) === 'closing');
  check('...it does not turn at 500, which would be a wobble not a break-off',
    walk('closing', [219, 260, 500]) === 'extending');
  check('...and knife range starts a pass from any phase',
    nextAttackPhase('extending', 150) === 'passing'
    && nextAttackPhase('closing', 150) === 'passing');

  // Chris: "an NPC should switch modes if it's getting hit — flying in a
  // straight line just absorbing damage is not something a normal person would
  // do." Extending is the only phase that holds one heading long enough for
  // that to be true, so it is the only one being hit changes.
  check('a ship being hit while extending stops running in a straight line',
    nextAttackPhase('extending', 300, true) === 'closing');
  check('...and is left alone when nothing is landing',
    nextAttackPhase('extending', 300, false) === 'extending');
}

// --- the throttle rule ------------------------------------------------------
//
// Chris: "if an NPC needs to turn quickly, it should slow down? And then speed
// up?" The rule is closingThrottle, and what these hold is that it is a
// function of the ANGLE and that it never reaches down to a standstill.

check('closingThrottle: pointed at the target is full throttle',
  closingThrottle(0) === 1, `got ${closingThrottle(0)}`);

check('closingThrottle: 90 degrees off is the floor',
  Math.abs(closingThrottle(Math.PI / 2) - CLOSING_THROTTLE_MIN) < 1e-9,
  `got ${closingThrottle(Math.PI / 2)}`);

// Past 90 the cosine goes negative; the clamp is what stops it asking for a
// reverse throttle, which is not a thing a ship in this game has.
check('closingThrottle: a full reversal does not go below the floor',
  closingThrottle(Math.PI) === CLOSING_THROTTLE_MIN,
  `got ${closingThrottle(Math.PI)}`);

check('closingThrottle: monotone — more off-line is never more throttle', (() => {
  let prev = Infinity;
  for (let deg = 0; deg <= 180; deg += 5) {
    const v = closingThrottle((deg * Math.PI) / 180);
    if (v > prev + 1e-9) return false;
    prev = v;
  }
  return true;
})());

// The two rules must not argue. MIN_CRUISE_FRACTION exists to stop a fighter
// stopping dead and becoming a turret — the g2 failure Chris played and
// rejected. If this rule could ask for less than that, the floor would be doing
// the flying and the rule would be dead code below its own knee.
check('closingThrottle: its slowest stays ABOVE the turret floor',
  CLOSING_THROTTLE_MIN > MIN_CRUISE_FRACTION,
  `${CLOSING_THROTTLE_MIN} vs cruise floor ${MIN_CRUISE_FRACTION}`);

// --- every run is a different length ----------------------------------------
//
// Chris, having flown the fixed version: "they fly quite far before turning for
// another run", then "I think we should have some randomness in the behaviour."
// One fixed range made a gang of five turn together and come back as a wave.

check('rollExtendRange spans exactly the band',
  rollExtendRange(0) === EXTEND_RANGE_MIN && rollExtendRange(1) === EXTEND_RANGE_MAX,
  `${rollExtendRange(0)}..${rollExtendRange(1)} should be ${EXTEND_RANGE_MIN}..${EXTEND_RANGE_MAX}`);

check('rollExtendRange never leaves the band', (() => {
  for (let i = 0; i <= 100; i++) {
    const v = rollExtendRange(i / 100);
    if (v < EXTEND_RANGE_MIN || v > EXTEND_RANGE_MAX) return false;
  }
  return true;
})());

// The band has to be wide enough to actually destagger a gang. Two ships that
// roll 0.0 and 1.0 must end up far enough apart that they are not flying the
// same run — a band of 50 units would satisfy every other assertion here and
// change nothing a player could see.
check('the band is wide enough to destagger a gang',
  EXTEND_RANGE_MAX - EXTEND_RANGE_MIN >= BREAK_OFF_RANGE,
  `spread ${EXTEND_RANGE_MAX - EXTEND_RANGE_MIN} should be at least one break-off`);

// THE COUPLING, asserted rather than remembered. The pass counter needs the
// ship to open back out past PASS_FAR; if a ship may turn back before it ever
// gets there, the measurement stops seeing the runs the model produces. The
// tightest run still apexes above EXTEND_RANGE_MIN because the ship keeps
// opening while it comes round, so this is the conservative form — and the
// measured version is in combat-sim-report.ts, where 600 counts 92% of the
// merges this band actually flies and the 900 it replaced counted 12%.
check('PASS_FAR stays below the shortest run the model can fly',
  PASS_FAR < EXTEND_RANGE_MIN + BREAK_OFF_RANGE,
  `PASS_FAR ${PASS_FAR} vs tightest apex ~${EXTEND_RANGE_MIN + BREAK_OFF_RANGE}`);

// nextAttackPhase must honour the ship's OWN rolled range, not the default.
check('a ship with a short roll turns back early',
  nextAttackPhase('extending', 700, false, 500) === 'closing'
  && nextAttackPhase('extending', 700, false, 900) === 'extending',
  'the rolled range must be what the phase machine reads');

// --- what the record says a ship was doing ----------------------------------
//
// Chris: "what would be good in the combat trainer would be stats on each npc
// with the current strategy it's following." The record could already say where
// a ship was and how fast; it could not say what it was TRYING to do, so a row
// reading `passes: 0, medianRange: 2610` was a fact with no explanation
// attached. `describeFlight` is the one place a phase becomes a word, because
// two samplers ask — the game's trainer and train/flight-probe.ts — and a
// phrase invented twice drifts.

// Since docs/TODO/68 it is TWO words — the tactic and then the leg — because
// the tactic is what explains the leg, and the column counts seconds per
// phrase, so a ship that changed its mind mid-fight shows up as two runs of
// time rather than as one label that only says what it is doing now.
check('a ship flying its run reports the tactic and the phase it is in',
  describeFlight('closing', 0, false, 'scripted', 'run') === 'run closing'
  && describeFlight('passing', 0, false, 'scripted', 'slash') === 'slash passing'
  && describeFlight('extending', 0, false, 'scripted', 'knife') === 'knife extending');

// Being shot at outranks the phase, because it is the answer to "why has it
// stopped flying the run" — which is the interesting thing to see in a log. The
// tactic stays in front of it: it is what the ship goes back to.
check('...but being hit outranks it, whatever it had planned',
  describeFlight('extending', UNDER_FIRE_SECONDS, false, 'scripted', 'run') === 'run evading'
  && describeFlight('closing', 0.1, false, 'scripted', 'ram') === 'ram evading');

check('...and fleeing outranks even that',
  describeFlight('closing', UNDER_FIRE_SECONDS, true) === 'fleeing');

// A brain-flown ship's tactic is DORMANT until it hands over at
// BRAIN_HANDOVER_RANGE, so naming one would report a plan nothing is executing
// — the same lie `flownBy` was added to stop.
check('...and a brain-flown ship names no tactic, because it is flying none',
  describeFlight('closing', 0, false, 'brain', 'knife') === 'own policy'
  && describeFlight('closing', 0.4, false, 'brain', 'knife') === 'evading');

// It must describe the ship, not a guess about it: every phase the flight can
// be in has to come back as something, or a log would silently lose frames —
// and now every TACTIC too, or a ship rolling a new one would vanish from the
// column that exists to show it.
check('every attack phase and every tactic has a name',
  (['closing', 'passing', 'extending'] as AttackPhase[]).every(
    (p) => TACTIC_IDS.every((t) => describeFlight(p, 0, false, 'scripted', t).length > 0)));
