// The living galaxy — level 1 of a two-level simulation.
//
// While you are docked, jumping, or fighting somewhere else, the other 255
// systems keep trading. This layer models that abstractly and cheaply:
// ships between systems are records, not objects, and only materialise as
// real NPCs when they arrive in the system you happen to be in
// (see game.ts populateSystem / the arrivals it pulls from here).
//
// Erasable-TypeScript only (no parameter properties/enums): this module is
// imported by test/run.ts, which Node runs directly via
// --experimental-strip-types.
//
// Design notes:
//  - the 1984 seeded galaxy remains the BASELINE; this layer stores only
//    *deltas* (recent price pressure, traffic events), so saves stay small
//    and the original determinism survives underneath
//  - it advances in whole days, driven by the same clock as contract
//    deadlines (a jump costs days), so it never needs a real-time tick
//  - everything here is pure data + maths: no three.js, no DOM

import type { StarSystem } from './galaxy';

/** A trade run in flight between two systems. */
export interface Convoy {
  from: number;
  to: number;
  /** commodity index being carried */
  commodity: number;
  tonnes: number;
  /** day the convoy arrives */
  etaDay: number;
  /** false once pirates got it — arrivals of lost cargo never happen */
  intact: boolean;
}

/** Per-system state that drifts away from the 1984 baseline. */
export interface SystemState {
  /** price pressure per commodity, -1..1; positive = dearer than baseline */
  pressure: Float32Array;
  /** recent pirate activity, 0..1; raises encounter rates and prices */
  danger: number;
  /** convoys that have arrived here recently (for flavour + arrivals) */
  recentArrivals: number;
  /** convoys lost en route to here recently */
  recentLosses: number;
}

export interface GalaxyStateSave {
  day: number;
  convoys: Convoy[];
  /** sparse: only systems that have drifted from baseline */
  systems: Record<number, { pressure: number[]; danger: number; arrivals: number; losses: number }>;
}

const COMMODITY_COUNT = 17;
/** How fast pressure decays back toward the 1984 baseline, per day. */
const PRESSURE_DECAY = 0.12;
const DANGER_DECAY = 0.08;

export class LivingGalaxy {
  readonly states = new Map<number, SystemState>();
  convoys: Convoy[] = [];
  day = 0;

  private readonly systems: StarSystem[];

  constructor(systems: StarSystem[]) {
    this.systems = systems;
  }

  state(index: number): SystemState {
    let s = this.states.get(index);
    if (!s) {
      s = {
        pressure: new Float32Array(COMMODITY_COUNT),
        danger: 0,
        recentArrivals: 0,
        recentLosses: 0,
      };
      this.states.set(index, s);
    }
    return s;
  }

  /**
   * How much a system's economy wants a commodity: negative where it is
   * produced (industrial worlds make computers), positive where it is
   * consumed. Uses the original's price gradient, so this agrees with the
   * market model rather than fighting it.
   */
  private demand(sys: StarSystem, gradient: number): number {
    // gradient > 0 → dearer at agricultural (high economy index) worlds
    const bias = gradient > 0 ? sys.economy : 7 - sys.economy;
    return (bias - 3.5) / 3.5; // -1..1
  }

  /**
   * Advance the abstract galaxy by whole days. Called whenever the player's
   * clock moves (hyperspace jumps, rescues) — never per frame.
   */
  advance(days: number, gradients: number[], rng: () => number = Math.random): void {
    for (let d = 0; d < days; d++) {
      this.day += 1;

      // 1. deliver or lose convoys that are due
      const remaining: Convoy[] = [];
      for (const c of this.convoys) {
        if (c.etaDay > this.day) {
          remaining.push(c);
          continue;
        }
        const dest = this.state(c.to);
        if (c.intact) {
          // supply arrives: prices at the destination ease
          dest.pressure[c.commodity] -= 0.05 * c.tonnes / 10;
          dest.recentArrivals += 1;
          // and the source has shipped its surplus away
          this.state(c.from).pressure[c.commodity] += 0.03 * c.tonnes / 10;
        } else {
          // the cargo never came: scarcity, and a nervous reputation
          dest.pressure[c.commodity] += 0.08 * c.tonnes / 10;
          dest.recentLosses += 1;
          dest.danger = Math.min(1, dest.danger + 0.1);
        }
      }
      this.convoys = remaining;

      // 2. new convoys depart, at a rate set by productivity and safety
      for (const sys of this.systems) {
        const st = this.state(sys.index);
        const traffic = (sys.productivity / 60000) * (1 - st.danger * 0.6);
        if (rng() > traffic) continue;

        const dest = this.pickTradePartner(sys, rng);
        if (dest === null) continue;
        const commodity = this.pickExport(sys, gradients, rng);
        const tonnes = 5 + Math.floor(rng() * 25);
        const distDays = 1 + Math.ceil(chartDistance(sys, this.systems[dest]) / 20);

        // does it survive the trip? lawless space eats convoys
        const risk = Math.min(0.5,
          (7 - this.systems[dest].government) * 0.035 + this.state(dest).danger * 0.2);
        this.convoys.push({
          from: sys.index,
          to: dest,
          commodity,
          tonnes,
          etaDay: this.day + distDays,
          intact: rng() > risk,
        });
      }

      // 3. everything decays back toward the 1984 baseline
      for (const st of this.states.values()) {
        for (let i = 0; i < COMMODITY_COUNT; i++) {
          st.pressure[i] *= 1 - PRESSURE_DECAY;
          if (Math.abs(st.pressure[i]) < 0.002) st.pressure[i] = 0;
        }
        st.danger = Math.max(0, st.danger - DANGER_DECAY);
        st.recentArrivals = Math.max(0, st.recentArrivals - 0.5);
        st.recentLosses = Math.max(0, st.recentLosses - 0.5);
      }

      // keep the convoy list bounded however long the player plays
      if (this.convoys.length > 400) this.convoys = this.convoys.slice(-400);
    }
  }

