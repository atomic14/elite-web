// Headless campaign simulator — the balance playtest.
//
//   npm run campaign            # 40 commanders, 60 legs each
//   npm run campaign -- 200 100 # 200 commanders, 100 legs each
//
// The browser playtest agent (test/playtest.js) proves the *game* works by
// flying it; this proves the *economy* works by playing it thousands of
// times. It runs the real modules — the actual galaxy generator, market
// model, living-galaxy simulation, contract generator and equipment
// catalogue — so its answers are about the shipped rules, not a model of
// them. Only flight is abstracted: combat and docking become probabilities
// derived from system danger and the commander's fit.
//
// Questions it answers: can a new commander make a living? how long to the
// first upgrade, to a fully-equipped ship, to Elite? does the living galaxy
// make routes matter? how lethal is lawless space?

import { generateGalaxy, generateMarket, COMMODITIES, type StarSystem } from '../src/galaxy/galaxy.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import { generateContractOffers, applyMarketPressure, chartDistanceTenths, MAX_CONTRACTS, settleContracts, marketEstimate } from '../src/game/contracts.ts';
import { pirateThreat, markOf, memberTier } from '../src/game/threat.ts';
import {
  newCommander, cargoCapacity, cargoTonnes, killValue, MAX_FUEL,
  type CommanderData, type Contract,
} from '../src/game/commander.ts';
import { rating, ratingLadder } from '../src/game/rating.ts';
import {
  EQUIPMENT_CATALOGUE, equipmentOwned, fuelNeeded, refuelCost,
} from '../src/game/shop.ts';
import { pirateSpecForTier } from '../src/game/ship-specs.ts';
import { MISSION_KILL_THRESHOLD } from '../src/game/missions.ts';
import { makeRng } from '../src/game/rng.ts';
import { daysForJump } from '../src/galaxy/navigation.ts';
import { isContraband } from '../src/game/law.ts';

const COMMANDERS = Number(process.argv[2] ?? 40);
const LEGS = Number(process.argv[3] ?? 60);
/**
 * How the commander plays. `trader` hauls cargo and fights when jumped;
 * `hunter` travels light, chooses lawless destinations and goes looking.
 * `both` runs a cohort of each and prints them side by side.
 */
const STRATEGY = (process.argv[4] ?? 'trader') as Strategy | 'both' | 'all';
/**
 * `trader`    hauls cargo, fights only when jumped.
 * `hunter`    flies light, picks lawless destinations, goes looking.
 * `privateer` trades until it can afford guns, then keeps trading — but now
 *             the cargo is *bait*: it makes you worth robbing, and you want
 *             to be robbed. The strategy the pirate economics actually reward.
 */
type Strategy = 'trader' | 'hunter' | 'privateer';
const GRADIENTS = COMMODITIES.map((c) => c.gradient);

/**
 * The military laser, from the shop's own row — the one gun that kills a
 * Constrictor in a reasonable time, and the whole of TODO 29's Navy-mission
 * question: can a commander plausibly have one by the time the Navy calls?
 *
 * Read from EQUIPMENT_CATALOGUE rather than written down, so a price change
 * moves this harness with it.
 */
const MILITARY = EQUIPMENT_CATALOGUE.find((e) => e.id === 'military')!;
const MILITARY_LASER_TL = MILITARY.minTL;

interface CareerResult {
  credits: number;
  day: number;
  legs: number;
  deaths: number;
  kills: number;
  combatScore: number;
  contractsDone: number;
  contractsFailed: number;
  cargoLost: number;
  equipment: string[];
  /** credits + what the fitted equipment cost — the honest wealth measure */
  netWorth: number;
  firstUpgradeLeg: number | null;
  bankruptAtLeg: number | null;
  peakCredits: number;
  /** price multipliers actually seen, to show the living galaxy at work */
  priceSpread: [number, number];
  dangerSeen: number;
  /** encounters seen at each threat tier, and how many were organised gangs */
  tierSeen: [number, number, number];
  gangs: number;
  /**
   * The same, split into the three thirds of the career — the EARLY, MIDDLE and
   * LATE threat bands.
   *
   * A career-long average hides the thing the tier ladder exists to produce.
   * "13% of receptions are gangs" is true and says nothing about whether a
   * commander meets one on her second leg or her fiftieth, and a change that
   * moved every gang to the first third would not move that number at all.
   * These three bands are what TODO 29 asserts against.
   */
  bands: BandTally[];
  /** mean "worth robbing" score across the career */
  appeal: number;
  /**
   * The Navy mission's signposting question (TODO 29): the leg her 16th kill
   * landed on, what she was worth then, whether she had already docked at a
   * TL10+ system, and whether she was carrying the only gun that kills a
   * Constrictor in a reasonable time.
   */
  missionLeg: number | null;
  creditsAtMission: number;
  tl10SeenByMission: boolean;
  militaryAtMission: boolean;
  /** first leg and day each combat rating was reached */
  milestones: { rank: string; leg: number; day: number }[];
}

/** One third of a career: what turned up, and what it cost. */
interface BandTally {
  receptions: number;
  tierSeen: [number, number, number];
  gangs: number;
  deaths: number;
  kills: number;
  cargoLost: number;
}

const freshBand = (): BandTally => ({
  receptions: 0, tierSeen: [0, 0, 0], gangs: 0, deaths: 0, kills: 0, cargoLost: 0,
});

/** Which third of the planned career this leg falls in: 0 early, 1 middle, 2 late. */
const bandOf = (leg: number, total: number): number =>
  Math.min(2, Math.floor((leg * 3) / Math.max(1, total)));

