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
import './descriptions.test.ts';
import './encyclopaedia.test.ts';
import './economy.test.ts';
import './contracts.test.ts';
import './trade.test.ts';
import './world.test.ts';
import './world-step.test.ts';
import './station.test.ts';
import './game.test.ts';
import './state.test.ts';
import './snapshot.test.ts';
import './persistence.test.ts';
import './saves.test.ts';
import './save-screens.test.ts';
import './save-transfer.test.ts';
import './career-identity.test.ts';
import './new-commander.test.ts';

// --- ships, and being shot at ----------------------------------------------
import './flight.test.ts';
import './geometry.test.ts';
import './npc.test.ts';
import './break-off.test.ts';
import './pass-aim.test.ts';
import './systems.test.ts';
import './energy-low.test.ts';
import './combat.test.ts';
import './gunnery.test.ts';
import './fire-resolution.test.ts';
import './missiles.test.ts';
import './instrumentation.test.ts';
import './damage-paths.test.ts';
import './elite-a-catalogue.test.ts';
import './elite-a-oracle.test.ts';
import './elite-a-live-combat.test.ts';
import './elite-a-live-defence.test.ts';
import './ship-identity.test.ts';
import './ship-roles.test.ts';
import './role-variants.test.ts';

// --- the trained brains -----------------------------------------------------
import './ai.test.ts';
import './brain-names.test.ts';
import './combat-model.test.ts';
import './selection.test.ts';
import './arena.test.ts';

// --- the shell --------------------------------------------------------------
import './ui.test.ts';
import './key-help.test.ts';
import './input.test.ts';
import './hud-binding.test.ts';

// --- the docked combat trainer ----------------------------------------------
import './combat-sim.test.ts';
import './combat-sim-panel.test.ts';
import './combat-sim-rows.test.ts';
import './combat-sim-scenarios.test.ts';
import './combat-sim-report.test.ts';
import './combat-sim-dealt.test.ts';
import './combat-sim-compare.test.ts';
import './combat-sim-flight.test.ts';
import './combat-sim-opening.test.ts';
import './combat-sim-strip.test.ts';
import './combat-sim-career.test.ts';

// Installs a fake AudioContext, so keep it after every behavioural test that
// may call a richer sound such as explosion().
import './audio.test.ts';

import { summarise } from './harness.ts';

// One total and one exit code for every file above — see test/harness.ts.
summarise();
