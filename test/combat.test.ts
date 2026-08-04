// Being shot at: damage, breaches, buying your way out, and the law.
//
// Combat resolution proper — Combat.fire() and everything downstream of a hit.
// Police hostility is here because it is the rule that decides whether you are
// being shot at legitimately, and it used to be four regexes over source text
// because npc.ts could not be imported.

import * as THREE from 'three';
import { World } from '../src/game/world.ts';
import { newCommander, cargoTonnes } from '../src/game/commander.ts';
import { dumpCargo, offerBribe, appetiteOf } from '../src/game/jettison.ts';
import {
  OPPORTUNIST_FLOOR, GANG_FLOOR, VALUE_PER_TONNE,
} from '../src/constants/jettison.ts';
import { markOf } from '../src/game/threat.ts';
import { ORDINARY_GOODS, ORE, WRECK_CARGO } from '../src/constants/commodities.ts';
import { CargoField, canisterMaxEnergy } from '../src/game/cargo.ts';
import { SCOOP_RANGE } from '../src/constants/scoop.ts';
import { breachLoss, freshSystems } from '../src/game/systems.ts';
import { CARGO_LOSS_CHANCE } from '../src/constants/hull-breach.ts';
import { Combat } from '../src/game/combat.ts';
import {
  isContraband, contrabandTonnes, carryingContraband,
} from '../src/game/law.ts';
import { CLEAN, FUGITIVE } from '../src/constants/law.ts';
import type { CommanderData } from '../src/game/commander.ts';
import { seedWorld } from '../src/game/rng.ts';
import { isHostileToPlayer } from '../src/game/npc.ts';
import { npcImpactDamage } from '../src/game/impact-damage.ts';
import { IMPACT } from '../src/constants/impact.ts';
import {
  ESCAPE_CHANCE, MINING_YIELD_MIN, MINING_YIELD_SPAN,
} from '../src/constants/wreck.ts';
import { COMMODITIES } from '../src/galaxy/galaxy.ts';
import { Episode, type Controller } from '../src/ai-training/scenario.ts';
import { check, eq } from './harness.ts';
import { DT, load, SHIPPED_DEFEND } from './fixtures.ts';
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
    eq('combat reports the explosion before applying wreck consequences',
      kinds(evs).slice(0, 2).join('|'), 'sound|wrecked');
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
      drone.state.inert === true
      && msgs(evs).some((m) => m!.includes('THARGONS DEACTIVATED')));
  }
  {
    const { world, combat, c } = setup();
    world.spawn('thargoid', at(-900), 9);
    const drone = world.spawn('thargon', at(-400), 2);
    combat.destroy(c, world.spawn('thargoid', at(-500), 1));
    check('...but not while another mothership is alive', drone.state.inert === false);
  }
  {
    const world = new World();
    const combat = new Combat(world);
    const c = newCommander();
    world.spawn('pirate', at(-500), 1);
    const scratch = {
      a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(),
      ray: new THREE.Raycaster(),
    };
    const evs = combat.fire(
      c, freshSystems(), new THREE.Vector3(), new THREE.Vector3(0, 0, -1),
      0, true, scratch);
    const ordered = evs.slice(0, 5).map((e) =>
      e.kind === 'sound' ? `sound:${e.name}` : e.kind);
    eq('a laser hit reports both sounds before ordered combat consequences',
      ordered.join('|'), 'sound:laser|sound:hit|fired|beam|offence');
  }
  {
    // The wreck constants moved to constants/wreck.ts, so the rule and its
    // numbers are in different files — these fly the REAL wreck path over
    // seeded kills and hold what it measurably does against the constants, so
    // a re-inlined literal in combat.ts costs a red line (the
    // spawning.test.ts shape).
    seedWorld(90_007);
    const escapeRate = (role: 'trader' | 'pirate'): number => {
      const { world, combat } = setup();
      let pods = 0;
      for (let i = 0; i < 400; i += 1) {
        const npc = world.spawn(role, at(-500), 0);
        const before = world.cargo.items.filter((k) => k.kind === 'capsule').length;
        combat.wreck(npc);
        if (world.cargo.items.filter((k) => k.kind === 'capsule').length > before) {
          pods += 1;
        }
      }
      return pods / 400;
    };
    const traders = escapeRate('trader');
    const pirates = escapeRate('pirate');
    check(`a trader's pilot punches out at ESCAPE_CHANCE.trader `
      + `(measured ${traders} over 400 kills)`,
    Math.abs(traders - ESCAPE_CHANCE.trader) < 0.07);
    check(`...and a pirate's at ESCAPE_CHANCE.other (measured ${pirates})`,
      Math.abs(pirates - ESCAPE_CHANCE.other) < 0.07);

    // ...and what a mined rock pays: every yield inside the stated band, and
    // both ends of the band actually drawn.
    const { world, combat, c } = setup();
    (c.equipment as { miningLaser: boolean }).miningLaser = true;
    const yields = new Set<number>();
    let outside = 0;
    for (let i = 0; i < 200; i += 1) {
      const rock = world.spawn('asteroid', at(-500), 0);
      const before = world.cargo.items.length;
      combat.destroy(c, rock);
      const got = world.cargo.items.length - before;
      yields.add(got);
      if (got < MINING_YIELD_MIN || got >= MINING_YIELD_MIN + MINING_YIELD_SPAN) {
        outside += 1;
      }
    }
    check(`a mined rock always pays within the stated band (saw ${
      [...yields].sort().join('/')})`, outside === 0);
    check('...and the band\'s floor and ceiling are both real',
      yields.has(MINING_YIELD_MIN)
      && yields.has(MINING_YIELD_MIN + MINING_YIELD_SPAN - 1));
    check('...and every canister it spills is on the ore list',
      world.cargo.items.length > 100
      && world.cargo.items.every((k) => ORE.includes(k.commodity)));
  }
  {
    // What a wreck spills is the WRECK_CARGO class, flown through the real
    // wreck path — a re-inlined list in combat.ts goes red here.
    seedWorld(90_011);
    const { world, combat } = setup();
    for (let i = 0; i < 60; i += 1) combat.wreck(world.spawn('trader', at(-500), 0));
    const spilled = world.cargo.items.filter((k) => k.kind === 'cargo');
    check(`a wreck spills only WRECK_CARGO (${spilled.length} canisters)`,
      spilled.length > 40 && spilled.every((k) => WRECK_CARGO.includes(k.commodity)));
  }

  // --- the ordinary-goods decision, pinned -----------------------------------
  //
  // constants/commodities.ts records it: the consignment list and the
  // generation ship's shed are ONE rule (`ORDINARY_GOODS`), and a wreck's
  // spill is that class plus furs — a divergence recorded, not resolved
  // (docs/TODO/90-constants-cleanup.md, Open). This holds the relationship at
  // exactly that: drop the Furs row, add another, or let the lists drift and
  // it goes red. Furs is found by NAME so the check cannot itself hold a
  // stale index.
  {
    const furs = COMMODITIES.findIndex((k) => k.name === 'Furs');
    check('Furs is a commodity the relationship can name', furs >= 0);
    const wreckSet = new Set(WRECK_CARGO);
    check('a wreck spills exactly the ordinary goods, plus furs',
      WRECK_CARGO.length === ORDINARY_GOODS.length + 1
      && ORDINARY_GOODS.every((i) => wreckSet.has(i))
      && wreckSet.has(furs));
    check('...and none of it is contraband',
      WRECK_CARGO.every((i) => !isContraband(i)) && ORE.every((i) => !isContraband(i)));
    // the ore list, by name: minerals in the majority, then the two metals
    const named = (name: string) => COMMODITIES.findIndex((k) => k.name === name);
    check('the ore list is minerals and metals, minerals in the majority',
      ORE.every((i) => [named('Minerals'), named('Gold'), named('Platinum')].includes(i))
      && ORE.filter((i) => i === named('Minerals')).length * 2 > ORE.length);
  }
}

