// Being shot at: damage, breaches, buying your way out, and the law.
//
// Combat resolution proper — Combat.fire() and everything downstream of a hit.
// Police hostility is here because it is the rule that decides whether you are
// being shot at legitimately, and it used to be four regexes over source text
// because npc.ts could not be imported.

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { World } from '../src/game/world.ts';
import { newCommander, cargoTonnes } from '../src/game/commander.ts';
import {
  dumpCargo,
  offerBribe,
  appetiteOf,
  OPPORTUNIST_FLOOR,
  GANG_FLOOR,
} from '../src/game/jettison.ts';
import { breachLoss, CARGO_LOSS_CHANCE } from '../src/game/systems.ts';
import { Combat } from '../src/game/combat.ts';
import {
  isContraband,
  contrabandTonnes,
  carryingContraband,
  CLEAN,
  FUGITIVE,
} from '../src/game/law.ts';
import type { CommanderData } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { isHostileToPlayer } from '../src/game/npc.ts';
import { COMMODITIES } from '../src/galaxy/galaxy.ts';
import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { check } from './harness.ts';
import { DT, load } from './fixtures.ts';

// --- resolving a hit ---------------------------------------------------------
//
// The bounty, the kill credit, the contract tick and the legal offence used to
// be one 33-line method reachable only through a Game. The events are the
// point: combat decides, and the caller is the one that launches the Vipers.

console.log('\ncombat');
{
  // Seeded: World.spawn and wreck() both draw from the global stream, so
  // without this the block inherits whatever position the tests above left.
  // The ordnance block in particular survives today only because pirate hulls
  // happen to have no ecmChance — give them one and a missile test becomes a
  // coin flip on stream position.
  seedWorld(4_242_424);
  const setup = () => {
    const world = new World();
    const combat = new Combat(world);
    const c = {
      credits: 0, kills: 0, combatScore: 0, systemIndex: 7, contracts: [],
      cargo: new Array(COMMODITIES.length).fill(0),
      equipment: { miningLaser: false },
      mission: { stage: 0, targetIndex: null },
    } as unknown as CommanderData;
    return { world, combat, c };
  };
  const at = (z: number) => new THREE.Vector3(0, 0, z);
  const kinds = (evs: { kind: string }[]) => evs.map((e) => e.kind);
  const msgs = (evs: { kind: string; text?: string }[]) =>
    evs.filter((e) => e.kind === 'message').map((e) => e.text);
  const offence = (evs: { kind: string; level?: number }[]) =>
    evs.find((e) => e.kind === 'offence')?.level;

  {
    const { world, combat, c } = setup();
    const pirate = world.spawn('pirate', at(-500), 1);
    const bounty = pirate.bounty;
    const evs = combat.destroy(c, pirate);
    check('a kill pays its bounty', c.credits === bounty && bounty > 0);
    check('...counts as a kill', c.kills === 1 && c.combatScore > 0);
    check('...is nobody\'s business legally', offence(evs) === CLEAN);
    check('...and takes the ship out of the sky',
      world.npcs.length === 0 && kinds(evs).includes('wrecked'));
  }
  {
    const { world, combat, c } = setup();
    const evs = combat.destroy(c, world.spawn('trader', at(-500), 1));
    check('destroying a trader makes you a fugitive', offence(evs) === FUGITIVE);
    check('...and pays nothing', c.credits === 0);
  }
  {
    const { world, combat, c } = setup();
    combat.destroy(c, world.spawn('asteroid', at(-500), 1));
    check('a rock is not a kill', c.kills === 0 && c.combatScore === 0);
  }
  {
    // the wreck path exists so a fight you only WATCHED does not pay you
    const { world, combat, c } = setup();
    const pirate = world.spawn('pirate', at(-500), 1);
    combat.wreck(pirate);
    check('an NPC-vs-NPC kill pays no bounty and no credit',
      c.credits === 0 && c.kills === 0 && world.npcs.length === 0);
  }
  {
    const { world, combat, c } = setup();
    c.contracts = [
      { kind: 'bounty', destination: 7, progress: 0, qty: 2 },
      { kind: 'bounty', destination: 99, progress: 0, qty: 2 },
    ] as never;
    combat.destroy(c, world.spawn('pirate', at(-500), 1));
    check('a bounty contract ticks up where it was taken',
      c.contracts[0].progress === 1);
    check('...and not for a contract from somewhere else',
      c.contracts[1].progress === 0);
    const evs = combat.destroy(c, world.spawn('pirate', at(-500), 2));
    check('...and says so when it completes',
      c.contracts[0].progress === 2
      && msgs(evs).some((m) => m!.includes('BOUNTY CONTRACT COMPLETE')));
    const after = combat.destroy(c, world.spawn('pirate', at(-500), 3));
    check('...only once', c.contracts[0].progress === 2
      && !msgs(after).some((m) => m!.includes('CONTRACT COMPLETE')));
  }
  {
    // thargons are drones: killing the mothership shuts them down
    const { world, combat, c } = setup();
    const goid = world.spawn('thargoid', at(-500), 1);
    const drone = world.spawn('thargon', at(-400), 2);
    const evs = combat.destroy(c, goid);
    check('the last thargoid dying deactivates its thargons',
      drone.inert === true
      && msgs(evs).some((m) => m!.includes('THARGONS DEACTIVATED')));
  }
  {
    const { world, combat, c } = setup();
    world.spawn('thargoid', at(-900), 9);
    const drone = world.spawn('thargon', at(-400), 2);
    combat.destroy(c, world.spawn('thargoid', at(-500), 1));
    check('...but not while another mothership is alive', drone.inert === false);
  }
}

