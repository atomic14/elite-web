// One resolver: the same shot, resolved by the game and by the trainer.
//
// docs/TODO/64. Invariant 15 splits deciding from resolving and there are two
// Games — `world-step.ts` for the sky, `ai-training/scenario.ts` for a training
// episode — so the DECISION half had one home each and the RESOLUTION half had
// two, which drifted four times without anything reporting it: the weapon the
// ship chose, the rack it spent, the missile decision itself, and the target's
// recharge. `game/fire-resolution.ts` is the one home now, and this is what
// stops a fifth.
//
// THE SHAPE OF THE GATE IS THE POINT, and the item is explicit about it: not
// "the resolver works", but the SAME `FireEvent` and the SAME seed through BOTH
// callers, asserting identical damage, identical rack and identical pools. A
// test that drove the shared function twice would agree with itself and would
// have passed on the code as it was.
//
// So the two paths really are the two paths. The game side goes through
// `WorldStep`'s own private `resolveNpcFire` into a `StepHost` that spends the
// hit through `damagePlayer` — the same call `game.ts` makes — and the trainer
// side through `Episode`'s own private `resolveNpcShot` into
// `TargetShip.takeDamage`. Neither is re-implemented here.
//
// The SHOOTER is shared by construction: two episodes built from one seed hold
// the same ships, drawn in the same order out of the same stream, so "the same
// weapon byte, the same hull, the same rack" is a property of the fixture rather
// than something arranged by hand.
//
// Vacuity: deleting a branch of the resolver must fail this file. The probes and
// what each one broke are recorded in docs/TODO/64.

import * as THREE from 'three';

import { Episode } from '../src/ai-training/scenario.ts';
import { Ordnance } from '../src/game/ordnance.ts';
import { WorldStep, type StepEvent, type StepHost } from '../src/game/world-step.ts';
import { resolveNpcFire, type FireWorld } from '../src/game/fire-resolution.ts';
import { hitFromAhead } from '../src/game/shield-face.ts';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import {
  Combat, damagePlayer, type CombatEvent, type CombatScratch,
} from '../src/game/combat.ts';
import { MAX_ENERGY, MAX_SHIELD, applyDamage, freshSystems } from '../src/game/systems.ts';
import { playerPoolPoints } from '../src/game/damage-units.ts';
import { npcHitChance, npcLaserDamageToPlayer, NPC_VS_NPC_HIT } from '../src/game/gunnery.ts';
import { COBRA_MK_3_HULL_ID } from '../src/game/ship-identity.ts';
import type { FireEvent, NpcShip } from '../src/game/npc.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

/** Reaching a private method: neither resolver is public API, and neither should be. */
interface StepResolver {
  resolveNpcFire(npc: NpcShip, event: FireEvent, out: StepEvent[]): void;
}
interface EpisodeResolver {
  resolveNpcShot(p: unknown, shot: FireEvent): unknown;
}

/** One shot, stated once and fired in both worlds. */
interface Fixture {
  name: string;
  /** where the shooter is, with the target at the origin looking down −Z */
  at: THREE.Vector3;
  weapon: 'laser' | 'missile';
  /** at a wingman instead of the target — the crossfire branch */
  atMate?: boolean;
  /** the target's three pools when the shot arrives */
  pools?: [number, number, number];
  /** the dice */
  seed: number;
}

/**
 * Two episodes from one seed hold identical ships, in every respect a resolved
 * shot can read: hull, weapon byte, rack, E.C.M., bank, position.
 */
const EPISODE_SEED = 64_064_066;   // both pirates carry a round, so a rack can empty
const episode = (): Episode => new Episode({
  seed: EPISODE_SEED,
  pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
  trader: { kind: 'scripted' },
  traderClass: 'playerCobra',
});

/** The bank a wingman starts with, for reading the crossfire cases. */
const MATE_BANK = episode().pirates[1].npc.state.energy;
/** ...and the rack the shooter warped in with, for reading the missile case. */
const RACK = episode().pirates[0].npc.state.missiles;

