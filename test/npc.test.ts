// An NPC ship: how it flies, what it aims at, and what keeps it alive.
//
// Ship systems (shields, energy, heat, the damage model) are here too, because
// every balance figure this project quotes comes out of that model and it used to
// live in a comment.

import * as THREE from 'three';
import { seedWorld } from '../src/game/rng.ts';
import { NpcShip } from '../src/game/npc.ts';
import { playerLaser } from '../src/game/gunnery.ts';
import { COBRA_MK_3_HULL_ID } from '../src/game/ship-identity.ts';
import { SHIPPED_BRAINS } from '../src/game/brains.ts';
import { assignNpcTargets } from '../src/game/npc-targeting.ts';
import {
  freshSystems,
  applyDamage,
  regenerate,
  durability,
  updateCabinTemp,
  scoopFuel,
} from '../src/game/systems.ts';
import { check } from './harness.ts';

// --- NPCs actually fly ------------------------------------------------------

// The first executable tests of NPC behaviour. Until now npc.ts read `window`
// inside update(), so the largest module in the world step threw the moment it
// was asked to simulate anything outside a browser — which is why the sim/game
// parity invariant, the one guarding the bug that went undetected for six
// training rounds, is enforced by regex over source text.

console.log('\nNPC flight');
{
  // Seeded, because these assert emergent flight and NpcShip pulls from the
  // world RNG at construction. Without this the block inherits whatever stream
  // position the tests above happened to leave, so adding a test elsewhere
  // could fail one here — which is exactly what happened when combat.ts got
  // its own tests.
  seedWorld(20_260_727);
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** The commander's real gun, and how many 60 Hz frames its reload takes. */
  const PULSE = playerLaser(COBRA_MK_3_HULL_ID, 'pulse');
  const PULSE_FRAMES = Math.round(PULSE.cooldown * 60);
  const makePlayer = (pos: THREE.Vector3) =>
    ({ position: pos, quaternion: new THREE.Quaternion(), speed: 100 }) as never;
  const station = new THREE.Object3D();
  const worldView = (fleet: readonly NpcShip[], dockZ = 160) => ({
    station, dockZ, fleet, playerLegal: 0, brains: SHIPPED_BRAINS,
  });

  {
    const npc = new NpcShip('pirate', at(0, 0, 3000), 3);
    const before = npc.object.position.clone();
    for (let i = 0; i < 120; i++) {
      npc.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([npc]));
    }
    check('a pirate closes on the player',
      npc.object.position.distanceTo(at(0, 0, 0)) < before.distanceTo(at(0, 0, 0)));
    check('...and does not sit still doing it', npc.state.speed > 0);
  }
  {
    // A hostile ship fires: update returns a FireEvent rather than dealing damage.
    //
    // Measured before asserting, because the first version of this test failed
    // and the failure was informative: a pirate that starts 400 units out is
    // lined up on a stationary player for 2.8% of frames and fires 8 times
    // across 30s x 6 ships. At 800 it is 8.8% and 21 times. That is the same
    // knife-range dead zone that runs through docs/TRAINING-LOG.md — pirates
    // are hardest to be shot by exactly where the fight happens. The window
    // here is sized to that reality rather than to what I assumed.
    let fired = 0;
    for (let seed = 0; seed < 4; seed++) {
      const npc = new NpcShip('pirate', at(0, 0, 900), seed);
      for (let i = 0; i < 1800; i++) {
        const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([npc]));
        if (ev && ev.at === 'player') fired += 1;
      }
    }
    check(`pirates shoot at the player (${fired} times over 30s x4)`, fired > 0);
  }
  {
    // and an NPC NEVER damages anything itself — the Game resolves consequences
    const npc = new NpcShip('pirate', at(0, 0, 400), 7);
    const player = makePlayer(at(0, 0, 0));
    for (let i = 0; i < 300; i++) npc.update(1 / 60, player, worldView([npc]));
    check('an NPC only ever RETURNS a fire event, never applies it',
      (player as unknown as { speed: number }).speed === 100);
  }
  {
    // A trader does not shoot at an unprovoking commander — over a whole
    // engagement, not on one frame.
    //
    // The previous version flew a trader for one second and asserted that the
    // NEXT frame returned null. Every role returns null on almost every frame
    // — a pirate parked at point-blank range fires about 24 times in six
    // minutes — so the check passed for a pirate, for a Thargoid, and for a
    // ship with no gun at all. The pirate control below is what stops it
    // becoming vacuous again: if the harness stops producing fire events, the
    // control fails rather than the trader silently "passing".
    const engagement = (role: 'trader' | 'pirate') => {
      let events = 0;
      for (let seed = 0; seed < 6; seed++) {
        const npc = new NpcShip(role, at(0, 0, 900), seed);
        for (let i = 0; i < 3600; i++) {
          const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([npc]));
          if (ev && ev.at === 'player') events += 1;
        }
      }
      return events;
    };
    const traderShots = engagement('trader');
    const pirateShots = engagement('pirate');
    check(`a trader minds its own business rather than attacking `
      + `(${traderShots} shots over 6 x 60s at point-blank range)`,
    traderShots === 0);
    check(`...where a pirate in the same harness does shoot (${pirateShots} shots)`,
      pirateShots > 0);
    const unmolested = new NpcShip('trader', at(0, 0, 900), 2);
    for (let i = 0; i < 1800; i++) {
      unmolested.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([unmolested]));
    }
    check('...and is not even provoked by being flown at',
      !unmolested.state.provoked && !unmolested.state.provokedByPlayer);
  }

  {
    // A Dodo's slot sits 25 units shallower than a Coriolis slot. At z=-145
    // this trader is still outside the Dodo hull and must keep approaching;
    // treating the station as the old 160-unit fallback despawns it here.
    const trader = new NpcShip('trader', at(0, 0, -145), 2);
    trader.state.traderPhase = 'docking';
    trader.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([trader], 135));
    check('a trader does not dock short of a Dodo station slot', !trader.state.docked);
    trader.object.position.set(0, 0, -134);
    trader.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([trader], 135));
    check('...and docks after crossing the Dodo slot depth',
      trader.state.docked && trader.state.wantsDespawn);
  }

  // --- a pirate about to die spends its missiles ---------------------------
  //
  // They used to go down with them still on the rail, and the reason is
  // structural: the launch was decided in game.ts off the back of a FireEvent,
  // so a missile could only leave at the moment its owner was lined up inside
  // the gun's 0.25 rad gate with the reload finished. A pirate that is nearly
  // dead is rarely either. Measured, not assumed — see the trial below.
  //
  // Seed 5 picks the Cobra Mk III out of SPECS.pirate, the only stock pirate
  // hull that carries a missile.
  {
    /** Fly a pirate at a stationary player and report what left the rail. */
    const fly = (frames: number, hull: number, dist = 900, seedBase = 4100, seeds = 8) => {
      let missiles = 0, launchedAtAll = 0;
      for (let s = 0; s < seeds; s++) {
        seedWorld(seedBase + s);
        const npc = new NpcShip('pirate', at(0, 0, dist), 5);
        npc.state.threatTier = 1;
        npc.state.energy = Math.round(npc.maxEnergy * hull);
        let any = false;
        for (let i = 0; i < frames; i++) {
          const ev = npc.update(1 / 60, makePlayer(at(0, 0, 0)), worldView([npc]));
          if (ev && ev.at === 'player' && ev.weapon === 'missile' && npc.state.missiles > 0) {
            npc.state.missiles -= 1;   // the Game spends the round — see enemyLaunchMissile
            missiles += 1;
            any = true;
          }
        }
        if (any) launchedAtAll += 1;
      }
      return { missiles, launchedAtAll, seeds };
    };

    seedWorld(20_260_727);
    check('a stock pirate hull carries a missile to launch',
      new NpcShip('pirate', at(0, 0, 900), 5).state.missiles === 1);

    const hurt = fly(300, 0.35);
    check(`a pirate on its last legs gets the missile away (${hurt.launchedAtAll}/${hurt.seeds})`,
      hurt.launchedAtAll === hurt.seeds);
    const whole = fly(300, 1, 400);
    check('...where an undamaged one at the same knife range keeps it',
      whole.missiles === 0);
    check('...and it spends the round rather than firing the rail twice',
      hurt.missiles === hurt.launchedAtAll);

    // The headline: under sustained fire, does it die holding the missile?
    // The player's real pulse laser, at its real cadence — a Cobra Mk III's
    // 9-point hit every 0.24s, which the ship turns into damage against its own
    // defence. Before this change the answer was 0 of 20: the opportunistic
    // launch needs 1200+ units of separation, and the fight is not fought there.
    {
      let died = 0, armedToTheEnd = 0;
      for (let s = 0; s < 20; s++) {
        seedWorld(7000 + s);
        const npc = new NpcShip('pirate', at(0, 0, 1400), 5);
        npc.state.threatTier = 1;
        const player = makePlayer(at(0, 0, 0));
        for (let i = 0; i < 60 * 20 && npc.state.alive; i++) {
          const ev = npc.update(1 / 60, player, worldView([npc]));
          if (ev && ev.at === 'player' && ev.weapon === 'missile' && npc.state.missiles > 0) {
            npc.state.missiles -= 1;
          }
          if (i % PULSE_FRAMES === 0) npc.takeLaserHit(PULSE.hit, at(0, 0, 0), true);
        }
        if (!npc.state.alive) died += 1;
        if (!npc.state.alive && npc.state.missiles > 0) armedToTheEnd += 1;
      }
      check(`the trial killed all 20 pirates (${died})`, died === 20);
      check(`most die having launched, not holding (${20 - armedToTheEnd}/20 launched)`,
        armedToTheEnd < 10);
    }
  }
}