// --- collision rates --------------------------------------------------------

// The collision round concluded the shipped brains "already fly clear of the
// target, so a rule that punishes contact costs them nothing", from a table
// covering the scripted trader and the Jameson matchups. It did not cover
// pirate versus trained EVADER, and there the claim is false: those two brains
// were both trained before collisions existed, and they ram each other in more
// than half of all fights. Against an unarmed evader the pirate destroys itself
// 17% of the time, which is the evader winning by being flown into.
//
// Asserted here so the numbers are enforced rather than assumed, and so the
// known-bad matchup cannot quietly get worse. Bounds are ceilings on today's
// measured behaviour, not aspirations.

console.log('\ncollision rates');
{
  const COLLISION_DAMAGE = 0.45;
  const rams = (make: () => { pirates: Controller[]; trader: Controller; traderArmed?: boolean },
                episodes: number): number => {
    let total = 0;
    for (let e = 0; e < episodes; e++) {
      const ep = new Episode({ seed: 7000 + e * 11, ...make(), maxTime: 45 });
      while (!ep.done) ep.step(DT);
      // an unarmed trader deals no laser damage, so all pirate damage is contact
      for (const p of ep.pirates) total += p.damageTaken / COLLISION_DAMAGE;
    }
    return total / episodes;
  };

  const pirate = load('pirate-attack-r2');   // the collision study used r2
  const evader = load('trader-evade-r2');
  {
    const vScripted = rams(() => ({
      pirates: [{ kind: 'policy', brain: pirate }], trader: { kind: 'scripted' },
    }), 40);
    check(`pirate vs scripted trader rarely collides (${vScripted.toFixed(2)}/episode)`,
      vScripted < 0.3);
  }
  {
    // WAS known-bad, and the retrain that fixed it tightened the number as
    // this comment asked. The check now measures the SHIPPED brain, because
    // that is what a player meets:
    //
    //   pirate-attack-g3 (shipped)  0.78 rams/episode, self-destructs 15%
    //   pirate-attack-r2 (legacy)   2.00                              57%
    //
    // r2 got worse rather than better, and deliberately: pirate hulls now
    // carry ShipClass.minSpeed and cannot brake below ~43% of top speed, so a
    // brain trained before that rule cannot slow out of a collision. r2 ships
    // only behind window.__legacyPirates, and in the game RAM_GUARD breaks it
    // off at 220 units, which the sim does not model.
    const shipped = load('pirate-attack-g3');
    const vEvader = rams(() => ({
      pirates: [{ kind: 'policy', brain: shipped }], trader: { kind: 'policy', brain: evader },
    }), 40);
    check(`shipped pirate vs trained evader rarely collides (${vEvader.toFixed(2)}/episode)`,
      vEvader < 1.2);
  }
}

// --- a hull breach costs you something ---------------------------------------

