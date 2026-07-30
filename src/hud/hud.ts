import { elementById } from '../engine/inert-dom.ts';
import * as THREE from 'three';
import type { StarSystem } from '../galaxy/galaxy.ts';
import { describeSystem } from '../galaxy/galaxy.ts';
import { formatCredits } from '../game/commander.ts';

// The classic console: elliptical 3D scanner (dot + vertical stick per
// contact), station compass, gauge bars, and the message line.

/** Scanner range — also the distance at which the console's 'S' lights. */
export const SCANNER_RANGE = 6000;
const GREEN = '#4dff5c';
const DIM = '#1d6b26';
const AMBER = '#ffb444';

export type ContactKind =
  'station' | 'ship' | 'hostile' | 'asteroid' | 'missile' | 'cargo' | 'thargoid';

export interface ScannerContact {
  position: THREE.Vector3;
  kind: ContactKind;
}

const CONTACT_COLORS: Record<ContactKind, string> = {
  station: '#4dff5c',
  ship: '#ffd24d',
  hostile: '#ff5c4d',
  asteroid: '#b9b9a5',
  missile: '#ff9a3c',
  cargo: '#8ad0ff',
  thargoid: '#d05cff',
};

export interface HudState {
  speedFrac: number;
  rollFrac: number; // -1..1
  pitchFrac: number; // -1..1
  foreShield: number; // 0..1
  aftShield: number; // 0..1
  energy: number; // 0..4
  fuelFrac: number;
  laserTemp: number; // 0..1
  altitudeFrac: number;
  cabinTemp: number; // 0..1
  missiles: number;
  locked: boolean;
  condition: 'GREEN' | 'YELLOW' | 'RED';
  credits: number;
  /** 0 front, 1 rear, 2 left, 3 right. */
  view: number;
  /** current view has a laser mount → show the crosshair */
  hasLaser: boolean;
  /** name + range of the ship under the crosshair ('' when none) */
  shipId: string;
  /** docking aid: station-local lateral offset + signed roll error, or null */
  /**
   * Docking state. Once drove a separate corner overlay; that is gone — the
   * port marker says whether you are lined up, and saying it twice in two
   * places was worse than saying it once. Only `inSlot` is read now.
   */
  dockAid: { x: number; y: number; roll: number; inSlot: boolean; rollOk: boolean } | null;
  /**
   * Where the docking slot is on screen (NDC), when you're close and on the
   * right side of the station. `behind` means it's off past the edge of the
   * view — the marker becomes an arrow rather than a bracket.
   */
  slotMarker: { x: number; y: number; behind: boolean } | null;
  /** nearest hostile, for the off-screen threat arrow; `count` = hostiles near */
  threatMarker: { x: number; y: number; behind: boolean; count: number } | null;
  /** combat computer engaged (shown in the view label slot) */
  assist: boolean;
  /** missile armed but not yet locked (yellow pylon) */
  armed: boolean;
  /** console 'S': the space station is within scanner range */
  stationInRange: boolean;
  /** console 'E': an E.C.M. broadcast was detected recently */
  ecmDetected: boolean;
}

/** A ship to bracket on screen, in normalised device coords (-1..1). */
export interface ScreenTarget {
  x: number;
  y: number;
  /** on-screen size, 0..1 of half-height */
  size: number;
  hostile: boolean;
  locked: boolean;
  hp: number;
  label: string;
  /** where to aim to hit it, if it's worth leading */
  lead?: { x: number; y: number };
}

const VIEW_NAMES = ['', 'REAR VIEW', 'LEFT VIEW', 'RIGHT VIEW'];