function runCareer(seed: number, systems: StarSystem[], strategy: Strategy = 'trader'): CareerResult {
  const rng = makeRng(seed);
  const living = new LivingGalaxy(systems);
  const c: CommanderData = newCommander();
  // give the galaxy a history before this commander launches
  living.advance(30, GRADIENTS, rng);

  let deaths = 0;
  let contractsDone = 0;
  let contractsFailed = 0;
  let cargoLost = 0;
  let firstUpgradeLeg: number | null = null;
  let bankruptAtLeg: number | null = null;
  let peakCredits = c.credits;
  let legs = 0;
  const tierSeen: [number, number, number] = [0, 0, 0];
  const bands: BandTally[] = [freshBand(), freshBand(), freshBand()];
  let gangs = 0;
  let appealSum = 0;
  let appealCount = 0;
  const milestones: { rank: string; leg: number; day: number }[] = [];
  let missionLeg: number | null = null;
  let creditsAtMission = 0;
  let tl10Seen = false;
  let tl10SeenAtMission = false;
  let militaryAtMission = false;
  let lastRank = rating(0);
  let minMult = 1;
  let maxMult = 1;
  let dangerSum = 0;

  for (let leg = 0; leg < LEGS; leg++) {
    const here = systems[c.systemIndex];
    // A privateer serves its apprenticeship as a trader: you cannot pick
    // fights with a pulse laser. Once it has a real gun it flips to hunting,
    // but keeps buying cargo — which is now bait rather than income.
    const armed = c.equipment.laser === 'military' || c.equipment.laser === 'beam';
    const hunts = strategy === 'hunter' || (strategy === 'privateer' && armed);
    const carriesCargo = strategy !== 'hunter';
    const market = applyMarketPressure(
      generateMarket(here, Math.floor(rng() * 256)),
      (i) => {
        const m = living.priceMultiplier(c.systemIndex, i);
        minMult = Math.min(minMult, m);
        maxMult = Math.max(maxMult, m);
        return m;
      });
    dangerSum += living.danger(c.systemIndex);

    // --- settle contracts due here ---
    //
    // The GAME's rule, not a transcription of it. This was a hand-written
    // filter that resembled game.ts's settleContracts and drifted from it in
    // the details — which is the whole failure mode invariant 10 exists to stop,
    // in the very harness that is supposed to be checking the shipped balance.
    for (const e of settleContracts(c)) {
      if (e.kind === 'paid') contractsDone += 1;
      else contractsFailed += 1;   // expired, or the consignment was not aboard
    }

    // --- sell everything not promised to a contract ---
    const committed = new Map<number, number>();
    for (const k of c.contracts) {
      if (k.kind === 'cargo') committed.set(k.commodity, (committed.get(k.commodity) ?? 0) + k.qty);
    }
    for (let i = 0; i < COMMODITIES.length; i++) {
      const keep = committed.get(i) ?? 0;
      let sold = 0;
      let revenue = 0;
      while (c.cargo[i] > keep) {
        c.cargo[i] -= 1;
        revenue += Math.round(market[i].price * 10);
        sold += 1;
      }
      c.credits += revenue;
      if (sold > 0) {
        // same rule as game.ts sellCargo: word gets around
        const contraband = isContraband(i);
        living.addNotoriety(c.systemIndex,
          Math.min(0.5, revenue / 40_000 + (contraband ? sold * 0.04 : 0)));
      }
    }

    if (here.techLevel >= MILITARY_LASER_TL) tl10Seen = true;

    // --- refuel ---
    const need = fuelNeeded(c);
    if (need > 0) {
      const cost = refuelCost(c);
      if (c.credits >= cost) { c.credits -= cost; c.fuel = MAX_FUEL; }
    }

    // --- equip, keeping a trading float ---
    // A hunter's shopping list is not a trader's: guns and survivability
    // first, and it needs a far smaller float because it isn't buying cargo.
    // Order matters more now that an unaffordable item means saving rather
    // than skipping: put the 6,000 Cr military laser second and a hunter buys
    // nothing else until it has one. Cheap survivability first, the expensive
    // gun once it is actually reachable. (The price is 60,000 TENTHS — money is
    // tenths of a credit everywhere in this project, docs/INVARIANTS.md invariant 8.)
    const COMBAT_KIT = ['beam', 'ecm', 'energyUnit', 'escapePod',
      'combatComputer', 'military', 'missile'];
    // A trader needs a list too. Without one it shopped in EQUIPMENT_CATALOGUE
    // order, which is roughly tech-level order and not usefulness order, and
    // the result was daft: 100% of traders finished a career owning a rear
    // laser, 95% a left and 85% a right, while only 30% ever bought a beam.
    // That is 12,000 credits on three auxiliary pulse lasers, of which the
    // model credits exactly one at +0.05, ahead of a 10,000 credit beam laser
    // worth +0.18. Nobody would play that way, so the simulated economy was
    // being judged on purchases no real commander makes.
    //
    // Hold first (it pays for everything else), then the gun, then the things
    // that stop you dying. Auxiliary lasers come after the kit that works.
    const TRADE_KIT = ['largeBay', 'beam', 'ecm', 'scoops', 'escapePod',
      'energyUnit', 'dockingComputer', 'military'];
    // Never bought. A rear or side laser only fires while you are looking that
    // way, so using one means fighting a dogfight backwards, and Chris's read
    // is that real players do not. The station still sells them; this models
    // the commander who does not buy them, which is nearly all of them.
    const SKIP = ['rearLaser', 'leftLaser', 'rightLaser'];
    const order = strategy !== 'trader' ? COMBAT_KIT : TRADE_KIT;
    const priority = (id: string): number => {
      const i = order.indexOf(id);
      if (i >= 0) return i;
      return 100;
    };
    const shoppingList = [...EQUIPMENT_CATALOGUE]
      .sort((a, b) => priority(a.id) - priority(b.id));
    const float = strategy === 'hunter' ? 300 : 1500; // privateers still need a trading float
    for (const item of shoppingList) {
      if (item.id === 'trumble') continue; // a trap, not an upgrade
      if (SKIP.includes(item.id)) continue; // see SKIP: nobody flies backwards
      if (equipmentOwned(item.id, c)) continue;
      if (here.techLevel + 1 < item.minTL) continue; // not sold here, try elsewhere
      if (c.credits - item.price < float) {
        // SAVE for it, do not drop down to something cheaper. Skipping ahead is
        // why the priority list did nothing on its own: an unaffordable 10,000
        // credit beam laser was passed over and the 4,000 credit rear laser
        // bought in its place, every single time, until every trader owned
        // three auxiliary lasers and a third of them owned a beam.
        //
        // Only for items on the curated list. Anything off it stays
        // opportunistic, so a commander who already owns the kit that matters
        // can still spend spare cash on the rest.
        if (priority(item.id) < 100) break;
        continue;
      }
      c.credits -= item.price;
      applyEquipment(c, item.id);
      if (firstUpgradeLeg === null && item.id !== 'missile') firstUpgradeLeg = leg;
    }

    // --- take work ---
    const offers = generateContractOffers(here, systems, c.day, rng);
    // a commander takes work heading one way, not three jobs to three
    // corners of the chart — so prefer offers near those already held
    const anchor = c.contracts[0] ? systems[c.contracts[0].destination] : null;
    const sorted = [...offers].sort((a, b) => {
      const da = anchor ? chartDistanceTenths(anchor, systems[a.destination]) : 0;
      const db = anchor ? chartDistanceTenths(anchor, systems[b.destination]) : 0;
      return da - db;
    });
    for (const k of sorted) {
      if (c.contracts.length >= MAX_CONTRACTS) break;
      // a hunter takes bounty work and leaves the freight to traders
      if (strategy === 'hunter' && k.kind !== 'bounty') continue;
      // ONE BOUNTY JOB AT A TIME, and this is the bot's policy rather than a
      // rule of the game. A cargo or courier run is settled by ARRIVING, so
      // three of them to three nearby systems are three jobs a commander can
      // genuinely service on one circuit. A bounty is not: `settleContracts`
      // only counts kills made in the job's OWN destination system, so holding
      // a second one means a second deadline running down in a system the ship
      // is not in. Taking three meant two of them could not be worked at all.
      //
      // Measured on 20 commanders x 60 legs, cohort `hunter`: 5.5 completed
      // against 9.4 failed. All 188 expirations were bounty jobs — 29 whose
      // destination was never reached at all, 134 reached but still short of
      // the count when the deadline passed, and 25 that filled the count only
      // after it had. With one job at a time it is 6.0 completed to 2.5 failed,
      // and the trader and privateer cohorts move by less than a job either
      // way. Nothing in `game/contracts.ts` changed; this is the simulated
      // commander no longer accepting work she has no way to do.
      if (k.kind === 'bounty' && c.contracts.some((h) => h.kind === 'bounty')) continue;
      // a privateer takes anything: freight pays, and it doubles as bait
      const reach = chartDistanceTenths(here, systems[k.destination]);
      if (reach > MAX_FUEL) continue; // could never get there
      if (anchor && chartDistanceTenths(anchor, systems[k.destination]) > 50) continue;
      if (k.kind === 'cargo' && cargoTonnes(c) + k.qty > cargoCapacity(c)) continue;
      if (k.kind === 'cargo') c.cargo[k.commodity] += k.qty;
      c.contracts.push(k);
    }

    // --- choose a destination: a contract, else the best trade ---
    const dest = pickDestination(c, systems, market, rng, hunts ? 'hunter' : 'trader', living);
    if (dest === null) break;
    const destSys = systems[dest];

    // --- buy cargo for it ---
    // The hunter flies light. Note the irony this creates under the pirate
    // economics: an empty hold makes it a *poor* target, so its fights have
    // to come from lawless space rather than from looking worth robbing.
    if (carriesCargo) buyBestCargo(c, market, destSys, living);

    // --- fly the leg ---
    const dist = chartDistanceTenths(here, destSys);
    if (dist > c.fuel) break; // shouldn't happen; pickDestination respects range
    c.fuel -= dist;
    const days = daysForJump(dist);
    c.day += days;
    living.advance(days, GRADIENTS, rng);
    c.systemIndex = dest;
    legs += 1;

    // --- what happens on the way in ---
    const danger = living.danger(dest);
    const threat = pirateThreat(destSys, danger, markOf(c, living.notoriety(dest)), rng);
    const band = bands[bandOf(legs - 1, LEGS)];
    tierSeen[threat.tier] += 1;
    band.tierSeen[threat.tier] += 1;
    band.receptions += 1;
    if (threat.organised) gangs += 1;
    if (threat.organised) band.gangs += 1;
    appealSum += threat.appeal;
    appealCount += 1;
    const pirates = threat.count;
    for (let p = 0; p < pirates; p++) {
      const mt = memberTier(threat.tier, p);
      const outcome = resolveEncounter(c, rng, mt, hunts ? 'hunter' : 'trader');
      if (outcome === 'escaped') continue;
      if (outcome === 'dead') {
        deaths += 1;
        band.deaths += 1;
        // Dying costs you the cargo and the work in hand. It does NOT cost
        // credits: `Game.die()` has no such line, and this file used to take
        // 40% of them "the original's rule". Inventing a tax the game does
        // not levy makes every wealth curve here a different game's.
        c.cargo = c.cargo.map(() => 0);
        c.contracts = [];
        c.fuel = MAX_FUEL;
        break;
      }
      if (outcome === 'robbed') {
        const carried = c.cargo.map((q, i) => ({ q, i })).filter((x) => x.q > 0);
        if (carried.length) {
          const pick = carried[Math.floor(rng() * carried.length)];
          const taken = Math.min(pick.q, 1 + Math.floor(rng() * 3));
          c.cargo[pick.i] -= taken;
          cargoLost += taken;
          band.cargoLost += taken;
        }
      }
      if (outcome === 'killed-them') {
        c.kills += 1;
        band.kills += 1;
        c.combatScore += killValue(mt);
        // The bounty the GAME pays, from the hull that actually spawns.
        // This was `(50 + rng()*60) * (tier2 ? 4 : tier1 ? 2 : 1)` — an
        // invented range paying 1.6x to 2.2x the real tables, as direct income
        // inside the harness that certifies the economy.
        c.credits += pirateSpecForTier(mt, leg + c.kills).bounty;
        for (const k of c.contracts) {
          if (k.kind === 'bounty' && k.destination === c.systemIndex) k.progress += 1;
        }
      }
    }

    if (missionLeg === null && c.kills >= MISSION_KILL_THRESHOLD) {
      missionLeg = leg + 1;
      creditsAtMission = c.credits;
      tl10SeenAtMission = tl10Seen;
      militaryAtMission = c.equipment.laser === 'military';
    }

    const rank = rating(c.combatScore);
    if (rank !== lastRank) {
      milestones.push({ rank, leg: leg + 1, day: c.day });
      lastRank = rank;
    }

    peakCredits = Math.max(peakCredits, c.credits);
    if (c.credits < 20 && cargoTonnes(c) === 0 && bankruptAtLeg === null) bankruptAtLeg = leg;
  }

  const kitValue = EQUIPMENT_CATALOGUE
    .filter((e) => e.id !== 'missile' && e.id !== 'trumble' && equipmentOwned(e.id, c))
    .reduce((sum, e) => sum + e.price, 0);

  return {
    credits: c.credits,
    netWorth: c.credits + kitValue,
    priceSpread: [minMult, maxMult],
    dangerSeen: dangerSum / Math.max(1, legs),
    tierSeen,
    bands,
    gangs,
    missionLeg,
    creditsAtMission,
    tl10SeenByMission: tl10SeenAtMission,
    militaryAtMission,
    appeal: appealSum / Math.max(1, appealCount),
    milestones,
    day: c.day,
    legs,
    deaths,
    kills: c.kills,
    combatScore: c.combatScore,
    contractsDone,
    contractsFailed,
    cargoLost,
    equipment: EQUIPMENT_CATALOGUE
      .filter((e) => e.id !== 'missile' && e.id !== 'trumble' && equipmentOwned(e.id, c))
      .map((e) => e.id),
    firstUpgradeLeg,
    bankruptAtLeg,
    peakCredits,
  };
}

