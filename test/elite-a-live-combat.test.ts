// The LIVE player-to-NPC path, against every row the pack supplies.
//
// `test/elite-a-oracle.test.ts` proves the arithmetic. This proves the GAME
// runs it — and it must never become that file a second time, so nothing here
// calls `elite-a/combat-math.ts`. Every number below comes out of the code a
// trigger pull actually goes through:
//
//   gunnery.ts     which mount fires, and what one hit is worth from this hull
//   npc-energy.ts  what that hit costs THIS target — defence, immunity, halving
//   npc.ts         the ship applying it to its own bank, and dying at zero
//   combat.ts      the whole shot, raycast and all
//
// 15,600 rows (15 player hulls x 4 fitted lasers x 260 exact variants) and the
// 570 min/max-hits summaries derived from the same flown counts.
//
// Rows are counted rather than printed, as the oracle's are: 30,000 `ok` lines
// would drown the suite, and a mismatch reports the count and the first row.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { check, eq } from './harness.ts';
import {
  eliteADesign, eliteADesignIds, npcCombatProfile, recommendedNpcProfile,
} from '../src/game/elite-a/catalogue.ts';
import { ELITE_A_PLAYER_HULLS } from '../src/game/elite-a/player-hulls.generated.ts';
import type { EliteALaserType } from '../src/game/elite-a/types.ts';
import {
  COBRA_MK_3_HULL_ID, HARMLESS_OVERLAYS, PLAYER_HULL_IDS,
  npcCombatProfileIdOf, shipDesignIdOf, type PlayerHullId,
} from '../src/game/ship-identity.ts';
import {
  laserForView, playerLaser, playerLaserHit, LASER_PACING,
} from '../src/game/gunnery.ts';
import {
  ENERGY_PER_LEGACY_HULL_POINT, energyAfterDamage, isDestroyed, legacyDamageToEnergy,
  npcEnergyPolicy, playerLaserDamage,
} from '../src/game/npc-energy.ts';
import { NpcShip } from '../src/game/npc.ts';
import { Combat, firePlayerLaser } from '../src/game/combat.ts';
import { CONSTRICTOR_SPEC, SPECS } from '../src/game/ship-specs.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';

interface HitsFixture {
  readonly laserTypes: EliteALaserType[]; readonly variants: string[];
  readonly effectiveDamagePerHit: number[]; readonly hitsToDestroy: (number | null)[];
}
interface RangeFixture {
  readonly laserTypes: EliteALaserType[]; readonly rows: (number | null)[][];
}
const fixture = <T>(name: string): T => JSON.parse(
  readFileSync(new URL(`./fixtures/elite-a/${name}.json`, import.meta.url), 'utf8')) as T;
const hits = fixture<HitsFixture>('hits-to-destroy');
const ranges = fixture<RangeFixture>('hit-ranges');

/** Count failures instead of printing 30,000 lines; keep the first one. */
class Tally {
  count = 0;
  first = '';
  fail(detail: string): void {
    this.count += 1;
    if (this.first === '') this.first = detail;
  }

  report(name: string, expected: number, rows: number): void {
    eq(`${name}: every row visited`, rows, expected);
    check(`${name}: every row reproduced`, this.count === 0,
      `${this.count} row(s) disagree, first: ${this.first}`);
  }
}

/** The commander a `laserForView` call is made of, for one hull and one laser. */
const flying = (shipId: PlayerHullId, laser: 'pulse' | 'beam' | 'military',
  mounts: Record<string, boolean> = {}) => ({
  shipId,
  equipment: {
    laser, rearLaser: false, leftLaser: false, rightLaser: false, ...mounts,
  },
}) as Parameters<typeof laserForView>[0];

/**
 * Fly the fight: hit a bank of `maxEnergy` until the ship is destroyed.
 *
 * Live on both counts — `energyAfterDamage` and `isDestroyed` are what
 * `NpcShip.takeDamage` runs — and it COUNTS rather than dividing, so an
 * agreement with the pack's ceiling division is two independent claims.
 */
