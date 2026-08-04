// The trained brains: that they load, that they still win, and who flies which.
//
// The regression gate on neuroevolution. It reads the shipped brain names out of
// brains.ts rather than hardcoding them, because a retrain under a new name would
// otherwise silently orphan the check — which is exactly what happened once, and
// the suite went on measuring two brains the game did not fly.

import { readFileSync, readdirSync } from 'node:fs';
import { DEFEND_BRAIN } from '../src/game/brains.ts';
import { LIVE_BRAIN_IDS, isNamedBrain } from '../src/game/brain-names.ts';
import { handle, installPolicyKit } from '../src/game/console.ts';
import { Episode } from '../src/ai-training/scenario.ts';
import { randomBrain, type BrainFile } from '../src/ai-training/policy.ts';
import { makeRng } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';
import {
  DT,
  BRAINS,
  SHIPPED_PIRATE,
  SHIPPED_DEFEND,
  brainsSrc,
  shippedPirate,
  jameson,
} from './fixtures.ts';

// --- simulation determinism -------------------------------------------------

console.log('\nsimulation');
function runEpisode(seed: number): string {
  const ep = new Episode({
    seed,
    pirates: [{ kind: 'scripted' }],
    trader: { kind: 'scripted' },
  });
  while (!ep.done) ep.step(DT);
  return `${ep.t.toFixed(4)}|${ep.trader.hp.toFixed(4)}|${ep.pirates[0].shotsFired}`;
}
eq('identical seeds produce identical episodes', runEpisode(4242), runEpisode(4242));
check('different seeds produce different episodes', runEpisode(1) !== runEpisode(2));

// --- the shipped brains still beat their baselines ---------------------------

console.log('\ntrained policies (held-out seeds)');
const HOLD_OUT = 10_000_019;
/**
 * Episodes per baseline check.
 *
 * Was 12, which is 8.3% granularity — too coarse for a 35% bound, and an
 * audit showed three of six neighbouring HOLD_OUT seeds flipped the result.
 * It was measuring luck. 60 costs about a second and the suite runs in one.
 */
const N = 60;

/**
 * Mean share of the target's three pools the attackers took, 0..1.
 *
 * THE GATE USED TO BE A KILL RATE, and TODO 29 retired it. The episode's target
 * is the commander now — two 255-point shields and a 255-point bank, hit for
 * the source rule's 9 to 21 points a time — and a pirate lands about seven hits
 * in forty-five seconds. So nothing kills her inside an episode and a kill rate
 * is 0 for every policy including the aimbot, which measures nothing at all.
 *
 * The share of her pools removed is the same quantity with its granularity
 * back, and it separates the brains as sharply as the kill rate ever did:
 * measured over these 60 held-out seeds, the shipped brain takes 12.0%, an
 * untrained policy 1.7%, and the scripted aimbot 25.3%.
 */
function poolShare(makeEp: (seed: number) => Episode): number {
  let taken = 0;
  for (let e = 0; e < N; e++) {
    const ep = makeEp(HOLD_OUT + e * 7919);
    while (!ep.done) ep.step(DT);
    taken += ep.targetDamageShare();
  }
  return taken / N;
}

const shippedPirateHurt = poolShare((seed) => new Episode({
  seed, pirates: [{ kind: 'policy', brain: shippedPirate }], trader: { kind: 'scripted' },
}));
const randomPirateHurt = poolShare((seed) => new Episode({
  seed, pirates: [{ kind: 'policy', brain: randomBrain(makeRng(seed)) }], trader: { kind: 'scripted' },
}));
// Bounds measured at N=60 over the seeds above, against the brains the game
// actually flies and the source-scale pools they now shoot at.
//
// It is a floor on COMPETENCE, not on killing. Generation 3 is the first brain
// aimed at how the game feels rather than at how lethal it is — CLAUDE.md:
// "Lethality is a proxy for threat, and threat is not fun" — so what has to
// hold is that it hurts the commander several times as much as a policy that
// has learnt nothing, not that it wins.
check(`shipped pirate ${SHIPPED_PIRATE} hurts the commander`
  + ` (${(shippedPirateHurt * 100).toFixed(1)}% of her pools)`,
shippedPirateHurt >= 0.07);
check(`untrained policy barely scratches her (${(randomPirateHurt * 100).toFixed(1)}%)`,
  randomPirateHurt <= 0.05);
