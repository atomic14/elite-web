// The three combat oracles, compacted into test fixtures.
//
// Separate from `build.mjs` because it is a separate subject: that file decides
// what the GAME will know, this one decides what the exhaustive tests will read.
// Nothing here reaches `src/`.
//
// All three matrices are perfect cross-products in a fixed order — 15 hulls x 4
// lasers x 260 variants, 260 variants x 15 hulls, 15 hulls x 38 designs — and
// every non-oracle column in them is already in the catalogue. So a fixture
// keeps its AXES plus flat arrays of the values that only the oracle knows.
// Every one of the 15,600 / 3,900 / 570 rows is still reconstructible, at a
// twentieth of the bytes.
//
// That only holds if the ordering really is the cross-product, so each loop
// re-derives the key it expects and asserts the row agrees. A pack that
// reordered its rows stops the import rather than silently shifting an oracle
// by one.

import { assert, LASER_TYPES, variantId } from './build.mjs';

/** Hits to destroy: 15 hulls x 4 lasers x 260 variants, without regeneration. */
function hitsToDestroyFixture(rows, sourceHash, playerNames, variantIds) {
  let cursor = 0;
  const effectiveDamagePerHit = new Array(rows.length);
  const hitsToDestroy = new Array(rows.length);
  for (const playerShip of playerNames) {
    for (const laserType of LASER_TYPES) {
      for (const id of variantIds) {
        const row = rows[cursor];
        assert(row.playerShip === playerShip && row.laserType === laserType
          && variantId(row.targetBlueprintSet, row.targetDesignId) === id,
          `hits-to-destroy row ${cursor} is not player-major/laser/variant order`);
        assert((row.hitsToDestroyWithoutRegeneration === null) === row.immuneOrNoDamage,
          `hits-to-destroy row ${cursor} disagrees with its own immune flag`);
        effectiveDamagePerHit[cursor] = row.effectiveDamagePerHit;
        hitsToDestroy[cursor] = row.hitsToDestroyWithoutRegeneration;
        cursor += 1;
      }
    }
  }
  return {
    sourceHash,
    order: 'playerShips x laserTypes x variants, in this order',
    playerShips: playerNames,
    laserTypes: LASER_TYPES,
    variants: variantIds,
    effectiveDamagePerHit,
    hitsToDestroy,
  };
}

/**
 * NPC laser onto the player: 260 variants x 15 hulls.
 *
 * Damage before armour depends only on the attacker, so it is stored once per
 * variant; after armour depends on both and is stored per row. Both encodings
 * are kept — `clean` is what gameplay uses, `original` is the released
 * `weaponByte >> 1` that lets missile count leak into laser damage.
 */
function npcDamageFixture(rows, sourceHash, players, playerNames, variantIds) {
  let cursor = 0;
  const cleanAfterArmour = new Array(rows.length);
  const originalAfterArmour = new Array(rows.length);
  const cleanBeforeArmour = new Array(variantIds.length);
  const originalBeforeArmour = new Array(variantIds.length);
  for (const [index, id] of variantIds.entries()) {
    for (const playerShip of playerNames) {
      const row = rows[cursor];
      assert(variantId(row.attackerBlueprintSet, row.attackerDesignId) === id
        && row.playerShip === playerShip,
        `npc-damage row ${cursor} is not variant-major/player order`);
      cleanBeforeArmour[index] = row.cleanDamageBeforeArmour;
      originalBeforeArmour[index] = row.originalDamageBeforeArmour;
      cleanAfterArmour[cursor] = row.cleanDamageAfterArmour;
      originalAfterArmour[cursor] = row.originalDamageAfterArmour;
      cursor += 1;
    }
  }
  return {
    sourceHash,
    order: 'variants x playerShips; the before-armour arrays are per variant',
    variants: variantIds,
    playerShips: playerNames,
    playerPerHitShieldArmour: players.map((p) => p.perHitShieldArmour),
    cleanBeforeArmour,
    originalBeforeArmour,
    cleanAfterArmour,
    originalAfterArmour,
  };
}

/** The readable summary: 15 hulls x 38 designs, min-max hits across variants. */
function hitRangesFixture(rows, sourceHash, playerNames, designNames) {
  let cursor = 0;
  const out = [];
  for (const playerShip of playerNames) {
    for (const shipName of designNames) {
      const row = rows[cursor];
      assert(row.playerShip === playerShip && row.targetShip === shipName,
        `hit-range row ${cursor} is not player-major/design order`);
      out.push(LASER_TYPES.flatMap((laser) => {
        const cell = row.lasers[laser];
        return [cell.minimumHits, cell.maximumHits,
          cell.noDamageOrImmuneVariantCount, cell.allVariantsImmuneOrTakeNoDamage ? 1 : 0];
      }));
      cursor += 1;
    }
  }
  return {
    sourceHash,
    order: 'playerShips x designs; each row is 4 lasers x '
      + '[minimumHits, maximumHits, noDamageOrImmuneVariantCount, allImmune]',
    playerShips: playerNames,
    designs: designNames,
    laserTypes: LASER_TYPES,
    rows: out,
  };
}

/** All three oracles, keyed by the fixture file each becomes. */
export function buildFixtures(pack, sourceHash, { players, designs, variants }) {
  const playerNames = players.map((p) => p.name);
  const variantIds = variants.map((v) => v.variantId);
  const designNames = designs.map((d) => d.shipName);
  return {
    hitsToDestroy: hitsToDestroyFixture(
      pack.hitsToDestroy.rows, sourceHash, playerNames, variantIds),
    npcDamageToPlayer: npcDamageFixture(
      pack.npcDamageToPlayer.rows, sourceHash, players, playerNames, variantIds),
    hitRanges: hitRangesFixture(
      pack.hitRanges.rows, sourceHash, playerNames, designNames),
  };
}
