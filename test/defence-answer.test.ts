// What a defender can SEE, and what it can DO about it.
//
// docs/TODO/71 and /72, which are ONE observation change. `observe()` is
// fourteen numbers, none of them the defender's own condition and none of them
// "there is a warhead coming", so a defender at full shields and one hit from
// the escape capsule emitted identical controls in identical geometry — and the
// kill rate was the same to the decimal either side of docs/TODO/63 because
// nothing about the flying COULD change.
//
// The fix is a separate encoder and a separate head rather than two more slots
// on `observe()`, and the whole argument for that choice is one property: the
// two pirate policies are untouched, byte for byte. That is a thing to assert,
// not a thing to hope, and it is what this file is for.
//
// It is its own file rather than blocks in ai.test.ts, missiles.test.ts,
// ui.test.ts and snapshot.test.ts — where the five halves would naturally have
// gone — because the two items are ONE change and the claim is about the whole
// of it: the encoder routes, the new slots carry the right numbers, the button
// answers a real warhead in a real episode, the co-pilot presses it in the game,
// the press survives a save, and NOTHING ELSE PAID FOR ANY OF IT. Split five
// ways, that last clause is the one nobody would be able to read.

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import {
  randomBrain, widenBrain, genomeSize, act, makeScratch,
  OBS_SIZE, DEFEND_OBS_SIZE, PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE, DEFEND_OUT_SIZE,
  HIDDEN, MAX_OBS_SIZE,
  type Brain, type BrainFile,
} from '../src/ai-training/policy.ts';
import { observeFor, shipView, type ShipView } from '../src/ai-training/observation.ts';
import { makeRng } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';
import { BRAINS, jameson } from './fixtures.ts';
import {
  Episode, EPISODE_SCHEMA, type EpisodeReport,
} from '../src/ai-training/scenario.ts';
import { defenceFight } from '../train/defence-fight.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { Ordnance, fireEcm, autopilotEcm } from '../src/game/ordnance.ts';
import { ECM_ENERGY_COST } from '../src/constants/ordnance.ts';
import { playerImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { MAX_ENERGY } from '../src/constants/pools.ts';
import { freshSystems } from '../src/game/systems.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { serialiseState, restoreState } from '../src/game/snapshot.ts';
import { Autopilot } from '../src/game/autopilot.ts';
import { CombatComputer, freshAutopilot } from '../src/game/combat-computer.ts';
import { defenceBrain } from '../src/game/brains.ts';
{
  console.log('\nthe defence encoder');
  const rng = makeRng(0x5eed);
  const geometry = (z: number, targetSpeed: number): [ShipView, ShipView] => {
    const me = shipView(220, 0.5, 120);
    const tgt = shipView(300, 1.1, targetSpeed);
    me.pos.z = z;
    return [me, tgt];
  };

  // 1. THE SIZES ARE DISTINCT, which is what makes `observeFor` able to choose.
  const sizes = [OBS_SIZE, DEFEND_OBS_SIZE, PACK_OBS_SIZE, PACK_WIDE_OBS_SIZE];
  eq('the four observation sizes are distinct', new Set(sizes).size, sizes.length);

  // 2. `observeFor` ROUTES BY SIZE, and a defender has no fleet — the case the
  //    function's own comment warned about, where a wider brain falls through
  //    to the solo encoder and reads whatever is left in the tail.
  {
    const [me, tgt] = geometry(1500, 200);
    me.hp = 0.4; me.energy = 0.2; me.missileInbound = true;
    const buf = new Float32Array(MAX_OBS_SIZE).fill(-9);
    const defender = randomBrain(rng, DEFEND_OBS_SIZE, HIDDEN, 0.5, DEFEND_OUT_SIZE);
    observeFor(defender, me, tgt, null, buf);
    check('a defence brain with no fleet still gets the defence encoder',
      Math.abs(buf[13] - 0.4) < 1e-6 && Math.abs(buf[14] - 0.2) < 1e-6 && buf[15] === 1);
    const solo = randomBrain(rng, OBS_SIZE);
    buf.fill(-9);
    observeFor(solo, me, tgt, null, buf);
    check('...and a solo-input brain never reaches those slots', buf[13] === -9);
  }

  // 3. THE ACCEPTANCE TEST, both ways round. One genome, one geometry, two
  //    health values: the controls must move for a defence policy and must NOT
  //    move for the fourteen-input family, which is the defect being fixed.
  const controlsAcross = (brain: Brain, hp: number): string => {
    const scratch = makeScratch();
    const buf = new Float32Array(MAX_OBS_SIZE);
    const out: string[] = [];
    for (const targetSpeed of [0, 220, 400]) {
      for (const z of [400, 900, 1800, 2600]) {
        const [me, tgt] = geometry(z, targetSpeed);
        me.hp = hp;
        me.energy = hp;
        const c = act(brain, observeFor(brain, me, tgt, null, buf), scratch);
        out.push(`${c.pitch}${c.roll}${c.throttle}${c.fire ? 1 : 0}${c.ecm ? 1 : 0}`);
      }
    }
    return out.join(' ');
  };
  {
    // A genome that reads its own pools and nothing else: hidden unit 0 is
    // `sign(pools - 0.5)`, wired off slot 13 against slot 12 (the encoder's
    // constant bias — one slot down since docs/TODO/91 deleted the raw-speed
    // input), and the pitch head is wired off unit 0. So "whole" and "hurt"
    // are two different pilots and every other input is ignored. Hand-built
    // rather than trained, so the assertion is about the ENCODER and not
    // about a run.
    const H = 8;
    const w = new Float32Array(genomeSize(DEFEND_OBS_SIZE, H, DEFEND_OUT_SIZE));
    const GAIN = 24;
    w[0 * DEFEND_OBS_SIZE + 13] = GAIN;        // + our own pools
    w[0 * DEFEND_OBS_SIZE + 12] = -GAIN / 2;   // ...less a half, so the sign flips
    const l2 = DEFEND_OBS_SIZE * H + H;
    w[l2 + 0 * H + 0] = GAIN;                  // passed through, saturated
    const head = l2 + H * H + H;
    w[head + 0 * H + 0] = -6;                  // pitch -1 when hurt
    w[head + 2 * H + 0] = 6;                   // pitch +1 when whole
    const sees: Brain = {
      weights: w, obsSize: DEFEND_OBS_SIZE, hidden: H, outSize: DEFEND_OUT_SIZE,
    };
    check('a defence policy flies differently at two health values',
      controlsAcross(sees, 1) !== controlsAcross(sees, 0.05));
    // ...and the whole fourteen-input family cannot, which is what docs/TODO/71
    // is. `observe()` never writes a health slot, so every genome of that shape
    // emits the same controls however shot up the ship is — asserted over a
    // hundred of them rather than over one, because it is a property of the
    // ENCODER and not of any particular weights. `jameson-defend-g1` was one of
    // these; it is not in the tree any more, and the claim outlives it.
    let moved = 0;
    for (let i = 0; i < 100; i++) {
      const blind = randomBrain(rng, OBS_SIZE);
      if (controlsAcross(blind, 1) !== controlsAcross(blind, 0.05)) moved += 1;
    }
    eq('no 14-input genome can — this is docs/TODO/71 (100 of them)', moved, 0);
    // ...and the SHIPPED defender is no longer one of them, which is the point
    // of the whole change.
    check('the shipped defence policy does fly differently when hurt',
      controlsAcross(jameson, 1) !== controlsAcross(jameson, 0.05));
  }

  // 4. THE WIDENED SEED IS THE SAME PILOT. `--seed-brain jameson-defend-g1` is
  //    where the only defence policy that had ever fought came from, and a
  //    retrain across an observation change has to be able to start from it —
  //    `jameson-defend-g2` did, which is why it is a hill-climb from a known
  //    brain and not a fresh random search. Asserted on the shipped PIRATE now,
  //    because it is the 14-input/11-head policy still in the tree; the
  //    property is the widening's, not any one brain's.
  {
    // A CURRENT-shape solo genome, not the shipped pirate: the shipped file
    // still declares the pre-docs/TODO/91 14 inputs (section 6 asserts
    // exactly that), so widening IT would seed from a brain the new encoder
    // already under-feeds. The property is the widening's, and it is stated
    // for the shapes a retrain would actually cross today: solo 13 to
    // the defence shape.
    const narrow = randomBrain(rng, OBS_SIZE);
    const wide = widenBrain(narrow, DEFEND_OBS_SIZE, DEFEND_OUT_SIZE);
    eq('a widened brain declares the new shape', `${wide.obsSize}/${wide.outSize}`,
      `${DEFEND_OBS_SIZE}/${DEFEND_OUT_SIZE}`);
    eq('...and flies identically at full health',
      controlsAcross(wide, 1), controlsAcross(narrow, 1));
    eq('...and identically when hurt, because the new inputs are zero',
      controlsAcross(wide, 0.05), controlsAcross(narrow, 1));
    check('...and never presses the E.C.M. until something learns to',
      !controlsAcross(wide, 1).split(' ').some((s) => s.endsWith('1')));
  }

  // 5. AN ELEVEN-HEAD BRAIN HAS NO BUTTON. `Control.ecm` is the absence of the
  //    output, not a decision — this is what stops the two pirate policies
  //    being invalidated by a control they can never use.
  {
    const scratch = makeScratch();
    const buf = new Float32Array(MAX_OBS_SIZE);
    const [me, tgt] = geometry(900, 220);
    me.missileInbound = true;
    let pressed = 0;
    for (let i = 0; i < 200; i++) {
      const solo = randomBrain(rng, OBS_SIZE);
      if (act(solo, observeFor(solo, me, tgt, null, buf), scratch).ecm) pressed += 1;
    }
    eq('no 11-head genome can ever press the E.C.M. (200 random ones)', pressed, 0);
  }

  // 6. ...AND THE SHIPPED FILE STILL DECLARES THE SHAPE IT WAS TRAINED AT.
  //    Not "we did not mean to change it": the incumbent predates docs/TODO/91
  //    and says so on disk — 17 inputs, 13 heads — which is exactly what the
  //    head-count dispatch above exists to route honestly until stage 3
  //    promotes its replacement. (The two pirate files this loop used to check
  //    left the bundle with their policies on 2026-08-05.)
  {
    const f = JSON.parse(
      readFileSync(`${BRAINS}jameson-defend-g2.json`, 'utf8')) as BrainFile;
    check('jameson-defend-g2 still declares 17 inputs and 13 heads',
      (f.meta.obsSize ?? 14) === 17 && (f.meta.outSize ?? 11) === 13);
  }
}

// --- and now she can answer one ----------------------------------------------
//
// docs/TODO/72. Missiles became real in training (62) and the target had no
// counter: no E.C.M. fitted, no output that could press one, no observation
// that would say there was anything to press. The world a defence policy was
// fitted in was one where a warhead was undodgeable — a HARDER game than the
// player's, the opposite of 62's failure and just as wrong — and it decided a
// promotion, because every death of every defence policy ever measured had a
// warhead in it: 19 of 19, 4 of 4, 42 of 42.

/**
 * A policy that cannot ask for the button at all: fourteen inputs, eleven
 * heads, the shape both pirate policies are. It is the control for every
 * assertion below — fitting an E.C.M. to a ship whose pilot has no output for
 * it must change nothing, which is what makes the E.C.M. an ACTION rather than
 * a free 250 pool points (docs/TODO/72).
 */
const noButton = randomBrain(makeRng(0xecab), OBS_SIZE);

console.log('\nmissiles: the target answers one');
{
  // THE SHIPPED DEFENDER ITSELF, which is the honest test now that it has a
  // button and has learned to use it. The two runs below differ in the fit-out
  // and in nothing else.
  const presser = jameson;

  // One pirate, one warhead, on a held-out defence seed — re-searched
  // 2026-08-05 when the threat lock and the 10Hz trader cadence changed how
  // the shipped policy flies the fight: the property needs a seed where the
  // two runs stay identical outside the warhead itself.
  const SEED = 8_738_342;
  const run = (brain: typeof presser, ecm: boolean): EpisodeReport => {
    const { count, hull, laser, energyUnit } = defenceFight(SEED);
    const ep = new Episode({
      seed: SEED,
      pirates: Array.from({ length: count }, () => ({ kind: 'scripted' as const })),
      trader: { kind: 'policy', brain },
      traderArmed: true, traderClass: hull, traderLaser: laser,
      targetEnergyUnit: energyUnit, targetEcm: ecm,
    });
    while (!ep.done) ep.step(FIXED_DT);
    return ep.report();
  };
  const without = run(presser, false);
  const withEcm = run(presser, true);

  eq('the seed puts exactly one warhead in the air',
    without.pirates.reduce((s, p) => s + p.missilesFired, 0), 1);
  eq('...and the same one either way',
    withEcm.pirates.reduce((s, p) => s + p.missilesFired, 0), 1);
  // A warhead is `IMPACT.warhead` in her own pool points, and the E.C.M. is the
  // only thing in the game that stops one.
  eq('a target with an E.C.M. takes a warhead\'s worth less on the same seed',
    without.target.damageTaken - withEcm.target.damageTaken,
    playerImpactDamage(IMPACT.warhead));
  check('...and one without it does not — the equipment is what differs',
    without.setup.target.ecm === false && withEcm.setup.target.ecm === true);
  // The press is not free: a quarter of the bank, spent by `fireEcm` and by
  // nothing else, which is why the head is an ACTION and not a reflex. On the
  // rule rather than on the end-of-episode pools: the bank recharges, and by
  // the final frame it has grown the burst back.
  {
    const sky = new Ordnance({ attach: () => {}, detach: () => {}, npcs: [] });
    sky.launchHostile(new THREE.Vector3(0, 0, 900));
    const sys = freshSystems();
    eq('an unfitted ship cannot press it',
      fireEcm({ equipment: { ecm: false } }, sys, sky).reply, 'noEcm');
    eq('...and pays nothing for asking', sys.energy, MAX_ENERGY);
    check('...and the warhead is still in the sky', sky.missileInbound);
    eq('a fitted one presses it',
      fireEcm({ equipment: { ecm: true } }, sys, sky).reply, 'ecmFired');
    eq('...for a quarter of the bank', MAX_ENERGY - sys.energy, ECM_ENERGY_COST);
    check('...and the sky is clear', !sky.missileInbound);
  }
  // A co-pilot never wastes one on an empty sky — the gate `CombatComputer`
  // and `Episode` both apply, so the presses per warhead match whatever the
  // two worlds' decision rates are.
  check('the autopilot gate needs a warhead to answer',
    autopilotEcm(true, true) && !autopilotEcm(true, false) && !autopilotEcm(false, true));
  // The fit-out is IN THE RECORD, so a schema-3 measurement and a schema-4 one
  // cannot be averaged by accident.
  eq('the episode record moved with the world', withEcm.schema, EPISODE_SCHEMA);

  // ...and an 11-head policy is unaffected by any of it: no button, so fitting
  // one changes nothing at all.
  const blind = (ecm: boolean): string =>
    JSON.stringify({ ...run(noButton, ecm), setup: null });
  eq('a policy with no E.C.M. head flies the same fight fitted or not',
    blind(true), blind(false));
}

// --- ...and the co-pilot presses it in the GAME ------------------------------
//
// The combat computer is the same policy flying the commander's own ship, so
// the button has to reach it: `Autopilot` reports the press and `game.ts`
// applies it through the same `fireEcm` the player's own key does.

console.log('\ncombat computer: the E.C.M.');
{
  seedWorld(99);
  const state = freshState(newCommander());
  state.world.build(state.systems[state.commander.systemIndex]);
  state.commander.equipment.combatComputer = true;
  state.player.position.copy(state.world.station.position);
  const auto = new Autopilot(state, new CombatComputer());
  state.world.spawn('pirate',
    state.player.position.clone().add(new THREE.Vector3(0, 0, -1200)), 1);
  auto.toggleCombat();

  // Two rules make a co-pilot with a button safe: a policy with no E.C.M. head
  // can never ask for one, and a policy that always asks only gets it when
  // something is actually coming.
  const warheadAt = new THREE.Vector3(0, 0, 900);
  check('a policy with no E.C.M. head never reaches for one',
    !auto.combatDemand(1 / 60, false, noButton, warheadAt).ecm);
  state.session.ccEngaged = true;
  // The shipped defender WILL press — it was trained to — but never on an empty
  // sky, because `autopilotEcm` gates it on there being a warhead to answer.
  check('...and the shipped one presses nothing on an empty sky',
    !auto.combatDemand(1 / 60, false, defenceBrain(), null).ecm);
  state.session.ccEngaged = true;
  // 0.2s, so this is a FRESH decision rather than the one cached a frame ago
  check('...but answers a warhead in the air',
    auto.combatDemand(0.2, false, defenceBrain(), warheadAt).ecm);
}

// --- the combat computer's cached decision, including the new button ---------
//
// `AutopilotState.control` is `NpcState.brainControl` on the PLAYER's ship, and
// the same generic serialiser walks it. docs/TODO/72 put a fifth field in it —
// is the co-pilot reaching for the E.C.M. — and a field held between decisions
// is state, so it has to survive a save.

console.log('\ncombat computer state');
{
  const live = freshAutopilot();
  live.pitch = 0.31;
  live.roll = -0.22;
  live.timer = 0.07;
  live.control = { pitch: 1, roll: -1, throttle: 1, fire: true, ecm: true };

  const rec = (x: unknown): Record<string, unknown> => x as Record<string, unknown>;
  const restored = freshAutopilot();
  restoreState(rec(restored), JSON.parse(
    JSON.stringify(serialiseState(rec(live)))) as Record<string, unknown>);
  check('the autopilot\'s ramped rates and clock round-trip',
    restored.pitch === live.pitch && restored.roll === live.roll
    && restored.timer === live.timer);
  check('...and so does the cached decision, E.C.M. press and all',
    JSON.stringify(restored.control) === JSON.stringify(live.control));

  // A career saved before the button existed restores a control without one,
  // and `undefined` reads as "not pressing" — the right answer for a commander
  // whose policy could never press it.
  const older = freshAutopilot();
  restoreState(rec(older), rec({
    pitch: 0.1, roll: 0, timer: 0.05,
    control: { pitch: 0, roll: 1, throttle: 1, fire: false },
  }));
  check('a save from before the E.C.M. head restores as not pressing',
    older.control !== null && !older.control.ecm);
}