function hitsToDestroy(maxEnergy: number, damage: number): number | null {
  if (damage <= 0) return null;
  let energy = maxEnergy;
  let n = 0;
  for (; !isDestroyed(energy); n += 1) energy = energyAfterDamage(energy, damage);
  return n;
}

console.log('\n--- live combat: the player\'s laser against an NPC ---');

// --- the gun: which mount, and what the hull makes of what is in it ----------
{
  const decode = new Tally();
  const view = new Tally();
  let cells = 0;
  for (const [index, hull] of ELITE_A_PLAYER_HULLS.entries()) {
    const shipId = PLAYER_HULL_IDS[index];
    for (const type of hits.laserTypes) {
      cells += 1;
      // the live lookup against the pack's own decoded column
      if (playerLaserHit(shipId, type) !== hull.lasers[type].baseDamagePerHit) {
        decode.fail(`${hull.name}/${type}`);
      }
      if (type === 'mining') continue;   // no live mount — the redesign is deferred
      const front = laserForView(flying(shipId, type), 0);
      const side = laserForView(flying(shipId, type, { rearLaser: true }), 1);
      if (front?.hit !== hull.lasers[type].baseDamagePerHit
        || front.cooldown !== LASER_PACING[type].cooldown
        || front.heat !== LASER_PACING[type].heat
        // every side mount is a PULSE laser whatever is up front — unchanged
        || side?.hit !== hull.lasers.pulse.baseDamagePerHit) {
        view.fail(`${hull.name}/${type}`);
      }
    }
  }
  decode.report('fitted laser hit, live', 60, cells);
  view.report('laserForView agrees with it on every fittable mount', 60, cells);
  eq('the 15 hull ids really are the pack\'s 15', PLAYER_HULL_IDS.length, 15);
}

// --- 15,600 rows, through the live gun and the live target ------------------
{
  const effect = new Tally();
  const count = new Tally();
  /** per (hull, laser, design) hit counts, for the 570 summaries below */
  const flown = new Map<string, (number | null)[]>();
  let cursor = 0;
  for (const [index, hull] of ELITE_A_PLAYER_HULLS.entries()) {
    const shipId = PLAYER_HULL_IDS[index];
    for (const type of hits.laserTypes) {
      const hit = playerLaserHit(shipId, type);
      for (const variantId of hits.variants) {
        const policy = npcEnergyPolicy(npcCombatProfileIdOf(variantId));
        const damage = playerLaserDamage(policy, hit);
        const n = hitsToDestroy(policy.maxEnergy, damage);
        const where = `${hull.name}/${type}/${variantId}`;
        if (damage !== hits.effectiveDamagePerHit[cursor]) {
          effect.fail(`${where} got ${damage}, want ${hits.effectiveDamagePerHit[cursor]}`);
        }
        if (n !== hits.hitsToDestroy[cursor]) {
          count.fail(`${where} got ${n}, want ${hits.hitsToDestroy[cursor]}`);
        }
        const key = `${index}/${type}/${npcCombatProfile(variantId).designId}`;
        (flown.get(key) ?? flown.set(key, []).get(key)!).push(n);
        cursor += 1;
      }
    }
  }
  effect.report('damage per hit, live', 15600, cursor);
  count.report('hits to destroy, flown live', 15600, cursor);

  // --- 570 summaries, derived from those same flown counts ------------------
  const summary = new Tally();
  let row = 0;
  for (let index = 0; index < ELITE_A_PLAYER_HULLS.length; index += 1) {
    for (const designId of eliteADesignIds()) {
      const derived: (number | null)[] = [];
      for (const type of ranges.laserTypes) {
        const all = flown.get(`${index}/${type}/${designId}`)!;
        const lethal = all.filter((n): n is number => n !== null);
        const barren = all.length - lethal.length;
        derived.push(lethal.length === 0 ? null : Math.min(...lethal));
        derived.push(lethal.length === 0 ? null : Math.max(...lethal));
        derived.push(barren);
        derived.push(barren === all.length ? 1 : 0);
      }
      if (derived.join(',') !== ranges.rows[row].join(',')) {
        summary.fail(`${ELITE_A_PLAYER_HULLS[index].name}/${eliteADesign(designId).shipName}`
          + ` got [${derived}], want [${ranges.rows[row]}]`);
      }
      row += 1;
    }
  }
  summary.report('min/max hits per design, live', 570, row);
}

