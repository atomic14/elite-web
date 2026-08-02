// The snapshot actually round-trips: values, not field names.
//
// Five times this project has shipped a save that forgot a field, and every one of
// them passed a name-presence grep — because in each case the NAME was there and
// the value was not. So this builds a state, flies it until nothing is at its
// default, serialises, restores into a FRESH object, compares field by field, then
// steps both on and demands they stay identical.

import * as THREE from 'three';
import { freshState } from '../src/game/state.ts';
import { newCommander } from '../src/game/commander.ts';
import { seedWorld, rngState, restoreRng } from '../src/game/rng.ts';
import { serialiseState, restoreState } from '../src/game/snapshot.ts';
import { NpcShip } from '../src/game/npc.ts';
import { World } from '../src/game/world.ts';
import { SPECS, specForDesign } from '../src/game/ship-specs.ts';
import { migratedNpcState } from '../src/game/npc-energy.ts';
import type { NpcRole } from '../src/game/ship-roles.ts';
import { SHIPPED_BRAINS } from '../src/game/brain-names.ts';
import { showMessage, tickMessage } from '../src/game/session.ts';
import { check, keys } from './harness.ts';
import { g1 } from './fixtures.ts';

// --- the snapshot actually round-trips --------------------------------------

// snapshot.ts had no direct coverage at all. Everything above it is a grep
// over game.ts asking whether a field NAME appears in captureSnapshot and
// restoreSnapshot — which cannot see whether the value that came back is the
// value that went in, nor whether it landed in the object the renderer reads.
//
// That is exactly the gap the file's own history describes: four rounds of
// "two reloads agree with each other but not with the run they came from".
// A name-presence check passes through every one of them, because in each
// case the name WAS there.
//
// So: build state, fly it until nothing is at its default, serialise, restore
// into a FRESH object, and compare field by field — then step both on and
// demand they stay identical, which is the property the bug actually broke.

