/**
 * Emission nebulae, ray-marched.
 *
 * A nebula is not a picture pasted on a billboard here - it is a volume, and
 * the camera flies into it. Each step through the volume accumulates emission
 * and attenuates what is behind it, which is the radiative transfer equation
 * in its simplest useful form:
 *
 *     dI/ds = j(x) - kappa(x) I
 *
 * The colours are the actual forbidden and recombination lines that make these
 * objects glow. Hydrogen alpha at 656 nm gives the deep red; doubly ionised
 * oxygen at 496 and 501 nm gives the teal-green that shows up close to hot
 * stars, because it takes a harder photon to strip oxygen twice than to ionise
 * hydrogen once. So the teal appears where the ionising source is, and the red
 * fills the volume around it - which is why real emission nebulae have exactly
 * that structure.
 *
 * Dust does two things: it absorbs, carving the dark pillars and globules, and
 * it scatters, so the surroundings of an embedded star glow blue.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
in vec3 position;
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uCamera;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uSteps;
uniform float uSeed;
uniform float uTime;
uniform float uDensity;
uniform float uDust;
uniform vec3 uHalpha;
uniform vec3 uOiii;
uniform vec3 uReflect;
uniform float uEmission;
uniform int uShape;          // 0 diffuse cloud, 1 pillars, 2 supernova shell, 3 planetary
uniform vec4 uSources[4];    // xyz position (in radius units), w strength
uniform vec3 uSourceColor[4];
uniform float uSourceCount;

// Ray-sphere intersection bounding the volume.
bool hitSphere(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
  vec3 oc = ro - uCentre;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - R * R;
  float d = b * b - c;
  if (d < 0.0) return false;
  float s = sqrt(d);
  t0 = -b - s; t1 = -b + s;
  return t1 > 0.0;
}

/** Gas density at a point, in units of the nebula radius. */
float density(vec3 p) {
  // Perturb the bounding radius so the cloud has a ragged edge rather than
  // the silhouette of the sphere it is marched inside.
  float rough = fbm(p * 1.7 + vec3(uSeed * 0.5), 4, 2.2, 0.55);
  float r = length(p) * (1.0 - 0.30 * rough);
  float shell;
  if (uShape == 2) {
    // Supernova remnant: a thin expanding shell, Rayleigh-Taylor fingered
    shell = exp(-pow((r - 0.78) * 5.5, 2.0));
  } else if (uShape == 3) {
    // Planetary nebula: a bipolar shell pinched at the waist by a torus
    float waist = 1.0 - 0.65 * exp(-pow(p.y * 3.4, 2.0));
    shell = exp(-pow((r - 0.62 * waist) * 6.0, 2.0));
  } else {
    shell = smoothstep(1.05, 0.15, r);
  }
  if (shell < 0.002) return 0.0;

  vec3 q = p * 2.4 + vec3(uSeed);
  q = warp(q, 0.55, 1.3);
  float n = fbm(q, 6, 2.15, 0.55);

  if (uShape == 1) {
    // Pillars: dense columns sculpted by photoevaporation. The ionising
    // radiation eats away the diffuse gas and leaves the dense cores behind,
    // shadowed by their own heads - hence the elephant trunks.
    float col = ridged(q * 1.6 + vec3(9.0), 5, 2.2, 0.55);
    float shade = smoothstep(-0.6, 0.7, -p.y);
    n = mix(n, col * 1.5 - 0.35, 0.55 * shade);
  }
  // A steep threshold is what separates a nebula from fog: most of the volume
  // is nearly empty and the emission comes from thin, bright filaments.
  float d = pow(smoothstep(-0.02, 0.62, n), 1.8) * shell;
  return d * uDensity;
}

