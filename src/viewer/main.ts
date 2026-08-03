import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { buildShip } from '../ships/geometry.ts';
import { requireShipDef } from '../ships/registry.ts';
import { shipDesignIdOf } from '../game/ship-identity.ts';
import { createGallery, type GalleryScale, type GalleryView } from './gallery.ts';
import { createStarfield } from '../world/starfield.ts';
import { Episode, type ShotEvent, type EpisodeShip } from '../ai-training/scenario.ts';
import { brainFromFile, randomBrain, type BrainFile } from '../ai-training/policy.ts';
import { makeRng } from '../game/rng.ts';
import { FIXED_DT } from '../game/world-step.ts';
import { pirateBrainFor } from '../game/brains.ts';
import { pirateBrainNameFor } from '../game/brain-names.ts';
import pirateR1BrainFile from '../ai-training/brains/pirate-attack.json' with { type: 'json' };
import traderBrainFile from '../ai-training/brains/trader-evade.json' with { type: 'json' };
import packBrainFile from '../ai-training/brains/pirate-pack.json' with { type: 'json' };
import defendBrainFile from '../ai-training/brains/jameson-defend-g1.json' with { type: 'json' };

// Combat viewer: replays the training environment with the real wireframe
// ships, so trained behaviour can be watched (and compared to baselines) —
// and, on `G`, a gallery of all 38 released designs (viewer/gallery.ts).

/** The two hulls the combat scenarios fly, resolved through the registry. */
const COBRA_MK3 = requireShipDef(shipDesignIdOf(10));
const SIDEWINDER = requireShipDef(shipDesignIdOf(17));

// The 'shipped pirate' scenarios ASK the game which brain that is, rather than
// importing a file and saying so on a label. They did the latter, and it went
// wrong the only way it could: the file was `pirate-attack-g1` — a name
// brain-names.ts calls CANNOT BE FLOWN — under two `<option>`s reading
// "Shipped pirate (league r2)", so the one page whose whole job is showing what
// the game flies was showing a brain the game refuses. Both the weights and the
// label come off `brain-names.ts` + `brains.ts` now, so a change to
// SHIPPED_BRAINS moves this page with it.
const shippedPirate = pirateBrainFor(0, false);
// brains.ts loads defensively and hands back null if the weights did not parse.
// In the game that is a fall back to the scripted AI; on a page whose only job
// is showing the shipped brain fly, it is the whole point failing, and saying so
// beats drawing a fight nobody can interpret.
if (!shippedPirate) throw new Error('viewer: the shipped pirate brain did not load');
const pirateBrain = shippedPirate.brain;
const SHIPPED_PIRATE_NAME = pirateBrainNameFor(0, false);
const pirateR1Brain = brainFromFile(pirateR1BrainFile as BrainFile);
const traderBrain = brainFromFile(traderBrainFile as BrainFile);
const packBrain = brainFromFile(packBrainFile as BrainFile);
const defendBrain = brainFromFile(defendBrainFile as BrainFile);

type ScenarioId =
  'trained-vs-trader' | 'scripted-vs-trader' | 'random-vs-trader' |
  'trained-vs-evader' | 'pack-vs-armed' | 'pack-trained-vs-armed' | 'jameson-vs-pirates';

function makeEpisode(id: ScenarioId, seed: number): Episode {
  const rng = makeRng(seed ^ 0xbeef);
  switch (id) {
    case 'trained-vs-trader':
      return new Episode({ seed, pirates: [{ kind: 'policy', brain: pirateBrain }], trader: { kind: 'scripted' } });
    case 'scripted-vs-trader':
      return new Episode({ seed, pirates: [{ kind: 'scripted' }], trader: { kind: 'scripted' } });
    case 'random-vs-trader':
      return new Episode({ seed, pirates: [{ kind: 'policy', brain: randomBrain(rng) }], trader: { kind: 'scripted' } });
    case 'trained-vs-evader':
      return new Episode({ seed, pirates: [{ kind: 'policy', brain: pirateBrain }], trader: { kind: 'policy', brain: traderBrain } });
    case 'pack-vs-armed':
      return new Episode({
        seed,
        pirates: [
          { kind: 'policy', brain: pirateR1Brain },
          { kind: 'policy', brain: pirateR1Brain },
          { kind: 'policy', brain: pirateR1Brain },
        ],
        trader: { kind: 'scripted' },
        traderArmed: true,
        maxTime: 60,
      });
    case 'jameson-vs-pirates':
      return new Episode({
        seed,
        pirates: [
          { kind: 'policy', brain: pirateBrain },
          { kind: 'policy', brain: pirateBrain },
        ],
        trader: { kind: 'policy', brain: defendBrain },
        traderArmed: true,
      });
    case 'pack-trained-vs-armed':
      return new Episode({
        seed,
        pirates: [
          { kind: 'policy', brain: packBrain },
          { kind: 'policy', brain: packBrain },
          { kind: 'policy', brain: packBrain },
        ],
        trader: { kind: 'scripted' },
        traderArmed: true,
        maxTime: 60,
      });
  }
}

