// The Elite-A import, as a pure transform: vendored pack in, catalogue out.
//
// Nothing here touches the filesystem — `tools/import-elite-a.mjs` reads the
// files, calls `buildCatalogue()`, and `tools/elite-a/emit.mjs` renders the
// result. That split is what makes `--check` honest: the check path builds the
// identical model and compares bytes, so it cannot diverge from the write path.
//
// Every number the game will use is DERIVED here and ASSERTED against the pack,
// never transcribed. Three derivations are worth knowing about:
//
//   1. Station immunity and the Constrictor's halved incoming laser are solved
//      out of the 15,600-row oracle rather than hard-coded from the prose. Each
//      design admits exactly one of {immune, x1.0, x0.5}; `assert` says so.
//   2. NEWB flag bit positions are solved out of all 713 slot rows the same way.
//   3. A header field that never varies across a design's variants is stored
//      once on the design, not 260 times. `splitHeader()` proves the invariance
//      before it dedupes.
//
// The three oracle matrices are perfect cross-products in a fixed order, so the
// fixtures keep their axes plus flat value arrays: every one of the 15,600 /
// 3,900 / 570 rows is still reconstructible, at a fraction of the bytes. The
// importer asserts the ordering before it relies on it.

/** Throw with a useful message rather than emit a wrong catalogue. */
export function assert(condition, message) {
  if (!condition) throw new Error(`elite-a import: ${message}`);
}

/** The four fitted player lasers, in the order the pack's matrices use them. */
export const LASER_TYPES = ['pulse', 'beam', 'military', 'mining'];

/** Vertex/edge face slots use 4 bits, so 15 means "no face" — never an index. */
export const NO_FACE = 15;

/** `{ blueprintSet, designId }` is the exact-variant identity, as one string. */
export const variantId = (set, designId) => `${set}:${designId}`;

/**
 * The two halves of the header split, pinned. `src/game/elite-a/types.ts` is
 * hand-written, so a pack that moved a field from one half to the other would
 * emit records the types do not describe. Stop instead.
 */
const EXPECTED_VARYING = ['maxEnergy', 'perHitDefence', 'weaponByte', 'laserPower',
  'weaponByteShiftedHalf', 'npcLaserDamageOriginalBeforeArmour',
  'npcLaserDamageCleanBeforeArmour', 'bountyRawTenthsOfCredit', 'bountyCredits'];

// --- classification ---------------------------------------------------------

/**
 * Solve each design's incoming-player-laser rule from the hits-to-destroy
 * oracle. The candidates are the three the fidelity contract allows; a design
 * that matched none, or more than one, would mean the pack disagrees with the
 * contract and the import must stop.
 */
function classifyDesigns(hitRows, designCount) {
  const candidates = [
    { laserImmune: true, playerLaserMultiplier: 0 },
    { laserImmune: false, playerLaserMultiplier: 1 },
    { laserImmune: false, playerLaserMultiplier: 0.5 },
  ];
  const live = new Map();
  for (let id = 0; id < designCount; id += 1) live.set(id, new Set(candidates.keys()));

  for (const row of hitRows) {
    const surviving = live.get(row.targetDesignId);
    for (const index of [...surviving]) {
      const rule = candidates[index];
      const effective = rule.laserImmune ? 0 : Math.max(0,
        Math.floor(row.baseDamagePerHit * rule.playerLaserMultiplier) - row.targetPerHitDefence);
      const hits = rule.laserImmune || effective <= 0
        ? null : Math.ceil(row.targetEnergy / effective);
      if (effective !== row.effectiveDamagePerHit
        || hits !== row.hitsToDestroyWithoutRegeneration
        || (hits === null) !== row.immuneOrNoDamage) surviving.delete(index);
    }
  }

  const result = new Map();
  for (const [id, surviving] of live) {
    assert(surviving.size === 1,
      `design ${id} matches ${surviving.size} laser rules, expected exactly 1`);
    result.set(id, candidates[[...surviving][0]]);
  }
  return result;
}

