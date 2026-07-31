// The explicit live-combat observation seam.
//
// A console recorder once learned the damage source by replacing
// Game.applyPlayerDamage and reading its third argument. These tests pin the
// typed seam that replaced that implicit production signature.

import * as THREE from 'three';

import { headlessShell } from '../src/engine/shell.ts';
import { Game } from '../src/game/game.ts';
import { CombatInstrumentation } from '../src/game/instrumentation.ts';
import { withoutSaving } from '../src/game/storage.ts';
import { check, eq } from './harness.ts';

console.log('\ncombat instrumentation');
{
  const instrumentation = new CombatInstrumentation();
  const from = new THREE.Vector3(4, 5, 6);
  const seen: Array<{ amount: number; from: THREE.Vector3; source: string }> = [];
  const stop = instrumentation.setObserver({
    onPlayerDamaged: (amount, where, source) => {
      seen.push({ amount, from: where, source });
      where.set(99, 99, 99);
    },
  });

  instrumentation.playerDamaged(0.45, from, 'ram');
  eq('damage source reaches the registered observer', seen[0]?.source, 'ram');
  check('...with the exact amount and a position snapshot',
    seen[0]?.amount === 0.45 && seen[0].from.x === 99 && from.equals(new THREE.Vector3(4, 5, 6)));

  stop();
  instrumentation.playerDamaged(1.3, from, 'missile');
  eq('disposing instrumentation makes later damage inert', seen.length, 1);

  instrumentation.setObserver(null);
  instrumentation.playerDamaged(0.06, from, 'cargo');
  eq('optional instrumentation is inert when never installed', seen.length, 1);
}

{
  const instrumentation = new CombatInstrumentation();
  let first = 0;
  let second = 0;
  const stopFirst = instrumentation.setObserver({
    onPlayerDamaged: () => { first += 1; },
  });
  instrumentation.setObserver({
    onPlayerDamaged: () => { second += 1; },
  });

  stopFirst();
  instrumentation.playerDamaged(0.1, new THREE.Vector3(), 'laser');
  check('an old disposer cannot detach a replacement observer',
    first === 0 && second === 1);
}

{
  // Exercise the production route, not only the observer slot: a hull collision
  // is one of WorldStep's five statically-tagged damage call sites.
  withoutSaving(() => {
    const game = new Game(() => headlessShell());
    let source = '';
    game.setCombatObserver({
      onPlayerDamaged: (_amount, _from, kind) => { source = kind; },
    });
    game.launch();
    game.state.player.position.copy(game.state.world.station.position);
    game.update(1 / 60, 0);
    eq('the real world step carries its source through Game to the observer',
      source, 'station');
  });
}