check('shipped pirate beats the untrained baseline by a factor of three',
  shippedPirateHurt > randomPirateHurt * 3);

// two of whatever the game actually sends at you
const twoPirates = () => [
  { kind: 'policy' as const, brain: shippedPirate },
  { kind: 'policy' as const, brain: shippedPirate },
];
const jamesonHurt = poolShare((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'policy', brain: jameson }, traderArmed: true,
}));
const scriptedHurt = poolShare((seed) => new Episode({
  seed, pirates: twoPirates(), trader: { kind: 'scripted' }, traderArmed: true,
}));
// Bounds set from measurement, not hope, and on the same pool share for the
// same reason: two pirates cannot destroy the commander inside 45 seconds, so
// "dies 48%" has become "dies 0%" for every defender including a scripted one,
// and the gate would pass for a brain that does nothing. What the defence brain
// is FOR is keeping their guns off her — measured here, it holds them to 20.8%
// of her pools where a scripted trader lets them take 23.5%.
check(`shipped defence ${SHIPPED_DEFEND} holds 2v1`
  + ` (they take ${(jamesonHurt * 100).toFixed(1)}% of her pools)`,
jamesonHurt <= 0.35);
check(`...and a scripted trader lets them take more (${(scriptedHurt * 100).toFixed(1)}%)`,
  scriptedHurt > jamesonHurt);

// --- we ship what we ship, and only that -------------------------------------
//
// THE DIRECTORY IS THE CLAIM. It held 34 weights files, the game imported 9 and
// three of them flew: everything else was an experiment kept as evidence, and
// evidence belongs in docs/TRAINING-LOG.md and train/logs/ rather than in every
// player's download. TODO 57 deleted the other 31, and this is what stops them
// drifting back — in both directions, because both have happened. A file nobody
// ships once reached the bundle through the combat viewer (a round-one pack
// policy under a label claiming it was the shipped gang), and a shipped brain
// once went missing from the regression gate when a retrain renamed it.
//
// Neither side of the comparison is typed out here. One is the directory; the
// other is read out of brains.ts, which is where a weights file gets into the
// bundle at all.

console.log('\nbrain files');
const IMPORTED = [...new Set([...brainsSrc.matchAll(/brains\/([\w.-]+)\.json/g)]
  .map((m) => m[1]))].sort();
const ON_DISK = readdirSync(BRAINS).filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, '')).sort();
// Every policy the game can BE PUT INTO, asked of brain-names.ts rather than
// restated. `scripted` is not here because it is a code path with no weights.
//
// This used to be the three the SHIPPED rule flies, and that is too narrow —
// SELECTABLE and SHIPPED are not the same list. Since `d563e3d` the shipped
// solo and gang policy is `scripted`, a code path with no weights, so the
// shipped rule names exactly one weights file (`jameson-defend-g1`): under the
// old wording `pirate-attack-g3` and `pirate-pack-r4-selectonly` — the two
// trained policies the trainer's LIVE BRAINS row exists to fly — would both
// read as weights nothing ships. They are flown, just not by default.
//
// So the claim is "no weights in the bundle that nothing can select", which
// is what the guard was always protecting: a file no selection reaches still
// fails, and the viewer's two mislabelled pack policies would still be caught.
// `LIVE_BRAIN_IDS` is the picker's own list, so this cannot drift from what the
// panel offers.
const FLOWN = [...new Set(
  LIVE_BRAIN_IDS.filter(isNamedBrain).filter((n) => n !== 'scripted'),
)].sort();

// ...and brains.ts is the ONLY way in. This is the other half of the claim, and
// it is the half the combat viewer broke twice: it imported `pirate-attack.json`
// and `pirate-pack.json` directly, so weights the game does not fly were in a
// shipped bundle under labels implying they were the shipped ones. A page that
// wants the shipped policy asks `brains.ts` for it by role, which is one home
// and cannot be labelled wrong.
{
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : /\.ts$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const root = new URL('../src/', import.meta.url).pathname;
  const importers = walk(new URL('../src/', import.meta.url))
    .map((f) => ({ rel: f.pathname.slice(root.length), f }))
    .filter(({ f }) => /from '[^']*ai-training\/brains\//.test(readFileSync(f, 'utf8')))
    .map(({ rel }) => rel);
  check(`game/brains.ts is the only file in src/ that imports weights (${importers.join(', ')})`,
    importers.join() === 'game/brains.ts');
}