/**
 * Solve the NEWB byte's bit layout from every slot row. `docking` is never set
 * in the released sets, so its bit is fixed by elimination against the other
 * seven — which is sound because all 713 rows still decode exactly, and 713
 * rows are every NEWB value the pack contains.
 */
function solveNewbBits(slotRows) {
  const names = Object.keys(slotRows[0].newbFlags);
  const bits = {};
  const taken = new Set();
  for (const name of names) {
    const fits = [];
    for (let bit = 0; bit < 8; bit += 1) {
      if (slotRows.every((row) => row.newbFlags[name] === (((row.newbRaw >> bit) & 1) === 1))) {
        fits.push(bit);
      }
    }
    assert(fits.length === 1, `NEWB flag "${name}" fits ${fits.length} bits, expected exactly 1`);
    assert(!taken.has(fits[0]), `NEWB flag "${name}" collides on bit ${fits[0]}`);
    taken.add(fits[0]);
    bits[name] = fits[0];
  }
  return bits;
}

// --- header split -----------------------------------------------------------

/** Decoded header fields; the assembler label arithmetic is not one of them. */
const HEADER_FIELDS = [
  'cargoByte', 'maxCargoCanistersOnDestruction', 'scoopedMarketItemId',
  'targetableArea', 'targetableRadiusSourceUnits', 'targetableRadiusApproxSourceUnits',
  'maxLineHeapBytes', 'maxVisibleEdges', 'gunVertexIndex', 'gunVertexByte',
  'explosionByte', 'explosionCloudOriginCount', 'vertexCount', 'vertexBytes',
  'edgeCount', 'faceCount', 'faceBytes', 'visibilityDistance', 'maxEnergy',
  'perHitDefence', 'maxSpeed', 'normalScaleExponent', 'normalScaleDivisor',
  'weaponByte', 'laserPower', 'missileCount', 'canFireLaser', 'weaponByteShiftedHalf',
  'npcLaserDamageOriginalBeforeArmour', 'npcLaserDamageCleanBeforeArmour',
  'bountyRawTenthsOfCredit', 'bountyCredits',
];

/**
 * Which header fields vary between a design's variants, and which do not.
 * The constant ones are stored once per design — the same dedup as geometry,
 * and the reason a variant record is ten numbers rather than thirty-two.
 */
function splitHeader(variants) {
  const byDesign = new Map();
  for (const variant of variants) {
    if (!byDesign.has(variant.designId)) byDesign.set(variant.designId, []);
    byDesign.get(variant.designId).push(variant);
  }
  const varying = HEADER_FIELDS.filter((field) => [...byDesign.values()]
    .some((group) => new Set(group.map((v) => v.header[field])).size > 1));
  const constant = HEADER_FIELDS.filter((field) => !varying.includes(field));
  return { byDesign, varying, constant };
}

// --- the model --------------------------------------------------------------

/**
 * Turn the parsed pack into the catalogue model the game will read.
 *
 * `pack` holds the already-parsed JSON files by short name, and `sourceHash` is
 * the manifest digest that every generated file is stamped with. The oracle
 * matrices are a separate subject and live in `fixtures.mjs`.
 */
