/**
 * Stars, up close.
 *
 * The photosphere is not a painted ball. It is limb-darkened, because looking
 * at the edge of the disc you see only the cooler upper layers; it is granulated,
 * because convection cells the size of Texas are constantly overturning; it has
 * spots where the magnetic field is strong enough to suppress that convection;
 * and it is surrounded by a corona whose brightness falls off as a power law.
 *
 * The colour of every part of it comes from the blackbody spectrum at the local
 * temperature, so a spot is genuinely redder than the surface around it rather
 * than just darker.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';
import { blackbodyRGB } from '../astro/blackbody';
import type { Star } from '../astro/stellar';

const VERT = /* glsl */ `
out vec3 vObj;
out vec3 vNormalW;
out vec3 vWorld;
void main() {
  vObj = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vObj;
in vec3 vNormalW;
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uSpots;
uniform float uGranule;
uniform vec3 uHotColor;
uniform vec3 uCoolColor;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(n, v), 0.0, 1.0);

  // Eddington limb darkening: I(mu)/I(1) = (2 + 3 mu) / 5.
  // Adding the quadratic term matches solar observations closely.
  float limb = 0.35 + 0.65 * mu + 0.12 * mu * mu;
  limb /= 1.12;

  vec3 p = normalize(vObj);
  // Granulation: convection cells, drifting and reforming.
  vec3 gq = p * uGranule + vec3(uSeed) + vec3(0.0, uTime * 0.03, 0.0);
  vec2 cells = worley(gq);
  float lane = smoothstep(0.0, 0.22, cells.y - cells.x);       // dark intergranular lanes
  float gran = mix(0.72, 1.14, lane);
  gran *= 1.0 + 0.10 * fbm(gq * 3.0 + vec3(uTime * 0.05), 4, 2.2, 0.5);

  // Starspots: cooler, and therefore redder, not merely darker.
  float spotField = fbm(p * 2.6 + vec3(uSeed * 1.7) + vec3(0.0, 0.0, uTime * 0.004), 5, 2.1, 0.5);
  float spot = smoothstep(0.30, 0.52, spotField) * uSpots;
  // Spots cluster in two activity belts either side of the equator, as on the Sun.
  spot *= smoothstep(0.62, 0.30, abs(p.y)) * smoothstep(0.02, 0.14, abs(p.y));

  float temp = gran * (1.0 - spot * 0.55);
  vec3 col = mix(uCoolColor, uHotColor, clamp(temp * 0.72, 0.0, 1.0));

  // Faculae: bright magnetic flux tubes at the edges of spot groups, visible
  // mostly near the limb, which is why the Sun is brighter at solar maximum.
  float fac = smoothstep(0.26, 0.32, spotField) * (1.0 - smoothstep(0.34, 0.42, spotField));
  col += uHotColor * fac * 0.35 * (1.0 - mu) * uSpots;

  fragColor = vec4(col * uIntensity * limb, 1.0);
}
`;

const CORONA_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CORONA_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
in vec3 vWorld;
out vec4 fragColor;

uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;

void main() {
  vec3 rd = normalize(vWorld - cameraPosition);
  vec3 oc = cameraPosition - uCenter;
  float b = dot(oc, rd);
  float perp = sqrt(max(dot(oc, oc) - b * b, 0.0));
  float x = perp / uRadius;
  if (x > 3.9) discard;

  // Coronal brightness falls roughly as r^-3 close in (the K corona, electron
  // scattering) with a shallower r^-1.5 tail (the F corona, dust).
  float k = 1.0 / (1.0 + pow(max(x, 1.0), 4.0));
  float f = 0.055 / (1.0 + pow(max(x, 1.0), 2.2));
  float glow = (k + f) * smoothstep(3.9, 2.4, x);

  // Streamers along the magnetic field, brighter at the equator
  vec3 dir = normalize((cameraPosition + rd * max(b, 0.0)) - uCenter);
  float ray = fbm(dir * 4.0 + vec3(uSeed) + vec3(0.0, 0.0, uTime * 0.02), 4, 2.3, 0.55);
  glow *= 0.72 + 0.75 * (ray * 0.5 + 0.5);

  // Chromospheric edge: a thin, intensely red H-alpha rim right at the surface
  float rim = smoothstep(1.12, 1.0, x) * smoothstep(0.94, 1.0, x);
  vec3 col = uColor * glow + vec3(1.0, 0.22, 0.16) * rim * 1.6;

  fragColor = vec4(col * uIntensity, 1.0);
}
`;

export class StarView {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly corona: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private coronaMat: THREE.ShaderMaterial;

  readonly baseRadius: number;
  worldRadius: number;

  constructor(readonly star: Star, radius: number, seed = 0, intensity = 1) {
    this.baseRadius = radius;
    this.worldRadius = radius;
    const c = star.color;
    const hot = blackbodyRGB(star.teff * 1.06);
    const cool = blackbodyRGB(star.teff * 0.86);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uColor: { value: new THREE.Vector3(c[0], c[1], c[2]) },
        uHotColor: { value: new THREE.Vector3(hot[0] * 1.35, hot[1] * 1.35, hot[2] * 1.35) },
        uCoolColor: { value: new THREE.Vector3(cool[0] * 0.55, cool[1] * 0.5, cool[2] * 0.45) },
        uTime: { value: 0 },
        uSeed: { value: (seed % 1000) / 37 },
        uIntensity: { value: intensity },
        // Cooler stars are more magnetically active and far more spotted
        uSpots: { value: star.teff < 5200 ? 0.85 : star.teff < 6300 ? 0.4 : 0.08 },
        uGranule: { value: star.teff > 9000 ? 22 : 13 },
      },
    });
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), this.mat);
    this.group.add(this.surface);

    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VERT,
      fragmentShader: CORONA_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: radius },
        uColor: { value: new THREE.Vector3(c[0], c[1], c[2]) },
        uIntensity: { value: intensity * 0.5 },
        uTime: { value: 0 },
        uSeed: { value: (seed % 733) / 29 },
      },
    });
    this.corona = new THREE.Mesh(new THREE.SphereGeometry(radius * 4.0, 32, 16), this.coronaMat);
    this.group.add(this.corona);
  }

  /** Draw the star at a different world radius; see PlanetView.setWorldRadius. */
  setWorldRadius(r: number): void {
    if (Math.abs(r - this.worldRadius) < 1e-14) return;
    this.worldRadius = r;
    this.group.scale.setScalar(r / this.baseRadius);
    this.coronaMat.uniforms.uRadius.value = r;
  }

  update(timeS: number, worldPos: THREE.Vector3): void {
    this.mat.uniforms.uTime.value = timeS;
    this.coronaMat.uniforms.uTime.value = timeS;
    this.coronaMat.uniforms.uCenter.value.copy(worldPos);
  }

  setIntensity(v: number): void {
    this.mat.uniforms.uIntensity.value = v;
    this.coronaMat.uniforms.uIntensity.value = v * 0.9;
  }

  dispose(): void {
    this.surface.geometry.dispose(); this.mat.dispose();
    this.corona.geometry.dispose(); this.coronaMat.dispose();
  }
}
