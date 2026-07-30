// A DOM element that accepts every write and performs none of them.
//
// The painters — hud.ts, tunnel.ts — cache elements in field initializers, so a
// single `document.getElementById` in any of them made the whole `Game`
// unconstructible under node. That is why the largest file in the project had
// zero test coverage: not because the orchestrator needed a browser, but
// because three of its fields did.
//
// The bargain is the same one game/storage.ts makes with localStorage and
// world/sun.ts makes with the canvas: the code that knows about the platform is
// the code that copes with the platform being absent. None of what a painter
// does has to SUCCEED for the game to be correct — the HUD is a dumb painter
// (CLAUDE.md invariant 15) and nothing reads it back — it only has to not throw.
//
// This is emphatically not a DOM implementation. If a rule ever depends on what
// one of these returns, that rule is in the wrong file.

/** An element-shaped sink. Reads give empty values; writes go nowhere. */
export function inertElement(): HTMLElement {
  const el = {
    textContent: '',
    innerHTML: '',
    width: 0,
    height: 0,
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: {
      add: () => {}, remove: () => {}, toggle: () => false, contains: () => false,
    },
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    /** a 2D context whose every method is a no-op, for the two canvases */
    getContext: () => new Proxy({}, {
      get: (_t, prop) => (prop === 'canvas' ? el : () => undefined),
      set: () => true,
    }),
  };
  return el as unknown as HTMLElement;
}

/** `getElementById`, or an inert stand-in when there is no document. */
export function elementById(id: string): HTMLElement {
  if (typeof document === 'undefined') return inertElement();
  return document.getElementById(id) ?? inertElement();
}

/**
 * The viewport, or a sensible pretend one with no window.
 *
 * The tunnel sizes its canvas to the window every frame it runs. That was the
 * last thing standing between a headless Game and a LAUNCH — and it was found
 * by the headless test, not by the compiler, because DOM globals are ambient
 * and `window.innerWidth` type-checks perfectly in a file that can never run.
 */
export function viewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  return { width: window.innerWidth, height: window.innerHeight };
}