export class Hud {
  private readonly scanner: CanvasRenderingContext2D;
  private readonly compass: CanvasRenderingContext2D;
  private readonly speedEl = byId('g-speed');
  private readonly rollEl = byId('g-roll');
  private readonly pitchEl = byId('g-pitch');
  private readonly foreEl = byId('g-fore');
  private readonly aftEl = byId('g-aft');
  private readonly fuelEl = byId('g-fuel');
  private readonly laserEl = byId('g-laser');
  private readonly altEl = byId('g-alt');
  private readonly cabinEl = byId('g-cabin');
  private readonly viewEl = byId('viewlabel');
  private readonly shipIdEl = byId('shipid');
  private readonly crosshairEl = byId('crosshair');
  private readonly reticle: CanvasRenderingContext2D;
  private readonly energySegs: HTMLElement[];
  private readonly missileEls: HTMLElement[];
  private readonly lockEl = byId('lock');
  private readonly indS = byId('ind-s');
  private readonly indE = byId('ind-e');
  private readonly conditionEl = byId('condition');
  private readonly creditsEl = byId('credits-display');
  private readonly messageEl = byId('message');
  private readonly flashEl = byId('damage-flash');

  private messageTimer = 0;

  private readonly local = new THREE.Vector3();
  private readonly invQ = new THREE.Quaternion();

  constructor() {
    this.scanner = (byId('scanner') as HTMLCanvasElement).getContext('2d')!;
    this.reticle = (byId('reticle') as HTMLCanvasElement).getContext('2d')!;
    this.compass = (byId('compass') as HTMLCanvasElement).getContext('2d')!;
    this.energySegs = Array.from(byId('g-energy').querySelectorAll('i'));
    this.missileEls = Array.from(byId('missiles').querySelectorAll('span'));
  }

  setSystem(system: StarSystem): void {
    byId('system-name').textContent = describeSystem(system);
  }

  showMessage(text: string, seconds = 3): void {
    this.messageEl.textContent = text;
    this.messageTimer = seconds;
  }

  flashDamage(): void {
    this.flashEl.classList.add('hit');
    // force reflow so re-adding restarts the fade
    void this.flashEl.offsetWidth;
    this.flashEl.classList.remove('hit');
  }

  render(
    dt: number,
    state: HudState,
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    contacts: ScannerContact[],
    compassTarget: THREE.Vector3,
  ): void {
    this.messageTimer -= dt;
    if (this.messageTimer <= 0 && this.messageEl.textContent) this.messageEl.textContent = '';

    this.speedEl.style.width = `${state.speedFrac * 100}%`;
    this.rollEl.style.left = `${50 + state.rollFrac * 45}%`;
    this.pitchEl.style.left = `${50 + state.pitchFrac * 45}%`;
    this.foreEl.style.width = `${state.foreShield * 100}%`;
    this.aftEl.style.width = `${state.aftShield * 100}%`;
    this.fuelEl.style.width = `${state.fuelFrac * 100}%`;
    this.laserEl.style.width = `${state.laserTemp * 100}%`;
    this.laserEl.style.background = state.laserTemp > 0.8 ? '#ff4d4d' : '';
    this.altEl.style.width = `${Math.min(100, state.altitudeFrac * 100)}%`;
    this.cabinEl.style.width = `${Math.min(100, state.cabinTemp * 100)}%`;
    this.cabinEl.style.background = state.cabinTemp > 0.72 ? '#ff4d4d' : '';
    this.viewEl.textContent = state.assist ? '◆ COMBAT COMPUTER ◆' : (VIEW_NAMES[state.view] ?? '');
    this.crosshairEl.style.display = state.hasLaser ? '' : 'none';
    this.shipIdEl.textContent = state.shipId;
    this.energySegs.forEach((seg, i) => {
      seg.style.setProperty('--fill', String(Math.max(0, Math.min(1, state.energy - i))));
    });
    this.missileEls.forEach((m, i) => {
      const active = i === state.missiles - 1;
      m.classList.toggle('spent', i >= state.missiles);
      m.classList.toggle('armed', state.armed && active);
      m.classList.toggle('locked', state.locked && active);
    });
    this.indS.classList.toggle('lit', state.stationInRange);
    this.indE.classList.toggle('lit-amber', state.ecmDetected);
    this.lockEl.textContent = ''; // lock is shown by the bracket + missile pylon
    this.conditionEl.textContent = `CONDITION: ${state.condition}`;
    this.conditionEl.style.color = state.condition === 'RED' ? '#ff4d4d' : '';
    this.creditsEl.textContent = formatCredits(state.credits);

    // No separate docking-aid overlay: the port marker already says whether
    // you are lined up, and two things telling you the same thing in different
    // corners of the screen is worse than one. dockAid survives purely as the
    // source of that lined-up state.
    this.drawSlotMarker(state.slotMarker, state.dockAid?.inSlot ?? false);
    this.drawThreatMarker(state.threatMarker);
    this.drawScanner(playerPos, playerQuat, contacts);
    this.drawCompass(playerPos, playerQuat, compassTarget);
  }

