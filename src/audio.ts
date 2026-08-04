// Tiny WebAudio synth — bleeps and zaps in the spirit of the BBC sound chip.
// The context is created lazily on the first user gesture.

import { COUNTDOWN } from './constants/jump.ts';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function env(a: AudioContext, gain: number, duration: number): GainNode {
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + duration);
  g.connect(a.destination);
  return g;
}

function sweep(type: OscillatorType, from: number, to: number, duration: number, gain: number): void {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, to), a.currentTime + duration);
  o.connect(env(a, gain, duration));
  o.start();
  o.stop(a.currentTime + duration);
}

/** The common square-wave voice used by the named interface sounds below. */
function tone(frequency: number, duration = 0.08, gain = 0.08): void {
  sweep('square', frequency, frequency, duration, gain);
}

function noiseBurst(duration: number, gain: number, lowpass = 4000): void {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  src.connect(f);
  f.connect(env(a, gain, duration));
  src.start();
}

// --- docking music -----------------------------------------------------------
//
// The Commodore 64 Elite played "An der schönen blauen Donau" while you docked
// — Strauss's own nod having been borrowed by 2001. The waltz is from 1866 and
// is comfortably public domain, so it is synthesised here from note data rather
// than shipping audio from the original game: this repo deliberately contains
// no assets from Elite, and a SID rip would be exactly that.
//
// Two voices through the same square-wave synth as everything else: the melody,
// and an oom-pah-pah bass that does most of the work of making it read as a
// waltz at all.

/** Semitone offsets from A4 (440 Hz) for the notes the theme uses. */
const NOTE: Record<string, number> = {
  A3: -12, B3: -10, D4: -7, E4: -5, Fs4: -4, G4: -2, A4: 0, B4: 2, D5: 5, Fs5: 9,
};
const hz = (n: string): number => 440 * Math.pow(2, NOTE[n] / 12);

/** [note or rest, beats] — the opening of the waltz theme, in D major. */
const BLUE_DANUBE: [string | null, number][] = [
  ['D4', 1], ['Fs4', 1], ['A4', 1],           // the rising arpeggio everyone knows
  ['A4', 2], [null, 1],
  ['B4', 0.5], ['B4', 0.5], [null, 2],        // dum dum
  ['B4', 0.5], ['B4', 0.5], [null, 2],        // dum dum
  ['D4', 1], ['Fs4', 1], ['A4', 1],
  ['A4', 2], [null, 1],
  ['G4', 0.5], ['G4', 0.5], [null, 2],
  ['G4', 0.5], ['G4', 0.5], [null, 2],
  ['B3', 1], ['E4', 1], ['G4', 1],
  ['G4', 2], [null, 1],
  ['Fs4', 0.5], ['Fs4', 0.5], [null, 2],
  ['A3', 1], ['D4', 1], ['Fs4', 1],
  ['Fs4', 2], [null, 1],
  ['D5', 1], [null, 2],
];
/** Waltz bass: root on the downbeat, chord on two and three. */
const BASS: string[] = ['D4', 'A3', 'D4', 'A3', 'B3', 'E4', 'A3', 'D4'];

let musicStop: (() => void) | null = null;