console.log('\nsnapshot round trip');
{
  /** Vector3 and Quaternion both look like this; nothing else in the state does. */
  const vecLike = (v: unknown): v is { x: number; y: number; z: number; w?: number } =>
    !!v && typeof v === 'object'
    && typeof (v as { x?: unknown }).x === 'number'
    && typeof (v as { y?: unknown }).y === 'number'
    && typeof (v as { z?: unknown }).z === 'number';

  /** Structural equality, treating a Vector3/Quaternion as its components. */
  const same = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (vecLike(a) && vecLike(b)) {
      return a.x === b.x && a.y === b.y && a.z === b.z && (a.w ?? null) === (b.w ?? null);
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ka = Object.keys(a).sort();
      const kb = Object.keys(b).sort();
      if (ka.join() !== kb.join()) return false;
      return ka.every((k) => same((a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k]));
    }
    return false;
  };

  /** Which fields differ, by name — so a failure says what was lost. */
  const diff = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
    Object.keys(a).filter((k) => !same(a[k], b[k]));

  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const makePlayer = (pos: THREE.Vector3) =>
    ({ position: pos, quaternion: new THREE.Quaternion(), speed: 220 }) as never;
  const station = new THREE.Object3D();
  const fly = (npc: NpcShip, frames: number) => {
    for (let i = 0; i < frames; i++) {
      npc.update(1 / 60, makePlayer(at(0, 0, 0)), {
        station, dockZ: 160, fleet: [npc], playerLegal: 0, brains: SHIPPED_BRAINS,
      });
    }
  };

  // --- NpcState ------------------------------------------------------------
  seedWorld(20_260_729);
  const flown = new NpcShip('pirate', at(120, -80, 1400), 5);
  flown.state.threatTier = 1;
  fly(flown, 600);

  // A round trip over unchanged defaults proves nothing, so insist the state
  // is genuinely dirty first — vectors moved, a decision cached, clocks part
  // way through.
  const live = flown.state as unknown as Record<string, unknown>;
  check('the ship being snapshotted has actually flown',
    flown.state.pos.length() > 0 && flown.state.speed > 0
    && flown.state.brainControl !== null && flown.state.brainTimer !== 0);

  // Through JSON, not structuredClone: this is what a save is, and it is the
  // step that would expose a THREE object or a function hiding in the state.
  const wire = JSON.stringify(serialiseState(live));
  check('an NpcState snapshot is plain JSON', wire.length > 0 && !wire.includes('undefined'));
  const saved = JSON.parse(wire) as Record<string, unknown>;
  check(`every NpcState field reaches the snapshot (${Object.keys(saved).length} fields)`,
    Object.keys(live).sort().join() === Object.keys(saved).sort().join(),
    `missing: ${Object.keys(live).filter((k) => !(k in saved)).join(', ')}`);
  check('...including the three vectors and the quaternion, as arrays',
    Array.isArray(saved.pos) && (saved.pos as unknown[]).length === 3
    && Array.isArray(saved.quat) && (saved.quat as unknown[]).length === 4
    && Array.isArray(saved.packOffset) && Array.isArray(saved.waypoint));
  check('...and the nested brain decision',
    !!saved.brainControl && typeof saved.brainControl === 'object'
    && 'pitch' in (saved.brainControl as object) && 'fire' in (saved.brainControl as object));
  check('...and nested docking vectors as arrays',
    !!saved.dockPlan && typeof saved.dockPlan === 'object'
    && Array.isArray((saved.dockPlan as Record<string, unknown>).heading)
    && Array.isArray((saved.dockPlan as Record<string, unknown>).up));

  const fresh = new NpcShip('pirate', at(0, 0, 0), 5);
  const meshPos = fresh.object.position;
  const meshQuat = fresh.object.quaternion;
  restoreState(fresh.state as unknown as Record<string, unknown>, saved);

  // THE aliasing rule. npc.ts documents state.pos and state.quat as the SAME
  // THREE objects the mesh uses; a restore that REPLACED them would still pass
  // a value comparison and would leave the renderer drawing the old position
  // for ever, because the mesh kept the object it was given at construction.
  check('restore writes INTO the live vectors rather than replacing them',
    fresh.state.pos === meshPos && fresh.state.quat === meshQuat);
  check('...so the mesh is where the snapshot said',
    meshPos.distanceTo(flown.object.position) === 0);

  const back = diff(live, fresh.state as unknown as Record<string, unknown>);
  check(`every NpcState field survives serialise → JSON → restore${back.length ? '' : ''}`,
    back.length === 0, `lost: ${back.join(', ')}`);

  // The property all four historical bugs broke, and the only one a field
  // list cannot fake: restore the run and it must CONTINUE the same, not
  // merely look the same. Both ships fly the next 300 frames from the same
  // generator state.
  const mark = rngState();
  fly(flown, 300);
  restoreRng(mark);
  fly(fresh, 300);
  check('a restored ship replays the run it came from — position',
    fresh.object.position.distanceTo(flown.object.position) === 0,
    `drifted ${fresh.object.position.distanceTo(flown.object.position).toFixed(4)}`);
  // angleTo, not ===: it is acos of a dot product that is only unit-length to
  // within rounding, so two BIT-IDENTICAL quaternions report about 5e-6 rather
  // than 0. The exact comparison is the field-by-field one below.
  check('...attitude',
    fresh.object.quaternion.angleTo(flown.object.quaternion) < 1e-5,
    `off by ${fresh.object.quaternion.angleTo(flown.object.quaternion)}`);
  check('...and every other field',
    diff(live, fresh.state as unknown as Record<string, unknown>).length === 0,
    `diverged: ${diff(live, fresh.state as unknown as Record<string, unknown>).join(', ')}`);

  // The negative control. If restoring is a no-op the checks above must fail,
  // not pass — the failure mode this whole block exists to catch is a save
  // that quietly restores nothing and is compared against a default.
  {
    seedWorld(20_260_729);
    const unrestored = new NpcShip('pirate', at(0, 0, 0), 5);
    restoreRng(mark);
    fly(unrestored, 300);
    check('...and a ship that was NOT restored does not (the control)',
      unrestored.object.position.distanceTo(flown.object.position) > 1);
  }

  // --- a trader committed to the docking run ------------------------------
  //
  // The generic replay above flies a pirate and therefore cannot exercise the
  // docking plan's phase latch. Commit a trader, then displace it within the
  // latch's tolerance: a committed plan continues toward the slot, while a
  // freshly reset `gate` plan turns back outward. That makes the control fail
  // for exactly the omitted-state bug rather than for some unrelated default.
  {
    seedWorld(20_260_731);
    const trader = new NpcShip('trader', at(0, 0, -700), 2);
    trader.state.traderPhase = 'docking';
    trader.update(1 / 60, makePlayer(at(0, 0, 0)), {
      station, dockZ: 160, fleet: [trader], playerLegal: 0, brains: SHIPPED_BRAINS,
    });
    check('the docking replay fixture has committed to the slot run',
      trader.state.dockPlan.phase === 'run');
    // A small disturbance after commitment is precisely why the phase latches:
    // 60 is outside the 45-unit initial gate but inside the 90-unit run guard.
    trader.state.pos.x = 60;

    const dockingWire = JSON.stringify(serialiseState(
      trader.state as unknown as Record<string, unknown>));
    const dockingSaved = JSON.parse(dockingWire) as Record<string, unknown>;
    const restoredTrader = new NpcShip('trader', at(0, 0, 0), 2);
    const restoredPlan = restoredTrader.state.dockPlan;
    const restoredHeading = restoredPlan.heading;
    const restoredUp = restoredPlan.up;
    restoreState(
      restoredTrader.state as unknown as Record<string, unknown>, dockingSaved);

    check('a mid-docking JSON snapshot restores the committed phase',
      restoredTrader.state.dockPlan.phase === 'run');
    check('...without replacing the reusable plan or its vectors',
      restoredTrader.state.dockPlan === restoredPlan
      && restoredTrader.state.dockPlan.heading === restoredHeading
      && restoredTrader.state.dockPlan.up === restoredUp);

    // Old snapshots have no dockPlan key. Restoring one must leave the fresh
    // constructor default intact instead of manufacturing a partial plan.
    const legacySaved = { ...dockingSaved };
    delete legacySaved.dockPlan;
    const legacyTrader = new NpcShip('trader', at(0, 0, 0), 2);
    const legacyPlan = legacyTrader.state.dockPlan;
    restoreState(legacyTrader.state as unknown as Record<string, unknown>, legacySaved);
    check('an old NPC snapshot without a dock plan starts at the fresh gate default',
      legacyTrader.state.dockPlan === legacyPlan
      && legacyTrader.state.dockPlan.phase === 'gate');

    const resetControl = new NpcShip('trader', at(0, 0, 0), 2);
    restoreState(resetControl.state as unknown as Record<string, unknown>, dockingSaved);
    resetControl.state.dockPlan.phase = 'gate';

    let despawnFrame = -1;
    let restoredDespawnFrame = -1;
    let maxControlDrift = 0;
    for (let frame = 0; frame < 1800; frame++) {
      const updateOne = (npc: NpcShip) => npc.update(1 / 60, makePlayer(at(0, 0, 0)), {
        station, dockZ: 160, fleet: [npc], playerLegal: 0, brains: SHIPPED_BRAINS,
      });
      if (!trader.state.wantsDespawn) updateOne(trader);
      if (!restoredTrader.state.wantsDespawn) updateOne(restoredTrader);
      if (!resetControl.state.wantsDespawn) updateOne(resetControl);

      if (trader.state.wantsDespawn && despawnFrame < 0) despawnFrame = frame;
      if (restoredTrader.state.wantsDespawn && restoredDespawnFrame < 0) {
        restoredDespawnFrame = frame;
      }
      maxControlDrift = Math.max(
        maxControlDrift, resetControl.state.pos.distanceTo(trader.state.pos));
      if (despawnFrame >= 0 && restoredDespawnFrame >= 0) break;
    }

    check('the restored and uninterrupted traders request despawn on the same frame',
      despawnFrame >= 0 && restoredDespawnFrame === despawnFrame,
      `original ${despawnFrame}, restored ${restoredDespawnFrame}`);
    check('...and remain exactly equivalent through docking',
      diff(
        trader.state as unknown as Record<string, unknown>,
        restoredTrader.state as unknown as Record<string, unknown>,
      ).length === 0);
    check(`...where resetting only the latch makes the same fixture diverge `
      + `(the control: ${maxControlDrift.toFixed(1)} units)`,
      maxControlDrift > 10, `maximum drift ${maxControlDrift.toFixed(4)}`);
  }

  // --- energy: exact round trip, and the pre-TODO-26 migration -------------
  //
  // Energy is an integer point count now, and a save written before it carried
  // `hp` on a normalized per-hull scale. Both have to land: a new save must
  // come back on exactly the point it left, and an old one must come back at
  // the FRACTION of a hull it had, spent against the profile's real bank —
  // never full (a free repair) and never zero (dead on load).
  {
    seedWorld(20_260_726);
    const wounded = new NpcShip('pirate', at(0, 0, 0), 5);
    wounded.state.energy = 37;
    wounded.state.regenCarry = 1234;
    const world = new World();
    world.build(g1[7]);
    world.spawn('pirate', at(0, 0, 0), 5);
    world.npcs[0].state.energy = 37;
    world.npcs[0].state.regenCarry = 1234;
    const exact = world.captureNpcs();
    world.restoreNpcs(exact, (n) => specForDesign(n.role as NpcRole, n.designId));
    check('an exact energy point and its sub-tick carry round-trip untouched',
      world.npcs[0].state.energy === 37 && world.npcs[0].state.regenCarry === 1234);
    check('...and the exact profile identity comes back with it',
      world.npcs[0].profileId === wounded.profileId
      && world.npcs[0].designId === wounded.designId);
    // The migration itself must be a pure function of the save: a restore that
    // DREW to decide how much energy a ship had would move every seeded outcome
    // after it, and `Persistence.restore` puts the stream back last precisely so
    // the rebuild's own draws cannot. This is the half that is this file's.
    const beforeDraws = rngState();
    const migrated = migratedNpcState({ hp: 0.5 }, 98, 1);
    check('the pre-energy migration is pure — it draws nothing and rerolls nothing',
      JSON.stringify(rngState()) === JSON.stringify(beforeDraws)
      && migrated.energy === 49 && migrated.regenCarry === 0);
    check('...and a save that already carries energy is handed back untouched',
      migratedNpcState({ energy: 7, regenCarry: 5 }, 98, 1).energy === 7);

    // A legacy save: `hp` on the old scale, no `energy`, no `regenCarry`.
    const legacySpec = SPECS.pirate.find((s) => s.designId === world.npcs[0].designId)!;
    const legacy = exact.map((s) => {
      const { energy, regenCarry, ...rest } = s.state as Record<string, unknown>;
      void energy; void regenCarry;
      return { ...s, state: { ...rest, hp: legacySpec.legacyHullPoints * 0.25 } };
    });
    world.restoreNpcs(legacy, (n) => specForDesign(n.role as NpcRole, n.designId));
    const max = world.npcs[0].maxEnergy;
    check(`a pre-energy save keeps its quarter-hull (${world.npcs[0].state.energy}/${max})`,
      world.npcs[0].state.energy === Math.max(1, Math.round(max * 0.25))
      && world.npcs[0].state.regenCarry === 0);
    check('...and carries no stray `hp` field into the live state',
      !('hp' in (world.npcs[0].state as unknown as Record<string, unknown>)));

    // A sliver of hull was not death, so it must not round to it.
    const sliver = legacy.map((s) => ({
      ...s, state: { ...s.state, hp: legacySpec.legacyHullPoints * 0.0001 },
    }));
    world.restoreNpcs(sliver, (n) => specForDesign(n.role as NpcRole, n.designId));
    check('...and a nearly-dead ship reloads alive rather than destroyed',
      world.npcs[0].state.energy === 1);
  }

  // --- SessionState --------------------------------------------------------
  //
  // Flat by contract (the check above asserts it), so the round trip is about
  // completeness: twenty-three fields, of which a hand-written snapshot once
  // caught five, and `torusEngaged` — a field that changes your speed — was
  // among the eighteen it missed.
  {
    const session = freshState(newCommander()).session as unknown as Record<string, unknown>;
    const keys = Object.keys(session);
    // Give every field a value that is NOT its default, whatever its type, so
    // no field can round-trip by having never changed.
    let n = 0;
    for (const k of keys) {
      const v = session[k];
      if (typeof v === 'boolean') session[k] = !v;
      else if (typeof v === 'number') session[k] = v + (n += 1) + 0.5;
      else if (typeof v === 'string') session[k] = `dirty-${k}`;
    }
    const dirty = structuredClone(session);
    const wireSession = JSON.stringify(serialiseState(session));
    const target = freshState(newCommander()).session as unknown as Record<string, unknown>;
    restoreState(target, JSON.parse(wireSession) as Record<string, unknown>);
    check(`every SessionState field round-trips (${keys.length} fields)`,
      diff(dirty, target).length === 0, `lost: ${diff(dirty, target).join(', ')}`);
    check('...and no field is silently added or dropped',
      Object.keys(target).sort().join() === keys.sort().join());
    // control: an untouched session must NOT match, or the check above is free
    check('...where an untouched session does not match (the control)',
      diff(dirty, freshState(newCommander()).session as unknown as Record<string, unknown>)
        .length === keys.length);
  }

  {
    const session = freshState(newCommander()).session;
    showMessage(session, 'FUEL SCOOPS ON', 3);
    tickMessage(session, 1.25);
    check('a HUD message remains visible before its canonical lifetime expires',
      session.messageText === 'FUEL SCOOPS ON' && session.messageTimer === 1.75);
    tickMessage(session, 2);
    check('...and expiry clears both the text and remaining lifetime',
      session.messageText === '' && session.messageTimer === 0);
  }

  {
    const source = freshState(newCommander()).session;
    showMessage(source, 'INCOMING MISSILE', 4);
    tickMessage(source, 1.5);
    const saved = JSON.parse(JSON.stringify(serialiseState(
      source as unknown as Record<string, unknown>))) as Record<string, unknown>;
    const restored = freshState(newCommander()).session;
    restoreState(restored as unknown as Record<string, unknown>, saved);
    check('a half-expired HUD message resumes with the same visible lifetime',
      restored.messageText === 'INCOMING MISSILE' && restored.messageTimer === 2.5);
  }
}