  /** A plausible partner: near, and wanting what we have. */
  private pickTradePartner(sys: StarSystem, rng: () => number): number | null {
    let best: number | null = null;
    let bestScore = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cand = this.systems[Math.floor(rng() * this.systems.length)];
      if (cand.index === sys.index) continue;
      const dist = chartDistance(sys, cand);
      if (dist > 90) continue;
      // trade flows between unlike economies, and toward wealth
      const contrast = Math.abs(cand.economy - sys.economy) / 7;
      const score = contrast * (cand.productivity / 40000) * (1 - dist / 120) * (0.6 + rng() * 0.8);
      if (score > bestScore) {
        bestScore = score;
        best = cand.index;
      }
    }
    return best;
  }

  /** What this system sends out: whatever its economy makes cheaply. */
  private pickExport(sys: StarSystem, gradients: number[], rng: () => number): number {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < COMMODITY_COUNT; i++) {
      const score = -this.demand(sys, gradients[i]) + rng() * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /**
   * Price multiplier for a commodity here, from accumulated pressure.
   * Deliberately gentle (±25%) — the 1984 economy stays recognisable.
   */
  priceMultiplier(systemIndex: number, commodity: number): number {
    const st = this.states.get(systemIndex);
    if (!st) return 1;
    return 1 + Math.max(-0.25, Math.min(0.25, st.pressure[commodity]));
  }

  /** Extra pirate presence here, 0..1, from convoy losses. */
  danger(systemIndex: number): number {
    return this.states.get(systemIndex)?.danger ?? 0;
  }

  /** Convoys due to arrive in this system within the next day or so. */
  imminentArrivals(systemIndex: number): Convoy[] {
    return this.convoys.filter((c) => c.to === systemIndex && c.intact && c.etaDay <= this.day + 1);
  }

  /** One line of news for the system data screen, or ''. */
  headline(systemIndex: number): string {
    const st = this.states.get(systemIndex);
    if (!st) return '';
    if (st.recentLosses >= 2) return 'Trade convoys have been lost to pirates recently.';
    if (st.danger > 0.4) return 'Merchants report heavy pirate activity in this system.';
    if (st.recentArrivals >= 3) return 'The docks are busy with incoming trade.';
    let dearest = -1;
    let worst = 0.08;
    for (let i = 0; i < COMMODITY_COUNT; i++) {
      if (st.pressure[i] > worst) {
        worst = st.pressure[i];
        dearest = i;
      }
    }
    if (dearest >= 0) return `Shortages have pushed prices up in this system.`;
    return '';
  }

  // --- persistence ---------------------------------------------------------

  save(): GalaxyStateSave {
    const systems: GalaxyStateSave['systems'] = {};
    for (const [index, st] of this.states) {
      const pressure = Array.from(st.pressure).map((p) => +p.toFixed(3));
      if (!pressure.some((p) => p !== 0) && st.danger === 0) continue;
      systems[index] = {
        pressure,
        danger: +st.danger.toFixed(3),
        arrivals: +st.recentArrivals.toFixed(1),
        losses: +st.recentLosses.toFixed(1),
      };
    }
    return { day: this.day, convoys: this.convoys, systems };
  }

  load(data: GalaxyStateSave | undefined): void {
    if (!data) return;
    this.day = data.day ?? 0;
    this.convoys = Array.isArray(data.convoys) ? data.convoys : [];
    this.states.clear();
    for (const [key, s] of Object.entries(data.systems ?? {})) {
      const st = this.state(Number(key));
      if (Array.isArray(s.pressure)) st.pressure.set(s.pressure.slice(0, COMMODITY_COUNT));
      st.danger = s.danger ?? 0;
      st.recentArrivals = s.arrivals ?? 0;
      st.recentLosses = s.losses ?? 0;
    }
  }
}

/** Chart distance in tenths of a light year (the original's metric). */
function chartDistance(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return Math.round(4 * Math.sqrt(dx * dx + dy * dy));
}
