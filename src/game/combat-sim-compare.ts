// Two records, held against each other — and the refusal when they may not be.
//
// The seventh combat-trainer file, and the one the whole method rests on:
// docs/COMBAT-SIM.md says the trainer is an A/B rig — same seed, same scenario,
// two brains, two reports — and that is why the seed is on the record. Until
// this module, doing it meant flying one, reading a screen, flying the other,
// and holding twenty numbers in your head while pressing left and right between
// records.
//
// **It derives, and it accumulates nothing.** Everything here is a function of
// two finished `CombatSimReport`s: no new sampling, no second tally, no field
// added to a recorder. Two records that were exported yesterday compare exactly
// as two flown a minute ago.
//
// The load-bearing part is not the arithmetic, it is the REFUSAL. Subtracting
// two numbers is always possible and is only sometimes meaningful: two fights on
// different seeds, in different scenarios or modes, on a different wave, against
// a different hull or flown with a different fit-out are not an A/B, and a
// difference column over them is a number that looks like a finding and is not
// one. So a confound is NAMED, with both of its values, and the difference
// column is not painted at all. Different BRAINS is the point; different
// anything else is a confound.
//
// There is deliberately NO verdict, no score and no "which brain won" — the same
// refusal TODO 34 made about a turret index, for the same reason. The report
// presents; the pilot judges. Even the difference is left unsigned in meaning:
// more damage taken is worse for a pilot and exactly what a playtester is
// hunting for, and a renderer that coloured it green or red would be deciding
// which of those you are.

import { COMBAT_SIM_SCHEMA, type CombatSimReport } from './combat-sim-report.ts';

/**
 * One thing that differs and must not — with both values, because "the seeds
 * differ" is a complaint and "SEED 90210 / 4242" is a fact the pilot can act on.
 */
export interface Confound {
  field: string;
  /** THIS record's value — the one the compare view was opened from */
  a: string;
  /** THAT record's value — the one being walked with left and right */
  b: string;
}

/** What flew, per opponent: the difference that is the POINT of the exercise. */
export interface BrainChange {
  index: number;
  hull: string;
  a: string;
  b: string;
  same: boolean;
}

/**
 * One line of the comparison, already formatted.
 *
 * Strings rather than numbers, because the unit and the precision are the ROW's
 * knowledge — seconds to one place, a share as a percentage, a range as a whole
 * number — and a renderer that formatted them would be the second place that
 * knew. The JSON export carries both whole records beside these lines, so
 * nothing that reads it is left with only the rounding.
 */
export interface CompareRow {
  label: string;
  a: string;
  b: string;
  /**
   * `b - a`, or null when there is no difference to take: a row of words, or a
   * pair that is not an A/B at all. Null is what the renderer paints nothing
   * for — the difference column simply does not exist on a mismatched pair.
   */
  delta: string | null;
}

export interface CompareGroup {
  heading: string;
  rows: CompareRow[];
}

/** Two records, and what may honestly be said about the pair. */
export interface SimComparison {
  /** THIS — the record the view was opened from */
  a: CombatSimReport;
  /** THAT — the other one */
  b: CombatSimReport;
  /** may the two be subtracted at all? False if `confounds` is non-empty */
  comparable: boolean;
  confounds: Confound[];
  brains: BrainChange[];
  /**
   * The brains matched too — so this is a REPEAT of one fight rather than an
   * A/B of two. Not a refusal: flying the same setup twice is how you find out
   * how much of a difference is just the fight going differently. It is said
   * out loud so it is not mistaken for a result.
   */
  sameBrains: boolean;
  groups: CompareGroup[];
}

/** The compare view, as the renderer needs it — see `SimSetupPanel`'s note. */
export interface SimComparePanel {
  compare: SimComparison;
  /** which record in the ring each column is, 0-based */
  thisIndex: number;
  thatIndex: number;
  total: number;
}

// --- what may not differ ----------------------------------------------------
//
// The fight's IDENTITY: everything that decides which fight this was, rather
// than how it went. If any of it differs the two records are of two different
// fights, and their difference is a fact about the setup and not about the
// brains.

const yesNo = (b: boolean | undefined): string => (b ? 'YES' : 'NO');

interface IdentityField {
  field: string;
  of: (r: CombatSimReport) => string;
}