// --- who hunts whom ---------------------------------------------------------

// The fights the player is not in. This ran inline in updateFlight on a
// 2-second timer, which is why it never had a test; it is game/npc-targeting.ts
// now, pure over the fleet.

console.log('\nNPC targeting');
{
  const at = (x: number) => ({ position: { distanceTo: (o: { x: number }) => Math.abs(x - o.x), x } });
  let id = 0;
  // The fakes carry NpcShip's OWN attacker verbs, borrowed off the prototype:
  // the list is private to npc.ts now, and a hand-rolled copy here would be
  // testing the copy rather than the rule.
  const { addAttacker, pruneAttackers, hasAttacker } = NpcShip.prototype;
  const ship = (role: string, x: number, over: Record<string, unknown> = {}) => ({
    id: id++, role, state: { alive: true }, npcTarget: null as unknown,
    attackers: [] as unknown[],
    addAttacker, pruneAttackers, hasAttacker,
    object: at(x), ...over,
  }) as unknown as Parameters<typeof assignNpcTargets>[0][number];
  const playerAt = (x: number) => ({ distanceTo: (o: { x: number }) => Math.abs(x - o.x), x }) as unknown as Parameters<typeof assignNpcTargets>[1];

  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    check('a pirate with no player nearby goes after a trader', pirate.npcTarget === trader);
    check('...and the trader knows who is after it', trader.hasAttacker(pirate));
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(100), 0);
    check('a pirate with the PLAYER in reach ignores the trader', pirate.npcTarget === null);
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 50_000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    check('a trader out of range is not worth chasing', pirate.npcTarget === null);
  }
  {
    const police = ship('police', 0), pirate = ship('pirate', 1000);
    assignNpcTargets([police, pirate], playerAt(500_000), 0);
    check('police hunt pirates', police.npcTarget === pirate);
  }
  {
    const hunter = ship('hunter', 0), pirate = ship('pirate', 1000);
    assignNpcTargets([hunter, pirate], playerAt(500_000), 0);
    check('a bounty hunter helps out when you are clean', hunter.npcTarget === pirate);
    const hunter2 = ship('hunter', 0), pirate2 = ship('pirate', 1000);
    assignNpcTargets([hunter2, pirate2], playerAt(500_000), 2);
    check('...and has better things to do when you are a fugitive',
      hunter2.npcTarget === null);
  }
  {
    const pirate = ship('pirate', 0), trader = ship('trader', 1000);
    assignNpcTargets([pirate, trader], playerAt(500_000), 0);
    const dead = ship('trader', 900);
    pirate.npcTarget = dead;
    dead.state.alive = false;
    assignNpcTargets([pirate, trader, dead], playerAt(500_000), 0);
    check('a ship whose quarry died picks a new one', pirate.npcTarget === trader);
  }
  {
    const trader = ship('trader', 0);
    const gone = ship('pirate', 100);
    trader.addAttacker(gone);
    trader.addAttacker(gone);
    const list = (trader as unknown as { attackers: unknown[] }).attackers;
    check('registering the same attacker twice does not double it up',
      list.length === 1);
    gone.state.alive = false;
    assignNpcTargets([trader, gone], playerAt(500_000), 0);
    check('dead attackers are pruned from the list they are on',
      !trader.hasAttacker(gone));
  }
  {
    // The other half of the invariant: alive, but no longer pointed at us.
    // The trader is out of hunting range so the pirate cannot simply re-acquire
    // it in the same call, which would hide the prune.
    const trader = ship('trader', 0);
    const bored = ship('pirate', 50_000);
    trader.addAttacker(bored);
    assignNpcTargets([trader, bored], playerAt(500_000), 0);
    check('...as are the ones that moved on while we were still on their list',
      !trader.hasAttacker(bored));
  }
}

