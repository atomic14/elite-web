// Keyboard state with frame-oriented semantics:
//  - held(codes): live keydown state — every continuous control, the trigger
//    included, so nothing in here can queue a shot
//  - pressed(code): consumes ONE tap; pressedCount/drainPresses consume all
//  - endFrame(): the Game calls this at the end of every fixed step
//
// A TAP THAT ARRIVED IN A BUSY FRAME IS NOT LOST — and that is a rule with a
// bound, which is the interesting half.
//
// `pressed()` takes one tap, and `endFrame()` used to clear the rest, so a
// second tap of the same key inside one frame was thrown away. At 60Hz with
// the window focused that is invisible. It is the whole story when a frame is
// slow: a throttled background tab hands a second of keystrokes to one frame,
// and three arrow presses moved a menu ONE row.
//
// So `endFrame()` now CARRIES a backlog into the next frame. The reason it
// cleared at all is still real — a paused or backgrounded game must not bank a
// hundred taps and spend them the moment the frame rate recovers — so the carry
// is deliberately the NARROWEST thing that fixes the bug, under two limits:
//
//   INTEREST. Only a key something CONSUMED this frame keeps anything. A key
//   nobody read is cleared exactly as it always was, so no key can turn up in
//   a frame that was not already asking for it. That is what keeps a command
//   from outliving the state that made it valid, and it is not theoretical:
//   the first version of this carried every unread tap, and `npm test` caught
//   a P pressed at the station pausing the game a step after you launched.
//   Tap M twice while docked now and the market opens once — the second tap is
//   offered to the market screen, which binds no M, and dies there.
//
//   COUNT. At most CARRY_LIMIT taps of a key survive a frame boundary. Mash a
//   key twenty times against a stalled loop and you get four of them (one read
//   in the busy frame, three carried), never twenty. A key merely HELD banks
//   nothing at all: auto-repeat is dropped at the listener, so holding a key is
//   one tap however long the loop is stuck. And a backlog always shrinks — a
//   key only qualifies for a carry by having a tap taken off it.
//
// Note what this cannot do: it cannot queue a SHOT. The trigger, the throttle
// and both turn axes are `held()`, which reads live key state and has no
// memory at all, so nothing in here can fire a gun for you a frame late.
//
// ONE limit for every key, deliberately — no separate bound for commands and
// navigation. This file cannot tell them apart and must not learn how: the same
// code is both depending on where you are (M is the market docked and a missile
// in flight; Enter picks a menu row and respawns you), so a per-role bound here
// would be a second, silent copy of controls.ts's tables. The interest rule is
// what a role split was really wanted for, and it costs no copy.

/**
 * How many unread taps of one key survive a frame boundary.
 *
 * Three, because that is about the most a hand delivers into a single dropped
 * frame and it is well inside one recovered frame's catch-up budget
 * (MAX_STEPS_PER_FRAME is 5), so a backlog is spent as cursor movement the
 * player asked for rather than as a burst they did not.
 */
const CARRY_LIMIT = 3;

export class Input {
  private readonly down = new Set<string>();
  /** taps waiting to be read: this frame's arrivals, plus whatever carried. */
  private readonly tapped = new Map<string, number>();
  /** codes something consumed this frame — the only ones whose backlog lives. */
  private readonly read = new Set<string>();

  /**
   * Mouse flight (pointer lock). The pointer's accumulated offset from
   * centre acts like a self-centring joystick: -1..1 on each axis, decaying
   * when the mouse is still so the ship settles rather than drifting.
   */
  mouseFlight = false;
  mouseX = 0;
  mouseY = 0;
  mouseFire = false;
  private readonly canvas: HTMLElement | null;

