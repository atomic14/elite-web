// Combat viewer: watch the brains the game ships actually fly.
//
// It replays `ai-training/scenario.ts` — the same episodes the trainer scores —
// with the real wireframe hulls, so a policy can be WATCHED rather than read off
// a table. The design gallery used to be on the same page behind a `G` key,
// which meant this page opened on the gallery and the combat viewer read as
// deleted; it is `/gallery` now (viewer/gallery-main.ts) and neither page has a
// mode key.
//
// **Every row in the picker flies a brain the game ships, or a stated control.**
// That is the rule this page exists to keep, and it has been broken twice: once
// by an `<option>` reading "Shipped pirate (league r2)" over a `pirate-attack-g1`
// import — a name brain-names.ts calls CANNOT BE FLOWN — and once by a row
// labelled "Pack of 3 vs armed trader" flying `pirate-pack.json`, a round-one
// policy, while the shipped gang is `pirate-pack-r4-selectonly`. Both went wrong
// the same way: the weights came from an import and the label came from the
// HTML, so nothing tied them together. So SCENARIOS below is the only place a
// row exists — its weights come from `game/brains.ts`, its name from
// `game/brain-names.ts`, and its `<option>` is built from both at runtime. A
// change to SHIPPED_BRAINS moves this page with it, and viewer.html holds an
// empty `<select>`.

import * as THREE from 'three';

import { buildShip } from '../ships/geometry.ts';
import { requireShipDef } from '../ships/registry.ts';
import { shipDesignIdOf } from '../game/ship-identity.ts';
import { createStage } from './stage.ts';
import { Episode, type ShotEvent, type EpisodeShip } from '../ai-training/scenario.ts';
import { randomBrain, type Brain } from '../ai-training/policy.ts';
import { makeRng } from '../game/rng.ts';
import { FIXED_DT } from '../game/world-step.ts';
import { defenceBrain, pirateBrainFor } from '../game/brains.ts';
import { defenceBrainNameFor, pirateBrainNameFor } from '../game/brain-names.ts';

/** The two hulls the combat scenarios fly, resolved through the registry. */
const COBRA_MK3 = requireShipDef(shipDesignIdOf(10));
const SIDEWINDER = requireShipDef(shipDesignIdOf(17));

/**
 * The shipped policies, ASKED FOR rather than imported.
 *
 * brains.ts loads defensively and hands back null if the weights did not parse.
 * In the game that is a fall back to the scripted AI; on a page whose only job
 * is showing the shipped brains fly, it is the whole point failing, and saying
 * so beats drawing a fight nobody can interpret.
 */
function shipped(what: 'solo' | 'gang' | 'defence'): { brain: Brain; name: string } {
  const brain = what === 'defence'
    ? defenceBrain()
    : pirateBrainFor(0, what === 'gang')?.brain ?? null;
  const name = what === 'defence' ? defenceBrainNameFor() : pirateBrainNameFor(0, what === 'gang');
  if (!brain) throw new Error(`viewer: the shipped ${what} brain (${name}) did not load`);
  return { brain, name };
}

const SOLO = shipped('solo');
const GANG = shipped('gang');
const DEFENCE = shipped('defence');

interface ViewerScenario {
  id: string;
  /** the picker row — the brain's file stem is appended, so it cannot go stale */
  label: string;
  /** what is flying, for the label and the HUD: a stem, or a stated control */
  flying: string;
  build(seed: number): Episode;
}

/** Three of the same policy, which is how a pack scenario is built. */
const three = (brain: Brain): { kind: 'policy'; brain: Brain }[] =>
  [0, 1, 2].map(() => ({ kind: 'policy' as const, brain }));

/**
 * Every fight the page offers. Four fly a shipped policy and two are controls
 * that say so — the pre-neuroevolution AI, and an untrained random policy, which
 * are the two baselines every figure in docs/TRAINING-LOG.md is measured against.
 */
const SCENARIOS: readonly ViewerScenario[] = [
  {
    id: 'shipped-vs-trader',
    label: 'Shipped pirate vs trader',
    flying: SOLO.name,
    build: (seed) => new Episode({
      seed, pirates: [{ kind: 'policy', brain: SOLO.brain }], trader: { kind: 'scripted' },
    }),
  },
  {
    id: 'scripted-vs-trader',
    label: 'Scripted pirate vs trader',
    flying: 'the pre-neuroevolution AI — a control',
    build: (seed) => new Episode({
      seed, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' },
    }),
  },
  {
    id: 'random-vs-trader',
    label: 'Random policy vs trader',
    flying: 'an untrained network — a control',
    build: (seed) => new Episode({
      seed,
      pirates: [{ kind: 'policy', brain: randomBrain(makeRng(seed ^ 0xbeef)) }],
      trader: { kind: 'scripted' },
    }),
  },
  {
    id: 'gang-vs-armed',
    label: 'Shipped gang of 3 vs armed trader',
    flying: GANG.name,
    build: (seed) => new Episode({
      seed, pirates: three(GANG.brain), trader: { kind: 'scripted' },
      traderArmed: true, maxTime: 60,
    }),
  },
  {
    id: 'solo-trio-vs-armed',
    label: 'Three shipped SOLO pirates vs armed trader',
    flying: SOLO.name,
    build: (seed) => new Episode({
      seed, pirates: three(SOLO.brain), trader: { kind: 'scripted' },
      traderArmed: true, maxTime: 60,
    }),
  },
  {
    id: 'jameson-vs-pirates',
    label: 'Armed trader vs 2 shipped pirates',
    flying: DEFENCE.name,
    build: (seed) => new Episode({
      seed,
      pirates: [
        { kind: 'policy', brain: SOLO.brain },
        { kind: 'policy', brain: SOLO.brain },
      ],
      trader: { kind: 'policy', brain: DEFENCE.brain },
      traderArmed: true,
    }),
  },
];