function fireEvent(f: Fixture, mate: NpcShip): FireEvent {
  if (f.atMate) return { at: mate, weapon: 'laser' };
  return { at: 'player', weapon: f.weapon };
}

/** Where the ships stand — the same arrangement in both worlds. */
function place(
  shooter: NpcShip, mate: NpcShip, f: Fixture,
  targetPos: THREE.Vector3, targetQuat: THREE.Quaternion,
): void {
  targetPos.set(0, 0, 0);
  targetQuat.identity();
  shooter.object.position.copy(f.at);
  shooter.faceToward(targetPos);
  mate.object.position.set(400, 0, -260);
  mate.faceToward(targetPos);
}

/** What both worlds must agree on, to the byte: the damage, the rack, the pools. */
function record(
  pools: { foreShield: number; aftShield: number; energy: number },
  shooter: NpcShip, mate: NpcShip,
  sky: readonly { target: NpcShip | null; life: number; object: THREE.Object3D }[],
): string {
  return JSON.stringify({
    pools: [pools.foreShield, pools.aftShield, pools.energy],
    rack: shooter.state.missiles,
    reload: shooter.state.missileReload,
    mate: { bank: mate.state.energy, alive: mate.state.alive, hurt: mate.state.underFire },
    sky: sky.map((m) => ({
      hostile: m.target === null,
      life: +m.life.toFixed(6),
      at: m.object.position.toArray().map((v) => +v.toFixed(6)),
    })),
  });
}

/** The game's path: WorldStep's own resolver, into a host that really spends it. */
function viaGame(f: Fixture): string {
  const ep = episode();               // borrowed for its ships and nothing else
  const shooter = ep.pirates[0].npc;
  const mate = ep.pirates[1].npc;

  const state = freshState(newCommander());
  const combat = new Combat(state.world);
  const ordnance = new Ordnance(state.world);
  const scratch: CombatScratch = {
    a: new THREE.Vector3(), b: new THREE.Vector3(),
    q: new THREE.Quaternion(), ray: new THREE.Raycaster(),
  };
  const events: CombatEvent[] = [];
  const host: StepHost = {
    inFlight: () => true,
    applyPlayerDamage: (damage, from) => {
      events.push(...damagePlayer(state, combat, damage, from, scratch));
    },
    destroyNpc: () => {},
    wreckNpc: (npc) => { npc.state.alive = false; },
    fireLaser: () => {},
    raiseLegal: () => {},
    die: () => {},
    dock: () => {},
    completeHyperspace: () => {},
    completeRescue: () => {},
    openHermitTrade: () => {},
    autoSave: () => {},
  };
  const step = new WorldStep(state, ordnance, host);

  place(shooter, mate, f, state.player.position, state.player.quaternion);
  if (f.pools) [state.sys.foreShield, state.sys.aftShield, state.sys.energy] = f.pools;

  seedWorld(f.seed);
  (step as unknown as StepResolver).resolveNpcFire(shooter, fireEvent(f, mate), []);
  return record(state.sys, shooter, mate, ordnance.missiles);
}

/** The trainer's path: the Episode's own resolver, into its own target. */
function viaTrainer(f: Fixture): string {
  const ep = episode();
  const shooter = ep.pirates[0].npc;
  const mate = ep.pirates[1].npc;
  place(shooter, mate, f, ep.trader.pos, ep.trader.quat);
  if (f.pools) {
    [ep.trader.sys.foreShield, ep.trader.sys.aftShield, ep.trader.sys.energy] = f.pools;
  }

  seedWorld(f.seed);
  (ep as unknown as EpisodeResolver).resolveNpcShot(ep.pirates[0], fireEvent(f, mate));
  return record(ep.trader.sys, shooter, mate, ep.missiles);
}

// --- the cases ---------------------------------------------------------------
//
// Every branch of the resolver, and both sides of every roll inside it. The
// hit/miss pairs matter as much as the branches: a parity check that only ever
// saw bolts land would pass with the dice deleted.

