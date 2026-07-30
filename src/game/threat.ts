// Who is worth robbing: the threat model.
//
// This lived in contracts.ts, which is about the jobs you take on. A pirate
// sizing you up is not a contract — it is the other half of the economy, and
// the file that owns it should say so in its name. `npm run campaign` tunes
// against these numbers, and they are the ones a balance change touches.
//
import { COMMODITIES, type StarSystem } from '../galaxy/galaxy.ts';
import { isContraband } from './law.ts';
import { random } from './rng.ts';

// --- who's worth robbing ----------------------------------------------------
//
// Pirates are businesses. They weigh what you're visibly carrying against what
// you'd visibly cost them, and a poor Cobra full of food is not worth three
// Fer-de-Lances. Two rules keep this from becoming rubber-banding:
//
//   1. Only things a pirate can SEE count. Cargo (they scan, as police do),
//      hold size, fitted laser, reputation. Never your bank balance — a
//      commander who banks the money and flies clean has genuinely made
//      themselves a poor target, and that should be a real strategy.
//   2. Threat grows SUB-LINEARLY with the prize. Across a career the player's
//      combat power grows maybe tenfold; this should grow two- or threefold,
//      so upgrades are felt rather than cancelled out.

/** Combat score at which fame is fully "worth coming for" — Dangerous. */
const FAME_FULL = 2560;
/** Share of receptions that are challengers, at full fame. */
const CHALLENGE_RATE = 0.35;
/** Slaves, Narcotics, Firearms — worth more to a pirate, and mark you as a smuggler. */
/**
 * Cargo value (tenths of a credit) at which the prize term saturates — 1,600 Cr.
 * Tuned against the campaign sim: this makes gangs ~5% of receptions (2 per
 * career for a wealthy commander) while holding deaths per career at the 1.4
 * baseline. Lower it and gangs get commoner but the wealth curve collapses
 * (1,200 Cr → 9% gangs but median net worth 2,242 Cr against 3,661).
 */
const PRIZE_SATURATION = 25000;

/** Everything a pirate can observe about you. */
export interface Mark {
  /** what a cargo scanner reads, in tenths of a credit */
  cargoValue: number;
  /** tonnes of contraband aboard */
  contraband: number;
  /** hold capacity — a big bay looks like a fat prize even when empty */
  capacity: number;
  /** combat reputation — your name arrives before you do */
  combatScore: number;
  laser: 'pulse' | 'beam' | 'military';
  /** 0..1 regional heat from your recent big or dirty sales nearby */
  notoriety: number;
}

/** Read a commander the way a pirate's scanner would. */
/**
 * The most work you may hold at once.
 *
 * Lived as a bare `>= 3` in game.ts and a bare `>= 2` in test/campaign.ts —
 * so the balance harness was playing a game with a smaller bulletin board than
 * the one that ships.
 */

export function markOf(
  c: {
    cargo: number[];
    kills: number;
    combatScore?: number;
    equipment: { laser: string; largeBay: boolean };
  },
  notoriety = 0,
): Mark {
  let cargoValue = 0;
  let contraband = 0;
  for (let i = 0; i < c.cargo.length && i < COMMODITIES.length; i++) {
    const q = c.cargo[i];
    if (!q) continue;
    // basePrice is the 1984 byte encoding; ×0.4 gives credits, ×4 gives tenths
    cargoValue += q * COMMODITIES[i].basePrice * 4;
    if (isContraband(i)) contraband += q;
  }
  return {
    cargoValue,
    contraband,
    capacity: c.equipment.largeBay ? 35 : 20,
    combatScore: c.combatScore ?? c.kills,
    laser: (c.equipment.laser as Mark['laser']) ?? 'pulse',
    notoriety,
  };
}

/**
 * Which tier of hull the Nth member of a group flies.
 *
 * A gang is not five Fer-de-Lances. It's one or two ringleaders who decided
 * you were worth organising for, plus hangers-on in whatever they could
 * afford — which is both more believable and what lets gangs be *common*
 * rather than an overwhelming rarity.
 *
 * Lives here rather than in npc.ts so the campaign simulator resolves each
 * attacker at the same strength the game spawns it at; npc.ts owns the hulls,
 * this owns the rule.
 */
export function memberTier(groupTier: number, memberIndex: number): number {
  const leaders = groupTier >= 2 ? 2 : 1;
  return memberIndex < leaders ? groupTier : Math.max(0, groupTier - 1);
}

export interface PirateThreat {
  count: number;
  /** 0 opportunists (Sidewinders, Kraits) · 1 professionals · 2 an organised gang */
  tier: 0 | 1 | 2;
  /** flies the coordinated pack policy and presses the attack */
  organised: boolean;
  /** 0..1 how attractive you looked — exposed for tuning and tests */
  appeal: number;
  /** 0..1 how much of this reception came for your reputation rather than your hold */
  fame: number;
  /** true when this lot came looking for you specifically, not for your cargo */
  challenged: boolean;
}

/**
 * What's waiting for you on the way in. `place` is the old rule (lawlessness
 * plus whatever the living galaxy has seen happen here lately); the mark
 * decides the *quality* of the reception more than the quantity.
 */
export function pirateThreat(
  sys: StarSystem,
  danger: number,
  mark: Mark,
  rng: () => number = random,
): PirateThreat {
  const place = (7 - sys.government) / 2 + danger * 3;

  // Saturating: the gap between 200 and 2,000 credits of cargo matters; the
  // gap between 20,000 and 40,000 does not.
  const prize = Math.min(1, mark.cargoValue / PRIZE_SATURATION)
    + Math.min(0.25, mark.contraband * 0.05)
    + (mark.capacity > 20 ? 0.1 : 0);

  // What you look like you'd cost them.
  const deter = Math.min(0.5, mark.combatScore / 150)
    + (mark.laser === 'military' ? 0.3 : mark.laser === 'beam' ? 0.12 : 0);

  // Deterrence is weighted heavily: looking dangerous is the main lever the
  // player has against this system, and it should visibly work.
  const appeal = Math.max(0, Math.min(1, prize - 0.7 * deter + 0.6 * mark.notoriety));

  // ...but fame cuts both ways. A reputation scares off thieves looking for
  // easy cargo, and simultaneously draws people who want to be the ones who
  // killed you. That draw is an *occasional challenge*, not a permanent tax:
  // folding fame straight into the tier made 99% of receptions gangs once a
  // commander hit Dangerous, which is monotonous and erases the whole tier
  // ladder. Instead it rolls — at Dangerous, about a third of receptions are
  // someone coming for the reputation rather than the cargo.
  const fame = Math.max(0, Math.min(1, mark.combatScore / FAME_FULL));
  const challenged = rng() < CHALLENGE_RATE * fame;
  const draw = challenged ? 1 : appeal;

  // Sub-linear: a fat commander draws about one extra attacker, not five.
  // Fame adds its own challengers on top.
  const count = Math.max(0, Math.round(place + appeal * 1.5 + fame * 1.2 + rng() * 2 - 1));
  // Thresholds, not the prize curve, set how often each tier appears — keeping
  // saturation high preserves the gap between a good load and a fat one.
  const tier: 0 | 1 | 2 = draw < 0.28 ? 0 : draw < 0.5 ? 1 : 2;
  // A gang needs both a reason and the numbers to bother forming.
  const organised = tier === 2 && count >= 3 && rng() < 0.4 + 0.5 * draw;
  return { count, tier, organised, appeal, fame, challenged };
}
