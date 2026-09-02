/**
 * The deep field behind a cluster, gravitationally lensed.
 *
 * Light from galaxies far behind a cluster passes through its potential well
 * and is bent. The bending is computed here the way it actually works: for
 * every ray leaving the camera, the shader asks where that ray *came from* on
 * the source plane, and samples the background there. That is backward ray
 * tracing through the lens equation
 *
 *     beta = theta - alpha(theta)
 *
 * and it produces multiple images, giant arcs and Einstein rings for free,
 * because those are simply what happens when the map theta -> beta stops being
 * one-to-one. Nothing is drawn as an arc; arcs appear.
 *
 * The mass model is a non-singular isothermal ellipsoid, the standard
 * parametrisation for cluster lenses:
 *
 *     psi(x, y) = theta_E sqrt(theta_c^2 + x^2/q + y^2 q)
 *     alpha = grad psi
 *
 * with the Einstein angle from the velocity dispersion,
 * theta_E = 4 pi sigma^2 / c^2 * D_LS/D_S. For a cluster with sigma = 1200 km/s
 * that is about 40 arcseconds - which is why cluster arcs are a telescope
 * phenomenon and not a naked-eye one, and why this only becomes visible when
 * you back off to a cosmological distance and narrow the field of view.
 *
 * Surface brightness is conserved by lensing - Liouville's theorem - so the
 * shader does *not* multiply by the magnification. An arc looks bright because
 * it is stretched across more of the sky, not because each part of it is
 * brighter, and letting the geometry do that on its own is what makes it right.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;
void main() {
  vDir = normalize(position);
  mat4 mv = modelViewMatrix;
  mv[3].xyz = vec3(0.0);
  vec4 p = projectionMatrix * mv * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vDir;
out vec4 fragColor;

uniform vec3 uLensDir;      // unit vector from the camera toward the lens
uniform vec3 uLensE1;       // orthonormal tangent basis at the lens
uniform vec3 uLensE2;
uniform float uThetaE;      // Einstein angle, radians
uniform float uThetaCore;   // core radius, radians
uniform float uAxisRatio;   // projected axis ratio q of the mass distribution
uniform float uLensPA;      // position angle of the major axis, radians
uniform float uSeed;
uniform float uDensity;     // background galaxies per steradian scaling
uniform float uBrightness;
uniform float uShowCritical;
uniform float uEnabled;

const float PI = 3.14159265359;

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p + uSeed) * 43758.5453123);
}

/** Deflection of the non-singular isothermal ellipsoid, in radians. */
vec2 deflection(vec2 t) {
  float c = cos(uLensPA), s = sin(uLensPA);
  vec2 r = vec2(t.x * c + t.y * s, -t.x * s + t.y * c);
  float q = max(uAxisRatio, 0.15);
  float d = sqrt(uThetaCore * uThetaCore + (r.x * r.x) / q + r.y * r.y * q);
  vec2 a = uThetaE * vec2(r.x / q, r.y * q) / max(d, 1e-12);
  // back to sky axes
  return vec2(a.x * c - a.y * s, a.x * s + a.y * c);
}

/**
 * The background: a field of exponential-profile galaxies at random
 * orientations, sizes, colours and redshifts.
 *
 * Two details make it read as a deep field rather than as noise.
 *
 * The cell grid is scaled to the *current field of view*, so galaxies are
 * always drawn at a size the frame can actually resolve, with a smooth floor
 * standing in for everything below the resolution limit. A real deep field
 * holds something like a thousand galaxies per square arcminute; drawing all of
 * them at a sixty-degree field would be a grey wash, and drawing none of them
 * would be a lie. Resolution-limited rendering is what a telescope does too.
 *
 * The cells live on a 3-D lattice, so a cell offset along the line of sight
 * projects to the same direction as one at the centre. The falloff therefore
 * uses the full three-dimensional separation, not just the tangential part -
 * otherwise every galaxy is drawn several times over, stacked along the ray.
 */