check(`the weights directory is exactly what brains.ts imports (${ON_DISK.length} files)`,
  ON_DISK.join() === IMPORTED.join(),
  `on disk: ${ON_DISK.join(', ')} · imported: ${IMPORTED.join(', ')}`);
check(`...and what it imports is exactly what the shipped rule flies (${FLOWN.join(', ')})`,
  IMPORTED.join() === FLOWN.join(),
  `imported: ${IMPORTED.join(', ')} · flown: ${FLOWN.join(', ')}`);

// ...and each of them is a well-formed policy. Derived from the list above, so
// this cannot go on measuring a brain the game stopped importing — which is
// exactly what it did for six of them.
for (const name of ON_DISK) {
  const f = JSON.parse(readFileSync(`${BRAINS}${name}.json`, 'utf8')) as BrainFile;
  const obs = f.meta.obsSize ?? 14;
  const hidden = f.meta.hidden ?? 32;
  const expected = obs * hidden + hidden + hidden * hidden + hidden + hidden * 11 + 11;
  check(`${name}: ${f.weights.length} weights match its declared shape`,
    f.weights.length === expected && f.weights.every((w) => Number.isFinite(w)));
}

// --- which brain flies which ship -------------------------------------------
//
// CLAUDE.md's Training section is a paragraph of prose about who flies what. It
// used to be spread over three parts of npc.ts; now it is one function, so it
// can be asserted instead of described.

// --- the pure modules stay pure ----------------------------------------------
//
// The storage mechanism used to live in commander.ts, which made a module of
// plain data browser-only by association — and it bit: freshState() called
// loadCommander() and the state factory threw under node. storage.ts is the
// only file allowed to keep a SAVE there; `engine/keymap.ts` is the one other
// file that may name localStorage at all, for the layout preference. That pair
// is checked below rather than asserted, because it was written down as
// "the ONLY file" in three places and had been untrue in all three since the
// keymap shipped.