console.log('\nlive combat — the cases the contract names');

// A REAL ship takes the hit: the bank, the destruction, the overkill.
{
  seedWorld(26_260_726);
  const pulse = playerLaser(COBRA_MK_3_HULL_ID, 'pulse');
  const spawn = (role: 'pirate' | 'trader' | 'hermit' | 'generation' | 'asteroid',
    spec = SPECS[role === 'asteroid' ? 'pirate' : role][0]) =>
    new NpcShip(role, new THREE.Vector3(), 0, role === 'asteroid' ? undefined : spec);

  const sidewinder = spawn('pirate', SPECS.pirate[0]);
  const policy = npcEnergyPolicy(sidewinder.profileId);
  eq('a fresh ship starts on the exact released bank',
    `${sidewinder.state.energy}/${sidewinder.maxEnergy}`, `${policy.maxEnergy}/${policy.maxEnergy}`);
  eq('...which for a Sidewinder is 73, and its defence the low three bits of it',
    `${policy.maxEnergy}/${policy.maxEnergy & 7}`, '73/1');
  const expected = playerLaserDamage(policy, pulse.hit);
  sidewinder.takeLaserHit(pulse.hit);
  eq('one pulse hit takes hit-minus-defence, not the hit',
    sidewinder.state.energy, policy.maxEnergy - expected);
  eq('...and that is 8, not 9', expected, 8);
  check('the bank stays a whole number of points',
    Number.isInteger(sidewinder.state.energy));

  // one point of damage, exact-zero destruction, and overkill past it
  const one = spawn('pirate', SPECS.pirate[0]);
  one.state.energy = 1;
  check('a point of energy is alive', !isDestroyed(one.state.energy) && one.state.alive);
  const exact = spawn('pirate', SPECS.pirate[0]);
  exact.state.energy = expected;
  check('a hit that exactly empties the bank destroys',
    exact.takeLaserHit(pulse.hit) && exact.state.energy === 0 && !exact.state.alive);
  const over = spawn('pirate', SPECS.pirate[0]);
  over.state.energy = 1;
  check('...and overkill floors at zero rather than going negative',
    over.takeLaserHit(pulse.hit) && over.state.energy === 0);
  check('...and a destroyed ship is only reported destroyed once',
    over.takeLaserHit(pulse.hit) === false);

  // NO DAMAGE AT ALL: a Dragon's 7 points of defence eat an Adder's 7-point pulse
  const dragon = npcEnergyPolicy(npcCombatProfileIdOf(recommendedNpcProfile(29).variantId));
  eq('a Dragon eats an Adder\'s whole pulse hit',
    playerLaserDamage(dragon, playerLaserHit(PLAYER_HULL_IDS[0], 'pulse')), 0);
  eq('...so it never dies to one', hitsToDestroy(dragon.maxEnergy, 0), null);

  // IMMUNITY, from the profile — no role or hull name anywhere near the gun
  const hermit = spawn('hermit');
  check('the rock hermit is a station: immune, and it says so in its policy',
    hermit.energyPolicy.laserImmune);
  const hermitBefore = hermit.state.energy;
  check('...so a military laser at point blank does nothing to it',
    hermit.takeLaserHit(playerLaserHit(COBRA_MK_3_HULL_ID, 'military')) === false
    && hermit.state.energy === hermitBefore && hermit.state.alive);
  eq('...and the released stations are immune too, through the same field',
    [0, 1].filter((d) => !npcEnergyPolicy(
      npcCombatProfileIdOf(recommendedNpcProfile(d).variantId)).laserImmune).length, 0);

  // THE CONSTRICTOR halves BEFORE defence, and the mission knows nothing of it
  const constrictor = new NpcShip('pirate', new THREE.Vector3(), 0, CONSTRICTOR_SPEC);
  eq('the Constrictor carries the halving as a profile field',
    constrictor.energyPolicy.playerLaserMultiplier, 0.5);
  const anacondaMil = playerLaserHit(PLAYER_HULL_IDS[14], 'military');
  eq('an Anaconda military laser halves to 31 and 3 defence leaves 28',
    playerLaserDamage(constrictor.energyPolicy, anacondaMil), 28);
  check('...which is NOT halving after defence, and the flag is never consulted',
    playerLaserDamage(constrictor.energyPolicy, anacondaMil)
      !== Math.floor((anacondaMil - 3) * 0.5)
    && constrictor.state.isMissionTarget === false);
  eq('a 7-point hit halves to 3, and 3 defence leaves nothing',
    playerLaserDamage(constrictor.energyPolicy, 7), 0);

  // The two Harmless inventions have STATED policy and no source parity claim.
  const gen = npcEnergyPolicy(HARMLESS_OVERLAYS.generationShip.profileId);
  const rock = npcEnergyPolicy(HARMLESS_OVERLAYS.rockHermit.profileId);
  check('the generation ship and the rock hermit carry explicit Harmless policy',
    gen.maxEnergy === 252 && !gen.laserImmune && gen.regenPerSecond === 0
    && rock.maxEnergy === 240 && rock.laserImmune && rock.regenPerSecond === 0);
  check('...and neither appears in the released variant matrix',
    !hits.variants.includes(HARMLESS_OVERLAYS.generationShip.profileId)
    && !hits.variants.includes(HARMLESS_OVERLAYS.rockHermit.profileId));
}