export const sfx = {
  laser(): void {
    sweep('sawtooth', 900, 220, 0.18, 0.12);
  },
  enemyLaser(): void {
    sweep('square', 500, 140, 0.22, 0.08);
  },
  hit(): void {
    noiseBurst(0.12, 0.15, 2500);
  },
  damage(): void {
    noiseBurst(0.3, 0.22, 1200);
    sweep('sawtooth', 200, 60, 0.3, 0.12);
  },
  explosion(): void {
    noiseBurst(0.8, 0.3, 900);
    sweep('sine', 120, 30, 0.8, 0.25);
  },
  refused(): void { tone(220); },
  noMissiles(): void { tone(180); },
  noEnergy(): void { tone(180); },
  missileArmed(): void { tone(700); },
  missileUnarmed(): void { tone(400); },
  missileLocked(): void { tone(1200, 0.12); },
  missileDisarmed(): void { tone(500, 0.06); },
  torusDropped(): void { tone(300); },
  lowEnergy(): void { tone(320, 0.1); },
  survivorScooped(): void { tone(600, 0.12); },
  cargoScooped(): void { tone(950); },
  trumbleAte(): void { tone(500, 0.1); },
  generationShipFound(): void { tone(140, 0.5); },
  contractPaid(): void { tone(1100, 0.15); },
  contractExpired(): void { tone(220, 0.2); },
  contractAccepted(): void { tone(900, 0.1); },
  dockingComputerEngaged(): void { tone(700, 0.12); },
  combatComputerEngaged(): void { tone(1000, 0.12); },
  stationDefenceLaunched(): void { tone(300, 0.18); },
  cargoLost(): void { tone(300, 0.12); },
  equipmentDestroyed(): void { tone(240, 0.2); },
  distressBeacon(): void { tone(500, 0.4); },
  torusEngaged(): void { tone(1000, 0.15); },
  viewChanged(): void { tone(600, 0.04); },
  cargoJettisoned(): void { tone(320); },
  tradeBought(): void { tone(900, 0.05); },
  tradeSold(): void { tone(700, 0.05); },
  equipmentBought(): void { tone(600); },
  chartTargetSelected(): void { tone(900, 0.1); },
  commanderDeleted(): void { tone(400, 0.1); },
  commanderNamed(): void { tone(700, 0.1); },
  combatSimulationLaunched(): void { tone(700); },
  /**
   * The hyperspace countdown, with `n` seconds left on it: a blip that climbs
   * a hundred hertz a second towards the jump.
   *
   * Named for the occasion because the pitch used to be written out in the
   * world step, which put audio design inside the simulation. Same tone as
   * before, decided here.
   *
   * The 700 and the 100 are this file's; the length of the countdown is not,
   * and it wrote `(5 - n)` out as a digit until `COUNTDOWN` was somewhere it
   * could be imported from. A longer countdown would have started BELOW 700
   * and climbed to it — the first blip of a jump is meant to be the base note
   * whatever the drive's warning is. `test/audio.test.ts` asserts that climb
   * rather than this expression.
   */
  countdown(n: number): void {
    const f = 700 + (COUNTDOWN - n) * 100;
    sweep('square', f, f, 0.07, 0.08);
  },
  /**
   * Start the docking waltz. Safe to call repeatedly — a second call while it
   * is already playing does nothing, so an autopilot that re-engages doesn't
   * stack voices on top of each other.
   */
  dockingMusic(): void {
    const a = ac();
    if (!a || musicStop) return;
    const beat = 0.34;
    const voices: OscillatorNode[] = [];
    let t = a.currentTime + 0.05;

    for (const [note, beats] of BLUE_DANUBE) {
      if (note) {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(hz(note), t);
        const dur = beats * beat * 0.92;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(a.destination);
        o.start(t);
        o.stop(t + dur);
        voices.push(o);
      }
      t += beats * beat;
    }

    // oom-pah-pah underneath, one bar per bass note
    const bars = Math.ceil((t - a.currentTime) / (3 * beat));
    for (let bar = 0; bar < bars; bar++) {
      const root = BASS[bar % BASS.length];
      for (let step = 0; step < 3; step++) {
        const bt = a.currentTime + 0.05 + (bar * 3 + step) * beat;
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'triangle';
        // root low on the downbeat, the chord an octave up on two and three
        o.frequency.setValueAtTime(step === 0 ? hz(root) / 2 : hz(root), bt);
        const dur = beat * (step === 0 ? 0.5 : 0.28);
        g.gain.setValueAtTime(0.0001, bt);
        g.gain.exponentialRampToValueAtTime(step === 0 ? 0.045 : 0.025, bt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, bt + dur);
        o.connect(g).connect(a.destination);
        o.start(bt);
        o.stop(bt + dur);
        voices.push(o);
      }
    }

    const clear = window.setTimeout(() => { musicStop = null; }, (t - a.currentTime) * 1000 + 200);
    musicStop = () => {
      window.clearTimeout(clear);
      for (const o of voices) { try { o.stop(); } catch { /* already stopped */ } }
      musicStop = null;
    };
  },

  /** Cut the music off — docked, or the approach was abandoned. */
  stopDockingMusic(): void {
    musicStop?.();
  },

  dock(): void {
    sweep('square', 523, 523, 0.1, 0.08);
    setTimeout(() => sweep('square', 784, 784, 0.18, 0.08), 120);
  },
  launch(): void {
    sweep('sawtooth', 80, 320, 0.5, 0.1);
  },
  hyperspace(): void {
    sweep('sawtooth', 100, 1400, 1.2, 0.14);
    noiseBurst(1.2, 0.08, 3000);
  },
  missile(): void {
    sweep('sawtooth', 300, 900, 0.6, 0.1);
  },
  ecm(): void {
    // warbling interference
    for (let i = 0; i < 6; i++) {
      setTimeout(() => sweep('square', 1400 - i * 180, 500, 0.09, 0.09), i * 90);
    }
    noiseBurst(0.6, 0.1, 5000);
  },
  tunnel(): void {
    sweep('sawtooth', 60, 240, 1.3, 0.09);
    noiseBurst(1.3, 0.05, 1800);
  },
  bomb(): void {
    noiseBurst(1.6, 0.35, 500);
    sweep('sine', 200, 25, 1.6, 0.3);
    sweep('sawtooth', 90, 20, 1.2, 0.15);
  },
};