void main() {
  vec3 ro = uCamera;
  vec3 rd = normalize(vWorld - uCamera);
  float t0, t1;
  if (!hitSphere(ro, rd, uRadius, t0, t1)) discard;
  t0 = max(t0, 0.0);
  float span = t1 - t0;
  if (span <= 0.0) discard;

  int steps = int(uSteps);
  float dt = span / float(steps);

  // Jitter the start so that under-sampling shows as film grain rather than
  // as concentric banding.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453 + uTime);
  float t = t0 + dt * jitter;

  vec3 accum = vec3(0.0);
  float transmit = 1.0;

  for (int i = 0; i < 128; i++) {
    if (i >= steps || transmit < 0.004) break;
    vec3 world = ro + rd * t;
    vec3 p = (world - uCentre) / uRadius;
    float d = density(p);
    if (d > 0.001) {
      // --- Ionisation. Each embedded hot star ionises the gas around it; the
      // ionised volume goes as the inverse square of distance from it, which
      // is the Stromgren picture in miniature.
      float ion = 0.0;
      vec3 lit = vec3(0.0);
      for (int s = 0; s < 4; s++) {
        if (float(s) >= uSourceCount) break;
        vec3 sp = uSources[s].xyz;
        float str = uSources[s].w;
        float dist = max(length(p - sp), 0.03);
        float f = str / (dist * dist);
        ion += f;
        lit += uSourceColor[s] * f;
      }
      float hardness = clamp(ion * 0.55, 0.0, 1.0);

      // Halpha everywhere the gas is ionised at all; [O III] only close in,
      // where the radiation field is hard enough to doubly ionise oxygen.
      vec3 emis = uHalpha * clamp(ion, 0.0, 2.2)
                + uOiii * pow(hardness, 2.4) * 1.5;
      // Dust scattering: the blue reflection halo around an embedded star
      emis += uReflect * lit * uDust * 0.35;

      float dens = d * dt / uRadius;
      accum += transmit * emis * dens * uEmission;
      // Dust absorbs; the gas itself is nearly transparent in the lines.
      transmit *= exp(-dens * (0.5 + uDust * 6.5));
    }
    t += dt;
  }

  float alpha = clamp(1.0 - transmit, 0.0, 1.0);
  if (alpha < 0.002 && length(accum) < 0.002) discard;
  fragColor = vec4(accum, alpha);
}
`;

export interface NebulaSource {
  x: number; y: number; z: number;
  strength: number;
  color: [number, number, number];
}

export interface NebulaOptions {
  radius: number;
  seed?: number;
  /** 0 diffuse, 1 pillars, 2 supernova remnant, 3 planetary nebula. */
  shape?: 0 | 1 | 2 | 3;
  density?: number;
  dust?: number;
  emission?: number;
  steps?: number;
  sources?: NebulaSource[];
}

export class NebulaView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.RawShaderMaterial;

  constructor(opts: NebulaOptions) {
    const sources = (opts.sources ?? [
      { x: 0.05, y: 0.1, z: 0, strength: 0.14, color: [0.75, 0.85, 1] },
    ]).slice(0, 4);
    const srcVec: THREE.Vector4[] = [];
    const srcCol: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const s = sources[i];
      srcVec.push(s ? new THREE.Vector4(s.x, s.y, s.z, s.strength) : new THREE.Vector4());
      srcCol.push(s ? new THREE.Vector3(...s.color) : new THREE.Vector3());
    }

    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uCentre: { value: new THREE.Vector3() },
        uRadius: { value: opts.radius },
        uSteps: { value: opts.steps ?? 64 },
        uSeed: { value: ((opts.seed ?? 3) % 811) / 11 },
        uTime: { value: 0 },
        uDensity: { value: opts.density ?? 1 },
        uDust: { value: opts.dust ?? 0.5 },
        // Emission-line colours in linear sRGB, from the line wavelengths
        uHalpha: { value: new THREE.Vector3(1.0, 0.12, 0.16) },
        uOiii: { value: new THREE.Vector3(0.10, 0.90, 0.72) },
        uReflect: { value: new THREE.Vector3(0.35, 0.5, 1.0) },
        uEmission: { value: opts.emission ?? 1 },
        uShape: { value: opts.shape ?? 0 },
        uSources: { value: srcVec },
        uSourceColor: { value: srcCol },
        uSourceCount: { value: sources.length },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(opts.radius * 1.02, 24, 16), this.mat);
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Vector3, timeS: number): void {
    this.mat.uniforms.uCamera.value.copy(camera);
    this.mat.uniforms.uCentre.value.copy(this.mesh.position);
    this.mat.uniforms.uTime.value = timeS;
  }

  setSteps(n: number): void { this.mat.uniforms.uSteps.value = Math.max(12, Math.min(128, n)); }
  setEmission(v: number): void { this.mat.uniforms.uEmission.value = v; }
  setDensity(v: number): void { this.mat.uniforms.uDensity.value = v; }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
