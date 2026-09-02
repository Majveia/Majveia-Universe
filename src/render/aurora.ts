/**
 * Aurorae.
 *
 * The shape is not drawn. A dipole field is assumed, tilted off the spin axis;
 * the magnetopause standoff distance L follows from the field strength and the
 * stellar wind pressure; and the last closed field line - the one crossing the
 * equator at L planetary radii - lands at a colatitude θ with sin²θ = 1/L.
 * That ring is the auroral oval, and this shader integrates emission through
 * the shell of atmosphere it lands in.
 *
 * The colours are line emission, not a gradient. Precipitating electrons stop
 * at a depth set by their energy, and each depth has a different dominant
 * transition:
 *
 *  - Below about 100 km, N₂⁺ at 427.8 nm: the violet fringe at the bottom of a
 *    bright curtain.
 *  - Around 100 to 200 km, the forbidden [O I] line at 557.7 nm: the green
 *    that almost every aurora is.
 *  - Above 200 km, [O I] at 630.0 nm. It is forbidden too, with a lifetime of
 *    110 seconds, so it can only radiate where collisions are rare enough to
 *    leave the atom alone that long - which is why the red is always on top,
 *    and why it appears in big storms when the precipitation is soft enough to
 *    stop high.
 *
 * The rays are the field lines. Charged particles spiral down them and cannot
 * cross them, so the structure is coherent along the vertical and shredded
 * across it, which is why an aurora looks like a curtain rather than a cloud.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';

const AURORA_VERT = /* glsl */ `
out vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}

in vec3 vObj;
out vec4 fragColor;

uniform vec3 uCamLocal;     // camera in the planet's own frame, radii
uniform vec3 uAxis;         // magnetic dipole axis, unit
uniform vec3 uE1;           // basis perpendicular to the axis
uniform vec3 uE2;
uniform vec3 uAntiSun;      // away from the star, unit, same frame
uniform float uOvalColat;   // radians from the magnetic pole
uniform float uOvalWidth;   // radians
uniform float uPower;       // relative to Earth's aurora
uniform float uRin;
uniform float uRout;
uniform float uTime;

const int STEPS = 16;

// Interleaved gradient noise, for dithering the sample positions. A fixed step
// grid through a thin shell lays down visible rings; jittering the phase turns
// those rings into noise the eye reads as glow.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Near and far intersections of a ray with a sphere of radius r about the
// origin. Returns false if it misses.
bool hitSphere(vec3 o, vec3 d, float r, out float t0, out float t1) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  t0 = -b - s;
  t1 = -b + s;
  return true;
}

/** Emission integrated along one segment of the ray that lies inside the shell. */
vec3 marchSegment(vec3 o, vec3 d, float tStart, float tEnd, float jitter) {
  vec3 acc = vec3(0.0);
  if (tEnd <= tStart) return acc;
  float dt = (tEnd - tStart) / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    float t = tStart + (float(i) + jitter) * dt;
    vec3 x = o + d * t;
    float r = length(x);
    if (r < uRin || r > uRout) continue;
    vec3 u = x / r;

    // Distance from the nearer magnetic pole. Both hemispheres light up,
    // because the same field line has two ends.
    float cosm = dot(u, uAxis);
    float colat = acos(clamp(abs(cosm), 0.0, 1.0));
    float band = exp(-pow((colat - uOvalColat) / uOvalWidth, 2.0));
    if (band < 0.004) continue;

    float h = clamp((r - uRin) / max(uRout - uRin, 1e-5), 0.0, 1.0);

    // Magnetic longitude, for structure that runs along the oval.
    float lon = atan(dot(u, uE2), dot(u, uE1));
    vec2 ring = vec2(cos(lon), sin(lon));

    // Structure. An auroral arc is long east-west and thin north-south, because
    // it lies along a magnetic shell: features stretch around the oval and are
    // sharp across it. So the noise runs fast in colatitude and slow in
    // longitude - the reverse gives spokes radiating from the pole, which is
    // not what an aurora does.
    // The colatitude coordinate is warped by a slow function of longitude, or
    // the arcs come out as perfect concentric rings about the pole - which is
    // what a dipole would give if the ionosphere were uniform, and it is not.
    float wander = fbm(vec3(ring * 1.25, 0.0), 3, 2.0, 0.5);
    float arcs = fbm(vec3(ring * 2.6, colat * 15.0 + wander * 2.6 + uTime * 0.006),
                     4, 2.2, 0.55) * 0.5 + 0.5;
    // Rays are the second structure: fine striations along the arc, one per
    // bundle of field lines, and coherent from bottom to top of the curtain.
    float rays = fbm(vec3(ring * 24.0, colat * 2.0), 3, 2.4, 0.5) * 0.5 + 0.5;
    float structure = smoothstep(0.34, 0.88, arcs * 0.62 + rays * 0.38);
    // Slow drift of the whole display, and the folds that come with it.
    float folds = fbm(vec3(ring * 3.2, uTime * 0.02), 3, 2.1, 0.5) * 0.5 + 0.5;

    // Daylight hides it. An aurora is a few kilorayleighs; the sunlit sky under
    // it is four or five orders of magnitude brighter, which is why nobody has
    // ever seen one in the afternoon. The emission does not stop at dawn - it
    // just stops being visible, so this is an attenuation and not a switch.
    float dayWash = 1.0 - 0.96 * smoothstep(-0.08, 0.22, -dot(u, uAntiSun));
    if (dayWash < 0.01) continue;

    // Substorms discharge on the night side, so the oval is brightest around
    // magnetic midnight and faintest at noon.
    float mlt = 0.42 + 0.58 * (0.5 + 0.5 * dot(normalize(u - uAxis * cosm), uAntiSun));

    // Emission height profile: most of the light comes from where the electrons
    // stop, with a long tail of red above it.
    float green = exp(-pow((h - 0.20) / 0.24, 2.0));
    float violet = exp(-pow(h / 0.10, 2.0));
    float red = smoothstep(0.55, 1.0, h);

    vec3 emit = vec3(0.13, 1.0, 0.44) * green
              + vec3(0.45, 0.28, 1.0) * violet * 0.30
              + vec3(1.0, 0.15, 0.26) * red * 0.35;

    acc += emit * band * structure * (0.45 + 0.55 * folds) * mlt * dayWash * dt;
  }
  return acc;
}

void main() {
  vec3 o = uCamLocal;
  vec3 d = normalize(vObj - uCamLocal);

  float a0, a1;
  if (!hitSphere(o, d, uRout, a0, a1)) discard;
  float outNear = max(a0, 0.0);
  float outFar = a1;
  if (outFar <= outNear) discard;

  // The solid planet stops the ray: nothing behind its near surface counts.
  float p0, p1;
  bool hitsPlanet = hitSphere(o, d, 1.0, p0, p1) && p0 > 0.0;
  float blocked = hitsPlanet ? p0 : outFar;

  // The shell is hollow, so a ray can cross it twice: once coming in over the
  // near limb and once going out over the far one. Marching the whole chord
  // instead and skipping the middle wastes every sample in the hollow, which is
  // most of them, and leaves the shell aliased into rings.
  float i0, i1;
  bool hitsInner = hitSphere(o, d, uRin, i0, i1) && i1 > 0.0;
  float jitter = ign(gl_FragCoord.xy + fract(uTime * 0.01) * 37.0);

  vec3 acc = vec3(0.0);
  if (hitsInner) {
    acc += marchSegment(o, d, outNear, min(max(i0, outNear), blocked), jitter);
    if (!hitsPlanet) acc += marchSegment(o, d, max(i1, outNear), outFar, jitter);
  } else {
    acc += marchSegment(o, d, outNear, min(outFar, blocked), jitter);
  }

  vec3 col = acc * uPower * 2.3;
  if (max(col.r, max(col.g, col.b)) < 1e-5) discard;
  // Additive blending in three multiplies by the source alpha, so the alpha has
  // to be 1 here: putting the luminance in it as well would square the
  // brightness and erase everything but the brightest limb.
  fragColor = vec4(col, 1.0);
}
`;

