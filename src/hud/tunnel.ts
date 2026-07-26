// The classic station tunnel: concentric rings rushing past on launch and
// docking, drawn on a full-screen overlay canvas.

export class TunnelEffect {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private timer = 0;
  private duration = 1.4;

  constructor() {
    this.canvas = document.getElementById('tunnel') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
  }

  get active(): boolean {
    return this.timer > 0;
  }

  start(duration = 1.4): void {
    this.timer = duration;
    this.duration = duration;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.display = 'block';
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
    const maxR = Math.hypot(w, h) / 2;

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
      // slightly squashed ring reads as a docking bay mouth
      ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // radial motion spokes
    ctx.strokeStyle = 'rgba(77, 255, 92, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.15;
      const inner = Math.pow((t * 1.15) % 1, 3) * maxR * 0.15 + 20;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner * 0.62);
      ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR * 0.62);
      ctx.stroke();
    }
  }
}
