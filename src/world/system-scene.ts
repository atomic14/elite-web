import * as THREE from 'three';
import { slotNormal } from './slot.ts';
import type { StarSystem } from '../galaxy/galaxy.ts';
import { createSun, type Sun } from './sun.ts';
import { createPlanet, type Planet } from './planet.ts';
import { buildStation, STATION_DESIGNS } from '../ships/station-hulls.ts';

// Assembles the static in-system world deterministically from the system
// seed: sun, planet, station. Ships and rocks are NPCs, owned by the game.
// Scale: 1 unit ≈ 1 original Elite unit (station is 320 across).

export interface SystemScene {
  root: THREE.Group;
  sun: Sun;
  planet: Planet;
  planetRadius: number;
  station: THREE.Object3D;
  /** Distance from station centre to the slot face plane (local -Z). */
  stationDockZ: number;
  spawnPosition: THREE.Vector3;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function buildSystemScene(sys: StarSystem): SystemScene {
  const root = new THREE.Group();
  const [s0, s1, s2] = sys.seed;

  const lineColor = new THREE.Color().setHSL(((s2 >> 3) & 0xff) / 255, 0.75, 0.62);

  // Sun far off in a seed-determined direction.
  const azimuth = ((s1 & 0xff) / 255) * Math.PI * 2;
  const elevation = (((s0 >> 8) & 0xff) / 255 - 0.5) * 0.9;
  const sunDir = new THREE.Vector3(
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(azimuth) * Math.cos(elevation),
  );
  const sun = createSun(15000, sunDir.clone().multiplyScalar(320000));
  root.add(sun.group);

  // Planet at the origin; size varies with the system's radius stat.
  const planetRadius = 4500 + (sys.radius % 2000);
  const planet = createPlanet(planetRadius, new THREE.Vector3(0, 0, 0), lineColor, s2);
  planet.setSunDir(sunDir);
  root.add(planet.mesh);

  // Coriolis station in orbit, slot facing the planet, spinning slowly.
  const stationDir = new THREE.Vector3()
    .crossVectors(sunDir, new THREE.Vector3(0, 1, 0))
    .normalize()
    .lerp(sunDir, 0.35)
    .normalize();
  // High-tech systems get the dodecahedral "Dodo" station. Both hulls are the
  // released tables at the station scale — see ships/station-hulls.ts.
  const built = buildStation(
    sys.techLevel + 1 >= 10 ? STATION_DESIGNS.dodo : STATION_DESIGNS.coriolis, 0xd8ffe0);
  const station: THREE.Object3D = built.object;
  const stationDockZ = built.dockZ;
  station.position.copy(stationDir).multiplyScalar(planetRadius * 2.4);
  // The builder turns the def half a turn (slot on local -Z); lookAt leaves that
  // pointing away from the planet, so flip: the slot must face the planet.
  station.lookAt(0, 0, 0);
  station.rotateY(Math.PI);
  root.add(station);

  // Launch/respawn point: just outside the slot face (planet side).
  const slot = slotNormal(station);
  const spawnPosition = station.position
    .clone()
    .add(slot.multiplyScalar(900));

  return {
    root,
    sun,
    planet,
    planetRadius,
    station,
    stationDockZ,
    spawnPosition,
    update(dt, elapsed) {
      sun.update(elapsed);
      station.rotateZ(dt * 0.26);
    },
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}
