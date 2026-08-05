// The 1984 chart metric: the two numbers that turn a pair of chart coordinates
// into a distance in tenths of a light year, and the span of the coordinate
// space every chart projects.
//
// The arithmetic is `distanceTenths` in galaxy/navigation.ts, whose header
// records that the rule had grown three implementations before it existed. It
// then grew a fourth in galaxy/living.ts. These two numbers had grown further
// still, because a chart is DRAWN as well as measured: ui/screens.ts plotted
// `y / 2` and sized the fuel-range marker at `fuel / 4` in both projections,
// which is this metric and its inverse written out four more times.
//
// A tenth of a light year is also the unit the fuel tank holds, so a jump's
// fare and the reach of a full tank are the same quantity as a chart distance.
// That is why there is no light-years-per-unit-of-fuel constant anywhere.

/**
 * Tenths of a light year in one unit of chart x.
 *
 * The scale that makes the original's numbers come out: a full 70-tenth tank is
 * the classic 7.0 LY, and the fuel-range marker on either chart is drawn at a
 * radius of `fuel / TENTHS_PER_CHART_UNIT` chart units, which is this read
 * backwards.
 */
export const TENTHS_PER_CHART_UNIT = 4;

/**
 * ...and the asymmetry: chart y counts for half of chart x.
 *
 * The original's metric, because its chart is drawn half-height — the galaxy is
 * 256 units across and 128 tall, and a step north is half the light years of a
 * step east. Both charts plot `y / CHART_Y_SQUASH` for the same reason, which
 * is what makes the short-range chart's fuel marker a true circle: dividing the
 * plotted axis by the same number the metric does leaves the drawn space
 * isotropic.
 */
export const CHART_Y_SQUASH = 2;

/**
 * The width of the coordinate space every chart projects: `StarSystem.x` runs
 * 0-255, the top byte of a 16-bit seed word — the original's chart grid IS
 * this span rather than a number anyone at Harmless chose.
 *
 * TWO CHARTS FIT THE WHOLE GALAXY AGAINST IT, which is what makes it a rule
 * and not a fact local to one drawing. The encyclopaedia's canvas
 * (`encyclopaedia/chart.ts`) divides the viewport by `CHART_SPAN_X + 12` to
 * leave a margin; the game's own short-range chart (`ui/screens.ts` via
 * `game/screens/chart.ts`) still writes `target.width / 256` as a bare
 * literal that has not been brought here — see
 * docs/TODO/90-constants-cleanup.md.
 */
export const CHART_SPAN_X = 256;

/**
 * ...and the height, which is HALF of that — `CHART_Y_SQUASH` restated as a
 * span rather than a divisor, so "the chart is drawn half-height" is one fact
 * instead of two. It was a second literal, 128, sitting inside
 * `encyclopaedia/chart.ts` beside a comment that already explained the
 * halving without naming it.
 */
export const CHART_SPAN_Y = CHART_SPAN_X / CHART_Y_SQUASH;

/**
 * The console's short-range chart: canvas px per chart unit.
 *
 * Bounded by the range circle, not by taste: a full tank is 7.0 LY, drawn at
 * `(fuel / TENTHS_PER_CHART_UNIT) * LOCAL_SCALE` = 17.5 x LOCAL_SCALE px. At
 * 15 that is 262px, which fits inside the `LOCAL_CANVAS` square with room to
 * spare. Raise one and you must raise the other or the range clips again.
 */
export const LOCAL_SCALE = 15;

/** Square, so a light year is the same number of pixels whichever way you go. */
export const LOCAL_CANVAS = 560;
