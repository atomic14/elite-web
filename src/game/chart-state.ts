// Where the cursor is on the galactic chart, and what you have targeted.
//
// A four-line file, and it earns its place by DIRECTION rather than size. This
// is saved state — it is a field of `GameState`, it goes into the snapshot, and
// a restore puts your target back. It used to be declared in `ui/screens.ts`,
// which meant the shape of a save was defined by the renderer and `state.ts`
// imported the UI to describe itself. That is backwards, and it is what dragged
// `ui/screens.ts` into four of the project's five import cycles.
//
// The chart's DRAWING stays in the UI. Only the state it draws lives here.

export interface ChartState {
  /** chart-space cursor, in the same units the chart is drawn in */
  cursorX: number;
  cursorY: number;
  /** the selected system, or null for none — what the jump reads */
  targetIndex: number | null;
}