const CASES: Fixture[] = [
  { name: 'a bolt from dead ahead, close in',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', seed: 1 },
  { name: '...and the same shot on a seed that goes wide',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', seed: 4 },
  { name: 'a bolt from astern, spending the other face',
    at: new THREE.Vector3(0, 0, 380), weapon: 'laser', seed: 1 },
  { name: 'a bolt from off the quarter',
    at: new THREE.Vector3(700, -260, 900), weapon: 'laser', seed: 3 },
  { name: 'a bolt from the far end of the hit curve',
    at: new THREE.Vector3(0, 0, -3400), weapon: 'laser', seed: 11 },
  { name: 'a bolt onto bare hull, with both faces already gone',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', seed: 1, pools: [0, 0, MAX_ENERGY] },
  { name: '...and one onto the last of the bank',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', seed: 1, pools: [0, 0, 3] },
  { name: 'a warhead off the rail',
    at: new THREE.Vector3(0, 0, -1800), weapon: 'missile', seed: 5 },
  { name: 'crossfire: a wingman in the way',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', atMate: true, seed: 7 },
  { name: '...on a seed where the crossfire goes wide',
    at: new THREE.Vector3(0, 0, -420), weapon: 'laser', atMate: true, seed: 2 },
];

console.log('\none resolver: the same shot through both callers');
{
  // The fixture has to be a real fight before it is a parity check. Two records
  // that agree because nothing happened in either is exactly the failure this
  // file exists to catch, so the branches are counted as they run.
  let hits = 0;
  let misses = 0;
  let launched = 0;
  let crossfireHits = 0;
  let crossfireMisses = 0;
  let bankReached = 0;
  let spentRounds = 0;

  for (const f of CASES) {
    const game = viaGame(f);
    eq(f.name, viaTrainer(f), game);

    const r = JSON.parse(game) as {
      pools: number[]; rack: number; mate: { bank: number };
      sky: unknown[];
    };
    const full = f.pools ?? [MAX_SHIELD, MAX_SHIELD, MAX_ENERGY];
    const spent = full.reduce((a, b) => a + b, 0)
      - r.pools.reduce((a, b) => a + b, 0);
    if (f.weapon === 'missile') {
      launched += r.sky.length;
      spentRounds += RACK - r.rack;
    }
    else if (f.atMate) {
      if (r.mate.bank < MATE_BANK) crossfireHits += 1; else crossfireMisses += 1;
    } else if (spent > 0) {
      hits += 1;
      if (full[0] === 0 && full[1] === 0) bankReached += 1;
    } else misses += 1;
  }

  check(`...and the cases really fought: ${hits} bolts landed, ${misses} went wide`,
    hits >= 3 && misses >= 1);
  check(`...${bankReached} of them onto bare hull, where the equipment die is drawn`,
    bankReached === 2);
  check(`...a warhead left the rail (${launched} in the sky)`, launched === 1);
  check(`...and the LAUNCHING ship paid for it (${RACK} carried, ${spentRounds} spent)`,
    RACK > 0 && spentRounds === 1);
  check(`...and crossfire both connected and went wide (${crossfireHits}/${crossfireMisses})`,
    crossfireHits === 1 && crossfireMisses === 1);
  check('the two targets are the same hull, or none of the above means anything',
    newCommander().shipId === COBRA_MK_3_HULL_ID
    && episode().setup().target.shipId === COBRA_MK_3_HULL_ID);
}

// --- and the numbers are the rules', not a plausible copy --------------------
//
// The equivalence above says the two paths agree. These say WHAT they agree on,
// against the rule modules directly — so a shared resolver that had quietly
// invented its own damage figure, or read a copy of the hit chance, would still
// be caught.

console.log('\none resolver: and the numbers are the rules\'');
{
  const ep = episode();
  const shooter = ep.pirates[0].npc;
  const victim = ep.pirates[1].npc;
  const range = 420;
  shooter.object.position.set(0, 0, -range);

  const landed = freshSystems();
  const world: FireWorld = {
    target: {
      hullId: COBRA_MK_3_HULL_ID,
      pos: new THREE.Vector3(),
      damage: (damage, from) => {
        applyDamage(landed, damage,
          hitFromAhead(from, new THREE.Vector3(), new THREE.Quaternion(),
            new THREE.Vector3(), new THREE.Quaternion()), () => 1);
      },
    },
    ordnance: new Ordnance({ attach: () => {}, detach: () => {}, npcs: [] }),
    wreck: () => {},
  };

  seedWorld(1);   // a seed whose roll is inside the curve at this range
  const shot = resolveNpcFire(shooter, { at: 'player', weapon: 'laser' }, world);
  check(`the range is measured at the resolver (${range} units,`
    + ` p=${npcHitChance(range).toFixed(3)})`,
  shot.weapon === 'laser' && shot.at === 'target' && shot.range === range && shot.hit);

  const expected = freshSystems();
  applyDamage(expected, npcLaserDamageToPlayer(shooter.weaponByte, COBRA_MK_3_HULL_ID),
    true, () => 1);
  eq('...and a hit spends exactly npcLaserDamageToPlayer, through applyDamage',
    JSON.stringify(landed), JSON.stringify(expected));

  // The crossfire chance is a flat one, read from gunnery.ts: 2,000 rolls
  // against the stated probability, which a copy of the number beside it would
  // pass and any other number would not.
  seedWorld(4242);
  let connected = 0;
  const ROLLS = 2000;
  for (let i = 0; i < ROLLS; i++) {
    victim.state.energy = MATE_BANK;
    victim.state.alive = true;
    const crossfire = resolveNpcFire(shooter, { at: victim, weapon: 'laser' }, world);
    if (crossfire.weapon === 'laser' && crossfire.hit) connected += 1;
  }
  const rate = connected / ROLLS;
  check(`crossfire lands at ${NPC_VS_NPC_HIT} (${rate.toFixed(3)} over ${ROLLS} rolls)`,
    Math.abs(rate - NPC_VS_NPC_HIT) < 0.04);
}

// --- the shield face is one rule ---------------------------------------------
//
// It was a quaternion inverse in `Combat.hitPlayer` and a dot product in the
// episode: the same rule written twice, agreeing, which is the shape every
// divergence in docs/TODO/64 started out as. One home now — `shield-face.ts` —
// and this is the behaviour that says so.

console.log('\none resolver: which face takes it');
{
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const level = new THREE.Quaternion();
  check('a shot from ahead is a fore-shield shot',
    hitFromAhead(new THREE.Vector3(0, 0, -900), pos, level, v, q));
  check('...and one from astern is not',
    !hitFromAhead(new THREE.Vector3(0, 0, 900), pos, level, v, q));
  // Turned ninety degrees, where a world-axis answer would be wrong: the nose is
  // along +X, so a shot from +X is now the one from ahead and one from −X is the
  // one up the tailpipe. (Straight down −Z is now exactly abeam, and which face
  // takes a shot on the knife-edge is a question with no answer worth asserting.)
  const turned = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  check('...and it is the SHIP\'s frame, not the world\'s',
    hitFromAhead(new THREE.Vector3(900, 0, 0), pos, turned, v, q)
    && !hitFromAhead(new THREE.Vector3(-900, 0, 0), pos, turned, v, q));

  // And the episode's target really asks it. A hit from astern empties the aft
  // face and leaves the fore one whole — the assertion that fails if either side
  // goes back to working it out for itself.
  const behind = new Episode({
    seed: 64_101, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    traderClass: 'playerCobra',
  });
  behind.trader.ship.position.set(0, 0, 0);
  behind.trader.ship.quaternion.identity();
  behind.trader.takeDamage(playerPoolPoints(120),
    hitFromAhead(new THREE.Vector3(0, 0, 700), behind.trader.pos, behind.trader.quat,
      new THREE.Vector3(), new THREE.Quaternion()));
  check(`a hit from astern spends the aft face (fore ${behind.trader.sys.foreShield},`
    + ` aft ${behind.trader.sys.aftShield})`,
  behind.trader.sys.foreShield === MAX_SHIELD
    && behind.trader.sys.aftShield === MAX_SHIELD - 120);
}
