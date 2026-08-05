// The parse boundary: a snapshot is validated whole at the door, or refused
// whole — "refused" and "half applied" must never be the same state again
// (docs/TODO/94).
//
// The gate is derived from what the game actually writes, so it cannot rot:
// `capture()` produces the canonical valid snapshot, `parse(capture(world))`
// must succeed and deep-equal its input, and deleting or corrupting ANY field
// of a real captured snapshot must fail the parse — the sweep walks the
// captured object's own keys rather than a written list, so a field added to
// `capture()` next year is covered the day it is added, and a parser that
// quietly stops checking something goes red here.
//
// The last block is the property the item exists for: a refused restore
// leaves the live session untouched, byte for byte, where it used to leave
// the commander replaced, the galaxy regenerated and the scene rebuilt with
// no fleet.

import { Game } from '../src/game/game.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { parseSnapshot, type WorldSnapshot } from '../src/game/snapshot.ts';
import { check, eq } from './harness.ts';

console.log('\nthe snapshot parse boundary');

const SEED = 20_260_805;

/** A real captured snapshot, flown for two seconds — flight or docked. */
function flown(launch: boolean): { g: Game; snap: WorldSnapshot } {
  seedWorld(SEED);
  const g = new Game(() => headlessShell());
  if (launch) g.launch();
  for (let i = 0; i < 120; i++) g.update(1 / 60, i / 60);
  return { g, snap: g.captureSnapshot() };
}

const refuses = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};

withoutSaving(() => {
  const { g, snap } = flown(true);

  // --- what the game writes, the parser accepts, unchanged -------------------
  {
    const copy = structuredClone(snap);
    const parsed = parseSnapshot(copy);
    eq('parse(capture(world)) deep-equals its input, in flight',
      JSON.stringify(parsed), JSON.stringify(snap));
    const docked = flown(false).snap;
    eq('...and docked', JSON.stringify(parseSnapshot(structuredClone(docked))),
      JSON.stringify(docked));
  }

  // --- deleting ANY field of a real snapshot is a refusal --------------------
  // Driven off the snapshot's own keys: a field capture() gains later is
  // covered the day it exists, or this loop finds the parser not checking it.
  {
    const missed: string[] = [];
    for (const key of Object.keys(snap)) {
      const broken = structuredClone(snap) as unknown as Record<string, unknown>;
      delete broken[key];
      if (!refuses(() => parseSnapshot(broken))) missed.push(key);
    }
    check(`deleting any one of the ${Object.keys(snap).length} captured fields refuses`,
      missed.length === 0, missed.join(', '));
  }

  // --- and so is corrupting one ----------------------------------------------
  // `galaxyState` is the one stated exemption: it is DELIBERATELY opaque —
  // `LivingGalaxy.load` defaults every field from whatever arrives — so only
  // its presence is the parser's business (the deletion sweep above covers it).
  {
    const missed: string[] = [];
    for (const key of Object.keys(snap)) {
      if (key === 'galaxyState') continue;
      const broken = structuredClone(snap) as unknown as Record<string, unknown>;
      broken[key] = 'CORRUPT';
      if (!refuses(() => parseSnapshot(broken))) missed.push(key);
    }
    check('corrupting any checked field refuses',
      missed.length === 0, missed.join(', '));
  }

  // --- the invariants inside the arrays and records ---------------------------
  {
    const poison = (mutate: (b: WorldSnapshot) => void): boolean => {
      const b = structuredClone(snap);
      mutate(b);
      return refuses(() => parseSnapshot(b));
    };
    check('a wrong version refuses', poison((b) => { b.version += 1; }));
    check('a fleet ship that does not say what it is refuses',
      snap.npcs.length > 0 && poison((b) => {
        (b.npcs[0] as unknown as Record<string, unknown>).designId = 'not-a-design';
      }));
    check('...or whose build is not a real profile', poison((b) => {
      (b.npcs[0] as unknown as Record<string, unknown>).profileId = 'not-a-profile';
    }));
    check('a hunting link pointing outside the fleet refuses',
      poison((b) => { b.npcs[0].targetIndex = b.npcs.length; }));
    check('a target lock outside the fleet refuses',
      poison((b) => { b.targetLock = b.npcs.length; }));
    check('a commander flying no known hull refuses',
      poison((b) => { b.commander.shipId = 'elite-a:player:99' as never; }));
    check('a galaxy the generator would hang on refuses',
      poison((b) => { b.commander.galaxy = 1e9; }));
    check('a system index off the chart refuses',
      poison((b) => { b.commander.systemIndex = 999; }));
    check('a three-element quaternion refuses',
      poison((b) => { (b.player as unknown as Record<string, unknown>).quat = [0, 0, 1]; }));
    check('a non-finite speed refuses',
      poison((b) => { b.player.speed = Number.NaN; }));
    check('an rng state that is not numbers refuses',
      poison((b) => { (b.rng as unknown as Record<string, unknown>).state = 'soon'; }));
    check('a mode that is not flight or docked refuses',
      poison((b) => { (b as unknown as Record<string, unknown>).mode = 'paused'; }));
  }

  // --- a refused restore modifies nothing at all ------------------------------
  // Capture before, attempt the restore, capture after: byte for byte the same
  // session. Before the door existed, the commander was replaced on the first
  // line and the throw came seven steps later.
  {
    const before = JSON.stringify(g.captureSnapshot());
    const bad = structuredClone(snap);
    (bad.npcs[0] as unknown as Record<string, unknown>).designId = 'not-a-design';
    check('the poisoned restore is refused',
      refuses(() => g.restoreSnapshot(bad)));
    eq('...and the live session is untouched, byte for byte',
      JSON.stringify(g.captureSnapshot()), before);
  }
});