function applyEquipment(c: CommanderData, id: string): void {
  const e = c.equipment;
  switch (id) {
    case 'missile': c.missiles = Math.min(4, c.missiles + 1); break;
    case 'largeBay': e.largeBay = true; break;
    case 'ecm': e.ecm = true; break;
    case 'rearLaser': e.rearLaser = true; break;
    case 'leftLaser': e.leftLaser = true; break;
    case 'rightLaser': e.rightLaser = true; break;
    case 'beam': c.credits += 4000; e.laser = 'beam'; break;
    case 'military': c.credits += e.laser === 'beam' ? 10000 : 4000; e.laser = 'military'; break;
    case 'scoops': e.scoops = true; break;
    case 'escapePod': e.escapePod = true; break;
    case 'energyBomb': e.energyBomb = true; break;
    case 'energyUnit': e.energyUnit = true; break;
    case 'dockingComputer': e.dockingComputer = true; break;
    case 'miningLaser': e.miningLaser = true; break;
    case 'combatComputer': e.combatComputer = true; break;
    case 'galacticDrive': e.galacticDrive = true; break;
  }
}

/**
 * A pirate contact, resolved as probabilities from the commander's fit.
 *
 * Calibrated against the browser playtest agent's observed behaviour: most
 * contacts end with the pirate left behind (the torus drive and the trained
 * defence policy make disengaging easy), a minority become real fights, and
 * death is rare for anyone who keeps flying toward the station.
 */
