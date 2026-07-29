import * as THREE from 'three';
import { NOISE_GLSL } from './sun.ts';

// Wireframe-styled planet, but procedural: glowing lat/long graticule plus
// noise-contour coastlines, day/night terminator, and a fresnel atmosphere
// rim. Reads as "vector graphics" while being far richer than a ball of
// triangles. Line colour is derived from the system seed.

const PLANET_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjNormal;
  void main() {
    vObjNormal = normalize(normal);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLANET_FRAG = /* glsl */ `
  uniform vec3 uLineColor;
  uniform vec3 uSunDir;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjNormal;
  ${NOISE_GLSL}

  float gridLine(float v, float divisions) {
    float x = fract(v * divisions);
    float d = min(x, 1.0 - x);
    float w = fwidth(v * divisions);
    return smoothstep(w * 1.6, 0.0, d);
  }

  void main() {
    vec3 n = normalize(vObjNormal);
    vec3 wn = normalize(vNormal);

    // graticule
    float lon = atan(n.z, n.x) / 6.2831853 + 0.5;
    float lat = asin(clamp(n.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    float grid = max(gridLine(lon, 12.0), gridLine(lat, 8.0)) * 0.35;

    // coastlines: contours of fbm terrain
    vec3 p = n * 3.0 + vec3(uSeed * 17.31, uSeed * 5.7, uSeed * 9.13);
    float h = fbm(p);
    float w = fwidth(h) * 1.8;
    float coast = smoothstep(w, 0.0, abs(h - 0.5));
    float ridge = smoothstep(w, 0.0, abs(h - 0.62)) * 0.5;

    // day/night terminator
    float day = clamp(dot(wn, uSunDir) * 2.0 + 0.35, 0.06, 1.0);

    // landmass fill so continents read at distance
    float land = smoothstep(0.48, 0.54, h) * 0.12;

    vec3 view = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(wn, view), 0.0), 3.0);

    // solid body fill: visibly a sphere even on the night side
    vec3 col = uLineColor * (0.06 + h * 0.03) * (0.3 + 0.7 * day) + vec3(0.006);
    col += uLineColor * land * day;
    col += uLineColor * (grid + coast + ridge) * day;
    col += uLineColor * fresnel * 0.8;             // atmosphere rim
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface Planet {
  mesh: THREE.Mesh;
  setSunDir(dir: THREE.Vector3): void;
}

export function createPlanet(
  radius: number,
  position: THREE.Vector3,
  lineColor: THREE.Color,
  seed: number,
): Planet {
  const uniforms = {
    uLineColor: { value: lineColor },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSeed: { value: (seed % 1024) / 1024 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }),
  );
  mesh.position.copy(position);
  return {
    mesh,
    setSunDir(dir: THREE.Vector3) {
      uniforms.uSunDir.value.copy(dir).normalize();
    },
  };
}
