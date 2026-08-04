// Prices, contracts, the law, and what a pirate thinks you are worth.
//
// The rules a career is made of. They live in contracts.ts and law.ts rather than
// game.ts (invariant 10) precisely so they can be driven directly from here, and
// so the headless campaign runs the same code the game does.

import { readFileSync, readdirSync } from 'node:fs';
import { newCommander, killValue } from '../src/game/commander.ts';
import { MAX_FUEL } from '../src/constants/commander.ts';
import { fuelNeeded, refuelCost, fuelQuote } from '../src/game/shop.ts';
import { FUEL_PRICE } from '../src/constants/shop.ts';
import { equipRows, renderMarket } from '../src/ui/screens.ts';
import {
  isContraband,
  contrabandTonnes,
  carryingContraband,
  fineFor,
  offenceFor,
} from '../src/game/law.ts';
import {
  CONTRABAND,
  LEGAL_NAMES,
  CLEAN,
  OFFENDER,
  FUGITIVE,
  OFFENDER_FINE,
  FUGITIVE_FINE,
} from '../src/constants/law.ts';
import { generateGalaxy, generateMarket, COMMODITIES } from '../src/galaxy/galaxy.ts';
import { hermitMarket, marketEstimate } from '../src/game/contracts.ts';
import { FLUCTUATIONS } from '../src/constants/market.ts';
import { LivingGalaxy } from '../src/galaxy/living.ts';
import { pirateThreat, markOf, memberTier, type Mark } from '../src/game/threat.ts';
import { CHALLENGE_RATE, PRIZE_SATURATION } from '../src/constants/threat.ts';
import { VALUE_PER_TONNE } from '../src/constants/jettison.ts';
import { HOLD_TONNES, LARGE_BAY_TONNES } from '../src/constants/commander.ts';
import { cargoCapacity } from '../src/game/commander.ts';
import { rating, ratingLadder } from '../src/game/rating.ts';
import { RATINGS } from '../src/constants/rating.ts';
import { makeRng } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

// --- market model -----------------------------------------------------------

console.log('\nmarket model');
const laveMarket = generateMarket(g1[7], 0);
eq('17 commodities', laveMarket.length, COMMODITIES.length);
check('agricultural food is cheap (< 6.0 Cr)', laveMarket[0].price < 6);
check('agricultural computers are dear (> 80 Cr)', laveMarket[7].price > 80);
const leesti = g1.find((s) => s.name === 'Leesti')!;
const leestiMarket = generateMarket(leesti, 0);
check('industrial computers cheaper than agricultural',
  leestiMarket[7].price < laveMarket[7].price);
check('industrial food dearer than agricultural',
  leestiMarket[0].price > laveMarket[0].price);
check('quantities stay within a byte-masked range',
  laveMarket.every((m) => m.quantity >= 0 && m.quantity <= 63));

// --- the estimate a chart shows before you go -------------------------------
//
// The MARKET ESTIMATE panel and the campaign harness both carried the 1984
// formula rewritten — out by over 5 Cr on 113 of the 4,352 system/commodity
// rows, by 38.4 on Teanrebi Narcotics, and blind to living-galaxy pressure.