const IDENTITY: readonly IdentityField[] = [
  // The schema first: TODO 28 changed what the damage figures MEAN, so records
  // either side of it are not comparable however well the rest matches.
  { field: 'SCHEMA', of: (r) => String(r.schema) },
  { field: 'SEED', of: (r) => String(r.seed) },
  { field: 'FIGHT', of: (r) => r.scenario.toUpperCase() },
  { field: 'MODE', of: (r) => r.mode.toUpperCase() },
  // A wave IS the fight in the waves mode — wave 1 against wave 5 is a
  // different opposition, arriving at a different point in a long session.
  { field: 'WAVE', of: (r) => (r.wave === undefined ? 'N/A' : String(r.wave)) },
  { field: 'YOUR HULL', of: (r) => r.player.shipId },
  {
    field: 'YOUR LASER',
    of: (r) => r.player.laser.toUpperCase() + (r.player.rearLaser ? ' + REAR' : ''),
  },
  { field: 'YOUR MISSILES', of: (r) => String(r.player.missiles) },
  { field: 'YOUR E.C.M.', of: (r) => yesNo(r.player.ecm) },
  { field: 'YOUR ENERGY UNIT', of: (r) => yesNo(r.player.energyUnit) },
  { field: 'YOUR ENERGY BOMB', of: (r) => yesNo(r.player.energyBomb) },
  { field: 'YOUR OTHER FIT', of: (r) => JSON.stringify(r.player.extra ?? {}) },
  // How MANY, before which ones: three pirates against four is a different
  // fight whatever they are flying.
  { field: 'OPPONENTS', of: (r) => String(r.opponents.length) },
];

/** Per opponent, once the counts agree — the hull, the exact build, and the tier. */
const PER_OPPONENT: readonly { field: string; of: (o: CombatSimReport['opponents'][number]) => string }[] = [
  // The NAME is for reading and the id is the truth: two records can both say
  // "Moray" and be two different released builds (ship-identity.ts).
  { field: 'HULL', of: (o) => `${o.hull.toUpperCase()} (${o.designId})` },
  { field: 'BUILD', of: (o) => o.profileId },
  { field: 'TIER', of: (o) => (o.tier === undefined ? '-' : String(o.tier)) },
  { field: 'ROLE', of: (o) => o.role ?? '-' },
];

function confoundsOf(a: CombatSimReport, b: CombatSimReport): Confound[] {
  const out: Confound[] = [];
  for (const f of IDENTITY) {
    const [x, y] = [f.of(a), f.of(b)];
    if (x !== y) out.push({ field: f.field, a: x, b: y });
  }
  // Only when the counts agree. When they do not, the count IS the confound,
  // and four more lines per missing ship would bury it.
  if (a.opponents.length === b.opponents.length) {
    a.opponents.forEach((oa, i) => {
      const ob = b.opponents[i];
      for (const f of PER_OPPONENT) {
        const [x, y] = [f.of(oa), f.of(ob)];
        if (x !== y) out.push({ field: `OPPONENT ${i + 1} ${f.field}`, a: x, b: y });
      }
    });
  }
  return out;
}

// --- what is worth showing --------------------------------------------------
//
// A curated list, not every field on the record. A difference column across
// forty statistics is forty numbers to read and no finding; these are the ones
// that answer the two questions the trainer exists for — did it threaten me,
// and did it fly like a fighter or hang there like a turret — plus what YOU did,
// because the same pilot flies both halves of an A/B and is part of the result.

interface RowSpec {
  label: string;
  /** the number this row compares, or null where the record has none */
  value?: (r: CombatSimReport) => number | null;
  /** a row of words — an outcome is not subtractable */
  text?: (r: CombatSimReport) => string;
  dp?: number;
  suffix?: string;
  /** a 0..1 share, shown as a percentage and differenced in percentage points */
  percent?: boolean;
}

const GROUPS: readonly { heading: string; rows: readonly RowSpec[] }[] = [
  {
    heading: 'THE FIGHT',
    rows: [
      { label: 'OUTCOME', text: (r) => r.outcome.toUpperCase() },
      { label: 'YOUR KILLS', value: (r) => r.kills.yours },
      { label: 'LASTED', value: (r) => r.seconds, dp: 1, suffix: 's' },
      { label: 'TIME TO FIRST KILL', value: (r) => r.kills.firstAt, dp: 1, suffix: 's' },
      { label: 'TIME TO LAST KILL', value: (r) => r.kills.lastAt, dp: 1, suffix: 's' },
    ],
  },
  {
    heading: 'WHAT IT COST YOU',
    rows: [
      { label: 'DAMAGE TO YOU', value: (r) => r.them.damageToYou, dp: 1 },
      { label: 'THEIR HITS', value: (r) => r.them.hits },
      { label: 'THEIR ACCURACY', value: (r) => r.them.accuracy, percent: true },
      { label: 'THEIR SHOTS/MIN/SHIP', value: (r) => r.them.shotsPerMinutePerShip, dp: 1 },
      { label: 'THEY HELD YOUR SIX', value: (r) => r.onSixSeconds.them, dp: 1, suffix: 's' },
      { label: 'FORE SHIELD LOW', value: (r) => r.lowWater.foreShield, dp: 1 },
      { label: 'AFT SHIELD LOW', value: (r) => r.lowWater.aftShield, dp: 1 },
      { label: 'ENERGY LOW', value: (r) => r.lowWater.energy, dp: 1 },
    ],
  },
  {
    heading: 'HOW YOU DID',
    rows: [
      { label: 'YOUR SHOTS', value: (r) => r.you.shots },
      { label: 'YOUR HITS', value: (r) => r.you.hits },
      { label: 'YOUR ACCURACY', value: (r) => r.you.accuracy, percent: true },
      { label: 'DAMAGE YOU DEALT', value: (r) => r.you.damageDealt, dp: 1 },
      { label: 'YOU HELD THEIR SIX', value: (r) => r.onSixSeconds.you, dp: 1, suffix: 's' },
      { label: 'YOUR SPEED (MEDIAN)', value: (r) => r.envelope.speed?.median ?? null },
    ],
  },
  {
    heading: 'HOW THEY FLEW',
    rows: [
      { label: 'THEIR SPEED (MEDIAN)', value: (r) => r.opposition.speed?.median ?? null },
      { label: 'THEIR SPEED (P90)', value: (r) => r.opposition.speed?.p90 ?? null },
      // The spread is the measurement and not the median — an attack run sweeps
      // the band, a turret collapses it — so all three, and the reader compares
      // the SHAPE rather than one number.
      { label: 'RANGE HELD (P10)', value: (r) => r.opposition.range?.p10 ?? null },
      { label: 'RANGE HELD (MEDIAN)', value: (r) => r.opposition.range?.median ?? null },
      { label: 'RANGE HELD (P90)', value: (r) => r.opposition.range?.p90 ?? null },
      { label: 'ATTACK RUNS', value: (r) => r.opposition.passes },
      { label: 'LINED UP ON YOU', value: (r) => r.linedUpShare.them, percent: true },
    ],
  },
];

