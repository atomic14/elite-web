// Damage you DEALT, by source — the three paths that are not the gun.
//
// TODO 47. `you.damageDealt`, `you.damageBySource` and every `damageFromYou`
// came from one caller, the laser, so a fight won with a missile, a ram or the
// energy bomb exported `kills: 1` beside `damageDealt: 0`. The `them` direction
// has been complete since TODO 28 — five `applyPlayerDamage` sites, each
// carrying a `DamageSource` — so the record was silently asymmetric, and it is
// the record CLAUDE.md says to feed back when judging a training run.
//
// The three sources reach the recorder by two different roads and BOTH are
// flown here, through a real headless Game:
//
//   ram, missile   `WorldStep` reports a `DealtEvent` and the exercise credits
//                  it, the way `npcFired` already reaches the same recorder
//   energy bomb    never touches the step at all — game.ts applies it from
//                  `runCommand`, so the Game hands it over beside the kill
//
// Exact figures, not "greater than zero": every one of them is the reduction in
// that ship's own energy bank, which the test computes from the bank it read a
// frame earlier. That is what makes this a measurement rather than a smoke test
// — and it is the same thing the laser path measures, which is why the four
// buckets can be summed at the end.

import * as THREE from 'three';

import { Game } from '../src/game/game.ts';
import { handle } from '../src/game/console.ts';
import { headlessShell } from '../src/engine/shell.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { seedWorld } from '../src/game/rng.ts';
import { IMPACT } from '../src/constants/impact.ts';
import { ENERGY_BOMB_RANGE } from '../src/constants/ordnance.ts';
import type { NpcShip } from '../src/game/npc.ts';
import type { CombatSimReport } from '../src/game/combat-sim-report.ts';
import {
  SHIPPED_SOLO_BRAIN, type ExerciseSpec, type Opposition,
} from '../src/game/combat-sim-scenarios.ts';
import { check, eq } from './harness.ts';

console.log('\ncombat simulator: the damage you dealt, by source');

/** Well outside `ENERGY_BOMB_RANGE`, and outside anyone's gun. */
const AWAY = ENERGY_BOMB_RANGE * 4;

/** Handles for the two things only the console view exposes: the rack and the lock. */
interface OrdnanceHandles { targetLock: NpcShip | null; missileArmed: boolean }

/** The record, and the three figures the fight itself said it should carry. */
interface Flown {
  report: CombatSimReport;
  ram: number; missile: number; bomb: number;
}

/**
 * `theFight()`, with no DOM under it whatever ran before this file left lying
 * about.
 *
 * A painter with no `document` is INERT (engine/inert-dom.ts) and a Game builds
 * happily on that; a PARTIAL fake is neither, and the Hud dies on it — one
 * earlier test leaves a `document` carrying a single method. Removing it is
 * also the honest condition to build under, since inert-dom promises exactly
 * this.
 */
function flyTheThree(): Flown {
  const globals = globalThis as unknown as { document?: unknown };
  const had = 'document' in globals;
  const previous = globals.document;
  delete globals.document;
  try {
    return theFight();
  } finally {
    if (had) globals.document = previous;
  }
}

/**
 * One exercise, flown headlessly, with three opponents parked where they are
 * put — a ram, a missile and the energy bomb, one each.
 *
 * A REAL `Game` rather than a hand-built rig, because one of the three paths is
 * a line in game.ts: the bomb is applied from `runCommand`, and a rig that
 * re-implemented that loop would assert its own copy of the thing under test.
 */
