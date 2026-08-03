// The 256-world map: a canvas, a pan, a zoom and a hit test.
//
// Deliberately NOT the game's chart (game/screens/chart.ts). That one is a
// Screen — it owns a cursor, a fuel radius, the jump target and the route, and
// it answers to a ChartContext that only a running Game can supply. Reusing it
// here would mean either dragging the Game in or hollowing it out; this needs
// none of what makes it useful in flight.
//
// What is shared is the only thing that matters: the coordinates come from
// `generateGalaxy`, so the shape of the sky is the same shape the game flies.

import type { Entry } from './entry.ts';

/**
 * Chart coordinates are x 0-255, y 0-255 with the chart drawn at half height —
 * that halving is the 1984 convention (galaxy.ts documents it on StarSystem)
 * and it is what makes the galaxy the wide band everyone recognises rather
 * than a square.
 */
const SPAN_X = 256;
const SPAN_Y = 128;

export interface View {
  /** Screen pixels per chart unit at zoom 1. Recomputed on resize. */
  scale: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface ChartTheme {
  dim: string;
  lit: string;
  selected: string;
  label: string;
}

const THEME: ChartTheme = {
  dim: 'rgba(51, 255, 51, 0.16)',
  lit: 'rgba(51, 255, 51, 0.92)',
  selected: '#ffcc33',
  label: 'rgba(51, 255, 51, 0.75)',
};

export class Chart {
  private view: View = { scale: 1, zoom: 1, panX: 0, panY: 0 };

  private ctx: CanvasRenderingContext2D;

  private hovered: string | null = null;

  private selected: string | null = null;

  private lit: Set<string> | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private entries: Entry[],
    private onPick: (slug: string) => void,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('chart: no 2d context');
    this.ctx = ctx;
    this.bind();
    this.resize();
  }

  /** Which worlds are currently in the filter. `null` means all of them. */
  setLit(lit: Set<string> | null): void {
    this.lit = lit;
    this.draw();
  }

  select(slug: string | null): void {
    this.selected = slug;
    this.draw();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the whole galaxy with a small margin, then let zoom take over.
    this.view.scale = Math.min(w / (SPAN_X + 12), h / (SPAN_Y + 12));
    this.draw();
  }

  private toScreen(e: Entry): [number, number] {
    const { scale, zoom, panX, panY } = this.view;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [
      w / 2 + (e.x - SPAN_X / 2) * scale * zoom + panX,
      h / 2 + (e.y / 2 - SPAN_Y / 2) * scale * zoom + panY,
    ];
  }

  /**
   * Nearest world within a generous radius, or null.
   *
   * Generous on purpose: at full zoom-out the galaxy is 256 units across in a
   * few hundred pixels, so stars sit a couple of pixels apart and an exact hit
   * test would be unusable with a mouse and impossible with a finger.
   */
  private pick(px: number, py: number): Entry | null {
    let best: Entry | null = null;
    let bestD = 14 * 14;
    for (const e of this.entries) {
      if (this.lit && !this.lit.has(e.slug)) continue;
      const [x, y] = this.toScreen(e);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  private bind(): void {
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const local = (ev: PointerEvent): [number, number] => {
      const r = this.canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };

    this.canvas.addEventListener('pointerdown', (ev) => {
      dragging = true; moved = 0;
      [lastX, lastY] = local(ev);
      this.canvas.setPointerCapture(ev.pointerId);
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      const [x, y] = local(ev);
      if (dragging) {
        moved += Math.abs(x - lastX) + Math.abs(y - lastY);
        this.view.panX += x - lastX;
        this.view.panY += y - lastY;
        lastX = x; lastY = y;
        this.draw();
        return;
      }
      const hit = this.pick(x, y);
      const slug = hit?.slug ?? null;
      if (slug !== this.hovered) {
        this.hovered = slug;
        this.canvas.style.cursor = slug ? 'pointer' : 'grab';
        this.draw();
      }
    });

    const release = (ev: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      // A drag that barely moved is a click. Without this threshold every
      // attempt to pan off a star also selected it.
      if (moved < 4) {
        const hit = this.pick(...local(ev));
        if (hit) this.onPick(hit.slug);
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', () => { dragging = false; });

    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const [x, y] = [ev.offsetX, ev.offsetY];
      const before = this.view.zoom;
      const next = Math.min(8, Math.max(1, before * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (next === before) return;
      // Keep the point under the cursor fixed, or zooming walks the galaxy
      // out from under the pointer.
      const w = this.canvas.clientWidth / 2;
      const h = this.canvas.clientHeight / 2;
      this.view.panX = x - (x - this.view.panX - w) * (next / before) - w;
      this.view.panY = y - (y - this.view.panY - h) * (next / before) - h;
      this.view.zoom = next;
      this.draw();
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  reset(): void {
    this.view.zoom = 1;
    this.view.panX = 0;
    this.view.panY = 0;
    this.draw();
  }

  draw(): void {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const r = Math.max(1.6, 2.1 * Math.sqrt(this.view.zoom));

    for (const e of this.entries) {
      const on = !this.lit || this.lit.has(e.slug);
      const [x, y] = this.toScreen(e);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;

      const isSel = e.slug === this.selected;
      const isHov = e.slug === this.hovered;
      ctx.beginPath();
      ctx.arc(x, y, isSel ? r + 2.2 : r, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? THEME.selected : on ? THEME.lit : THEME.dim;
      ctx.fill();

      if (isSel) {
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = THEME.selected;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Names only when there is room for them: every star labelled at zoom 1
      // is 256 overlapping words and no map at all.
      if (isSel || isHov || (on && this.view.zoom >= 3.2)) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = isSel ? THEME.selected : THEME.label;
        ctx.fillText(e.name.toUpperCase(), x + r + 5, y + 4);
      }
    }
  }
}