/** A number said the way its row says it — `12.3s`, `41%`, `234`. */
function fmt(x: number | null, spec: RowSpec): string {
  if (x === null) return '-';
  if (spec.percent) return `${(x * 100).toFixed(0)}%`;
  return `${x.toFixed(spec.dp ?? 0)}${spec.suffix ?? ''}`;
}

const roundTo = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/**
 * `b - a`, in the row's own unit — and `SAME` when the two records say the same
 * number, which is the whole point of showing a difference at all: the eye goes
 * to the rows that are not SAME, and those are where the two fights diverged.
 *
 * A percentage row differences in percentage POINTS, because the difference of
 * two percentages is not a percentage of anything.
 */
function delta(x: number | null, y: number | null, spec: RowSpec): string {
  if (x === null || y === null) return '-';
  const dp = spec.percent ? 0 : (spec.dp ?? 0);
  const d = spec.percent ? roundTo((y - x) * 100, 0) : roundTo(y - x, dp);
  if (d === 0) return 'SAME';
  const sign = d > 0 ? '+' : '';
  return spec.percent
    ? `${sign}${d.toFixed(0)}PP`
    : `${sign}${d.toFixed(dp)}${spec.suffix ?? ''}`;
}

// --- the comparison ---------------------------------------------------------

/**
 * Hold two records against each other.
 *
 * `a` is THIS — the record the compare view was opened from — and `b` is THAT,
 * the one being walked. Every difference is stated as `b - a`, so it reads as
 * what changed when you moved off the baseline.
 */
export function compareReports(a: CombatSimReport, b: CombatSimReport): SimComparison {
  const confounds = confoundsOf(a, b);
  const comparable = confounds.length === 0;
  const n = Math.max(a.opponents.length, b.opponents.length);
  const brains: BrainChange[] = [];
  for (let i = 0; i < n; i++) {
    const oa = a.opponents[i];
    const ob = b.opponents[i];
    brains.push({
      index: i,
      hull: (oa ?? ob)?.hull.toUpperCase() ?? '-',
      a: oa?.brain ?? '-',
      b: ob?.brain ?? '-',
      same: oa?.brain === ob?.brain,
    });
  }
  return {
    a,
    b,
    comparable,
    confounds,
    brains,
    sameBrains: brains.length > 0 && brains.every((x) => x.same),
    groups: GROUPS.map((g) => ({
      heading: g.heading,
      rows: g.rows.map((spec) => ({
        label: spec.label,
        a: spec.text ? spec.text(a) : fmt(spec.value!(a), spec),
        b: spec.text ? spec.text(b) : fmt(spec.value!(b), spec),
        // No difference on a mismatched pair, and none on a row of words. This
        // is the refusal, and it is one line because it is one rule.
        delta: !comparable || spec.text ? null : delta(spec.value!(a), spec.value!(b), spec),
      })),
    })),
  };
}

/**
 * The PAIR as JSON, because the pair is the finding.
 *
 * Both whole records go in it beside the reading, so a training run gets every
 * number at full precision AND the comparison this screen actually made —
 * including, when the two were not an A/B, the list of reasons it refused.
 */
export function comparisonJson(c: SimComparison): string {
  return JSON.stringify({
    schema: COMBAT_SIM_SCHEMA,
    kind: 'combat-sim-pair',
    comparable: c.comparable,
    confounds: c.confounds,
    brains: c.brains,
    sameBrains: c.sameBrains,
    rows: c.groups.flatMap((g) => g.rows.map((r) => ({ group: g.heading, ...r }))),
    records: [c.a, c.b],
  }, null, 1);
}