function resolveEncounter(
  c: CommanderData,
  rng: () => number,
  tier = 1,
  strategy: 'trader' | 'hunter' = 'trader',
): 'escaped' | 'won' | 'killed-them' | 'robbed' | 'dead' {
  // Most contacts simply don't become fights — but a gang that organised for
  // you is much harder to leave behind than an opportunist in a Sidewinder.
  //
  // Tuned so the *average* danger matches the pre-tier baseline (0.55
  // disengage, 0.45 strength) and only its distribution changes. Making tier 0
  // markedly safer without this drops deaths per career from 1.4 to 0.3: since
  // most commanders stay modest, softening the common case softens the whole
  // game, which is the opposite of the intent.
  const disengage = tier === 0 ? 0.60 : tier === 1 ? 0.50 : 0.32;
  // A hunter is here for this. It closes instead of running for the station —
  // which is most of why its kill rate differs from a trader's.
  if (strategy !== 'hunter' && rng() < disengage) return 'escaped';
  if (strategy === 'hunter' && rng() < disengage * 0.15) return 'escaped';

  // better hulls, better shooting: tier shifts the odds against you
  let strength = 0.48 - tier * 0.09;
  if (c.equipment.laser === 'beam') strength += 0.18;
  if (c.equipment.laser === 'military') strength += 0.3;
  // Rear and side lasers are NOT counted. They only fire while you are looking
  // that way (views 1-3), so using one means flying a dogfight backwards, and
  // in practice almost nobody does. Crediting a rear laser as passive combat
  // strength modelled a player who does not exist.
  if (c.equipment.ecm) strength += 0.05;
  if (c.equipment.energyUnit) strength += 0.08;
  if (c.equipment.combatComputer) strength += 0.2;
  if (c.missiles > 0) strength += 0.05;
  strength = Math.min(0.95, strength);

  const roll = rng();
  if (roll < strength) return rng() < (strategy === 'hunter' ? 0.9 : 0.6) ? 'killed-them' : 'won';
  if (roll < strength + 0.35) return 'robbed';
  // an escape pod turns a death into a survivable disaster
  if (c.equipment.escapePod && rng() < 0.7) {
    c.equipment.escapePod = false;
    return 'robbed';
  }
  return rng() < 0.3 ? 'dead' : 'robbed';
}

