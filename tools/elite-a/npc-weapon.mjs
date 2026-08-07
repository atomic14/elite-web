// Superseding the pack's NPC-laser decode — the one bug the vendored pack shipped.
//
// The pack precomputed its NPC laser columns with a THREE-bit power field
// (`(weaponByte >> 3) & 7`). The field is five bits wide — missiles in bits 0-2,
// laser power in bits 3-7 — so the mask capped power at 7 and zeroed the four
// ships whose power needs bit 6: the Anaconda and Asp Mk II (byte 79/73, power 9),
// the Constrictor and Dragon (byte 71/79, power 8). The pack even contradicts
// itself — its `original` column reads the whole byte (`>> 1`) while its `clean`
// column drops bit 6 — so this is a bug in the pack's derivation, not a rule to
// preserve. The one home for the correct rule is `src/game/elite-a/combat-math.ts`
// `eliteANpcLaserPower`; these mirror it and the oracle test proves they agree.
//
// The raw `weaponByte` is untouched and stays the single source of truth; only
// the columns DERIVED from it are recomputed. The assertion pins the correction
// to exactly that bug class — nothing changes for a byte whose power already fits
// in three bits — so a future pack change that altered any other laser value
// would stop the import rather than be silently overwritten.

import { assert, variantId } from './build.mjs';

const npcLaserPower = (weaponByte) => weaponByte >> 3;
const npcCanFire = (weaponByte) => npcLaserPower(weaponByte) > 0;
const npcCleanBeforeArmour = (weaponByte) =>
  npcCanFire(weaponByte) ? npcLaserPower(weaponByte) << 2 : 0;
const npcOriginalBeforeArmour = (weaponByte) =>
  npcCanFire(weaponByte) ? weaponByte >> 1 : 0;

/**
 * Overwrite one object's NPC-laser columns from its own `weaponByte`, in place.
 *
 * Only the fields the object actually carries are touched, and every change is
 * asserted to fall on a byte the three-bit mask would have got wrong (power > 7,
 * i.e. bit 6 or 7 set). `armour` (`playerPerHitShieldArmour`) is present only on
 * the damage rows, which are the only objects with after-armour columns.
 */
function correctLaserFields(obj, where) {
  const byte = obj.weaponByte;
  const armour = obj.playerPerHitShieldArmour;
  const clean = npcCleanBeforeArmour(byte);
  const original = npcOriginalBeforeArmour(byte);
  const corrected = {
    laserPower: npcLaserPower(byte),
    canFireLaser: npcCanFire(byte),
    npcLaserDamageCleanBeforeArmour: clean,
    npcLaserDamageOriginalBeforeArmour: original,
    cleanDamageBeforeArmour: clean,
    originalDamageBeforeArmour: original,
    cleanDamageAfterArmour: Math.max(0, clean - armour),
    originalDamageAfterArmour: Math.max(0, original - armour),
  };
  for (const [field, value] of Object.entries(corrected)) {
    if (!(field in obj)) continue;
    if (obj[field] !== value) {
      assert(npcLaserPower(byte) > 7,
        `${where}: ${field} for weapon byte ${byte} changed (${obj[field]} -> ${value}) `
        + 'but its power fits in three bits — the pack disagrees somewhere new');
    }
    obj[field] = value;
  }
}

/**
 * Recompute every NPC-laser column in the parsed pack from its weapon bytes.
 *
 * Mutates the in-memory pack only; the vendored files and their pinned hashes
 * are untouched. Runs before `buildCatalogue`/`buildFixtures` so both read the
 * corrected numbers, and covers all four places the pack encodes the decode: the
 * variant headers, both copies of each design's recommended default, and the
 * 3,900 NPC-damage rows.
 */
export function correctNpcLaserDecode(pack) {
  for (const variant of pack.completeShipData.npcBlueprintVariants) {
    correctLaserFields(variant.header, `variant ${variantId(variant.blueprintSet, variant.designId)}`);
  }
  for (const summaries of [pack.completeShipData.shipTypeSummaries,
    pack.npcShipSummary.shipTypeSummaries]) {
    for (const summary of summaries) {
      correctLaserFields(summary.recommendedDefault, `design ${summary.designId} default`);
    }
  }
  for (const [index, row] of pack.npcDamageToPlayer.rows.entries()) {
    correctLaserFields(row, `damage row ${index}`);
  }
}