vec3 background(vec3 dir) {
  vec3 col = vec3(0.0);
  vec3 up = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e1 = normalize(cross(up, dir));
  vec3 e2 = cross(dir, e1);

  for (int oct = 0; oct < 2; oct++) {
    float fo = float(oct);
    float scale = uDensity * (1.0 + 2.6 * fo);
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    vec3 f = fract(p);
    for (int k = -1; k <= 1; k++)
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec3 g = vec3(float(i), float(j), float(k));
      vec3 h = hash3(cell + g + fo * 19.0);
      if (h.z > 0.44) continue;
      vec3 rel = g + h - f;

      // Faint galaxy number counts rise steeply with distance, so most of what
      // a deep field contains is small, red and far away. Biasing the redshift
      // draw upward reproduces that, and it matters here for a second reason:
      // arcs are made from sources much smaller than the Einstein radius, and
      // a field of big nearby galaxies would drown them.
      float redshift = pow(fract(h.x * 37.1), 0.40);
      float size = mix(0.055, 0.26, pow(1.0 - redshift, 2.2)) / (1.0 + 1.6 * fo);
      float q = mix(0.22, 1.0, fract(h.y * 61.7));
      float pa = fract(h.z * 91.3) * PI;
      float cp = cos(pa), sp = sin(pa);
      vec2 d2 = vec2(dot(rel, e1), dot(rel, e2));
      float dr = dot(rel, dir);
      vec2 e = vec2(d2.x * cp + d2.y * sp, (-d2.x * sp + d2.y * cp) / max(q, 0.2));
      float rr = sqrt(dot(e, e) + dr * dr) / size;
      // Exponential disc profile, which is what most faint field galaxies are
      float I = exp(-rr * 2.4);
      if (I < 0.003) continue;
      // Cosmological dimming and reddening with redshift
      vec3 tint = mix(vec3(0.74, 0.83, 1.0), vec3(1.0, 0.55, 0.30), redshift);
      float lum = mix(1.0, 0.14, redshift) * (0.35 + 0.65 * fract(h.x * 13.7));
      // A bright nucleus, so the brighter galaxies have a core
      float nucleus = exp(-rr * 9.0) * 0.8;
      col += tint * (I + nucleus) * lum / (1.0 + fo * 2.6);
    }
  }
  // Everything too small to resolve, as an unresolved background.
  return col + vec3(0.030, 0.033, 0.045) * 0.10;
}