  /**
   * Brackets around nearby ships, with a lead marker showing where to aim
   * at the locked target. Purely an aiming affordance — the laser still
   * hits on its own cone test.
   */
  drawTargets(targets: ScreenTarget[]): void {
    const ctx = this.reticle;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (const t of targets) {
      const x = (t.x * 0.5 + 0.5) * w;
      const y = (-t.y * 0.5 + 0.5) * h;
      const r = Math.max(14, Math.min(120, t.size * h * 0.5));
      const colour = t.locked ? '#ff4d4d' : t.hostile ? '#ff9a5c' : DIM;
      ctx.strokeStyle = colour;
      ctx.lineWidth = t.locked ? 2 : 1;
      // corner brackets
      const c = r * 0.4;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + sx * r, y + sy * r - sy * c);
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * r - sx * c, y + sy * r);
        ctx.stroke();
      }
      ctx.font = '10px Menlo, Consolas, monospace';
      if (t.locked) {
        ctx.fillStyle = colour;
        ctx.fillText(t.label, x - r, y - r - 6);
        // hull bar
        ctx.fillStyle = '#ff4d4d';
        ctx.fillRect(x - r, y + r + 5, 2 * r * Math.max(0, t.hp), 2);
        ctx.strokeStyle = DIM;
        ctx.strokeRect(x - r, y + r + 5, 2 * r, 2);
      }
      if (t.lead) {
        const lx = (t.lead.x * 0.5 + 0.5) * w;
        const ly = (-t.lead.y * 0.5 + 0.5) * h;
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
        ctx.moveTo(lx - 10, ly); ctx.lineTo(lx - 3, ly);
        ctx.moveTo(lx + 3, ly); ctx.lineTo(lx + 10, ly);
        ctx.stroke();
      }
    }
  }

  resizeOverlay(w: number, h: number): void {
    this.reticle.canvas.width = w;
    this.reticle.canvas.height = h;
  }

  /**
   * Docking alignment aid: the slot aperture as a rectangle, your lateral
   * offset as a dot (green when you'd fit through), and the slot's rotation
   * as a bar (green when your roll matches within tolerance).
   */
  /**
   * Point at the docking slot. Close in, the station fills the view and the
   * entrance is easily off to one side or past the edge of the screen, which
   * reads as "there is no entrance". Brackets it when visible; an arrow at the
   * screen edge when it isn't. Drawn on the reticle canvas, which drawTargets
   * has already cleared this frame.
   */
  /**
   * An arrow at the edge of the screen pointing at something you cannot see.
   *
   * Shared by the docking port and the nearest hostile, because it is the same
   * question in both cases — "which way do I turn?" — and it should look and
   * behave identically whichever is asking.
   */
  private drawEdgeArrow(marker: { x: number; y: number }, colour: string, label: string): void {
    const ctx = this.reticle;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    const len = Math.max(1e-3, Math.hypot(marker.x, marker.y));
    const nx = marker.x / len;
    const ny = marker.y / len;
    const ex = (nx * 0.82 * 0.5 + 0.5) * w;
    const ey = (-ny * 0.82 * 0.5 + 0.5) * h;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(-ny, nx));
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = '10px Menlo, Consolas, monospace';
    ctx.fillText(label, ex - label.length * 3, ey + 26);
  }

  /**
   * Red arrow towards the nearest hostile, when it is not on screen.
   *
   * Only when off screen: a ship you can see already has brackets round it,
   * and an arrow pointing at something in plain view is noise. Off screen it
   * answers the question that actually gets you killed — being shot from
   * somewhere you are not looking.
   */
  private drawThreatMarker(marker: HudState['threatMarker']): void {
    if (!marker) return;
    const onScreen = !marker.behind
      && Math.abs(marker.x) <= 1 && Math.abs(marker.y) <= 1;
    if (onScreen) return;
    this.drawEdgeArrow(marker, '#ff4d4d', marker.count > 1 ? `THREAT x${marker.count}` : 'THREAT');
  }

  private drawSlotMarker(marker: HudState['slotMarker'], inSlot: boolean): void {
    if (!marker) return;
    const ctx = this.reticle;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const colour = inSlot ? '#4dff5c' : '#ffb444';
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = 2;

    const onScreen = !marker.behind
      && Math.abs(marker.x) <= 1 && Math.abs(marker.y) <= 1;
    if (onScreen) {
      const x = (marker.x * 0.5 + 0.5) * w;
      const y = (-marker.y * 0.5 + 0.5) * h;
      const r = 26;
      const c = r * 0.45;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + sx * r, y + sy * r - sy * c);
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * r - sx * c, y + sy * r);
        ctx.stroke();
      }
      ctx.font = '10px Menlo, Consolas, monospace';
      ctx.fillText(inSlot ? 'DOCKING PORT — LINED UP' : 'DOCKING PORT', x - r, y - r - 6);
      return;
    }

    this.drawEdgeArrow(marker, colour, 'DOCKING PORT');
  }

  private drawScanner(
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    contacts: ScannerContact[],
  ): void {
    const ctx = this.scanner;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2 - 6;
    const ry = h / 2 - 10;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    for (const f of [1, 0.66, 0.33]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
    ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry);
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.strokeRect(cx - 1.5, cy - 1.5, 3, 3); // us

    this.invQ.copy(playerQuat).invert();
    for (const c of contacts) {
      this.local.copy(c.position).sub(playerPos).applyQuaternion(this.invQ);
      if (this.local.length() > SCANNER_RANGE) continue;
      // Ship-local frame: x right, y up, -z ahead. Ahead maps to the top.
      const px = cx + (this.local.x / SCANNER_RANGE) * rx;
      const py = cy + (this.local.z / SCANNER_RANGE) * ry;
      const stickTop = py - (this.local.y / SCANNER_RANGE) * ry * 1.4;
      const color = CONTACT_COLORS[c.kind];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, stickTop);
      ctx.stroke();
      if (c.kind === 'station') {
        ctx.fillRect(px - 2.5, stickTop - 2.5, 5, 5);
      } else {
        ctx.beginPath();
        ctx.arc(px, stickTop, c.kind === 'missile' ? 1.4 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(px - 1.5, py - 0.5, 3, 1);
    }
  }

  private drawCompass(
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    target: THREE.Vector3,
  ): void {
    const ctx = this.compass;
    const s = ctx.canvas.width;
    const c = s / 2;
    const r = c - 3;
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();

    this.invQ.copy(playerQuat).invert();
    this.local.copy(target).sub(playerPos).applyQuaternion(this.invQ).normalize();
    const px = c + this.local.x * (r - 5);
    const py = c - this.local.y * (r - 5);
    const ahead = this.local.z < 0;
    ctx.strokeStyle = AMBER;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    if (ahead) ctx.fill();
    else ctx.stroke();
  }
}

/**
 * The cockpit's elements, or inert stand-ins when there is no document.
 *
 * The HUD is a dumb painter (CLAUDE.md invariant 15): it reads a frame and
 * writes text, classes, styles and two canvases, and nothing reads any of it
 * back. So with no DOM every element becomes a sink — see engine/inert-dom.ts,
 * which explains why this exists at all.
 */
function byId(id: string): HTMLElement {
  return elementById(id);
}
