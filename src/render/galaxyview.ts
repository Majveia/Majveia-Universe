/**
 * Galaxy renderer.
 *
 * Two components, both physical:
 *
 *  - Resolved stars, as flux-conserving point sprites. Each carries a real
 *    luminosity from population synthesis, so brightness falls as 1/d^2 and
 *    the O stars in the arms genuinely blow out into the bloom while the
 *    K dwarfs that make up most of the mass stay sub-pixel.
 *
 *  - Dust extinction, evaluated per star from an analytic logarithmic spiral
 *    offset to the *inner* edge of the arms, where the gas shocks as it
 *    overtakes the density wave. Light is attenuated by exp(-tau) along the
 *    path to the camera, so the far side of the disc reddens and dims more
 *    than the near side - which is exactly how you tell which way a galaxy is
 *    tilted in a photograph.
 */

import * as THREE from 'three';
import type { GalaxyBuffers } from '../galaxy/generator';

const VERT = /* glsl */ `
precision highp float;

in vec4 orbit;   // a, b, theta0, omega (rad/Myr)
in vec4 aStar;   // tilt0, z, luminosity, kind
in vec3 aColor;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
uniform float uTime;         // Myr
uniform float uPattern;      // pattern speed, rad/Myr
uniform float uArms;
uniform float uTanPitch;
uniform float uA0;
uniform float uDiscScale;
uniform float uThickness;
uniform float uDust;
uniform float uFlux;
uniform float uStarSize;
uniform float uDiffuseSize;
uniform float uMaxSize;
uniform float uArmContrast;
uniform vec3 uCamera;

out vec3 vColor;
out float vAlpha;
out float vKind;

const float PI = 3.14159265359;

void main() {
  float kind = aStar.w;
  float a = orbit.x;
  float b = orbit.y;

  // Position on the closed orbit, then rotate the whole ellipse by its
  // radius-dependent tilt plus the slow advance of the pattern.
  float th = orbit.z + orbit.w * uTime;
  float phi = aStar.x + uPattern * uTime;
  vec2 loc = vec2(a * cos(th), b * sin(th));
  float cs = cos(phi), sn = sin(phi);
  vec2 xy = vec2(loc.x * cs - loc.y * sn, loc.x * sn + loc.y * cs);

  // HII regions ride the wave rather than the stars: they are re-formed
  // continuously wherever the shock currently is.
  if (kind > 2.5 && kind < 3.5) {
    float rr = a;
    float ang = orbit.z + uPattern * uTime;
    xy = vec2(rr * cos(ang), rr * sin(ang));
  }

  vec3 pos = vec3(xy.x, aStar.y, xy.y);

  // --- Dust. The arms are logarithmic spirals in the rotating frame; the dust
  // ridge sits just inside the stellar ridge.
  float R = length(xy);
  float tau = 0.0;
  if (uDust > 0.0 && uArms > 0.5) {
    float ang = atan(xy.y, xy.x);
    float spiralPhase = ang - log(max(R, 0.03) / uA0) / uTanPitch - uPattern * uTime;
    float ridge = 0.5 + 0.5 * cos(spiralPhase * uArms - 0.55);
    float armF = pow(ridge, 3.0);
    float radial = exp(-R / (uDiscScale * 1.4));
    float vertical = exp(-abs(pos.y) / max(uThickness * 0.55, 1e-3));
    // Path length through the dust slab toward the camera, and a bias so the
    // far half of the disc is extinguished more than the near half.
    vec3 toCam = normalize(uCamera - pos);
    float slant = 1.0 / max(abs(toCam.y), 0.12);
    float farSide = 0.5 + 0.5 * sign(dot(uCamera - pos, vec3(0.0, 1.0, 0.0)) * pos.y);
    tau = uDust * (0.35 + 0.9 * armF) * radial * vertical * min(slant, 6.0) * (0.55 + 0.9 * farSide);
  }

  // Interstellar reddening. Dust scatters *blue* light out of the beam far
  // more efficiently than red, so extinguished starlight is not merely dimmer,
  // it is redder. A_lambda ~ lambda^-1 gives roughly these ratios across B, V
  // and R, and it is why the far side of a tilted disc looks warm and dim.
  vec3 ext = exp(-tau * vec3(0.78, 1.0, 1.38));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 1e-4);
  gl_Position = projectionMatrix * mv;

  float flux = uFlux * aStar.z / (dist * dist);

  // Bright stars are drawn larger, and their peak brightness is reduced in
  // proportion to the extra area so that total flux is preserved.
  float size = uStarSize * (1.0 + 0.42 * log2(1.0 + flux * 24.0));
  float maxSize = uMaxSize;
  if (kind > 2.5 && kind < 3.5) { size *= 2.2; maxSize = 8.0; }  // H II: small knots
  if (kind > 4.5) {
    // Unresolved starlight: one sprite stands for a whole neighbourhood, so it
    // is drawn as a broad soft gaussian whose peak is reduced in proportion to
    // its area. Total flux is identical to drawing it as a point.
    size = uDiffuseSize * (1.0 + 0.10 * log2(1.0 + flux * 4.0));
    maxSize = uDiffuseSize * 3.0;
  }
  size = clamp(size, 0.6, maxSize);

  float peak = flux / max(size * size / (uStarSize * uStarSize), 1.0);

  // Young stars trace the arms; boost their contrast so the wave reads clearly.
  float arm = 1.0;
  if (kind > 3.5) arm = uArmContrast;

  vColor = aColor * ext;
  vAlpha = peak * arm;
  vKind = kind;
  gl_PointSize = size;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vKind;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float g;
  if (vKind > 4.5) {
    g = exp(-r2 * 2.6) * 0.42;          // unresolved starlight: broad and soft
  } else if (vKind > 2.5 && vKind < 3.5) {
    g = exp(-r2 * 1.7) * 0.5;           // emission nebulae are extended
  } else {
    g = exp(-r2 * 4.0);                 // stars are the point spread function
  }
  fragColor = vec4(vColor * (g * vAlpha), 1.0);
}
`;