export function buildCatalogue(pack, sourceHash) {
  const ship = pack.completeShipData;
  const players = ship.playerShips;
  const summaries = ship.shipTypeSummaries;
  const variants = ship.npcBlueprintVariants;
  const slotRows = ship.slotAssignments;
  const sets = ship.blueprintSets;
  const hitRows = pack.hitsToDestroy.rows;
  const damageRows = pack.npcDamageToPlayer.rows;
  const rangeRows = pack.hitRanges.rows;

  // The counts the task fixed in advance. Everything below assumes them.
  assert(players.length === 15, `expected 15 player hulls, got ${players.length}`);
  assert(summaries.length === 38, `expected 38 designs, got ${summaries.length}`);
  assert(sets.length === 23, `expected 23 blueprint sets, got ${sets.length}`);
  assert(variants.length === 260, `expected 260 exact variants, got ${variants.length}`);
  assert(slotRows.length === 713, `expected 713 slot rows, got ${slotRows.length}`);
  const populatedSlots = slotRows.filter((row) => row.designId !== null
    && row.designId !== undefined);
  assert(populatedSlots.length === 398,
    `expected 398 populated slots, got ${populatedSlots.length}`);
  assert(hitRows.length === 15600, `expected 15600 outgoing-hit rows, got ${hitRows.length}`);
  assert(damageRows.length === 3900, `expected 3900 incoming-hit rows, got ${damageRows.length}`);
  assert(rangeRows.length === 570, `expected 570 range rows, got ${rangeRows.length}`);
  assert(summaries.every((d, i) => d.designId === i), 'designs are not numbered 0..37 in order');

  // The pack ships two tables twice, standalone and inside the complete file.
  // Reading one and ignoring the other would leave a copy nothing checks.
  assert(JSON.stringify(pack.playerShips.playerShips) === JSON.stringify(players),
    'elite_a_player_ships.json disagrees with elite_a_complete_ship_data.json');
  assert(JSON.stringify(pack.npcShipSummary.shipTypeSummaries) === JSON.stringify(summaries),
    'elite_a_npc_ship_summary.json disagrees with elite_a_complete_ship_data.json');

  const classification = classifyDesigns(hitRows, summaries.length);
  const newbBits = solveNewbBits(slotRows);
  const { byDesign, varying, constant } = splitHeader(variants);
  assert(byDesign.size === 38, `expected variants for 38 designs, got ${byDesign.size}`);
  assert(varying.join(',') === EXPECTED_VARYING.join(','),
    `header fields varying per variant changed: ${varying.join(',')}`);

  // --- geometry: one per design, deduplicated, every index checked ----------
  const geometry = [];
  for (const [designId, group] of [...byDesign].sort((a, b) => a[0] - b[0])) {
    const shape = JSON.stringify(group[0].geometry);
    assert(group.every((v) => JSON.stringify(v.geometry) === shape),
      `design ${designId} has more than one geometry across its variants`);
    const { vertices, edges, faces } = group[0].geometry;
    const header = group[0].header;
    assert(vertices.length === header.vertexCount && edges.length === header.edgeCount
      && faces.length === header.faceCount, `design ${designId} geometry contradicts its header`);
    const faceOk = (index) => index === NO_FACE || (Number.isInteger(index)
      && index >= 0 && index < faces.length);
    for (const vertex of vertices) {
      for (const key of ['face1', 'face2', 'face3', 'face4']) {
        assert(faceOk(vertex[key]), `design ${designId} vertex ${key}=${vertex[key]} out of range`);
      }
    }
    for (const edge of edges) {
      for (const key of ['vertex1', 'vertex2']) {
        assert(Number.isInteger(edge[key]) && edge[key] >= 0 && edge[key] < vertices.length,
          `design ${designId} edge ${key}=${edge[key]} out of range`);
      }
      for (const key of ['face1', 'face2']) {
        assert(faceOk(edge[key]), `design ${designId} edge ${key}=${edge[key]} out of range`);
      }
    }
    geometry.push({
      designId,
      vertices: vertices.flatMap((v) => [v.x, v.y, v.z,
        v.face1, v.face2, v.face3, v.face4, v.visibility]),
      edges: edges.flatMap((e) => [e.vertex1, e.vertex2, e.face1, e.face2, e.visibility]),
      faces: faces.flatMap((f) => [f.normalX, f.normalY, f.normalZ, f.visibility]),
    });
  }

  // --- variants -------------------------------------------------------------
  const emittedVariants = variants.map((variant) => {
    const header = variant.header;
    assert(header.bountyCredits * 10 === header.bountyRawTenthsOfCredit,
      `variant ${variantId(variant.blueprintSet, variant.designId)} bounty units disagree`);
    assert(header.targetableRadiusApproxSourceUnits === Math.sqrt(header.targetableArea),
      `variant ${variantId(variant.blueprintSet, variant.designId)} radius is not sqrt(area)`);
    const row = {
      variantId: variantId(variant.blueprintSet, variant.designId),
      blueprintSet: variant.blueprintSet,
      designId: variant.designId,
      presentInSlots: [...variant.presentInSlots],
    };
    for (const field of varying) row[field] = header[field];
    delete row.bountyCredits; // whole credits; the raw tenths are the money unit
    return row;
  });
  const variantById = new Map(emittedVariants.map((v) => [v.variantId, v]));
  assert(variantById.size === emittedVariants.length, 'exact variant ids are not unique');

  // --- designs --------------------------------------------------------------
  const recommendedTuple = ['maxEnergy', 'perHitDefence', 'maxSpeed', 'laserPower',
    'missileCount', 'weaponByte', 'canFireLaser', 'npcLaserDamageOriginalBeforeArmour',
    'npcLaserDamageCleanBeforeArmour', 'bountyRawTenthsOfCredit',
    'maxCargoCanistersOnDestruction'];
  const designs = summaries.map((summary) => {
    const group = byDesign.get(summary.designId);
    const header = group[0].header;
    // The pack lists variants in A-W source order, so the first match IS the
    // A-W tie-break. Never average: an averaged profile is not a real ship.
    const match = group.find((variant) => recommendedTuple
      .every((field) => variant.header[field] === summary.recommendedDefault[field]));
    assert(match !== undefined,
      `design ${summary.designId} (${summary.shipName}) recommended default matches no variant`);
    const design = {
      designId: summary.designId,
      shipSymbol: summary.shipSymbol,
      shipName: summary.shipName,
      variantCount: group.length,
      blueprintSets: group.map((v) => v.blueprintSet),
      allowedBlueprintSlots: [...summary.allowedBlueprintSlots],
      spawnInstallProbabilityRaw: summary.spawnInstallProbabilityRaw,
      spawnInstallProbabilityPercent: summary.spawnInstallProbabilityPercent,
      standardEscapePod: summary.standardEscapePod,
      laserImmune: classification.get(summary.designId).laserImmune,
      playerLaserMultiplier: classification.get(summary.designId).playerLaserMultiplier,
      recommendedVariantId: variantId(match.blueprintSet, match.designId),
    };
    assert(summary.variantCount === group.length,
      `design ${summary.designId} variant count disagrees with its variants`);
    for (const field of constant) design[field] = header[field];
    delete design.targetableRadiusApproxSourceUnits; // asserted === sqrt(targetableArea)
    design.recommendedDefault = Object.fromEntries(
      recommendedTuple.map((field) => [field, summary.recommendedDefault[field]]));
    return design;
  });

  // --- slots ----------------------------------------------------------------
  const nameById = new Map(designs.map((d) => [d.designId, d.shipName]));
  const emittedSlots = slotRows.map((row) => {
    const designId = row.designId ?? null;
    assert(designId === null || nameById.get(designId) === row.shipName,
      `slot ${row.blueprintSet}/${row.slot} names design ${designId} inconsistently`);
    return {
      blueprintSet: row.blueprintSet,
      slot: row.slot,
      slotCategory: row.slotCategory,
      designId,
      shipSymbol: row.shipSymbol ?? null,
      newbRaw: row.newbRaw,
    };
  });

  return {
    sourceHash,
    newbBits,
    playerHulls: players.map((hull) => ({ ...hull })),
    designs,
    variants: emittedVariants,
    slots: emittedSlots,
    geometry,
    varyingHeaderFields: varying,
    constantHeaderFields: constant,
    counts: {
      playerHulls: players.length,
      designs: designs.length,
      blueprintSets: sets.length,
      variants: emittedVariants.length,
      slotRows: emittedSlots.length,
      populatedSlots: populatedSlots.length,
      outgoingHitRows: hitRows.length,
      incomingHitRows: damageRows.length,
      rangeRows: rangeRows.length,
    },
  };
}
