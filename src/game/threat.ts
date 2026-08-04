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
import { npcCombatProfileById, type NpcCombatProfileId } from './ship-identity.ts';
import {
  CHALLENGE_RATE, CURATED_TIER, DEFENCE_WEIGHT, FAME_FULL, GANG_SCORE,
  LASER_WEIGHT, PRIZE_SATURATION, PROFESSIONAL_SCORE,
} from '../constants/threat.ts';
import { HOLD_TONNES, LARGE_BAY_TONNES } from '../constants/commander.ts';
import { VALUE_PER_TONNE } from '../constants/jettison.ts';

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
    // VALUE_PER_TONNE is the same rule the jettison toll prices cargo by —
    // the scanner and the ransom must agree about what a hold is worth
    cargoValue += q * COMMODITIES[i].basePrice * VALUE_PER_TONNE;
    if (isContraband(i)) contraband += q;
  }
  return {
    cargoValue,
    contraband,
    capacity: c.equipment.largeBay ? LARGE_BAY_TONNES : HOLD_TONNES,
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

// --- which tier a HULL belongs to -------------------------------------------
//
// Threat tiers are a Harmless invention: the source has one pirate band, and
// splitting it into opportunists, professionals and an organised gang is our
// selection policy, not a recovered rule. What is NOT ours is how tough each
// hull is, and the tiers used to be three hand-written lists that said so
// again in their own words. So the lists are gone and the tier is read off
// three NAMED source fields instead — a hull moves tier when the pack says it
// is tougher, and never because someone retyped a table.

/** The threat score of an exact released build. Exported for the tests. */
export function sourceThreatScore(profileId: NpcCombatProfileId): number {
  const record = npcCombatProfileById(profileId);
  if (record.source !== 'elite-a') return 0;
  const p = record.profile;
  return p.maxEnergy + p.perHitDefence * DEFENCE_WEIGHT + p.laserPower * LASER_WEIGHT;
}

/**
 * The tier ladder over a bare score — the two thresholds and nothing else.
 *
 * Its own function so the thresholds can be measured rather than transcribed:
 * `test/ship-roles.test.ts` bisects both steps out of it and compares them to
 * `PROFESSIONAL_SCORE` and `GANG_SCORE`, which a check probing at the
 * constants themselves could never fail.
 */
export function tierForScore(score: number): 0 | 1 | 2 {
  return score >= GANG_SCORE ? 2 : score >= PROFESSIONAL_SCORE ? 1 : 0;
}

/**
 * Which tier a hull flies in, from what the pack says it is.
 *
 * `designId` is only consulted for the curated exception
 * (`CURATED_TIER`, constants/threat.ts); everything else comes off the exact
 * build's own combat fields.
 */
export function hullThreatTier(
  designId: string, profileId: NpcCombatProfileId,
): 0 | 1 | 2 {
  const curated = CURATED_TIER[designId];
  if (curated !== undefined) return curated;
  return tierForScore(sourceThreatScore(profileId));
}

export interface PirateThreat {
  count: number;
  /**
   * 0 opportunists · 1 professionals · 2 an organised gang.
   *
   * WHICH hulls land in each is `hullThreatTier` over the pirate roster, not a
   * list here — it moved when the pirate build did (the Krait was a tier-0
   * opportunist against the recommended default and is a professional in the
   * `W:19` build it actually flies).
   */
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
    + (mark.capacity > HOLD_TONNES ? 0.1 : 0);

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