const scenarioById = (id: string): ViewerScenario =>
  SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

// --- the scene ---------------------------------------------------------------

const { scene, camera, render } = createStage();

// --- episode visualisation ---------------------------------------------------

interface ShipView {
  sim: EpisodeShip;
  object: THREE.Group;
  isPirate: boolean;
}

let episode: Episode;
let views: ShipView[] = [];
let tracers: { line: THREE.Line; life: number }[] = [];
let seed = 1;
let scenario: ViewerScenario = SCENARIOS[0];
let paused = false;
let speed = 1;
let camMode: 'orbit' | 'chase' = 'orbit';
let elapsed = 0;

function resetEpisode(newSeed?: number): void {
  for (const v of views) scene.remove(v.object);
  for (const t of tracers) scene.remove(t.line);
  for (const m of drawnMissiles) scene.remove(m);
  views = [];
  tracers = [];
  drawnMissiles.clear();
  if (newSeed !== undefined) seed = newSeed;
  episode = scenario.build(seed);
  elapsed = 0;

  for (const p of episode.pirates) {
    const object = buildShip(p.name === 'Sidewinder' ? SIDEWINDER : COBRA_MK3, 0xff9a5c);
    scene.add(object);
    views.push({ sim: p, object, isPirate: true });
  }
  const traderObj = buildShip(COBRA_MK3, 0xffffff);
  scene.add(traderObj);
  views.push({ sim: episode.trader, object: traderObj, isPirate: false });
}

/** scratch for the tracer geometry below */
const tracerDir = new THREE.Vector3();

/**
 * The warheads currently on screen.
 *
 * A missile is not an `EpisodeShip` and does not want to be: `ordnance.ts`
 * already flies a real `Object3D` for it, so this page adds that object rather
 * than building a second one to copy a position into. Kept as a set because the
 * episode's list is the truth and this is only what has been shown of it.
 *
 * It exists because pirates in an episode LAUNCH now (docs/TODO/62), and a
 * warhead is 250 of the commander's 765 pool points: without this the page would
 * show a target losing a third of herself to nothing at all, which is exactly
 * the kind of lie the viewer is here to stop telling.
 */
const drawnMissiles = new Set<THREE.Object3D>();

/** Add what has been launched, drop what has gone off. */
function syncMissiles(): void {
  const live = new Set<THREE.Object3D>();
  for (const m of episode.missiles) {
    live.add(m.object);
    if (!drawnMissiles.has(m.object)) {
      scene.add(m.object);
      drawnMissiles.add(m.object);
    }
  }
  for (const object of drawnMissiles) {
    if (live.has(object)) continue;
    scene.remove(object);
    drawnMissiles.delete(object);
  }
}

function syncViews(events: ShotEvent[]): void {
  syncMissiles();
  for (const v of views) {
    v.object.position.set(v.sim.pos.x, v.sim.pos.y, v.sim.pos.z);
    v.object.quaternion.set(v.sim.quat.x, v.sim.quat.y, v.sim.quat.z, v.sim.quat.w);
    v.object.visible = v.sim.alive;
  }
  for (const e of events) {
    // From the NOSE, along the nose. This used to draw hull-centre to
    // target-centre, which made every shot look like it left the side of the
    // ship and curved onto the target: at any bank angle the line visibly
    // disagreed with where the ship was pointing. The sim never fired that way
    // (measured: hits average 0.5 degrees off the nose, worst 1.9), so this was
    // purely a drawing bug, and a misleading one.
    //
    // A miss now flies PAST the target instead of into it. Drawing a miss to
    // the target's centre made it look like a hit that failed to register.
    const f = e.from.forward(tracerDir);
    const r = e.from.radius;
    const ox = e.from.pos.x + f.x * r;
    const oy = e.from.pos.y + f.y * r;
    const oz = e.from.pos.z + f.z * r;
    const reach = Math.hypot(e.to.pos.x - ox, e.to.pos.y - oy, e.to.pos.z - oz);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      e.hit
        ? [ox, oy, oz, e.to.pos.x, e.to.pos.y, e.to.pos.z]
        : [ox, oy, oz, ox + f.x * reach, oy + f.y * reach, oz + f.z * reach],
      3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: e.hit ? 0xffe9a8 : 0xff5c40,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0.2 });
  }
}

