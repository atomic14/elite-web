// Keyboard state with frame-oriented semantics:
//  - held(codes): live keydown state (continuous controls)
//  - pressed(code): consumes ONE tap; pressedCount/drainPresses consume all
//  - endFrame(): Game.update calls this every frame so taps never leak
//    across frames (multiple taps within one frame are counted, not lost)
export class Input {
  private readonly down = new Set<string>();
  private readonly tapped = new Map<string, number>();

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
    // game/storage.ts with localStorage and world/sun.ts with the canvas: the
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
    return true;
  }

  /** Number of presses since last read; consumed on read. */
  pressedCount(code: string): number {
    const n = this.tapped.get(code) ?? 0;
    this.tapped.delete(code);
    return n;
  }

  /** All pressed key codes this frame (in insertion order); consumed on read. */
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

  endFrame(): void {
    this.tapped.clear();
  }
}
