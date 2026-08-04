// Missiles, in the game and in the trainer — and that they are the same missile.
//
// docs/TODO/62. A pirate has always carried a rack and `NpcShip.chooseWeapon`
// has always known when to spend it, but the call was reachable only from
// `NpcShip.update()`, which a training episode never makes: measured, 200 armed
// and hurt pirates driven the way an episode drives them asked to fire 1,374
// times and asked for a missile **zero** times. On top of that the trainer's
// resolver never read `shot.weapon` (so a missile would have landed instantly,
// for laser damage) and never spent the round (so the rack was infinite).
//
// Three defects, one cause: invariant 15 splits deciding from resolving, and
// there are two resolvers — `world-step.ts` and `ai-training/scenario.ts`. This
// file holds the part of that seam that IS shared now, and says what is not.
// The general version is docs/TODO/64.

import * as THREE from 'three';

import { Episode } from '../src/ai-training/scenario.ts';
import { FIXED_DT } from '../src/constants/world-clock.ts';
import { Game } from '../src/game/game.ts';
import { handle } from '../src/game/console.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { NpcShip } from '../src/game/npc.ts';
import { SPECS } from '../src/game/ship-specs.ts';
import { World } from '../src/game/world.ts';
import {
  Ordnance, launchNpcMissile, type OrdnanceWorld,
} from '../src/game/ordnance.ts';
import { MISSILE_RELOAD } from '../src/constants/ordnance.ts';
import { playerImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { MAX_ENERGY, MAX_SHIELD } from '../src/constants/pools.ts';
import { applyDamage, freshSystems } from '../src/game/systems.ts';
import { seedWorld } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';

// --- one launch, whoever is resolving ---------------------------------------
//
// `launchNpcMissile` is the shared half: spend the round, put the warhead in the
// sky. Both resolvers call it, and this drives it over the game's `World` and
// over the shape a training episode supplies — a fleet, and an `attach` with no
// scene behind it — asserting the two are indistinguishable.

console.log('\nmissiles: one launch rule');
{
  const armed = (world: OrdnanceWorld): { npc: NpcShip; ord: Ordnance } => {
    seedWorld(90_210);
    const npc = new NpcShip('pirate', new THREE.Vector3(0, 0, -900), 3);
    npc.state.missiles = 2;
    return { npc, ord: new Ordnance(world) };
  };
  const fleet: NpcShip[] = [];
  const inert: OrdnanceWorld = { attach: () => {}, detach: () => {}, npcs: fleet };

  const game = armed(new World());
  const trainer = armed(inert);
  const outcome = [game, trainer].map(({ npc, ord }) => {
    const reply = launchNpcMissile(npc, ord);
    const m = ord.missiles[0];
    return JSON.stringify({
      reply: reply.reply,
      rack: npc.state.missiles,
      inSky: ord.missiles.length,
      hostile: m.target === null,
      life: m.life,
      at: [m.object.position.x, m.object.position.y, m.object.position.z],
      inbound: ord.missileInbound,
    });
  });
  eq('the game and the trainer resolve one missile identically', outcome[1], outcome[0]);
  check('...and it is the LAUNCHING ship that pays for it',
    game.npc.state.missiles === 1 && trainer.npc.state.missiles === 1);
  check('...and the warhead left the nose, not the hull centre',
    game.ord.missiles[0].object.position.length() > 0);
  // A sky with no scene is inert, not broken — engine/inert-dom.ts's bargain.
  // If attaching were load-bearing this is where it would show, because the
  // missile above has to fly from a position nothing added it to.
  check('...and a sky with nowhere to draw still flies one',
    trainer.ord.missiles.length === 1 && trainer.ord.missileInbound);

  // ...and it FLIES the same, not merely spawns the same. Both are homed on the
  // same point for eight seconds and asked what happened: same track, same fuse,
  // same event. This is what says the trainer got `ordnance.ts` and not a copy
  // of the parts of it that were easy to reach.
  const flown = [game, trainer].map(({ ord }) => {
    const at = new THREE.Vector3(0, 0, -900 + 2400);
    const track: string[] = [];
    for (let f = 0; f < 60 * 8; f++) {
      for (const e of ord.step(FIXED_DT, at)) track.push(e.kind);
      const m = ord.missiles[0];
      if (m) track.push(m.object.position.toArray().map((v) => v.toFixed(4)).join(','));
    }
    return track.join('|');
  });
  eq('...and the warhead flies the same track in both', flown[1], flown[0]);
  check('...all the way to the impact it reports',
    flown[0].includes('hitPlayer') && game.ord.missiles.length === 0);
}

// --- what a warhead costs the commander --------------------------------------
//
// The other half of the same shot, and the half that still has two homes: the
// game bills it through `Combat.hitPlayer` and the episode through
// `TargetShip.takeDamage`. Both spend `IMPACT.warhead` in her own pool points
// on the face it came in at, and this asserts it as an equivalence rather than
// as a number — a second warhead constant that merely looked plausible would
// pass a check against a literal.

console.log('\nmissiles: what a warhead costs her');
{
  const warhead = playerImpactDamage(IMPACT.warhead);
  const reference = (fromFront: boolean) => {
    const sys = freshSystems();
    applyDamage(sys, warhead, fromFront, () => 1);
    return JSON.stringify(sys);
  };
  const ep = new Episode({
    seed: 62_062, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    traderClass: 'playerCobra',
  });
  ep.trader.takeDamage(warhead, true);
  eq('a warhead on the nose is the game\'s own applyDamage',
    JSON.stringify(ep.trader.sys), reference(true));
  // 250 of a 255-point face: it takes the shield and stops a hair short of the
  // bank, which is `IMPACT.warhead`'s stated reason for being 250 and not 255.
  check(`...and it strips a ${MAX_SHIELD}-point face and leaves the bank`,
    ep.trader.sys.foreShield === MAX_SHIELD - IMPACT.warhead.commander
    && ep.trader.sys.energy === MAX_ENERGY);

  const behind = new Episode({
    seed: 62_063, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    traderClass: 'playerCobra',
  });
  behind.trader.takeDamage(warhead, false);
  eq('...and one up the tailpipe spends the other face',
    JSON.stringify(behind.trader.sys), reference(false));
}

// --- and it happens inside a real episode ------------------------------------
//
// The acceptance test docs/TODO/62 sets, and the one that would have failed
// before it: a pirate DECIDES to launch, the warhead flies, it can kill her, and
// the rail runs dry.
//
// THE TARGET IS THE KNIFE-FIGHTER, and that is what makes this a test rather
// than a hope. Both of `npcMissileEmergency`'s reasons need a fight to have
// happened — a hull under 0.4, or Chris's "tougher than you thought", which is
// `passesMade` and only ticks when a ship gets inside `BREAK_OFF_RANGE` and
// comes out the other side. Against a target that RUNS (`scripted`, `runner`) a
// pirate never closes to 220 units, makes no passes, takes no fire, and
// launches nothing: measured, 0 warheads over the same 60 seeds. `holding` is
// how Chris actually flies — turn hard, stop dead, shoot — so the pirates make
// passes and get hurt doing it.
//
// It also has to be armed and shooting a real laser. An unarmed target is never
// the thing that gets tough, and 60 of these fights end with 26 rounds still on
// the rail instead of 15.

console.log('\nmissiles: inside a training episode');
{
  let launched = 0;
  let carried = 0;
  let left = 0;
  let overspent = 0;
  let unbalanced = 0;
  let destroyed = 0;
  const SEEDS = 60;
  for (let e = 0; e < SEEDS; e++) {
    const ep = new Episode({
      seed: 4_400_017 + e * 7919,
      pirates: [{ kind: 'scripted' }, { kind: 'scripted' }, { kind: 'scripted' }],
      trader: { kind: 'holding' }, traderClass: 'playerCobraSlow',
      traderArmed: true, traderLaser: 'military',
    });
    const setup = ep.setup();
    while (!ep.done) ep.step(FIXED_DT);
    const r = ep.report();
    if (!r.target.alive) destroyed += 1;
    for (let i = 0; i < r.pirates.length; i++) {
      const rack = setup.pirates[i].missiles;
      launched += r.pirates[i].missilesFired;
      carried += rack;
      left += r.pirates[i].missilesLeft;
      if (r.pirates[i].missilesFired > rack) overspent += 1;
      if (r.pirates[i].missilesFired + r.pirates[i].missilesLeft !== rack) unbalanced += 1;
    }
  }
  check(`a pirate in a training episode launches (${launched} warheads over ${SEEDS} fights)`,
    launched > 0);
  check(`...and it can kill her (${destroyed}/${SEEDS} episodes ended destroyed)`,
    destroyed > 0);
  check(`...and the rail runs dry: nothing fired more than it carried`
    + ` (${launched} of ${carried}, ${left} still racked)`,
  overspent === 0 && left > 0);
  check('...and every round is accounted for: fired + left is what it warped in with',
    unbalanced === 0);
  check(`...gated by the ${MISSILE_RELOAD}s reload, so no ship empties a rack in a frame`,
    launched < carried);
}

// --- and the same thing happens in the GAME ----------------------------------
//
// Everything above this line is the trainer. Nothing in `npm test` asserted that
// a missile ever leaves an NPC in the actual game — the path existed, `npm run
// campaign` abstracts flight away entirely, and `test/world-step.test.ts` drives
// the step without ever getting a ship into `npcMissileEmergency`. So a refactor
// of `resolveNpcFire` could have broken the live game and been caught by nothing.
//
// This flies the real `Game` on `headlessShell()`, as test/game.test.ts does. The
// gang is placed by hand rather than rolled, because the fixture is about the
// missile path and not about who turned up: a Python has two on the rail, and
// hurting them below `MISSILE_LAST_STAND_HULL` makes `npcMissileEmergency`'s
// first reason true from the first frame.
//
// It is also the shape that proved this change byte-identical against 38914c7 —
// a 5 MB per-frame trace, same sha256 on both checkouts. That comparison needs
// two working trees and cannot live here; what lives here is the half that can,
// which is that the path works and that a seed replays.

console.log('\nmissiles: in the real game, headless');
{
  /** A compact per-frame trace of one seeded fight, plus what it exercised. */
  const fight = (seed: number, count: number, frames: number) => withoutSaving(() => {
    seedWorld(seed);
    const g = new Game(() => headlessShell());
    g.launch();
    const missilesInFlight = (handle('__game') as { missiles: readonly unknown[] }).missiles;
    const world = g.state.world;
    world.clearNpcs();

    const python = SPECS.pirate.find((s) => s.missiles === 2)!;
    const gang: NpcShip[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const npc = world.spawn('pirate', g.state.player.position.clone().add(
        new THREE.Vector3(Math.cos(a) * 900, Math.sin(a) * 260, -1500 - i * 120)),
      11 + i * 7, python);
      npc.state.threatTier = 2;
      npc.state.missiles = 2;
      npc.state.energy = Math.round(npc.maxEnergy * 0.3);
      gang.push(npc);
    }
    // A fifth ship used to be spawned here already dead, so that `matesLost > 0`
    // outlasted the survivors healing back past 0.4. Both the reason and the
    // corpse are gone (docs/TODO/75): the live game never has a dead ship in
    // `world.npcs` when anything decides, so a fixture that put one there was
    // exercising a state the game cannot reach.
    // THE SETTLING STEP, CLAUDE.md's own caveat: a freshly spawned NPC's world
    // matrix is stale until something updates it and `shot.ts` raycasts against
    // it, so a fixture that lets the first frame discover that diverges for
    // reasons which are not the code's.
    world.scene.updateMatrixWorld(true);

    const carried = gang.reduce((n, s) => n + s.state.missiles, 0);
    const trace: string[] = [];
    let inSky = 0;
    let impacts = 0;
    let pools = g.state.sys.foreShield + g.state.sys.aftShield + g.state.sys.energy;
    for (let f = 0; f < frames; f++) {
      g.update(1 / 60, f / 60);
      const now = g.state.sys.foreShield + g.state.sys.aftShield + g.state.sys.energy;
      if (pools - now >= IMPACT.warhead.commander) impacts += 1;
      pools = now;
      inSky = Math.max(inSky, missilesInFlight.length);
      trace.push(`${f}|${g.mode}|${now}|${g.state.player.position.toArray().map(
        (n) => n.toFixed(4)).join(',')}|${world.npcs.map(
        (n) => `${n.state.alive ? 1 : 0}:${n.state.energy}:${n.state.missiles}`).join(';')}`);
    }
    return {
      trace: trace.join('\n'),
      carried,
      left: gang.reduce((n, s) => n + s.state.missiles, 0),
      inSky,
      impacts,
      mode: g.mode,
    };
  }).value;

  const a = fight(62_000_037, 4, 400);
  check(`a pirate in the GAME launches: ${a.carried - a.left} of ${a.carried} rounds`
    + ` spent, ${a.inSky} in the air at once`,
  a.left < a.carried && a.inSky > 0);
  check(`...the warhead arrives and is worth ${IMPACT.warhead.commander} of her pools`
    + ` (${a.impacts} impacts)`, a.impacts > 0);
  check(`...and it kills her (mode ${a.mode} inside ${(400 / 60).toFixed(1)}s)`, a.mode === 'dead');

  // Same seed, same fight — the game side of the claim the episode makes below.
  // This is the half of the equivalence check that fits in a test suite: the
  // other half compared this trace across two checkouts and got one sha256.
  const b = fight(62_000_037, 4, 400);
  eq('...and the whole fight replays byte-identically from the seed', b.trace, a.trace);
  check('...with the same rounds spent and the same warheads landing',
    b.left === a.left && b.impacts === a.impacts);
}

// --- and it is still the same run twice --------------------------------------
//
// Adding a branch moved every `random()` after it, so archived episode outcomes
// have shifted — expected, and docs/TRAINING-LOG.md says so. What is NOT
// negotiable is that a seed still replays: the regression gate, the trainer and
// every measurement in this repo rest on it. The whole report, not a summary,
// because a summary is where a diverging missile would hide.

console.log('\nmissiles: a seed still replays');
{
  const run = (seed: number): string => {
    const ep = new Episode({
      seed,
      pirates: [{ kind: 'scripted' }, { kind: 'scripted' }],
      trader: { kind: 'scripted' }, traderClass: 'playerCobra', traderArmed: true,
    });
    while (!ep.done) ep.step(FIXED_DT);
    return JSON.stringify(ep.report());
  };
  eq('an episode with missiles in it replays byte-identically', run(4_400_017), run(4_400_017));
  check('...and a different seed is a different fight', run(4_400_017) !== run(4_400_018));
}