// --- scooping ----------------------------------------------------------------
//
// The reach moved to constants/scoop.ts; the boundary is scanned out of the
// real CargoField.update rather than probed at the constant, so a re-inlined
// literal in cargo.ts moves the measurement and goes red.

console.log('\nscooping');
{
  const reached = (dist: number): boolean => {
    const field = new CargoField(new THREE.Object3D());
    field.restore(new THREE.Vector3(dist, 0, 0), new THREE.Vector3(),
      new THREE.Vector3(1, 0, 0), 'cargo', 0, canisterMaxEnergy('cargo'));
    return field.update(0, new THREE.Vector3()).length > 0;
  };
  let furthest = 0;
  for (let d = 1; d <= 90; d += 1) if (reached(d)) furthest = d;
  eq('the furthest whole unit a canister can be scooped from is SCOOP_RANGE',
    furthest, SCOOP_RANGE);
  check('...and the boundary is the boundary', reached(SCOOP_RANGE) && !reached(SCOOP_RANGE + 1));
}
// --- collision rates --------------------------------------------------------
// The collision round concluded the shipped brains "already fly clear of the
// target, so a rule that punishes contact costs them nothing", from a table
// covering the scripted trader and the Jameson matchups. It did not cover a
// pirate against a trader that FLIES, and there the claim was false: the brains
// of the day were trained before collisions existed and rammed each other in
// more than half of all fights, with the pirate destroying itself 17% of the
// time — the evader winning by being flown into.
//
// Asserted here so the numbers are enforced rather than assumed, and so the
// harder matchup cannot quietly get worse. Bounds are ceilings on today's
// measured behaviour, not aspirations.

