// The Elite-A alignment gate — `npm run elite-a`.
//
//   npm run elite-a
//
// One command that proves the vendored pack, the generated catalogue, the ship
// identities, the geometry and the live damage model have not drifted apart.
// TODO 30 asks for it to be permanent and fast enough to run routinely; it is
// both, because it REUSES the suites that already own each claim rather than
// restating any of them. There is no assertion in this file and there must not
// be one: a gate that grew its own copy of a rule would be the second home this
// project keeps deleting.
//
// It is an INDEX, in the same style as `test/run.ts` — the imports run on load
// and `summarise()` prints one total and one exit code. What it adds over
// `npm test` is a NAME: a failure here says "the Elite-A alignment broke",
// which is the signal the pack's importer, the oracle and the roster share and
// nothing else does.
//
// `npm run elite-a` runs the hash-and-drift half first, in `package.json`:
// `npm run generate:elite-a -- --check` re-reads `reference/elite-a/source`,
// refuses a pack whose SHA-256 is not the pinned one, regenerates everything
// in memory and fails on any difference. That part cannot live here, because
// the whole point of it is that it reads the pack and `src/` never may.
//
// WHAT EACH BULLET OF THE TASK IS COVERED BY. The list is TODO 30's own, and
// the file beside it is where that claim actually lives:
//
//   vendored hashes + generated output current
//                             tools/import-elite-a.mjs --check (the npm script)
//   15 hulls · 38 designs · 23 sets · 260 variants · 713/398 slots
//                             elite-a-catalogue.test.ts
//   38 geometries and target radii validate
//                             elite-a-catalogue.test.ts (indices, radii)
//                             geometry.test.ts (closure, winding, scale, nose)
//   15,600 + 3,900 + 570 oracle rows
//                             elite-a-oracle.test.ts
//   every id resolves and round-trips, every recommended lookup is a real
//   variant with the matching tuple
//                             ship-identity.test.ts, elite-a-catalogue.test.ts
//   legacy player / NPC / systems migrations
//                             ship-identity.test.ts, systems.test.ts
//   runtime lasers call the shared oracle
//                             elite-a-live-combat.test.ts (15,600 outgoing)
//                             elite-a-live-defence.test.ts (3,900 incoming)
//   no retired normalized HP, random NPC laser damage or mixed-unit adapter
//                             damage-paths.test.ts
//   the ten formerly missing ships are constructible and role-reachable
//                             ship-roles.test.ts
//   custom Harmless profiles are excluded from source-parity claims
//                             ship-roles.test.ts, elite-a-live-combat.test.ts,
//                             elite-a-live-defence.test.ts
//
// role-variants.test.ts is here too: it is the gate on WHICH released build a
// job flies, which is the selection policy the fidelity contract insists stays
// outside combat.
//
// Adding a file here does not remove it from `npm test`. Both indexes import
// the same modules; neither owns them.
//
// NOT IN `npm run check`, deliberately. `check` already runs `npm test`, which
// imports every file below, and `npm run generate:elite-a -- --check`, which is
// this command's other half — so adding it there would run the same assertions
// twice and slow the pre-build gate for nothing. It runs in CI as its own named
// step instead, for the reason the workflow file states: a failure that names
// itself. Under a second, so run it by hand whenever the pack, the catalogue,
// the roster or a damage rule is touched.

// --- the pack, as imported --------------------------------------------------
import './elite-a-catalogue.test.ts';
import './elite-a-oracle.test.ts';

// --- what the game does with it ---------------------------------------------
import './elite-a-live-combat.test.ts';
import './elite-a-live-defence.test.ts';
import './damage-paths.test.ts';
import './systems.test.ts';

// --- who is flying it -------------------------------------------------------
import './ship-identity.test.ts';
import './ship-roles.test.ts';
import './role-variants.test.ts';
import './geometry.test.ts';

import { summarise } from './harness.ts';

summarise();
