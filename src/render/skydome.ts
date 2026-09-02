/**
 * The night sky, from inside a galaxy.
 *
 * An inverted sphere with a procedural starfield: three octaves of a cell grid
 * give a magnitude distribution close to the real one (a few bright stars, a
 * great many faint ones), each star coloured by a temperature drawn from the
 * stellar population, so the sky has the same quiet variety a real one does.
 * Behind it sits the band of the host galaxy - a warm, dust-mottled strip that
 * tells you which way the disc runs - and a scattering of faint nebulosity.
 *
 * It is generated, not photographed, so it costs no download and it is
 * consistent with the galaxy the viewer is actually standing in.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;
void main() {
  vDir = normalize(position);
  // Strip the translation: the sky is infinitely far away, so it must not
  // shift when the camera moves - only when it turns.
  mat4 mv = modelViewMatrix;
  mv[3].xyz = vec3(0.0);
  vec4 p = projectionMatrix * mv * vec4(position, 1.0);
  gl_Position = p.xyww;   // force to the far plane
}
`;

const FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vDir;
out vec4 fragColor;

uniform float uBrightness;
uniform float uBandStrength;
uniform vec3 uBandColor;
uniform vec3 uBandNormal;
uniform float uSeed;
uniform float uNebula;
uniform float uBeta;        // speed as a fraction of c
uniform vec3 uBoost;        // direction of travel, world space
uniform float uSkyGain;     // detector stop-down, so structure survives beaming

vec3 blackbodyApprox(float T) {
  T = clamp(T, 1200.0, 32000.0);
  float t = T / 100.0;
  float r, g, b;
  if (t <= 66.0) {
    r = 1.0;
    g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0);
    b = t <= 19.0 ? 0.0 : clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
  } else {
    r = clamp(329.698727446 * pow(t - 60.0, -0.1332047592) / 255.0, 0.0, 1.0);
    g = clamp(288.1221695283 * pow(t - 60.0, -0.0755148492) / 255.0, 0.0, 1.0);
    b = 1.0;
  }
  return pow(vec3(r, g, b), vec3(2.2));
}

vec3 h33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p + uSeed) * 43758.5453123);
}

void main() {
  vec3 d = normalize(vDir);

  // --- Relativistic aberration.
  //
  // d is where the light *appears* to come from. To find the star that emitted
  // it, run the transformation backwards: with mu the cosine of the angle
  // between the apparent direction and the direction of travel,
  //
  //     mu_rest = (mu - beta) / (1 - beta mu)
  //
  // and the perpendicular component follows from normalisation. The sky is then
  // sampled in the rest frame, which is where the stars actually are.
  float doppler = 1.0;
  if (uBeta > 1e-6) {
    float g = 1.0 / sqrt(max(1.0 - uBeta * uBeta, 1e-12));
    float mu = clamp(dot(d, uBoost), -1.0, 1.0);
    doppler = 1.0 / (g * (1.0 - uBeta * mu));
    float mu0 = clamp((mu - uBeta) / (1.0 - uBeta * mu), -1.0, 1.0);
    vec3 perp = d - uBoost * mu;
    float pl = length(perp);
    d = pl > 1e-7
      ? normalize(uBoost * mu0 + (perp / pl) * sqrt(max(1.0 - mu0 * mu0, 0.0)))
      : normalize(uBoost * sign(mu0 == 0.0 ? 1.0 : mu0));
  }
  // Iv/v^3 is a Lorentz invariant, so bolometric surface brightness goes as the
  // fourth power of the Doppler factor. The sky ahead does not just blueshift,
  // it blazes; the sky behind goes out.
  float d2 = doppler * doppler;
  float beam = d2 * d2;

  float band = dot(d, normalize(uBandNormal));
  vec3 col = vec3(0.0);

  // --- Stars. Denser toward the galactic plane, as they are in reality.
  float planeBoost = 1.0 + 2.2 * exp(-pow(band * 4.2, 2.0));
  for (int oct = 0; oct < 3; oct++) {
    float fo = float(oct);
    float scale = 42.0 * pow(2.7, fo);
    vec3 p = d * scale;
    vec3 cell = floor(p);
    vec3 f = fract(p);
    for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec3 g = vec3(float(i), float(j), float(k));
      vec3 h = h33(cell + g + fo * 37.0);
      float thresh = 0.974 - fo * 0.006;
      if (h.z * planeBoost > thresh) {
        vec3 rel = g + h - f;
        // Luminosity function: many faint, few bright
        float mag = pow(fract(h.x * 91.7), 5.0);
        float T = mix(2700.0, 24000.0, pow(fract(h.y * 47.3), 2.6));
        // A blackbody stays a blackbody: only its temperature moves.
        col += blackbodyApprox(T * doppler) * mag * exp(-dot(rel, rel) * 340.0)
             / pow(2.7, fo);
      }
    }
  }

  // --- The galactic band: unresolved starlight, cut by dust lanes.
  float b = exp(-pow(band * 7.0, 2.0));
  float mottle = fbm(d * 5.0 + vec3(uSeed), 5, 2.2, 0.55) * 0.5 + 0.5;
  float dust = pow(clamp(fbm(d * 8.0 + vec3(11.0, uSeed, 3.0), 5, 2.4, 0.55) * 0.5 + 0.5, 0.0, 1.0), 2.2);
  col += uBandColor * b * uBandStrength * (0.25 + 0.85 * mottle) * (1.0 - 0.85 * dust);

  // --- A few faint emission regions along the plane.
  if (uNebula > 0.0) {
    float n = fbm(d * 3.1 + vec3(53.0, uSeed * 0.7, 7.0), 5, 2.1, 0.5);
    float mask = smoothstep(0.22, 0.55, n) * exp(-pow(band * 3.2, 2.0));
    col += vec3(0.55, 0.14, 0.22) * mask * uNebula;
    float n2 = fbm(d * 4.7 + vec3(91.0, 5.0, uSeed), 4, 2.3, 0.5);
    col += vec3(0.10, 0.32, 0.34) * smoothstep(0.34, 0.62, n2) * exp(-pow(band * 3.6, 2.0)) * uNebula * 0.6;
  }

  // Beaming, and the stop-down that keeps it legible. The forward brightening
  // is real and enormous - at gamma 700 it is fourteen orders of magnitude -
  // so what is shown is the sky through an instrument that closes down as it
  // accelerates. The *ratios* across the sky are untouched: the headlight cone
  // and the darkness behind it are the physics, the absolute level is not.
  col *= beam * uSkyGain;

  // --- The microwave background, which is invisible until it is not.
  //
  // It is a 2.7 K blackbody, so the Doppler factor takes it to 2.7 D. The
  // fraction of that curve landing in the visible is the Wien tail,
  // exp(-hc/lambda k T), and the steepness of that exponential is why the
  // background is nothing at all at gamma = 100 and a wall of light at
  // gamma = 1000.
  if (uBeta > 0.9) {
    float Tc = 2.7255 * doppler;
    float wien = exp(-26170.0 / max(Tc, 1.0));
    // The background is not stopped down with the stars, because the whole
    // point of it is that it stops being a background: past gamma of a few
    // hundred the microwave sky outshines every star in it.
    float I = min(Tc * Tc * Tc * Tc * wien * 4.0e-4, 14.0);
    col += blackbodyApprox(max(Tc, 1200.0)) * I;
  }

  fragColor = vec4(col * uBrightness, 1.0);
}
`;

export interface SkyDomeOptions {
  brightness?: number;
  bandStrength?: number;
  bandColor?: [number, number, number];
  seed?: number;
  nebula?: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private mat: THREE.RawShaderMaterial;

  constructor(opts: SkyDomeOptions = {}) {
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uBrightness: { value: opts.brightness ?? 1 },
        uBandStrength: { value: opts.bandStrength ?? 0.012 },
        uBandColor: { value: new THREE.Vector3(...(opts.bandColor ?? [0.72, 0.62, 0.48])) },
        uBandNormal: { value: new THREE.Vector3(0, 1, 0) },
        uSeed: { value: ((opts.seed ?? 1) % 997) / 13 },
        uNebula: { value: opts.nebula ?? 0.006 },
        uBeta: { value: 0 },
        uBoost: { value: new THREE.Vector3(0, 0, -1) },
        uSkyGain: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  setBandNormal(n: THREE.Vector3): void {
    this.mat.uniforms.uBandNormal.value.copy(n).normalize();
  }
  setBrightness(v: number): void { this.mat.uniforms.uBrightness.value = v; }
  setBandStrength(v: number): void { this.mat.uniforms.uBandStrength.value = v; }
  setNebula(v: number): void { this.mat.uniforms.uNebula.value = v; }

  /**
   * Put the observer in motion.
   * @param beta speed as a fraction of c
   * @param dir unit vector along the direction of travel, world space
   */
  setBoost(beta: number, dir: THREE.Vector3): void {
    const b = Math.max(0, Math.min(beta, 0.99999999));
    this.mat.uniforms.uBeta.value = b;
    (this.mat.uniforms.uBoost.value as THREE.Vector3).copy(dir).normalize();
    // Normalise against the forward Doppler factor, slightly under the fourth
    // power so that accelerating still reads as the sky getting brighter.
    const dFwd = Math.sqrt((1 + b) / Math.max(1 - b, 1e-16));
    this.mat.uniforms.uSkyGain.value = b > 1e-6 ? Math.pow(dFwd, -3.2) : 1;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
