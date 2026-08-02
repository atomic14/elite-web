// The trained brains: that they load, that they still win, and who flies which.
//
// The regression gate on neuroevolution. It reads the shipped brain names out of
// brains.ts rather than hardcoding them, because a retrain under a new name would
// otherwise silently orphan the check — which is exactly what happened once, and
// the suite went on measuring two brains the game did not fly.

import { readFileSync } from 'node:fs';
import { pirateBrainFor, defenceBrain, DEFEND_BRAIN, SHIPPED_BRAINS } from '../src/game/brains.ts';
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

// --- brain files are well-formed --------------------------------------------

console.log('\nbrain files');
for (const name of ['pirate-attack', 'pirate-attack-r2', 'trader-evade',
  'trader-evade-r2', 'pirate-pack', 'jameson-defend']) {
  const f = JSON.parse(readFileSync(`${BRAINS}${name}.json`, 'utf8')) as BrainFile;
  const obs = f.meta.obsSize ?? 14;
  const hidden = f.meta.hidden ?? 32;
  const expected = obs * hidden + hidden + hidden * hidden + hidden + hidden * 11 + 11;
  check(`${name}: ${f.weights.length} weights match its declared shape`,
    f.weights.length === expected && f.weights.every((w) => Number.isFinite(w)));
}

// --- which brain flies which ship -------------------------------------------
//
// Invariant 8 in CLAUDE.md is a paragraph of prose about who flies what. It
// used to be spread over three parts of npc.ts; now it is one function, so it
// can be asserted instead of described.

console.log('\nbrain selection');
{
  // No setup and no teardown: the selection is an ARGUMENT now, so a case
  // cannot leak into the next one. It used to be four `window.__` globals with
  // a clear() after every block — which worked, and only by hand.
  {
    const solo = pirateBrainFor(0, false);
    check('an opportunist flies the solo brain', !!solo && !solo.pack);
    const gang = pirateBrainFor(2, true);
    check('an organised gang flies the pack policy', !!gang && gang.pack);
    check('...and they are different brains', solo!.brain !== gang!.brain);
    check('a tier-2 pirate flying ALONE still flies solo',
      pirateBrainFor(2, false)?.pack === false);
  }
  {
    // the guard is the range at which the brain hands back to the scripted
    // break-off; the generation brains do not ram, so theirs is tighter
    const now = pirateBrainFor(1, false)!;
    check('the current brain gets the tight guard', now.guard === 150);
    check('...and is told a floored target speed, not a fake 300',
      now.targetSpeed(0) === 150 && now.targetSpeed(400) === 400);
  }
  {
    check('brains.scripted turns every brain off',
      pirateBrainFor(0, false, { scripted: true }) === null
      && pirateBrainFor(2, true, { scripted: true }) === null
      && defenceBrain({ scripted: true }) === null);
  }
  {
    check('brains.pack forces the pack policy onto everyone',
      pirateBrainFor(0, false, { pack: true })?.pack === true);
  }
  {
    const base = pirateBrainFor(0, false)!.brain;
    check("brains.sharp='pro' leaves opportunists alone",
      pirateBrainFor(0, false, { sharp: 'pro' })!.brain === base);
    check('...and re-arms professionals',
      pirateBrainFor(1, false, { sharp: 'pro' })!.brain !== base);
    check('brains.sharp=true re-arms everyone',
      pirateBrainFor(0, false, { sharp: true })!.brain !== base);
    check("brains.legacy='pro' likewise splits by tier",
      pirateBrainFor(0, false, { legacy: 'pro' })!.brain === base
      && pirateBrainFor(1, false, { legacy: 'pro' })!.brain !== base);
  }
  {
    // The default is the shipped game, and it is frozen — a caller that
    // mutated it would move every other caller's brains.
    check('the shipped default carries no overrides',
      Object.keys(SHIPPED_BRAINS).length === 0 && Object.isFrozen(SHIPPED_BRAINS));
    check('an unspecified selection flies what the live game flies',
      pirateBrainFor(1, false)!.brain === pirateBrainFor(1, false, {})!.brain);
  }
  check('the defence brain is fitted', defenceBrain() !== null);
}

// --- the pure modules stay pure ----------------------------------------------
//
// The storage mechanism used to live in commander.ts, which made a module of
// plain data browser-only by association — and it bit: freshState() called
// loadCommander() and the state factory threw under node. storage.ts is the
// only file allowed to know localStorage exists.

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
  // the keys are load-bearing: renaming one orphans every existing save
  check('...and the save keys are unchanged',
    store.includes("'elite-web-commander'") && store.includes("'elite-web-world'")
    && store.includes("'elite-web-slot'"));
}
