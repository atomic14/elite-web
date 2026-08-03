// Extended system descriptions — an OPTIONAL overlay on the 1984 galaxy.
//
// `galaxy.ts` and `goatsoup.ts` are byte-matched to the original and are the
// source of truth (invariant 4). Nothing here edits them. This module adds a
// second paragraph beside the goat-soup line, generated offline by a model and
// committed as JSON — see docs/TODO/58 and tools/system-prompts.ts.
//
// The whole design rests on one property: **a missing entry is normal.** No
// entry for a system, no file for a galaxy, an empty overlay — every one of
// those renders exactly what the game rendered before this existed. That is
// what lets galaxy 1 ship first, lets a refused record be harmless, and stops
// generated prose from becoming load-bearing over data that is not generated.

import type { StarSystem } from './galaxy.ts';
import galaxy1 from './descriptions/galaxy-1.json' with { type: 'json' };

export interface SystemDescription {
  /** Two to four sentences on the world. */
  description: string;
  /** One to three sentences on the people. */
  inhabitants: string;
}

interface Entry extends SystemDescription {
  /** The system this was written for. Checked, not trusted — see below. */
  system: string;
  /** The prompt hash it was generated from; `--check` compares it. */
  hash: string;
}

export interface Overlay {
  galaxy: number;
  promptVersion: number;
  /** Which model wrote these, for the record. '' while unpopulated. */
  model: string;
  generated: string;
  entries: Record<string, Entry>;
}

/**
 * Galaxy 1 only, for the same reason `portraitUrl` is galaxy 1 only: the eight
 * galaxies share a name pool, so a galaxy 2 world can land on the same index
 * as a galaxy 1 world and would confidently show another planet's prose. When
 * the other seven are generated they become entries in this map and the guard
 * goes away by itself.
 */
const OVERLAYS: Record<number, Overlay> = { 1: galaxy1 as Overlay };

/**
 * What we say about this world beyond the goat-soup line, or `undefined`.
 *
 * The name check is the interesting part. Filing by index is what makes the
 * committed file small and diffable, but an index is only meaningful against
 * the galaxy that produced it — so a regenerated or mis-keyed file would put
 * Lave's paragraph under Riedquat and nothing would look wrong. Comparing the
 * stored name against the live one costs a string compare and turns that
 * failure into a silent fallback rather than a confident lie. `npm test`
 * asserts the same thing across the whole file, so the mismatch is loud in
 * CI and harmless in the browser, which is the right way round.
 */
export function systemDescription(
  sys: StarSystem, galaxy: number,
): SystemDescription | undefined {
  const entry = OVERLAYS[galaxy]?.entries[String(sys.index)];
  if (!entry || entry.system !== sys.name) return undefined;
  return { description: entry.description, inhabitants: entry.inhabitants };
}

/** The raw overlay, for tests and the drift gate. */
export function overlay(galaxy: number): Overlay | undefined {
  return OVERLAYS[galaxy];
}
