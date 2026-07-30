// Contracts, the Navy mission, and the thing in your cabin.
//
// Contract rules live in game/contracts.ts (invariant 10) so the headless campaign
// runs the same code the game does — these drive that module directly. Trumbles are
// here because they are the other thing that changes under you while you fly.

import { newCommander, cargoCapacity, type Contract } from '../src/game/commander.ts';
import type { CommanderData } from '../src/game/commander.ts';
import {
  stepTrumbles,
  trumbleMessage,
  BREED_INTERVAL,
  MAX_TRUMBLES,
} from '../src/game/trumbles.ts';
import {
  stepMissionAtDock,
  constrictorDestroyed,
  constrictorLurksHere,
  missionHeadline,
} from '../src/game/missions.ts';
import { generateGalaxy } from '../src/galaxy/galaxy.ts';
import {
  MAX_CONTRACTS,
  settleContracts,
  acceptContract,
  contractMessage,
} from '../src/game/contracts.ts';
import { check } from './harness.ts';

// --- taking work, and being paid for it -------------------------------------
//
// `settleContracts` and `acceptContract` were private methods of game.ts, so
// the rules that decide whether a job pays had NO tests at all — and
// test/campaign.ts, the harness the project quotes its balance figures from,
// carried its own transcription of the settlement rather than calling them.
// That is the exact arrangement CLAUDE.md's invariant 7 forbids. They are in
// contracts.ts now, and this is the coverage that was missing.

console.log('\ncontracts');
{
  const systems = generateGalaxy(1);
  const cargoRun = (over: Partial<Contract> = {}): Contract => ({
    kind: 'cargo', destination: 7, commodity: 0, qty: 5,
    reward: 500, deadlineDay: 10, progress: 0, ...over,
  });
  const cmdr = (over: Record<string, unknown> = {}): CommanderData => ({
    ...newCommander(), systemIndex: 7, day: 0, credits: 1000, contracts: [], ...over,
  } as CommanderData);

  // --- settlement ----------------------------------------------------------
  {
    const c = cmdr();
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    const ev = settleContracts(c);
    check('a consignment delivered on time pays', ev[0]?.kind === 'paid');
    check('...the reward lands in the account', c.credits === 1500);
    check('...the goods leave the hold', c.cargo[0] === 0);
    check('...and the job leaves the list', c.contracts.length === 0);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun()];
    c.cargo[0] = 4;              // sold one on the way
    const ev = settleContracts(c);
    check('a short consignment is void, not paid', ev[0]?.kind === 'incomplete');
    check('...pays nothing and takes nothing', c.credits === 1000 && c.cargo[0] === 4);
    check('...and is off the list for good', c.contracts.length === 0);
  }
  {
    const c = cmdr({ day: 11 });
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    const ev = settleContracts(c);
    check('a late delivery expires even standing on the doorstep',
      ev[0]?.kind === 'expired' && c.credits === 1000 && c.contracts.length === 0);
  }
  {
    const c = cmdr({ systemIndex: 8 });
    c.contracts = [cargoRun()];
    c.cargo[0] = 5;
    check('a job for somewhere else is left alone',
      settleContracts(c).length === 0 && c.contracts.length === 1 && c.cargo[0] === 5);
  }
  {
    const c = cmdr({ day: 11, systemIndex: 8 });
    c.contracts = [cargoRun()];
    check('...unless the deadline has passed, wherever you are',
      settleContracts(c)[0]?.kind === 'expired' && c.contracts.length === 0);
  }
  {
    // THE branch a re-implementation gets wrong, and the reason this is one
    // function now: an unfinished bounty job at its destination is neither
    // settled nor dropped — you may come back to it until the deadline.
    const c = cmdr();
    c.contracts = [cargoRun({ kind: 'bounty', qty: 3, progress: 1 })];
    check('an unfilled bounty at its destination is kept, not failed',
      settleContracts(c).length === 0 && c.contracts.length === 1);
    c.contracts[0].progress = 3;
    check('...and pays once the count is filled',
      settleContracts(c)[0]?.kind === 'paid' && c.credits === 1500);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun({ commodity: 0 }), cargoRun({ commodity: 1, reward: 300 })];
    c.cargo[0] = 5; c.cargo[1] = 5;
    check('several jobs settle in one dock', settleContracts(c).length === 2);
    check('...and both rewards are paid', c.credits === 1800);
  }

  // --- taking it on --------------------------------------------------------
  {
    const c = cmdr();
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check('accepting a cargo run loads the consignment on the spot',
      ev[0]?.kind === 'accepted' && c.cargo[0] === 5);
    check('...puts it on your list', c.contracts.length === 1);
    check('...and takes it off the board', offers.length === 0);
  }
  {
    const c = cmdr();
    c.contracts = [cargoRun(), cargoRun(), cargoRun()];   // MAX_CONTRACTS
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check(`no more than ${MAX_CONTRACTS} jobs at once`,
      ev[0]?.kind === 'refused' && ev[0].reason === 'tooMuchWork');
    check('...and a refusal changes nothing at all',
      c.contracts.length === 3 && offers.length === 1 && c.cargo[0] === 0);
  }
  {
    const c = cmdr();
    c.cargo[0] = cargoCapacity(c);   // hold already full
    const offers = [cargoRun({ destination: 8 })];
    const ev = acceptContract(c, offers, 0);
    check('a consignment that will not fit is refused',
      ev[0]?.kind === 'refused' && ev[0].reason === 'noHoldSpace');
    check('...and nothing is loaded', c.cargo[0] === cargoCapacity(c) && offers.length === 1);
  }
  {
    check('accepting nothing is nothing', acceptContract(cmdr(), [], 0).length === 0);
  }

  // --- phrasing lives with the rule, away from the AudioContext -------------
  {
    const paid = contractMessage({ kind: 'paid', contract: cargoRun() }, systems);
    check('a payment is announced with the money',
      paid.text.includes('CONTRACT PAID') && paid.beep?.hz === 1100);
    const acc = contractMessage(
      { kind: 'accepted', contract: cargoRun({ destination: 7 }) }, systems);
    check('...and an acceptance names the destination',
      acc.text.includes('LAVE') && acc.text === acc.text.toUpperCase());
    check('a void consignment does not beep',
      contractMessage({ kind: 'incomplete', contract: cargoRun() }, systems).beep === null);
  }
}