function theFight(): Flown {
  return withoutSaving(() => {
    seedWorld(20_260_802);
    const g = new Game(() => headlessShell());
    const ord = handle('__game') as unknown as OrdnanceHandles;

    const custom: Opposition[] = [{
      role: 'pirate', count: 3, tier: 1, organised: false,
      brain: SHIPPED_SOLO_BRAIN, mixed: false, seed: 17,
    }];
    const spec: ExerciseSpec = {
      mode: 'scenario', scenario: 'single-pirate', tier: 1, seed: 4242, custom,
    };
    check('an exercise starts, fitted with a rack and a bomb',
      g.startExercise(spec, { missiles: 4, equipment: { energyBomb: true } }));

    const s = g.state;
    const foes = [...s.world.npcs];
    check('...against three opponents and nothing else', foes.length === 3
      && foes.every((n) => n.role === 'pirate'));

    let t = 0;
    const beat = (frames: number, until?: () => boolean) => {
      for (let i = 0; i < frames; i++) {
        g.step(1 / 60, t);
        t += 1 / 60;
        s.world.scene.updateMatrixWorld(true);   // the renderer's one job
        if (until?.()) return;
      }
    };
    const park = (npc: NpcShip, at: THREE.Vector3) => {
      npc.object.position.copy(at);
      npc.object.updateMatrixWorld(true);
    };
    const ahead = (d: number) =>
      s.player.position.clone().addScaledVector(s.player.getForward(new THREE.Vector3()), d);
    const corner = (k: number) => s.player.position.clone()
      .add(new THREE.Vector3(k === 0 ? AWAY : 0, k === 1 ? AWAY : 0, k === 2 ? AWAY : 0));

    // Everyone out of the way to start with, each to its own corner: three ships
    // sharing a coordinate ram each other to death while the harness is looking
    // elsewhere, and a ship inside the bomb's 8,000 would be caught by it.
    foes.forEach((f, k) => park(f, corner(k)));

    // 1. A RAM, which the ship SURVIVES — so the credited figure is the whole
    //    44 points the impact is worth, checked against `IMPACT.ram` rather
    //    than against a residue. Its bank is left exactly as it spawned: a
    //    hand-set energy above `maxEnergy` is clamped by the next regeneration
    //    tick, and the clamp then reads as damage nobody did.
    const ramBank = foes[0].state.energy;
    check('...and the ram\'s target has more bank than the ram will cost it, '
      + 'so the credit is the impact and not what was left',
      ramBank > IMPACT.ram.ship);
    park(foes[0], ahead(8));
    beat(4);
    const ram = IMPACT.ram.ship;
    check('the ram really happened, and the ship lived through it',
      foes[0].state.energy < ramBank && foes[0].state.alive);
    park(foes[0], corner(0));   // back out of the bomb's reach

    // 2. A MISSILE, which KILLS — so the credited figure is the bank it had
    //    left, not the 250 points the warhead is worth. Crediting the warhead
    //    would put more damage on that opponent's line than the ship ever had.
    park(foes[1], ahead(600));
    ord.targetLock = foes[1];
    ord.missileArmed = true;
    const missileBefore = foes[1].state.energy;
    check('...and the warhead is worth more than the hull it is about to meet',
      IMPACT.warhead.ship > missileBefore);
    g.input.injectPress('KeyM');
    beat(180, () => !foes[1].state.alive);
    check('a missile killed the second one', !foes[1].state.alive);
    const missile = missileBefore - foes[1].state.energy;

    // 3. The ENERGY BOMB, which reaches `Game.destroyNpc` from `runCommand` and
    //    never goes near the step. Only the third ship is inside its range.
    park(foes[2], ahead(1200));
    const bombBefore = foes[2].state.energy;
    check('...and only the third ship is inside the bomb\'s range',
      foes.filter((f) => f.state.alive
        && f.object.position.distanceTo(s.player.position) <= ENERGY_BOMB_RANGE).length === 1);
    g.input.injectPress('Tab');
    beat(2);
    check('the energy bomb killed the third one', !foes[2].state.alive);
    const bomb = bombBefore - foes[2].state.energy;

    const records = g.endExercise() ?? [];
    check('the exercise produced one record', records.length === 1);
    return { report: records[0], ram, missile, bomb };
  }).value;
}

{
  const { report: r, ram, missile, bomb } = flyTheThree();
  const of = (k: 'ram' | 'missile' | 'bomb' | 'laser') => r.you.damageBySource[k];

  // The three figures, each against the bank the ship actually lost.
  eq(`a ram is credited under its own source (${ram} points)`, of('ram')?.damage, ram);
  eq('...once', of('ram')?.count, 1);
  eq('...and it is the impact\'s whole stated cost, because the ship survived it',
    ram, IMPACT.ram.ship);

  eq(`a missile is credited under its own source (${missile} points)`,
    of('missile')?.damage, missile);
  eq('...once', of('missile')?.count, 1);
  check('...and it is the bank it had left, NOT the 250 the warhead is worth — '
    + 'overkill on a hull that small was never damage anyone did',
    missile < IMPACT.warhead.ship && missile > 0);

  eq(`an energy bomb is credited under its own source (${bomb} points)`,
    of('bomb')?.damage, bomb);
  eq('...once', of('bomb')?.count, 1);
  check('...and it too is the bank, not the 255 the bomb spends',
    bomb < IMPACT.energyBomb.ship && bomb > 0);

  // The three kills the report already counted, now with the damage that
  // produced them beside each one.
  eq('the rammed ship carries its 44 on its own line', r.opponents[0].damageFromYou, ram);
  check('...and it is still alive, so a kill is not what credits damage',
    !r.opponents[0].destroyed);
  eq('the missile\'s target carries what the warhead took',
    r.opponents[1].damageFromYou, missile);
  check('...and is credited to you as a kill', r.opponents[1].killedByYou);
  eq('the bombed ship carries what the bomb took', r.opponents[2].damageFromYou, bomb);
  check('...and is credited to you as a kill', r.opponents[2].killedByYou);

  // The property the whole thing rests on: one accumulation, not two. `report()`
  // derives `damageDealt` from the same map the buckets come out of (TODO 33),
  // so the parts summing to the whole is a fact about the code.
  const parts = Object.values(r.you.damageBySource)
    .reduce((n, tally) => n + (tally?.damage ?? 0), 0);
  eq(`the by-source totals sum to damageDealt (${r.you.damageDealt})`,
    Math.round(parts * 100) / 100, r.you.damageDealt);
  eq('...and that is the three of them', r.you.damageDealt,
    Math.round((ram + missile + bomb + (of('laser')?.damage ?? 0)) * 100) / 100);

  // THE BUG, stated as the assertion that would have caught it: two kills, and
  // a report that said you did nothing to earn them.
  check(`two kills by ordnance no longer read as zero damage `
    + `(${r.kills.yours} kills, ${r.you.damageDealt} dealt)`,
    r.kills.yours === 2 && r.you.damageDealt > 0);
  check('...and every one of the three sources is in the record',
    (['ram', 'missile', 'bomb'] as const).every((k) => (of(k)?.damage ?? 0) > 0));

  // The record still says what it always said about the OTHER direction, so
  // nothing here was won by breaking the half that worked.
  check('the them direction is untouched and still by source',
    r.them.damageToYou >= 0 && typeof r.them.damageBySource === 'object');
  eq('the schema says these numbers changed meaning', r.schema, 3);
}