  constructor() {
    // No DOM, no listeners — the key STATE above is portable, only the wiring
    // is not, and a headless Game drives that state directly. Same bargain as
    // game/storage.ts with localStorage and world/corona-texture.ts with canvas: the
    // file that knows about the platform is the file that copes with it being
    // absent. Without this, `new Input()` in a field initializer made the whole
    // Game unconstructible under node.
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.canvas = null;
      return;
    }
    this.canvas = document.getElementById('scene');
    document.addEventListener('pointerlockchange', () => {
      this.mouseFlight = document.pointerLockElement === this.canvas;
      if (!this.mouseFlight) {
        this.mouseX = 0;
        this.mouseY = 0;
        this.mouseFire = false;
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.mouseFlight) return;
      // ~450px of travel = full deflection
      this.mouseX = Math.max(-1, Math.min(1, this.mouseX + e.movementX / 450));
      this.mouseY = Math.max(-1, Math.min(1, this.mouseY + e.movementY / 450));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.mouseFlight && e.button === 0) this.mouseFire = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (this.mouseFlight && e.button === 0) this.mouseFire = false;
    });
    window.addEventListener('keydown', (e) => {
      // auto-repeat is not a tap. This is also what makes the carry in
      // endFrame() safe against a stalled loop: a key HELD across a stall
      // arrives as one tap, not as however many the OS repeated.
      if (e.repeat) return;
      // '?' gets its own virtual code so shift+/ works even when the shift
      // keydown itself isn't observable (e.g. synthetic events)
      const code = e.code === 'Slash' && e.shiftKey ? 'Question' : e.code;
      this.down.add(code);
      this.tapped.set(code, (this.tapped.get(code) ?? 0) + 1);
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'Slash') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (e.code === 'Slash') this.down.delete('Question');
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  /**
   * Queue a press as though the key had been struck — lets clickable UI
   * reuse exactly the same handlers as the keyboard (including virtual
   * codes like 'VirtBuyMax' that no physical key produces).
   *
   * It arrives THIS frame, exactly as a keystroke would — and is dropped at
   * the end of it unless something read that key, exactly as a keystroke is.
   */
  injectPress(code: string): void {
    this.tapped.set(code, (this.tapped.get(code) ?? 0) + 1);
  }

  held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True once per physical key press; consumed on read. */
  pressed(code: string): boolean {
    const n = this.tapped.get(code) ?? 0;
    if (n <= 0) return false;
    this.tapped.set(code, n - 1);
    // somebody is draining this key, which is what earns its backlog a carry
    this.read.add(code);
    return true;
  }

  /** Number of presses since last read; consumed on read. */
  pressedCount(code: string): number {
    const n = this.tapped.get(code) ?? 0;
    this.tapped.delete(code);
    return n;
  }

  /** All pressed key codes this frame (oldest first); consumed on read. */
  drainPresses(): string[] {
    const codes: string[] = [];
    for (const [code, n] of this.tapped) {
      for (let i = 0; i < n; i++) codes.push(code);
    }
    this.tapped.clear();
    return codes;
  }

  /** Ask the browser for pointer lock (must be inside a user gesture). */
  requestMouseFlight(): void {
    this.canvas?.requestPointerLock();
  }

  releaseMouseFlight(): void {
    if (this.mouseFlight) document.exitPointerLock();
  }

  /** Self-centring: without input the virtual stick eases back to neutral. */
  decayMouse(dt: number): void {
    const k = Math.max(0, 1 - dt * 1.5);
    this.mouseX *= k;
    this.mouseY *= k;
  }

  /**
   * Close the frame: keep the backlog of a key somebody is reading, drop
   * everything else exactly as this method always did.
   *
   * See the header for both limits. In one line: a key that was read this
   * frame keeps up to CARRY_LIMIT of what is left, and a key that was not
   * keeps nothing. The backlog shrinks by at least one every frame it
   * survives, because a key is only in `read` when a tap of it was taken.
   */
  endFrame(): void {
    for (const [code, n] of [...this.tapped]) {
      if (this.read.has(code) && n > 0) this.tapped.set(code, Math.min(n, CARRY_LIMIT));
      else this.tapped.delete(code);
    }
    this.read.clear();
  }
}
