// The tech level scale: the shown range every system's byte can encode.
//
// galaxy/galaxy.ts's own algorithm computes a raw techLevel of
// `((s1>>8)&3) + (economy^7) + (government>>1)`, plus one more if government
// is odd — a raw range of 0 to 14: the first term tops out at 3, `economy^7`
// at 7 (economy is a 3-bit field), the shifted government at 3, and the odd
// bonus adds the last point. Every reader of it adds one before showing it —
// `ui/screens.ts`, `encyclopaedia/entry.ts`, and this scale's own consumer in
// `encyclopaedia/filters.ts` — which is what turns 0-14 into the shown 1-15.
//
// It cannot be expressed as that arithmetic: this directory may not import
// galaxy.ts, so the ceiling is a literal with its derivation written out
// rather than a read of the algorithm. Nothing else in the game states this
// range by name today; the encyclopaedia's filter is the first thing to need
// it as a bound rather than as a per-system fact.

/** The lowest tech level any system shows. */
export const TECH_MIN = 1;

/** The highest — the algorithm's own ceiling of 14, shown as 15. */
export const TECH_MAX = 15;