// --- the ship's own numbers -------------------------------------------------

// Energy, shields and heat ran inline in updateFlight, and the damage model
// sat inside applyPlayerDamage next to a call to flashDamage(). They are now
// game/systems.ts, which is pure and importable — so these are the first real
// tests of the numbers every balance claim in this project rests on.
//
// train/survivability.ts used to carry this model in a COMMENT and hard-code
// 3.0 and 4.0 from it. It calls durability() now.

console.log('\nship systems');
{
  check('durability from the front is 1 shield + 4 energy / 2 = 3',
    durability(false) === 3);
  check('manoeuvring so both faces take hits is worth 4',
    durability(true) === 4);

  {
    const s = freshSystems();
    const r = applyDamage(s, 0.4, true, () => 1);
    check('a hit from ahead is absorbed by the FORE shield',
      Math.abs(s.foreShield - 0.6) < 1e-9 && s.aftShield === 1 && s.energy === 4);
    check('...and does not reach the hull', !r.reachedHull && !r.destroyed);
  }
  {
    const s = freshSystems();
    applyDamage(s, 0.4, false, () => 1);
    check('a hit from behind is absorbed by the AFT shield',
      Math.abs(s.aftShield - 0.6) < 1e-9 && s.foreShield === 1);
  }
  {
    const s = freshSystems();
    applyDamage(s, 1.5, true, () => 1);   // 1.0 shield + 0.5 through
    check('overflow past a flattened shield costs energy at 2 per point',
      s.foreShield === 0 && Math.abs(s.energy - 3) < 1e-9);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, 3.0, true, () => 1);
    check('exactly 3.0 from the front destroys the ship', r.destroyed && s.energy <= 0);
  }
  {
    const s = freshSystems();
    const r = applyDamage(s, 2.9, true, () => 1);
    check('...and 2.9 does not', !r.destroyed && s.energy > 0);
  }
  {
    const s = freshSystems();
    const never = applyDamage(s, 1.5, true, () => 0.99);
    const always = applyDamage(freshSystems(), 1.5, true, () => 0.01);
    check('a hull hit rolls for wrecking a fitting',
      !never.wreckedSomething && always.wreckedSomething);
  }

  {
    // shields only come back once energy is healthy — a beaten ship has to
    // break off before it gets them back, which is the whole tactical point
    const s = freshSystems();
    s.energy = 0.5; s.foreShield = 0; s.aftShield = 0;
    regenerate(s, 1, { energyUnit: false });
    check('shields do NOT regenerate while energy is below 1',
      s.foreShield === 0 && s.aftShield === 0);
    s.energy = 2;
    regenerate(s, 1, { energyUnit: false });
    check('...and do once it recovers', s.foreShield > 0 && s.aftShield > 0);
  }
  {
    const plain = freshSystems(); plain.energy = 0;
    const boosted = freshSystems(); boosted.energy = 0;
    regenerate(plain, 1, { energyUnit: false });
    regenerate(boosted, 1, { energyUnit: true });
    check('an energy unit doubles the recharge rate',
      Math.abs(boosted.energy - plain.energy * 2) < 1e-9);
  }
  {
    const s = freshSystems();
    check('deep space is cold', !updateCabinTemp(s, 1, 1_000_000) && s.cabinTemp === 0);
    let dead = false;
    for (let i = 0; i < 600 && !dead; i++) dead = updateCabinTemp(s, 1 / 60, 0);
    check('sitting in the sun eventually kills you', dead);
  }
  {
    check('no scoops, no fuel', scoopFuel(1, 1000, false, 0, 70) === 0);
    check('scoops but too far out gathers nothing', scoopFuel(1, 200_000, true, 0, 70) === 0);
    check('scooping close in gathers fuel', scoopFuel(1, 1000, true, 0, 70) > 0);
    check('a full tank never overfills', scoopFuel(1, 1000, true, 70, 70) === 0);
    check('...and a nearly-full one fills exactly to the top',
      Math.abs(scoopFuel(1, 1000, true, 69.5, 70) - 0.5) < 1e-9);
  }
}