console.log('\nmarket estimate');
{
  const flat = () => 1;
  // every system and every commodity: the 4,352-row sweep, against the owner
  let worst = 0, worstAt = '';
  for (const sys of g1) {
    const est = marketEstimate(sys, flat);
    for (let i = 0; i < COMMODITIES.length; i++) {
      let sum = 0;
      for (let f = 0; f < FLUCTUATIONS; f++) sum += generateMarket(sys, f)[i].price;
      const d = Math.abs(est[i].price - sum / FLUCTUATIONS);
      if (d > worst) { worst = d; worstAt = `${sys.name} ${COMMODITIES[i].name}`; }
    }
  }
  check(`every estimate is the true 256-fluctuation mean, to the tenth of a credit`
    + ` it is quoted in (worst ${worst.toFixed(3)} Cr at ${worstAt})`, worst <= 0.05);

  // ...and the range is a range: no visit lands outside it. Teanrebi Narcotics,
  // the row the old formula read 38.4 Cr high, is why there is a range at all —
  // the model wraps at 0xff there, so the mean describes no single visit.
  const teanrebi = g1.find((s) => s.name === 'Teanrebi')!;
  const inRange = [g1[7], leesti, teanrebi, g1[0], g1[201]].every((sys) =>
    marketEstimate(sys, flat).every((m, i) => {
      for (let f = 0; f < FLUCTUATIONS; f++) {
        const p = generateMarket(sys, f)[i].price;
        if (p < m.low || p > m.high) return false;
      }
      return true;
    }));
  check('every quote a system can roll falls inside the estimated range', inRange);
  const narcotics = marketEstimate(teanrebi, flat)[6];
  check('the byte wrap is in the estimate, not smoothed away by it',
    narcotics.price < 60 && narcotics.low < 5 && narcotics.high > 95);

  // pressure at the FAR end is part of the estimate, and the chart says so
  const dear = marketEstimate(g1[7], (i) => (i === 0 ? 1.25 : 1));
  const lave = marketEstimate(g1[7], flat);
  check('the living galaxy moves the estimate, and only where it applies',
    dear[0].price === +(lave[0].price * 1.25).toFixed(1) && dear[1].price === lave[1].price
    && dear[0].high === +(lave[0].high * 1.25).toFixed(1));

  // `mask` and `baseQuantity` mean nothing outside the price model, so naming
  // one anywhere but galaxy.ts is a transcription starting.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : /\.(ts|js)$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const offenders = ['../src/', '../test/']
    .flatMap((d) => walk(new URL(d, import.meta.url)))
    .filter((f) => !f.pathname.endsWith('galaxy/galaxy.ts')
      && /\.\s*(mask|baseQuantity)\b/.test(readFileSync(f, 'utf8')))
    .map((f) => f.pathname.split('/').slice(-2).join('/'));
  check(`the price model has one home (${offenders.join(', ') || 'galaxy.ts only'})`,
    offenders.length === 0);
}

// --- the hermit's tunnel ----------------------------------------------------
//
// The rule was seven bare commodity indices inside game.ts, where the campaign
// could not reach it and no test could name what it priced. It matches on the
// row's own name now, so these checks are also what catches a rename in
// COMMODITIES silently turning the discount off.

console.log('\nrock hermit prices');
{
  const base = generateMarket(g1[7], 0);
  const hermit = hermitMarket(g1[7], 0);
  const row = (name: string) => {
    const i = base.findIndex((m) => m.name === name);
    check(`${name} is a commodity the hermit rule can find`, i >= 0);
    return i;
  };
  eq('the same 17 commodities as anywhere else', hermit.length, base.length);

  for (const name of ['Minerals', 'Gold', 'Platinum', 'Gem-Stones']) {
    const i = row(name);
    check(`${name} is a quarter off at a hermit`,
      hermit[i].price === +(base[i].price * 0.75).toFixed(1));
    check(`...and they have 20 more of it`, hermit[i].quantity === base[i].quantity + 20);
  }
  for (const name of ['Food', 'Liquor/Wines', 'Machinery']) {
    const i = row(name);
    check(`${name} costs a third more out here`,
      hermit[i].price === +(base[i].price * 1.3).toFixed(1));
    check(`...and no more of it arrived`, hermit[i].quantity === base[i].quantity);
  }
  const touched = new Set([...'Minerals Gold Platinum Gem-Stones Food Machinery'.split(' '),
    'Liquor/Wines']);
  check('nothing else is repriced',
    base.every((m, i) => touched.has(m.name)
      || (hermit[i].price === m.price && hermit[i].quantity === m.quantity)));
  check('a hermit sells ore below the station price', hermit[12].price < base[12].price);
}

// --- who's worth robbing ----------------------------------------------------

