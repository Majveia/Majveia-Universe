/**
 * Moons.
 *
 * They were flat discs of constant colour until now, which is a shame, because
 * a moon is where two pieces of geometry you can otherwise only assert become
 * visible at once. It has a terminator, so it shows a phase - and the phase is
 * always the one implied by where it sits relative to the star, not one chosen
 * for the composition. And it can pass into the planet's shadow, which is a
 * lunar eclipse: the same disc-overlap arithmetic that puts a moon's shadow on
 * the planet, run with the roles swapped.
 *
 * The surface is regolith: an old, airless, unweathered crust, so its relief is
 * craters all the way down, with the darker smooth patches that flood basins
 * leave behind.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';
import { ECLIPSE_GLSL } from './shaders/eclipse';

const MOON_VERT = /* glsl */ `
out vec3 vObj;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vObj = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const MOON_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
${ECLIPSE_GLSL}

in vec3 vObj;
in vec3 vNormal;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uColor;
uniform float uSeed;
uniform float uIcy;

void main() {
  vec3 n = normalize(vNormal);
  vec3 p = normalize(vObj);
  vec3 q = p * 2.4 + vec3(uSeed);

  // Craters: a Worley field thresholded into rims, layered at two scales so
  // the big basins carry small ones inside them.
  vec2 c1 = worley(q * 3.1);
  vec2 c2 = worley(q * 8.7 + vec3(11.0));
  float rim1 = smoothstep(0.30, 0.33, c1.x) * smoothstep(0.40, 0.34, c1.x);
  float rim2 = smoothstep(0.26, 0.29, c2.x) * smoothstep(0.36, 0.30, c2.x);
  float floors = smoothstep(0.24, 0.02, c1.x);

  // Maria: basalt that welled up into the largest basins and froze dark.
  float mare = smoothstep(0.52, 0.78, fbm(q * 1.1, 5, 2.1, 0.55) * 0.5 + 0.5);

  vec3 albedo = uColor * (0.86 + 0.30 * fbm(q * 6.0, 4, 2.2, 0.5));
  albedo *= 1.0 - 0.34 * mare * (1.0 - uIcy);
  albedo += vec3(0.06) * (rim1 + rim2 * 0.6);
  albedo *= 1.0 - 0.22 * floors;

  // Crater relief from the gradient of the same field, so the rims catch the
  // light on the sunward flank instead of being painted rings.
  vec3 tang = normalize(cross(p, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 bitan = cross(p, tang);
  const float e = 0.01;
  float h0 = worley(q * 3.1).x + worley(q * 8.7 + vec3(11.0)).x * 0.45;
  float ha = worley((p + tang * e) * 2.4 * 3.1 + vec3(uSeed) * 3.1).x
    + worley((p + tang * e) * 2.4 * 8.7 + vec3(uSeed) * 8.7 + vec3(11.0)).x * 0.45;
  float hb = worley((p + bitan * e) * 2.4 * 3.1 + vec3(uSeed) * 3.1).x
    + worley((p + bitan * e) * 2.4 * 8.7 + vec3(uSeed) * 8.7 + vec3(11.0)).x * 0.45;
  n = normalize(n - (tang * (ha - h0) + bitan * (hb - h0)) * 0.55 / e * 0.02);

  vec3 sun = normalize(uSunDir);
  float ndl = dot(n, sun);
  // No atmosphere: the terminator is as sharp as the star's own disc makes it.
  float diffuse = smoothstep(-uSunAngRad - 0.006, uSunAngRad + 0.006, ndl);
  float lit = eclipseLight(vWorld, sun);

  // Regolith backscatters: a full moon is far brighter than twice a half moon,
  // because the shadows between grains vanish at opposition.
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float opp = pow(max(dot(viewDir, sun), 0.0), 6.0);

  vec3 col = albedo * uSunColor * diffuse * lit * (0.86 + 0.55 * opp);
  col += albedo * 0.004;
  fragColor = vec4(col, 1.0);
}
`;

export interface MoonVisual {
  color: [number, number, number];
  seed: number;
  /** 1 for an ice-covered moon, 0 for bare rock. */
  icy?: number;
}

/** A lit, cratered moon whose phase and eclipses follow the geometry. */
export class MoonView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(radius: number, v: MoonVisual, segments = 32) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uColor: { value: new THREE.Vector3(...v.color) },
        uSeed: { value: (v.seed % 10000) / 131 },
        uIcy: { value: v.icy ?? 0 },
        uOccluder: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
        uOccluderCount: { value: 0 },
        uSunAngRad: { value: 0.00465 },
      },
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, segments, Math.max(8, segments >> 1)), this.mat);
  }

  update(sunDir: THREE.Vector3, sunColor: THREE.Color): void {
    this.mat.uniforms.uSunDir.value.copy(sunDir);
    this.mat.uniforms.uSunColor.value.copy(sunColor);
  }

  setSunAngularRadius(a: number): void {
    this.mat.uniforms.uSunAngRad.value = a;
  }

  setOccluders(list: { pos: THREE.Vector3; radius: number }[]): void {
    const arr = this.mat.uniforms.uOccluder.value as THREE.Vector4[];
    const n = Math.min(arr.length, list.length);
    for (let i = 0; i < n; i++) {
      arr[i].set(list[i].pos.x, list[i].pos.y, list[i].pos.z, list[i].radius);
    }
    this.mat.uniforms.uOccluderCount.value = n;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
