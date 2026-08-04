// Which worlds the rail is currently showing. Pure: a filter and a list in,
// a set of slugs out. No DOM, so the chart and the static index can both be
// painted from one answer instead of each deciding for itself.

import { ECONOMY_NAMES, GOVERNMENT_NAMES } from '../galaxy/galaxy.ts';
import { TECH_MIN, TECH_MAX } from '../constants/tech-level.ts';
import type { Entry } from './entry.ts';

export interface Filter {
  /** Empty means every economy — not "no economies". Same for governments. */
  economies: Set<number>;
  governments: Set<number>;
  /** Inclusive, in shown units (1-15). */
  techMin: number;
  techMax: number;
  species: Set<string>;
  /** Matched against the name, case-insensitively. */
  search: string;
}

export const emptyFilter = (): Filter => ({
  economies: new Set(),
  governments: new Set(),
  techMin: TECH_MIN,
  techMax: TECH_MAX,
  species: new Set(),
  search: '',
});

/**
 * An empty set means "no constraint", which is the opposite of what a set
 * usually means and is worth being explicit about: a rail with nothing ticked
 * shows everything, because that is what a person expects of a filter they
 * have not touched yet. Ticking one economy narrows to it.
 */
export function matches(e: Entry, f: Filter): boolean {
  if (f.economies.size && !f.economies.has(e.economy)) return false;
  if (f.governments.size && !f.governments.has(e.government)) return false;
  if (e.techLevel < f.techMin || e.techLevel > f.techMax) return false;
  if (f.species.size && !f.species.has(e.species)) return false;
  if (f.search && !e.name.toLowerCase().includes(f.search.toLowerCase())) return false;
  return true;
}

export const selectSlugs = (entries: Entry[], f: Filter): Set<string> =>
  new Set(entries.filter((e) => matches(e, f)).map((s) => s.slug));

export const isUntouched = (f: Filter): boolean =>
  f.economies.size === 0 && f.governments.size === 0 && f.species.size === 0
  && f.techMin === TECH_MIN && f.techMax === TECH_MAX && f.search === '';

/** The rail's options, derived from the data rather than hand-listed. */
export interface Facets {
  economies: { value: number; label: string; count: number }[];
  governments: { value: number; label: string; count: number }[];
  species: { value: string; count: number }[];
}

export function facetsOf(entries: Entry[]): Facets {
  const tally = <K>(key: (e: Entry) => K) => {
    const m = new Map<K, number>();
    for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return m;
  };

  const eco = tally((e) => e.economy);
  const gov = tally((e) => e.government);
  const spe = tally((e) => e.species);

  return {
    // Economy and government keep their 1984 order, because that order is the
    // one the game shows everywhere else and a reader moving between the two
    // should not have to re-find their place.
    economies: [...eco.entries()].sort((a, b) => a[0] - b[0])
      .map(([value, count]) => ({ value, label: ECONOMY_NAMES[value], count })),
    governments: [...gov.entries()].sort((a, b) => a[0] - b[0])
      .map(([value, count]) => ({ value, label: GOVERNMENT_NAMES[value], count })),
    // Species has no canonical order and 30-odd values, so the commonest
    // first is the only ordering that helps.
    species: [...spe.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([value, count]) => ({ value, count })),
  };
}
