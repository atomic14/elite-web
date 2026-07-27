// The classic station tunnel: concentric rings rushing past on launch and
// docking, drawn on a full-screen overlay canvas.
//
// The rings alone used to simply stop — the overlay was hidden and the
// universe appeared in a single frame. Instead the tube now finishes: an
// aperture opens through the black (or closes over it, when docking), so you
// fly out of the bay mouth into space rather than cutting to it.

/** Which way you're going through the tube. */
export type TunnelMode =
  /** launch / witch-space arrival: the mouth opens and reveals the universe */
  | 'out'
  /** docking: the bay closes over you */
  | 'in';

/** Vertical squash — a circle read flat looks like a docking bay mouth. */
const SQUASH = 0.62;
/** Fraction of the effect spent rushing before the mouth starts to open. */
const OPEN_AT = 0.42;
/** Fraction by which the bay has fully closed on the way in. */
const CLOSED_BY = 0.78;

export class TunnelEffect {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private timer = 0;
  private duration = 1.4;
  private mode: TunnelMode = 'out';

  constructor() {
    this.canvas = document.getElementById('tunnel') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
  }

  get active(): boolean {
    return this.timer > 0;
  }

  start(duration = 1.4, mode: TunnelMode = 'out'): void {
    this.timer = duration;
    this.duration = duration;
    this.mode = mode;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = 'block';
  }

  /**
   * How much of the view is open to space, in screen radii. 0 is fully
   * blacked out; >1 means the mouth has passed the edge of the screen and
   * nothing of the tube is left.
   */
  private aperture(p: number): number {
    if (this.mode === 'out') {
      if (p < OPEN_AT) return 0;
      const k = (p - OPEN_AT) / (1 - OPEN_AT);
      return Math.pow(k, 2.2) * 1.45; // accelerating, like clearing the slot
    }
    // docking: the mouth is wide as you enter and shuts around you
    const k = Math.min(1, p / CLOSED_BY);
    return (1 - Math.pow(k, 1.7)) * 1.45;
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    // track window resizes mid-effect
    if (this.canvas.width !== window.innerWidth || this.canvas.height !== window.innerHeight) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }
    if (this.timer <= 0) {
      this.canvas.style.display = 'none';
      return;
    }

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const t = this.duration - this.timer;
    const p = Math.min(1, t / this.duration);
    const maxR = Math.hypot(w, h) / 2;
    const open = this.aperture(p) * maxR;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // rings accelerate outward as they approach (cubic phase)
    const rings = 14;
    for (let i = 0; i < rings; i++) {
      const phase = (t * 1.15 + i / rings) % 1;
      const r = Math.pow(phase, 3) * maxR;
      if (r < 2) continue;
      const bright = Math.min(1, phase * 2.2);
      ctx.strokeStyle = `rgba(77, 255, 92, ${bright * 0.85})`;
      ctx.lineWidth = 1 + phase * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * SQUASH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // radial motion spokes
    ctx.strokeStyle = 'rgba(77, 255, 92, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.15;
      const inner = Math.pow((t * 1.15) % 1, 3) * maxR * 0.15 + 20;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * SQUASH);
      ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR * SQUASH);
      ctx.stroke();
    }

    if (open > 1) {
      // Punch the bay mouth clean through the overlay — black, rings and all —
      // so the real scene shows through it. This is the reveal: by the end the
      // hole is larger than the screen and there is nothing left to hide.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(cx, cy, open, open * SQUASH, 0, 0, Math.PI * 2);
      ctx.fill();

      // ...and put a lit rim back on the edge, so the mouth reads as structure
      // rushing past rather than a hole appearing.
      ctx.globalCompositeOperation = 'source-over';
      const rim = this.mode === 'out'
        ? Math.max(0, 1 - (open / maxR - 1) * 1.6) // fades as it leaves frame
        : 1;
      if (rim > 0.01) {
        ctx.strokeStyle = `rgba(77, 255, 92, ${0.9 * rim})`;
        ctx.lineWidth = 2 + 3 * rim;
        ctx.beginPath();
        ctx.ellipse(cx, cy, open, open * SQUASH, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}