console.log('\ncollision rates');
{
  // What ONE ram costs a pirate, in the units its bank is kept in: the stated
  // `IMPACT.ram` (constants/impact.ts). The ratio below is a count of
  // collisions, so it has to divide by the same number the episode subtracted.
  const COLLISION_DAMAGE = npcImpactDamage(IMPACT.ram);
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

  // BOTH MATCHUPS ARE THE SHIPPED BRAINS NOW. They used to be `pirate-attack-r2`
  // against `trader-evade-r2` — two policies the game did not fly, and whose
  // weights went with the other 29 in TODO 57 — so a ceiling that was meant to
  // stop a player meeting a kamikaze was measuring a brain no player could meet.
  // A pirate flying the shipped policy at a trader flying the shipped defence
  // policy is a fight the game contains.
  const shipped = load('pirate-attack-g3');
  const evader = load(SHIPPED_DEFEND);
  {
    const vScripted = rams(() => ({
      pirates: [{ kind: 'policy', brain: shipped }], trader: { kind: 'scripted' },
    }), 40);
    // Measured 0.00 over these 40 episodes, against r2's 0.40 on the same
    // fixture. The bound is a CEILING on today's behaviour with headroom for a
    // retrain, not a target.
    check(`pirate vs scripted trader rarely collides (${vScripted.toFixed(2)}/episode)`,
      vScripted < 0.3);
  }
  {
    // The known-bad matchup: a trader that FLIES rather than one that holds a
    // line. Both brains were trained before collisions existed and they used to
    // ram each other in more than half of all fights; the shipped pair measures
    // 0.20 rams an episode, and the pirate destroys itself in 7.5% of them.
    const vEvader = rams(() => ({
      pirates: [{ kind: 'policy', brain: shipped }], trader: { kind: 'policy', brain: evader },
    }), 40);
    check(`shipped pirate vs a trader flying a policy rarely collides `
      + `(${vEvader.toFixed(2)}/episode)`, vEvader < 0.5);
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
    check('...valued at VALUE_PER_TONNE times its base price',
      d.value === COMMODITIES[10].basePrice * VALUE_PER_TONNE);
    // the toll and the assessment are one rule now: what dumping a tonne buys
    // is exactly what a pirate's scanner read it as
    const scanned = markOf(
      { cargo: (() => { const h = new Array(COMMODITIES.length).fill(0); h[10] = 1; return h; })(),
        kills: 0, equipment: { laser: 'pulse', largeBay: false } });
    check('...which is what the scanner said the tonne was worth',
      scanned.cargoValue === d.value);
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
    const pirate = (organised: boolean) => ({
      state: { alive: true, organised, satisfied: false },
    });
    const gang = [pirate(false), pirate(false), pirate(true)];
    const arrival = 10_000;

    const tooLittle = offerBribe(gang, 100, arrival);
    check('a token handful buys nobody off',
      tooLittle.bought === 0 && tooLittle.stillWant !== null);
    check('...and it tells you the SMALLEST top-up that would work',
      tooLittle.stillWant === appetiteOf(false, arrival) - 100);

    const enough = offerBribe(gang, appetiteOf(false, arrival), arrival);
    check('paying the opportunist price peels off the opportunists',
      enough.bought === 2 && gang[0].state.satisfied && gang[1].state.satisfied);
    check('...but the gang leader is still coming', !gang[2].state.satisfied);

    // the toll accumulates across dumps — a second handful finishes the job
    const rest = offerBribe(gang, appetiteOf(true, arrival), arrival);
    check('a second dump finishes what the first started',
      rest.bought === 1 && gang[2].state.satisfied && rest.stillWant === null);
    check('...and nobody is bought twice', offerBribe(gang, 1e9, arrival).bought === 0);
  }
  {
  const dead = [{ state: { alive: false, organised: false, satisfied: false } }];
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
    ({ role, state: {
      alive: true, inert: false, satisfied: false, provoked: false,
      provokedByPlayer: false, ...over,
    } }) as unknown as Parameters<typeof isHostileToPlayer>[0];

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
}