// The whole shot: Combat.fire, through the raycast, onto the real bank.
{
  seedWorld(60_606);
  const state = freshState(newCommander());
  state.world.build(state.systems[state.commander.systemIndex]);
  state.player.position.set(0, 0, 0);
  state.player.quaternion.identity();               // nose along -Z
  const npc = state.world.spawn('pirate', new THREE.Vector3(0, 0, -400), 1);
  npc.object.updateMatrixWorld(true);               // the raycast reads matrixWorld
  const combat = new Combat(state.world);
  const scratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
  };
  const expected = playerLaserDamage(
    npc.energyPolicy, playerLaser(state.commander.shipId, state.commander.equipment.laser).hit);
  const before = npc.state.energy;
  const events = firePlayerLaser(state, combat, scratch);
  check('a real trigger pull really did connect',
    events.some((e) => e.kind === 'fired') && npc.state.energy < before);
  eq('...and took exactly the energy the pure rule says it should',
    before - npc.state.energy, expected);
}

console.log('\nlive combat — regeneration');
{
  const ship = (hz: number) => {
    seedWorld(4242);
    const n = new NpcShip('pirate', new THREE.Vector3(), 0, SPECS.pirate[0]);
    n.state.energy = 20;
    return { n, dt: 1 / hz };
  };
  const run = (hz: number, steps: number) => {
    const { n, dt } = ship(hz);
    for (let i = 0; i < steps; i += 1) n.regenerate(dt);
    return `${n.state.energy}:${n.state.regenCarry}`;
  };
  eq('ten seconds is ten points at 15, 60 and 144 Hz alike',
    [run(15, 150), run(60, 600), run(144, 1440)].join(' '), '30:0 30:0 30:0');
  eq('...and 3 1/3 seconds leaves an identical sub-second remainder at each',
    [run(15, 50), run(60, 200), run(144, 480)].join(' '), '23:1200 23:1200 23:1200');

  // No catch-up. A backgrounded tab hands back one enormous dt, or the clock
  // goes backwards; neither may become a burst of free energy.
  const paused = ship(60);
  paused.n.regenerate(-30);
  eq('a rewound clock gives nothing', paused.n.state.energy, 20);
  // A backgrounded tab hands the loop one enormous frame. It never reaches a
  // ship, because game.ts clamps the accumulator and caps the catch-up steps —
  // asserted here against the source, since a regeneration rule that IS
  // per-frame can only be as safe as the loop that feeds it.
  const loop = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  check('the frame loop clamps a long frame and gives up catching up',
    /accumulator \+= Math\.min\(\(now - last\) \/ 1000, MAX_FRAME_TIME\)/.test(loop)
    && /steps < MAX_STEPS_PER_FRAME/.test(loop)
    && /if \(steps === MAX_STEPS_PER_FRAME\) accumulator = 0/.test(loop));
  const twoSteps = ship(60);
  twoSteps.n.regenerate(1 / 60);
  twoSteps.n.regenerate(1 / 60);
  const oneLong = ship(60);
  oneLong.n.regenerate(2 / 60);
  check('...and two frames and one of twice the length are the same energy either way',
    twoSteps.n.state.energy === oneLong.n.state.energy
    && twoSteps.n.state.regenCarry === oneLong.n.state.regenCarry);

  const full = ship(60);
  full.n.state.energy = full.n.maxEnergy;
  for (let i = 0; i < 600; i += 1) full.n.regenerate(1 / 60);
  check('a full ship banks nothing, so damage does not come straight back',
    full.n.state.energy === full.n.maxEnergy && full.n.state.regenCarry === 0);

  const dead = ship(60);
  dead.n.state.energy = 0;
  for (let i = 0; i < 600; i += 1) dead.n.regenerate(1 / 60);
  eq('a destroyed ship does not come back', dead.n.state.energy, 0);

  // WHO recovers: the contract's "stations, missiles, cargo and rocks" do not.
  seedWorld(9);
  const still = [
    new NpcShip('asteroid', new THREE.Vector3(), 3),
    new NpcShip('hermit', new THREE.Vector3(), 0, SPECS.hermit[0]),
    new NpcShip('generation', new THREE.Vector3(), 0, SPECS.generation[0]),
  ];
  for (const n of still) {
    n.state.energy = 5;
    for (let i = 0; i < 600; i += 1) n.regenerate(1 / 60);
  }
  check('rocks, the hermit station and the derelict recover nothing',
    still.every((n) => n.state.energy === 5 && n.energyPolicy.regenPerSecond === 0));
  const alive = new NpcShip('pirate', new THREE.Vector3(), 0, SPECS.pirate[0]);
  eq('...where an ordinary AI ship recovers one point a second',
    alive.energyPolicy.regenPerSecond, 1);
}