console.log('\npurity');
{
  installPolicyKit();
  const kit = handle('__policyKit') as Record<string, unknown>;
  check('the console seam publishes the trained-policy debug handle',
    typeof kit.act === 'function' && typeof kit.observe === 'function'
    && typeof kit.observePack === 'function' && typeof kit.makeScratch === 'function');
  check('...with the live defender policy', kit.defendBrain === DEFEND_BRAIN);

  const PURE = [
    'commander.ts', 'shop.ts', 'contracts.ts', 'law.ts', 'jettison.ts',
    'systems.ts', 'trumbles.ts', 'hyperspace.ts', 'missions.ts', 'population.ts',
    'encounters.ts', 'gunnery.ts', 'docking.ts', 'state.ts', 'session.ts',
    // an NPC's energy bank and what a hit is worth against it — a rule module,
    // so it has to be steppable and testable with no browser behind it
    'npc-energy.ts',
    // placement, including the training arena — a harness that wants to build
    // a fight under node has to be able to import this
    'spawning.ts',
    // the combat trainer's rules: who it sends at you and when it stops. It
    // names brains as strings rather than loading them, which is what keeps a
    // module about opposition free of the network, the DOM and the World.
    'combat-sim-scenarios.ts',
    'combat-sim-report.ts',
    'brains.ts',
    // the whole world step, as of the extraction out of game.ts — this is the
    // line that says the simulation can advance without a browser
    'world-step.ts',
    // "a ship fired, what happens", and which of her two shields takes it. Both
    // are rule modules the TRAINER calls, so a browser reference in either would
    // put the platform inside a training episode (docs/TODO/64)
    'fire-resolution.ts', 'shield-face.ts',
    // the two computers that fly the ship for you. They reported straight to
    // the HUD and the AudioContext; they report events now, which is the only
    // reason this line can exist
    'autopilot.ts',
    // and the keyboard, which is the surprising one. controls.ts reads a
    // two-method `CommandInput`, not `engine/input.ts` and not a DOM event, so
    // a replay or an AI can ask for a command with an object literal — which
    // is exactly what the tests above do.
    'controls.ts',
  ];
  for (const f of PURE) {
    const src = readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} does not reach for the browser`,
      !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
  }
  const brainsSrc = readFileSync(new URL('../src/game/brains.ts', import.meta.url), 'utf8');
  check('brains.ts does not import the console platform seam',
    !brainsSrc.includes("from './console.ts'"));
  // ...and neither does it IMPORT something that does. The world step held
  // eleven `sfx.*` calls long after its HUD messages had become returned
  // events, and named no browser API itself — it survived under node only
  // because audio.ts swallows a failed `new AudioContext()`. The sounds are
  // SoundEvents now (game/sounds.ts) and this is what stops them coming back.
  for (const f of ['world-step.ts', 'autopilot.ts']) {
    const src = readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} does not import audio.ts — it returns SoundEvents`,
      !/audio\.ts/.test(src) && !/\bsfx\b/.test(src));
  }
  for (const f of ['combat.ts', 'ordnance.ts', 'station.ts']) {
    const src = readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} imports no audio, storage or DOM screen implementation`,
      !/(audio|storage|ui\/screens)\.ts/.test(src)
      && !/\b(sfx|renderDockedMenu|hideScreen)\b/.test(src));
  }
  // The flight seam, outside src/game/: player.ts took an `Input` until the
  // demand layer went in, which made the flight model — the thing every
  // harness wants to fly — constructible only in a browser. The producer that
  // replaced that read is node-safe by construction, and this says so.
  for (const f of ['player.ts', 'engine/flight-controls.ts']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check(`${f} does not reach for the browser`,
      !/\b(localStorage|sessionStorage|document|window)\b/.test(src));
  }
  check('...and the flight model no longer knows what an Input is',
    !/engine\/input/.test(readFileSync(new URL('../src/player.ts', import.meta.url), 'utf8')));

  const store = readFileSync(new URL('../src/game/storage.ts', import.meta.url), 'utf8');
  check('storage.ts is where localStorage lives', /localStorage/.test(store));
  // ...and the other direction, which nothing checked: WHO ELSE names it. Two
  // files may, and the second one is a carve-out invariant 3 states out loud.
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
      : /\.ts$/.test(e.name) ? [new URL(e.name, dir)] : []));
  const MAY_STORE = ['game/storage.ts', 'engine/keymap.ts'];
  const srcRoot = new URL('../src/', import.meta.url).pathname;
  const stray = walk(new URL('../src/', import.meta.url))
    .map((f) => ({ rel: f.pathname.slice(srcRoot.length), f }))
    .filter(({ rel, f }) => !MAY_STORE.includes(rel)
      && /\b(localStorage|sessionStorage)\b/.test(
        readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')))
    .map(({ rel }) => rel);
  check(`...and the only other file that may name it is keymap.ts (${stray.join(', ') || 'none stray'})`,
    stray.length === 0);
  // The namespace is the whole harness-safety argument (CLAUDE.md invariant 3):
  // every key in the program is `ns + id`, applied in this one file, and `ns`
  // moves one way. A second literal key would be a way round both.
  check('...and every key is built from the namespace',
    store.includes("'elite-web-'") && store.includes("'elite-web-harness-'"));
  // This used to assert the OPPOSITE — that the numbered-slot keys were still
  // spelled out, because migration had to read them. There is no migration
  // (docs/TODO/53), so the acceptance criterion inverted with it: no code path
  // reads an old key, and the way to keep that true is that no expression in
  // the file can build one. Comments stripped, or the prose explaining the
  // deletion would fail the check it exists to state.
  check('...and no expression builds a numbered-slot key',
    !/\$\{ns\}(commander|world|slot)/.test(store.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')));
  check('...with no way back out of the harness namespace',
    !/ns\s*=\s*PLAYER_NS/.test(store.split('let ns = PLAYER_NS;')[1] ?? ''));
}