console.log('\nhull breach');
{
  const kit = (over: Record<string, boolean> = {}) => ({
    cargo: new Array(COMMODITIES.length).fill(0),
    equipment: { ecm: false, scoops: false, rearLaser: false, leftLaser: false,
      rightLaser: false, dockingComputer: false, combatComputer: false, ...over },
  }) as unknown as Parameters<typeof breachLoss>[0];

  {
    const c = kit();
    check('with nothing to lose, nothing is lost', breachLoss(c, () => 0).kind === 'nothing');
  }
  {
    const c = kit(); c.cargo[4] = 2;
    const lost = breachLoss(c, () => 0);
    check('cargo goes when there is cargo',
      lost.kind === 'cargo' && c.cargo[4] === 1);
  }
  {
    const c = kit({ ecm: true });
    const lost = breachLoss(c, () => 0);
    check('with an empty hold, equipment goes instead',
      lost.kind === 'equipment' && c.equipment.ecm === false);
  }
  {
    // equipment is rarer to lose than cargo: above the threshold, cargo survives
    const c = kit({ ecm: true }); c.cargo[4] = 1;
    check('a high roll takes the equipment',
      breachLoss(c, () => CARGO_LOSS_CHANCE).kind === 'equipment' && c.cargo[4] === 1);
    const c2 = kit({ ecm: true }); c2.cargo[4] = 1;
    check('...a low roll takes the cargo',
      breachLoss(c2, () => 0).kind === 'cargo' && c2.equipment.ecm === true);
  }
  {
    const c = kit({ combatComputer: true });
    const lost = breachLoss(c, () => 0);
    check('losing the combat computer is reported by key, so it can be disengaged',
      lost.kind === 'equipment' && lost.key === 'combatComputer');
  }
}

// --- buying your way out ----------------------------------------------------
//
// A balance lever (how much cargo buys off a gang) that lived inside a 65-line
// method and had never been asserted.

console.log('\njettison');
{
  const hold = () => {
    const c = new Array(COMMODITIES.length).fill(0);
    c[0] = 3;                       // food, cheap
    c[10] = 2;                      // firearms, dear
    return c;
  };

  {
    const c = hold();
    const d = dumpCargo(c, 1);
    // the rule that makes jettisoning a real choice: it costs you the good stuff
    // The dearest thing IN THE HOLD, not in the whole table. The first version
    // reduced over all 17 commodities (giving 6, Narcotics, which was never
    // aboard) and then asserted `dearest !== undefined` — always true for a
    // number, so the clause was dead and the real comparison never happened.
    const inHold = c.map((qty, i) => ({ qty, i })).filter((x) => x.qty > 0);
    const dearest = inHold
      .reduce((a, b) => (COMMODITIES[a.i].basePrice > COMMODITIES[b.i].basePrice ? a : b)).i;
    check('the most valuable tonne goes first', d.tonnes[0] === dearest);
    check('...and it leaves the hold', c[10] === 1);
    check('...valued as markOf values it', d.value === COMMODITIES[10].basePrice * 4);
  }
  {
    const c = hold();
    const d = dumpCargo(c, 99);
    check('dumping more than you have empties the hold, not the array',
      d.tonnes.length === 5 && c.every((q) => q === 0));
  }
  {
    const d = dumpCargo(new Array(COMMODITIES.length).fill(0), 3);
    check('an empty hold dumps nothing', d.tonnes.length === 0 && d.value === 0);
  }

  {
    check('a gang wants more than an opportunist',
      appetiteOf(true, 10_000) > appetiteOf(false, 10_000));
    check('...and the demand scales with what you arrived carrying',
      appetiteOf(false, 100_000) > appetiteOf(false, 10_000));
    check('...but a near-empty hold is not a free pass',
      appetiteOf(false, 0) === OPPORTUNIST_FLOOR && appetiteOf(true, 0) === GANG_FLOOR);
  }

  {
    const pirate = (organised: boolean) => ({ alive: true, organised, satisfied: false });
    const gang = [pirate(false), pirate(false), pirate(true)];
    const arrival = 10_000;

    const tooLittle = offerBribe(gang, 100, arrival);
    check('a token handful buys nobody off',
      tooLittle.bought === 0 && tooLittle.stillWant !== null);
    check('...and it tells you the SMALLEST top-up that would work',
      tooLittle.stillWant === appetiteOf(false, arrival) - 100);

    const enough = offerBribe(gang, appetiteOf(false, arrival), arrival);
    check('paying the opportunist price peels off the opportunists',
      enough.bought === 2 && gang[0].satisfied && gang[1].satisfied);
    check('...but the gang leader is still coming', !gang[2].satisfied);

    // the toll accumulates across dumps — a second handful finishes the job
    const rest = offerBribe(gang, appetiteOf(true, arrival), arrival);
    check('a second dump finishes what the first started',
      rest.bought === 1 && gang[2].satisfied && rest.stillWant === null);
    check('...and nobody is bought twice', offerBribe(gang, 1e9, arrival).bought === 0);
  }
  {
    const dead = [{ alive: false, organised: false, satisfied: false }];
    check('the dead are not bribable', offerBribe(dead, 1e9, 0).bought === 0);
  }
}