console.log('\nlive combat — the TODO 28 bridge is the only crossing');
{
  eq('one legacy hull point is one released Cobra Mk III',
    ENERGY_PER_LEGACY_HULL_POINT, recommendedNpcProfile(10).maxEnergy);
  eq('...and that design really is the Cobra Mk III the roster flies',
    `${recommendedNpcProfile(10).shipName}/${shipDesignIdOf(10)}`,
    `Cobra Mk III/${SPECS.trader[0].designId}`);
  eq('a legacy amount converts to whole points', legacyDamageToEnergy(0.45), 44);
  eq('...and something that mattered never becomes nothing',
    legacyDamageToEnergy(0.001), 1);
  eq('...where nothing stays nothing', legacyDamageToEnergy(0), 0);

  // Every `takeDamage` call on an NPC passes ENERGY POINTS, and the only way a
  // normalized amount becomes points is the named bridge. A literal or an
  // old-scale constant going straight into the pool is the failure this
  // catches, and it is the one that would silently re-merge the two unit
  // systems. `this.trader` is excluded because an episode's target is a
  // `TargetShip` standing in for the commander, whose hull is normalized until
  // TODO 27 — the exclusion is by RECEIVER, so it cannot hide an NPC.
  const ALLOWED = /^(legacyDamageToEnergy\(|playerLaserDamage\(|ramEnergy\b|points\b|damage\b)/;
  const files = ['game/world-step.ts', 'game/game.ts', 'game/combat.ts', 'game/npc.ts',
    'ai-training/scenario.ts'];
  const bad: string[] = [];
  let calls = 0;
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/([\w.]+)\.takeDamage\(\s*([^,)]+)/g)) {
      if (/\btrader\b/.test(m[1])) continue;
      calls += 1;
      if (!ALLOWED.test(m[2].trim())) bad.push(`${f}: ${m[1]}.takeDamage(${m[2].trim()}`);
    }
  }
  check(`every NPC takeDamage caller passes energy points (${calls} calls)`,
    bad.length === 0, bad.join(' · '));
  check('...and the check is not vacuous', calls >= 8);
}