function pickDestination(
  c: CommanderData,
  systems: StarSystem[],
  market: ReturnType<typeof generateMarket>,
  rng: () => number,
  strategy: 'trader' | 'hunter',
  living: LivingGalaxy,
): number | null {
  const here = systems[c.systemIndex];
  const contract = c.contracts.find((k: Contract) =>
    chartDistanceTenths(here, systems[k.destination]) <= c.fuel);
  if (contract) return contract.destination;

  if (strategy === 'hunter') {
    // go where the pirates are: lawlessness first, then whatever reputation
    // for piracy the living galaxy has actually recorded
    let bestSys: number | null = null;
    let bestScore = -Infinity;
    for (const s of systems) {
      const d = chartDistanceTenths(here, s);
      if (s.index === c.systemIndex || d === 0 || d > c.fuel) continue;
      const score = ((7 - s.government) + living.danger(s.index) * 6) * (0.8 + rng() * 0.4);
      if (score > bestScore) { bestScore = score; bestSys = s.index; }
    }
    return bestSys;
  }

  // otherwise: the reachable system with the best expected trade margin
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const s of systems) {
    const d = chartDistanceTenths(here, s);
    if (s.index === c.systemIndex || d === 0 || d > c.fuel) continue;
    let score = 0;
    const expect = expectedPrices(s, living);
    for (let i = 0; i < COMMODITIES.length; i++) {
      if (isContraband(i) || COMMODITIES[i].unit !== 't') continue;
      score = Math.max(score, expect[i] - market[i].price);
    }
    score *= 0.8 + rng() * 0.4;
    if (score > bestScore) { bestScore = score; best = s.index; }
  }
  return best;
}

/**
 * What `sys` is expected to pay, per commodity — the game's own estimate, the
 * function behind the chart's MARKET ESTIMATE panel.
 *
 * It was a transcription of the 1984 price formula, so this harness scored
 * every trade decision against an economy the game does not run: no byte wrap
 * where the model has one, and no living-galaxy pressure at the far end. That
 * is precisely what invariant 10 exists to stop, in the harness whose whole
 * job is to check the shipped balance.
 */
function expectedPrices(sys: StarSystem, living: LivingGalaxy): number[] {
  return marketEstimate(sys, (i) => living.priceMultiplier(sys.index, i))
    .map((m) => m.price);
}

function buyBestCargo(
  c: CommanderData,
  market: ReturnType<typeof generateMarket>,
  dest: StarSystem,
  living: LivingGalaxy,
): void {
  let best = -1;
  let bestScore = 0.5;
  const expect = expectedPrices(dest, living);
  for (let i = 0; i < COMMODITIES.length; i++) {
    if (isContraband(i) || COMMODITIES[i].unit !== 't' || market[i].quantity <= 0) continue;
    const margin = expect[i] - market[i].price;
    const cost = Math.round(market[i].price * 10);
    if (cost <= 0) continue;
    const units = Math.min(market[i].quantity, Math.floor(c.credits / cost),
      cargoCapacity(c) - cargoTonnes(c));
    if (units > 0 && units * margin > bestScore) { bestScore = units * margin; best = i; }
  }
  if (best < 0) return;
  const cost = Math.round(market[best].price * 10);
  while (market[best].quantity > 0 && cargoTonnes(c) < cargoCapacity(c) && c.credits >= cost) {
    market[best].quantity -= 1;
    c.cargo[best] += 1;
    c.credits -= cost;
  }
}

// --- run the fleet ----------------------------------------------------------

const systems = generateGalaxy(1);
const started = Date.now();

/** One cohort of commanders, all playing the same way, on the same seeds. */
function runFleet(strategy: Strategy): CareerResult[] {
  const out: CareerResult[] = [];
  for (let i = 0; i < COMMANDERS; i++) {
    out.push(runCareer(1000 + i * 7919, systems, strategy));
  }
  return out;
}

const num = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const cr = (tenths: number) => (tenths / 10).toFixed(1);

let failures = 0;