// --- rescuing someone is not smuggling ---------------------------------------
//
// The occupant of an escape capsule used to be stored as `cargo[3] += 1`, and
// commodity 3 is Slaves — which law.ts lists as contraband. Rescuing a pilot
// therefore tripped the police scan and made you an Offender for a good deed.

console.log('\nsurvivors');
{
  check('commodity 3 really is the one that would have bitten',
    COMMODITIES[3].name === 'Slaves' && isContraband(3));

  const c = newCommander();
  c.survivors = 2;
  check('a rescued pilot is not contraband',
    !carryingContraband(c.cargo) && contrabandTonnes(c.cargo) === 0);
  check('...but still takes up a bay', cargoTonnes(c) === 2);

  const withCargo = newCommander();
  withCargo.cargo[0] = 3;
  withCargo.survivors = 1;
  check('...and shares the hold with real cargo', cargoTonnes(withCargo) === 4);

  // a save written before the fix must still load
  const old = JSON.parse(JSON.stringify(newCommander())) as Record<string, unknown>;
  delete old.survivors;
  check('an old save with no survivors field is repaired, not NaN',
    cargoTonnes(old as never) === 0);
}

// --- police only care about what YOU did ------------------------------------

// takeDamage() sets `provoked` for damage from ANY source, including another
// NPC. isHostileToPlayer() used to read that flag, so a Viper fighting a
// pirate turned on a clean commander — which is what Chris flew into while
// approaching a station.
//
// These were four regex assertions against source text, because npc.ts could
// not be imported under node. It can now, so they call the function instead.

console.log('\npolice hostility');
{
  const npcLike = (role: string, over: Record<string, unknown> = {}) =>
    ({ alive: true, inert: false, satisfied: false, role, provoked: false,
       provokedByPlayer: false, ...over }) as unknown as Parameters<typeof isHostileToPlayer>[0];

  check('pirates are hostile to anyone',
    isHostileToPlayer(npcLike('pirate'), 0));
  check('a pirate paid off in cargo breaks off',
    !isHostileToPlayer(npcLike('pirate', { satisfied: true }), 0));
  check('police ignore a clean commander',
    !isHostileToPlayer(npcLike('police'), 0));
  check('police hunt a fugitive',
    isHostileToPlayer(npcLike('police', { legalStatus: 2 }), 2));
  check('POLICE IN A FIGHT WITH SOMEONE ELSE STAY FRIENDLY',
    !isHostileToPlayer(npcLike('police', { provoked: true }), 0));
  check('police you shot at come for you',
    isHostileToPlayer(npcLike('police', { provoked: true, provokedByPlayer: true }), 0));
  check('bounty hunters ignore a clean commander',
    !isHostileToPlayer(npcLike('hunter'), 0));
  check('bounty hunters in a fight with someone else stay friendly',
    !isHostileToPlayer(npcLike('hunter', { provoked: true }), 0));
  check('a destroyed ship is hostile to nobody',
    !isHostileToPlayer(npcLike('pirate', { alive: false }), 0));

  // the station's own Vipers are launched AT you, so they must read hostile
  const game = readFileSync(new URL('../src/game/game.ts', import.meta.url), 'utf8');
  check('station defence vipers still come for you',
    /viper\.provokedByPlayer = true/.test(game));
}