console.log('\npirate economics');
{
  const fixed = () => 0.5; // take the rng out of it
  const mk = (cargo: Record<number, number>, kills = 0, laser = 'pulse', largeBay = false) => {
    const c = new Array(17).fill(0);
    for (const [i, q] of Object.entries(cargo)) c[+i] = q;
    return { cargo: c, kills, equipment: { laser, largeBay } };
  };
  const lave = g1[7];
  const at = (c: ReturnType<typeof mk>, noto = 0) =>
    pirateThreat(lave, 0.1, markOf(c, noto), fixed);

  const broke = at(mk({}));
  const laden = at(mk({ 7: 35 }, 0, 'pulse', true)); // 35t computers, large bay
  check(`an empty hold is not worth robbing (appeal ${broke.appeal.toFixed(2)})`,
    broke.appeal < 0.1 && broke.tier === 0);
  check(`a full hold of computers draws a gang (appeal ${laden.appeal.toFixed(2)})`,
    laden.appeal > 0.8 && laden.tier === 2);
  check('cheap cargo is not a prize',
    at(mk({ 0: 20 })).tier === 0); // 20t of food

  // the deterrence lever: looking dangerous makes you less worth the trouble
  const armed = at(mk({ 7: 35 }, 150, 'military', true));
  check(`a military laser and a reputation lower the tier (${laden.tier} → ${armed.tier})`,
    armed.appeal < laden.appeal - 0.3 && armed.tier < laden.tier);

  // contraband and notoriety both raise it
  //
  // The bound was `> legal * 0.9`, which is satisfied by contraband being
  // TEN PER CENT LESS attractive than legal cargo — the opposite of the rule
  // it names, and it would have survived deleting the contraband premium
  // outright. Measured gap is 2.0x, so 1.5x is a real bar with real headroom.
  {
    const narcotics = at(mk({ 6: 10 })).appeal;   // contraband, base 235
    const luxuries = at(mk({ 5: 10 })).appeal;    // legal, base 196
    check(`contraband is worth more than its price alone `
      + `(narcotics ${narcotics.toFixed(3)} vs luxuries ${luxuries.toFixed(3)}, `
      + `${(narcotics / luxuries).toFixed(2)}x)`,
    narcotics > luxuries * 1.5);
    // ...and the same rule with price controlled for, which is the sharper
    // form: slaves are contraband at a base of 40 and still the better prize
    // than furs at 176.
    const slaves = at(mk({ 3: 10 })).appeal;
    const furs = at(mk({ 11: 10 })).appeal;
    check(`...even against legal cargo worth four times as much `
      + `(slaves ${slaves.toFixed(3)} vs furs ${furs.toFixed(3)})`,
    slaves > furs);
  }
  check('notoriety raises the reception',
    at(mk({ 7: 10 }), 0.6).appeal > at(mk({ 7: 10 })).appeal + 0.2);

  // the anti-rubber-band rule: threat must grow far slower than the player does
  check(`threat is sub-linear in wealth (${broke.count} → ${laden.count} attackers)`,
    laden.count <= broke.count + 2);
  check('a gang needs the numbers to form',
    !at(mk({ 7: 35 }, 0, 'pulse', true), 0).organised
      || at(mk({ 7: 35 }, 0, 'pulse', true), 0).count >= 3);

  // a gang is ringleaders plus hangers-on, not five Fer-de-Lances — this is
  // what lets gangs be common without being overwhelming
  check('a gang has exactly two ringleaders',
    memberTier(2, 0) === 2 && memberTier(2, 1) === 2 && memberTier(2, 2) === 1);
  check('hangers-on fly a tier below their leaders',
    memberTier(2, 4) === 1 && memberTier(1, 3) === 0);
  check('opportunist groups stay opportunists',
    [0, 1, 2, 3].every((i) => memberTier(0, i) === 0));

  // fame draws challengers: at Dangerous, a share of receptions are people
  // coming for the reputation rather than the cargo
  {
    const famous = { cargo: new Array(17).fill(0), kills: 3000, combatScore: 3000,
      equipment: { laser: 'military', largeBay: false } };
    // empty hold, so nothing here is worth robbing — only the name is
    const rolls = Array.from({ length: 200 }, (_, i) =>
      pirateThreat(lave, 0.1, markOf(famous), () => (i % 100) / 100));
    const challenges = rolls.filter((r) => r.challenged).length;
    check(`a famous commander gets challenged even flying empty (${challenges}/200)`,
      challenges > 30 && challenges < 120);
    const unknown = { ...famous, kills: 0, combatScore: 0 };
    check('an unknown commander with an empty hold is left alone',
      pirateThreat(lave, 0.1, markOf(unknown), fixed).tier === 0);
    check('challengers arrive as an organised gang, not a mugging',
      rolls.filter((r) => r.challenged).every((r) => r.tier === 2));
  }

  // The tuning moved to constants/threat.ts, so the rule and its numbers are
  // in different files — these hold them together in the measured shape:
  // each number is extracted from the REAL pirateThreat and compared to the
  // constant, which a probe at `CONSTANT ± 1` could never fail.
  {
    const bare = (over: Partial<Mark>): Mark => ({
      cargoValue: 0, contraband: 0, capacity: 20, combatScore: 0,
      laser: 'pulse', notoriety: 0, ...over,
    });

    // The prize term: with nothing else on the mark, appeal is the prize
    // alone, so the smallest cargo value at which it reaches 1 IS the
    // saturation point.
    let lo = 0;
    let hi = 1 << 24;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (pirateThreat(lave, 0, bare({ cargoValue: mid }), fixed).appeal >= 1) hi = mid;
      else lo = mid;
    }
    eq('the prize term saturates exactly at PRIZE_SATURATION', hi, PRIZE_SATURATION);

    // The challenge roll: at full fame, the roll's threshold IS the rate.
    // Bisect the rng value at which `challenged` flips.
    const famous = bare({ combatScore: 1 << 24 });
    const flips = (x: number) => pirateThreat(lave, 0, famous, () => x).challenged;
    let fLo = 0;
    let fHi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (fLo + fHi) / 2;
      if (flips(mid)) fLo = mid; else fHi = mid;
    }
    check(`the challenge roll at full fame is CHALLENGE_RATE (measured ${fHi})`,
      Math.abs(fHi - CHALLENGE_RATE) < 1e-12);

    // FAME_FULL is an expression over the rating ladder's Dangerous rung now
    // (constants/threat.ts over constants/rating.ts), so the two cannot drift
    // by edit — but either CONSUMER can still re-inline a literal, and this
    // is what goes red if one does: the fame saturation score, bisected out
    // of the real pirateThreat, must be exactly the score at which the real
    // rating() starts saying Dangerous.
    const challengedAt = (score: number) => pirateThreat(
      lave, 0, bare({ combatScore: score }), () => CHALLENGE_RATE * (1 - 1e-9)).challenged;
    let sLo = 0;
    let sHi = 1 << 24;
    while (sLo + 1 < sHi) {
      const mid = (sLo + sHi) >> 1;
      if (challengedAt(mid)) sHi = mid; else sLo = mid;
    }
    check(`fame saturates at the rating ladder's Dangerous rung (score ${sHi})`,
      rating(sHi) === 'Dangerous' && rating(sHi - 1) !== 'Dangerous');

    // The big-bay bonus fires above the STANDARD hold, and the threshold is
    // measured out of the real function rather than probed at the constant:
    // scan every capacity a hold could plausibly be and find the one step.
    const appealAt = (capacity: number) =>
      pirateThreat(lave, 0, bare({ capacity }), fixed).appeal;
    const steps: number[] = [];
    for (let cap = 1; cap <= 60; cap += 1) {
      if (appealAt(cap) !== appealAt(cap - 1)) steps.push(cap);
    }
    check(`the big-bay bonus steps exactly once, above the standard hold `
      + `(at ${steps.join(',')})`,
    steps.length === 1 && steps[0] === HOLD_TONNES + 1);
  }

  // --- the scanner, the toll and the shop agree about a hold ----------------
  //
  // The survey's four-home cargo capacity and its unexpressed VALUE_PER_TONNE
  // pair, unified: these solve each rule's number back OUT of the function
  // and compare it to the one home, which a re-inlined literal fails.
  {
    // What a scanner reads one tonne as, solved out of the real markOf: for
    // any single tonne, cargoValue / basePrice IS the multiplier.
    const oneTonneOf = (i: number) => {
      const cargo = new Array(17).fill(0);
      cargo[i] = 1;
      return markOf({ cargo, kills: 0, equipment: { laser: 'pulse', largeBay: false } });
    };
    check('markOf prices a tonne at VALUE_PER_TONNE times its base price',
      [0, 5, 7].every((i) =>
        oneTonneOf(i).cargoValue === COMMODITIES[i].basePrice * VALUE_PER_TONNE));

    // A pirate reads the same hold size the game fits: both bay states, the
    // scanner's figure against the real cargoCapacity.
    const cWith = newCommander();
    cWith.equipment.largeBay = true;
    const cWithout = newCommander();
    check('a pirate reads exactly the hold the game fits, both bay states',
      markOf(cWith).capacity === cargoCapacity(cWith)
      && markOf(cWithout).capacity === cargoCapacity(cWithout)
      && cargoCapacity(cWith) === LARGE_BAY_TONNES
      && cargoCapacity(cWithout) === HOLD_TONNES);
  }

  // --- the ladder and the function that climbs it ---------------------------
  //
  // rating() reads RATINGS from the home; if either re-inlines a copy that
  // drifts, probing the FUNCTION at the TABLE's own rungs goes red. Also the
  // manual's chart: ratingLadder() must list every rung, in order.
  {
    check('rating() turns at exactly the ladder\'s own rungs',
      RATINGS.every(([threshold, name], i) =>
        rating(threshold) === name
        && (i === 0 || rating(threshold - 1) === RATINGS[i - 1][1])));
    check('the ladder as a list is the ladder',
      ratingLadder().join('|') === RATINGS.map(([, name]) => name).join('|'));
  }

  // ratings count difficulty, not bodies
  check('a gang leader is worth five Sidewinders', killValue(2) === 5 * killValue(0));
  check('a professional is worth two', killValue(1) === 2);

  // notoriety: spreads to jump-range neighbours, and fades
  const heat = new LivingGalaxy(g1);
  heat.addNotoriety(7, 0.8);
  check('notoriety lands where you sold', heat.notoriety(7) > 0.7);
  const neighbourHeat = [...heat.states.entries()].filter(([i]) => i !== 7 && heat.notoriety(i) > 0);
  check(`word spreads to neighbours (${neighbourHeat.length} systems)`, neighbourHeat.length > 0);
  check('but more faintly than at the source',
    neighbourHeat.every(([, st]) => st.heat < heat.notoriety(7)));
  heat.advance(30, COMMODITIES.map((c) => c.gradient), makeRng(4));
  check('lying low cools you off', heat.notoriety(7) === 0);
}