function updateCamera(dt: number): void {
  // frame the action: midpoint of living ships, distance from their spread
  const alive = views.filter((v) => v.sim.alive);
  if (!alive.length) return;
  const mid = new THREE.Vector3();
  for (const v of alive) mid.add(v.object.position);
  mid.divideScalar(alive.length);
  let spread = 400;
  for (const v of alive) spread = Math.max(spread, v.object.position.distanceTo(mid) * 2.4);

  if (camMode === 'orbit') {
    const a = elapsed * 0.12;
    const offset = new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)).multiplyScalar(spread * 1.4);
    camera.position.lerp(mid.clone().add(offset), Math.min(1, dt * 2));
  } else {
    // chase the first pirate
    const p = views[0];
    const back = new THREE.Vector3(0, 40, 160).applyQuaternion(p.object.quaternion);
    camera.position.lerp(p.object.position.clone().add(back), Math.min(1, dt * 4));
  }
  camera.lookAt(mid);
}

// --- HUD & controls ----------------------------------------------------------

const hud = document.getElementById('viewer-hud')!;

function renderHud(): void {
  const p = episode.pirates[0];
  const lines = [
    `SCENARIO   ${scenario.label}`,
    `FLYING     ${scenario.flying}`,
    `SEED       ${seed}`,
    `TIME       ${episode.t.toFixed(1)}s / ${episode.maxTime}s${episode.done ? '  — DONE (auto-restart)' : ''}`,
    `TRADER     hp ${Math.max(0, episode.trader.hp).toFixed(2)}  speed ${episode.trader.speed.toFixed(0)}${episode.trader.alive ? '' : '  ✝ DESTROYED'}`,
  ];
  episode.pirates.forEach((pi, i) => {
    lines.push(
      `PIRATE ${i + 1}   hp ${Math.max(0, pi.hp).toFixed(2)}  shots ${pi.shotsFired}  hits ${pi.shotsHit}` +
      `  acc ${(pi.shotsFired ? (100 * pi.shotsHit) / pi.shotsFired : 0).toFixed(0)}%` +
      // The rack, because a fight can now turn on it: 250 pool points a round.
      `  msl ${pi.missilesFired}/${pi.missilesCarried}${pi.alive ? '' : '  ✝'}`);
  });
  // The three the game ships, asked for rather than typed out — the same rule
  // the rows above fly under.
  lines.push('', `SHIPPED    solo ${SOLO.name} · gang ${GANG.name} · defence ${DEFENCE.name}`);
  if (p) lines.push(`FITNESS    ${episode.fitnessAttack(0).toFixed(2)} (attack metric, pirate 1)`);
  hud.textContent = lines.join('\n');
}

// The rows are built here, from the table, so a label and the weights under it
// cannot come apart — which is how this page came to show a pack it does not
// ship under a label implying it does.
const scenarioSelect = document.getElementById('scenario') as HTMLSelectElement;
for (const s of SCENARIOS) {
  const option = document.createElement('option');
  option.value = s.id;
  option.textContent = `${s.label} — ${s.flying}`;
  scenarioSelect.append(option);
}
scenarioSelect.addEventListener('change', (e) => {
  scenario = scenarioById((e.target as HTMLSelectElement).value);
  resetEpisode(1);
});
document.getElementById('btn-restart')!.addEventListener('click', () => resetEpisode(seed + 1));
const pauseBtn = document.getElementById('btn-pause')!;
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'RESUME' : 'PAUSE';
});
const speedBtn = document.getElementById('btn-speed')!;
speedBtn.addEventListener('click', () => {
  speed = speed === 1 ? 4 : speed === 4 ? 0.25 : 1;
  speedBtn.textContent = `SPEED ${speed}x`;
});
const camBtn = document.getElementById('btn-cam')!;
camBtn.addEventListener('click', () => {
  camMode = camMode === 'orbit' ? 'chase' : 'orbit';
  camBtn.textContent = `CAM: ${camMode.toUpperCase()}`;
});

// --- main loop ---------------------------------------------------------------

const SIM_DT = FIXED_DT;
let simAccumulator = 0;
let doneTimer = 0;
let last = performance.now();

resetEpisode(1);

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  if (!paused) {
    if (!episode.done) {
      simAccumulator += dt * speed;
      const events: ShotEvent[] = [];
      while (simAccumulator >= SIM_DT) {
        simAccumulator -= SIM_DT;
        events.push(...episode.step(SIM_DT));
      }
      syncViews(events);
    } else {
      doneTimer += dt;
      if (doneTimer > 2.5) {
        doneTimer = 0;
        resetEpisode(seed + 1);
      }
    }
  }

  tracers = tracers.filter((t) => {
    t.life -= dt;
    (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.2);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      return false;
    }
    return true;
  });

  updateCamera(dt);
  render();
  renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