// --- three.js scaffolding ---------------------------------------------------

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 1, 200000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.15));

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
scene.add(createStarfield(2200, 90000));

// --- the design gallery ------------------------------------------------------

const gallery = createGallery();
scene.add(gallery.root);
let mode: 'combat' | 'gallery' = 'gallery';

const SCALES: GalleryScale[] = ['common', 'relative'];
const VIEWS: GalleryView[] = ['spin', 'front', 'rear', 'top', 'side'];
const cycle = <T,>(list: T[], current: T): T =>
  list[(list.indexOf(current) + 1) % list.length];

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'g') mode = mode === 'gallery' ? 'combat' : 'gallery';
  if (mode !== 'gallery') return;
  if (key === 's') gallery.scale = cycle(SCALES, gallery.scale);
  if (key === 'v') gallery.view = cycle(VIEWS, gallery.view);
  if (key === '0' || key === 'escape') gallery.focus = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const step = e.key === 'ArrowRight' ? 1 : -1;
    gallery.focus = gallery.focus === null
      ? (step > 0 ? 0 : gallery.count - 1)
      : (gallery.focus + step + gallery.count) % gallery.count;
  }
});

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
let scenario: ScenarioId = 'trained-vs-trader';
let paused = false;
let speed = 1;
let camMode: 'orbit' | 'chase' = 'orbit';
let elapsed = 0;

function resetEpisode(newSeed?: number): void {
  for (const v of views) scene.remove(v.object);
  for (const t of tracers) scene.remove(t.line);
  views = [];
  tracers = [];
  if (newSeed !== undefined) seed = newSeed;
  episode = makeEpisode(scenario, seed);
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

function syncViews(events: ShotEvent[]): void {
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

const title = document.getElementById('viewer-title')!;

function renderHud(): void {
  title.textContent = mode === 'gallery' ? 'DESIGN GALLERY' : 'COMBAT VIEWER';
  if (mode === 'gallery') {
    hud.textContent = gallery.hudLines().join('\n');
    return;
  }
  const p = episode.pirates[0];
  const lines = [
    `SCENARIO   ${scenario}`,
    `SEED       ${seed}`,
    `TIME       ${episode.t.toFixed(1)}s / ${episode.maxTime}s${episode.done ? '  — DONE (auto-restart)' : ''}`,
    `TRADER     hp ${Math.max(0, episode.trader.hp).toFixed(2)}  speed ${episode.trader.speed.toFixed(0)}${episode.trader.alive ? '' : '  ✝ DESTROYED'}`,
  ];
  episode.pirates.forEach((pi, i) => {
    lines.push(
      `PIRATE ${i + 1}   hp ${Math.max(0, pi.hp).toFixed(2)}  shots ${pi.shotsFired}  hits ${pi.shotsHit}` +
      `  acc ${(pi.shotsFired ? (100 * pi.shotsHit) / pi.shotsFired : 0).toFixed(0)}%${pi.alive ? '' : '  ✝'}`);
  });
  // NOT "the brain flying right now" — the scripted and random rows have none.
  // It was a fitness figure off a JSON file, which said nothing about the
  // scenario on screen and everything about a run nobody can reproduce.
  lines.push('', `SHIPPED    ${SHIPPED_PIRATE_NAME}  (what the "shipped pirate" rows fly)`);
  if (p) lines.push(`FITNESS    ${episode.fitnessAttack(0).toFixed(2)} (attack metric, pirate 1)`);
  hud.textContent = lines.join('\n');
}

const scenarioSelect = document.getElementById('scenario') as HTMLSelectElement;
// Name the brain on the rows that claim to fly the shipped one, so the label
// cannot outlive the choice it describes.
for (const id of ['trained-vs-trader', 'trained-vs-evader']) {
  const option = scenarioSelect.querySelector<HTMLOptionElement>(`option[value="${id}"]`);
  if (option) option.textContent = option.textContent!.replace(
    'Shipped pirate', `Shipped pirate (${SHIPPED_PIRATE_NAME})`);
}
scenarioSelect.addEventListener('change', (e) => {
  scenario = (e.target as HTMLSelectElement).value as ScenarioId;
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

  gallery.root.visible = mode === 'gallery';
  for (const v of views) v.object.visible = mode === 'combat' && v.sim.alive;
  if (mode === 'gallery') {
    gallery.update(dt, camera);
    composer.render();
    renderHud();
    requestAnimationFrame(frame);
    return;
  }

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
  composer.render();
  renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