export interface AuroraOptions {
  /** Planet radius in the same units as the mesh, usually 1. */
  radius: number;
  /** Top of the emitting shell, as a fraction of the radius above the surface. */
  height: number;
  /** Colatitude of the oval, radians from the magnetic pole. */
  ovalColatitude: number;
  /** Brightness relative to Earth's aurora. */
  power: number;
  /** Tilt of the magnetic axis from the spin axis, radians. */
  tilt: number;
  /** Longitude the tilt leans toward, radians. */
  tiltAzimuth?: number;
}

export class AuroraView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private axis = new THREE.Vector3(0, 1, 0);
  private inv = new THREE.Matrix4();

  constructor(opts: AuroraOptions) {
    const rIn = opts.radius * 1.004;
    const rOut = opts.radius * (1 + opts.height);
    const az = opts.tiltAzimuth ?? 0;
    this.axis.set(
      Math.sin(opts.tilt) * Math.cos(az),
      Math.cos(opts.tilt),
      Math.sin(opts.tilt) * Math.sin(az)).normalize();
    // Any orthonormal pair perpendicular to the axis will do; it only has to be
    // stable, so that the curtains do not swim about between frames.
    const e1 = new THREE.Vector3(0, 0, 1).cross(this.axis);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = new THREE.Vector3().crossVectors(this.axis, e1).normalize();

    this.mat = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3(0, 0, 4) },
        uAxis: { value: this.axis.clone() },
        uE1: { value: e1 },
        uE2: { value: e2 },
        uAntiSun: { value: new THREE.Vector3(-1, 0, 0) },
        uOvalColat: { value: opts.ovalColatitude },
        // A quiet oval is a couple of degrees wide; a stormy one is broader.
        // A quiet oval is a few degrees of bright arc with a broader diffuse
        // glow equatorward of it; an active one thickens and moves.
        uOvalWidth: { value: 0.052 + 0.055 * Math.min(1, opts.power / 4) },
        uPower: { value: opts.power },
        uRin: { value: rIn / opts.radius },
        uRout: { value: rOut / opts.radius },
        uTime: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(rOut, 48, 32), this.mat);
    this.mesh.renderOrder = 3;
  }

  /**
   * @param camera the scene camera
   * @param sunDir world-space direction from the planet toward its star
   */
  update(camera: THREE.Camera, sunDir: THREE.Vector3, timeS: number, spinY = 0): void {
    // The field is anchored in the crust, so the oval turns with the planet and
    // sweeps under a fixed observer once a day.
    this.mesh.rotation.y = spinY;
    this.mesh.updateWorldMatrix(true, false);
    this.inv.copy(this.mesh.matrixWorld).invert();
    const cam = this.mat.uniforms.uCamLocal.value as THREE.Vector3;
    camera.getWorldPosition(cam).applyMatrix4(this.inv);
    // Direction only: rotate without translating.
    const anti = this.mat.uniforms.uAntiSun.value as THREE.Vector3;
    anti.copy(sunDir).transformDirection(this.inv).multiplyScalar(-1).normalize();
    this.mat.uniforms.uTime.value = timeS;
  }

  setPower(p: number): void { this.mat.uniforms.uPower.value = p; }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