// --- the fuel price has one home ---------------------------------------------
//
// It had four: a bare `* 0.4` inside equipRows in the RENDER layer, plus
// copies in test/campaign.ts, train/jameson-autopilot.js and a doc.

console.log('\nrefuelling');
{
  const tank = (fuel: number) => ({ fuel }) as never;
  check('an empty tank costs the full rate',
    refuelCost(tank(0)) === Math.round(MAX_FUEL * FUEL_PRICE));
  check('a full tank is free', refuelCost(tank(MAX_FUEL)) === 0);
  check('...and needs nothing', fuelNeeded(tank(MAX_FUEL)) === 0);
  check('half a tank is half the price',
    refuelCost(tank(MAX_FUEL / 2)) === Math.round((MAX_FUEL / 2) * FUEL_PRICE));
  // money is integer tenths (invariant 8), and a sun-skim leaves a fraction
  check('a scooped fractional tank still costs a whole number of tenths',
    Number.isInteger(refuelCost(tank(41.3))));

  // the outfitters' row must quote exactly what the rule says
  const c = newCommander();
  c.fuel = 20;
  const row = equipRows(generateGalaxy(1)[7], c).find((r) => r.id === 'fuel')!;
  check('the equipment screen quotes the shared rule', row.price === refuelCost(c));
  c.fuel = MAX_FUEL;
  check('...and reads OWNED at a full tank',
    equipRows(generateGalaxy(1)[7], c).find((r) => r.id === 'fuel')!.status === 'OWNED');

  // --- the quote the shops read ---------------------------------------------
  //
  // A shopper reads a price PER LIGHT YEAR; FUEL_PRICE is per tenth of one.
  // That conversion is the sum this file exists to stop being written twice.
  {
    const empty = newCommander();
    empty.fuel = 0;
    const q = fuelQuote(empty);
    check('the quote agrees with the rule it quotes',
      q.cost === refuelCost(empty) && q.needed === fuelNeeded(empty));
    // one LY short of full: what it costs to fill IS the per-LY price
    const shortOne = { fuel: MAX_FUEL - 10 } as never;
    check('a light year quoted costs a light year bought',
      q.perLightYear === refuelCost(shortOne));
    check('a full tank has nothing to quote',
      fuelQuote({ fuel: MAX_FUEL } as never).full && fuelQuote({ fuel: MAX_FUEL } as never).cost === 0);
    check('...and a dry one is not full', !q.full);
  }

  // --- and it reaches the market screen --------------------------------------
  //
  // The point of the feature: you could not see what fuel cost without leaving
  // the market for the outfitters. Rendered for real against a stub document,
  // because "the string is in the HTML" is the only thing that answers it.
  {
    const prev = (globalThis as unknown as { document: unknown }).document;
    let html = '';
    const cls = { add: () => {}, remove: () => {}, toggle: () => {} };
    (globalThis as unknown as { document: unknown }).document = {
      querySelectorAll: () => [],
      getElementById: () => ({ set innerHTML(v: string) { html = v; }, classList: cls }),
      body: { classList: cls },
    };
    try {
      const c = newCommander();
      c.fuel = 20; // 2.0 LY in the tank, 5.0 LY short
      const market = generateMarket(g1[7], 0);
      renderMarket(g1[7], market, c, 0, fuelQuote(c));
      check('the market screen prints the price of a light year',
        html.includes('FUEL 0.4 Cr/LY'));
      check('...and what filling up would cost', html.includes('2.0 Cr TO FILL'));
      check('...and how much is in the tank', html.includes('TANK 2.0/7.0 LY'));

      c.fuel = MAX_FUEL;
      renderMarket(g1[7], market, c, 0, fuelQuote(c));
      check('a full tank is told so rather than sold to',
        html.includes('TANK FULL') && !html.includes('TO FILL'));

      // a rock hermit trades cargo but cannot fill a tank: no quote at all
      renderMarket(g1[7], market, c, 0, null);
      check('a hermit quotes no fuel price it cannot honour', !html.includes('FUEL 0.4'));
    } finally {
      (globalThis as unknown as { document: unknown }).document = prev;
    }
  }

  // nobody may re-derive it. Deliberately fuel-specific: a bare /\* 0\.4/
  // also matches the commodity byte-to-credits scale, which is a different
  // 0.4 doing a different job.
  const reFuel = /(fuel|need)[A-Za-z]*\s*\*\s*0\.4/i;
  for (const f of ['../src/ui/screens.ts', '../src/game/screens/trade.ts',
    '../test/campaign.ts', '../train/jameson-autopilot.js']) {
    // comments stripped first — the explanatory note in jameson-autopilot.js
    // says `need * 0.4` while explaining why it must not, and tripped this.
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f.split('/').pop()} does not re-derive the fuel price`, !reFuel.test(src));
  }
}

// --- the law ----------------------------------------------------------------

console.log('\nthe law');
{
  check('slaves, narcotics and firearms are the illegal three',
    CONTRABAND.length === 3 && [3, 6, 10].every(isContraband));
  check('...and nothing else is', [0, 1, 2, 4, 5, 7, 8, 9].every((i) => !isContraband(i)));

  {
    const hold = new Array(17).fill(0);
    check('a clean hold passes a scan', !carryingContraband(hold));
    hold[6] = 2;
    check('two tonnes of narcotics does not',
      carryingContraband(hold) && contrabandTonnes(hold) === 2);
    hold[3] = 1;
    check('...and it counts every kind', contrabandTonnes(hold) === 3);
  }

  // THE point of law.ts: one definition where there were four. If these ever
  // disagree, someone has re-inlined [3, 6, 10] somewhere.
  {
    const hold = new Array(17).fill(0);
    CONTRABAND.forEach((i) => { hold[i] = 1; });
    const mark = markOf(
      { cargo: hold, kills: 0, equipment: { laser: 'pulse', largeBay: false } }, 0);
    check('contracts.ts counts the same set as law.ts',
      mark.contraband === CONTRABAND.length);
  }

  {
    check('a clean commander pays nothing', fineFor(CLEAN, 100_000) === 0);
    check('an offender pays 25 Cr', fineFor(OFFENDER, 100_000) === OFFENDER_FINE);
    check('a fugitive pays 75 Cr', fineFor(FUGITIVE, 100_000) === FUGITIVE_FINE);
    check('...but never more than you have', fineFor(FUGITIVE, 100) === 100);
    check('...and a broke fugitive pays nothing rather than going negative',
      fineFor(FUGITIVE, 0) === 0);
  }

  {
    check("shooting a pirate is nobody's business", offenceFor('pirate', false) === CLEAN);
    check('...destroying one, likewise', offenceFor('pirate', true) === CLEAN);
    check('...and thargoids and rocks too',
      offenceFor('thargoid', true) === CLEAN && offenceFor('asteroid', true) === CLEAN);
    for (const role of ['police', 'trader', 'hunter']) {
      check(`shooting a ${role} is an offence`, offenceFor(role, false) === OFFENDER);
      check(`...destroying a ${role} makes you a fugitive`,
        offenceFor(role, true) === FUGITIVE);
    }
  }
  check('every legal status has a name',
    LEGAL_NAMES.length === 3 && LEGAL_NAMES.every((n) => n.length > 0));
}
