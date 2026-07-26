import * as THREE from 'three';

// A proper star, not a circle: animated fbm surface, limb darkening, and an
// additive corona sprite.

const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }
`;

const SUN_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHot;
  uniform vec3 uCool;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 view = normalize(cameraPosition - vWorldPos);
    float t = uTime * 0.05;
    float granules = fbm(n * 4.0 + vec3(t, -t * 0.7, t * 0.4));
    float detail = fbm(n * 11.0 - vec3(t * 1.6, t, -t * 0.5));
    float facing = max(dot(n, view), 0.0);
    float limb = 0.45 + 0.55 * pow(facing, 0.55); // limb darkening
    vec3 col = mix(uCool, uHot, granules * 0.9 + detail * 0.35);
    col += uHot * pow(detail, 3.0) * 0.8; // bright flecks
    col *= limb;
    float rim = pow(1.0 - facing, 3.0);
    col += uCool * rim * 1.2; // glowing limb
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface Sun {
  group: THREE.Group;
  update(time: number): void;
}

function coronaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255, 240, 210, 0.9)');
  g.addColorStop(0.25, 'rgba(255, 170, 80, 0.45)');
  g.addColorStop(0.55, 'rgba(255, 110, 40, 0.14)');
  g.addColorStop(1.0, 'rgba(255, 80, 20, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSun(radius: number, position: THREE.Vector3): Sun {
  const group = new THREE.Group();
  group.position.copy(position);

  const uniforms = {
    uTime: { value: 0 },
    uHot: { value: new THREE.Color(1.0, 0.93, 0.6) },
    uCool: { value: new THREE.Color(1.0, 0.38, 0.06) },
  };
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader: SUN_VERT, fragmentShader: SUN_FRAG }),
  );
  group.add(surface);

  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coronaTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  corona.scale.setScalar(radius * 5.5);
  group.add(corona);

  return {
    group,
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
}

export { NOISE_GLSL };
