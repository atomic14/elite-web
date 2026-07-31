// Compatibility view for console agents and the untyped browser harnesses.
//
// GameState is the canonical mutable model. These names preserve the convenient
// reads used by old console scripts without putting dozens of forwarding
// accessors on Game or restoring a second writable path. New scripts should
// prefer `g.state.commander`, `g.state.session.torusEngaged`, and so on.

import type { GameState } from './state.ts';

export interface HandleAccessor {
  get(): unknown;
  set?(value: unknown): void;
}

type HandleExtensions = Readonly<Record<string, HandleAccessor>>;

interface Stateful {
  readonly state: GameState;
}

/**
 * Return the object published as `__game`.
 *
 * Game methods are bound back to the real instance, while legacy state names
 * are getter-only. A small extension table covers handles owned by collaborators
 * such as Ordnance and the screen objects rather than GameState.
 */
export function legacyHandles<T extends object & Stateful>(
  game: T,
  extensions: HandleExtensions = {},
): T {
  const s = game.state;
  const stateReads: Readonly<Record<string, () => unknown>> = {
    systems: () => s.systems,
    commander: () => s.commander,
    living: () => s.living,
    world: () => s.world,
    npcs: () => s.world.npcs,
    scene: () => s.world.scene,
    player: () => s.player,
    session: () => s.session,

    hyperCountdown: () => s.session.hyperCountdown,
    torusEngaged: () => s.session.torusEngaged,
    witchspace: () => s.session.witchspace,
    npcTargetTimer: () => s.session.npcTargetTimer,
    autoSaveTimer: () => s.session.autoSaveTimer,
    energyLowTimer: () => s.session.energyLowTimer,
    policeScanned: () => s.session.policeScanned,
    defenceLaunched: () => s.session.defenceLaunched,
    hermitTrading: () => s.session.hermitTrading,
    hermitCooldown: () => s.session.hermitCooldown,
    jettisonedValue: () => s.session.jettisonedValue,
    arrivalCargoValue: () => s.session.arrivalCargoValue,
    genShipSeen: () => s.session.genShipSeen,
    trumbleTimer: () => s.session.trumbleTimer,
    beaconTimer: () => s.session.beaconTimer,
    strandedHintTimer: () => s.session.strandedHintTimer,
    paused: () => s.session.paused,
    ccEngaged: () => s.session.ccEngaged,
    beamTimer: () => s.session.beamTimer,
    dcEngaged: () => s.session.dcEngaged,

    chart: () => s.chart,
    market: () => s.market,
    lastThreat: () => s.lastThreat,
    contractOffers: () => s.contractOffers,
    canisters: () => s.world.cargo.items,
    sys: () => s.sys,
    foreShield: () => s.sys.foreShield,
    aftShield: () => s.sys.aftShield,
    energy: () => s.sys.energy,
    laserTemp: () => s.sys.laserTemp,
    laserCooldown: () => s.sys.laserCooldown,
    cabinTemp: () => s.sys.cabinTemp,
  };
  const bound = new Map<Function, Function>();

  return new Proxy(game, {
    get(target, key) {
      if (typeof key === 'string') {
        const read = stateReads[key] ?? extensions[key]?.get;
        if (read) return read();
      }
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      let fn = bound.get(value);
      if (!fn) {
        fn = value.bind(target) as Function;
        bound.set(value, fn);
      }
      return fn;
    },
    set(target, key, value) {
      if (typeof key === 'string') {
        if (stateReads[key]) return false;
        const write = extensions[key]?.set;
        if (write) {
          write(value);
          return true;
        }
      }
      return Reflect.set(target, key, value, target);
    },
    has(target, key) {
      return typeof key === 'string' && (stateReads[key] || extensions[key])
        ? true
        : Reflect.has(target, key);
    },
    ownKeys(target) {
      return [...new Set([
        ...Reflect.ownKeys(target),
        ...Object.keys(stateReads),
        ...Object.keys(extensions),
      ])];
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && (stateReads[key] || extensions[key])) {
        return {
          configurable: true,
          enumerable: true,
          value: stateReads[key] ? stateReads[key]() : extensions[key].get(),
          writable: Boolean(extensions[key]?.set),
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}
