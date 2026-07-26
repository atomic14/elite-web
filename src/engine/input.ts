export class Input {
  private readonly down = new Set<string>();
  private readonly tapped = new Map<string, number>();

  constructor() {
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

  endFrame(): void {
    this.tapped.clear();
  }
}
