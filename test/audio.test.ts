// Named sound occasions must preserve the tones they replaced. A tiny fake
// AudioContext records oscillator shape without speakers, timing, or a browser.

import { check, eq } from './harness.ts';

interface Tone {
  type: OscillatorType;
  frequency: number;
  duration: number;
  gain: number;
}

const tones: Tone[] = [];
let current: Tone | null = null;

class FakeAudioContext {
  currentTime = 10;
  state = 'running';
  destination = {};

  createOscillator() {
    const recorded: Tone = { type: 'sine', frequency: 0, duration: 0, gain: 0 };
    tones.push(recorded);
    current = recorded;
    return {
      type: 'sine' as OscillatorType,
      frequency: {
        setValueAtTime(value: number) {
          recorded.frequency = value;
        },
        exponentialRampToValueAtTime() {},
      },
      connect() {
        recorded.type = this.type;
      },
      start() {},
      stop(at: number) {
        recorded.duration = at - 10;
      },
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime(value: number) {
          if (current) current.gain = value;
        },
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }

  resume() {}
}

Object.assign(globalThis, { AudioContext: FakeAudioContext });
const { sfx } = await import('../src/audio.ts');

console.log('\nNamed audio');

const expected = {
  refused: [220, 0.08],
  noMissiles: [180, 0.08],
  noEnergy: [180, 0.08],
  missileArmed: [700, 0.08],
  missileUnarmed: [400, 0.08],
  missileLocked: [1200, 0.12],
  missileDisarmed: [500, 0.06],
  torusDropped: [300, 0.08],
  lowEnergy: [320, 0.1],
  survivorScooped: [600, 0.12],
  cargoScooped: [950, 0.08],
  trumbleAte: [500, 0.1],
  generationShipFound: [140, 0.5],
  contractPaid: [1100, 0.15],
  contractExpired: [220, 0.2],
  contractAccepted: [900, 0.1],
  dockingComputerEngaged: [700, 0.12],
  combatComputerEngaged: [1000, 0.12],
  stationDefenceLaunched: [300, 0.18],
  cargoLost: [300, 0.12],
  equipmentDestroyed: [240, 0.2],
  distressBeacon: [500, 0.4],
  torusEngaged: [1000, 0.15],
  viewChanged: [600, 0.04],
  cargoJettisoned: [320, 0.08],
  tradeBought: [900, 0.05],
  tradeSold: [700, 0.05],
  equipmentBought: [600, 0.08],
  chartTargetSelected: [900, 0.1],
  commanderDeleted: [400, 0.1],
  commanderNamed: [700, 0.1],
  combatSimulationLaunched: [700, 0.08],
} as const;

for (const [name, [frequency, duration]] of Object.entries(expected)) {
  tones.length = 0;
  (sfx[name as keyof typeof expected] as () => void)();
  const tone = tones[0];
  eq(`${name} keeps its frequency`, tone.frequency, frequency);
  check(`${name} keeps its envelope`, Math.abs(tone.duration - duration) < 1e-9);
  eq(`${name} stays a square wave`, tone.type, 'square');
  eq(`${name} keeps the standard gain`, tone.gain, 0.08);
}

for (const n of [5, 4, 3, 2, 1]) {
  tones.length = 0;
  sfx.countdown(n);
  const tone = tones[0];
  eq(`countdown ${n} owns its rising pitch`, tone.frequency, 700 + (5 - n) * 100);
  check(`countdown ${n} keeps its envelope`, Math.abs(tone.duration - 0.07) < 1e-9);
}