// --- the Navy mission -------------------------------------------------------

// A five-stage state machine that lived in three private methods of game.ts
// and one branch of destroyNpc, so nothing could advance a commander through
// it. game/missions.ts is pure, so these are its first tests.

console.log('\nNavy mission');
{
  const systems = generateGalaxy(1);
  const cmdr = (over: Record<string, unknown> = {}) => ({
    kills: 0, galaxy: 1, systemIndex: 7, credits: 1000,
    mission: { stage: 0, targetIndex: null }, ...over,
  }) as unknown as Parameters<typeof stepMissionAtDock>[0];
  const half = () => 0.5;

  {
    const c = cmdr({ kills: 15 });
    check('the Navy ignores you below the kill threshold',
      stepMissionAtDock(c, systems, half).length === 0 && c.mission.stage === 0);
  }
  {
    const c = cmdr({ kills: 16 });
    const ev = stepMissionAtDock(c, systems, half);
    check('...and briefs you at it', ev[0]?.kind === 'briefed' && c.mission.stage === 1);
    check('...with a target that is somewhere else', c.mission.targetIndex !== 7);
  }
  {
    const c = cmdr({ kills: 16, galaxy: 2 });
    check('the mission is galaxy 1 only',
      stepMissionAtDock(c, systems, half).length === 0);
  }
  {
    const c = cmdr({ mission: { stage: 1, targetIndex: 7 } });
    check('the Constrictor lurks where you were told', constrictorLurksHere(c));
    const before = c.credits;
    const e = constrictorDestroyed(c);
    check('killing it pays the Navy bounty and moves you to stage 2',
      e?.bounty === 25_000 && c.credits === before + 25_000 && c.mission.stage === 2);
    check('...and it cannot be claimed twice', constrictorDestroyed(c) === null);
  }
  {
    const c = cmdr({ mission: { stage: 2, targetIndex: null } });
    const ev = stepMissionAtDock(c, systems, half);
    check('reporting back gets the courier orders',
      ev[0]?.kind === 'courierOrders' && c.mission.stage === 3);
    // fly there and dock
    c.systemIndex = c.mission.targetIndex as number;
    const before = c.credits;
    const done = stepMissionAtDock(c, systems, half);
    check('delivering the plans pays and completes it',
      done[0]?.kind === 'delivered' && c.credits === before + 15_000 && c.mission.stage === 4);
  }
  {
    check('an idle commander has no mission line',
      missionHeadline(cmdr(), systems) === '');
    check('a briefed one names the system',
      missionHeadline(cmdr({ mission: { stage: 1, targetIndex: 7 } }), systems).includes('LAVE'));
  }
}

// --- trumbles ---------------------------------------------------------------

console.log('\ntrumbles');
{
  const cmdr = (trumbles: number, cargo: number[] = new Array(17).fill(0)) =>
    ({ trumbles, cargo: [...cargo] }) as unknown as Parameters<typeof stepTrumbles>[0];
  const half = () => 0.5;

  {
    const c = cmdr(0);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('no trumbles, nothing happens', r.events.length === 0 && c.trumbles === 0);
  }
  {
    const c = cmdr(1);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('they breed', c.trumbles > 1 && r.timer === BREED_INTERVAL);
  }
  {
    // one dt per brood interval, so each call is one generation
    const c = cmdr(1);
    let timer = 0;
    for (let i = 0; i < 8; i++) timer = stepTrumbles(c, BREED_INTERVAL, 0, timer, half).timer;
    check(`...exponentially (1 -> ${c.trumbles} in 8 broods)`, c.trumbles > 20);
    check('...but not without bound', c.trumbles <= MAX_TRUMBLES);
  }
  {
    const cargo = new Array(17).fill(0); cargo[0] = 10;
    const c = cmdr(16, cargo);
    const r = stepTrumbles(c, 1, 0, 0, half);
    check('a big enough brood eats the hold',
      c.cargo[0] < 10 && r.events.some((e) => e.kind === 'ate'));
  }
  {
    const cargo = new Array(17).fill(0); cargo[0] = 10;
    const c = cmdr(4, cargo);
    stepTrumbles(c, 1, 0, 0, half);
    check('a small one is not hungry enough to bite', c.cargo[0] === 10);
  }
  {
    // the cure is a sun-skim — the same manoeuvre that refuels you
    const c = cmdr(50);
    const r = stepTrumbles(c, 1, 0.9, BREED_INTERVAL, half);
    check('cabin heat drives them out', c.trumbles < 50 && r.timer === 0);
    const c2 = cmdr(1);
    const r2 = stepTrumbles(c2, 1, 0.9, 0, half);
    check('...to the last one', c2.trumbles === 0 && r2.events[0]?.kind === 'purged');
  }
  check('every event has a line', ['purged', 'fleeing', 'ate', 'breeding'].every((k) =>
    trumbleMessage({ kind: k, left: 1, total: 1, commodity: 0, tonnes: 1 } as never).length > 0));
}