/** Print one cohort's report and run the balance assertions over it. */
function report(label: string, careers: CareerResult[], strategy: Strategy): void {
  console.log(`\n=== ${label}: ${COMMANDERS} commanders × ${LEGS} legs ===`);
  console.log(`(real galaxy, market, living-galaxy and contract code; flight abstracted)\n`);

  const credits = careers.map((r) => r.credits);
  const survivors = careers.filter((r) => r.bankruptAtLeg === null);
  const worth = careers.map((r) => r.netWorth);
  console.log(`WEALTH   median net worth ${cr(median(worth))} Cr (cash + fitted kit), ` +
    `from a 100.0 Cr start`);
  console.log(`         cash in hand: median ${cr(median(credits))} Cr · ` +
    `peak during career ${cr(median(careers.map((r) => r.peakCredits)))} Cr · ` +
    `best career ${cr(Math.max(...worth))} Cr`);
  console.log(`SURVIVAL ${survivors.length}/${COMMANDERS} never went broke · ` +
    `${num(careers.map((r) => r.deaths)).toFixed(1)} deaths per career`);
  console.log(`PACE     median day ${median(careers.map((r) => r.day))} after ${LEGS} legs · ` +
    `first upgrade at leg ${median(careers.filter((r) => r.firstUpgradeLeg !== null)
      .map((r) => r.firstUpgradeLeg!))}`);
  console.log(`CONTRACT ${num(careers.map((r) => r.contractsDone)).toFixed(1)} completed · ` +
    `${num(careers.map((r) => r.contractsFailed)).toFixed(1)} failed per career`);
  console.log(`COMBAT   ${num(careers.map((r) => r.kills)).toFixed(1)} kills · ` +
    `${num(careers.map((r) => r.cargoLost)).toFixed(1)}t cargo lost to pirates per career`);
  console.log(`RATING   median ${rating(Math.round(median(careers.map((r) => r.combatScore))))}`);

  // equipment progression
  const kitCounts = new Map<string, number>();
  for (const r of careers) for (const e of r.equipment) kitCounts.set(e, (kitCounts.get(e) ?? 0) + 1);
  const kit = [...kitCounts.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${Math.round((100 * n) / COMMANDERS)}%`);
  console.log(`EQUIPMENT owned by end of career: ${kit.join(' · ') || 'none'}`);
  const lo = Math.min(...careers.map((r) => r.priceSpread[0]));
  const hi = Math.max(...careers.map((r) => r.priceSpread[1]));
  console.log(`GALAXY   living prices ranged ${lo.toFixed(2)}x..${hi.toFixed(2)}x baseline · ` +
    `mean system danger ${num(careers.map((r) => r.dangerSeen)).toFixed(3)}`);
  const tiers = [0, 1, 2].map((t) => careers.reduce((a, r) => a + r.tierSeen[t], 0));
  const tierTotal = tiers.reduce((a, b) => a + b, 0) || 1;
  console.log(`PIRATES  reception by tier: opportunists ${Math.round(100 * tiers[0] / tierTotal)}% · ` +
    `professionals ${Math.round(100 * tiers[1] / tierTotal)}% · ` +
    `gangs ${Math.round(100 * tiers[2] / tierTotal)}% · ` +
    `${(careers.reduce((a, r) => a + r.gangs, 0) / COMMANDERS).toFixed(1)} organised per career · ` +
    `mean appeal ${num(careers.map((r) => r.appeal)).toFixed(2)}`);

  // the combat ladder: how long does each rank actually take?
  {
    // from commander.ts's own ladder, less HARMLESS, which every commander
    // starts at and therefore never "reaches"
    const ranks = ratingLadder().slice(1);
    const rows = ranks.map((rank) => {
      const hits = careers
        .map((r) => r.milestones.find((m) => m.rank === rank))
        .filter((m): m is { rank: string; leg: number; day: number } => !!m);
      return { rank, reached: hits.length, legs: num(hits.map((h) => h.leg)), day: num(hits.map((h) => h.day)) };
    }).filter((r) => r.reached > 0);
    if (rows.length) {
      console.log('LADDER   median legs / in-game years to each combat rating:');
      for (const r of rows) {
        console.log(`         ${r.rank.padEnd(16)} ${String(Math.round(r.legs)).padStart(6)} legs · ` +
          `${(r.day / 365).toFixed(1).padStart(6)} yr` +
          (r.reached < careers.length ? `  (${r.reached}/${careers.length} commanders)` : ''));
      }
    }
  }

  // does the threat actually track wealth, or is it just noise?
  {
    const sorted = [...careers].sort((a, b) => a.netWorth - b.netWorth);
    const half = Math.floor(sorted.length / 2);
    const poor = sorted.slice(0, half);
    const rich = sorted.slice(-half);
    const gangRate = (rs: typeof careers) => rs.reduce((a, r) => a + r.gangs, 0) / rs.length;
    const upperTier = (rs: typeof careers) => {
      const t = rs.reduce((a, r) => [a[0] + r.tierSeen[0], a[1] + r.tierSeen[1], a[2] + r.tierSeen[2]], [0, 0, 0]);
      const tot = t[0] + t[1] + t[2] || 1;
      return (100 * (t[1] + t[2])) / tot;
    };
    console.log(`SCALING  poorer half: appeal ${num(poor.map((r) => r.appeal)).toFixed(2)} · ` +
      `${upperTier(poor).toFixed(0)}% tier1+ · ${gangRate(poor).toFixed(1)} gangs/career`);
    console.log(`         richer half: appeal ${num(rich.map((r) => r.appeal)).toFixed(2)} · ` +
      `${upperTier(rich).toFixed(0)}% tier1+ · ${gangRate(rich).toFixed(1)} gangs/career`);
  }

  // --- the three combat threat bands ----------------------------------------
  //
  // TODO 29: a career-long tier average cannot tell an escalating game from one
  // that throws gangs at a fresh commander. These are the same receptions split
  // into thirds of the career.
  const band = (i: number): BandTally => careers.reduce((a, r) => ({
    receptions: a.receptions + r.bands[i].receptions,
    tierSeen: [
      a.tierSeen[0] + r.bands[i].tierSeen[0],
      a.tierSeen[1] + r.bands[i].tierSeen[1],
      a.tierSeen[2] + r.bands[i].tierSeen[2],
    ],
    gangs: a.gangs + r.bands[i].gangs,
    deaths: a.deaths + r.bands[i].deaths,
    kills: a.kills + r.bands[i].kills,
    cargoLost: a.cargoLost + r.bands[i].cargoLost,
  }), freshBand());
  const BAND_NAMES = ['early', 'middle', 'late'];
  const bandRows = [0, 1, 2].map(band);
  const upper = (b: BandTally): number =>
    (100 * (b.tierSeen[1] + b.tierSeen[2])) / Math.max(1, b.receptions);
  console.log('THREAT   by third of a career (early / middle / late):');
  for (const [i, b] of bandRows.entries()) {
    console.log(`         ${BAND_NAMES[i].padEnd(7)} ${b.receptions} receptions · `
      + `tier mix ${b.tierSeen.map((t) => Math.round((100 * t) / Math.max(1, b.receptions)) + '%').join('/')} · `
      + `${upper(b).toFixed(0)}% tier1+ · ${b.gangs} gangs · `
      + `${(b.deaths / COMMANDERS).toFixed(2)} deaths · ${(b.kills / COMMANDERS).toFixed(1)} kills · `
      + `${(b.cargoLost / COMMANDERS).toFixed(1)}t lost`);
  }

  // --- the Navy mission's signposting question -------------------------------
  //
  // TODO 29: the Constrictor's source-exact armour makes a BEAM laser worth
  // exactly nothing against it, and only a military laser kills it in a
  // reasonable time. That is not a balance bug to be tuned away — it is the
  // released rule, and the same one the original had. What it needs is for the
  // job to be reachable: a commander must be able to have the gun by the time
  // the Navy calls, and to be told what the job wants.
  const briefed = careers.filter((r) => r.missionLeg !== null);
  if (briefed.length) {
    const canAfford = briefed.filter((r) => r.creditsAtMission >= MILITARY.price);
    const sawTl = briefed.filter((r) => r.tl10SeenByMission);
    console.log(`NAVY     ${briefed.length}/${COMMANDERS} reached ${MISSION_KILL_THRESHOLD} kills`
      + ` (median leg ${median(briefed.map((r) => r.missionLeg!))})`
      + ` · median cash then ${cr(median(briefed.map((r) => r.creditsAtMission)))} Cr`
      + ` vs a ${cr(MILITARY.price)} Cr military laser at TL${MILITARY_LASER_TL}+`);
    console.log(`         ${Math.round((100 * canAfford.length) / briefed.length)}%`
      + ` could pay for one outright · `
      + `${Math.round((100 * sawTl.length) / briefed.length)}% had already docked somewhere`
      + ` that sells it · ${Math.round((100 * briefed.filter((r) => r.militaryAtMission).length) / briefed.length)}%`
      + ' were already carrying one');
  }

  // sanity assertions — this doubles as a regression test.
  //
  // NO `let failures` HERE. There is one at module scope, and the exit code is
  // read from it; re-declaring it locally shadowed the counter, so every FAIL
  // printed its line and then the script announced "all balance checks passed"
  // and exited 0. CI's economy gate — eight assertions covering the wealth
  // floor, bankruptcy rate, deaths per career and runaway wealth — was
  // advisory-only for as long as this had been here.
  const assert = (name: string, ok: boolean, detail = '') => {
    if (!ok) { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('');
  // A hunter funds itself on bounties, not margins — it is expected to be much
  // poorer than a trader. Floors are in tenths: 150 Cr is a "not starving" bar.
  const wealthFloor = strategy === 'hunter' ? 1500 : 5000;
  const upgradeBy = strategy === 'hunter' ? 60 : 20;
  assert('a typical commander ends up much richer than they started',
    median(worth) > wealthFloor, `median net worth ${cr(median(worth))} Cr vs 100.0 start`);
  assert('most commanders avoid bankruptcy', survivors.length >= COMMANDERS * 0.6,
    `${survivors.length}/${COMMANDERS}`);
  // hunters buy guns, which cost more than a trader's first cargo bay
  assert(`the first upgrade arrives within ${upgradeBy} legs`,
    median(careers.filter((r) => r.firstUpgradeLeg !== null).map((r) => r.firstUpgradeLeg!))
      <= upgradeBy);
  assert('most contracts are completed rather than failed',
    num(careers.map((r) => r.contractsDone)) > num(careers.map((r) => r.contractsFailed)));
  // Deaths per career DO NOT SCALE WITH LEGS, so the bound must not either.
  //
  // It was `< LEGS * 0.25`: 15 at the default 60 legs against a measured 0.9,
  // and 11,250 on a 45,000-leg run — a number no economy could ever reach, on
  // the assertion that is supposed to notice piracy turning lethal. Measured
  // instead, the figure saturates early and then flattens, because a
  // commander who survives the first few legs is a commander who has bought
  // shields:
  //
  //   trader     0.9 (60 legs) · 1.0 (300) · 1.0 (1000) · 0.8 (45,000)
  //   privateer  0.4 (60)      · 0.6 (300) · 0.6 (1000) · 0.8 (45,000)
  //   hunter     2.5 (60)      · 5.4 (300) · 5.5 (1000) · 4.8 (45,000)
  //
  // A hunter goes looking for fights and dies about five times a career; the
  // other two die about once, whatever the length. Bounds are fixed and
  // strategy-aware, at roughly 1.7x and 3x the worst measured value — tight
  // enough that doubling anyone's lethality fails here.
  const deathCeiling = strategy === 'hunter' ? 9 : 3;
  assert('piracy costs cargo without ending most careers',
    num(careers.map((r) => r.deaths)) < deathCeiling,
    `${num(careers.map((r) => r.deaths)).toFixed(1)} deaths per career, ceiling ${deathCeiling}`);
  // Runaway wealth, per leg rather than per career.
  //
  // Was 5,000,000 Cr at 60 legs against a measured best of 17,300 — 281x
  // headroom, which is not a bound, it is a formality. What the number
  // actually does is grow with the length of the run, at 300-400 Cr of net
  // worth per leg for the best career in a cohort:
  //
  //   60 legs 17,673 Cr (294/leg) · 300 legs 106,502 (355) ·
  //   1,000 legs 399,006 (399)    · 45,000 legs 16,721,676 (372)
  //
  // 2,000 Cr per leg — 20,000 tenths — is therefore about 5x the worst
  // measured value at every run length tested, and 40x tighter than what it
  // replaces. The floor keeps a very short run from being judged on its
  // start-up bonus. Still the same job: catch runaway/exponential wealth
  // bugs, not long careers.
  const wealthCeiling = 20_000 * Math.max(60, LEGS);
  assert('nobody accumulates absurd wealth',
    Math.max(...worth) < wealthCeiling,
    `best ${cr(Math.max(...worth))} Cr over ${LEGS} legs, ceiling ${cr(wealthCeiling)} Cr`);
  assert('credits never go negative', credits.every((x) => x >= 0));

  // The Navy mission is reachable, and it is a reachability check rather than a
  // purchasing one: the campaign bot's shopping list is not a person's, and it
  // is the bot the 3%-buy-a-military-laser figure describes. What has to hold is
  // that the OPTION is there — a shipyard that sells the gun, within reach, by
  // the time the briefing arrives.
  if (briefed.length) {
    assert('most commanders have docked where the military laser is sold by then',
      briefed.filter((r) => r.tl10SeenByMission).length >= briefed.length * 0.5,
      `${briefed.filter((r) => r.tl10SeenByMission).length}/${briefed.length}`);
  }

  // --- and the bands are covered, and in the right order ---------------------
  //
  // Every one of these would have passed silently on a career average. They are
  // the acceptance criterion TODO 29 names: "campaign checks cover early,
  // middle and late combat threat bands".
  assert('every third of a career actually sees combat',
    bandRows.every((b) => b.receptions > 0),
    bandRows.map((b, i) => `${BAND_NAMES[i]} ${b.receptions}`).join(', '));
  // A BOUNTY HUNTER IS EXEMPT FROM THE NEXT THREE, and that exemption is the
  // tier rule working rather than a hole in it. `pirateThreat` reads what a
  // pirate can SEE — cargo, hold, laser, reputation — and a hunter flies empty
  // on purpose, so it looks worthless and meets nothing but opportunists (0.00
  // appeal, 100% tier 0 across every band). Asserting escalation for a cohort
  // that has deliberately made itself a poor target would be asserting that the
  // deterrence lever does not work.
  if (strategy !== 'hunter') {
    assert('all three threat tiers are exercised somewhere in a career',
      [0, 1, 2].every((t) => bandRows.reduce((a, b) => a + b.tierSeen[t], 0) > 0));
    // The ladder's whole point: a new commander meets opportunists, and the
    // professionals and gangs arrive once she is worth the trouble.
    assert('threat escalates from the early band to the late one',
      upper(bandRows[2]) > upper(bandRows[0]),
      `early ${upper(bandRows[0]).toFixed(0)}% tier1+ · late ${upper(bandRows[2]).toFixed(0)}%`);
    assert('the late band is where the organised gangs are',
      bandRows[2].gangs >= bandRows[0].gangs,
      `early ${bandRows[0].gangs} · late ${bandRows[2].gangs}`);
  } else {
    assert('a hunter who flies empty is only ever worth an opportunist\'s time',
      upper(bandRows[2]) < 10,
      `${upper(bandRows[2]).toFixed(1)}% tier1+ in the late band`);
  }
  // ...and the escalation must not outrun the upgrades. The late band throws
  // twice the tier-1+ receptions and six times the gangs at her, so if the
  // ladder is working she is nonetheless SAFER by then, not more at risk.
  // Measured on a 40x60 trader run: 17 deaths early, 16 middle, 0 late.
  assert('a commander who has upgraded is safer, despite the harder receptions',
    bandRows[2].deaths <= bandRows[0].deaths,
    `early ${bandRows[0].deaths} deaths · late ${bandRows[2].deaths}, `
    + `on ${upper(bandRows[0]).toFixed(0)}% vs ${upper(bandRows[2]).toFixed(0)}% tier1+`);
  assert('the living galaxy actually moves prices', hi - lo > 0.05, `${lo.toFixed(2)}..${hi.toFixed(2)}`);

}

const COHORTS: [string, Strategy][] = [
  ['TRADER', 'trader'], ['BOUNTY HUNTER', 'hunter'], ['PRIVATEER', 'privateer'],
];
if (STRATEGY === 'both' || STRATEGY === 'all') {
  const wanted = STRATEGY === 'both' ? COHORTS.slice(0, 2) : COHORTS;
  for (const [label, st] of wanted) report(label, runFleet(st), st);
} else {
  report(STRATEGY.toUpperCase(), runFleet(STRATEGY), STRATEGY);
}

console.log(failures === 0
  ? `\nall balance checks passed (${((Date.now() - started) / 1000).toFixed(1)}s)\n`
  : `\n${failures} balance check(s) failed\n`);
if (failures > 0) process.exit(1);
