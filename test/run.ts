// Project tests — plain Node, no framework.
//
//   npm test
//
// This file is an INDEX. It imports each subsystem's tests, which run on import,
// and prints one total with one exit code. There is deliberately no logic here:
// adding tests means a new file and one line below, so two people adding two
// subsystems collide on one line rather than inside a shared block.
//
// It was 5,300 lines, and every section of the suite lived in it. That is not a
// tidiness problem — it is the failure the 400-line ceiling exists for, and this
// file is where it bit hardest: three agents working on unrelated modules all
// appended here, and one merge spliced a section inside another's block and left
// an unbalanced brace. The tests are organised like `src/` now, so a change to
// one subsystem touches one test file.
//
// Everything here is headless — no WebGL, no DOM.
//
//   harness.ts    check/eq and the counters; the only shared machinery
//   fixtures.ts   data two or more files need (galaxy 1, the shipped brains)
//
// CLAUDE.md's invariants are asserted across these files: the 1984 galaxy in
// galaxy, one combat model in combat-model, no `Math.random` and no ambient
// globals in state, and that nothing in the combat trainer can reach your
// career in combat-sim-career.

// --- the world --------------------------------------------------------------
import './galaxy.test.ts';
import './economy.test.ts';
import './contracts.test.ts';
import './world.test.ts';
import './world-step.test.ts';
import './state.test.ts';
import './snapshot.test.ts';

// --- ships, and being shot at ----------------------------------------------
import './flight.test.ts';
import './npc.test.ts';
import './combat.test.ts';
import './gunnery.test.ts';

// --- the trained brains -----------------------------------------------------
import './ai.test.ts';
import './combat-model.test.ts';
import './arena.test.ts';

// --- the shell --------------------------------------------------------------
import './ui.test.ts';

// --- the docked combat trainer ----------------------------------------------
import './combat-sim.test.ts';
import './combat-sim-scenarios.test.ts';
import './combat-sim-report.test.ts';
import './combat-sim-career.test.ts';

import { summarise } from './harness.ts';

// One total and one exit code for every file above — see test/harness.ts.
summarise();