export class GalaxyView {
  readonly group = new THREE.Group();
  readonly points: THREE.Points;
  readonly material: THREE.RawShaderMaterial;
  private geo: THREE.BufferGeometry;
  /** Simulation time in megayears. */
  timeMyr = 0;
  private baseFlux = 1;
  /** Global exposure constant, in arbitrary but consistent units. */
  static EXPOSURE = 2100;

  constructor(readonly buffers: GalaxyBuffers) {
    const p = buffers.params;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('orbit', new THREE.BufferAttribute(buffers.orbit, 4));
    this.geo.setAttribute('aStar', new THREE.BufferAttribute(buffers.star, 4));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(buffers.color, 3));
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffers.count * 3), 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), p.radiusKpc * 3);

    this.material = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTime: { value: 0 },
        uPattern: { value: p.patternSpeed * 1.02271e-3 },
        uArms: { value: p.arms },
        uTanPitch: { value: Math.tan(p.pitch) },
        uA0: { value: Math.max(0.35, p.discScaleKpc * 0.55) },
        uDiscScale: { value: p.discScaleKpc },
        uThickness: { value: p.thicknessKpc },
        uDust: { value: p.dust },
        uFlux: { value: 1 },
        uStarSize: { value: 1.5 },
        uDiffuseSize: { value: 20 },
        uMaxSize: { value: 16 },
        uArmContrast: { value: 2.4 },
        uCamera: { value: new THREE.Vector3() },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    // Auto-exposure: normalise by the galaxy's own sampled luminosity and its
    // size, so a dwarf irregular and a giant elliptical both arrive correctly
    // exposed at the same framing without a per-object magic number.
    const dRef = p.radiusKpc * 2.6;
    this.baseFlux = (GalaxyView.EXPOSURE * dRef * dRef) / Math.max(buffers.stats.totalSampledLuminosity, 1e-6);
    this.material.uniforms.uFlux.value = this.baseFlux;

    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  update(camera: THREE.Vector3, dtMyr: number): void {
    this.timeMyr += dtMyr;
    this.material.uniforms.uTime.value = this.timeMyr;
    (this.material.uniforms.uCamera.value as THREE.Vector3).copy(camera);
  }

  /** Multiplier on the auto-exposed flux. */
  setFlux(v: number): void { this.material.uniforms.uFlux.value = this.baseFlux * v; }
  setStarSize(v: number): void { this.material.uniforms.uStarSize.value = v; }
  setDiffuseSize(v: number): void { this.material.uniforms.uDiffuseSize.value = v; }
  setDust(v: number): void { this.material.uniforms.uDust.value = v; }

  dispose(): void { this.geo.dispose(); this.material.dispose(); }
}