void main() {
  vec3 d = normalize(vDir);
  if (uEnabled < 0.5) { fragColor = vec4(background(d) * uBrightness, 1.0); return; }

  // Tangent-plane angle of this ray relative to the lens centre. Lensing is a
  // small-angle phenomenon, so the flat-sky approximation is exact enough.
  float mu = dot(d, uLensDir);
  if (mu <= 0.0) { fragColor = vec4(background(d) * uBrightness, 1.0); return; }
  vec2 theta = vec2(dot(d, uLensE1), dot(d, uLensE2)) / mu;

  vec2 alpha = deflection(theta);
  vec2 beta = theta - alpha;

  // Rebuild a direction from the source-plane angle.
  vec3 src = normalize(uLensDir + beta.x * uLensE1 + beta.y * uLensE2);
  vec3 col = background(src) * uBrightness;

  if (uShowCritical > 0.0) {
    // det A = det(I - d alpha / d theta), by central differences. Its zeros are
    // the critical curves - where magnification formally diverges and where the
    // arcs live.
    float h = max(uThetaE * 0.02, 1e-9);
    vec2 ax = (deflection(theta + vec2(h, 0.0)) - deflection(theta - vec2(h, 0.0))) / (2.0 * h);
    vec2 ay = (deflection(theta + vec2(0.0, h)) - deflection(theta - vec2(0.0, h))) / (2.0 * h);
    float detA = (1.0 - ax.x) * (1.0 - ay.y) - ax.y * ay.x;
    float line = 1.0 - smoothstep(0.0, 0.045, abs(detA));
    col += vec3(0.16, 0.62, 0.55) * line * uShowCritical * 0.5;
  }

  fragColor = vec4(col, 1.0);
}
`;

export interface LensedFieldOptions {
  seed?: number;
  brightness?: number;
  density?: number;
}

export class LensedField {
  readonly mesh: THREE.Mesh;
  private mat: THREE.RawShaderMaterial;
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(opts: LensedFieldOptions = {}) {
    this.mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uLensDir: { value: new THREE.Vector3(0, 0, 1) },
        uLensE1: { value: new THREE.Vector3(1, 0, 0) },
        uLensE2: { value: new THREE.Vector3(0, 1, 0) },
        uThetaE: { value: 2e-4 },
        uThetaCore: { value: 3e-5 },
        uAxisRatio: { value: 0.7 },
        uLensPA: { value: 0.4 },
        uSeed: { value: ((opts.seed ?? 1) % 883) / 17 },
        uDensity: { value: 400 },
        uBrightness: { value: opts.brightness ?? 1 },
        uShowCritical: { value: 0 },
        uEnabled: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  /**
   * Point the lens at a world position as seen from the camera, and set the
   * angular scales from the cluster's physics and the observer's distance.
   *
   * @param sigmaKms   velocity dispersion of the cluster
   * @param coreKpc    core radius of the mass distribution
   * @param distanceKpc distance from camera to cluster centre
   */
  aim(
    cameraPos: THREE.Vector3, lensPos: THREE.Vector3,
    sigmaKms: number, coreKpc: number, distanceKpc: number,
  ): void {
    this.dir.copy(lensPos).sub(cameraPos);
    const dist = Math.max(this.dir.length(), 1e-9);
    this.dir.divideScalar(dist);
    // A stable tangent basis
    const up = Math.abs(this.dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    this.e1.crossVectors(up, this.dir).normalize();
    this.e2.crossVectors(this.dir, this.e1).normalize();

    (this.mat.uniforms.uLensDir.value as THREE.Vector3).copy(this.dir);
    (this.mat.uniforms.uLensE1.value as THREE.Vector3).copy(this.e1);
    (this.mat.uniforms.uLensE2.value as THREE.Vector3).copy(this.e2);

    // theta_E = 4 pi sigma^2 / c^2, with D_LS/D_S -> 1 for sources far behind.
    const beta = sigmaKms / 299792.458;
    this.mat.uniforms.uThetaE.value = 4 * Math.PI * beta * beta;
    this.mat.uniforms.uThetaCore.value = coreKpc / Math.max(distanceKpc, 1e-6);
  }

  setShape(axisRatio: number, positionAngle: number): void {
    this.mat.uniforms.uAxisRatio.value = axisRatio;
    this.mat.uniforms.uLensPA.value = positionAngle;
  }

  setEnabled(on: boolean): void { this.mat.uniforms.uEnabled.value = on ? 1 : 0; }

  /**
   * Match the cell grid to what the current field of view can resolve, so a
   * galaxy is always a few dozen pixels across whether the frame spans sixty
   * degrees or eight arcminutes.
   */
  setFieldOfView(fovRadians: number): void {
    this.mat.uniforms.uDensity.value = Math.max(6, this.cellsPerField / Math.max(fovRadians, 1e-6));
  }

  /** Roughly how many background galaxies span the frame. */
  cellsPerField = 34;
  setCritical(v: number): void { this.mat.uniforms.uShowCritical.value = v; }
  setBrightness(v: number): void { this.mat.uniforms.uBrightness.value = v; }
  get einsteinAngleArcsec(): number {
    return (this.mat.uniforms.uThetaE.value as number) * 206264.806;
  }
  get critical(): number { return this.mat.uniforms.uShowCritical.value as number; }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/**
 * Einstein radius of an isothermal sphere, in radians, for sources far behind.
 * theta_E = 4 pi sigma^2 / c^2.
 */
export const einsteinAngle = (sigmaKms: number): number => {
  const b = sigmaKms / 299792.458;
  return 4 * Math.PI * b * b;
};

/**
 * Projected mass inside the Einstein radius: M_E = theta_E^2 c^2 D_L D_S /
 * (4 G D_LS). For an isothermal sphere observed from far away this reduces to
 * pi sigma^2 D_L theta_E / G - the quantity a lensing measurement actually
 * returns, and the reason cluster masses from lensing need no assumption about
 * dynamical equilibrium.
 */
export function einsteinMass(sigmaKms: number, distanceMpc: number): number {
  const G = 4.30091e-9; // Mpc (km/s)^2 / Msun
  const thetaE = einsteinAngle(sigmaKms);
  return (Math.PI * sigmaKms * sigmaKms * distanceMpc * thetaE) / G;
}
