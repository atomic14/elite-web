// What a save test has to stand in for, and what it has to look at.
//
// Three things, and they are here rather than beside one file because three
// files need the same ones — `saves`, `save-transfer` and `career-identity`:
//
//   a localStorage it can WATCH   node has none, and a save test that cannot
//                                 see the bytes is asserting about its own
//                                 mock. `failFrom` is a full disk, mid-run.
//   a location it can COUNT       every load in the commander file is a
//                                 `location.reload()`, so "did this ask to
//                                 boot?" is a real assertion and not a stub.
//   a career's keys as BYTES      the question TODO 43 turns on is whether
//                                 somebody else's save landed on your autosave
//                                 group, and that is answered by comparing the
//                                 keys before and after, not by reasoning.
//
// Both installers restore whatever was there, so a file that forgets its
// `finally` cannot leak a fake into the next test file — and `test/harness.ts`
// has already switched the process into the harness namespace, one way, so
// nothing any of them writes can be a player's key in the first place.

import { dockId, flightIds } from '../src/game/save-file.ts';
import { readSave } from '../src/game/storage.ts';

export interface FakeStore {
  held: Map<string, string>;
  /** setItem throws from this call onward — a full disk, mid-run */
  failFrom: number;
  /**
   * ...or whenever a matching KEY is written, however many writes have gone
   * before it. A full store refuses everything, but a test about one refusal
   * has to name the write it is about, and counting them makes the test depend
   * on the order of writes it is not asserting anything about.
   */
  failKeys: RegExp | null;
  writes: number;
}

/** A `localStorage` this process can read back, count and make fail. */
export function installStore(): { store: FakeStore; restore: () => void } {
  const store: FakeStore = {
    held: new Map(), failFrom: Infinity, failKeys: null, writes: 0,
  };
  const fake = {
    get length() { return store.held.size; },
    key: (i: number) => [...store.held.keys()][i] ?? null,
    getItem: (k: string) => store.held.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.writes += 1;
      if (store.writes >= store.failFrom) throw new Error('QuotaExceededError');
      if (store.failKeys?.test(k)) throw new Error('QuotaExceededError');
      store.held.set(k, v);
    },
    removeItem: (k: string) => { store.held.delete(k); },
    clear: () => { store.held.clear(); },
  };
  const globals = globalThis as unknown as { localStorage?: unknown };
  const had = 'localStorage' in globals;
  const previous = globals.localStorage;
  globals.localStorage = fake;
  return {
    store,
    restore: () => {
      if (had) globals.localStorage = previous;
      else delete globals.localStorage;
    },
  };
}

/** `location.reload()`, counted rather than performed. */
export function installLocation(): { reloads: () => number; restore: () => void } {
  let n = 0;
  const globals = globalThis as unknown as { location?: unknown };
  const had = 'location' in globals;
  const previous = globals.location;
  globals.location = { reload: () => { n += 1; } };
  return {
    reloads: () => n,
    restore: () => {
      if (had) globals.location = previous;
      else delete globals.location;
    },
  };
}

/**
 * Every key a career's automatic writes can address, and what is in each.
 *
 * The docked checkpoint and the whole flight ring, as bytes — so "this career
 * was not touched" is a comparison rather than an argument. A named save is
 * deliberately NOT here: no automatic write can address one.
 */
export function autoKeys(career: string): Map<string, string | null> {
  return new Map([dockId(career), ...flightIds(career)]
    .map((id) => [id, JSON.stringify(readSave(id))]));
}

/** Byte-identical, both ways round. */
export function sameKeys(
  a: Map<string, string | null>, b: Map<string, string | null>,
): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}
